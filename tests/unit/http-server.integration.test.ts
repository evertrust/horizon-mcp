import { createServer } from 'node:http';
import { connect } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock undici (the SERVER's Horizon client). The MCP CLIENT transport uses the
// global fetch, which is untouched, so real HTTP flows client -> server while
// Horizon is faked. The faked whoami echoes the X-API-ID the session forwards.
const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
  Agent: class {
    close() {
      return Promise.resolve();
    }
  },
  FormData: class {
    append() {}
  },
}));

const { startHttpServer } = await import('../../src/http/server.js');
const { buildHttpConfig } = await import('../../src/http/config.js');
const { loadSettings } = await import('../../src/settings.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } =
  await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

function fakeResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    json: () =>
      Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    text: () => Promise.resolve(text),
    clone() {
      return fakeResponse(status, body);
    },
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Response;
}

function apiIdOf(init: unknown): string | undefined {
  const headers = (init as { headers?: Record<string, string> } | undefined)
    ?.headers;
  return headers?.['X-API-ID'] ?? headers?.['x-api-id'];
}

mockFetch.mockImplementation((url: unknown, init: unknown) => {
  const u = String(url);
  if (u.includes('/api/v1/security/csrf')) {
    return Promise.resolve(fakeResponse(200, { token: 'csrf' }));
  }
  if (u.includes('/api/v1/security/principals/self')) {
    const id = apiIdOf(init) ?? 'anonymous';
    return Promise.resolve(
      fakeResponse(200, {
        identifier: id,
        name: id,
        _horizonVersion: '2.10.0',
      }),
    );
  }
  return Promise.resolve(fakeResponse(200, {}));
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

interface ServerCtx {
  base: string;
  handle: Awaited<ReturnType<typeof startHttpServer>>;
}

async function startApiKeyServer(methods = 'api-key'): Promise<ServerCtx> {
  const port = await freePort();
  const env = {
    HORIZON_TRANSPORT: 'http',
    HORIZON_HTTP_AUTH_METHODS: methods,
    HORIZON_URL: 'https://horizon.example.com',
    HORIZON_HTTP_HOST: '127.0.0.1',
    HORIZON_HTTP_PORT: String(port),
    HORIZON_TRUSTED_HOSTS: `127.0.0.1:${port},localhost:${port}`,
    HORIZON_VERIFY_SSL: 'false',
  };
  const settings = loadSettings(env);
  const config = buildHttpConfig(settings, env);
  const handle = await startHttpServer(settings, config);
  return { base: `http://127.0.0.1:${handle.port}/mcp`, handle };
}

function makeClient(base: string, apiId?: string, apiKey?: string) {
  const headers: Record<string, string> = {};
  if (apiId) headers['X-API-ID'] = apiId;
  if (apiKey) headers['X-API-KEY'] = apiKey;
  const transport = new StreamableHTTPClientTransport(new URL(base), {
    requestInit: { headers },
  });
  const client = new Client({ name: 'itest', version: '0.0.0' });
  return { client, transport };
}

describe('HTTP server integration (api-key mode)', () => {
  let ctx: ServerCtx;
  const openClients: Array<{ close: () => Promise<void> }> = [];

  beforeEach(async () => {
    ctx = await startApiKeyServer();
  });

  afterEach(async () => {
    for (const c of openClients.splice(0)) {
      await c.close().catch(() => undefined);
    }
    await ctx.handle.close().catch(() => undefined);
  });

  it('completes initialize -> ready and exposes tools + knowledge resources', async () => {
    const { client, transport } = makeClient(ctx.base, 'alice', 'ka');
    openClients.push(client);
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === 'whoami')).toBe(true);
    expect(
      tools.tools.some((t) => t.name === 'create_certificate_profile'),
    ).toBe(true);

    const resources = await client.listResources();
    expect(
      resources.resources.some(
        (r) => r.uri === 'horizon://knowledge/server-rules',
      ),
    ).toBe(true);
  }, 20000);

  it('isolates two concurrent sessions with distinct identities', async () => {
    const a = makeClient(ctx.base, 'alice', 'ka');
    const b = makeClient(ctx.base, 'bob', 'kb');
    openClients.push(a.client, b.client);
    await Promise.all([
      a.client.connect(a.transport),
      b.client.connect(b.transport),
    ]);

    const [ra, rb] = await Promise.all([
      a.client.callTool({ name: 'whoami', arguments: {} }),
      b.client.callTool({ name: 'whoami', arguments: {} }),
    ]);

    expect((ra.structuredContent as { identifier: string }).identifier).toBe(
      'alice',
    );
    expect((rb.structuredContent as { identifier: string }).identifier).toBe(
      'bob',
    );
  }, 20000);

  it('rejects an initialize with no credential', async () => {
    const { client, transport } = makeClient(ctx.base);
    openClients.push(client);
    await expect(client.connect(transport)).rejects.toThrow();
  }, 20000);

  it('rejects a request that replays a session id with a different credential', async () => {
    const a = makeClient(ctx.base, 'alice', 'ka');
    openClients.push(a.client);
    await a.client.connect(a.transport);
    const sid = a.transport.sessionId!;
    expect(sid).toBeTruthy();

    // Forge a request: A's session id, B's credential -> must be rejected.
    const res = await fetch(ctx.base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': sid,
        'X-API-ID': 'bob',
        'X-API-KEY': 'kb',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    // The transport-level error echoes the request id and uses the server-error
    // code (-32000) rather than the generic invalid-request -32600.
    const err = (await res.json()) as {
      id: number;
      error: { code: number };
    };
    expect(err.id).toBe(99);
    expect(err.error.code).toBe(-32000);
  }, 20000);

  it('tears down all sessions on close', async () => {
    const a = makeClient(ctx.base, 'alice', 'ka');
    openClients.push(a.client);
    await a.client.connect(a.transport);
    expect(ctx.handle.sessions.size).toBe(1);

    await ctx.handle.close();
    expect(ctx.handle.sessions.size).toBe(0);
  }, 20000);
});

describe('HTTP server integration (service method rejects API keys)', () => {
  it('rejects a client that supplies its own API key in service mode', async () => {
    const port = await freePort();
    const env = {
      HORIZON_TRANSPORT: 'http',
      HORIZON_HTTP_AUTH_METHODS: 'service',
      HORIZON_URL: 'https://horizon.example.com',
      HORIZON_API_ID: 'service-acct',
      HORIZON_API_KEY: 'service-key',
      HORIZON_HTTP_HOST: '127.0.0.1',
      HORIZON_HTTP_PORT: String(port),
      HORIZON_TRUSTED_HOSTS: `127.0.0.1:${port}`,
      HORIZON_VERIFY_SSL: 'false',
    };
    const settings = loadSettings(env);
    const config = buildHttpConfig(settings, env);
    const handle = await startHttpServer(settings, config);
    const base = `http://127.0.0.1:${handle.port}/mcp`;
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': 'sneaky',
          'X-API-KEY': 'sneaky',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'x', version: '0' },
          },
        }),
      });
      expect(res.status).toBe(401);
    } finally {
      await handle.close();
    }
  }, 20000);
});

