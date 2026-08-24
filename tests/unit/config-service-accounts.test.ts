/**
 * Service account config-tool unit tests (READ-ONLY surface).
 *
 * Verifies that only list/get tools are registered (no create/update/delete),
 * and that they hit the /api/v1/security/service-accounts routes.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

import { registerServiceAccountTools } from '../../src/tools/config/service-accounts.js';

function createMockClient() {
  return {
    get: vi.fn().mockResolvedValue([{ name: 'sa1' }]),
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
  registerServiceAccountTools(
    server,
    mc as unknown as Parameters<typeof registerServiceAccountTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('service account tools (read-only)', () => {
  it('registers only list/get (no create/update/delete)', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('list_service_accounts');
    expect(names).toContain('get_service_account');
    expect(names).not.toContain('create_service_account');
    expect(names).not.toContain('update_service_account');
    expect(names).not.toContain('delete_service_account');
  });

  it('list GETs the service-accounts collection', async () => {
    const { client, mc } = await setup();
    await client.callTool({ name: 'list_service_accounts', arguments: {} });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/security/service-accounts');
  });

  it('get GETs the item route', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({ name: 'sa1', trustConfig: {} });
    await client.callTool({
      name: 'get_service_account',
      arguments: { name: 'sa1' },
    });
    expect(mc.get).toHaveBeenCalledWith(
      '/api/v1/security/service-accounts/sa1',
    );
  });
});
