import type { Client } from '@modelcontextprotocol/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerDashboardTools } from '../../src/tools/dashboards.js';
import {
  type MockClient,
  parseToolResult,
  resetMocks,
  setupServerAndClient,
} from './support/tool-harness.js';

describe('Dashboard tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient([
      (server, mc) => {
        registerDashboardTools(server, mc as any);
      },
    ]);
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
