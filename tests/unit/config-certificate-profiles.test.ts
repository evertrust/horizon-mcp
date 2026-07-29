/**
 * Certificate Profile config tool-layer unit tests (polymorphic / "poly").
 *
 * Verifies the poly scaffold wiring for certificate profiles: tool
 * registration (incl describe_certificate_profile_schema), typed-mandatory +
 * config payload mapping (snake_case -> camelCase), mandatory/discriminator
 * enforcement, the GET-strip-merge-PUT update cycle (PUT on collection root,
 * _id + tenant stripped), the delete safety echo, and that the describe tool
 * returns the embedded JSON Schema.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCertificateProfileTools } from '../../src/tools/config/certificate-profiles.js';

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
  registerCertificateProfileTools(
    server,
    mc as unknown as Parameters<typeof registerCertificateProfileTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

/** Minimal set of mandatory params for create_certificate_profile. */
function mandatoryArgs(overrides: Record<string, unknown> = {}) {
  return {
    module: 'monitored',
    name: 'cp1',
    enabled: true,
    authorization_levels: { search: { accessLevel: 'authenticated' } },
    requests_policy: { enroll: '5 minutes' },
    self_permissions: { selfRevoke: true },
    crypto_policy: { escrow: false },
    ...overrides,
  };
}

describe('certificate profile tools registration', () => {
  it('registers list/get/create/update/delete + describe tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_certificate_profiles',
      'get_certificate_profile',
      'create_certificate_profile',
      'update_certificate_profile',
      'delete_certificate_profile',
      'describe_certificate_profile_schema',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('describe_certificate_profile_schema', () => {
  it('returns the embedded JSON Schema and subtypes', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_certificate_profile_schema',
      arguments: {},
    });
    const out = parse(res);
    expect(out['object']).toBe('certificate_profile');
    expect(out['discriminatorField']).toBe('module');
    const schema = out['jsonSchema'] as Record<string, unknown>;
    expect(schema).toBeTruthy();
    expect(Array.isArray(schema['oneOf'])).toBe(true);
    expect((schema['oneOf'] as unknown[]).length).toBe(11);
    expect(out['subtypes']).toContain('MonitoredProfile');
  });

  it('echoes the requested subtype when narrowing', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_certificate_profile_schema',
      arguments: { subtype: 'scep' },
    });
    expect(parse(res)['requestedSubtype']).toBe('scep');
  });
});

describe('create_certificate_profile (typed mandatory + config mapping)', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('maps snake_case mandatory params to camelCase API keys and merges config', async () => {
    mc.post.mockResolvedValueOnce({ name: 'cp1' });
    await client.callTool({
      name: 'create_certificate_profile',
      arguments: mandatoryArgs({
        config: { displayName: [{ lang: 'en', value: 'CP One' }] },
      }),
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/certificate/profiles', {
      module: 'monitored',
      name: 'cp1',
      enabled: true,
      authorizationLevels: { search: { accessLevel: 'authenticated' } },
      requestsPolicy: { enroll: '5 minutes' },
      selfPermissions: { selfRevoke: true },
      cryptoPolicy: { escrow: false },
      displayName: [{ lang: 'en', value: 'CP One' }],
    });
  });

  it('rejects a missing mandatory field (crypto_policy) via schema validation; post not called', async () => {
    const args = mandatoryArgs();
    delete (args as Record<string, unknown>)['crypto_policy'];
    const res = await client.callTool({
      name: 'create_certificate_profile',
      arguments: args,
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects a missing discriminator (module) via schema validation; post not called', async () => {
    const args = mandatoryArgs();
    delete (args as Record<string, unknown>)['module'];
    const res = await client.callTool({
      name: 'create_certificate_profile',
      arguments: args,
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an invalid module enum value; post not called', async () => {
    const res = await client.callTool({
      name: 'create_certificate_profile',
      arguments: mandatoryArgs({ module: 'bogus' }),
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an unknown top-level config field; post not called', async () => {
    const res = await client.callTool({
      name: 'create_certificate_profile',
      arguments: mandatoryArgs({ config: { notAField: 1 } }),
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_certificate_profile (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id + tenant, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      tenant: 't1',
      module: 'monitored',
      name: 'cp1',
      enabled: true,
      gradingPolicies: ['old'],
    });
    mc.put.mockResolvedValueOnce({ name: 'cp1' });
    await client.callTool({
      name: 'update_certificate_profile',
      arguments: { name: 'cp1', enabled: false },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/certificate/profiles/cp1');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/certificate/profiles');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).not.toHaveProperty('tenant');
    expect(putBody).toMatchObject({
      module: 'monitored',
      name: 'cp1',
      enabled: false,
      gradingPolicies: ['old'],
    });
  });

  it('clear_fields nulls a top-level field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      module: 'monitored',
      name: 'cp1',
      enabled: true,
      proxy: 'p1',
    });
    await client.callTool({
      name: 'update_certificate_profile',
      arguments: { name: 'cp1', clear_fields: ['proxy'] },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['proxy']).toBeNull();
  });

  it('rejects an unknown top-level config field on update; get/put not called', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'update_certificate_profile',
      arguments: { name: 'cp1', config: { notAField: 1 } },
    });
    expect(isError(res)).toBe(true);
    expect(mc.get).not.toHaveBeenCalled();
    expect(mc.put).not.toHaveBeenCalled();
  });
});

describe('delete_certificate_profile safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_certificate_profile',
      arguments: { name: 'cp1', expected_name: 'cp1' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/certificate/profiles/cp1');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_certificate_profile',
      arguments: { name: 'cp1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
