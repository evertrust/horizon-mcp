import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { McpServer } from '@modelcontextprotocol/server';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Server, createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import type { AuthProvider } from '../auth/base.js';
import { HorizonError } from '../client/errors.js';
import { HorizonClient } from '../client/http.js';
import { getLogger } from '../logging.js';
import { createSessionServer } from '../server-factory.js';
import type { HorizonSettings } from '../settings.js';
import { formatHttpAuthMethods } from './auth-methods.js';
import type { HttpConfig } from './config.js';
import {
  CredentialError,
  buildSessionAuth,
  credentialFingerprintOf,
  extractCredential,
} from './credentials.js';
import {
  credentialFingerprint,
  fingerprintsMatch,
  shortFingerprint,
} from './fingerprint.js';
import { buildSensitiveHeaderSet, scrubSensitiveHeaders } from './headers.js';
import {
  type JsonRpcId,
  firstId,
  jsonRpcErrorBody,
  messagesOf,
  methodsOf,
  validateInitialize,
} from './jsonrpc.js';
import { corsHeaders, isHostAllowed, isOriginAllowed } from './middleware.js';
import { RateLimiter } from './rate-limit.js';
import { SessionManager } from './session-manager.js';

const logger = getLogger('horizon_mcp.http');

export interface HttpServerHandle {
  port: number;
  url: string;
  sessions: SessionManager;
  close(): Promise<void>;
}

export interface HttpServerOptions {
  /** Primarily injectable so shutdown behavior can be tested quickly. */
  closeTimeoutMs?: number;
}

