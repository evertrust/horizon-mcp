import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

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
const { CredentialCache } = await import('../../src/http/credential-cache.js');
const { currentRequestSignal } =
  await import('../../src/client/request-signal.js');
const { loadSettings } = await import('../../src/settings.js');
const { Client } = await import('@modelcontextprotocol/client');
const { StreamableHTTPClientTransport } =
  await import('@modelcontextprotocol/client');

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

function signalOf(init: unknown): AbortSignal | undefined {
  return (init as { signal?: AbortSignal } | undefined)?.signal;
}

async function expectAbortedWithin(
  signal: AbortSignal,
  timeoutMs = 500,
): Promise<void> {
  if (signal.aborted) return;

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error(`upstream signal did not abort within ${timeoutMs}ms`));
    }, timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
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

async function startApiKeyServer(
  overrides: Record<string, string> = {},
  serverOptions: {
    closeTimeoutMs?: number;
    requestTimeoutMs?: number;
    connectionsCheckingIntervalMs?: number;
  } = {},
): Promise<ServerCtx> {
  const port = await freePort();
  const env = {
    HORIZON_TRANSPORT: 'http',
    HORIZON_HTTP_AUTH_METHODS: 'api-key',
    HORIZON_URL: 'https://horizon.test',
    HORIZON_HTTP_HOST: '127.0.0.1',
    HORIZON_HTTP_PORT: String(port),
    HORIZON_TRUSTED_HOSTS: `127.0.0.1:${port},localhost:${port}`,
    HORIZON_VERIFY_SSL: 'false',
    ...overrides,
  };
  const settings = loadSettings(env);
  const config = buildHttpConfig(settings, env);
  const handle = await startHttpServer(settings, config, serverOptions);
  return { base: `http://127.0.0.1:${handle.port}/mcp`, handle };
}

function openListenStream(
  base: string,
  signal: AbortSignal,
  id: number,
): Promise<Response> {
  return fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-API-ID': 'alice',
      'X-API-KEY': 'k',
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': 'subscriptions/listen',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'subscriptions/listen',
      params: {
        notifications: { toolsListChanged: true },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
    signal,
  });
}

