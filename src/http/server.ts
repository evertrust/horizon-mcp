import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Server, createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import type { AuthProvider } from '../auth/base.js';
import { HorizonError } from '../client/errors.js';
import { HorizonClient } from '../client/http.js';
import { getLogger, runWithLoggingSink } from '../logging.js';
import { createSessionServer } from '../server-factory.js';
import type { HorizonSettings } from '../settings.js';
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

type TransportLike = {
  handleRequest(req: unknown, res: unknown, body?: unknown): Promise<void>;
};

type McpSink = (
  level: string,
  payload: { logger: string; msg: string; extra?: Record<string, unknown> },
) => void;

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

  const initLimiter = new RateLimiter(settings.initRateLimit);
  const sessionLimiter = new RateLimiter(settings.rateLimitRps);
  const sinks = new Map<string, McpSink>();

  const manager = new SessionManager({
    maxSessions: settings.maxSessions,
    idleTtlMs: settings.sessionIdleTtl * 1000,
    absTtlMs: settings.sessionAbsTtl * 1000,
    maxInflight: settings.maxInflightToolcalls,
    onTeardown: (sessionId) => {
      sessionLimiter.forget(sessionId);
      sinks.delete(sessionId);
    },
  });

  function makeSink(server: McpServer): McpSink {
    return (level, payload) => {
      void Promise.resolve()
        .then(() =>
          server.server.sendLoggingMessage({
            level: level as
              | 'debug'
              | 'info'
              | 'notice'
              | 'warning'
              | 'error'
              | 'critical'
              | 'alert'
              | 'emergency',
            logger: payload.logger,
            data: { msg: payload.msg, ...(payload.extra ?? {}) },
          }),
        )
        .catch(() => {
          // transport closing / client opted out - keep the log local only
        });
    };
  }

  function sendError(
    res: Response,
    status: number,
    id: JsonRpcId | undefined,
    message: string,
  ): void {
    if (!res.headersSent) {
      res.status(status).json(jsonRpcErrorBody(id, -32600, message));
    }
  }

  function handleCredentialError(
    res: Response,
    err: unknown,
    id: JsonRpcId | undefined,
  ): void {
    if (err instanceof CredentialError) {
      sendError(res, err.status, id, err.message);
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
    if (!fingerprint) return true; // service mode: no per-caller binding
    let material;
    try {
      material = extractCredential(req, config);
    } catch (err) {
      handleCredentialError(res, err, null);
      return false;
    }
    const fp = credentialFingerprintOf(material);
    if (!fp || !fingerprintsMatch(fp, fingerprint)) {
      sendError(res, 401, null, 'session credential does not match');
      return false;
    }
    return true;
  }

  async function dispatch(
    transport: TransportLike,
    sink: McpSink,
    req: Request,
    res: Response,
    body?: unknown,
  ): Promise<void> {
    // Scrub the captured secret headers from BOTH req.headers and
    // req.rawHeaders before the SDK (via @hono/node-server) reads them.
    scrubSensitiveHeaders(req, sensitive);
    await runWithLoggingSink(sink, () =>
      transport.handleRequest(req, res, body),
    );
  }

  async function handleInitialize(req: Request, res: Response): Promise<void> {
    const body: unknown = req.body;
    const valid = validateInitialize(body);
    if (!valid.ok) {
      sendError(res, 400, firstId(body), valid.reason);
      return;
    }

    const peer = req.socket.remoteAddress ?? 'unknown';
    if (!initLimiter.tryAcquireAll(['__global__', peer])) {
      sendError(res, 429, firstId(body), 'too many initialization attempts');
      return;
    }
    // Reserve capacity atomically: the session is only registered later, inside
    // onsessioninitialized, after the validateAuth + connect awaits below, so a
    // plain canCreate() check would let concurrent initializes overshoot.
    if (!manager.tryReserve()) {
      sendError(res, 503, firstId(body), 'maximum sessions reached');
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
        );
        return;
      }

      mcp = createSessionServer(client);
      // const aliases so the closure sees definitely-assigned values.
      const sessionClient = client;
      const sessionAuth = auth;
      const sessionMcp = mcp;
      const transport = new StreamableHTTPServerTransport({
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
          sinks.set(sessionId, makeSink(sessionMcp));
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

      await dispatch(
        transport as unknown as TransportLike,
        makeSink(mcp),
        req,
        res,
        body,
      );
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
    const record = manager.get(sessionId);
    if (!record) {
      sendError(res, 404, null, 'session not found');
      return;
    }
    if (!ensureFingerprintBinding(req, res, record.credentialFingerprint))
      return;

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
      sendError(res, 429, firstId(body), 'rate limit exceeded');
      return;
    }

    const isWork = methods.some(
      (m) => m !== 'initialize' && m !== 'notifications/initialized',
    );
    if (isWork) {
      if (!manager.reserveInflight(sessionId)) {
        sendError(res, 429, firstId(body), 'too many in-flight tool calls');
        return;
      }
      const release = once(() => manager.releaseInflight(sessionId));
      res.on('close', release);
      res.on('finish', release);
    }

    const sink =
      sinks.get(sessionId) ?? makeSink(record.server as unknown as McpServer);
    await dispatch(
      record.transport as unknown as TransportLike,
      sink,
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
    const record = manager.get(sessionId);
    if (!record) {
      sendError(res, 404, null, 'session not found');
      return;
    }
    if (!ensureFingerprintBinding(req, res, record.credentialFingerprint))
      return;

    if (req.method === 'GET') {
      res.setTimeout(settings.sseMaxDuration * 1000);
    }
    const sink =
      sinks.get(sessionId) ?? makeSink(record.server as unknown as McpServer);
    await dispatch(
      record.transport as unknown as TransportLike,
      sink,
      req,
      res,
    );
  }

  // -- Express app ----------------------------------------------------------

  const app = express();
  app.disable('x-powered-by');

  function hostOk(req: Request): boolean {
    return isHostAllowed(headerStr(req.headers.host), config.allowedHosts);
  }

  // Health endpoints: unauthenticated, exempt from session/rate machinery,
  // still Host-validated.
  app.get('/healthz', (req, res) => {
    if (!hostOk(req)) {
      res.status(421).json({ status: 'misdirected' });
      return;
    }
    res.status(200).json({ status: 'ok' });
  });

  app.get('/readyz', async (req, res) => {
    if (!hostOk(req)) {
      res.status(421).json({ status: 'misdirected' });
      return;
    }
    // Only service mode holds an env credential to probe Horizon with.
    if (config.authMode === 'service') {
      const { auth } = buildSessionAuth({ kind: 'service' }, config, settings);
      const probe = new HorizonClient(settings.url, auth, clientOptions);
      try {
        await probe.validateAuth();
      } catch {
        await probe.close().catch(() => undefined);
        await auth.cleanup().catch(() => undefined);
        res.status(503).json({ status: 'horizon-unreachable' });
        return;
      }
      await probe.close().catch(() => undefined);
      await auth.cleanup().catch(() => undefined);
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
      `(auth mode: ${config.authMode}, public: ${config.publicEndpoint})`,
  );

  return {
    port: boundPort,
    url: config.publicEndpoint,
    sessions: manager,
    async close() {
      clearInterval(sweeper);
      const closed = new Promise<void>((resolve) =>
        httpServer.close(() => resolve()),
      );
      await manager.shutdownAll();
      await closed;
    },
  };
}
