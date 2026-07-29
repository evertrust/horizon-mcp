/**
 * Certificate Authority config CRUD tool-layer unit tests.
 *
 * Verifies the cas.ts tool family (flat, fully typed): tool registration,
 * snake_case -> camelCase payload mapping (incl. certificate required on both
 * create and update), mandatory-field enforcement, the GET-strip-merge-PUT
 * update cycle (PUT on collection root, _id + tenant stripped), and the delete
 * safety echo.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCaTools } from '../../src/tools/config/cas.js';

function createMockClient() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(null),
    deleteWithBody: vi.fn().mockResolvedValue(null),
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

function parse(result: unknown): Record<string, unknown> {
  const r = result as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}
function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerCaTools(
    server,
    mc as unknown as Parameters<typeof registerCaTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('ca tools registration', () => {
  it('registers the expected ca tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_cas',
      'get_ca',
      'create_ca',
      'update_ca',
      'delete_ca',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('list_cas empty collection normalization', () => {
  it.each([
    ['an empty bare array', []],
    ['an envelope with an empty items array', { items: [] }],
    ['an object with the collection field absent', {}],
  ])('returns no items for %s', async (_description, upstreamResponse) => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce(upstreamResponse);

    const res = await client.callTool({ name: 'list_cas', arguments: {} });

    expect(parse(res)).toEqual({
      items: [],
      count: 0,
      total_available: 0,
      truncated: false,
      kind: 'ca',
    });
  });
});

describe('create_ca (mandatory + snake_case -> camelCase mapping)', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('maps inputs to the exact camelCase API payload', async () => {
    mc.post.mockResolvedValueOnce({ name: 'root-ca' });
    const res = await client.callTool({
      name: 'create_ca',
      arguments: {
        name: 'root-ca',
        certificate:
          '-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----',
        trusted_for_client_authentication: true,
        trusted_for_server_authentication: false,
        outdated_revocation_status_policy: 'unknown',
        public: true,
        crl_url: 'http://crl.example.com/root.crl',
        refresh: '1h',
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/cas', {
      name: 'root-ca',
      certificate:
        '-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----',
      trustedForClientAuthentication: true,
      trustedForServerAuthentication: false,
      outdatedRevocationStatusPolicy: 'unknown',
      public: true,
      crlUrl: 'http://crl.example.com/root.crl',
      refresh: '1h',
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('rejects a missing mandatory field (certificate) and does NOT POST', async () => {
    const res = await client.callTool({
      name: 'create_ca',
      arguments: {
        name: 'root-ca',
        trusted_for_client_authentication: true,
        trusted_for_server_authentication: false,
        outdated_revocation_status_policy: 'unknown',
        public: true,
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an invalid outdated_revocation_status_policy enum', async () => {
    const res = await client.callTool({
      name: 'create_ca',
      arguments: {
        name: 'root-ca',
        certificate: 'pem',
        trusted_for_client_authentication: true,
        trusted_for_server_authentication: false,
        outdated_revocation_status_policy: 'bogus',
        public: true,
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_ca (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id + tenant, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      tenant: 't1',
      name: 'root-ca',
      certificate: 'STORED-PEM',
      trustedForClientAuthentication: false,
      trustedForServerAuthentication: false,
      outdatedRevocationStatusPolicy: 'revoked',
      public: false,
      proxy: 'p1',
    });
    mc.put.mockResolvedValueOnce({ name: 'root-ca' });
    await client.callTool({
      name: 'update_ca',
      arguments: {
        name: 'root-ca',
        certificate: 'SENT-PEM',
        trusted_for_client_authentication: true,
        trusted_for_server_authentication: true,
        outdated_revocation_status_policy: 'lastavailablestatus',
        public: true,
      },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/cas/root-ca');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/cas');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).not.toHaveProperty('tenant');
    expect(putBody).toMatchObject({
      name: 'root-ca',
      certificate: 'SENT-PEM',
      trustedForClientAuthentication: true,
      trustedForServerAuthentication: true,
      outdatedRevocationStatusPolicy: 'lastavailablestatus',
      public: true,
      proxy: 'p1',
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'root-ca',
      certificate: 'STORED-PEM',
      trustedForClientAuthentication: true,
      trustedForServerAuthentication: true,
      outdatedRevocationStatusPolicy: 'unknown',
      public: true,
      proxy: 'p1',
    });
    await client.callTool({
      name: 'update_ca',
      arguments: {
        name: 'root-ca',
        certificate: 'SENT-PEM',
        trusted_for_client_authentication: true,
        trusted_for_server_authentication: true,
        outdated_revocation_status_policy: 'unknown',
        public: true,
        clear_fields: ['proxy'],
      },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['proxy']).toBeNull();
  });

  it('rejects a missing mandatory update field (certificate) and does NOT PUT', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'update_ca',
      arguments: {
        name: 'root-ca',
        trusted_for_client_authentication: true,
        trusted_for_server_authentication: true,
        outdated_revocation_status_policy: 'unknown',
        public: true,
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.get).not.toHaveBeenCalled();
    expect(mc.put).not.toHaveBeenCalled();
  });
});

describe('delete_ca safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_ca',
      arguments: { name: 'root-ca', expected_name: 'root-ca' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/cas/root-ca');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_ca',
      arguments: { name: 'root-ca', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