describe('HTTP server integration (request reception timeout)', () => {
  const env = {
    HORIZON_SSE_MAX_DURATION: '5',
    HORIZON_EXPORT_TIMEOUT: '1',
  };
  const serverOptions = {
    requestTimeoutMs: 200,
    connectionsCheckingIntervalMs: 50,
  };

  it('closes a trickled request body within the receive deadline', async () => {
    const ctx = await startApiKeyServer(env, serverOptions);
    const socket = connect(ctx.handle.port, '127.0.0.1');
    let trickle: ReturnType<typeof setInterval> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      socket.on('error', () => undefined);
      socket.write(
        [
          'POST /mcp HTTP/1.1',
          `Host: 127.0.0.1:${ctx.handle.port}`,
          'Content-Type: application/json',
          'Content-Length: 64',
          '',
          '',
        ].join('\r\n'),
      );

      const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
      let bodyIndex = 0;
      const firstBodyAt = Date.now();
      socket.write(body[bodyIndex++]!);
      trickle = setInterval(() => {
        if (!socket.destroyed) {
          socket.write(body[bodyIndex++ % body.length]!);
        }
      }, 100);

      // With requestTimeout disabled, neither event fires and the watchdog wins.
      const elapsed = await new Promise<number>((resolve, reject) => {
        const closed = () => {
          clearTimeout(watchdog);
          socket.off('close', closed);
          socket.off('end', closed);
          resolve(Date.now() - firstBodyAt);
        };
        const watchdog = setTimeout(() => {
          socket.off('close', closed);
          socket.off('end', closed);
          reject(new Error('socket remained open past the receive deadline'));
        }, 1500);
        socket.once('close', closed);
        socket.once('end', closed);
      });

      expect(elapsed).toBeLessThan(1500);
    } finally {
      if (trickle) clearInterval(trickle);
      socket.destroy();
      await ctx.handle.close();
    }
  }, 10000);

  it('keeps a fully received subscriptions/listen response open', async () => {
    const ctx = await startApiKeyServer(env, serverOptions);
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let reading: Promise<void> | undefined;
    let streamEnded = false;
    try {
      const response = await openListenStream(ctx.base, controller.signal, 1);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      expect(response.body).not.toBeNull();

      reader = response.body!.getReader();
      reading = (async () => {
        try {
          for (;;) {
            const { done } = await reader!.read();
            if (done) {
              streamEnded = true;
              return;
            }
          }
        } catch {
          streamEnded = true;
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(streamEnded).toBe(false);
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      await reading?.catch(() => undefined);
      await ctx.handle.close();
    }
  }, 10000);
});

function makeClient(base: string, apiId?: string, apiKey?: string) {
  const headers: Record<string, string> = {};
  if (apiId) headers['X-API-ID'] = apiId;
  if (apiKey) headers['X-API-KEY'] = apiKey;
  const transport = new StreamableHTTPClientTransport(new URL(base), {
    requestInit: { headers },
  });
  const client = new Client(
    { name: 'itest', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  return { client, transport };
}

function makeServiceClient(base: string, serviceAccount: string, jwt: string) {
  const transport = new StreamableHTTPClientTransport(new URL(base), {
    requestInit: {
      headers: { 'X-API-SVA': serviceAccount, 'X-API-TOKEN': jwt },
    },
  });
  const client = new Client(
    { name: 'itest-service', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  return { client, transport };
}

describe('HTTP server integration (api-key mode)', () => {
  it('serves tools and knowledge resources with no handshake', async () => {
    const ctx = await startApiKeyServer();
    const { client, transport } = makeClient(ctx.base, 'alice', 'k');
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(50);
      const resources = await client.listResources();
      expect(resources.resources.length).toBeGreaterThan(0);
    } finally {
      await transport.close().catch(() => undefined);
      await ctx.handle.close();
    }
  }, 20000);

  it('isolates two credentials, each acting as its own Horizon identity', async () => {
    const ctx = await startApiKeyServer();
    const a = makeClient(ctx.base, 'alice', 'k1');
    const b = makeClient(ctx.base, 'bob', 'k2');
    try {
      await a.client.connect(a.transport);
      await b.client.connect(b.transport);

      const who = async (c: typeof a.client) => {
        const r = (await c.callTool({ name: 'whoami', arguments: {} })) as {
          content: { text: string }[];
        };
        return r.content[0]!.text;
      };

      expect(await who(a.client)).toContain('alice');
      expect(await who(b.client)).toContain('bob');
    } finally {
      await a.transport.close().catch(() => undefined);
      await b.transport.close().catch(() => undefined);
      await ctx.handle.close();
    }
  }, 30000);

  it('rejects a request with no credential', async () => {
    const ctx = await startApiKeyServer();
    try {
      const res = await fetch(ctx.base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      await ctx.handle.close();
    }
  }, 20000);

  it('includes WWW-Authenticate on a 401 for a request with no credential and no modern envelope claim', async () => {
    const ctx = await startApiKeyServer();
    try {
      const res = await fetch(ctx.base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(
        'Horizon methods="api-key"',
      );
    } finally {
      await ctx.handle.close();
    }
  }, 20000);

  it('includes WWW-Authenticate on a 401 when Horizon rejects the credential during validation', async () => {
    const ctx = await startApiKeyServer();
    const original = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: unknown, init: unknown) => {
      if (
        String(url).includes('/api/v1/security/principals/self') &&
        apiIdOf(init) === 'rejected-by-horizon'
      ) {
        return Promise.resolve(fakeResponse(401, { message: 'unauthorized' }));
      }
      return original(url, init);
    });
    try {
      const res = await fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-ID': 'rejected-by-horizon',
          'X-API-KEY': 'whatever',
          'MCP-Protocol-Version': '2026-07-28',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(
        'Horizon methods="api-key"',
      );
    } finally {
      mockFetch.mockImplementation(original);
      await ctx.handle.close();
    }
  }, 20000);

  it('answers 405 to GET and DELETE, the removed session operations', async () => {
    const ctx = await startApiKeyServer();
    try {
      for (const method of ['GET', 'DELETE']) {
        const res = await fetch(ctx.base, {
          method,
          headers: { 'X-API-ID': 'alice', 'X-API-KEY': 'k' },
        });
        expect(res.status).toBe(405);
      }
    } finally {
      await ctx.handle.close();
    }
  }, 20000);

  it('answers 405 with Allow to an uncredentialed GET', async () => {
    const ctx = await startApiKeyServer();
    try {
      const res = await fetch(ctx.base, { method: 'GET' }); // no credentials
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    } finally {
      await ctx.handle.close();
    }
  }, 20000);

  it('rejects a modern-claim POST without the version header before touching credentials', async () => {
    const ctx = await startApiKeyServer();
    const probes = () =>
      mockFetch.mock.calls.filter((c) =>
        String(c[0]).includes('/api/v1/security/principals/self'),
      ).length;
    try {
      const before = probes();
      const res = await fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': 'nobody',
          'X-API-KEY': 'nope', // bogus creds must NOT reach Horizon
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: number; data: any } };
      expect(body.error.code).toBe(-32020);
      expect(body.error.data.mismatch.header).toBe('(missing)');
      expect(probes()).toBe(before);
    } finally {
      await ctx.handle.close();
    }
  }, 20000);

  it('rejects a mismatched Host with 421 (DNS-rebinding defence)', async () => {
    const ctx = await startApiKeyServer();
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: ctx.handle.port,
            path: '/mcp',
            method: 'POST',
            headers: {
              Host: 'evil.example.com',
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
              'X-API-ID': 'alice',
              'X-API-KEY': 'k',
              'Content-Length': '2',
            },
          },
          (res) => {
            expect(res.statusCode).toBe(421);
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c as Buffer));
            res.on('end', () =>
              resolve(Buffer.concat(chunks).toString('utf8')),
            );
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
      expect(body).toMatch(/host/i);
    } finally {
      await ctx.handle.close();
    }
  }, 20000);

  it('ignores Mcp-Session-Id and never echoes one back', async () => {
    const ctx = await startApiKeyServer();
    const { client, transport } = makeClient(ctx.base, 'alice', 'k');
    try {
      await client.connect(transport);
      await client.listTools();

      const res = await fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': 'alice',
          'X-API-KEY': 'k',
          'Mcp-Session-Id': 'not-a-real-session',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });

      expect(res.headers.get('mcp-session-id')).toBeNull();
      expect(res.status).toBeLessThan(500);
    } finally {
      await transport.close().catch(() => undefined);
      await ctx.handle.close();
    }
  }, 20000);

  it('validates a credential against Horizon once, then serves from cache', async () => {
    const ctx = await startApiKeyServer();
    const { client, transport } = makeClient(ctx.base, 'alice', 'k');
    const probes = () =>
      mockFetch.mock.calls.filter((c) =>
        String(c[0]).includes('/api/v1/security/principals/self'),
      ).length;
    try {
      await client.connect(transport);
      await client.listTools();
      const afterFirst = probes();
      await client.listTools();
      await client.listTools();
      // Without the credential cache each stateless request would revalidate
      // against Horizon over the network.
      expect(probes()).toBe(afterFirst);
    } finally {
      await transport.close().catch(() => undefined);
      await ctx.handle.close();
    }
  }, 30000);

  it('limits concurrent validation of distinct credentials per peer', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const ctx = await startApiKeyServer({
      HORIZON_VALIDATION_RATE_LIMIT: '3',
      HORIZON_RATE_LIMIT_RPS: '0',
      HORIZON_IP_RATE_LIMIT: '0',
    }).catch((err: unknown) => {
      nowSpy.mockRestore();
      throw err;
    });
    const probes = () =>
      mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/api/v1/security/principals/self'),
      ).length;
    const send = (index: number) =>
      fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': `bogus-${index}`,
          'X-API-KEY': `key-${index}`,
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: index,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });

    try {
      const before = probes();
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) => send(index + 1)),
      );
      const after = probes();
      const probeCount = after - before;
      const limited = responses.filter((response) => response.status === 429);
      const succeeded = responses.filter((response) => response.status !== 429);

      expect(probeCount).toBe(3);
      expect(limited).toHaveLength(17);
      expect(succeeded).toHaveLength(3);
      expect(succeeded.map((response) => response.status)).toEqual(
        Array(3).fill(200),
      );
      for (const response of limited) {
        const body = (await response.json()) as { error: { code: number } };
        expect(body.error.code).toBe(-31001);
      }
    } finally {
      nowSpy.mockRestore();
      await ctx.handle.close();
    }
  }, 30000);

  it('charges one validation token for concurrent same-credential misses', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const ctx = await startApiKeyServer({
      HORIZON_VALIDATION_RATE_LIMIT: '1',
      HORIZON_RATE_LIMIT_RPS: '0',
      HORIZON_IP_RATE_LIMIT: '0',
    }).catch((err: unknown) => {
      nowSpy.mockRestore();
      throw err;
    });
    const probes = () =>
      mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/api/v1/security/principals/self'),
      ).length;
    const send = (apiId: string, id: number) =>
      fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': apiId,
          'X-API-KEY': 'shared-key',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });

    try {
      const before = probes();
      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          send('shared-fresh', index + 1),
        ),
      );

      expect(probes() - before).toBe(1);
      expect(responses.map((response) => response.status)).toEqual(
        Array(6).fill(200),
      );

      const distinct = await send('distinct-fresh', 7);
      expect(distinct.status).toBe(429);
      const body = (await distinct.json()) as { error: { code: number } };
      expect(body.error.code).toBe(-31001);
      expect(probes() - before).toBe(1);
    } finally {
      nowSpy.mockRestore();
      await ctx.handle.close();
    }
  }, 30000);

  it('revalidates a cached credential after Horizon rejects it', async () => {
    const ctx = await startApiKeyServer();
    const original = mockFetch.getMockImplementation()!;
    const credential = 'revoked-then-restored';
    let rejectCredential = false;
    const probes = () =>
      mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/api/v1/security/principals/self'),
      ).length;
    const send = async (
      id: number,
      method: 'tools/call' | 'tools/list',
      params: Record<string, unknown> = {},
      name?: string,
    ) => {
      const response = await fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': credential,
          'X-API-KEY': 'key',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': method,
          ...(name === undefined ? {} : { 'Mcp-Name': name }),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params: {
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': {
                name: 'auth-rejection-test',
                version: '1.0.0',
              },
            },
          },
        }),
      });
      return {
        response,
        body: (await response.json()) as {
          error?: { code: number };
          result?: {
            isError?: boolean;
            structuredContent?: { statusCode?: number };
          };
        },
      };
    };

    mockFetch.mockImplementation((url: unknown, init: unknown) => {
      if (rejectCredential && apiIdOf(init) === credential) {
        return Promise.resolve(
          fakeResponse(401, {
            error: 'SecAuth001',
            message: 'Unauthorized',
          }),
        );
      }
      return original(url, init);
    });

    try {
      const warm = await send(1, 'tools/list');
      expect(warm.response.status).toBe(200);
      const afterWarm = probes();

      rejectCredential = true;
      const rejected = await send(
        2,
        'tools/call',
        { name: 'whoami', arguments: {} },
        'whoami',
      );
      expect(rejected.response.status).toBe(200);
      expect(rejected.body.error).toBeUndefined();
      expect(rejected.body.result?.isError).toBe(true);
      expect(rejected.body.result?.structuredContent).toMatchObject({
        statusCode: 401,
      });
      const afterReject = probes();
      expect(afterReject).toBeGreaterThan(afterWarm);

      rejectCredential = false;
      const recovered = await send(3, 'tools/list');
      expect(recovered.response.status).toBe(200);
      expect(probes()).toBe(afterReject + 1);
    } finally {
      mockFetch.mockImplementation(original);
      await ctx.handle.close();
    }
  }, 30000);

  it('rejects requests beyond the global concurrency cap', async () => {
    const ctx = await startApiKeyServer({
      HORIZON_MAX_CONCURRENT_REQUESTS: '1',
      HORIZON_IP_RATE_LIMIT: '0',
      HORIZON_RATE_LIMIT_RPS: '0',
    });
    // Make Horizon slow so the requests genuinely overlap; with an instant
    // upstream they would complete one after another and never contend.
    const original = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: unknown, init: unknown) => {
      await new Promise((r) => setTimeout(r, 60));
      return original(url, init);
    });
    try {
      const send = () =>
        fetch(ctx.base, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'X-API-ID': 'alice',
            'X-API-KEY': 'k',
            'MCP-Protocol-Version': '2026-07-28',
            'Mcp-Method': 'tools/list',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        });

      const results = await Promise.all(
        Array.from({ length: 12 }, () => send()),
      );
      const statuses = results.map((r) => r.status);
      // With a cap of 1 in-flight request, a burst of 12 must shed some load
      // rather than build 12 concurrent server instances.
      expect(statuses.some((s) => s === 503 || s === 429)).toBe(true);
    } finally {
      mockFetch.mockImplementation(original);
      await ctx.handle.close();
    }
  }, 30000);

  it('releases concurrency permits when a client disconnects during credential validation', async () => {
    const ctx = await startApiKeyServer({
      HORIZON_MAX_CONCURRENT_REQUESTS: '1',
      HORIZON_IP_RATE_LIMIT: '0',
      HORIZON_RATE_LIMIT_RPS: '0',
      HORIZON_SSE_MAX_DURATION: '2',
      HORIZON_EXPORT_TIMEOUT: '1',
    });
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const firstCredential = 'disconnecting-client';
    const secondCredential = 'next-client';
    const original = mockFetch.getMockImplementation()!;
    let markValidationStarted = () => {};
    const validationStarted = new Promise<void>((resolve) => {
      markValidationStarted = resolve;
    });
    let releaseValidation = () => {};
    const validationRelease = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    let validationSignal: AbortSignal | undefined;
    mockFetch.mockImplementation(async (url: unknown, init: unknown) => {
      if (
        String(url).includes('/api/v1/security/principals/self') &&
        apiIdOf(init) === firstCredential
      ) {
        validationSignal = signalOf(init);
        markValidationStarted();
        await validationRelease;
      }
      return original(url, init);
    });

    const send = (apiId: string, apiKey: string, signal?: AbortSignal) =>
      fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': apiId,
          'X-API-KEY': apiKey,
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
        signal,
      });

    const controller = new AbortController();
    const requestA = send(firstCredential, 'key-one', controller.signal).catch(
      () => undefined,
    );
    try {
      await validationStarted;
      controller.abort();
      expect(validationSignal).toBeDefined();
      await expectAbortedWithin(validationSignal!);
      await new Promise((r) => setTimeout(r, 100));
      const responseB = await send(secondCredential, 'key-two');
      expect(responseB.status).toBe(200);
      releaseValidation();
      await requestA;
      await new Promise((r) => setTimeout(r, 2600));
      const deadlineWarnings = writeSpy.mock.calls.filter(([chunk]) => {
        const line = String(chunk);
        return (
          line.includes('"level":"WARNING"') &&
          line.includes('"logger":"horizon_mcp.http"') &&
          line.includes('response exceeded')
        );
      });
      expect(deadlineWarnings).toHaveLength(0);
    } finally {
      releaseValidation();
      await requestA;
      mockFetch.mockImplementation(original);
      writeSpy.mockRestore();
      await ctx.handle.close();
    }
  }, 30000);

  it('keeps shared credential validation alive while another waiter remains', async () => {
    const ctx = await startApiKeyServer({
      HORIZON_IP_RATE_LIMIT: '0',
      HORIZON_RATE_LIMIT_RPS: '0',
    });
    const credential = 'shared-validation-client';
    const original = mockFetch.getMockImplementation()!;
    let markValidationStarted = () => {};
    const validationStarted = new Promise<void>((resolve) => {
      markValidationStarted = resolve;
    });
    let releaseValidation = () => {};
    const validationRelease = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    let validationSignal: AbortSignal | undefined;
    let validationProbes = 0;
    let markSecondWaiter = () => {};
    const secondWaiter = new Promise<void>((resolve) => {
      markSecondWaiter = resolve;
    });
    let cacheGets = 0;
    let firstCallerSignal: AbortSignal | undefined;
    const originalGet = CredentialCache.prototype.get;
    const getSpy = vi
      .spyOn(CredentialCache.prototype, 'get')
      .mockImplementation(function (...args) {
        const result = originalGet.apply(this, args);
        const material = args[1];
        if (material.kind === 'api-key' && material.apiId === credential) {
          cacheGets += 1;
          if (cacheGets === 1) firstCallerSignal = currentRequestSignal();
          if (cacheGets === 2) markSecondWaiter();
        }
        return result;
      });
    mockFetch.mockImplementation(async (url: unknown, init: unknown) => {
      if (
        String(url).includes('/api/v1/security/principals/self') &&
        apiIdOf(init) === credential
      ) {
        validationProbes += 1;
        validationSignal = signalOf(init);
        markValidationStarted();
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(validationSignal!.reason);
          if (validationSignal!.aborted) {
            reject(validationSignal!.reason);
            return;
          }
          validationSignal!.addEventListener('abort', onAbort, { once: true });
          void validationRelease.then(() => {
            validationSignal!.removeEventListener('abort', onAbort);
            resolve();
          });
        });
      }
      return original(url, init);
    });

    const send = (id: number, signal: AbortSignal) =>
      fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': credential,
          'X-API-KEY': 'shared-key',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
        signal,
      });

    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstRequest = send(1, firstController.signal).catch(() => undefined);
    let secondRequest: Promise<Response> | undefined;
    try {
      await validationStarted;
      secondRequest = send(2, secondController.signal);
      await secondWaiter;
      firstController.abort();
      await firstRequest;
      expect(firstCallerSignal).toBeDefined();
      await expectAbortedWithin(firstCallerSignal!);

      expect(validationSignal).toBeDefined();
      expect(validationSignal!.aborted).toBe(false);
      releaseValidation();

      const secondResponse = await secondRequest;
      expect(secondResponse.status).toBe(200);
      expect(validationProbes).toBe(1);
    } finally {
      releaseValidation();
      firstController.abort();
      secondController.abort();
      await Promise.allSettled([
        firstRequest,
        ...(secondRequest ? [secondRequest] : []),
      ]);
      mockFetch.mockImplementation(original);
      getSpy.mockRestore();
      await ctx.handle.close();
    }
  }, 30000);

  it('cancels an upstream tool call when the client disconnects', async () => {
    const ctx = await startApiKeyServer({
      HORIZON_IP_RATE_LIMIT: '0',
      HORIZON_RATE_LIMIT_RPS: '0',
    });
    const credential = 'disconnecting-tool-client';
    const original = mockFetch.getMockImplementation()!;
    const send = (
      id: number,
      method: 'tools/list' | 'tools/call',
      signal?: AbortSignal,
    ) =>
      fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': credential,
          'X-API-KEY': 'key',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': method,
          ...(method === 'tools/call' ? { 'Mcp-Name': 'whoami' } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params: {
            ...(method === 'tools/call'
              ? { name: 'whoami', arguments: {} }
              : {}),
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': {
                name: 'cancellation-test',
                version: '1.0.0',
              },
            },
          },
        }),
        signal,
      });

    const warm = await send(1, 'tools/list');
    expect(warm.status).toBe(200);

    let markToolCallStarted = () => {};
    const toolCallStarted = new Promise<void>((resolve) => {
      markToolCallStarted = resolve;
    });
    let releaseToolCall = () => {};
    const toolCallRelease = new Promise<void>((resolve) => {
      releaseToolCall = resolve;
    });
    let toolCallSignal: AbortSignal | undefined;
    mockFetch.mockImplementation(async (url: unknown, init: unknown) => {
      if (
        String(url).includes('/api/v1/security/principals/self') &&
        apiIdOf(init) === credential
      ) {
        toolCallSignal = signalOf(init);
        markToolCallStarted();
        await toolCallRelease;
      }
      return original(url, init);
    });

    const controller = new AbortController();
    const request = send(2, 'tools/call', controller.signal).catch(
      () => undefined,
    );
    try {
      await toolCallStarted;
      controller.abort();
      expect(toolCallSignal).toBeDefined();
      await expectAbortedWithin(toolCallSignal!);
    } finally {
      releaseToolCall();
      await request;
      mockFetch.mockImplementation(original);
      await ctx.handle.close();
    }
  }, 30000);
});

