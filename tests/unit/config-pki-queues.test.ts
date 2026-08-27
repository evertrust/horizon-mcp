/**
 * PKI queue config-object CRUD tool-layer unit tests.
 *
 * Verifies registration, snake_case -> camelCase payload mapping (incl. the
 * always-sent clusterWide), mandatory-field enforcement, the GET-strip-merge-PUT
 * update cycle (PUT on collection root, _id + tenant stripped), and the delete
 * safety echo.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerPkiQueueTools } from '../../src/tools/config/pki-queues.js';

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
    exportTimeout: 120,
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
  registerPkiQueueTools(
    server,
    mc as unknown as Parameters<typeof registerPkiQueueTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('pki_queue tools registration', () => {
  it('registers the expected pki_queue tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_pki_queues',
      'get_pki_queue',
      'create_pki_queue',
      'update_pki_queue',
      'delete_pki_queue',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_pki_queue (mandatory + camelCase mapping)', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('maps snake_case inputs to camelCase payload (incl. clusterWide)', async () => {
    mc.post.mockResolvedValueOnce({ name: 'q1' });
    const res = await client.callTool({
      name: 'create_pki_queue',
      arguments: {
        name: 'q1',
        size: 10,
        cluster_wide: false,
        description: 'my queue',
        throttle_duration: '5 seconds',
        throttle_parallelism: 2,
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/pki/queues', {
      name: 'q1',
      size: 10,
      clusterWide: false,
      description: 'my queue',
      throttleDuration: '5 seconds',
      throttleParallelism: 2,
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('always sends clusterWide even with only mandatory fields', async () => {
    mc.post.mockResolvedValueOnce({ name: 'q1' });
    await client.callTool({
      name: 'create_pki_queue',
      arguments: { name: 'q1', size: 5, cluster_wide: true },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/pki/queues', {
      name: 'q1',
      size: 5,
      clusterWide: true,
    });
  });

  it('rejects when a mandatory field (size) is missing', async () => {
    const res = await client.callTool({
      name: 'create_pki_queue',
      arguments: { name: 'q1', cluster_wide: false },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_pki_queue (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id + tenant, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      tenant: 't1',
      name: 'q1',
      size: 10,
      clusterWide: false,
      description: 'old',
    });
    mc.put.mockResolvedValueOnce({ name: 'q1', size: 20 });
    await client.callTool({
      name: 'update_pki_queue',
      arguments: { name: 'q1', size: 20 },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/pki/queues/q1');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/pki/queues');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).not.toHaveProperty('tenant');
    expect(putBody).toMatchObject({
      name: 'q1',
      size: 20,
      clusterWide: false,
      description: 'old',
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'q1',
      size: 10,
      clusterWide: false,
      description: 'old',
    });
    await client.callTool({
      name: 'update_pki_queue',
      arguments: { name: 'q1', clear_fields: ['description'] },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['description']).toBeNull();
  });
});

describe('delete_pki_queue safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_pki_queue',
      arguments: { name: 'q1', expected_name: 'q1' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/pki/queues/q1');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_pki_queue',
      arguments: { name: 'q1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
