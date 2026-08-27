import type { Client } from '@modelcontextprotocol/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HorizonError } from '../../src/client/errors.js';
import { registerDashboardTools } from '../../src/tools/dashboards.js';
import { registerDiscoveryTools } from '../../src/tools/discovery.js';
import { registerLifecycleTools } from '../../src/tools/lifecycle.js';
import { registerReportTools } from '../../src/tools/reports.js';
import {
  type MockClient,
  parseToolResult,
  resetMocks,
  setupServerAndClient,
} from './support/tool-harness.js';

describe('Report tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient([
      (server, mc) => {
        registerReportTools(server, mc as any);
      },
    ]);
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
    const ctx = await setupServerAndClient([
      (server, mc) => {
        registerLifecycleTools(server, mc as any);
      },
    ]);
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
    const discCtx = await setupServerAndClient([
      (server, mc) => {
        registerDiscoveryTools(server, mc as any);
      },
    ]);
    discClient = discCtx.client;
    discMock = discCtx.mockClient;

    const dashCtx = await setupServerAndClient([
      (server, mc) => {
        registerDashboardTools(server, mc as any);
      },
    ]);
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
