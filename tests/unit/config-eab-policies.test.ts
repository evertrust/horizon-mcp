import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerEabPolicyTools } from '../../src/tools/config/eab-policies.js';

function mockClient() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(null),
    exportTimeout: 120000,
  };
}

type MockClient = ReturnType<typeof mockClient>;

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = mockClient();
  registerEabPolicyTools(server, mc as any);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, mc };
}

function parse(result: unknown): Record<string, unknown> {
  return JSON.parse(
    (result as { content: Array<{ text: string }> }).content[0]!.text,
  ) as Record<string, unknown>;
}

const POLICY = {
  _id: 'policy-id',
  name: 'web-servers',
  identifierConstraint: '.*\\.example\\.com',
  allowedProfiles: ['acme-web'],
  validationMethods: ['http-01'],
};

describe('EAB policy tools', () => {
  let client: Client;
  let mc: MockClient;

  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('registers all five EAB policy tools', async () => {
    expect(
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
    ).toEqual([
      'create_eab_policy',
      'delete_eab_policy',
      'get_eab_policy',
      'list_eab_policies',
      'update_eab_policy',
    ]);
  });

  it('uses POST with an empty body to list policies', async () => {
    mc.post.mockResolvedValueOnce([POLICY]);
    const result = await client.callTool({
      name: 'list_eab_policies',
      arguments: {},
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/acme/eab-policies/list', {});
    expect(parse(result)['items']).toEqual([POLICY]);
  });

  it('creates and gets policies using public API field names', async () => {
    await client.callTool({
      name: 'create_eab_policy',
      arguments: {
        name: POLICY.name,
        allowed_profiles: POLICY.allowedProfiles,
        validation_methods: POLICY.validationMethods,
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/acme/eab-policies', {
      name: POLICY.name,
      allowedProfiles: POLICY.allowedProfiles,
      validationMethods: POLICY.validationMethods,
    });
    await client.callTool({
      name: 'get_eab_policy',
      arguments: { name: 'web servers' },
    });
    expect(mc.get).toHaveBeenLastCalledWith(
      '/api/v1/acme/eab-policies/web%20servers',
    );
  });

  it('merges updates on the collection route and clears lists with []', async () => {
    mc.get.mockResolvedValueOnce(POLICY);
    await client.callTool({
      name: 'update_eab_policy',
      arguments: {
        name: POLICY.name,
        clear_fields: ['identifierConstraint', 'validationMethods'],
      },
    });
    expect(mc.put).toHaveBeenCalledWith('/api/v1/acme/eab-policies', {
      name: POLICY.name,
      allowedProfiles: POLICY.allowedProfiles,
      validationMethods: [],
    });
  });

  it('requires the echoed name before deletion', async () => {
    const refused = await client.callTool({
      name: 'delete_eab_policy',
      arguments: { name: POLICY.name, expected_name: 'other' },
    });
    expect((refused as { isError?: boolean }).isError).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
