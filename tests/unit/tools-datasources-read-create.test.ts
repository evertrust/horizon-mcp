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
describe('list_datasources', () => {
  it('returns all', async () => {
    mockClient.get.mockResolvedValueOnce([
      { name: 'corp-ldap', type: 'ldap' },
      { name: 'dns-check', type: 'dns' },
      { name: 'api-lookup', type: 'rest' },
    ]);
    const result = await client.callTool({
      name: 'list_datasources',
      arguments: {},
    });
    const parsed = parseToolResult(result);

    expect(mockClient.get).toHaveBeenCalledWith('/api/v1/datasources');
    expect(parsed['count']).toBe(3);
    expect(parsed['kind']).toBe('datasource');
    expect(parsed['truncated']).toBe(false);
  });

  it('filters by type', async () => {
    mockClient.get.mockResolvedValueOnce([
      { name: 'corp-ldap', type: 'ldap' },
      { name: 'dns-check', type: 'dns' },
    ]);
    const result = await client.callTool({
      name: 'list_datasources',
      arguments: { ds_type: 'dns' },
    });
    const parsed = parseToolResult(result);

    expect(parsed['count']).toBe(1);
    const items = parsed['items'] as Array<Record<string, unknown>>;
    expect(items[0]!['name']).toBe('dns-check');
  });

  it('filters by name', async () => {
    mockClient.get.mockResolvedValueOnce([
      { name: 'corp-ldap', type: 'ldap' },
      { name: 'corp-dns', type: 'dns' },
      { name: 'api-lookup', type: 'rest' },
    ]);
    const result = await client.callTool({
      name: 'list_datasources',
      arguments: { name_contains: 'corp' },
    });
    const parsed = parseToolResult(result);

    expect(parsed['count']).toBe(2);
  });

  it('rejects invalid type', async () => {
    const result = await client.callTool({
      name: 'list_datasources',
      arguments: { ds_type: 'sql' },
    });
    const parsed = parseToolResult(result);

    expect(parsed['error']).toBeDefined();
    expect(parsed['valid_types']).toBeDefined();
    expect(mockClient.get).not.toHaveBeenCalled();
  });

  it('truncates results', async () => {
    mockClient.get.mockResolvedValueOnce(
      Array.from({ length: 60 }, (_, i) => ({ name: `ds-${i}`, type: 'dns' })),
    );
    const result = await client.callTool({
      name: 'list_datasources',
      arguments: { max_items: 5 },
    });
    const parsed = parseToolResult(result);

    expect(parsed['truncated']).toBe(true);
    expect(parsed['count']).toBe(5);
    expect(parsed['total_available']).toBe(60);
  });
});

// ===========================================================================
// 2. GET DATASOURCE
// ===========================================================================

