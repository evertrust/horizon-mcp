/**
 * DCV policy config-tool unit tests (flat/typed, Horizon 2.10).
 *
 * Verifies registration, create payload (mandatory + optional renewalPolicy/
 * triggers/filter), the GET-strip-merge-PUT update on the collection root with
 * _id/tenant stripped, mandatory-field enforcement, and the delete safety echo.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDcvPolicyTools } from '../../src/tools/config/dcv-policies.js';

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

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerDcvPolicyTools(
    server,
    mc as unknown as Parameters<typeof registerDcvPolicyTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('dcv policy tools registration', () => {
  it('registers the expected dcv_policy tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_dcv_policies',
      'get_dcv_policy',
      'create_dcv_policy',
      'update_dcv_policy',
      'delete_dcv_policy',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_dcv_policy', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs the collection with mandatory fields and optional blocks', async () => {
    mc.post.mockResolvedValueOnce({ name: 'p1' });
    await client.callTool({
      name: 'create_dcv_policy',
      arguments: {
        name: 'p1',
        provider: 'prov1',
        provisioner: 'pror1',
        executionTimeout: '1 hour',
        retryDelay: '1 hour',
        enabled: false,
        renewalPolicy: { cron: '0 0 0 1 1 ? 2099', renewalPeriod: '7 days' },
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/dcv/policies', {
      name: 'p1',
      provider: 'prov1',
      provisioner: 'pror1',
      executionTimeout: '1 hour',
      retryDelay: '1 hour',
      enabled: false,
      renewalPolicy: { cron: '0 0 0 1 1 ? 2099', renewalPeriod: '7 days' },
    });
  });

  it('omits optional fields when not supplied', async () => {
    mc.post.mockResolvedValueOnce({ name: 'p2' });
    await client.callTool({
      name: 'create_dcv_policy',
      arguments: {
        name: 'p2',
        provider: 'prov1',
        provisioner: 'pror1',
        executionTimeout: '1 hour',
        retryDelay: '1 hour',
        enabled: true,
      },
    });
    const body = mc.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('filter');
    expect(body).not.toHaveProperty('renewalPolicy');
    expect(body).not.toHaveProperty('triggers');
  });

  it('rejects a missing mandatory field (provider) via schema', async () => {
    const res = await client.callTool({
      name: 'create_dcv_policy',
      arguments: {
        name: 'p3',
        provisioner: 'pror1',
        executionTimeout: '1 hour',
        retryDelay: '1 hour',
        enabled: true,
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_dcv_policy (GET-strip-merge-PUT on collection)', () => {
  it('GETs the item, strips _id/tenant, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      tenant: 't',
      name: 'p1',
      provider: 'prov1',
      provisioner: 'pror1',
      executionTimeout: '1 hour',
      retryDelay: '1 hour',
      enabled: false,
    });
    mc.put.mockResolvedValueOnce({ name: 'p1' });
    await client.callTool({
      name: 'update_dcv_policy',
      arguments: { name: 'p1', executionTimeout: '2 hours' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/dcv/policies/p1');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/dcv/policies');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).not.toHaveProperty('tenant');
    expect(putBody).toMatchObject({
      name: 'p1',
      provider: 'prov1',
      provisioner: 'pror1',
      executionTimeout: '2 hours',
    });
  });
});

describe('delete_dcv_policy safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_dcv_policy',
      arguments: { name: 'p1', expected_name: 'p1' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/dcv/policies/p1');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_dcv_policy',
      arguments: { name: 'p1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
