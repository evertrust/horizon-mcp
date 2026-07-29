/**
 * System Configuration (polymorphic) config-tool unit tests.
 *
 * Verifies the describe + read + create + update wiring for the system_config
 * object: tool registration, describe-schema output, snake_case->camelCase /
 * typed+config merge into the exact API body, mandatory-discriminator
 * enforcement, the GET-strip-merge-PUT upsert cycle (PUT on collection root,
 * [_id, tenant] stripped), and absence of a delete tool (the API has no DELETE).
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSystemConfigTools } from '../../src/tools/config/system-configuration.js';

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
  registerSystemConfigTools(
    server,
    mc as unknown as Parameters<typeof registerSystemConfigTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('system_config tools registration', () => {
  it('registers describe / list / get / update and NO create or delete', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'describe_system_config_schema',
      'list_system_configs',
      'get_system_config',
      'update_system_config',
    ]) {
      expect(names).toContain(n);
    }
    // No POST endpoint exists for system configuration (entries are
    // server-bootstrapped and set via the PUT upsert), and there is no delete.
    expect(names).not.toContain('create_system_config');
    expect(names).not.toContain('delete_system_config');
  });
});

describe('describe_system_config_schema', () => {
  it('returns the embedded request schema, discriminator and subtypes', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_system_config_schema',
      arguments: {},
    });
    const out = parse(res);
    expect(out['discriminatorField']).toBe('type');
    expect(out['subtypes']).toEqual([
      'license',
      'internal_monitor',
      'interface_customization',
      'storage',
    ]);
    const schema = out['jsonSchema'] as Record<string, unknown>;
    expect(schema['oneOf']).toHaveLength(4);
    expect(
      (schema['$defs'] as Record<string, unknown>)['StorageConfiguration'],
    ).toBeDefined();
  });

  it('echoes the requested subtype when narrowing', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_system_config_schema',
      arguments: { subtype: 'internal_monitor' },
    });
    expect(parse(res)['requestedSubtype']).toBe('internal_monitor');
  });
});

describe('update_system_config validation (typed + config merge)', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('rejects a missing mandatory discriminator (type) and does NOT PUT', async () => {
    const res = await client.callTool({
      name: 'update_system_config',
      arguments: { cron: '0 0 0 ? * * *' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.put).not.toHaveBeenCalled();
  });

  it('rejects an invalid discriminator enum value', async () => {
    const res = await client.callTool({
      name: 'update_system_config',
      arguments: { type: 'bogus' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.put).not.toHaveBeenCalled();
  });

  it('rejects an unknown top-level config field via assertConfigBody', async () => {
    mc.get.mockResolvedValueOnce({ type: 'storage' });
    const res = await client.callTool({
      name: 'update_system_config',
      arguments: { type: 'storage', config: { notAField: 'x' } },
    });
    expect(isError(res)).toBe(true);
    expect(mc.put).not.toHaveBeenCalled();
  });
});

describe('update_system_config (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id + tenant, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      tenant: 't1',
      type: 'storage',
      archiveStorage: 'old',
      magicLinkReportStorage: 'mlr-old',
    });
    mc.put.mockResolvedValueOnce({ type: 'storage' });
    await client.callTool({
      name: 'update_system_config',
      arguments: { type: 'storage', archiveStorage: 'new' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/system/configuration/storage');
    const [putPath, putBody] = mc.put.mock.calls[0]! as [
      string,
      Record<string, unknown>,
    ];
    expect(putPath).toBe('/api/v1/system/configuration');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).not.toHaveProperty('tenant');
    expect(putBody).toMatchObject({
      type: 'storage',
      archiveStorage: 'new',
      magicLinkReportStorage: 'mlr-old',
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      type: 'storage',
      archiveStorage: 'a',
      magicLinkReportStorage: 'm',
    });
    await client.callTool({
      name: 'update_system_config',
      arguments: { type: 'storage', clear_fields: ['archiveStorage'] },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['archiveStorage']).toBeNull();
  });
});
