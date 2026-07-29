/**
 * Trigger CRUD gap-fill unit tests (describe / create / update).
 * Verifies the polymorphic body merge, mandatory + discriminator enforcement,
 * unknown-key rejection, and the GET-strip-merge-PUT update on the collection root.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTriggerCrudTools } from '../../src/tools/config/triggers.js';

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
  registerTriggerCrudTools(
    server,
    mc as unknown as Parameters<typeof registerTriggerCrudTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('trigger CRUD gap-fill', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('registers describe/create/update (not list/get/delete)', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'describe_trigger_schema',
        'create_trigger',
        'update_trigger',
      ]),
    );
    expect(names).not.toContain('list_triggers');
    expect(names).not.toContain('delete_trigger');
  });

  it('create merges name+type+config and POSTs the collection', async () => {
    await client.callTool({
      name: 'create_trigger',
      arguments: {
        name: 't1',
        type: 'webhook',
        config: { events: ['on_enroll'], webhookTemplate: { to: {} } },
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/triggers', {
      events: ['on_enroll'],
      webhookTemplate: { to: {} },
      name: 't1',
      type: 'webhook',
    });
  });

  it('rejects a missing discriminator (type)', async () => {
    const res = await client.callTool({
      name: 'create_trigger',
      arguments: { name: 't1' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an unknown top-level config key', async () => {
    const res = await client.callTool({
      name: 'create_trigger',
      arguments: { name: 't1', type: 'email', config: { bogusField: 1 } },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('update does GET item then PUT collection root with _id stripped', async () => {
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      tenant: 't',
      name: 't1',
      type: 'email',
      events: ['on_expire'],
    });
    await client.callTool({
      name: 'update_trigger',
      arguments: { name: 't1', type: 'email', config: { retries: 3 } },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/triggers/t1');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/triggers');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).not.toHaveProperty('tenant');
    expect(putBody).toMatchObject({ name: 't1', type: 'email', retries: 3 });
  });
});
