/**
 * Archive config tool-layer unit tests (polymorphic / "complex").
 *
 * Verifies the typed/polymorphic archive tools (list / get / create / delete +
 * describe_archive_schema - NO update, per the contract): tool registration,
 * the typed-discriminator + validated-config create mapping (certificate and
 * event subtypes -> exact camelCase API body), always-mandatory field
 * enforcement (schema), subtype-conditional mandatory enforcement via
 * assertConfigBody (post NOT called), the delete safety echo, and that describe
 * returns the embedded schema.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerArchiveTools } from '../../src/tools/config/archives.js';

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
function rawText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]!.text;
}

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerArchiveTools(
    server,
    mc as unknown as Parameters<typeof registerArchiveTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('archive tools registration', () => {
  it('registers list/get/create/delete + describe and NOT update', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_archives',
      'get_archive',
      'create_archive',
      'delete_archive',
      'describe_archive_schema',
    ]) {
      expect(names).toContain(n);
    }
    expect(names).not.toContain('update_archive');
  });
});

describe('describe_archive_schema', () => {
  it('returns the embedded request JSON schema and metadata', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_archive_schema',
      arguments: {},
    });
    const out = parse(res);
    expect(out['object']).toBe('archive');
    expect(out['discriminatorField']).toBe('type');
    expect(out['mandatoryFields']).toEqual(['name', 'type', 'filename']);
    const schema = out['jsonSchema'] as Record<string, unknown>;
    expect(schema['$id']).toBe(
      'https://evertrust.fr/horizon/schemas/archives.create-request.json',
    );
    expect(schema).toHaveProperty('oneOf');
  });
});

describe('create_archive (certificate subtype)', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('maps mandatory params + config to the camelCase payload', async () => {
    mc.post.mockResolvedValueOnce({ name: 'a1' });
    const res = await client.callTool({
      name: 'create_archive',
      arguments: {
        name: 'a1',
        type: 'certificate',
        filename: 'certs.parquet',
        config: { archiveKeys: true, filter: 'status equals "valid"' },
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/archives', {
      name: 'a1',
      type: 'certificate',
      filename: 'certs.parquet',
      archiveKeys: true,
      filter: 'status equals "valid"',
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('omits the optional filter when absent', async () => {
    mc.post.mockResolvedValueOnce({ name: 'a2' });
    await client.callTool({
      name: 'create_archive',
      arguments: {
        name: 'a2',
        type: 'certificate',
        filename: 'certs.parquet',
        config: { archiveKeys: false },
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/archives', {
      name: 'a2',
      type: 'certificate',
      filename: 'certs.parquet',
      archiveKeys: false,
    });
  });

  it('rejects type=certificate without archiveKeys (assertConfigBody) and does NOT POST', async () => {
    const res = await client.callTool({
      name: 'create_archive',
      arguments: {
        name: 'a3',
        type: 'certificate',
        filename: 'certs.parquet',
      },
    });
    expect(isError(res)).toBe(true);
    expect(rawText(res)).toContain('archiveKeys');
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('create_archive (event subtype)', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('maps the before epoch field from config', async () => {
    mc.post.mockResolvedValueOnce({ name: 'e1' });
    await client.callTool({
      name: 'create_archive',
      arguments: {
        name: 'e1',
        type: 'event',
        filename: 'events.parquet',
        config: { before: 1609459200000 },
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/archives', {
      name: 'e1',
      type: 'event',
      filename: 'events.parquet',
      before: 1609459200000,
    });
  });

  it('rejects type=event without before (assertConfigBody) and does NOT POST', async () => {
    const res = await client.callTool({
      name: 'create_archive',
      arguments: {
        name: 'e2',
        type: 'event',
        filename: 'events.parquet',
      },
    });
    expect(isError(res)).toBe(true);
    expect(rawText(res)).toContain('before');
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an unknown top-level config field for the event subtype', async () => {
    const res = await client.callTool({
      name: 'create_archive',
      arguments: {
        name: 'e3',
        type: 'event',
        filename: 'events.parquet',
        config: { before: 1609459200000, archiveKeys: true },
      },
    });
    expect(isError(res)).toBe(true);
    expect(rawText(res)).toContain('archiveKeys');
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('create_archive mandatory + enum validation (schema)', () => {
  it('rejects a missing mandatory field (filename) and does NOT POST', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'create_archive',
      arguments: {
        name: 'a1',
        type: 'certificate',
        config: { archiveKeys: true },
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an invalid type enum and does NOT POST', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'create_archive',
      arguments: { name: 'a1', type: 'bogus', filename: 'f.parquet' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('delete_archive safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_archive',
      arguments: { name: 'a1', expected_name: 'a1' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/archives/a1');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_archive',
      arguments: { name: 'a1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
