/**
 * Tool-layer unit tests - port of test_tools.py.
 *
 * Domains covered:
 *   Profiles    - list_profiles (read-only)
 *   Lifecycle   - search_certificates, get_certificate, download_certificate,
 *                 submit_request, approve/deny/cancel_request
 *   Assist      - whoami, decode_x509, validate_hcql, describe_query_fields
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { registerCryptoTools } from '../../src/tools/assist/crypto.js';
import { registerQueryTools } from '../../src/tools/assist/query.js';
import { registerSystemTools } from '../../src/tools/assist/system.js';
import { registerLifecycleTools } from '../../src/tools/lifecycle.js';
import { registerProfileTools } from '../../src/tools/profiles.js';
import { registerTriggerTools } from '../../src/tools/triggers.js';

// ---------------------------------------------------------------------------
// Mock client factory
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
    exportTimeout: 120000,
    principalName: undefined,
    horizonVersion: undefined,
  };
}

type MockClient = ReturnType<typeof createMockClient>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function parseToolResult(result: unknown): Record<string, unknown> {
  const r = result as ToolResult;
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

function resetMocks(mc: MockClient): void {
  mc.get.mockReset().mockResolvedValue({});
  mc.post.mockReset().mockResolvedValue({});
  mc.put.mockReset().mockResolvedValue({});
  mc.patch.mockReset().mockResolvedValue({});
  mc.delete.mockReset().mockResolvedValue(null);
  mc.getBytes.mockReset().mockResolvedValue(new ArrayBuffer(0));
  mc.getText.mockReset().mockResolvedValue('');
  mc.postText.mockReset().mockResolvedValue('');
  mc.postMultipart.mockReset().mockResolvedValue({});
  mc.request.mockReset().mockResolvedValue(new Response());
}

async function setupServerAndClient(
  registerFn: (server: McpServer, client: MockClient) => void,
): Promise<{ client: Client; mockClient: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerFn(server, mc);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    c.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client: c, mockClient: mc };
}

// ===========================================================================
// 1. PROFILE TOOLS
// ===========================================================================

describe('Profile tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerProfileTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('list_profiles', () => {
    it('returns profiles', async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: 'WebRA-Prod', module: 'webra' },
        { name: 'ACME-Staging', module: 'acme' },
      ]);

      const result = await client.callTool({
        name: 'list_profiles',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/certificate/profiles',
      );
      expect(parsed['count']).toBe(2);
      expect(parsed['kind']).toBe('profile');
    });

    it('filters by module', async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: 'WebRA-Prod', module: 'webra' },
        { name: 'ACME-Staging', module: 'acme' },
        { name: 'WebRA-Dev', module: 'webra' },
      ]);

      const result = await client.callTool({
        name: 'list_profiles',
        arguments: { module: 'webra' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(2);
      const items = parsed['items'] as Array<Record<string, unknown>>;
      expect(items.every((i) => i['module'] === 'webra')).toBe(true);
    });

    it('unwraps an {items: [...]} envelope response', async () => {
      mockClient.get.mockResolvedValueOnce({
        items: [
          { name: 'WebRA-Prod', module: 'webra' },
          { name: 'ACME-Staging', module: 'acme' },
        ],
      });

      const result = await client.callTool({
        name: 'list_profiles',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(2);
      expect(parsed['kind']).toBe('profile');
    });

    it('wraps a single bare object response in a one-item list', async () => {
      mockClient.get.mockResolvedValueOnce({
        name: 'WebRA-Prod',
        module: 'webra',
      });

      const result = await client.callTool({
        name: 'list_profiles',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(1);
      const items = parsed['items'] as Array<Record<string, unknown>>;
      expect(items[0]!['name']).toBe('WebRA-Prod');
    });

    it.each([
      ['an empty bare array', []],
      ['an envelope with an empty items array', { items: [] }],
      ['an object with the collection field absent', {}],
    ])('returns no profiles for %s', async (_description, upstreamResponse) => {
      mockClient.get.mockResolvedValueOnce(upstreamResponse);

      const result = await client.callTool({
        name: 'list_profiles',
        arguments: {},
      });

      expect(parseToolResult(result)).toEqual({
        items: [],
        count: 0,
        total_available: 0,
        truncated: false,
        kind: 'profile',
      });
    });
  });
});

// ===========================================================================
// 1b. TRIGGER TOOLS (normalizeItems wiring)
// ===========================================================================

describe('Trigger tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerTriggerTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('list_triggers', () => {
    it('returns triggers from a bare array response', async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: 'deploy-rest', type: 'rest' },
        { name: 'notify-email', type: 'email' },
      ]);

      const result = await client.callTool({
        name: 'list_triggers',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith('/api/v1/triggers');
      expect(parsed['count']).toBe(2);
      expect(parsed['kind']).toBe('trigger');
    });

    it('unwraps an {items: [...]} envelope response', async () => {
      mockClient.get.mockResolvedValueOnce({
        items: [
          { name: 'deploy-rest', type: 'rest' },
          { name: 'notify-email', type: 'email' },
        ],
      });

      const result = await client.callTool({
        name: 'list_triggers',
        arguments: { trigger_type: 'rest' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(1);
      const items = parsed['items'] as Array<Record<string, unknown>>;
      expect(items[0]!['name']).toBe('deploy-rest');
    });
  });

  describe('simulate_trigger', () => {
    it('fetches the named trigger and sends the full body under trigger', async () => {
      const trigger = {
        _id: 'trigger-id',
        name: 'deploy-rest',
        type: 'rest',
        events: ['on_enroll'],
        sequence: [
          {
            method: 'POST',
            url: 'https://example.test/deploy',
            authenticationType: 'noauth',
            expectedHttpCodes: [200],
            timeout: '30 seconds',
          },
        ],
      };
      mockClient.get.mockResolvedValueOnce(trigger);
      mockClient.patch.mockResolvedValueOnce({
        status: 'success',
        message: 'Rest notification successfully sent',
      });

      await client.callTool({
        name: 'simulate_trigger',
        arguments: { name: 'deploy-rest' },
      });

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/triggers/deploy-rest',
      );
      expect(mockClient.patch).toHaveBeenCalledWith('/api/v1/triggers', {
        trigger,
      });
    });
  });
});

// ===========================================================================
// 2. LIFECYCLE TOOLS
// ===========================================================================

describe('Lifecycle tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerLifecycleTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('search_certificates', () => {
    it('performs basic search', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: [
          { dn: 'CN=test.example.com', serial: '01', profile: 'WebRA' },
        ],
      });

      const result = await client.callTool({
        name: 'search_certificates',
        arguments: { query: 'profile = "WebRA"' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledOnce();
      const callArgs = mockClient.post.mock.calls[0]!;
      expect(callArgs[0]).toBe('/api/v1/certificates/search');
      const payload = callArgs[1] as Record<string, unknown>;
      expect(payload['query']).toBe('profile = "WebRA"');
      expect(payload['fields']).toContain('dn');
      expect(payload['fields']).toContain('serial');
      expect(payload['pageIndex']).toBe(1);
      expect(payload['pageSize']).toBe(25);

      expect((parsed['results'] as unknown[]).length).toBe(1);
      expect(parsed['page_index']).toBe(0);
      expect(parsed['page_size']).toBe(25);
      // has_more/next_page_index are always present (deterministic contract)
      expect(parsed).toHaveProperty('has_more');
      expect(parsed).toHaveProperty('next_page_index');
    });

    it('custom fields override preset', async () => {
      mockClient.post.mockResolvedValueOnce({ results: [] });

      await client.callTool({
        name: 'search_certificates',
        arguments: { query: '*', fields: ['dn', 'grade'] },
      });

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['fields']).toEqual(['dn', 'grade']);
    });

    it('caps page size at max', async () => {
      // Zod schema enforces max(100). We verify with 100 to confirm the cap.
      mockClient.post.mockResolvedValueOnce({ results: [] });

      const result = await client.callTool({
        name: 'search_certificates',
        arguments: { query: '*', page_size: 100 },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['pageSize']).toBe(100);
      expect(parsed['page_size']).toBe(100);
    });

    // --------------------------------------------------------------------
    // Pagination regression suite
    //
    // These tests guard against the "pagination returned the same page"
    // class of bugs. Every paginated search tool must:
    //   1. Send a strictly different pageIndex to the API for each
    //      page_index value the model passes in.
    //   2. Return a deterministic envelope including has_more and
    //      next_page_index so the model never has to derive pagination
    //      state itself.
    //   3. Default with_count=true so total is always populated when
    //      available from the API.
    // If any of these invariants break, a real Horizon API (or a broken
    // MCP shim) can silently return the same data twice -- the exact
    // failure mode reported by users.
    // --------------------------------------------------------------------
    describe('pagination contract', () => {
      it('page_index increments reach the API as distinct 1-based pageIndex values', async () => {
        // Model simulates walking three pages. Each call must hit the
        // Horizon API with a distinct pageIndex (1, 2, 3) so we can never
        // regress to serving the same page twice.
        mockClient.post
          .mockResolvedValueOnce({ results: [{ _id: 'a' }], count: 250 })
          .mockResolvedValueOnce({ results: [{ _id: 'b' }], count: 250 })
          .mockResolvedValueOnce({ results: [{ _id: 'c' }], count: 250 });

        for (const idx of [0, 1, 2]) {
          await client.callTool({
            name: 'search_certificates',
            arguments: {
              query: '*',
              page_index: idx,
              page_size: 100,
              sorted_by: 'notAfter:Desc',
            },
          });
        }

        const sentIndices = mockClient.post.mock.calls.map(
          (c) => (c[1] as Record<string, unknown>)['pageIndex'],
        );
        expect(sentIndices).toEqual([1, 2, 3]);
      });

      it('echoes page_index as the 0-based value the caller provided', async () => {
        mockClient.post.mockResolvedValueOnce({
          results: [{ _id: 'x' }],
          count: 300,
        });

        const result = await client.callTool({
          name: 'search_certificates',
          arguments: { query: '*', page_index: 2, page_size: 50 },
        });
        const parsed = parseToolResult(result);

        expect(parsed['page_index']).toBe(2);
      });

      it('has_more=true and next_page_index set mid-pagination (with total)', async () => {
        mockClient.post.mockResolvedValueOnce({
          results: Array.from({ length: 100 }, (_, i) => ({ _id: `r${i}` })),
          count: 187,
        });

        const result = await client.callTool({
          name: 'search_certificates',
          arguments: { query: '*', page_index: 0, page_size: 100 },
        });
        const parsed = parseToolResult(result);

        expect(parsed['total']).toBe(187);
        expect(parsed['has_more']).toBe(true);
        expect(parsed['next_page_index']).toBe(1);
      });

      it('has_more=false and next_page_index=null on the last page', async () => {
        // page_index=1 with page_size=100 on a total of 187 means this
        // page returns the trailing 87, and there are no more pages.
        mockClient.post.mockResolvedValueOnce({
          results: Array.from({ length: 87 }, (_, i) => ({ _id: `r${i}` })),
          count: 187,
        });

        const result = await client.callTool({
          name: 'search_certificates',
          arguments: { query: '*', page_index: 1, page_size: 100 },
        });
        const parsed = parseToolResult(result);

        expect(parsed['total']).toBe(187);
        expect(parsed['has_more']).toBe(false);
        expect(parsed['next_page_index']).toBeNull();
      });

      it('falls back to records.length heuristic when count is absent', async () => {
        // No count -> cannot compare against total. has_more must still
        // be deterministic by falling back to page fullness.
        mockClient.post.mockResolvedValueOnce({
          results: Array.from({ length: 25 }, (_, i) => ({ _id: `r${i}` })),
        });

        const result = await client.callTool({
          name: 'search_certificates',
          arguments: { query: '*', page_index: 0, page_size: 25 },
        });
        const parsed = parseToolResult(result);

        expect(parsed['total']).toBeNull();
        // Page was full (25/25) -> another page may exist
        expect(parsed['has_more']).toBe(true);
      });

      it('defaults with_count to true', async () => {
        mockClient.post.mockResolvedValueOnce({ results: [] });
        await client.callTool({
          name: 'search_certificates',
          arguments: { query: '*' },
        });
        const payload = mockClient.post.mock.calls[0]![1] as Record<
          string,
          unknown
        >;
        expect(payload['withCount']).toBe(true);
      });
    });
  });

  describe('get_certificate', () => {
    it('returns full certificate', async () => {
      const certData = {
        dn: 'CN=test.example.com',
        serial: '01AB',
        profile: 'WebRA',
        extensions: { keyUsage: ['digitalSignature'] },
      };
      mockClient.get.mockResolvedValueOnce(certData);

      const result = await client.callTool({
        name: 'get_certificate',
        arguments: { certificate_id: 'abc-123' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/certificates/abc-123',
      );
      expect(parsed['dn']).toBe('CN=test.example.com');
      const ext = parsed['extensions'] as Record<string, unknown>;
      expect(ext['keyUsage']).toEqual(['digitalSignature']);
    });
  });

  describe('download_certificate', () => {
    it('downloads PEM', async () => {
      const pem =
        '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
      mockClient.get.mockResolvedValueOnce({
        dn: 'CN=test.example.com',
        certificate: pem,
      });

      const result = await client.callTool({
        name: 'download_certificate',
        arguments: { certificate_id: 'abc-123', format: 'pem' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/certificates/abc-123',
      );
      expect(parsed['format']).toBe('pem');
      expect(parsed['content']).toBe(pem);
    });

    it('rejects non-PEM format at the schema level', async () => {
      const result = (await client.callTool({
        name: 'download_certificate',
        arguments: { certificate_id: 'abc-123', format: 'der' },
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('format');
    });

    it('rejects invalid format at the schema level', async () => {
      const result = (await client.callTool({
        name: 'download_certificate',
        arguments: { certificate_id: 'abc-123', format: 'xml' },
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('format');
    });

    it('rejects JKS format at the schema level', async () => {
      const result = (await client.callTool({
        name: 'download_certificate',
        arguments: { certificate_id: 'abc-123', format: 'jks' },
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('format');
    });
  });

  describe('submit_request', () => {
    it('enrolls with template', async () => {
      mockClient.post.mockResolvedValueOnce({
        id: 'req-001',
        workflow: 'enroll',
        status: 'pending',
      });
      const template = {
        subject: [{ element: 'cn.1', type: 'CN', value: 'server.local' }],
        sans: [{ type: 'DNSNAME', value: ['server.local'] }],
        labels: [{ label: 'env', value: 'prod' }],
        keyType: 'rsa-3072',
      };

      const result = await client.callTool({
        name: 'submit_request',
        arguments: {
          workflow: 'enroll',
          profile: 'my-profile',
          module: 'webra',
          template,
          password: 'changeit',
        },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledOnce();
      const callArgs = mockClient.post.mock.calls[0]!;
      expect(callArgs[0]).toBe('/api/v1/requests/submit');
      const payload = callArgs[1] as Record<string, unknown>;
      expect(payload['workflow']).toBe('enroll');
      expect(payload['profile']).toBe('my-profile');
      expect(payload['module']).toBe('webra');
      expect(payload['password']).toBe('changeit');
      const tpl = payload['template'] as Record<string, unknown>;
      expect(tpl['keyType']).toBe('rsa-3072');
      const sans = tpl['sans'] as Array<Record<string, unknown>>;
      expect(sans[0]!['value']).toEqual(['server.local']);
      const labels = tpl['labels'] as Array<Record<string, unknown>>;
      expect(labels[0]!['label']).toBe('env');
      expect(parsed['id']).toBe('req-001');
    });

    it('revokes without template', async () => {
      mockClient.post.mockResolvedValueOnce({
        id: 'req-002',
        workflow: 'revoke',
      });

      await client.callTool({
        name: 'submit_request',
        arguments: {
          workflow: 'revoke',
          profile: 'my-profile',
          module: 'webra',
          certificate_id: 'cert-abc',
        },
      });

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['workflow']).toBe('revoke');
      expect(payload['certificateId']).toBe('cert-abc');
      expect(payload['template']).toBeUndefined();
      expect(payload['password']).toBeUndefined();
    });

    it('explicit params override data', async () => {
      mockClient.post.mockResolvedValueOnce({ id: 'req-003' });

      await client.callTool({
        name: 'submit_request',
        arguments: {
          workflow: 'enroll',
          profile: 'p',
          module: 'webra',
          template: { keyType: 'rsa-3072' },
          data: { template: { keyType: 'rsa-2048' }, extra: 'field' },
        },
      });

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      const tpl = payload['template'] as Record<string, unknown>;
      expect(tpl['keyType']).toBe('rsa-3072');
      expect(payload['extra']).toBe('field');
    });
  });

  describe('approve_request', () => {
    it('approves with permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        profile: 'my-profile',
        permissions: { approve: true, cancel: true },
      });
      mockClient.post.mockResolvedValueOnce({
        id: 'req-001',
        status: 'approved',
      });

      const result = await client.callTool({
        name: 'approve_request',
        arguments: { request_id: 'req-001' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith('/api/v1/requests/req-001');
      expect(mockClient.post).toHaveBeenCalledOnce();
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload).toEqual({ id: 'req-001', workflow: 'enroll' });
      expect(parsed['status']).toBe('approved');
    });

    it('blocks without permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        profile: 'my-profile',
        permissions: { approve: false, cancel: true },
      });

      const result = await client.callTool({
        name: 'approve_request',
        arguments: { request_id: 'req-001' },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain('Permission denied');
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('blocks non-pending request', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'approved',
        permissions: { approve: true, cancel: false },
      });

      const result = await client.callTool({
        name: 'approve_request',
        arguments: { request_id: 'req-001' },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain('pending');
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('deny_request', () => {
    it('denies with permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        permissions: { approve: true, cancel: true },
      });
      mockClient.post.mockResolvedValueOnce({
        id: 'req-002',
        status: 'denied',
      });

      const result = await client.callTool({
        name: 'deny_request',
        arguments: { request_id: 'req-002' },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload).toEqual({ id: 'req-002', workflow: 'enroll' });
      expect(parsed['status']).toBe('denied');
    });

    it('blocks without permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        permissions: { approve: false, cancel: true },
      });

      const result = await client.callTool({
        name: 'deny_request',
        arguments: { request_id: 'req-002' },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain('Permission denied');
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('cancel_request', () => {
    it('cancels with permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        permissions: { approve: false, cancel: true },
      });
      mockClient.post.mockResolvedValueOnce({
        id: 'req-003',
        status: 'cancelled',
      });

      const result = await client.callTool({
        name: 'cancel_request',
        arguments: { request_id: 'req-003' },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload).toEqual({ id: 'req-003', workflow: 'enroll' });
      expect(parsed['status']).toBe('cancelled');
    });

    it('blocks without permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        permissions: { approve: true, cancel: false },
      });

      const result = await client.callTool({
        name: 'cancel_request',
        arguments: { request_id: 'req-003' },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain('Permission denied');
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Cross-tool pagination contract
  //
  // The CTO reported "pagination returned the same page" on a real-world
  // Horizon instance. Every paginated search tool must behave identically so
  // a fix (or regression) in one tool is provably reflected in all of them.
  // This parametrised block asserts the contract per-tool without relying
  // on domain-specific field shapes.
  // ==========================================================================
  describe.each([
    {
      name: 'search_certificates',
      endpoint: '/api/v1/certificates/search',
      args: { query: 'status is valid' },
    },
    {
      name: 'search_requests',
      endpoint: '/api/v1/requests/search',
      args: { query: 'status equals "pending"' },
    },
    {
      name: 'search_events',
      endpoint: '/api/v1/events/search',
      args: { query: 'timestamp after -7d' },
    },
  ])('$name pagination contract', ({ name, endpoint, args }) => {
    it('sends distinct 1-based pageIndex for each page_index walked', async () => {
      mockClient.post
        .mockResolvedValueOnce({ results: [{ _id: 'a' }], count: 500 })
        .mockResolvedValueOnce({ results: [{ _id: 'b' }], count: 500 })
        .mockResolvedValueOnce({ results: [{ _id: 'c' }], count: 500 });

      for (const idx of [0, 1, 2]) {
        await client.callTool({
          name,
          arguments: { ...args, page_index: idx, page_size: 100 },
        });
      }

      const calls = mockClient.post.mock.calls.filter((c) => c[0] === endpoint);
      expect(calls.length).toBeGreaterThanOrEqual(3);
      const sent = calls
        .slice(-3)
        .map((c) => (c[1] as Record<string, unknown>)['pageIndex']);
      expect(sent).toEqual([1, 2, 3]);
    });

    it('returns a standardized pagination envelope', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: Array.from({ length: 50 }, (_, i) => ({ _id: `r${i}` })),
        count: 250,
      });

      const result = await client.callTool({
        name,
        arguments: { ...args, page_index: 0, page_size: 50 },
      });
      const parsed = parseToolResult(result);

      expect(parsed).toHaveProperty('results');
      expect(parsed['page_index']).toBe(0);
      expect(parsed['page_size']).toBe(50);
      expect(parsed['total']).toBe(250);
      expect(parsed['has_more']).toBe(true);
      expect(parsed['next_page_index']).toBe(1);
      // Legacy camelCase fields should NOT be present -- they confused
      // models when echoed alongside snake_case inputs.
      expect(parsed).not.toHaveProperty('pageIndex');
      expect(parsed).not.toHaveProperty('pageSize');
      expect(parsed).not.toHaveProperty('hasMore');
    });

    it('next_page_index is null when has_more is false', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: [{ _id: 'tail' }],
        count: 1,
      });

      const result = await client.callTool({
        name,
        arguments: { ...args, page_index: 0, page_size: 100 },
      });
      const parsed = parseToolResult(result);

      expect(parsed['has_more']).toBe(false);
      expect(parsed['next_page_index']).toBeNull();
    });

    it('defaults with_count=true so total is requested', async () => {
      mockClient.post.mockResolvedValueOnce({ results: [], count: 0 });
      await client.callTool({ name, arguments: args });
      const last = mockClient.post.mock.calls.at(-1)!;
      const payload = last[1] as Record<string, unknown>;
      expect(payload['withCount']).toBe(true);
    });
  });

  // ==========================================================================
  // Domain-specific truncation guard rails
  //
  // Cert/request searches truncate large fields and point the model at
  // get_certificate for the full value. Event searches must NOT do this
  // because (a) event payloads are the primary output, and (b) the hint
  // would send the model to the wrong recovery tool (should be get_event,
  // not get_certificate).
  // ==========================================================================
  describe('field truncation per tool family', () => {
    const LARGE_STRING = 'a'.repeat(2000); // > MAX_STRING_LEN

    it('search_events passes large detail fields through untouched', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: [{ code: 'X', details: { blob: LARGE_STRING } }],
        count: 1,
      });

      const result = await client.callTool({
        name: 'search_events',
        arguments: { query: 'timestamp after -1h' },
      });
      const parsed = parseToolResult(result);
      const row = (parsed['results'] as Record<string, unknown>[])[0]!;
      const details = row['details'] as Record<string, unknown>;

      expect(details['blob']).toBe(LARGE_STRING);
      // Explicit guard: the cert-specific hint must never appear in an
      // event response. If someone re-enables truncation here the wrong
      // recovery tool would be suggested.
      expect(JSON.stringify(parsed)).not.toContain('get_certificate');
    });

    it('search_certificates still truncates large fields', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: [{ dn: 'CN=test', rawPem: LARGE_STRING }],
        count: 1,
      });

      const result = await client.callTool({
        name: 'search_certificates',
        arguments: { query: '*' },
      });
      const parsed = parseToolResult(result);
      const row = (parsed['results'] as Record<string, unknown>[])[0]!;

      expect(row['rawPem']).not.toBe(LARGE_STRING);
      expect(String(row['rawPem']).length).toBeLessThan(LARGE_STRING.length);
    });
  });
});

// ===========================================================================
// 3. ASSIST TOOLS
// ===========================================================================

describe('Assist tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerSystemTools(server, mc as any);
      registerQueryTools(server, mc as any);
      registerCryptoTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('whoami', () => {
    it('returns principal', async () => {
      const principal = {
        identifier: 'test-admin',
        name: 'Test Admin',
        roles: ['admin'],
        teams: [],
        permissions: ['*'],
      };
      mockClient.get.mockResolvedValueOnce(principal);

      const result = await client.callTool({
        name: 'whoami',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/security/principals/self',
      );
      expect(parsed['identifier']).toBe('test-admin');
      expect(parsed['roles']).toEqual(['admin']);
    });

    it('tolerates null collection fields (principal in no teams / no roles)', async () => {
      // Horizon serializes absent collections as `null`, not `[]` or omitted.
      // The output schema must accept null or the MCP stack rejects the whole
      // whoami response before the client can read it.
      const principal = {
        identifier: 'svc-account',
        name: 'Service Account',
        team: null,
        teams: null,
        roles: null,
        permissions: null,
      };
      mockClient.get.mockResolvedValueOnce(principal);

      const result = await client.callTool({
        name: 'whoami',
        arguments: {},
      });

      expect((result as { isError?: boolean }).isError).toBeFalsy();
      const parsed = parseToolResult(result);
      expect(parsed['identifier']).toBe('svc-account');
      expect(parsed['teams']).toBeNull();
    });
  });

  describe('decode_x509', () => {
    it('decodes certificate', async () => {
      const decodeResult = {
        subject: { CN: 'test.example.com' },
        issuer: { CN: 'Test CA' },
        notAfter: '2025-12-31T23:59:59Z',
      };
      mockClient.postMultipart.mockResolvedValueOnce(decodeResult);

      const pem =
        '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
      const result = await client.callTool({
        name: 'decode_x509',
        arguments: { pem },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.postMultipart).toHaveBeenCalledOnce();
      const callArgs = mockClient.postMultipart.mock.calls[0]!;
      expect(callArgs[0]).toBe('/api/v1/rfc5280/x509');
      const subject = parsed['subject'] as Record<string, unknown>;
      expect(subject['CN']).toBe('test.example.com');
    });
  });

  describe('validate_hcql', () => {
    it('validates valid query', async () => {
      mockClient.post.mockResolvedValueOnce({
        count: 42,
        hasMore: true,
        results: [],
      });

      const query = 'dn matches ".*example.com" and status is valid';
      const result = await client.callTool({
        name: 'validate_hcql',
        arguments: { query },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledWith(
        '/api/v1/certificates/search',
        { query, pageSize: 1 },
      );
      expect(parsed['valid']).toBe(true);
      expect(parsed['query_type']).toBe('HCQL');
      expect(parsed['count']).toBe(42);
    });

    it('detects invalid query', async () => {
      mockClient.post.mockRejectedValueOnce(
        new Error('Unexpected token at position 5'),
      );

      const result = await client.callTool({
        name: 'validate_hcql',
        arguments: { query: 'bad %%% query' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['valid']).toBe(false);
      expect(parsed['error']).toBeDefined();
    });
  });

  describe('describe_query_fields', () => {
    it('returns HCQL metadata', async () => {
      const result = await client.callTool({
        name: 'describe_query_fields',
        arguments: { query_type: 'hcql' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['query_type']).toBe('hcql');
      expect(parsed['supports_aggregate']).toBe(true);
      const fields = parsed['fields'] as Array<Record<string, unknown>>;
      const fieldNames = fields.map((f) => f['name']);
      expect(fieldNames).toContain('dn');
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it('returns error for unknown type', async () => {
      const result = await client.callTool({
        name: 'describe_query_fields',
        arguments: { query_type: 'sql' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['error']).toBeDefined();
      expect(parsed['valid_types']).toBeDefined();
    });
  });
});