describe('HTTP server integration (no leak on a rejected initialize)', () => {
  it('releases the admission reservation when the SDK rejects a credentialed initialize', async () => {
    const port = await freePort();
    const env = {
      HORIZON_TRANSPORT: 'http',
      HORIZON_HTTP_AUTH_METHODS: 'api-key',
      HORIZON_URL: 'https://horizon.example.com',
      HORIZON_HTTP_HOST: '127.0.0.1',
      HORIZON_HTTP_PORT: String(port),
      HORIZON_TRUSTED_HOSTS: `127.0.0.1:${port},localhost:${port}`,
      HORIZON_MAX_SESSIONS: '2',
      HORIZON_VERIFY_SSL: 'false',
    };
    const settings = loadSettings(env);
    const config = buildHttpConfig(settings, env);
    const handle = await startHttpServer(settings, config);
    const base = `http://127.0.0.1:${handle.port}/mcp`;
    try {
      // Each body passes the local initialize check but fails the SDK JSON-RPC
      // schema (no jsonrpc/id), so onsessioninitialized never fires. Send more
      // than maxSessions: if the reservation leaked, these would exhaust the cap
      // and the valid client below would be locked out with a 503.
      for (let i = 0; i < 3; i++) {
        const res = await fetch(base, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'X-API-ID': 'alice',
            'X-API-KEY': 'ka',
          },
          body: JSON.stringify({ method: 'initialize' }),
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
      expect(handle.sessions.size).toBe(0);

      // The reservations were released, so a real client still connects.
      const a = makeClient(base, 'alice', 'ka');
      await a.client.connect(a.transport);
      expect(handle.sessions.size).toBe(1);
      await a.client.close().catch(() => undefined);
    } finally {
      await handle.close();
    }
  }, 20000);
});

describe('HTTP server integration (process readiness)', () => {
  it('reports readiness without an environment credential', async () => {
    const port = await freePort();
    const env = {
      HORIZON_TRANSPORT: 'http',
      HORIZON_HTTP_AUTH_METHODS: 'service',
      HORIZON_URL: 'https://horizon.example.com',
      HORIZON_API_ID: 'svc',
      HORIZON_API_KEY: 'k',
      HORIZON_HTTP_HOST: '127.0.0.1',
      HORIZON_HTTP_PORT: String(port),
      HORIZON_TRUSTED_HOSTS: `127.0.0.1:${port}`,
      HORIZON_VERIFY_SSL: 'false',
    };
    const settings = loadSettings(env);
    const config = buildHttpConfig(settings, env);
    const handle = await startHttpServer(settings, config);
    const base = `http://127.0.0.1:${handle.port}/readyz`;
    const probes = () =>
      mockFetch.mock.calls.filter((c) =>
        String(c[0]).includes('/api/v1/security/principals/self'),
      ).length;
    try {
      const before = probes();
      const r1 = await fetch(base);
      const r2 = await fetch(base);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      // HTTP credentials come from each caller.
      expect(probes() - before).toBe(0);
    } finally {
      await handle.close();
    }
  }, 20000);

  it('answers concurrent readiness requests without probing Horizon', async () => {
    const port = await freePort();
    const env = {
      HORIZON_TRANSPORT: 'http',
      HORIZON_HTTP_AUTH_METHODS: 'service',
      HORIZON_URL: 'https://horizon.example.com',
      HORIZON_API_ID: 'svc',
      HORIZON_API_KEY: 'k',
      HORIZON_HTTP_HOST: '127.0.0.1',
      HORIZON_HTTP_PORT: String(port),
      HORIZON_TRUSTED_HOSTS: `127.0.0.1:${port}`,
      HORIZON_VERIFY_SSL: 'false',
      HORIZON_IP_RATE_LIMIT: '0',
    };
    const settings = loadSettings(env);
    const config = buildHttpConfig(settings, env);
    const handle = await startHttpServer(settings, config);
    const base = `http://127.0.0.1:${handle.port}/readyz`;
    const probes = () =>
      mockFetch.mock.calls.filter((c) =>
        String(c[0]).includes('/api/v1/security/principals/self'),
      ).length;
    try {
      const before = probes();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => fetch(base)),
      );
      for (const r of results) expect(r.status).toBe(200);
      // Readiness does not use the environment identity.
      expect(probes() - before).toBe(0);
    } finally {
      await handle.close();
    }
  }, 20000);
});

