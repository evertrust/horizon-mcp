/**
 * Password policy config-object CRUD tool-layer unit tests.
 *
 * Verifies the flat password_policies family: tool registration, snake_case ->
 * camelCase payload mapping, mandatory-field enforcement, the
 * GET-strip-merge-PUT update cycle (PUT on collection root, _id stripped), and
 * the delete safety echo.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HorizonClient } from '../../src/client/http.js';
import { registerPasswordPolicyTools } from '../../src/tools/config/password-policies.js';

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
  registerPasswordPolicyTools(server, mc as unknown as HorizonClient);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('password_policy tools registration', () => {
  it('registers the expected password_policy tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_password_policies',
      'get_password_policy',
      'create_password_policy',
      'update_password_policy',
      'delete_password_policy',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_password_policy (mandatory + camelCase mapping)', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('maps snake_case inputs to the exact camelCase payload keys', async () => {
    mc.post.mockResolvedValueOnce({ name: 'pp1' });
    await client.callTool({
      name: 'create_password_policy',
      arguments: {
        name: 'pp1',
        min_char: 12,
        max_char: 24,
        min_up_char: 1,
        min_lo_char: 1,
        min_di_char: 1,
        sp_char: '+-._',
        min_sp_char: 1,
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/security/passwordpolicies', {
      name: 'pp1',
      minChar: 12,
      maxChar: 24,
      minUpChar: 1,
      minLoChar: 1,
      minDiChar: 1,
      spChar: '+-._',
      minSpChar: 1,
    });
  });

  it('omits unset optional fields from the payload', async () => {
    mc.post.mockResolvedValueOnce({ name: 'pp1' });
    const res = await client.callTool({
      name: 'create_password_policy',
      arguments: { name: 'pp1', min_char: 8, min_lo_char: 1 },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/security/passwordpolicies', {
      name: 'pp1',
      minChar: 8,
      minLoChar: 1,
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('rejects a missing mandatory field (min_char) and does NOT POST', async () => {
    const res = await client.callTool({
      name: 'create_password_policy',
      arguments: { name: 'pp1' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects a negative min_char and does NOT POST', async () => {
    const res = await client.callTool({
      name: 'create_password_policy',
      arguments: { name: 'pp1', min_char: -1 },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_password_policy (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      name: 'pp1',
      minChar: 8,
      minLoChar: 1,
    });
    mc.put.mockResolvedValueOnce({ name: 'pp1', minChar: 12, minLoChar: 1 });
    await client.callTool({
      name: 'update_password_policy',
      arguments: { name: 'pp1', min_char: 12 },
    });
    expect(mc.get).toHaveBeenCalledWith(
      '/api/v1/security/passwordpolicies/pp1',
    );
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/security/passwordpolicies');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).toMatchObject({
      name: 'pp1',
      minChar: 12,
      minLoChar: 1,
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'pp1',
      minChar: 8,
      maxChar: 24,
    });
    await client.callTool({
      name: 'update_password_policy',
      arguments: { name: 'pp1', clear_fields: ['maxChar'] },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['maxChar']).toBeNull();
  });
});

describe('delete_password_policy safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_password_policy',
      arguments: { name: 'pp1', expected_name: 'pp1' },
    });
    expect(mc.delete).toHaveBeenCalledWith(
      '/api/v1/security/passwordpolicies/pp1',
    );
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_password_policy',
      arguments: { name: 'pp1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
