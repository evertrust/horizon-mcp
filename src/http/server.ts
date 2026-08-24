import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { rateLimit } from 'express-rate-limit';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { type Server, createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import { HorizonError } from '../client/errors.js';
import { HorizonClient } from '../client/http.js';
import { getLogger } from '../logging.js';
import { createSessionServer } from '../server-factory.js';
import type { HorizonSettings } from '../settings.js';
import { formatHttpAuthMethods } from './auth-methods.js';
import type { HttpConfig } from './config.js';
import { CredentialCache, type CredentialEntry } from './credential-cache.js';
import {
  CredentialError,
  type CredentialMaterial,
  buildSessionAuth,
  credentialFingerprintOf,
  extractCredential,
} from './credentials.js';
import { shortFingerprint } from './fingerprint.js';
import { buildSensitiveHeaderSet, scrubSensitiveHeaders } from './headers.js';
import { type JsonRpcId, firstId, jsonRpcErrorBody } from './jsonrpc.js';
import { corsHeaders, isHostAllowed, isOriginAllowed } from './middleware.js';
import { RateLimiter } from './rate-limit.js';
import { KeyedSemaphore, Semaphore } from './semaphore.js';

const logger = getLogger('horizon_mcp.http');

export interface HttpServerHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface HttpServerOptions {
  /** Primarily injectable so shutdown behavior can be tested quickly. */
  closeTimeoutMs?: number;
}

// Application-defined JSON-RPC error codes. MCP 2026-07-28 says new
// implementations SHOULD NOT use -32000..-32019, which it reserves for the
// legacy codes it renumbered away from, so these sit outside the
// -32768..-32000 pre-defined range entirely.
const APP_ERROR_RATE_LIMITED = -31001;
const APP_ERROR_CAPACITY = -31002;
const APP_ERROR_CREDENTIAL = -31003;

function headerStr(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (!done) {
      done = true;
      fn();
    }
  };
}

