import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAcmeTools } from '../../src/tools/acme/index.js';

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
  registerAcmeTools(server, mc as any);
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

const EAB = {
  name: 'web-servers',
  description: 'Web servers',
  eabPolicy: 'web-policy',
  identifierConstraint: '.*\\.example\\.com',
  allowedProfiles: ['acme-web'],
  validationMethods: ['http-01'],
};
const MAC_KEY = 'example-secret-value';

describe('ACME EAB tools', () => {
  let client: Client;
  let mc: MockClient;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    ({ client, mc } = await setup());
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => stderr.mockRestore());

  it('searches and gets EABs without exposing their MAC key', async () => {
    mc.post.mockResolvedValueOnce({ results: [EAB], hasMore: false });
    await client.callTool({
      name: 'search_acme_eabs',
      arguments: { query: 'status equals "valid"' },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/acme/eab/search', {
      query: 'status equals "valid"',
      pageIndex: 1,
      pageSize: 25,
      withCount: true,
    });
    await client.callTool({
      name: 'get_acme_eab',
      arguments: { name: 'web servers' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/acme/eab/web%20servers');
  });

  it('returns the create MAC material once with a warning and does not log it', async () => {
    mc.post.mockResolvedValueOnce({
      ...EAB,
      macKey: MAC_KEY,
      macKeyId: 'key-id',
    });
    const result = await client.callTool({
      name: 'create_acme_eab',
      arguments: {
        name: EAB.name,
        eab_policy: EAB.eabPolicy,
        mac_key_algorithm: 'HS256',
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/acme/eab', {
      name: EAB.name,
      eabPolicy: EAB.eabPolicy,
      macKeyAlgorithm: 'HS256',
    });
    const body = parse(result);
    expect(body['warning']).toContain('one-time secrets');
    const data = body['data'] as Record<string, unknown>;
    expect(data['macKey']).toBe(MAC_KEY);
    expect(data['macKeyId']).toBe('key-id');
    expect(stderr.mock.calls.flat().join('')).not.toContain(MAC_KEY);
  });

  it('merges updates and represents cleared lists as empty arrays', async () => {
    mc.get.mockResolvedValueOnce(EAB);
    await client.callTool({
      name: 'update_acme_eab',
      arguments: {
        name: EAB.name,
        clear_fields: ['description', 'validationMethods'],
      },
    });
    expect(mc.put).toHaveBeenCalledWith('/api/v1/acme/eab', {
      name: EAB.name,
      eabPolicy: EAB.eabPolicy,
      identifierConstraint: EAB.identifierConstraint,
      allowedProfiles: EAB.allowedProfiles,
      validationMethods: [],
    });
  });

  it('changes status, renews the key, and protects deletion with the name echo', async () => {
    await client.callTool({
      name: 'update_acme_eab_status',
      arguments: { name: EAB.name, status: 'suspended' },
    });
    expect(mc.post).toHaveBeenCalledWith(
      '/api/v1/acme/eab/web-servers/status',
      { status: 'suspended' },
    );
    mc.post.mockResolvedValueOnce({
      ...EAB,
      macKey: MAC_KEY,
      macKeyId: 'key-id',
    });
    const renewed = await client.callTool({
      name: 'renew_acme_eab',
      arguments: { name: EAB.name, mac_key_algorithm: 'HS512' },
    });
    expect(mc.post).toHaveBeenLastCalledWith(
      '/api/v1/acme/eab/web-servers/renew',
      { macKeyAlgorithm: 'HS512' },
    );
    const body = parse(renewed);
    expect(body['warning']).toContain('one-time secrets');
    const data = body['data'] as Record<string, unknown>;
    expect(data['macKey']).toBe(MAC_KEY);
    expect(data['macKeyId']).toBe('key-id');
    expect(stderr.mock.calls.flat().join('')).not.toContain(MAC_KEY);
    const refused = await client.callTool({
      name: 'delete_acme_eab',
      arguments: { name: EAB.name, expected_name: 'other' },
    });
    expect((refused as { isError?: boolean }).isError).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
