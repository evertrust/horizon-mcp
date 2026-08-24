/**
 * MCP 2026-07-28 protocol conformance matrix.
 *
 * Every expectation here was measured against a running server before it was
 * written, not inferred from the specification. Where the SDK's behaviour is
 * surprising (see the base64 sentinel and the JSON-RPC-layer resource errors)
 * the surprising value is the asserted one.
 *
 * The matrix runs twice: once in-process through `handler.fetch`, and once
 * through the production Express stack. Both are required. Phase 2 of this
 * migration hit a bug class where the parsed body never reached the SDK, and
 * that is invisible in-process because it only manifests once express.json()
 * has already consumed the stream.
 */
import { createServer } from 'node:http';
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
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  logLevel: 'io.modelcontextprotocol/logLevel',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
  subscriptionId: 'io.modelcontextprotocol/subscriptionId',
} as const;

/** A knowledge resource that is always registered. */
const KNOWN_URI = 'horizon://knowledge/architecture';

function envelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [META.version]: V,
    [META.capabilities]: {},
    [META.clientInfo]: { name: 'conformance', version: '1.0.0' },
    ...over,
  };
}

function body(
  method: string,
  params: Record<string, unknown> = {},
  metaOver: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: { ...params, _meta: envelope(metaOver) },
  };
}

function headers(method: string, name?: string): Record<string, string> {
  return {
    'MCP-Protocol-Version': V,
    'Mcp-Method': method,
    ...(name === undefined ? {} : { 'Mcp-Name': name }),
  };
}

// -- harnesses --------------------------------------------------------------

interface Reply {
  status: number;
  headers: Headers;
  text: string;
  json: any;
}

interface Send {
  (init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    contentType?: string | null;
    accept?: string;
  }): Promise<Reply>;
}

interface Harness {
  name: string;
  send: Send;
  close(): Promise<void>;
}

/**
 * Read a bounded prefix of a response body.
 *
 * A `subscriptions/listen` stream stays open indefinitely, so `res.text()`
 * would never resolve. Reading a capped prefix and then cancelling gives us
 * the acknowledgement frame without hanging the suite.
 */
async function readPrefix(res: Response, limit = 2048): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const timer = setTimeout(
    () => void reader.cancel().catch(() => undefined),
    3000,
  );
  try {
    while (seen.length < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
      if (seen.includes('\n\n')) break;
    }
  } catch {
    // cancelled by the timer
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
  return seen;
}

async function parse(res: Response, streaming = false): Promise<Reply> {
  const text = streaming ? await readPrefix(res) : await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

function buildRequestInit(init: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  contentType?: string | null;
  accept?: string;
}): RequestInit {
  const h: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.contentType !== null) {
    h['Content-Type'] = init.contentType ?? 'application/json';
  }
  if (init.accept) h.Accept = init.accept;
  const method = init.method ?? 'POST';
  const hasBody = init.body !== undefined && method !== 'GET';
  return {
    method,
    headers: h,
    ...(hasBody
      ? {
          body:
            typeof init.body === 'string'
              ? init.body
              : JSON.stringify(init.body),
        }
      : {}),
  };
}

/** In-process: straight at the SDK handler, no Express, no network. */
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
        new Request('http://test.local/mcp', buildRequestInit(init)),
      );
      return parse(res, init.accept === 'text/event-stream');
    },
    async close() {
      await handler.close().catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
}

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

/** Through the real Express stack, over a real socket. */
async function expressHarness(): Promise<Harness> {
  const port = await freePort();
  const env = {
    HORIZON_TRANSPORT: 'http',
    HORIZON_HTTP_AUTH_METHODS: 'api-key',
    HORIZON_URL: 'https://horizon.test',
    HORIZON_HTTP_HOST: '127.0.0.1',
    HORIZON_HTTP_PORT: String(port),
    HORIZON_TRUSTED_HOSTS: `127.0.0.1:${port},localhost:${port}`,
    HORIZON_VERIFY_SSL: 'false',
    // The matrix fires far more than 20 requests per second from one
    // credential. Rate limiting is exercised in http-server.integration, not
    // here, so switch both limiters off rather than pace the protocol tests.
    HORIZON_RATE_LIMIT_RPS: '0',
    HORIZON_IP_RATE_LIMIT: '0',
  };
  const settings = loadSettings(env);
  const config = buildHttpConfig(settings, env);
  const handle = await startHttpServer(settings, config);
  const base = `http://127.0.0.1:${handle.port}/mcp`;
  return {
    name: 'express',
    async send(init) {
      const withCreds = {
        ...init,
        headers: {
          'X-API-ID': 'alice',
          'X-API-KEY': 'k',
          ...(init.headers ?? {}),
        },
      };
      const res = await fetch(base, buildRequestInit(withCreds));
      return parse(res, init.accept === 'text/event-stream');
    },
    async close() {
      await handle.close();
    },
  };
}

