/**
 * Crypto tool-layer unit tests - hardening regressions.
 *
 * Covers the security/correctness fixes on src/tools/assist/crypto.ts:
 *   - fetch_exposed_certificate marks results as untrusted/unvalidated
 *   - fetch_exposed_certificate redacts secrets from connection error text
 *   - decode_* tools cap input size via Zod before forwarding to Horizon
 *   - convert_pkcs12_to_jks surfaces a clean tool error (not a protocol error)
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import * as dns from 'node:dns';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { registerCryptoTools } from '../../src/tools/assist/crypto.js';

// node:tls is an ESM namespace and cannot be spied on directly, so mock the
// module and drive `connect` via a swappable implementation per test.
let tlsConnectImpl: (opts: unknown, onConnect?: () => void) => unknown = () => {
  throw new Error('tls.connect not stubbed');
};

vi.mock('node:tls', () => ({
  connect: (opts: unknown, onConnect?: () => void) =>
    tlsConnectImpl(opts, onConnect),
}));

// ---------------------------------------------------------------------------
// Mock client factory (mirrors tests/unit/tools.test.ts)
// ---------------------------------------------------------------------------

function createMockClient() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(null),
    getBytes: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    getText: vi.fn().mockResolvedValue(''),
    postText: vi.fn().mockResolvedValue(''),
    postMultipart: vi.fn().mockResolvedValue({}),
    request: vi.fn().mockResolvedValue(new Response()),
    close: vi.fn().mockResolvedValue(undefined),
    fetchCsrfToken: vi.fn().mockResolvedValue(undefined),
    exportTimeout: 120,
    principalName: undefined,
    horizonVersion: undefined,
  };
}

type MockClient = ReturnType<typeof createMockClient>;

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

function parseToolResult(result: unknown): Record<string, unknown> {
  const r = result as ToolResult;
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

async function setupServerAndClient(): Promise<{
  client: Client;
  mockClient: MockClient;
}> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerCryptoTools(server, mc as never);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    c.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client: c, mockClient: mc };
}

// ---------------------------------------------------------------------------
// Fake TLS socket + peer certificate plumbing for fetch_exposed_certificate
// ---------------------------------------------------------------------------

function fakePeerCert() {
  return {
    toString: () =>
      '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    subject: 'CN=www.example.com',
    issuer: 'CN=Example CA',
    serialNumber: 'ABCD',
    validFrom: 'Jan  1 00:00:00 2025 GMT',
    validTo: 'Dec 31 23:59:59 2025 GMT',
    fingerprint256: 'AA:BB:CC',
    subjectAltName: 'DNS:www.example.com',
  };
}

/**
 * Stub tls.connect so the success callback fires synchronously with a socket
 * that returns our fake peer certificate. Avoids real network I/O.
 */
function stubTlsConnectSuccess(): void {
  tlsConnectImpl = (_opts: unknown, onConnect?: () => void) => {
    const socket = {
      getPeerX509Certificate: () => fakePeerCert(),
      destroy: vi.fn(),
      on: vi.fn(),
    };
    if (onConnect) queueMicrotask(onConnect);
    return socket;
  };
}

describe('crypto tools - hardening', () => {
  let client: Client;
  let mockClient: MockClient;
  const originalEnv = process.env['HORIZON_ALLOW_PRIVATE_TLS_PROBE'];

  beforeAll(async () => {
    const ctx = await setupServerAndClient();
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    mockClient.postMultipart.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['HORIZON_ALLOW_PRIVATE_TLS_PROBE'];
    } else {
      process.env['HORIZON_ALLOW_PRIVATE_TLS_PROBE'] = originalEnv;
    }
    tlsConnectImpl = () => {
      throw new Error('tls.connect not stubbed');
    };
    vi.restoreAllMocks();
  });

  // -- H-S1 -----------------------------------------------------------------

  describe('fetch_exposed_certificate untrusted marker', () => {
    it('marks the result as untrusted and unvalidated', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
        address: '93.184.216.34',
        family: 4,
      } as unknown as Awaited<ReturnType<typeof dns.promises.lookup>>);
      stubTlsConnectSuccess();

      const result = await client.callTool({
        name: 'fetch_exposed_certificate',
        arguments: { uri: 'https://www.example.com' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['trusted']).toBe(false);
      expect(String(parsed['validation'])).toContain('skipped');
      expect(String(parsed['validation'])).toContain('do not treat as trusted');
      // Existing fields must remain present (additive change only).
      expect(parsed['pem']).toBeDefined();
      expect(parsed['host']).toBe('www.example.com');
    });
  });

  // -- M-C4 -----------------------------------------------------------------

  describe('fetch_exposed_certificate error redaction', () => {
    it('redacts secret material from connection error text', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
        address: '93.184.216.34',
        family: 4,
      } as unknown as Awaited<ReturnType<typeof dns.promises.lookup>>);

      const jwt =
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123XYZsignature';
      tlsConnectImpl = (_opts: unknown, _onConnect?: () => void) => {
        const handlers: Record<string, (arg: Error) => void> = {};
        const socket = {
          getPeerX509Certificate: () => undefined,
          destroy: vi.fn(),
          on: (event: string, cb: (arg: Error) => void) => {
            handlers[event] = cb;
            return socket;
          },
        };
        queueMicrotask(() =>
          handlers['error']?.(new Error(`handshake failed token=${jwt}`)),
        );
        return socket;
      };

      const result = await client.callTool({
        name: 'fetch_exposed_certificate',
        arguments: { uri: 'https://www.example.com' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['error']).toBe(true);
      const content = String(parsed['content']);
      expect(content).not.toContain(jwt);
      expect(content).toContain('<redacted-jwt>');
    });
  });

  // -- M-S3 -----------------------------------------------------------------

  describe('decode tool input size cap', () => {
    it('rejects oversized decode_x509 input before calling Horizon', async () => {
      const huge = 'A'.repeat(2_000_001);

      const result = await client.callTool({
        name: 'decode_x509',
        arguments: { pem: huge },
      });

      expect((result as ToolResult).isError).toBe(true);
      expect(mockClient.postMultipart).not.toHaveBeenCalled();
    });

    it('accepts input at the size limit', async () => {
      mockClient.postMultipart.mockResolvedValueOnce({ dn: 'CN=ok' });
      const atLimit = 'A'.repeat(2_000_000);

      const result = await client.callTool({
        name: 'decode_x509',
        arguments: { pem: atLimit },
      });

      expect((result as ToolResult).isError).toBeFalsy();
      expect(mockClient.postMultipart).toHaveBeenCalledOnce();
    });

    it('rejects oversized detect_file input', async () => {
      const huge = 'A'.repeat(2_000_001);

      const result = await client.callTool({
        name: 'detect_file',
        arguments: { data: huge },
      });

      expect((result as ToolResult).isError).toBe(true);
      expect(mockClient.postMultipart).not.toHaveBeenCalled();
    });
  });

  // -- H-C2 -----------------------------------------------------------------

  describe('convert_pkcs12_to_jks not-implemented error', () => {
    it('returns a clean tool error (501) instead of a protocol error', async () => {
      const result = (await client.callTool({
        name: 'convert_pkcs12_to_jks',
        arguments: { pkcs12_base64: 'AAAA', pkcs12_password: 'pw' },
      })) as ToolResult;

      expect(result.isError).toBe(true);
      expect(result.structuredContent?.['statusCode']).toBe(501);
      expect(String(result.content[0]!.text)).toContain('not yet implemented');
    });
  });
});
