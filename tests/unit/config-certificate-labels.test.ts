/**
 * Certificate label config-tool unit tests.
 *
 * Verifies the flat/typed certificate_label object: tool registration,
 * snake_case -> camelCase payload mapping (display_name -> displayName), the
 * GET-strip-merge-PUT update cycle (PUT on the collection root, _id stripped),
 * mandatory-field enforcement, and the delete safety echo.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCertificateLabelTools } from '../../src/tools/config/certificate-labels.js';

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
  registerCertificateLabelTools(
    server,
    mc as unknown as Parameters<typeof registerCertificateLabelTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('certificate label tools registration', () => {
  it('registers the expected certificate_label tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_certificate_labels',
      'get_certificate_label',
      'create_certificate_label',
      'update_certificate_label',
      'delete_certificate_label',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_certificate_label', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs the collection with the mapped payload (display_name -> displayName)', async () => {
    mc.post.mockResolvedValueOnce({ name: 'business_unit' });
    const res = await client.callTool({
      name: 'create_certificate_label',
      arguments: {
        name: 'business_unit',
        display_name: [{ lang: 'en', value: 'Business Unit' }],
        description: [{ lang: 'en', value: 'The owning business unit' }],
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/certificate/labels', {
      name: 'business_unit',
      displayName: [{ lang: 'en', value: 'Business Unit' }],
      description: [{ lang: 'en', value: 'The owning business unit' }],
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('POSTs only name when optional fields are omitted', async () => {
    mc.post.mockResolvedValueOnce({ name: 'minimal' });
    await client.callTool({
      name: 'create_certificate_label',
      arguments: { name: 'minimal' },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/certificate/labels', {
      name: 'minimal',
    });
  });

  it('rejects a missing mandatory field (name) via schema validation', async () => {
    const res = await client.callTool({
      name: 'create_certificate_label',
      arguments: { display_name: [{ lang: 'en', value: 'No name' }] },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_certificate_label (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      name: 'business_unit',
      displayName: [{ lang: 'en', value: 'Old' }],
      description: [{ lang: 'en', value: 'Old desc' }],
    });
    mc.put.mockResolvedValueOnce({ name: 'business_unit' });
    await client.callTool({
      name: 'update_certificate_label',
      arguments: {
        name: 'business_unit',
        display_name: [{ lang: 'en', value: 'New' }],
      },
    });
    expect(mc.get).toHaveBeenCalledWith(
      '/api/v1/certificate/labels/business_unit',
    );
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/certificate/labels');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).toMatchObject({
      name: 'business_unit',
      displayName: [{ lang: 'en', value: 'New' }],
      description: [{ lang: 'en', value: 'Old desc' }],
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'business_unit',
      displayName: [{ lang: 'en', value: 'BU' }],
      description: [{ lang: 'en', value: 'desc' }],
    });
    await client.callTool({
      name: 'update_certificate_label',
      arguments: { name: 'business_unit', clear_fields: ['description'] },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['description']).toBeNull();
  });
});

describe('delete_certificate_label safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_certificate_label',
      arguments: { name: 'business_unit', expected_name: 'business_unit' },
    });
    expect(mc.delete).toHaveBeenCalledWith(
      '/api/v1/certificate/labels/business_unit',
    );
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_certificate_label',
      arguments: { name: 'business_unit', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