describe('get_datasource', () => {
  it('returns datasource', async () => {
    mockClient.get.mockResolvedValueOnce({
      name: 'corp-ldap',
      type: 'ldap',
      hostname: 'ldaps://ldap.corp.local',
    });
    const result = await client.callTool({
      name: 'get_datasource',
      arguments: { name: 'corp-ldap' },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.get).toHaveBeenCalledWith(
      '/api/v1/datasources/corp-ldap',
    );
    expect(parsed['name']).toBe('corp-ldap');
    expect(parsed['type']).toBe('ldap');
  });

  it('raises when not found', async () => {
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

// ===========================================================================
// 3. CREATE DNS DATASOURCE
// ===========================================================================

describe('create_dns_datasource', () => {
  it('creates minimal DNS datasource', async () => {
    mockClient.post.mockResolvedValueOnce({
      name: 'dns-check',
      type: 'dns',
    });
    const result = await client.callTool({
      name: 'create_dns_datasource',
      arguments: {
        name: 'dns-check',
        lookup: '{{csr.san.dnsname.1}}',
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.post).toHaveBeenCalledOnce();
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload['type']).toBe('dns');
    expect(payload['name']).toBe('dns-check');
    expect(payload['lookup']).toBe('{{csr.san.dnsname.1}}');
    expect(payload['port']).toBe(53);
    expect(payload['timeout']).toBe('10 seconds');
    expect(parsed['status']).toBe('created');
    expect(parsed['kind']).toBe('datasource');
  });

  it('creates full DNS datasource', async () => {
    mockClient.post.mockResolvedValueOnce({
      name: 'dns-full',
      type: 'dns',
    });
    await client.callTool({
      name: 'create_dns_datasource',
      arguments: {
        name: 'dns-full',
        lookup: '{{hostname}}',
        host: '10.0.0.53',
        port: 5353,
        timeout: '30s',
        record_types: ['a', 'cname'],
        description: 'Corporate DNS check',
        display_name: [{ lang: 'en', value: 'DNS Check' }],
      },
    });
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload['host']).toBe('10.0.0.53');
    expect(payload['port']).toBe(5353);
    expect(payload['timeout']).toBe('30s');
    expect(payload['recordTypes']).toEqual(['a', 'cname']);
    expect(payload['description']).toBe('Corporate DNS check');
    expect(payload['displayName']).toEqual([
      { lang: 'en', value: 'DNS Check' },
    ]);
  });

  it('rejects invalid record type', async () => {
    const result = await client.callTool({
      name: 'create_dns_datasource',
      arguments: {
        name: 'bad-dns',
        lookup: '{{hostname}}',
        record_types: ['a', 'mx'],
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed['error']).toBeDefined();
    expect(JSON.stringify(parsed)).toContain('mx');
    expect(mockClient.post).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. CREATE LDAP DATASOURCE
// ===========================================================================

describe('create_ldap_datasource', () => {
  it('creates minimal LDAP datasource', async () => {
    mockClient.post.mockResolvedValueOnce({
      name: 'corp-ldap',
      type: 'ldap',
    });
    const result = await client.callTool({
      name: 'create_ldap_datasource',
      arguments: {
        name: 'corp-ldap',
        hostname: 'ldaps://ldap.corp.local',
        credentials: 'ldap-bind-creds',
        base_dn: 'DC=corp,DC=local',
        filter: '(sAMAccountName={{username}})',
        secure: true,
        timeout: '10s',
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.post).toHaveBeenCalledOnce();
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload['type']).toBe('ldap');
    expect(payload['name']).toBe('corp-ldap');
    expect(payload['hostname']).toBe('ldaps://ldap.corp.local');
    expect(payload['credentials']).toBe('ldap-bind-creds');
    expect(payload['baseDn']).toBe('DC=corp,DC=local');
    expect(payload['filter']).toBe('(sAMAccountName={{username}})');
    expect(payload['secure']).toBe(true);
    expect(payload['timeout']).toBe('10s');
    expect(parsed['status']).toBe('created');
  });

  it('creates full LDAP datasource', async () => {
    mockClient.post.mockResolvedValueOnce({
      name: 'corp-ldap-full',
      type: 'ldap',
    });
    await client.callTool({
      name: 'create_ldap_datasource',
      arguments: {
        name: 'corp-ldap-full',
        hostname: 'ldaps://ldap.corp.local',
        credentials: 'ldap-bind-creds',
        base_dn: 'DC=corp,DC=local',
        filter: '(cn={{cn}})',
        secure: true,
        timeout: '10s',
        port: 636,
        disable_hostname_validation: true,
        attributes: [{ key: 'cn', multi: false, selected: true }],
        limit: 1,
        follow_referrals: true,
        proxy: 'corp-proxy',
        description: 'Corporate LDAP lookup',
      },
    });
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload['port']).toBe(636);
    expect(payload['disableHostnameValidation']).toBe(true);
    expect(payload['attributes']).toEqual([
      { key: 'cn', multi: false, selected: true },
    ]);
    expect(payload['limit']).toBe(1);
    expect(payload['followReferrals']).toBe(true);
    expect(payload['proxy']).toBe('corp-proxy');
  });
});

// ===========================================================================
// 5. CREATE REST DATASOURCE
// ===========================================================================

describe('create_rest_datasource', () => {
  it('creates minimal REST datasource', async () => {
    mockClient.post.mockResolvedValueOnce({
      name: 'api-lookup',
      type: 'rest',
    });
    const result = await client.callTool({
      name: 'create_rest_datasource',
      arguments: {
        name: 'api-lookup',
        method: 'GET',
        url: 'https://api.example.com/v1/check/{{hostname}}',
        authentication_type: 'bearer',
        credentials: 'api-token',
        timeout: '10s',
        expected_http_codes: [200],
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.post).toHaveBeenCalledOnce();
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload['type']).toBe('rest');
    expect(payload['method']).toBe('GET');
    expect(payload['url']).toBe(
      'https://api.example.com/v1/check/{{hostname}}',
    );
    expect(payload['authenticationType']).toBe('bearer');
    expect(payload['credentials']).toBe('api-token');
    expect(payload['expectedHttpCodes']).toEqual([200]);
    expect(parsed['status']).toBe('created');
  });

  it('rejects invalid auth type', async () => {
    const result = await client.callTool({
      name: 'create_rest_datasource',
      arguments: {
        name: 'bad-rest',
        method: 'GET',
        url: 'https://example.com',
        authentication_type: 'oauth2',
        timeout: '10s',
        expected_http_codes: [200],
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed['error']).toBeDefined();
    expect(parsed['valid_types']).toBeDefined();
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  it('rejects missing credentials for auth type', async () => {
    const result = await client.callTool({
      name: 'create_rest_datasource',
      arguments: {
        name: 'bad-rest',
        method: 'GET',
        url: 'https://example.com',
        authentication_type: 'basic',
        timeout: '10s',
        expected_http_codes: [200],
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed['error']).toBeDefined();
    expect(String(parsed['error'])).toContain('credentials');
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  it('rejects empty expected codes', async () => {
    const result = await client.callTool({
      name: 'create_rest_datasource',
      arguments: {
        name: 'bad-rest',
        method: 'GET',
        url: 'https://example.com',
        authentication_type: 'noauth',
        timeout: '10s',
        expected_http_codes: [],
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed['error']).toBeDefined();
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  it('accepts noauth without credentials', async () => {
    mockClient.post.mockResolvedValueOnce({
      name: 'public-api',
      type: 'rest',
    });
    const result = await client.callTool({
      name: 'create_rest_datasource',
      arguments: {
        name: 'public-api',
        method: 'GET',
        url: 'https://api.example.com/check',
        authentication_type: 'noauth',
        timeout: '10s',
        expected_http_codes: [200],
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed['status']).toBe('created');
  });

  it('creates with full payload', async () => {
    mockClient.post.mockResolvedValueOnce({
      name: 'cmdb-api',
      type: 'rest',
    });
    await client.callTool({
      name: 'create_rest_datasource',
      arguments: {
        name: 'cmdb-api',
        method: 'POST',
        url: 'https://cmdb.corp.local/api/hosts',
        authentication_type: 'custom',
        credentials: 'cmdb-token',
        timeout: '15s',
        expected_http_codes: [200, 201],
        headers: [
          {
            name: 'X-Custom-Auth',
            value: 'Token {{credentials.raw}}',
          },
        ],
        payload_type: 'json',
        payload: 'hostname={{csr.san.dnsname.1}}',
        proxy: 'corp-proxy',
        attributes: [{ key: 'owner', multi: false, selected: true }],
      },
    });
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload['headers']).toEqual([
      { name: 'X-Custom-Auth', value: 'Token {{credentials.raw}}' },
    ]);
    expect(payload['payloadType']).toBe('json');
    expect(payload['payload']).toBe('hostname={{csr.san.dnsname.1}}');
    expect(payload['proxy']).toBe('corp-proxy');
  });
});

// ===========================================================================
// 6. UPDATE DATASOURCE
// ===========================================================================
