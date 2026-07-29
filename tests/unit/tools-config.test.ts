/**
 * Config-object CRUD tool-layer unit tests.
 *
 * Verifies the scaffold + golden objects (http_proxies flat, storages
 * typed-discriminated): tool registration, payload mapping, mandatory-field
 * enforcement, the GET-strip-merge-PUT update cycle (PUT on collection root,
 * _id stripped), and the delete safety echo.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerConfigTools } from '../../src/tools/config/index.js';

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
  registerConfigTools(
    server,
    mc as unknown as Parameters<typeof registerConfigTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('config tools registration', () => {
  it('registers the expected http_proxy and storage tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_http_proxies',
      'get_http_proxy',
      'create_http_proxy',
      'update_http_proxy',
      'delete_http_proxy',
      'list_storages',
      'get_storage',
      'create_storage',
      'update_storage',
      'delete_storage',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_http_proxy', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs the collection with the mapped payload', async () => {
    mc.post.mockResolvedValueOnce({ name: 'p1', host: 'h', port: 8080 });
    const res = await client.callTool({
      name: 'create_http_proxy',
      arguments: { name: 'p1', host: 'proxy.local', port: 8080 },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/proxy/httpproxies', {
      name: 'p1',
      host: 'proxy.local',
      port: 8080,
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('rejects a missing mandatory field (port) via schema validation', async () => {
    const res = await client.callTool({
      name: 'create_http_proxy',
      arguments: { name: 'p1', host: 'proxy.local' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range port', async () => {
    const res = await client.callTool({
      name: 'create_http_proxy',
      arguments: { name: 'p1', host: 'h', port: 70000 },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_http_proxy (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      name: 'p1',
      host: 'old',
      port: 8080,
      credentials: 'c1',
    });
    mc.put.mockResolvedValueOnce({ name: 'p1', host: 'new', port: 8080 });
    await client.callTool({
      name: 'update_http_proxy',
      arguments: { name: 'p1', host: 'new' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/proxy/httpproxies/p1');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/proxy/httpproxies');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).toMatchObject({
      name: 'p1',
      host: 'new',
      port: 8080,
      credentials: 'c1',
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'p1',
      host: 'h',
      port: 80,
      credentials: 'c1',
    });
    await client.callTool({
      name: 'update_http_proxy',
      arguments: { name: 'p1', clear_fields: ['credentials'] },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['credentials']).toBeNull();
  });
});

describe('delete_http_proxy safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_http_proxy',
      arguments: { name: 'p1', expected_name: 'p1' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/proxy/httpproxies/p1');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_http_proxy',
      arguments: { name: 'p1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});

describe('create_storage (mandatory + camelCase mapping)', () => {
  it('maps snake_case inputs to camelCase payload with type=s3', async () => {
    const { client, mc } = await setup();
    mc.post.mockResolvedValueOnce({ name: 's1' });
    await client.callTool({
      name: 'create_storage',
      arguments: {
        name: 's1',
        timeout: '30s',
        force_path_style: true,
        bucket: 'b',
        checksum_mode: 'when_required',
        part_buffer_size: '9MB',
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/system/storages', {
      type: 's3',
      name: 's1',
      timeout: '30s',
      forcePathStyle: true,
      bucket: 'b',
      checksumMode: 'when_required',
      partBufferSize: '9MB',
    });
  });

  it('rejects when a mandatory field (checksum_mode) is missing', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'create_storage',
      arguments: {
        name: 's1',
        timeout: '30s',
        force_path_style: true,
        bucket: 'b',
        part_buffer_size: '9MB',
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an invalid checksum_mode enum', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'create_storage',
      arguments: {
        name: 's1',
        timeout: '30s',
        force_path_style: true,
        bucket: 'b',
        checksum_mode: 'bogus',
        part_buffer_size: '9MB',
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update immutable-override guard', () => {
  it('rejects CHANGING an immutable discriminator (certificate_profile module) - GETs to compare, never PUTs', async () => {
    const { client, mc } = await setup();
    // Stored module differs from the requested one -> a real change, rejected.
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      module: 'monitored',
      name: 'cp1',
      enabled: true,
    });
    const res = await client.callTool({
      name: 'update_certificate_profile',
      arguments: { name: 'cp1', config: { module: 'scep' } },
    });
    expect(isError(res)).toBe(true);
    expect(JSON.stringify(res)).toContain('CONFIG-IMMUTABLE-OVERRIDE');
    expect(mc.get).toHaveBeenCalledTimes(1);
    expect(mc.put).not.toHaveBeenCalled();
  });

  it('allows re-sending the SAME immutable discriminator value (echoed, not changed)', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      module: 'monitored',
      name: 'cp1',
      enabled: true,
    });
    mc.put.mockResolvedValueOnce({ name: 'cp1' });
    const res = await client.callTool({
      name: 'update_certificate_profile',
      arguments: {
        name: 'cp1',
        config: { module: 'monitored' },
        enabled: false,
      },
    });
    expect(isError(res)).toBe(false);
    expect(mc.put).toHaveBeenCalledTimes(1);
  });

  it('still allows an update that does not touch the immutable discriminator', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      module: 'monitored',
      name: 'cp1',
      enabled: true,
    });
    mc.put.mockResolvedValueOnce({ name: 'cp1' });
    const res = await client.callTool({
      name: 'update_certificate_profile',
      arguments: { name: 'cp1', enabled: false },
    });
    expect(isError(res)).toBe(false);
    expect(mc.put).toHaveBeenCalledTimes(1);
  });
});
