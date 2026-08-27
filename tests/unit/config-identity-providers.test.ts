/**
 * Identity provider config-tool unit tests (READ-ONLY surface).
 *
 * Verifies that only list/get tools are registered (no create/update/delete),
 * and that they hit the /api/v1/security/identity/providers routes.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

import { registerIdentityProviderTools } from '../../src/tools/config/identity-providers.js';

function createMockClient() {
  return {
    get: vi.fn().mockResolvedValue([{ name: 'local', type: 'Local' }]),
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

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerIdentityProviderTools(
    server,
    mc as unknown as Parameters<typeof registerIdentityProviderTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('identity provider tools (read-only)', () => {
  it('registers only list/get (no create/update/delete)', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('list_identity_providers');
    expect(names).toContain('get_identity_provider');
    expect(names).not.toContain('create_identity_provider');
    expect(names).not.toContain('update_identity_provider');
    expect(names).not.toContain('delete_identity_provider');
  });

  it('list GETs the identity-providers collection', async () => {
    const { client, mc } = await setup();
    await client.callTool({ name: 'list_identity_providers', arguments: {} });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/security/identity/providers');
  });

  it('get GETs the item route', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({ name: 'Microsoft', type: 'OpenId' });
    await client.callTool({
      name: 'get_identity_provider',
      arguments: { name: 'Microsoft' },
    });
    expect(mc.get).toHaveBeenCalledWith(
      '/api/v1/security/identity/providers/Microsoft',
    );
  });
});