type TransportLike = {
  handleRequest(req: unknown, res: unknown, body?: unknown): Promise<void>;
};

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

  // The init limiter enforces a per-remote-address cap AND an aggregate cap via
  // a shared '__global__' key. Give the global key a higher ceiling (a multiple
  // of the per-peer limit) so a single peer stays capped while total server
  // throughput is not artificially pinned to one peer's budget.
  const GLOBAL_INIT_KEY = '__global__';
  const GLOBAL_INIT_MULTIPLIER = 4;
  const initLimiter = new RateLimiter(settings.initRateLimit, undefined, {
    [GLOBAL_INIT_KEY]: settings.initRateLimit * GLOBAL_INIT_MULTIPLIER,
  });
  const sessionLimiter = new RateLimiter(settings.rateLimitRps);

  // Coarse per-IP backstop (defense-in-depth in front of the fine-grained init
  // and per-session limiters). Keyed by the socket peer (Express trust proxy
  // stays off); HORIZON_IP_RATE_LIMIT=0 disables it.
  const ipLimiter = rateLimit({
    windowMs: 1000,
    limit: settings.ipRateLimit > 0 ? settings.ipRateLimit : 1,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => settings.ipRateLimit <= 0,
    validate: false,
  });

  const manager = new SessionManager({
    maxSessions: settings.maxSessions,
    idleTtlMs: settings.sessionIdleTtl * 1000,
    absTtlMs: settings.sessionAbsTtl * 1000,
    maxInflight: settings.maxInflightToolcalls,
    onTeardown: (sessionId) => {
      sessionLimiter.forget(sessionId);
    },
  });

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

  // Verify the resent credential still matches the session (anti-hijack).
  // Returns true to continue, false after sending an error response.
  function ensureFingerprintBinding(
    req: Request,
    res: Response,
    fingerprint: string | undefined,
  ): boolean {
    if (!fingerprint) return true;
    const id = firstId(req.body);
    let material;
    try {
      material = extractCredential(req, config);
    } catch (err) {
      handleCredentialError(res, err, id);
      return false;
    }
    const fp = credentialFingerprintOf(material);
    if (!fp || !fingerprintsMatch(fp, fingerprint)) {
      sendError(
        res,
        401,
        id,
        'session credential does not match',
        APP_ERROR_CREDENTIAL,
      );
      return false;
    }
    return true;
  }

  async function dispatch(
    transport: TransportLike,
    req: Request,
    res: Response,
    body?: unknown,
  ): Promise<void> {
    // Scrub the captured secret headers from BOTH req.headers and
    // req.rawHeaders before the SDK (via @hono/node-server) reads them.
    scrubSensitiveHeaders(req, sensitive);
    await transport.handleRequest(req, res, body);
  }

  async function handleInitialize(req: Request, res: Response): Promise<void> {
    const body: unknown = req.body;
    const valid = validateInitialize(body);
    if (!valid.ok) {
      sendError(res, 400, firstId(body), valid.reason);
      return;
    }

    const peer = req.socket.remoteAddress ?? 'unknown';
    if (!initLimiter.tryAcquireAll([GLOBAL_INIT_KEY, peer])) {
      sendError(
        res,
        429,
        firstId(body),
        'too many initialization attempts',
        APP_ERROR_RATE_LIMITED,
      );
      return;
    }
    // Reserve capacity atomically: the session is only registered later, inside
    // onsessioninitialized, after the validateAuth + connect awaits below, so a
    // plain canCreate() check would let concurrent initializes overshoot.
    if (!manager.tryReserve()) {
      sendError(
        res,
        503,
        firstId(body),
        'maximum sessions reached',
        APP_ERROR_CAPACITY,
      );
      return;
    }

    // Own every resource until the session is registered. If the SDK rejects the
    // initialize (e.g. a credentialed body that fails JSONRPCMessageSchema),
    // onsessioninitialized never fires and the session is never tracked, so the
    // finally below must release the reservation and close the orphans.
    let registered = false;
    let client: HorizonClient | undefined;
    let auth: AuthProvider | undefined;
    let mcp: McpServer | undefined;
    try {
      let material;
      try {
        material = extractCredential(req, config);
      } catch (err) {
        handleCredentialError(res, err, firstId(body));
        return;
      }

      const built = buildSessionAuth(material, config, settings);
      auth = built.auth;
      const fingerprint = built.fingerprint;
      client = new HorizonClient(settings.url, auth, clientOptions);
      try {
        await client.validateAuth();
        auth.markValidated();
      } catch (err) {
        const status =
          err instanceof HorizonError && err.statusCode >= 400
            ? err.statusCode
            : 502;
        sendError(
          res,
          status,
          firstId(body),
          status === 502 ? 'horizon unreachable' : 'authentication failed',
          APP_ERROR_CREDENTIAL,
        );
        return;
      }

      mcp = createSessionServer(client, {
        enabledToolsets: settings.enabledToolsets,
        readOnly: settings.readOnly,
      });
      // const aliases so the closure sees definitely-assigned values.
      const sessionClient = client;
      const sessionAuth = auth;
      const sessionMcp = mcp;
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          manager.create({
            sessionId,
            server: sessionMcp,
            transport,
            client: sessionClient,
            auth: sessionAuth,
            credentialFingerprint: fingerprint,
          });
          registered = true;
          logger.info('session initialized', {
            session: shortFingerprint(credentialFingerprint(sessionId)),
          });
        },
        onsessionclosed: (sessionId) => {
          void manager.handleSessionClosed(sessionId);
        },
      });
      mcp.server.oninitialized = () => {
        const sid = transport.sessionId;
        if (sid) manager.markReady(sid);
      };
      await mcp.connect(transport);

      await dispatch(transport as unknown as TransportLike, req, res, body);
    } finally {
      if (!registered) {
        manager.releaseReservation();
        // server.close() cascades to the transport in SDK 1.29.0.
        if (mcp) await mcp.close().catch(() => undefined);
        if (client) await client.close().catch(() => undefined);
        if (auth) await auth.cleanup().catch(() => undefined);
      }
    }
  }

  async function handleExistingPost(
    req: Request,
    res: Response,
    sessionId: string,
  ): Promise<void> {
    // Look up WITHOUT refreshing the idle timer: only an authenticated caller
    // (fingerprint check below) should keep the session alive.
    const record = manager.peek(sessionId);
    if (!record) {
      sendError(res, 404, firstId(req.body), 'session not found');
      return;
    }
    if (!ensureFingerprintBinding(req, res, record.credentialFingerprint))
      return;
    manager.touch(sessionId);

    const body: unknown = req.body;
    const methods = methodsOf(body);

    if (record.state === 'initializing') {
      const handshakeOnly = methods.every(
        (m) => m === 'initialize' || m === 'notifications/initialized',
      );
      if (!handshakeOnly) {
        sendError(res, 409, firstId(body), 'session is not ready');
        return;
      }
    }

    // Rate limit is charged per JSON-RPC message (a batch of N costs N),
    // including method-less messages such as responses/notifications.
    const messageCount = messagesOf(body).length;
    if (
      messageCount > 0 &&
      !sessionLimiter.tryAcquire(sessionId, messageCount)
    ) {
      sendError(
        res,
        429,
        firstId(body),
        'rate limit exceeded',
        APP_ERROR_RATE_LIMITED,
      );
      return;
    }

    const workCount = methods.filter(
      (m) => m !== 'initialize' && m !== 'notifications/initialized',
    ).length;
    if (workCount > 0) {
      if (!manager.reserveInflight(sessionId, workCount)) {
        sendError(
          res,
          429,
          firstId(body),
          'too many in-flight tool calls',
          APP_ERROR_CAPACITY,
        );
        return;
      }
      const release = once(() => manager.releaseInflight(sessionId, workCount));
      res.on('close', release);
      res.on('finish', release);
    }

    await dispatch(
      record.transport as unknown as TransportLike,
      req,
      res,
      body,
    );
  }

  async function handleSessionStream(
    req: Request,
    res: Response,
  ): Promise<void> {
    const sessionId = headerStr(req.headers['mcp-session-id']);
    if (!sessionId) {
      sendError(res, 400, null, 'missing Mcp-Session-Id');
      return;
    }
    // Authenticate before refreshing the idle timer. Otherwise an attacker who
    // knows a session id can keep it alive indefinitely with bad credentials.
    const record = manager.peek(sessionId);
    if (!record) {
      sendError(res, 404, null, 'session not found');
      return;
    }
    if (!ensureFingerprintBinding(req, res, record.credentialFingerprint))
      return;
    manager.touch(sessionId);

    if (req.method === 'GET') {
      res.setTimeout(settings.sseMaxDuration * 1000);
      // A standalone SSE stream refreshes lastSeenAt only at open; count it as
      // an active stream so the idle sweep does not reap the live connection.
      manager.addStream(sessionId);
      const release = once(() => manager.removeStream(sessionId));
      res.on('close', release);
      res.on('finish', release);
    }
    await dispatch(record.transport as unknown as TransportLike, req, res);
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

  const jsonParser = express.json({ limit: settings.maxBodyBytes });

  app.all(
    config.path,
    ipLimiter,
    hostOriginGuard,
    jsonParser,
    async (req: Request, res: Response) => {
      try {
        if (req.method === 'POST') {
          const sessionId = headerStr(req.headers['mcp-session-id']);
          if (sessionId) {
            await handleExistingPost(req, res, sessionId);
          } else {
            await handleInitialize(req, res);
          }
          return;
        }
        if (req.method === 'GET' || req.method === 'DELETE') {
          await handleSessionStream(req, res);
          return;
        }
        sendError(res, 405, null, 'method not allowed');
      } catch (err) {
        logger.error(`Unhandled HTTP error: ${err}`);
        if (!res.headersSent) {
          res
            .status(500)
            .json(jsonRpcErrorBody(null, -32603, 'internal error'));
        }
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
  // SSE GET streams (up to sseMaxDuration) and slow tool calls (CSV exports up
  // to exportTimeout); the response side is bounded by res.setTimeout instead.
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

  const sweepIntervalMs = Math.min(
    60_000,
    Math.max(
      1000,
      Math.floor(
        Math.min(settings.sessionIdleTtl, settings.sessionAbsTtl) * 500,
      ),
    ),
  );
  const sweeper = setInterval(() => {
    void manager.sweepExpired();
    // Bound the rate-limiter key maps (e.g. the per-remote-address init limiter).
    initLimiter.prune();
    sessionLimiter.prune();
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
    sessions: manager,
    async close() {
      if (!closePromise) {
        closePromise = (async () => {
          clearInterval(sweeper);
          const serverClosed = new Promise<void>((resolve) =>
            httpServer.close(() => resolve()),
          );
          // Start session teardown concurrently and force existing sockets down.
          const sessionsClosed = manager.shutdownAll();
          httpServer.closeAllConnections?.();
          const drained = Promise.all([serverClosed, sessionsClosed]).then(
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
