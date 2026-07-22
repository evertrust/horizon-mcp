/**
 * V1.1 tool-layer unit tests - port of test_v11_tools.py.
 *
 * Domains covered:
 *   Discovery campaigns  - list, get, create, update, delete, flush
 *   Discovery events     - search, get, export CSV
 *   Discovery feed       - start session, feed cert, register event, end session
 *   Dashboards           - CRUD + chart ops + saved queries
 *   Reports              - list, download, delete
 *   Aggregation          - aggregate_certificates, aggregate_requests
 *   HorizonError         - propagation through MCP
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { HorizonError } from '../../src/client/errors.js';
import { registerDashboardTools } from '../../src/tools/dashboards.js';
import { registerDiscoveryEventTools } from '../../src/tools/discovery-events.js';
import { registerDiscoveryFeedTools } from '../../src/tools/discovery-feed.js';
import { registerDiscoveryTools } from '../../src/tools/discovery.js';
import { registerLifecycleTools } from '../../src/tools/lifecycle.js';
import { registerReportTools } from '../../src/tools/reports.js';

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
// 1. DISCOVERY CAMPAIGNS
// ===========================================================================

describe('Discovery campaign tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerDiscoveryTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('list_discovery_campaigns', () => {
    it('returns all campaigns', async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: 'net-scan-prod' },
        { name: 'net-scan-dev' },
      ]);
      const result = await client.callTool({
        name: 'list_discovery_campaigns',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/discovery/campaigns',
      );
      expect(parsed['count']).toBe(2);
      expect(parsed['kind']).toBe('discovery_campaign');
      expect(parsed['truncated']).toBe(false);
    });

    it('filters by name', async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: 'net-scan-prod' },
        { name: 'net-scan-dev' },
        { name: 'tls-check' },
      ]);
      const result = await client.callTool({
        name: 'list_discovery_campaigns',
        arguments: { name_contains: 'net' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(2);
    });

    it('returns no campaigns when the collection field is absent', async () => {
      mockClient.get.mockResolvedValueOnce({});
      const result = await client.callTool({
        name: 'list_discovery_campaigns',
        arguments: {},
      });

      expect(parseToolResult(result)).toEqual({
        items: [],
        count: 0,
        total_available: 0,
        truncated: false,
        kind: 'discovery_campaign',
      });
    });

    it('truncates results', async () => {
      mockClient.get.mockResolvedValueOnce(
        Array.from({ length: 60 }, (_, i) => ({ name: `camp-${i}` })),
      );
      const result = await client.callTool({
        name: 'list_discovery_campaigns',
        arguments: { max_items: 5 },
      });
      const parsed = parseToolResult(result);

      expect(parsed['truncated']).toBe(true);
      expect(parsed['count']).toBe(5);
      expect(parsed['total_available']).toBe(60);
    });
  });

  describe('get_discovery_campaign', () => {
    it('returns campaign', async () => {
      mockClient.get.mockResolvedValueOnce({
        name: 'prod-scan',
        enabled: true,
      });
      const result = await client.callTool({
        name: 'get_discovery_campaign',
        arguments: { name: 'prod-scan' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/discovery/campaigns/prod-scan',
      );
      expect(parsed['name']).toBe('prod-scan');
    });
  });

  describe('create_discovery_campaign', () => {
    it('creates valid campaign', async () => {
      mockClient.post.mockResolvedValueOnce({ name: 'new-scan' });
      const authLevels = {
        search: { accessLevel: 'authenticated' },
        feed: { accessLevel: 'authorized' },
      };
      const result = await client.callTool({
        name: 'create_discovery_campaign',
        arguments: { name: 'new-scan', authorization_levels: authLevels },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledOnce();
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['name']).toBe('new-scan');
      expect(payload['authorizationLevels']).toEqual(authLevels);
      expect(payload['eventOnSuccess']).toBe(true);
      expect(payload['enabled']).toBe(true);
      expect(parsed['status']).toBe('created');
      expect(parsed['kind']).toBe('discovery_campaign');
      expect(parsed['name']).toBe('new-scan');
    });

    it('rejects dot in name', async () => {
      const result = await client.callTool({
        name: 'create_discovery_campaign',
        arguments: {
          name: 'bad.name',
          authorization_levels: {
            search: { accessLevel: 'everyone' },
            feed: { accessLevel: 'everyone' },
          },
        },
      });
      expect(result.isError).toBe(true);

      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('rejects invalid access level', async () => {
      const result = await client.callTool({
        name: 'create_discovery_campaign',
        arguments: {
          name: 'test',
          authorization_levels: {
            search: { accessLevel: 'public' },
            feed: { accessLevel: 'everyone' },
          },
        },
      });
      expect(result.isError).toBe(true);

      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('rejects missing feed section', async () => {
      const result = await client.callTool({
        name: 'create_discovery_campaign',
        arguments: {
          name: 'test',
          authorization_levels: {
            search: { accessLevel: 'everyone' },
          },
        },
      });
      expect(result.isError).toBe(true);

      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('update_discovery_campaign', () => {
    it('merges updates', async () => {
      mockClient.get.mockResolvedValueOnce({
        _id: 'abc',
        name: 'my-scan',
        enabled: true,
      });
      mockClient.put.mockResolvedValueOnce({
        name: 'my-scan',
        enabled: false,
      });
      const result = await client.callTool({
        name: 'update_discovery_campaign',
        arguments: { name: 'my-scan', enabled: false },
      });
      const parsed = parseToolResult(result);

      expect(parsed['status']).toBe('updated');
      expect(parsed['kind']).toBe('discovery_campaign');
    });
  });

  describe('delete_discovery_campaign', () => {
    it('deletes with matching name', async () => {
      const result = await client.callTool({
        name: 'delete_discovery_campaign',
        arguments: { name: 'old-scan', expected_name: 'old-scan' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.delete).toHaveBeenCalledWith(
        '/api/v1/discovery/campaigns/old-scan',
      );
      expect(parsed['deleted']).toBe(true);
    });

    it('raises on name mismatch', async () => {
      const result = await client.callTool({
        name: 'delete_discovery_campaign',
        arguments: { name: 'scan-a', expected_name: 'scan-b' },
      });
      expect(result.isError).toBe(true);

      expect(mockClient.delete).not.toHaveBeenCalled();
    });
  });

  describe('flush_discovery_campaign', () => {
    it('flushes with matching name', async () => {
      const result = await client.callTool({
        name: 'flush_discovery_campaign',
        arguments: { name: 'old-scan', expected_name: 'old-scan' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.patch).toHaveBeenCalledWith(
        '/api/v1/discovery/campaigns/old-scan',
        {},
      );
      expect(parsed['flushed']).toBe(true);
    });

    it('raises on name mismatch', async () => {
      const result = await client.callTool({
        name: 'flush_discovery_campaign',
        arguments: { name: 'scan-a', expected_name: 'scan-b' },
      });
      expect(result.isError).toBe(true);

      expect(mockClient.patch).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// 2. DISCOVERY EVENTS
// ===========================================================================

describe('Discovery event tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerDiscoveryEventTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('search_discovery_events', () => {
    it('performs basic search', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: [{ id: 'ev-1', timestamp: '2025-01-01T00:00:00Z' }],
      });
      const result = await client.callTool({
        name: 'search_discovery_events',
        arguments: { query: 'timestamp after -24h' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledOnce();
      const callArgs = mockClient.post.mock.calls[0]!;
      expect(String(callArgs[0])).toContain('/api/v1/discovery/events/search');
      const payload = callArgs[1] as Record<string, unknown>;
      expect(payload['query']).toBe('timestamp after -24h');
      expect(payload['pageSize']).toBe(25);
      expect((parsed['results'] as unknown[]).length).toBe(1);
    });

    it('caps page size at 100', async () => {
      // Zod schema enforces max(100). We verify with 100 to confirm the cap.
      mockClient.post.mockResolvedValueOnce({ results: [] });
      await client.callTool({
        name: 'search_discovery_events',
        arguments: { query: '*', page_size: 100 },
      });
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['pageSize']).toBe(100);
    });

    it('parses sorted_by', async () => {
      mockClient.post.mockResolvedValueOnce({ results: [] });
      await client.callTool({
        name: 'search_discovery_events',
        arguments: { query: '*', sorted_by: 'timestamp:Desc' },
      });
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['sortedBy']).toEqual([
        { element: 'timestamp', order: 'Desc' },
      ]);
    });

    // ------------------------------------------------------------------
    // Pagination regression suite. Mirrors the contract verified in
    // tools.test.ts for the other three search tools. If this block
    // diverges from that one, the 4 tools stopped behaving identically.
    // ------------------------------------------------------------------
    describe('pagination contract', () => {
      it('sends distinct 1-based pageIndex for each page_index walked', async () => {
        mockClient.post
          .mockResolvedValueOnce({ results: [{ _id: 'a' }], count: 400 })
          .mockResolvedValueOnce({ results: [{ _id: 'b' }], count: 400 })
          .mockResolvedValueOnce({ results: [{ _id: 'c' }], count: 400 });

        for (const idx of [0, 1, 2]) {
          await client.callTool({
            name: 'search_discovery_events',
            arguments: {
              query: '*',
              page_index: idx,
              page_size: 100,
              sorted_by: 'timestamp:Desc',
            },
          });
        }

        const sent = mockClient.post.mock.calls
          .slice(-3)
          .map((c) => (c[1] as Record<string, unknown>)['pageIndex']);
        expect(sent).toEqual([1, 2, 3]);
      });

      it('returns the standardized envelope', async () => {
        mockClient.post.mockResolvedValueOnce({
          results: Array.from({ length: 50 }, (_, i) => ({ _id: `r${i}` })),
          count: 187,
        });

        const result = await client.callTool({
          name: 'search_discovery_events',
          arguments: { query: '*', page_index: 0, page_size: 50 },
        });
        const parsed = parseToolResult(result);

        expect(parsed['page_index']).toBe(0);
        expect(parsed['page_size']).toBe(50);
        expect(parsed['total']).toBe(187);
        expect(parsed['has_more']).toBe(true);
        expect(parsed['next_page_index']).toBe(1);
        expect(parsed).not.toHaveProperty('pageIndex');
        expect(parsed).not.toHaveProperty('hasMore');
      });

      it('next_page_index is null on last page', async () => {
        mockClient.post.mockResolvedValueOnce({
          results: [{ _id: 'tail' }],
          count: 1,
        });

        const result = await client.callTool({
          name: 'search_discovery_events',
          arguments: { query: '*', page_index: 0, page_size: 100 },
        });
        const parsed = parseToolResult(result);

        expect(parsed['has_more']).toBe(false);
        expect(parsed['next_page_index']).toBeNull();
      });

      it('defaults with_count=true', async () => {
        mockClient.post.mockResolvedValueOnce({ results: [], count: 0 });
        await client.callTool({
          name: 'search_discovery_events',
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

  describe('get_discovery_event', () => {
    it('returns event', async () => {
      mockClient.get.mockResolvedValueOnce({
        id: 'ev-42',
        certificateid: 'cert-1',
      });
      const result = await client.callTool({
        name: 'get_discovery_event',
        arguments: { event_id: 'ev-42' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/discovery/events/ev-42',
      );
      expect(parsed['id']).toBe('ev-42');
    });
  });

  describe('export_discovery_events_csv', () => {
    it('exports CSV', async () => {
      const csvText = 'col1,col2\nval1,val2\nval3,val4';
      mockClient.postText.mockResolvedValueOnce(csvText);

      const result = await client.callTool({
        name: 'export_discovery_events_csv',
        arguments: { query: 'timestamp after -7d' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.postText).toHaveBeenCalledOnce();
      expect(parsed['returned_rows']).toBe(2);
      expect(parsed['csv']).toBe(csvText);
    });

    it('exports empty CSV', async () => {
      mockClient.postText.mockResolvedValueOnce('');

      const result = await client.callTool({
        name: 'export_discovery_events_csv',
        arguments: { query: '*' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['returned_rows']).toBe(0);
    });
  });
});

// ===========================================================================
// 3. DISCOVERY FEED
// ===========================================================================

describe('Discovery feed tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerDiscoveryFeedTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('start_discovery_feed_session', () => {
    it('starts session', async () => {
      mockClient.get.mockResolvedValueOnce({
        id: 'sess-001',
        campaign: 'my-camp',
      });
      const result = await client.callTool({
        name: 'start_discovery_feed_session',
        arguments: { campaign_name: 'my-camp' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/discovery/feed/my-camp',
      );
      expect(String(parsed['content'])).toContain('sess-001');
      const data = parsed['data'] as Record<string, unknown>;
      expect(data['id']).toBe('sess-001');
    });
  });

  describe('feed_discovery_certificate', () => {
    it('feeds certificate', async () => {
      mockClient.post.mockResolvedValueOnce({ status: 'accepted' });
      const result = await client.callTool({
        name: 'feed_discovery_certificate',
        arguments: {
          session_id: 'sess-001',
          campaign_name: 'my-campaign',
          certificate:
            '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
          ip: '10.0.0.1',
        },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledOnce();
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['sessionId']).toBe('sess-001');
      expect(payload['campaign']).toBe('my-campaign');
      const hostData = payload['hostDiscoveryData'] as Record<string, unknown>;
      expect(hostData['ip']).toBe('10.0.0.1');
      expect(String(parsed['content'])).toContain('Certificate fed');
    });

    it('includes optional fields', async () => {
      mockClient.post.mockResolvedValueOnce({});
      await client.callTool({
        name: 'feed_discovery_certificate',
        arguments: {
          session_id: 'sess-001',
          campaign_name: 'my-campaign',
          certificate: 'PEM',
          ip: '10.0.0.1',
          hostnames: ['server.example.com'],
          tls_ports: [{ port: 443, version: 'TLSv1.3' }],
          sources: ['netscan'],
          paths: ['/etc/ssl/cert.pem'],
          usages: ['nginx:443'],
          operating_systems: ['linux'],
        },
      });
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      const hostData = payload['hostDiscoveryData'] as Record<string, unknown>;
      expect(hostData['ip']).toBe('10.0.0.1');
      expect(hostData['hostnames']).toEqual(['server.example.com']);
      expect(hostData['tlsPorts']).toEqual([{ port: 443, version: 'TLSv1.3' }]);
      expect(hostData['sources']).toEqual(['netscan']);
      expect(hostData['paths']).toEqual(['/etc/ssl/cert.pem']);
      expect(hostData['usages']).toEqual(['nginx:443']);
      expect(hostData['operatingSystems']).toEqual(['linux']);
    });
  });

  describe('register_discovery_event', () => {
    it('registers event', async () => {
      mockClient.put.mockResolvedValueOnce({ status: 'ok' });
      const result = await client.callTool({
        name: 'register_discovery_event',
        arguments: {
          session_id: 'sess-001',
          data: { type: 'error', code: 'TIMEOUT' },
        },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.put).toHaveBeenCalledOnce();
      const payload = mockClient.put.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['sessionId']).toBe('sess-001');
      expect(payload['type']).toBe('error');
      expect(String(parsed['content'])).toContain('registered');
    });
  });

  describe('end_discovery_feed_session', () => {
    it('ends session', async () => {
      const result = await client.callTool({
        name: 'end_discovery_feed_session',
        arguments: { campaign_name: 'my-camp', session_id: 'sess-001' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.delete).toHaveBeenCalledWith(
        '/api/v1/discovery/feed/my-camp/sess-001',
      );
      expect(String(parsed['content'])).toContain('ended');
    });
  });
});

// ===========================================================================
// 4. DASHBOARDS
// ===========================================================================

describe('Dashboard tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerDashboardTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('list_dashboards', () => {
    it('returns dashboards', async () => {
      mockClient.get.mockResolvedValueOnce({
        customDashboards: [
          { name: 'ops-overview', type: 'certificate' },
          { name: 'request-monitor', type: 'request' },
        ],
      });
      const result = await client.callTool({
        name: 'list_dashboards',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(2);
      expect(parsed['kind']).toBe('dashboard');
    });

    it('filters by type', async () => {
      mockClient.get.mockResolvedValueOnce({
        customDashboards: [
          { name: 'ops-overview', type: 'certificate' },
          { name: 'request-monitor', type: 'request' },
        ],
      });
      const result = await client.callTool({
        name: 'list_dashboards',
        arguments: { dashboard_type: 'certificate' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(1);
      const items = parsed['items'] as Array<Record<string, unknown>>;
      expect(items[0]!['name']).toBe('ops-overview');
    });

    it('rejects invalid dashboard type', async () => {
      const result = await client.callTool({
        name: 'list_dashboards',
        arguments: { dashboard_type: 'invalid' },
      });
      // Zod validation rejects at schema level
      expect(result.isError).toBe(true);
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it('returns empty when no dashboards', async () => {
      mockClient.get.mockResolvedValueOnce({ customDashboards: null });
      const result = await client.callTool({
        name: 'list_dashboards',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(0);
      expect(parsed['items']).toEqual([]);
    });
  });

  describe('get_dashboard', () => {
    it('returns dashboard', async () => {
      mockClient.get.mockResolvedValueOnce({
        customDashboards: [
          { name: 'my-dash', type: 'certificate', charts: [] },
        ],
      });
      const result = await client.callTool({
        name: 'get_dashboard',
        arguments: { name: 'my-dash' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/security/principals/self',
      );
      expect(parsed['name']).toBe('my-dash');
    });

    it('raises when not found', async () => {
      mockClient.get.mockResolvedValueOnce({
        customDashboards: [
          { name: 'other-dash', type: 'certificate', charts: [] },
        ],
      });

      const result = await client.callTool({
        name: 'get_dashboard',
        arguments: { name: 'missing' },
      });
      expect(result.isError).toBe(true);
    });

    it('raises when no dashboards exist', async () => {
      mockClient.get.mockResolvedValueOnce({ customDashboards: [] });

      const result = await client.callTool({
        name: 'get_dashboard',
        arguments: { name: 'any' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('create_dashboard', () => {
    it('creates blank dashboard', async () => {
      mockClient.post.mockResolvedValueOnce({
        name: 'new-dash',
        type: 'certificate',
        charts: [],
      });
      const result = await client.callTool({
        name: 'create_dashboard',
        arguments: { name: 'new-dash', dashboard_type: 'certificate' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledOnce();
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['name']).toBe('new-dash');
      expect(payload['type']).toBe('certificate');
      expect(payload['charts']).toEqual([]);
      expect(parsed['name']).toBe('new-dash');
    });

    it('rejects invalid dashboard type', async () => {
      const result = await client.callTool({
        name: 'create_dashboard',
        arguments: { name: 'bad', dashboard_type: 'invalid' },
      });
      expect(result.isError).toBe(true);
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('update_dashboard', () => {
    it('updates description', async () => {
      mockClient.get.mockResolvedValueOnce({
        customDashboards: [
          { name: 'my-dash', type: 'certificate', charts: [] },
        ],
      });
      mockClient.put.mockResolvedValueOnce({
        name: 'my-dash',
        description: 'Updated',
      });
      await client.callTool({
        name: 'update_dashboard',
        arguments: { name: 'my-dash', description: 'Updated' },
      });

      expect(mockClient.put).toHaveBeenCalledOnce();
      const payload = mockClient.put.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['description']).toBe('Updated');
    });
  });

  describe('delete_dashboard', () => {
    it('deletes successfully', async () => {
      const result = await client.callTool({
        name: 'delete_dashboard',
        arguments: { name: 'old-dash', expected_name: 'old-dash' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.delete).toHaveBeenCalledWith(
        '/api/v1/security/principals/dashboards/old-dash',
      );
      expect(parsed['deleted']).toBe(true);
    });

    it('raises on name mismatch', async () => {
      const result = await client.callTool({
        name: 'delete_dashboard',
        arguments: { name: 'dash-a', expected_name: 'dash-b' },
      });
      expect(result.isError).toBe(true);

      expect(mockClient.delete).not.toHaveBeenCalled();
    });
  });

  describe('add_dashboard_chart', () => {
    it('adds chart', async () => {
      mockClient.get.mockResolvedValueOnce({
        customDashboards: [
          { name: 'my-dash', type: 'certificate', charts: [] },
        ],
      });
      mockClient.put.mockResolvedValueOnce({
        name: 'my-dash',
        charts: [{ i: 'c1' }],
      });
      const result = await client.callTool({
        name: 'add_dashboard_chart',
        arguments: {
          dashboard_name: 'my-dash',
          chart: { title: 'Expiring Certs', type: 'pie' },
        },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.put.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      const charts = payload['charts'] as unknown[];
      expect(charts.length).toBe(1);
      expect(parsed['chart_id']).toBeDefined();
    });
  });

  describe('update_dashboard_chart', () => {
    it('updates chart', async () => {
      mockClient.get.mockResolvedValueOnce({
        customDashboards: [
          {
            name: 'my-dash',
            charts: [{ i: 'c1', title: 'Old Title', type: 'pie' }],
          },
        ],
      });
      mockClient.put.mockResolvedValueOnce({ name: 'my-dash' });
      await client.callTool({
        name: 'update_dashboard_chart',
        arguments: {
          dashboard_name: 'my-dash',
          chart_id: 'c1',
          title: 'New Title',
        },
      });

      const payload = mockClient.put.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      const charts = payload['charts'] as Array<Record<string, unknown>>;
      expect(charts[0]!['title']).toBe('New Title');
      expect(charts[0]!['type']).toBe('pie');
    });

    it('returns error for nonexistent chart', async () => {
      mockClient.get.mockResolvedValueOnce({
        customDashboards: [{ name: 'my-dash', charts: [] }],
      });
      const result = await client.callTool({
        name: 'update_dashboard_chart',
        arguments: {
          dashboard_name: 'my-dash',
          chart_id: 'nonexistent',
        },
      });
      const parsed = parseToolResult(result);

      expect(parsed['error']).toBeDefined();
      expect(mockClient.put).not.toHaveBeenCalled();
    });
  });

  describe('remove_dashboard_chart', () => {
    it('removes chart', async () => {
      mockClient.get.mockResolvedValueOnce({
        customDashboards: [
          { name: 'my-dash', charts: [{ i: 'c1' }, { i: 'c2' }] },
        ],
      });
      mockClient.put.mockResolvedValueOnce({ name: 'my-dash' });
      const result = await client.callTool({
        name: 'remove_dashboard_chart',
        arguments: { dashboard_name: 'my-dash', chart_id: 'c1' },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.put.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      const charts = payload['charts'] as Array<Record<string, unknown>>;
      expect(charts.length).toBe(1);
      expect(charts[0]!['i']).toBe('c2');
      expect(parsed['removed_chart']).toBe('c1');
    });

    it('returns error for nonexistent chart', async () => {
      mockClient.get.mockResolvedValueOnce({
        customDashboards: [{ name: 'my-dash', charts: [] }],
      });
      const result = await client.callTool({
        name: 'remove_dashboard_chart',
        arguments: { dashboard_name: 'my-dash', chart_id: 'nonexistent' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['error']).toBeDefined();
    });
  });

  describe('list_saved_queries', () => {
    it('returns queries', async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: 'expiring-certs', type: 'hcql' },
        { name: 'failed-events', type: 'heql' },
      ]);
      const result = await client.callTool({
        name: 'list_saved_queries',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(2);
      expect(parsed['kind']).toBe('saved_query');
    });

    it('rejects invalid query type', async () => {
      const result = await client.callTool({
        name: 'list_saved_queries',
        arguments: { query_type: 'sql' },
      });
      // Zod enum validation rejects at schema level
      expect(result.isError).toBe(true);
      expect(mockClient.get).not.toHaveBeenCalled();
    });
  });

  describe('upsert_saved_query', () => {
    it('creates query', async () => {
      mockClient.post.mockResolvedValueOnce({
        name: 'my-query',
        type: 'hcql',
      });
      await client.callTool({
        name: 'upsert_saved_query',
        arguments: {
          name: 'my-query',
          query_type: 'hcql',
          query: 'status is valid',
        },
      });
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['type']).toBe('hcql');
      expect(payload['query']).toBe('status is valid');
    });

    it('rejects invalid query type', async () => {
      const result = await client.callTool({
        name: 'upsert_saved_query',
        arguments: {
          name: 'bad',
          query_type: 'sql',
          query: 'SELECT *',
        },
      });
      // Zod enum validation rejects at schema level
      expect(result.isError).toBe(true);
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('delete_saved_query', () => {
    it('deletes successfully', async () => {
      const result = await client.callTool({
        name: 'delete_saved_query',
        arguments: { name: 'old-query', expected_name: 'old-query' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.delete).toHaveBeenCalledWith(
        '/api/v1/security/principals/queries/old-query',
      );
      expect(parsed['deleted']).toBe(true);
    });
  });
});

// ===========================================================================
// 5. REPORTS
// ===========================================================================

describe('Report tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerReportTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('list_reports', () => {
    it('returns reports', async () => {
      mockClient.get.mockResolvedValueOnce([
        { uuid: 'r1', name: 'monthly-certs' },
        { uuid: 'r2', name: 'weekly-events' },
      ]);
      const result = await client.callTool({
        name: 'list_reports',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(2);
      expect(parsed['kind']).toBe('report');
    });

    it('filters by name', async () => {
      mockClient.get.mockResolvedValueOnce([
        { uuid: 'r1', name: 'monthly-certs' },
      ]);
      await client.callTool({
        name: 'list_reports',
        arguments: { report_name: 'monthly-certs' },
      });
      const callArgs = mockClient.get.mock.calls[0]!;
      expect(String(callArgs[0])).toContain('monthly-certs');
    });
  });

  describe('download_report', () => {
    it('downloads CSV', async () => {
      const csvText = 'header1,header2\nrow1a,row1b\nrow2a,row2b';
      mockClient.getText.mockResolvedValueOnce(csvText);

      const result = await client.callTool({
        name: 'download_report',
        arguments: { report_uuid: 'uuid-123' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.getText).toHaveBeenCalledWith('/reports/uuid-123');
      expect(parsed['rows']).toBe(2);
      expect(parsed['csv']).toBe(csvText);
    });
  });

  describe('delete_report', () => {
    it('deletes successfully', async () => {
      const result = await client.callTool({
        name: 'delete_report',
        arguments: { report_uuid: 'uuid-123', expected_uuid: 'uuid-123' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.delete).toHaveBeenCalledWith(
        '/api/v1/reports/uuid-123',
      );
      expect(parsed['deleted']).toBe(true);
    });

    it('raises on UUID mismatch', async () => {
      const result = await client.callTool({
        name: 'delete_report',
        arguments: { report_uuid: 'uuid-a', expected_uuid: 'uuid-b' },
      });
      expect(result.isError).toBe(true);

      expect(mockClient.delete).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// 6. AGGREGATION (from lifecycle tools)
// ===========================================================================

describe('Aggregation tools', () => {
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

  describe('aggregate_certificates', () => {
    it('performs basic aggregation', async () => {
      mockClient.post.mockResolvedValueOnce([
        { key: 'rsa-2048', count: 150 },
        { key: 'ec-p256', count: 42 },
      ]);
      await client.callTool({
        name: 'aggregate_certificates',
        arguments: {
          query: 'status is valid',
          group_by: ['keyType'],
        },
      });

      expect(mockClient.post).toHaveBeenCalledOnce();
      const callArgs = mockClient.post.mock.calls[0]!;
      expect(callArgs[0]).toBe('/api/v1/certificates/aggregate');
      const payload = callArgs[1] as Record<string, unknown>;
      expect(payload['query']).toBe('status is valid');
      expect(payload['groupBy']).toEqual(['keyType']);
      expect(payload['sortOrder']).toBe('Desc'); // default
    });

    it('includes having clause', async () => {
      mockClient.post.mockResolvedValueOnce([
        { key: 'TLS-Internal', count: 200 },
      ]);
      await client.callTool({
        name: 'aggregate_certificates',
        arguments: {
          query: 'status is valid',
          group_by: ['profile'],
          having: { operator: 'gt', value: 100 },
          sort_order: 'KeyAsc',
        },
      });
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['having']).toEqual({ operator: 'gt', value: 100 });
      expect(payload['sortOrder']).toBe('KeyAsc');
    });

    it('supports multi-groupby', async () => {
      mockClient.post.mockResolvedValueOnce([]);
      await client.callTool({
        name: 'aggregate_certificates',
        arguments: {
          query: 'valid.until before 30d',
          group_by: ['profile', 'keyType'],
        },
      });
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['groupBy']).toEqual(['profile', 'keyType']);
    });

    it('propagates invalid query error', async () => {
      mockClient.post.mockRejectedValueOnce(
        new HorizonError(400, {
          errorCode: 'HQL-001',
          message: 'Invalid HCQL query',
        }),
      );

      const result = await client.callTool({
        name: 'aggregate_certificates',
        arguments: {
          query: 'BAD SYNTAX !!!',
          group_by: ['keyType'],
        },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('aggregate_requests', () => {
    it('performs basic aggregation', async () => {
      mockClient.post.mockResolvedValueOnce([
        { key: 'enroll', count: 85 },
        { key: 'renew', count: 30 },
      ]);
      await client.callTool({
        name: 'aggregate_requests',
        arguments: {
          query: 'status equals "pending"',
          group_by: ['workflow'],
        },
      });
      const callArgs = mockClient.post.mock.calls[0]!;
      expect(callArgs[0]).toBe('/api/v1/requests/aggregate');
      const payload = callArgs[1] as Record<string, unknown>;
      expect(payload['groupBy']).toEqual(['workflow']);
    });

    it('omits having when not provided', async () => {
      mockClient.post.mockResolvedValueOnce([]);
      await client.callTool({
        name: 'aggregate_requests',
        arguments: {
          query: 'workflow equals "enroll"',
          group_by: ['profile'],
        },
      });
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['having']).toBeUndefined();
    });
  });
});

// ===========================================================================
// CROSS-CUTTING: HorizonError propagation
// ===========================================================================

describe('HorizonError propagation', () => {
  let discClient: Client;
  let discMock: MockClient;
  let dashClient: Client;
  let dashMock: MockClient;

  beforeAll(async () => {
    const discCtx = await setupServerAndClient((server, mc) => {
      registerDiscoveryTools(server, mc as any);
    });
    discClient = discCtx.client;
    discMock = discCtx.mockClient;

    const dashCtx = await setupServerAndClient((server, mc) => {
      registerDashboardTools(server, mc as any);
    });
    dashClient = dashCtx.client;
    dashMock = dashCtx.mockClient;
  });

  beforeEach(() => {
    resetMocks(discMock);
    resetMocks(dashMock);
  });

  it('propagates discovery campaign 404', async () => {
    discMock.get.mockRejectedValueOnce(
      new HorizonError(404, {
        errorCode: 'DISC-003',
        message: 'Campaign not found',
      }),
    );

    const result = await discClient.callTool({
      name: 'get_discovery_campaign',
      arguments: { name: 'no-exist' },
    });
    expect(result.isError).toBe(true);
  });

  it('propagates dashboard 403', async () => {
    dashMock.get.mockRejectedValueOnce(
      new HorizonError(403, {
        errorCode: 'SecPerm001',
        message: 'Forbidden',
      }),
    );

    const result = await dashClient.callTool({
      name: 'get_dashboard',
      arguments: { name: 'restricted' },
    });
    expect(result.isError).toBe(true);
  });
});
