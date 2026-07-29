/**
 * Team config tool-layer unit tests.
 *
 * Verifies the teams object family: CRUD tool registration, snake_case ->
 * camelCase payload mapping (display_name -> displayName), mandatory-field
 * enforcement, the GET-strip-merge-PUT update cycle (PUT on collection root,
 * _id + scim stripped), the delete safety echo, the membership subroutes, and
 * the switch_team PATCH tool.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTeamTools } from '../../src/tools/config/teams.js';

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
  registerTeamTools(
    server,
    mc as unknown as Parameters<typeof registerTeamTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('team tools registration', () => {
  it('registers the expected team CRUD, membership and switch tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_teams',
      'get_team',
      'create_team',
      'update_team',
      'delete_team',
      'list_team_members',
      'add_team_members',
      'remove_team_members',
      'switch_team',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_team', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs the collection with snake_case -> camelCase mapped payload', async () => {
    mc.post.mockResolvedValueOnce({ name: 'PKIOps' });
    const res = await client.callTool({
      name: 'create_team',
      arguments: {
        name: 'PKIOps',
        contact: 'pkiops@evertrust.fr',
        managers: ['manager.pkiops@evertrust.fr'],
        webhook: { type: 'slack', url: 'https://hooks.slack.com/services/x' },
        display_name: [{ lang: 'en', value: 'PKI Operations' }],
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/security/teams', {
      name: 'PKIOps',
      contact: 'pkiops@evertrust.fr',
      managers: ['manager.pkiops@evertrust.fr'],
      webhook: { type: 'slack', url: 'https://hooks.slack.com/services/x' },
      displayName: [{ lang: 'en', value: 'PKI Operations' }],
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('rejects a missing mandatory field (name) via schema validation', async () => {
    const res = await client.callTool({
      name: 'create_team',
      arguments: { contact: 'pkiops@evertrust.fr' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an invalid webhook.type enum', async () => {
    const res = await client.callTool({
      name: 'create_team',
      arguments: {
        name: 'PKIOps',
        webhook: { type: 'discord', url: 'https://x' },
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_team (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id + scim, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      scim: { externalId: 'x' },
      name: 'PKIOps',
      contact: 'old@evertrust.fr',
      managers: ['m1'],
    });
    mc.put.mockResolvedValueOnce({ name: 'PKIOps' });
    await client.callTool({
      name: 'update_team',
      arguments: { name: 'PKIOps', contact: 'new@evertrust.fr' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/security/teams/PKIOps');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/security/teams');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).not.toHaveProperty('scim');
    expect(putBody).toMatchObject({
      name: 'PKIOps',
      contact: 'new@evertrust.fr',
      managers: ['m1'],
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'PKIOps',
      webhook: { type: 'slack', url: 'https://x' },
    });
    await client.callTool({
      name: 'update_team',
      arguments: { name: 'PKIOps', clear_fields: ['webhook'] },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['webhook']).toBeNull();
  });
});

describe('delete_team safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_team',
      arguments: { name: 'PKIOps', expected_name: 'PKIOps' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/security/teams/PKIOps');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_team',
      arguments: { name: 'PKIOps', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});

describe('team membership subroutes', () => {
  it('add_team_members POSTs the identifiers array to the members subroute', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'add_team_members',
      arguments: { name: 'PKIOps', identifiers: ['alice', 'bob'] },
    });
    expect(mc.post).toHaveBeenCalledWith(
      '/api/v1/security/teams/PKIOps/members',
      ['alice', 'bob'],
    );
  });

  it('remove_team_members DELETEs with the identifiers array body', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'remove_team_members',
      arguments: { name: 'PKIOps', identifiers: ['alice'] },
    });
    expect(mc.deleteWithBody).toHaveBeenCalledWith(
      '/api/v1/security/teams/PKIOps/members',
      ['alice'],
    );
  });
});

describe('switch_team', () => {
  it('PATCHes both team names as path params with an empty body', async () => {
    const { client, mc } = await setup();
    mc.patch.mockResolvedValueOnce({ name: 'PKIOpsV2' });
    const res = await client.callTool({
      name: 'switch_team',
      arguments: {
        previous_team: 'PKIOps',
        new_team: 'PKIOpsV2',
        expected_previous_team: 'PKIOps',
      },
    });
    expect(mc.patch).toHaveBeenCalledWith(
      '/api/v1/security/teams/PKIOps/PKIOpsV2',
      {},
    );
    expect(parse(res)['status']).toBe('switched');
  });

  it('rejects when a mandatory path param is missing', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'switch_team',
      arguments: { previous_team: 'PKIOps', expected_previous_team: 'PKIOps' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.patch).not.toHaveBeenCalled();
  });

  it('refuses when expected_previous_team does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'switch_team',
      arguments: {
        previous_team: 'PKIOps',
        new_team: 'PKIOpsV2',
        expected_previous_team: 'WRONG',
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.patch).not.toHaveBeenCalled();
  });
});