describe('HTTP server integration (graceful shutdown)', () => {
  it('resolves close() promptly despite a lingering idle keep-alive socket', async () => {
    const ctx = await startApiKeyServer();
    const sock = connect(ctx.handle.port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      sock.once('connect', () => resolve());
      sock.once('error', reject);
    });
    try {
      const start = Date.now();
      await ctx.handle.close();
      // Without closeAllConnections()/timeout, close() would hang on the idle
      // socket until SIGKILL; the bounded drain keeps it well under the cap.
      expect(Date.now() - start).toBeLessThan(2000);
    } finally {
      sock.destroy();
    }
  }, 20000);
});

function serviceJwt(expiresIn: number): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode({ iss: 'https://issuer.example.com', exp: Math.floor(Date.now() / 1000) + expiresIn })}.signature`;
}

describe('HTTP service-account sessions', () => {
  let ctx: ServerCtx;
  let client: InstanceType<typeof Client>;
  let transport: InstanceType<typeof StreamableHTTPClientTransport>;
  let headers: Record<string, string>;
  let renewed: string;
  let idpFetch: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    ctx = await startApiKeyServer('api-key,service');
    headers = {
      'X-API-SVA': 'automation',
      'X-API-TOKEN': serviceJwt(30),
      'X-OAUTH-CLIENT-ID': 'oauth-client',
      'X-OAUTH-CLIENT-SECRET': 'private-oauth-secret',
      'X-OAUTH-SCOPE': 'horizon.read',
      'X-OAUTH-AUDIENCE': 'horizon-api',
    };
    renewed = serviceJwt(3600);
    const realFetch = globalThis.fetch;
    idpFetch = vi.fn().mockImplementation((url: unknown) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(url).endsWith('openid-configuration')
              ? {
                  issuer: 'https://issuer.example.com',
                  token_endpoint: 'https://issuer.example.com/token',
                }
              : { access_token: renewed },
          ),
          { status: 200 },
        ),
      ),
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      String(input).startsWith('https://issuer.example.com')
        ? idpFetch(input, init)
        : realFetch(input, init),
    );
    log = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    transport = new StreamableHTTPClientTransport(new URL(ctx.base), {
      requestInit: { headers },
    });
    client = new Client({ name: 'service-test', version: '0.0.0' });
  });

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await ctx?.handle.close().catch(() => undefined);
    vi.restoreAllMocks();
  });

  it('renews after initialization and keeps the original session credential binding', async () => {
    await client.connect(transport);
    expect(idpFetch).not.toHaveBeenCalled();
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(idpFetch).toHaveBeenCalledTimes(2);
    const upstream = mockFetch.mock.calls.at(-1)?.[1] as {
      headers: Record<string, string>;
    };
    expect(upstream.headers['X-API-TOKEN']).toBe(renewed);
    expect(upstream.headers['X-OAUTH-CLIENT-SECRET']).toBeUndefined();
    expect(
      (await client.listTools()).tools.some((tool) => tool.name === 'whoami'),
    ).toBe(true);
    expect(log).toHaveBeenCalled();
    for (const secret of [
      headers['X-API-TOKEN']!,
      headers['X-OAUTH-CLIENT-SECRET']!,
      renewed,
    ]) {
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    }
    await transport.terminateSession();
    expect(ctx.handle.sessions.size).toBe(0);
  }, 20000);

  it.each([
    'X-API-SVA',
    'X-API-TOKEN',
    'X-OAUTH-CLIENT-ID',
    'X-OAUTH-CLIENT-SECRET',
    'X-OAUTH-SCOPE',
    'X-OAUTH-AUDIENCE',
  ])(
    'rejects a changed %s on POST, GET and DELETE without using Horizon',
    async (name) => {
      await client.connect(transport);
      const before = mockFetch.mock.calls.length;
      for (const method of ['POST', 'GET', 'DELETE']) {
        const response = await fetch(ctx.base, {
          method,
          headers: {
            ...headers,
            [name]: 'different-credential',
            'Mcp-Session-Id': transport.sessionId!,
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
          },
          ...(method === 'POST'
            ? {
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 99,
                  method: 'tools/list',
                }),
              }
            : {}),
        });
        expect(response.status).toBe(401);
        expect(response.headers.get('WWW-Authenticate')).toBe(
          'Horizon methods="api-key,service"',
        );
        const body = await response.text();
        expect(body).toContain('session credential does not match');
        expect(body).not.toContain(headers['X-API-TOKEN']);
        expect(body).not.toContain(headers['X-OAUTH-CLIENT-SECRET']);
        expect(ctx.handle.sessions.size).toBe(1);
      }
      expect(mockFetch.mock.calls.length).toBe(before);
    },
    20000,
  );
});
