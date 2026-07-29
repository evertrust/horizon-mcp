/**
 * DCV provider config-tool unit tests (flat/typed, Horizon 2.10).
 *
 * Verifies registration, the create payload (type/endpoint/credentials/timeout
 * required, proxy optional), mandatory-field enforcement, GET-merge-PUT update
 * on the collection root, and the delete safety echo.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDcvProviderTools } from '../../src/tools/config/dcv-providers.js';

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
  registerDcvProviderTools(
    server,
    mc as unknown as Parameters<typeof registerDcvProviderTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('dcv provider tools registration', () => {
  it('registers the expected dcv_provider tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_dcv_providers',
      'get_dcv_provider',
      'create_dcv_provider',
      'update_dcv_provider',
      'delete_dcv_provider',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_dcv_provider', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs the collection with the digicert payload (proxy omitted)', async () => {
    mc.post.mockResolvedValueOnce({ name: 'dc' });
    await client.callTool({
      name: 'create_dcv_provider',
      arguments: {
        name: 'dc',
        type: 'digicert',
        endpoint: 'https://www.digicert.com',
        credentials: 'dc-creds',
        timeout: '30 seconds',
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/dcv/providers', {
      name: 'dc',
      type: 'digicert',
      endpoint: 'https://www.digicert.com',
      credentials: 'dc-creds',
      timeout: '30 seconds',
    });
  });

  it('rejects a missing mandatory field (credentials) via schema', async () => {
    const res = await client.callTool({
      name: 'create_dcv_provider',
      arguments: {
        name: 'dc',
        type: 'digicert',
        endpoint: 'https://www.digicert.com',
        timeout: '30 seconds',
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an unknown type via enum validation', async () => {
    const res = await client.callTool({
      name: 'create_dcv_provider',
      arguments: {
        name: 'dc',
        type: 'sectigo',
        endpoint: 'https://x',
        credentials: 'c',
        timeout: '30 seconds',
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_dcv_provider (GET-merge-PUT on collection)', () => {
  it('GETs the item, strips _id, merges, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'dc',
      type: 'digicert',
      endpoint: 'https://www.digicert.com',
      credentials: 'dc-creds',
      timeout: '30 seconds',
    });
    mc.put.mockResolvedValueOnce({ name: 'dc' });
    await client.callTool({
      name: 'update_dcv_provider',
      arguments: { name: 'dc', type: 'digicert', timeout: '45 seconds' },
    });
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/dcv/providers');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).toMatchObject({
      name: 'dc',
      timeout: '45 seconds',
      credentials: 'dc-creds',
    });
  });
});

describe('delete_dcv_provider safety echo', () => {
  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_dcv_provider',
      arguments: { name: 'dc', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
