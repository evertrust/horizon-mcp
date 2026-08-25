import { createServer } from 'node:http';
import { vi } from 'vitest';

export const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

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
const { startHttpServer } = await import('../../../src/http/server.js');
const { buildHttpConfig } = await import('../../../src/http/config.js');
const { loadSettings } = await import('../../../src/settings.js');
const { createSessionServer } = await import('../../../src/server-factory.js');
const { HorizonClient } = await import('../../../src/client/http.js');
const { ApiKeyAuthProvider } = await import('../../../src/auth/apikey.js');

export const V = '2026-07-28';

export const META = {
  version: 'io.modelcontextprotocol/protocolVersion',
  capabilities: 'io.modelcontextprotocol/clientCapabilities',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  logLevel: 'io.modelcontextprotocol/logLevel',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
  subscriptionId: 'io.modelcontextprotocol/subscriptionId',
} as const;

export function fakeResponse(status: number, body: unknown): Response {
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
  if (String(url).includes('/api/v1/security/principals/self')) {
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

export function envelope(
  over: Record<string, unknown> = {},
  includeClientInfo = true,
): Record<string, unknown> {
  return {
    [META.version]: V,
    [META.capabilities]: {},
    ...(includeClientInfo
      ? { [META.clientInfo]: { name: 'conformance', version: '1.0.0' } }
      : {}),
    ...over,
  };
}

export function body(
  method: string,
  params: Record<string, unknown> = {},
  metaOver: Record<string, unknown> = {},
  includeClientInfo = true,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: { ...params, _meta: envelope(metaOver, includeClientInfo) },
  };
}

export function headers(method: string, name?: string): Record<string, string> {
  return {
    'MCP-Protocol-Version': V,
    'Mcp-Method': method,
    ...(name === undefined ? {} : { 'Mcp-Name': name }),
  };
}

export interface Reply {
  status: number;
  headers: Headers;
  text: string;
  json: any;
}

export interface SendInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  contentType?: string | null;
  accept?: string;
}

export interface Harness {
  name: string;
  send(init: SendInit): Promise<Reply>;
  close(): Promise<void>;
}

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

export async function parseResponse(
  res: Response,
  streaming = false,
): Promise<Reply> {
  const text = streaming ? await readPrefix(res) : await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

export function buildRequestInit(init: SendInit): RequestInit {
  const h: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.contentType !== null)
    h['Content-Type'] = init.contentType ?? 'application/json';
  if (init.accept) h.Accept = init.accept;
  const method = init.method ?? 'POST';
  return {
    method,
    headers: h,
    ...(init.body !== undefined && method !== 'GET'
      ? {
          body:
            typeof init.body === 'string'
              ? init.body
              : JSON.stringify(init.body),
        }
      : {}),
  };
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export function inProcessHarness(): Harness {
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
      const response = await handler.fetch(
        new Request('http://test.local/mcp', buildRequestInit(init)),
      );
      return parseResponse(response, init.accept === 'text/event-stream');
    },
    async close() {
      await handler.close().catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
}

export async function startExpressServer(
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

export async function expressHarness(): Promise<Harness> {
  const server = await startExpressServer();
  return {
    name: 'express',
    async send(init) {
      const response = await fetch(
        server.base,
        buildRequestInit({
          ...init,
          headers: {
            'X-API-ID': 'alice',
            'X-API-KEY': 'k',
            ...(init.headers ?? {}),
          },
        }),
      );
      return parseResponse(response, init.accept === 'text/event-stream');
    },
    close: server.close,
  };
}

export async function createHarnesses(): Promise<Harness[]> {
  return [inProcessHarness(), await expressHarness()];
}

export async function bothHarnesses(
  harnesses: Harness[],
  check: (send: Harness['send'], harnessName: string) => Promise<void>,
): Promise<void> {
  for (const harness of harnesses) {
    try {
      await check((init) => harness.send(init), harness.name);
    } catch (err) {
      throw new Error(
        `[${harness.name} harness] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
