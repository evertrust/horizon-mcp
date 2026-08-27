import { fakeResponse, freePort, mockFetch } from './mcp-harness.js';

const { startHttpServer } = await import('../../../src/http/server.js');
const { buildHttpConfig } = await import('../../../src/http/config.js');
const { CredentialCache } =
  await import('../../../src/http/credential-cache.js');
const { currentRequestSignal } =
  await import('../../../src/client/request-signal.js');
const { loadSettings } = await import('../../../src/settings.js');
const { Client } = await import('@modelcontextprotocol/client');
const { StreamableHTTPClientTransport } =
  await import('@modelcontextprotocol/client');

export {
  CredentialCache,
  buildHttpConfig,
  currentRequestSignal,
  fakeResponse,
  freePort,
  loadSettings,
  startHttpServer,
};

export function apiIdOf(init: unknown): string | undefined {
  const headers = (init as { headers?: Record<string, string> } | undefined)
    ?.headers;
  return headers?.['X-API-ID'] ?? headers?.['x-api-id'];
}

export function signalOf(init: unknown): AbortSignal | undefined {
  return (init as { signal?: AbortSignal } | undefined)?.signal;
}

export async function expectAbortedWithin(
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
  const parsedUrl = String(url);
  if (parsedUrl.includes('/api/v1/security/csrf')) {
    return Promise.resolve(fakeResponse(200, { token: 'csrf' }));
  }
  if (parsedUrl.includes('/api/v1/security/principals/self')) {
    const id = apiIdOf(init) ?? 'anonymous';
    return Promise.resolve(
      fakeResponse(200, {
        identity: {
          identifier: id,
          identityProviderType: 'API_KEY',
          name: id,
        },
        permissions: [],
        _horizonVersion: '2.10.0',
      }),
    );
  }
  return Promise.resolve(fakeResponse(200, {}));
});

interface ServerCtx {
  base: string;
  handle: Awaited<ReturnType<typeof startHttpServer>>;
}

export async function startApiKeyServer(
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

export function openListenStream(
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

export function makeClient(base: string, apiId?: string, apiKey?: string) {
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

export function makeServiceClient(
  base: string,
  serviceAccount: string,
  jwt: string,
) {
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
