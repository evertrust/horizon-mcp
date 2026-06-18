/**
 * Security role config tool-layer unit tests.
 *
 * Verifies the roles tool family (flat/typed CRUD + member subroutes):
 * tool registration, create payload mapping (permissions array passthrough),
 * mandatory-field enforcement, the GET-strip-merge-PUT update cycle (PUT on the
 * collection root, _id and scim stripped), the delete safety echo, and the
 * membership add/remove subroutes.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerRoleTools } from '../../src/tools/config/roles.js';

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
  registerRoleTools(
    server,
    mc as unknown as Parameters<typeof registerRoleTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('role tools registration', () => {
  it('registers the expected role CRUD and membership tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_roles',
      'get_role',
      'create_role',
      'update_role',
      'delete_role',
      'list_role_members',
      'add_role_members',
      'remove_role_members',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_role', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs the collection with the mapped payload (permissions array)', async () => {
    mc.post.mockResolvedValueOnce({ name: 'CanEnroll' });
    const res = await client.callTool({
      name: 'create_role',
      arguments: {
        name: 'CanEnroll',
        description: 'Gives all enroll permissions',
        permissions: [{ value: 'lifecycle:*:*:enroll' }],
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/security/roles', {
      name: 'CanEnroll',
      description: 'Gives all enroll permissions',
      permissions: [{ value: 'lifecycle:*:*:enroll' }],
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('POSTs with only the mandatory name when optionals are omitted', async () => {
    mc.post.mockResolvedValueOnce({ name: 'Bare' });
    await client.callTool({
      name: 'create_role',
      arguments: { name: 'Bare' },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/security/roles', {
      name: 'Bare',
    });
  });

  it('rejects a missing mandatory field (name) via schema validation', async () => {
    const res = await client.callTool({
      name: 'create_role',
      arguments: { description: 'no name here' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects a permission element missing the mandatory value', async () => {
    const res = await client.callTool({
      name: 'create_role',
      arguments: {
        name: 'Bad',
        permissions: [{ filter: 'label.BU equals "X"' }],
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_role (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id and scim, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      scim: { managed: true },
      name: 'CanEnroll',
      description: 'old',
      permissions: [{ value: 'lifecycle:*:*:enroll' }],
    });
    mc.put.mockResolvedValueOnce({ name: 'CanEnroll', description: 'new' });
    await client.callTool({
      name: 'update_role',
      arguments: { name: 'CanEnroll', description: 'new' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/security/roles/CanEnroll');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/security/roles');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).not.toHaveProperty('scim');
    expect(putBody).toMatchObject({
      name: 'CanEnroll',
      description: 'new',
      permissions: [{ value: 'lifecycle:*:*:enroll' }],
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'CanEnroll',
      description: 'd',
      permissions: [{ value: 'lifecycle:*:*:enroll' }],
    });
    await client.callTool({
      name: 'update_role',
      arguments: { name: 'CanEnroll', clear_fields: ['permissions'] },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['permissions']).toBeNull();
  });
});

describe('delete_role safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_role',
      arguments: { name: 'CanEnroll', expected_name: 'CanEnroll' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/security/roles/CanEnroll');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_role',
      arguments: { name: 'CanEnroll', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});

describe('role membership subroutes', () => {
  it('add_role_members POSTs the identifiers array to the members subroute', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'add_role_members',
      arguments: { name: 'CanEnroll', identifiers: ['alice', 'bob'] },
    });
    expect(mc.post).toHaveBeenCalledWith(
      '/api/v1/security/roles/CanEnroll/members',
      ['alice', 'bob'],
    );
  });

  it('remove_role_members DELETEs (with body) the identifiers from the members subroute', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'remove_role_members',
      arguments: { name: 'CanEnroll', identifiers: ['alice'] },
    });
    expect(mc.deleteWithBody).toHaveBeenCalledWith(
      '/api/v1/security/roles/CanEnroll/members',
      ['alice'],
    );
  });
});
