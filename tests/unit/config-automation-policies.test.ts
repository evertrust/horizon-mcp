/**
 * Automation policy config-tool unit tests.
 *
 * Verifies the automation_policy family wired through the scaffold: tool
 * registration, snake_case -> camelCase payload mapping (incl. the nested
 * compliancePolicy block), mandatory-field enforcement, the
 * GET-strip-merge-PUT update cycle (PUT on collection root, _id stripped), and
 * the delete safety echo.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAutomationPolicyTools } from '../../src/tools/config/automation-policies.js';

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
  registerAutomationPolicyTools(
    server,
    mc as unknown as Parameters<typeof registerAutomationPolicyTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('automation policy config tools registration', () => {
  it('registers the expected automation_policy tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_automation_policies',
      'get_automation_policy',
      'create_automation_policy',
      'update_automation_policy',
      'delete_automation_policy',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_automation_policy', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs the collection with the mandatory mapped payload', async () => {
    mc.post.mockResolvedValueOnce({ name: 'ap1', profile: 'prof1' });
    const res = await client.callTool({
      name: 'create_automation_policy',
      arguments: { name: 'ap1', profile: 'prof1' },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/automation/policies', {
      name: 'ap1',
      profile: 'prof1',
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('maps snake_case optional inputs (incl nested compliancePolicy) to camelCase', async () => {
    mc.post.mockResolvedValueOnce({ name: 'ap1' });
    await client.callTool({
      name: 'create_automation_policy',
      arguments: {
        name: 'ap1',
        profile: 'prof1',
        execution_policy: 'exec1',
        trust_chains: ['ca-a', 'ca-b'],
        compliance_policy: {
          authorized_signing_algorithms: ['SHA256withRSA'],
          authorized_cas: ['ca-client'],
        },
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/automation/policies', {
      name: 'ap1',
      profile: 'prof1',
      executionPolicy: 'exec1',
      trustChains: ['ca-a', 'ca-b'],
      compliancePolicy: {
        authorizedSigningAlgorithms: ['SHA256withRSA'],
        authorizedCas: ['ca-client'],
      },
    });
  });

  it('accepts an empty compliance_policy object', async () => {
    mc.post.mockResolvedValueOnce({ name: 'ap1' });
    await client.callTool({
      name: 'create_automation_policy',
      arguments: { name: 'ap1', profile: 'prof1', compliance_policy: {} },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/automation/policies', {
      name: 'ap1',
      profile: 'prof1',
      compliancePolicy: {},
    });
  });

  it('rejects a missing mandatory field (profile) via schema validation', async () => {
    const res = await client.callTool({
      name: 'create_automation_policy',
      arguments: { name: 'ap1' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_automation_policy (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      name: 'ap1',
      profile: 'prof1',
      executionPolicy: 'exec1',
    });
    mc.put.mockResolvedValueOnce({ name: 'ap1', profile: 'prof2' });
    await client.callTool({
      name: 'update_automation_policy',
      arguments: { name: 'ap1', profile: 'prof2' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/automation/policies/ap1');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/automation/policies');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).toMatchObject({
      name: 'ap1',
      profile: 'prof2',
      executionPolicy: 'exec1',
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'ap1',
      profile: 'prof1',
      executionPolicy: 'exec1',
    });
    await client.callTool({
      name: 'update_automation_policy',
      arguments: { name: 'ap1', clear_fields: ['executionPolicy'] },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['executionPolicy']).toBeNull();
  });
});

describe('delete_automation_policy safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_automation_policy',
      arguments: { name: 'ap1', expected_name: 'ap1' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/automation/policies/ap1');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_automation_policy',
      arguments: { name: 'ap1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
