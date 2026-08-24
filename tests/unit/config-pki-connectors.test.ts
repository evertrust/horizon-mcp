/**
 * PKI connector config tool-layer unit tests (complex / polymorphic).
 *
 * Verifies: tool registration (incl. describe-schema), the typed mandatory
 * params (name + type) merged with the validated `config` body into the exact
 * API payload, mandatory/discriminator enforcement, the GET-strip-merge-PUT
 * update cycle (PUT on collection root, audited strip fields removed), the
 * delete safety echo, and that describe_pki_connector_schema returns the schema.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerPkiConnectorTools } from '../../src/tools/config/pki-connectors.js';

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
  registerPkiConnectorTools(
    server,
    mc as unknown as Parameters<typeof registerPkiConnectorTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('pki_connector tools registration', () => {
  it('registers the expected pki_connector tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'describe_pki_connector_schema',
      'list_pki_connectors',
      'get_pki_connector',
      'create_pki_connector',
      'update_pki_connector',
      'delete_pki_connector',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('describe_pki_connector_schema', () => {
  it('returns the embedded schema, discriminator and subtypes', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_pki_connector_schema',
      arguments: {},
    });
    const out = parse(res);
    expect(out['object']).toBe('pki_connector');
    expect(out['discriminatorField']).toBe('type');
    expect(out['subtypes']).toContain('stream');
    expect(out['subtypes']).toContain('integrated');
    const schema = out['jsonSchema'] as Record<string, unknown>;
    expect(schema).toHaveProperty('oneOf');
    expect(schema).toHaveProperty('$defs');
  });

  it('narrows to a subtype when requested', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_pki_connector_schema',
      arguments: { subtype: 'stream' },
    });
    expect(parse(res)['requestedSubtype']).toBe('stream');
  });
});

describe('create_pki_connector', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('merges name+type+config into the exact API payload and POSTs the collection', async () => {
    mc.post.mockResolvedValueOnce({ name: 'c1', type: 'stream' });
    const res = await client.callTool({
      name: 'create_pki_connector',
      arguments: {
        name: 'c1',
        type: 'stream',
        config: {
          endPoint: 'https://stream.local',
          template: 'tpl',
          ca: 'myca',
          loginCredentials: 'creds',
        },
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/pki/connectors', {
      endPoint: 'https://stream.local',
      template: 'tpl',
      ca: 'myca',
      loginCredentials: 'creds',
      name: 'c1',
      type: 'stream',
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('rejects a missing mandatory field (type) via schema validation and does not POST', async () => {
    const res = await client.callTool({
      name: 'create_pki_connector',
      arguments: { name: 'c1', config: { endPoint: 'x' } },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects a missing mandatory field (name) via schema validation and does not POST', async () => {
    const res = await client.callTool({
      name: 'create_pki_connector',
      arguments: { type: 'stream', config: { endPoint: 'x' } },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an invalid discriminator (type) enum and does not POST', async () => {
    const res = await client.callTool({
      name: 'create_pki_connector',
      arguments: { name: 'c1', type: 'bogus', config: {} },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an unknown top-level config field and does not POST', async () => {
    const res = await client.callTool({
      name: 'create_pki_connector',
      arguments: { name: 'c1', type: 'stream', config: { notAField: 1 } },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_pki_connector (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips server fields, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      status: 'enabled',
      tenant: 't1',
      account: 'acct',
      accountUrl: 'https://acct',
      name: 'c1',
      type: 'stream',
      endPoint: 'old',
      template: 'tpl',
      ca: 'myca',
    });
    mc.put.mockResolvedValueOnce({ name: 'c1', type: 'stream' });
    await client.callTool({
      name: 'update_pki_connector',
      arguments: {
        name: 'c1',
        type: 'stream',
        config: { endPoint: 'new', template: 'tpl', ca: 'myca' },
      },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/pki/connectors/c1');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/pki/connectors');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).not.toHaveProperty('status');
    expect(putBody).not.toHaveProperty('tenant');
    expect(putBody).not.toHaveProperty('account');
    expect(putBody).not.toHaveProperty('accountUrl');
    expect(putBody).toMatchObject({
      name: 'c1',
      type: 'stream',
      endPoint: 'new',
    });
  });

  it('clear_fields nulls a top-level field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'c1',
      type: 'stream',
      endPoint: 'e',
      template: 'tpl',
      ca: 'myca',
      proxy: 'p1',
    });
    await client.callTool({
      name: 'update_pki_connector',
      arguments: {
        name: 'c1',
        type: 'stream',
        config: { endPoint: 'e', template: 'tpl', ca: 'myca' },
        clear_fields: ['proxy'],
      },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['proxy']).toBeNull();
  });
});

describe('delete_pki_connector safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_pki_connector',
      arguments: { name: 'c1', expected_name: 'c1' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/pki/connectors/c1');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_pki_connector',
      arguments: { name: 'c1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
