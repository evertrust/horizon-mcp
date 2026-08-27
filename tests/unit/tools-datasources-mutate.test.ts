import type { Client } from '@modelcontextprotocol/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HorizonError } from '../../src/client/errors.js';
import { registerDatasourceTools } from '../../src/tools/datasources.js';
import {
  type MockClient,
  parseToolResult,
  resetMocks,
  setupServerAndClient,
} from './support/tool-harness.js';

let client: Client;
let mockClient: MockClient;

beforeAll(async () => {
  const ctx = await setupServerAndClient([
    (server, client) => {
      registerDatasourceTools(server, client as any);
    },
  ]);
  client = ctx.client;
  mockClient = ctx.mockClient;
});

beforeEach(() => {
  resetMocks(mockClient);
});
describe('update_datasource', () => {
  it('updates DNS lookup', async () => {
    mockClient.get.mockResolvedValueOnce({
      _id: 'abc',
      name: 'dns-check',
      type: 'dns',
      lookup: '{{old}}',
      port: 53,
    });
    mockClient.put.mockResolvedValueOnce({
      name: 'dns-check',
      lookup: '{{new}}',
    });
    const result = await client.callTool({
      name: 'update_datasource',
      arguments: { name: 'dns-check', lookup: '{{new}}' },
    });
    const parsed = parseToolResult(result);

    expect(parsed['status']).toBe('updated');
    expect(parsed['kind']).toBe('datasource');

    // Verify GET-strip-merge-PUT cycle
    expect(mockClient.get).toHaveBeenCalledWith(
      '/api/v1/datasources/dns-check',
    );
    const putPayload = mockClient.put.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(putPayload['lookup']).toBe('{{new}}');
    expect(putPayload['_id']).toBeUndefined(); // stripped
  });

  it('updates LDAP filter', async () => {
    mockClient.get.mockResolvedValueOnce({
      _id: 'def',
      name: 'corp-ldap',
      type: 'ldap',
      filter: '(cn={{old}})',
      baseDn: 'DC=corp,DC=local',
    });
    mockClient.put.mockResolvedValueOnce({ name: 'corp-ldap' });
    await client.callTool({
      name: 'update_datasource',
      arguments: {
        name: 'corp-ldap',
        filter: '(sAMAccountName={{new}})',
      },
    });
    const putPayload = mockClient.put.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(putPayload['filter']).toBe('(sAMAccountName={{new}})');
    expect(putPayload['baseDn']).toBe('DC=corp,DC=local'); // preserved
  });

  it('rejects invalid record types', async () => {
    const result = await client.callTool({
      name: 'update_datasource',
      arguments: { name: 'dns-check', record_types: ['mx'] },
    });
    const parsed = parseToolResult(result);

    expect(parsed['error']).toBeDefined();
    expect(mockClient.get).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 7. DELETE DATASOURCE
// ===========================================================================

describe('delete_datasource', () => {
  it('deletes with matching name', async () => {
    const result = await client.callTool({
      name: 'delete_datasource',
      arguments: { name: 'old-ds', expected_name: 'old-ds' },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.delete).toHaveBeenCalledWith(
      '/api/v1/datasources/old-ds',
    );
    expect(parsed['deleted']).toBe(true);
    expect(parsed['kind']).toBe('datasource');
  });

  it('raises on name mismatch', async () => {
    const result = await client.callTool({
      name: 'delete_datasource',
      arguments: { name: 'ds-a', expected_name: 'ds-b' },
    });
    expect(result.isError).toBe(true);

    expect(mockClient.delete).not.toHaveBeenCalled();
  });

  it('propagates referenced datasource error', async () => {
    mockClient.delete.mockRejectedValueOnce(
      new HorizonError(400, {
        errorCode: 'DS-005',
        message: 'Referenced DataSource - cannot delete',
      }),
    );

    const result = await client.callTool({
      name: 'delete_datasource',
      arguments: { name: 'in-use-ds', expected_name: 'in-use-ds' },
    });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// 8. TEST DATASOURCE
// ===========================================================================

describe('test_datasource', () => {
  it('tests DNS datasource', async () => {
    mockClient.patch.mockResolvedValueOnce({
      name: 'dns-check',
      type: 'dns',
      status: 'success',
      dictionary: [{ key: 'cname', value: 'web01.paas.internal' }],
    });
    const result = await client.callTool({
      name: 'test_datasource',
      arguments: {
        ds_type: 'dns',
        name: 'dns-check',
        lookup: '{{hostname}}',
        context: { hostname: 'app.corp.local' },
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.patch).toHaveBeenCalledOnce();
    const body = mockClient.patch.mock.calls[0]![1] as Record<string, unknown>;
    const ds = body['ds'] as Record<string, unknown>;
    expect(ds['type']).toBe('dns');
    expect(ds['lookup']).toBe('{{hostname}}');
    const ctx = body['context'] as Array<Record<string, string>>;
    expect(ctx).toEqual([{ key: 'hostname', value: 'app.corp.local' }]);
    expect(parsed['status']).toBe('success');
  });

  it('requires lookup for DNS', async () => {
    const result = await client.callTool({
      name: 'test_datasource',
      arguments: { ds_type: 'dns', name: 'dns-check' },
    });
    const parsed = parseToolResult(result);

    expect(parsed['error']).toBeDefined();
    expect(mockClient.patch).not.toHaveBeenCalled();
  });

  it('tests LDAP datasource', async () => {
    mockClient.patch.mockResolvedValueOnce({
      name: 'corp-ldap',
      type: 'ldap',
      status: 'success',
      computedDN: 'DC=corp,DC=local',
      computedFilter: '(sAMAccountName=jdoe)',
      dictionary: [{ key: 'department', value: 'Engineering' }],
    });
    const result = await client.callTool({
      name: 'test_datasource',
      arguments: {
        ds_type: 'ldap',
        name: 'corp-ldap',
        hostname: 'ldaps://ldap.corp.local',
        credentials: 'ldap-creds',
        base_dn: 'DC=corp,DC=local',
        filter: '(sAMAccountName={{username}})',
        secure: true,
        context: { username: 'jdoe' },
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed['status']).toBe('success');
    expect(parsed['computedFilter']).toBe('(sAMAccountName=jdoe)');
  });

  it('requires LDAP fields', async () => {
    const result = await client.callTool({
      name: 'test_datasource',
      arguments: {
        ds_type: 'ldap',
        name: 'bad-ldap',
        hostname: 'ldaps://ldap.corp.local',
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed['error']).toBeDefined();
    expect(mockClient.patch).not.toHaveBeenCalled();
  });

  it('tests REST datasource', async () => {
    mockClient.patch.mockResolvedValueOnce({
      name: 'api-check',
      type: 'rest',
      status: 'success',
      responseCode: 200,
      dictionary: [{ key: 'owner', value: 'team-platform' }],
    });
    const result = await client.callTool({
      name: 'test_datasource',
      arguments: {
        ds_type: 'rest',
        name: 'api-check',
        method: 'GET',
        url: 'https://api.example.com/check/{{hostname}}',
        authentication_type: 'noauth',
        timeout: '10s',
        expected_http_codes: [200],
        context: { hostname: 'web01.corp.local' },
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed['status']).toBe('success');
    expect(parsed['responseCode']).toBe(200);
  });

  it('requires REST fields', async () => {
    const result = await client.callTool({
      name: 'test_datasource',
      arguments: {
        ds_type: 'rest',
        name: 'bad-rest',
        method: 'GET',
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed['error']).toBeDefined();
    expect(mockClient.patch).not.toHaveBeenCalled();
  });

  it('rejects invalid datasource type', async () => {
    const result = await client.callTool({
      name: 'test_datasource',
      arguments: { ds_type: 'graphql', name: 'bad' },
    });
    const parsed = parseToolResult(result);

    expect(parsed['error']).toBeDefined();
    expect(parsed['valid_types']).toBeDefined();
  });

  it('supports DNS record types', async () => {
    mockClient.patch.mockResolvedValueOnce({
      status: 'success',
      dictionary: [],
    });
    await client.callTool({
      name: 'test_datasource',
      arguments: {
        ds_type: 'dns',
        name: 'dns-cname-only',
        lookup: '{{hostname}}',
        record_types: ['cname'],
        host: '10.0.0.53',
        context: { hostname: 'app.corp.local' },
      },
    });
    const body = mockClient.patch.mock.calls[0]![1] as Record<string, unknown>;
    const ds = body['ds'] as Record<string, unknown>;
    expect(ds['recordTypes']).toEqual(['cname']);
    expect(ds['host']).toBe('10.0.0.53');
  });
});

// ===========================================================================
// CROSS-CUTTING: HorizonError propagation
// ===========================================================================

describe('Datasource error propagation', () => {
  it('propagates already-exists on create', async () => {
    mockClient.post.mockRejectedValueOnce(
      new HorizonError(400, {
        errorCode: 'DS-004',
        message: 'DataSource already exists',
      }),
    );

    const result = await client.callTool({
      name: 'create_dns_datasource',
      arguments: { name: 'existing-ds', lookup: '{{hostname}}' },
    });
    expect(result.isError).toBe(true);
  });

  it('propagates 404 on get', async () => {
    mockClient.get.mockRejectedValueOnce(
      new HorizonError(404, {
        errorCode: 'DS-003',
        message: 'DataSource not found',
      }),
    );

    const result = await client.callTool({
      name: 'get_datasource',
      arguments: { name: 'nonexistent' },
    });
    expect(result.isError).toBe(true);
  });
});
