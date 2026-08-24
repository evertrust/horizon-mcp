/**
 * Terms of Service config-tool unit tests (flat/typed, Horizon 2.10).
 *
 * Verifies registration, the create payload (name + non-empty contents,
 * optional description), non-empty-contents enforcement, mandatory-field
 * enforcement, GET-merge-PUT update on the collection root, and delete echo.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTermsOfServiceTools } from '../../src/tools/config/terms-of-service.js';

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

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerTermsOfServiceTools(
    server,
    mc as unknown as Parameters<typeof registerTermsOfServiceTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('terms of service tools registration', () => {
  it('registers the expected terms_of_service tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_terms_of_services',
      'get_terms_of_service',
      'create_terms_of_service',
      'update_terms_of_service',
      'delete_terms_of_service',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_terms_of_service', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs the collection with name + contents (description omitted)', async () => {
    mc.post.mockResolvedValueOnce({ name: 'tos1' });
    await client.callTool({
      name: 'create_terms_of_service',
      arguments: {
        name: 'tos1',
        contents: [{ lang: 'en', value: '# Terms' }],
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/system/terms-of-services', {
      name: 'tos1',
      contents: [{ lang: 'en', value: '# Terms' }],
    });
  });

  it('rejects empty contents (min 1) via schema', async () => {
    const res = await client.callTool({
      name: 'create_terms_of_service',
      arguments: { name: 'tos1', contents: [] },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects a missing mandatory field (contents) via schema', async () => {
    const res = await client.callTool({
      name: 'create_terms_of_service',
      arguments: { name: 'tos1' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_terms_of_service (GET-merge-PUT on collection)', () => {
  it('GETs the item, strips _id, merges, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'tos1',
      description: 'old',
      contents: [{ lang: 'en', value: '# Terms' }],
    });
    mc.put.mockResolvedValueOnce({ name: 'tos1' });
    await client.callTool({
      name: 'update_terms_of_service',
      arguments: {
        name: 'tos1',
        contents: [{ lang: 'en', value: '# New Terms' }],
      },
    });
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/system/terms-of-services');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).toMatchObject({
      name: 'tos1',
      description: 'old',
      contents: [{ lang: 'en', value: '# New Terms' }],
    });
  });
});

describe('delete_terms_of_service safety echo', () => {
  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_terms_of_service',
      arguments: { name: 'tos1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
