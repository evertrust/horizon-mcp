import { request as httpRequest } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

import {
  apiIdOf,
  buildHttpConfig,
  fakeResponse,
  freePort,
  loadSettings,
  makeClient,
  makeServiceClient,
  startApiKeyServer,
  startHttpServer,
} from './support/http-server-fixture.js';
import { mockFetch } from './support/mcp-harness.js';

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