describe('HTTP server integration (authentication whitelist)', () => {
  it('forwards a caller-supplied service-account identity to Horizon', async () => {
    const port = await freePort();
    const env = {
      HORIZON_TRANSPORT: 'http',
      HORIZON_HTTP_AUTH_METHODS: 'service',
      HORIZON_URL: 'https://horizon.test',
      HORIZON_HTTP_HOST: '127.0.0.1',
      HORIZON_HTTP_PORT: String(port),
      HORIZON_TRUSTED_HOSTS: `127.0.0.1:${port}`,
      HORIZON_VERIFY_SSL: 'false',
    };
    const settings = loadSettings(env);
    const config = buildHttpConfig(settings, env);
    const handle = await startHttpServer(settings, config);
    const base = `http://127.0.0.1:${handle.port}/mcp`;
    const { client, transport } = makeServiceClient(base, 'svc', 'jwt-value');
    try {
      await client.connect(transport);
      await client.listTools();
      const sent = mockFetch.mock.calls.some((c) => {
        const headers = (c[1] as { headers?: Record<string, string> })?.headers;
        return headers?.['X-API-SVA'] === 'svc';
      });
      expect(sent).toBe(true);
    } finally {
      await transport.close().catch(() => undefined);
      await handle.close();
    }
  }, 20000);

  it('rejects a credential method that is not enabled', async () => {
    const ctx = await startApiKeyServer();
    try {
      const res = await fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-SVA': 'svc',
          'X-API-TOKEN': 'jwt',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as {
        error: { code: number; message: string };
      };
      expect(body.error.code).toBe(-31003);
      expect(body.error.message).toBe(
        'service authentication is not accepted by this server',
      );
    } finally {
      await ctx.handle.close();
    }
  }, 20000);

  it('names the auth methods setting when Authorization is presented', async () => {
    const ctx = await startApiKeyServer();
    try {
      const res = await fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer some-oauth-token',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain('HORIZON_HTTP_AUTH_METHODS');
    } finally {
      await ctx.handle.close();
    }
  }, 20000);
});

