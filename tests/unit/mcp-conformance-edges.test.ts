/**
 * MCP 2026-07-28 conformance edges beyond tests/unit/mcp-conformance.test.ts.
 *
 * Same methodology as the matrix: every expectation here was measured against
 * a running server before it was written, and where the SDK's behaviour
 * deviates from the specification (see the missing-version-header case) the
 * measured value is the asserted one, so a change in either direction is a
 * deliberate decision rather than a silent drift.
 *
 * Coverage added here:
 *  - the required Mcp-Name header (absence, not just mismatch)
 *  - stray Mcp-Param-* headers on a server that designates none
 *  - header/envelope protocol-version asymmetry in both directions
 *  - Origin validation and CORS preflight through the production stack
 *  - concurrency permits released when a client disconnects mid-request
 *  - the stdio transport speaking the stateless envelope from a real child
 *    process (the only committed coverage of stdio's modern path)
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock undici, the SERVER's Horizon client. The MCP client side uses global
// fetch, which is untouched, so real HTTP flows client -> server while Horizon
// itself is faked.
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

const { createMcpHandler } = await import('@modelcontextprotocol/server');
const { Client } = await import('@modelcontextprotocol/client');
const { StdioClientTransport, getDefaultEnvironment } = await import(
  '@modelcontextprotocol/client/stdio'
);
const { startHttpServer } = await import('../../src/http/server.js');
const { buildHttpConfig } = await import('../../src/http/config.js');
const { loadSettings } = await import('../../src/settings.js');
const { createSessionServer } = await import('../../src/server-factory.js');
const { HorizonClient } = await import('../../src/client/http.js');
const { ApiKeyAuthProvider } = await import('../../src/auth/apikey.js');

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

mockFetch.mockImplementation((url: unknown) => {
  const u = String(url);
  if (u.includes('/api/v1/security/principals/self')) {
    return Promise.resolve(
      fakeResponse(200, {
        identifier: 'alice',
        name: 'alice',
        _horizonVersion: '2.10.0',
      }),
    );
  }
  return Promise.resolve(fakeResponse(200, {}));
});

// -- constants --------------------------------------------------------------

const V = '2026-07-28';

const META = {
  version: 'io.modelcontextprotocol/protocolVersion',
  capabilities: 'io.modelcontextprotocol/clientCapabilities',
} as const;

const KNOWN_URI = 'horizon://knowledge/architecture';

function envelope(): Record<string, unknown> {
  return { [META.version]: V, [META.capabilities]: {} };
}

function body(
  method: string,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: { ...params, _meta: envelope() },
  };
}

function headers(method: string, name?: string): Record<string, string> {
  return {
    'MCP-Protocol-Version': V,
    'Mcp-Method': method,
    ...(name === undefined ? {} : { 'Mcp-Name': name }),
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolvePort(port));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// -- harnesses --------------------------------------------------------------

interface Reply {
  status: number;
  headers: Headers;
  json: any;
}

interface SendInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface Harness {
  name: string;
  send(init: SendInit): Promise<Reply>;
  close(): Promise<void>;
}

function requestInit(init: SendInit): RequestInit {
  return {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(init.headers ?? {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  };
}

async function parse(res: Response): Promise<Reply> {
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, json };
}

function inProcessHarness(): Harness {
  const client = new HorizonClient(
    'https://horizon.test',
    new ApiKeyAuthProvider('alice', 'k'),
    { verifySsl: false, timeout: 30, exportTimeout: 60 },
  );
  const handler = createMcpHandler(() => createSessionServer(client, {}), {
    legacy: 'reject',
    onerror: () => {},
  });
  return {
    name: 'in-process',
    async send(init) {
      const res = await handler.fetch(
        new Request('http://test.local/mcp', requestInit(init)),
      );
      return parse(res);
    },
    async close() {
      await handler.close().catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
}

async function startExpressServer(
  overrides: Record<string, string> = {},
): Promise<{ base: string; close(): Promise<void> }> {
  const port = await freePort();
  const env = {
    HORIZON_TRANSPORT: 'http',
    HORIZON_HTTP_AUTH_METHODS: 'api-key',
    HORIZON_URL: 'https://horizon.test',
    HORIZON_HTTP_HOST: '127.0.0.1',
    HORIZON_HTTP_PORT: String(port),
    HORIZON_TRUSTED_HOSTS: `127.0.0.1:${port},localhost:${port}`,
    HORIZON_VERIFY_SSL: 'false',
    HORIZON_RATE_LIMIT_RPS: '0',
    HORIZON_IP_RATE_LIMIT: '0',
    ...overrides,
  };
  const settings = loadSettings(env);
  const config = buildHttpConfig(settings, env);
  const handle = await startHttpServer(settings, config);
  return {
    base: `http://127.0.0.1:${handle.port}/mcp`,
    close: () => handle.close(),
  };
}

async function expressHarness(): Promise<Harness> {
  const server = await startExpressServer();
  return {
    name: 'express',
    async send(init) {
      const res = await fetch(
        server.base,
        requestInit({
          ...init,
          headers: {
            'X-API-ID': 'alice',
            'X-API-KEY': 'k',
            ...(init.headers ?? {}),
          },
        }),
      );
      return parse(res);
    },
    close: server.close,
  };
}

let harnesses: Harness[] = [];

beforeAll(async () => {
  harnesses = [inProcessHarness(), await expressHarness()];
  return async () => {
    for (const h of harnesses) await h.close();
  };
}, 60000);

async function bothHarnesses(
  check: (send: Harness['send'], harnessName: string) => Promise<void>,
): Promise<void> {
  for (const h of harnesses) {
    try {
      await check((init) => h.send(init), h.name);
    } catch (err) {
      throw new Error(
        `[${h.name} harness] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// -- required Mcp-Name header -----------------------------------------------

describe('required Mcp-Name header', () => {
  it('rejects tools/call without Mcp-Name with -32020', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', { name: 'whoami', arguments: {} }),
        headers: headers('tools/call'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
      expect(r.json.error.data.mismatch.header).toBe('(missing)');
    });
  }, 30000);

  it('rejects resources/read without Mcp-Name with -32020', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('resources/read', { uri: KNOWN_URI }),
        headers: headers('resources/read'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
      expect(r.json.error.data.mismatch.header).toBe('(missing)');
    });
  }, 30000);
});

// -- custom parameter headers -----------------------------------------------

describe('custom parameter headers', () => {
  it('ignores a stray Mcp-Param header when no tool designates one', async () => {
    // No tool in this server carries an x-mcp-header annotation, so a stray
    // Mcp-Param-* header is unrecognized and must be ignored, not validated.
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: { ...headers('tools/list'), 'Mcp-Param-Region': 'us-west1' },
      });
      expect(r.status).toBe(200);
      expect(r.json.result.tools.length).toBeGreaterThan(50);
    });
  }, 30000);
});

// -- header/envelope version asymmetry --------------------------------------

describe('header and envelope version asymmetry', () => {
  it('rejects a version header without the envelope key as -32602', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: { _meta: { [META.capabilities]: {} } },
        },
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32602);
      expect(r.json.error.data.envelope.missing).toEqual([META.version]);
    });
  }, 30000);

  it('accepts a complete envelope without the version header', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: { 'Mcp-Method': 'tools/list' },
      });
      // The 2026-07-28 transport spec says a modern-only server MUST reject a
      // request missing the MCP-Protocol-Version header (Server Validation),
      // but SDK 2.0.0 accepts it when the body envelope is complete; this test
      // pins the measured lenience so an SDK change in either direction is
      // caught deliberately.
      expect(r.status).toBe(200);
      expect(r.json.result.tools.length).toBeGreaterThan(50);
    });
  }, 30000);
});

// -- origin validation ------------------------------------------------------

describe('origin validation', () => {
  let server: Awaited<ReturnType<typeof startExpressServer>>;

  beforeAll(async () => {
    server = await startExpressServer({
      HORIZON_TRUSTED_ORIGINS: 'https://app.example.com',
    });
    return async () => {
      await server.close();
    };
  }, 60000);

  it('rejects an untrusted origin with a JSON-RPC error', async () => {
    const rejected = await fetch(
      server.base,
      requestInit({
        body: body('tools/list'),
        headers: {
          'X-API-ID': 'alice',
          'X-API-KEY': 'k',
          ...headers('tools/list'),
          Origin: 'https://evil.example.com',
        },
      }),
    );
    expect(rejected.status).toBe(403);
    const rejectedBody = (await rejected.json()) as {
      error: { code: number };
    };
    expect(rejectedBody.error.code).toBe(-32600);
  }, 30000);

  it('answers a trusted CORS preflight', async () => {
    const preflight = await fetch(
      server.base,
      requestInit({
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'https://app.example.com',
    );
    expect(preflight.headers.get('access-control-allow-methods')).toBe(
      'POST, OPTIONS',
    );
  }, 30000);

  it('allows a trusted origin and echoes it', async () => {
    const allowed = await fetch(
      server.base,
      requestInit({
        body: body('tools/list'),
        headers: {
          'X-API-ID': 'alice',
          'X-API-KEY': 'k',
          ...headers('tools/list'),
          Origin: 'https://app.example.com',
        },
      }),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'https://app.example.com',
    );
  }, 30000);
});

// -- disconnect releases capacity -------------------------------------------

describe('request permits are released on client disconnect', () => {
  it('serves the next request after an in-flight one is aborted', async () => {
    const server = await startExpressServer({
      HORIZON_MAX_CONCURRENT_REQUESTS: '1',
    });
    const creds = { 'X-API-ID': 'alice', 'X-API-KEY': 'k' };
    const original = mockFetch.getMockImplementation()!;
    try {
      // Warm the credential cache so admission of the slow request below is
      // instant and its permits are wired to the response before the abort.
      const warm = await fetch(
        server.base,
        requestInit({
          body: body('tools/list'),
          headers: { ...creds, ...headers('tools/list') },
        }),
      );
      expect(warm.status).toBe(200);
      await warm.text();

      // Make Horizon slow so the tools/call genuinely occupies the single
      // global permit, then abort it mid-flight.
      mockFetch.mockImplementation(async (url: unknown, init: unknown) => {
        await sleep(10000);
        return original(url, init);
      });
      const controller = new AbortController();
      const slow = fetch(server.base, {
        ...requestInit({
          body: body('tools/call', { name: 'whoami', arguments: {} }),
          headers: { ...creds, ...headers('tools/call', 'whoami') },
        }),
        signal: controller.signal,
      }).catch(() => undefined);
      await sleep(150);
      controller.abort();
      await slow;
      await sleep(300);
      mockFetch.mockImplementation(original);

      // Closing the response released the permit; without release-on-close
      // this would be 503 server at capacity.
      const next = await fetch(
        server.base,
        requestInit({
          body: body('tools/list'),
          headers: { ...creds, ...headers('tools/list') },
        }),
      );
      expect(next.status).toBe(200);
    } finally {
      mockFetch.mockImplementation(original);
      await server.close();
    }
  }, 30000);
});

// -- stdio transport --------------------------------------------------------

describe('stdio transport speaks the stateless 2026-07-28 envelope', () => {
  // These spawn the same entry point users run and talk over its real
  // stdin/stdout pipes; in-memory transports cannot prove the executable's
  // `legacy: 'reject'` path. Bun loads the Markdown knowledge assets that the
  // tsx dev runner cannot. Cold starts on a loaded machine are slow, hence
  // the generous timeout and retries.
  function stdioTransport() {
    return new StdioClientTransport({
      command: 'bun',
      args: [resolve(process.cwd(), 'src/index.ts')],
      cwd: process.cwd(),
      stderr: 'pipe',
      env: {
        ...getDefaultEnvironment(),
        HORIZON_TRANSPORT: 'stdio',
        HORIZON_URL: 'https://horizon.test',
        HORIZON_API_ID: 'alice',
        HORIZON_API_KEY: 'key',
        HORIZON_VERIFY_SSL: 'false',
        HORIZON_LOG_LEVEL: 'ERROR',
      },
    });
  }

  it(
    'negotiates server/discover and serves the catalog with resultType',
    { timeout: 30000, retry: 2 },
    async () => {
      const transport = stdioTransport();
      const client = new Client(
        { name: 'stdio-edges', version: '1.0.0' },
        { versionNegotiation: { mode: { pin: V } } },
      );
      try {
        await client.connect(transport);
        expect(client.getNegotiatedProtocolVersion()).toBe(V);

        // The client SDK routes on resultType and strips it from the parsed
        // result, so the modern envelope is proven by the pinned negotiation
        // plus the CacheableResult fields it does surface.
        const tools = await client.listTools({ cursor: '0' });
        expect(tools.ttlMs).toBe(3_600_000);
        expect(tools.cacheScope).toBe('public');
        expect(tools.tools.length).toBeGreaterThan(50);

        const resources = await client.listResources({ cursor: '0' });
        expect(resources.ttlMs).toBe(3_600_000);
        expect(resources.cacheScope).toBe('public');
        expect(resources.resources.length).toBeGreaterThan(0);
      } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      }
    },
  );

  it(
    'rejects the removed legacy initialize handshake',
    { timeout: 30000, retry: 2 },
    async () => {
      const transport = stdioTransport();
      const client = new Client(
        { name: 'stdio-edges-legacy', version: '1.0.0' },
        { versionNegotiation: { mode: 'legacy' } },
      );
      try {
        await expect(client.connect(transport)).rejects.toThrow(
          /protocol|version|unsupported/i,
        );
      } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      }
    },
  );
});