/** Start the streamable-HTTP MCP server. Returns a handle that closes it. */
export async function startHttpServer(
  settings: HorizonSettings,
  config: HttpConfig,
  options: HttpServerOptions = {},
): Promise<HttpServerHandle> {
  const clientOptions = {
    timeout: settings.timeout,
    exportTimeout: settings.exportTimeout,
    verifySsl: settings.verifySsl,
    testedVersions: settings.testedVersions,
    warnVersions: settings.warnVersions,
  };

  const sensitive = buildSensitiveHeaderSet([
    config.mtls?.forwardHeader ?? '',
    config.mtls?.inbound?.header ?? '',
  ]);

  // Rate limiting is keyed by credential fingerprint now that there is no
  // session id to key on. HORIZON_IP_RATE_LIMIT=0 disables the coarse backstop.
  const credentialLimiter = new RateLimiter(settings.rateLimitRps);

  const ipLimiter = rateLimit({
    windowMs: 1000,
    limit: settings.ipRateLimit > 0 ? settings.ipRateLimit : 1,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => settings.ipRateLimit <= 0,
    validate: false,
  });

  // Deleting the session layer removed the only bound on how many fully
  // registered server instances can exist at once. These restore it.
  const globalConcurrency = new Semaphore(settings.maxConcurrentRequests);
  const perCredentialConcurrency = new KeyedSemaphore(
    settings.maxInflightToolcalls,
  );

  const credentials = new CredentialCache({
    max: settings.credentialCacheMax,
    ttlMs: settings.credentialCacheTtl * 1000,
    onCleanupError: (fingerprint, err) =>
      logger.error(
        `credential cleanup failed for ${shortFingerprint(fingerprint)}: ${err}`,
      ),
    build: async (fingerprint) => {
      const material = pendingMaterial.get(fingerprint);
      if (!material) {
        throw new CredentialError(400, 'credential material unavailable');
      }
      const built = buildSessionAuth(material, config, settings);
      const client = new HorizonClient(settings.url, built.auth, clientOptions);
      try {
        await client.validateAuth();
        built.auth.markValidated();
      } catch (err) {
        // Never cache a failed validation: close what was built and rethrow so
        // the next request revalidates.
        await client.close().catch(() => undefined);
        await built.auth.cleanup().catch(() => undefined);
        throw err;
      }
      return { client, auth: built.auth };
    },
  });

  // Hands the extracted credential material to the cache's build function for
  // the duration of one miss. Keyed by fingerprint so concurrent misses on
  // different credentials never read each other's material.
  const pendingMaterial = new Map<string, CredentialMaterial>();

  // -32600 (Invalid Request) for genuinely malformed requests; the
  // APP_ERROR_* codes above for server-side rejections. The id echoes the
  // request's own id whenever the body was parsed.
  function sendError(
    res: Response,
    status: number,
    id: JsonRpcId | undefined,
    message: string,
    code = -32600,
  ): void {
    if (!res.headersSent) {
      if (status === 401) {
        res.setHeader(
          'WWW-Authenticate',
          `Horizon methods="${formatHttpAuthMethods(config.acceptedAuthMethods)}"`,
        );
      }
      res.status(status).json(jsonRpcErrorBody(id, code, message));
    }
  }

  function handleCredentialError(
    res: Response,
    err: unknown,
    id: JsonRpcId | undefined,
  ): void {
    if (err instanceof CredentialError) {
      sendError(res, err.status, id, err.message, APP_ERROR_CREDENTIAL);
      return;
    }
    throw err;
  }

  // The per-request credential, made available to the MCP server factory.
  // `req.auth` is deliberately NOT used for this: that slot is reserved for
  // verified MCP AuthInfo if OAuth is ever added (see
  // docs/adr/0001-mcp-authorization.md), and the Horizon credential is a
  // different principal.
  const requestCredential = new AsyncLocalStorage<CredentialEntry>();

  // One instance per request: MCP 2026-07-28 has no sessions, and the SDK
  // requires a fresh server per serving unit. Tool schemas are hoisted to
  // module scope so this costs roughly 5 ms and ~1.3 MiB.
  const handler = createMcpHandler(
    () => {
      const entry = requestCredential.getStore();
      if (!entry) {
        throw new Error('no Horizon credential bound to this request');
      }
      return createSessionServer(entry.client, {
        enabledToolsets: settings.enabledToolsets,
        readOnly: settings.readOnly,
      });
    },
    {
      keepAliveMs: settings.sseKeepAlive * 1000,
      // Modern-only: 2025-era requests are answered with the
      // unsupported-protocol-version error naming the revisions we serve.
      legacy: 'reject',
      onerror: (err) => logger.error(`MCP handler error: ${err}`),
    },
  );

  const nodeHandler = toNodeHandler(handler, {
    onerror: (err) => logger.error(`MCP node adapter error: ${err}`),
  });

  /**
   * Resolve the caller's credential, admitting the request only if it fits
   * inside both concurrency budgets. Returns the entry plus a release function,
   * or undefined after an error response has been sent.
   */
  async function admit(
    req: Request,
    res: Response,
  ): Promise<{ entry: CredentialEntry; release: () => void } | undefined> {
    const id = firstId(req.body);

    let material: CredentialMaterial;
    try {
      material = extractCredential(req, config);
    } catch (err) {
      handleCredentialError(res, err, id);
      return undefined;
    }

    const fingerprint = credentialFingerprintOf(material);
    if (!fingerprint) {
      sendError(res, 400, id, 'unusable credential', APP_ERROR_CREDENTIAL);
      return undefined;
    }

    if (!credentialLimiter.tryAcquire(fingerprint, 1)) {
      sendError(res, 429, id, 'rate limit exceeded', APP_ERROR_RATE_LIMITED);
      return undefined;
    }

    const releaseGlobal = globalConcurrency.tryAcquire();
    if (!releaseGlobal) {
      sendError(res, 503, id, 'server at capacity', APP_ERROR_CAPACITY);
      return undefined;
    }
    const releaseCredential = perCredentialConcurrency.tryAcquire(fingerprint);
    if (!releaseCredential) {
      releaseGlobal();
      sendError(
        res,
        429,
        id,
        'too many concurrent requests for this credential',
        APP_ERROR_CAPACITY,
      );
      return undefined;
    }
    const release = once(() => {
      releaseCredential();
      releaseGlobal();
    });
    res.once('close', release);
    res.once('finish', release);
    if (res.destroyed) {
      // The socket died between routing and admission.
      release();
      return undefined;
    }

    try {
      pendingMaterial.set(fingerprint, material);
      const entry = await credentials.get(fingerprint);
      return { entry, release };
    } catch (err) {
      release();
      if (err instanceof CredentialError) {
        handleCredentialError(res, err, id);
        return undefined;
      }
      const status =
        err instanceof HorizonError && err.statusCode >= 400
          ? err.statusCode
          : 502;
      sendError(
        res,
        status,
        id,
        status === 502 ? 'horizon unreachable' : 'authentication failed',
        APP_ERROR_CREDENTIAL,
      );
      return undefined;
    } finally {
      pendingMaterial.delete(fingerprint);
    }
  }

  // -- Express app ----------------------------------------------------------

  const app = express();
  app.disable('x-powered-by');

  function hostOk(req: Request): boolean {
    return isHostAllowed(headerStr(req.headers.host), config.allowedHosts);
  }

  // Health endpoints: unauthenticated, exempt from session/rate machinery,
  // still Host-validated.
  app.get('/healthz', ipLimiter, (req, res) => {
    if (!hostOk(req)) {
      res.status(421).json({ status: 'misdirected' });
      return;
    }
    res.status(200).json({ status: 'ok' });
  });

  app.get('/readyz', ipLimiter, async (req, res) => {
    if (!hostOk(req)) {
      res.status(421).json({ status: 'misdirected' });
      return;
    }
    res.status(200).json({ status: 'ready' });
  });

  const hostOriginGuard = (req: Request, res: Response, next: NextFunction) => {
    if (!hostOk(req)) {
      sendError(res, 421, null, 'host not allowed');
      return;
    }
    const origin = headerStr(req.headers.origin);
    if (!isOriginAllowed(origin, config.allowedOrigins)) {
      sendError(res, 403, null, 'origin not allowed');
      return;
    }
    for (const [k, v] of Object.entries(corsHeaders(origin, config))) {
      res.setHeader(k, v);
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };

  const methodGate = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') {
      // The 2025 session operations (GET SSE stream, DELETE teardown) are gone;
      // the modern endpoint accepts POST only. Answered here so probes never
      // reach body parsing or credential extraction, with the Allow header RFC
      // 9110 requires on a 405.
      res.setHeader('Allow', 'POST');
      sendError(res, 405, null, 'method not allowed');
      return;
    }
    next();
  };

  const jsonParser = express.json({ limit: settings.maxBodyBytes });

  app.all(
    config.path,
    ipLimiter,
    hostOriginGuard,
    methodGate,
    jsonParser,
    async (req: Request, res: Response) => {
      let release: (() => void) | undefined;
      try {
        // SDK 2.0.0 lenience compensation: a request that claims a modern
        // protocol version in its _meta but omits the MCP-Protocol-Version
        // header is accepted by the SDK, contra the transport spec's Server
        // Validation. Reject it here. Requests making no modern claim fall
        // through so `legacy: 'reject'` keeps answering -32022 with the
        // supported-versions list.
        const claim =
          req.body?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
        if (
          typeof claim === 'string' &&
          headerStr(req.headers['mcp-protocol-version']) === undefined
        ) {
          res.status(400).json({
            jsonrpc: '2.0',
            id: firstId(req.body),
            error: {
              code: -32020,
              message:
                'Bad Request: the body claims a protocol version but the required MCP-Protocol-Version header is absent',
              data: { mismatch: { header: '(missing)' } },
            },
          });
          return;
        }

        // Deliberately, a header-present-but-mismatched request with bad
        // credentials still gets 401 before -32020: the MUST mismatch check
        // applies only when the server processes the body, and an
        // unauthenticated request never does.
        const admitted = await admit(req, res);
        if (!admitted) return;
        release = admitted.release;

        // Scrub the captured secret headers from BOTH req.headers and
        // req.rawHeaders before the SDK reads them: @hono/node-server rebuilds
        // Web headers from the raw array.
        scrubSensitiveHeaders(req, sensitive);

        // Absolute lifetime cap. res.setTimeout() is an inactivity timer that every
        // SDK SSE keep-alive resets, so it can never bound a stream; this timer is
        // armed once at admission and cleared only by the response actually ending.
        const deadline = setTimeout(() => {
          logger.warning(
            `response exceeded ${settings.sseMaxDuration}s, closing it`,
          );
          res.destroy();
        }, settings.sseMaxDuration * 1000);
        deadline.unref?.();
        res.once('close', () => clearTimeout(deadline));

        // The parsed body MUST be passed explicitly. express.json() has already
        // consumed the stream, and toNodeHandler treats a function third
        // argument (Express's `next`) as absent rather than as a body, so
        // mounting this as bare middleware would hand the SDK an empty body.
        await requestCredential.run(admitted.entry, () =>
          nodeHandler(req, res, req.body),
        );
      } catch (err) {
        logger.error(`Unhandled HTTP error: ${err}`);
        if (!res.headersSent) {
          res
            .status(500)
            .json(jsonRpcErrorBody(null, -32603, 'internal error'));
        }
        release?.();
      }
    },
  );

  // Body-parser / size errors land here.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const tooLarge =
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.too.large';
    if (!res.headersSent) {
      res
        .status(tooLarge ? 413 : 400)
        .json(
          jsonRpcErrorBody(
            null,
            -32700,
            tooLarge ? 'request too large' : 'parse error',
          ),
        );
    }
  });

  // -- Listener -------------------------------------------------------------

  const httpServer: Server = config.mtls?.listener
    ? createHttpsServer(
        {
          cert: readFileSync(config.mtls.listener.certPath),
          key: readFileSync(config.mtls.listener.keyPath),
          requestCert: true,
          rejectUnauthorized: false, // optional_no_ca: prove possession, not chain
        },
        app,
      )
    : createHttpServer(app);

  // Slowloris guard on request headers. requestTimeout is disabled because it
  // bounds the time to receive the WHOLE request, which would kill long-lived
  // `subscriptions/listen` streams (up to sseMaxDuration) and slow tool calls
  // (CSV exports up to exportTimeout); the response side is bounded by the
  // absolute deadline in the request handler instead.
  // keepAliveTimeout sits a few seconds over the Node default.
  httpServer.headersTimeout = 60_000;
  httpServer.requestTimeout = 0;
  httpServer.keepAliveTimeout = 10_000;

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const boundPort =
    typeof address === 'object' && address ? address.port : config.port;

  // Expire cached credentials and bound the rate-limiter key maps.
  const sweepIntervalMs = Math.min(
    60_000,
    Math.max(1000, Math.floor(settings.credentialCacheTtl * 500)),
  );
  const sweeper = setInterval(() => {
    void credentials.sweep();
    credentialLimiter.prune();
  }, sweepIntervalMs);
  sweeper.unref?.();

  logger.info(
    `HTTP transport listening on ${config.host}:${boundPort}${config.path} ` +
      `(accepted auth: ${formatHttpAuthMethods(config.acceptedAuthMethods)}, ` +
      `public: ${config.publicEndpoint})`,
  );

  // Bound graceful shutdown: closeAllConnections() drops idle keep-alive
  // sockets that would otherwise keep httpServer.close() pending indefinitely,
  // and the race caps the drain so SIGTERM never hangs until SIGKILL.
  const closeTimeoutMs = options.closeTimeoutMs ?? 5000;
  let closePromise: Promise<void> | undefined;

  return {
    port: boundPort,
    url: config.publicEndpoint,
    async close() {
      if (!closePromise) {
        closePromise = (async () => {
          clearInterval(sweeper);
          const serverClosed = new Promise<void>((resolve) =>
            httpServer.close(() => resolve()),
          );
          // Stop accepting, then release the MCP handler and every cached
          // Horizon client concurrently, forcing existing sockets down.
          const drainedResources = (async () => {
            await handler.close().catch(() => undefined);
            await credentials.close();
          })();
          httpServer.closeAllConnections?.();
          const drained = Promise.all([serverClosed, drainedResources]).then(
            () => undefined,
          );
          const timeout = new Promise<void>((resolve) => {
            const t = setTimeout(resolve, closeTimeoutMs);
            t.unref?.();
          });
          await Promise.race([drained, timeout]);
        })();
      }
      await closePromise;
    },
  };
}