describe('HTTP server integration (readyz)', () => {
  it('reports process readiness without inventing a caller identity', async () => {
    const port = await freePort();
    const env = {
      HORIZON_TRANSPORT: 'http',
      HORIZON_HTTP_AUTH_METHODS: 'api-key,service',
      HORIZON_URL: 'https://horizon.test',
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
    const probeCount = () =>
      mockFetch.mock.calls.filter((c) =>
        String(c[0]).includes('/api/v1/security/principals/self'),
      ).length;
    try {
      const before = probeCount();
      const response = await fetch(base);
      expect(response.status).toBe(200);
      expect(probeCount() - before).toBe(0);
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

  it('closes cached Horizon credentials on shutdown', async () => {
    const ctx = await startApiKeyServer();
    const { client, transport } = makeClient(ctx.base, 'alice', 'k');
    await client.connect(transport);
    await client.listTools();
    await transport.close().catch(() => undefined);

    const result = await Promise.race([
      ctx.handle.close().then(() => 'closed'),
      new Promise<'timed-out'>((resolve) =>
        setTimeout(() => resolve('timed-out'), 5000),
      ),
    ]);
    expect(result).toBe('closed');
  }, 20000);
});

describe('HTTP server integration (listen concurrency)', () => {
  it('admits two listen streams per credential by default and rejects a third', async () => {
    const ctx = await startApiKeyServer();
    const controllers = [
      new AbortController(),
      new AbortController(),
      new AbortController(),
    ];
    try {
      const first = await openListenStream(ctx.base, controllers[0]!.signal, 1);
      expect(first.status).toBe(200);
      expect(first.headers.get('content-type')).toContain('text/event-stream');
      expect(first.body).not.toBeNull();

      const second = await openListenStream(
        ctx.base,
        controllers[1]!.signal,
        2,
      );
      expect(second.status).toBe(200);
      expect(second.headers.get('content-type')).toContain('text/event-stream');
      expect(second.body).not.toBeNull();

      const third = await openListenStream(ctx.base, controllers[2]!.signal, 3);
      expect(third.status).toBe(429);
    } finally {
      controllers.forEach((controller) => controller.abort());
      await ctx.handle.close();
    }
  }, 20000);

  it('keeps tools/list available while a listen stream is open', async () => {
    const ctx = await startApiKeyServer({
      HORIZON_MAX_CONCURRENT_REQUESTS: '1',
      HORIZON_SSE_MAX_DURATION: '5',
      HORIZON_EXPORT_TIMEOUT: '1',
    });
    const controller = new AbortController();
    try {
      const listen = await openListenStream(ctx.base, controller.signal, 1);
      expect(listen.status).toBe(200);
      expect(listen.headers.get('content-type')).toContain('text/event-stream');
      expect(listen.body).not.toBeNull();

      const tools = await fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': 'alice',
          'X-API-KEY': 'k',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
      expect(tools.status).toBe(200);
    } finally {
      controller.abort();
      await ctx.handle.close();
    }
  }, 20000);
});

describe('HTTP server integration (response lifetime cap)', () => {
  it('closes a subscriptions/listen stream at the absolute SSE deadline despite keep-alives', async () => {
    // A listen stream holds dedicated global and per-credential permits for as
    // long as it is open. The absolute cap must not be reset by writes.
    const ctx = await startApiKeyServer({
      HORIZON_SSE_MAX_DURATION: '3',
      HORIZON_SSE_KEEP_ALIVE: '1',
      HORIZON_EXPORT_TIMEOUT: '1',
    });
    try {
      const openedAt = Date.now();
      const controller = new AbortController();
      const watchdog = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-API-ID': 'alice',
          'X-API-KEY': 'k',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'subscriptions/listen',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'subscriptions/listen',
          params: {
            notifications: { toolsListChanged: true },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const keepAliveArrivals: number[] = [];
      let buffered = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split(/\r?\n/);
          buffered = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith(':')) keepAliveArrivals.push(Date.now());
          }
        }
      } catch {
        // A destroyed socket surfaces as a read error, which is also a close.
      }
      clearTimeout(watchdog);
      const elapsed = Date.now() - openedAt;
      expect(keepAliveArrivals.length).toBeGreaterThanOrEqual(2);
      expect(elapsed).toBeGreaterThan(2500);
      expect(elapsed).toBeLessThan(8000);
      await reader.cancel().catch(() => undefined);
    } finally {
      await ctx.handle.close();
    }
  }, 12000);
});