// -- the matrix -------------------------------------------------------------

let harnesses: Harness[] = [];

beforeAll(async () => {
  harnesses = [inProcessHarness(), await expressHarness()];
  return async () => {
    for (const h of harnesses) await h.close();
  };
}, 60000);

/** Run one assertion against both harnesses, naming the failing one. */
async function bothHarnesses(
  check: (send: Send, harnessName: string) => Promise<void>,
): Promise<void> {
  for (const h of harnesses) {
    try {
      await check(h.send, h.name);
    } catch (err) {
      throw new Error(
        `[${h.name} harness] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

describe('cacheable operations carry hints, resultType, and serverInfo', () => {
  const cases = [
    { method: 'server/discover', ttlMs: 3_600_000 },
    { method: 'tools/list', ttlMs: 3_600_000 },
    { method: 'resources/list', ttlMs: 3_600_000 },
    { method: 'resources/templates/list', ttlMs: 3_600_000 },
  ];

  for (const c of cases) {
    it(`${c.method} advertises ttlMs ${c.ttlMs} and public scope`, async () => {
      await bothHarnesses(async (send) => {
        const r = await send({
          body: body(c.method),
          headers: headers(c.method),
        });
        expect(r.status, `${c.method} status`).toBe(200);
        const result = r.json?.result;
        expect(result, `${c.method} result`).toBeDefined();
        expect(result.resultType).toBe('complete');
        expect(result.ttlMs).toBe(c.ttlMs);
        expect(result.cacheScope).toBe('public');
        expect(result._meta?.[META.serverInfo]?.name).toBeTruthy();
      });
    }, 30000);
  }

  it('resources/read caches for a day', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('resources/read', { uri: KNOWN_URI }),
        headers: headers('resources/read', KNOWN_URI),
      });
      expect(r.status).toBe(200);
      expect(r.json.result.resultType).toBe('complete');
      expect(r.json.result.ttlMs).toBe(86_400_000);
      expect(r.json.result.cacheScope).toBe('public');
    });
  }, 30000);

  it('tools/call carries resultType but no cache hints', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', { name: 'whoami', arguments: {} }),
        headers: headers('tools/call', 'whoami'),
      });
      expect(r.status).toBe(200);
      const result = r.json.result;
      expect(result.resultType).toBe('complete');
      expect(result._meta?.[META.serverInfo]).toBeDefined();
      // A tool call is not a cacheable operation, so it must not be labelled
      // as one. A stray ttlMs here would let a proxy replay a mutation.
      expect(result).not.toHaveProperty('ttlMs');
      expect(result).not.toHaveProperty('cacheScope');
    });
  }, 30000);
});

describe('_meta envelope validation', () => {
  it('rejects a missing clientCapabilities with -32602', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              [META.version]: V,
              [META.clientInfo]: { name: 'c', version: '1' },
            },
          },
        },
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32602);
      expect(r.json.error.message).toContain('Invalid _meta envelope');
      expect(r.json.error.data.envelope).toEqual({
        key: META.capabilities,
        problem: 'missing',
      });
    });
  }, 30000);

  it('accepts a missing clientInfo, which is optional', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: { _meta: { [META.version]: V, [META.capabilities]: {} } },
        },
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(200);
      expect(r.json.result.tools.length).toBeGreaterThan(50);
    });
  }, 30000);

  it('rejects a request naming no protocol version at all', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: { jsonrpc: '2.0', id: 1, method: 'server/discover' },
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32022);
      expect(r.json.error.data.supported).toEqual([V]);
    });
  }, 30000);
});

describe('version negotiation is modern-only', () => {
  for (const old of ['2025-11-25', '2025-06-18']) {
    it(`rejects ${old} with -32022 listing what is supported`, async () => {
      await bothHarnesses(async (send) => {
        const r = await send({
          body: body('tools/list', {}, { [META.version]: old }),
          headers: { 'MCP-Protocol-Version': old, 'Mcp-Method': 'tools/list' },
        });
        expect(r.status).toBe(400);
        expect(r.json.error.code).toBe(-32022);
        expect(r.json.error.data.supported).toEqual([V]);
        expect(r.json.error.data.requested).toBe(old);
      });
    }, 30000);
  }

  it('rejects the removed initialize handshake', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'legacy', version: '1' },
          },
        },
      });
      // Rejected on the version, not on the method: a 2025 client never gets
      // far enough for `initialize` to be reported as unknown.
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32022);
    });
  }, 30000);
});

describe('headers and body must agree, all -32020', () => {
  it('detects a method mismatch', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('resources/list'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
      expect(r.json.error.data.mismatch.header).toBe('resources/list');
    });
  }, 30000);

  it('detects an Mcp-Name mismatch on tools/call', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', { name: 'whoami', arguments: {} }),
        headers: headers('tools/call', 'wrongname'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
      expect(r.json.error.data.mismatch.header).toBe('wrongname');
    });
  }, 30000);

  it('rejects an absent Mcp-Method header', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: { 'MCP-Protocol-Version': V },
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
      expect(r.json.error.data.mismatch.header).toBe('(missing)');
    });
  }, 30000);

  it('treats a header/body version disagreement as a mismatch, not a version error', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: {
          'MCP-Protocol-Version': '2025-11-25',
          'Mcp-Method': 'tools/list',
        },
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
    });
  }, 30000);
});

describe('Mcp-Name base64 sentinel', () => {
  const encoded = `=?base64?${Buffer.from(KNOWN_URI, 'utf8').toString('base64')}?=`;

  it('decodes the sentinel before comparing', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('resources/read', { uri: KNOWN_URI }),
        headers: headers('resources/read', encoded),
      });
      expect(r.status).toBe(200);
    });
  }, 30000);

  it('accepts the plain unencoded URI too', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('resources/read', { uri: KNOWN_URI }),
        headers: headers('resources/read', KNOWN_URI),
      });
      expect(r.status).toBe(200);
    });
  }, 30000);

  it('does NOT decode an RFC 2047 encoded-word', async () => {
    // The sentinel is literally `=?base64?...?=`. An RFC 2047 charset form is
    // not a sentinel and must be compared literally. This case exists so a
    // future SDK that silently broadens the decoding is caught here rather
    // than in production.
    const rfc2047 = `=?utf-8?B?${Buffer.from(KNOWN_URI, 'utf8').toString('base64')}?=`;
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('resources/read', { uri: KNOWN_URI }),
        headers: headers('resources/read', rfc2047),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
    });
  }, 30000);
});

describe('surfaces removed in 2026-07-28 are gone', () => {
  const removed = [
    'ping',
    'logging/setLevel',
    'resources/subscribe',
    'resources/unsubscribe',
    'sampling/createMessage',
    'elicitation/create',
    'roots/list',
    'tasks/list',
    'notifications/initialized',
    'nonexistent/method',
  ];

  for (const method of removed) {
    it(`${method} answers 404 / -32601`, async () => {
      await bothHarnesses(async (send) => {
        const r = await send({
          body: body(method),
          headers: headers(method),
        });
        expect(r.status).toBe(404);
        expect(r.json.error.code).toBe(-32601);
      });
    }, 30000);
  }

  it('prompts/list is unsupported: no prompts capability is registered', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('prompts/list'),
        headers: headers('prompts/list'),
      });
      expect(r.status).toBe(404);
      expect(r.json.error.code).toBe(-32601);
    });
  }, 30000);
});

describe('transport', () => {
  for (const method of ['GET', 'DELETE', 'PUT', 'PATCH']) {
    it(`answers 405 to ${method}`, async () => {
      await bothHarnesses(async (send) => {
        const r = await send({ method, headers: headers('tools/list') });
        expect(r.status).toBe(405);
      });
    }, 30000);
  }

  it('answers 415 to a non-JSON Content-Type', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('tools/list'),
        contentType: 'text/plain',
      });
      expect(r.status).toBe(415);
    });
  }, 30000);

  it('answers 415 when Content-Type is absent', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('tools/list'),
        contentType: null,
      });
      expect(r.status).toBe(415);
    });
  }, 30000);

  it('answers -32700 to malformed JSON', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: '{not json',
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32700);
    });
  }, 30000);

  it('rejects a JSON-RPC batch', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: [body('tools/list'), body('tools/list')],
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32600);
      expect(r.json.error.message.toLowerCase()).toContain('batch');
    });
  }, 30000);

  it('answers 202 with no body to a notification', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { _meta: envelope() },
        },
        headers: headers('notifications/cancelled'),
      });
      expect(r.status).toBe(202);
      expect(r.text).toBe('');
    });
  }, 30000);

  it('ignores session headers and never mints one', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: {
          ...headers('tools/list'),
          'Mcp-Session-Id': 'abc',
          'Last-Event-ID': '5',
        },
      });
      expect(r.status).toBe(200);
      expect(r.headers.get('mcp-session-id')).toBeNull();
    });
  }, 30000);
});

describe('errors surface at the right layer', () => {
  it('reports an unknown resource as -32602 inside a 200', async () => {
    await bothHarnesses(async (send) => {
      const uri = 'horizon://knowledge/does-not-exist';
      const r = await send({
        body: body('resources/read', { uri }),
        headers: headers('resources/read', uri),
      });
      // The HTTP status is 200: the failure is at the JSON-RPC layer, not the
      // transport layer.
      expect(r.status).toBe(200);
      expect(r.json.error.code).toBe(-32602);
    });
  }, 30000);

  it('reports an unknown tool as -32602', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', { name: 'no_such_tool', arguments: {} }),
        headers: headers('tools/call', 'no_such_tool'),
      });
      expect(r.status).toBe(200);
      expect(r.json.error.code).toBe(-32602);
    });
  }, 30000);

  it('reports bad tool arguments as an isError result, not a JSON-RPC error', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', {
          name: 'search_certificates',
          arguments: { query: 12345 },
        }),
        headers: headers('tools/call', 'search_certificates'),
      });
      expect(r.status).toBe(200);
      expect(r.json.error).toBeUndefined();
      expect(r.json.result.isError).toBe(true);
    });
  }, 30000);
});

describe('capabilities and determinism', () => {
  it('advertises listChanged false and no logging capability', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('server/discover'),
        headers: headers('server/discover'),
      });
      expect(r.status).toBe(200);
      const caps = r.json.result.capabilities;
      expect(caps.tools.listChanged).toBe(false);
      expect(caps.resources.listChanged).toBe(false);
      // Logging is deprecated by SEP-2577 and was deliberately dropped.
      // Declaring it would install a `logging/setLevel` surface we never use.
      expect(caps).not.toHaveProperty('logging');
    });
  }, 30000);

  it('reports 2026-07-28 as the only supported revision', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('server/discover'),
        headers: headers('server/discover'),
      });
      expect(r.json.result.supportedVersions).toEqual([V]);
    });
  }, 30000);

  it('orders tools/list identically across independent server instances', async () => {
    const names = await Promise.all(
      harnesses.map(async (h) => {
        const r = await h.send({
          body: body('tools/list'),
          headers: headers('tools/list'),
        });
        return r.json.result.tools.map((t: { name: string }) => t.name);
      }),
    );
    expect(names[0]).toEqual(names[1]);
    expect(names[0]!.length).toBeGreaterThan(50);
  }, 30000);
});

describe('logging is never emitted unsolicited', () => {
  it('returns a plain result even when a logLevel is requested', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list', {}, { [META.logLevel]: 'debug' }),
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(200);
      // A single JSON object, not an SSE stream carrying notifications/message.
      expect(r.headers.get('content-type')).toContain('application/json');
      expect(r.json.result).toBeDefined();
    });
  }, 30000);
});

describe('subscriptions/listen', () => {
  it('acknowledges first and grants nothing this server cannot emit', async () => {
    // The ack's `notifications` is empty because this server declares
    // tools.listChanged: false and resources.listChanged: false. That is the
    // Phase 4.2 capability decision observed from the outside: a client asking
    // for list-changed events is told, up front, that it will get none.
    for (const h of harnesses) {
      const r = await h.send({
        body: body('subscriptions/listen', {
          notifications: { toolsListChanged: true, resourcesListChanged: true },
        }),
        headers: headers('subscriptions/listen'),
        accept: 'text/event-stream',
      });
      expect(r.status, `${h.name} status`).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/event-stream');
      expect(r.headers.get('x-accel-buffering')).toBe('no');

      const firstFrame = r.text
        .split('\n')
        .find((line) => line.startsWith('data: '));
      expect(firstFrame, `${h.name} first frame`).toBeDefined();
      const frame = JSON.parse(firstFrame!.slice('data: '.length));
      expect(frame.method).toBe('notifications/subscriptions/acknowledged');
      expect(frame.params._meta[META.subscriptionId]).toBeDefined();
      expect(frame.params.notifications).toEqual({});
    }
  }, 30000);

  it('requires the notifications filter', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('subscriptions/listen'),
        headers: headers('subscriptions/listen'),
        accept: 'text/event-stream',
      });
      expect(r.json.error.code).toBe(-32602);
      expect(r.json.error.message).toContain('notifications');
    });
  }, 30000);
});


describe('Streamable HTTP 2026-07-28 extras', () => {
  it('echoes the JSON-RPC id on a protocol error', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          id: 42,
          method: 'tools/list',
          params: {
            _meta: {
              [META.version]: '1900-01-01',
              [META.capabilities]: {},
            },
          },
        },
        headers: {
          'MCP-Protocol-Version': '1900-01-01',
          'Mcp-Method': 'tools/list',
        },
      });
      expect(r.status).toBe(400);
      expect(r.json.id).toBe(42);
      expect(r.json.error.code).toBe(-32022);
      expect(r.json.error.data.supported).toEqual([V]);
    });
  }, 30000);

  it('accepts a progressToken on tools/call without changing resultType', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body(
          'tools/call',
          { name: 'whoami', arguments: {} },
          { progressToken: 'prog-1' },
        ),
        headers: headers('tools/call', 'whoami'),
      });
      expect(r.status).toBe(200);
      expect(r.json.error).toBeUndefined();
      expect(r.json.result.resultType).toBe('complete');
      expect(r.json.result).not.toHaveProperty('inputRequests');
      expect(r.headers.get('content-type')).toContain('application/json');
    });
  }, 30000);

  it('returns whoami as complete, never input_required', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', { name: 'whoami', arguments: {} }),
        headers: headers('tools/call', 'whoami'),
      });
      expect(r.status).toBe(200);
      expect(r.json.result.resultType).toBe('complete');
      expect(r.json.result).not.toHaveProperty('inputRequests');
      expect(r.json.result.isError).toBeFalsy();
      const blob = JSON.stringify(r.json.result);
      expect(blob).toContain('alice');
    });
  }, 30000);

  it('omits nextCursor on a complete tools/list page', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('tools/list'),
      });
      expect(r.json.result.resultType).toBe('complete');
      expect(r.json.result.nextCursor).toBeFalsy();
    });
  }, 30000);

  it('advertises instructions and no unused 2026 capabilities', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('server/discover'),
        headers: headers('server/discover'),
      });
      const result = r.json.result;
      expect(result.instructions).toContain('whoami');
      const caps = result.capabilities;
      const unused = (cap: unknown) =>
        cap === undefined ||
        cap === null ||
        (typeof cap === 'object' && Object.keys(cap as object).length === 0);
      expect(unused(caps.prompts)).toBe(true);
      expect(unused(caps.completions)).toBe(true);
      expect(unused(caps.sampling)).toBe(true);
      expect(unused(caps.elicitation)).toBe(true);
      expect(unused(caps.extensions)).toBe(true);
      expect(caps.logging).toBeUndefined();
    });
  }, 30000);

  it('publishes outputSchema on whoami', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('tools/list'),
      });
      const whoami = (
        r.json.result.tools as Array<{
          name: string;
          outputSchema?: { type?: string };
          title?: string;
        }>
      ).find((t) => t.name === 'whoami');
      expect(whoami).toBeDefined();
      expect(whoami?.outputSchema).toMatchObject({ type: 'object' });
      expect(whoami?.title).toBe('Who am I');
    });
  }, 30000);

  it('treats MCP-Protocol-Version as case-insensitive', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: {
          'mcp-protocol-version': V,
          'mcp-method': 'tools/list',
        },
      });
      expect(r.status).toBe(200);
      expect(r.json.result.tools.length).toBeGreaterThan(50);
    });
  }, 30000);

  it('serves two overlapping stateless requests independently', async () => {
    await bothHarnesses(async (send) => {
      const [a, b] = await Promise.all([
        send({
          body: body('tools/list'),
          headers: headers('tools/list'),
        }),
        send({
          body: body('server/discover'),
          headers: headers('server/discover'),
        }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.json.result.tools.length).toBeGreaterThan(50);
      expect(b.json.result.supportedVersions).toEqual([V]);
    });
  }, 30000);

  it('still answers JSON when the client omits Accept', async () => {
    // Clients MUST send Accept listing json and event-stream. Servers are
    // not required to reject a missing one; pin the SDK's current behaviour.
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(200);
      expect(r.json.result.tools.length).toBeGreaterThan(50);
    });
  }, 30000);
});
