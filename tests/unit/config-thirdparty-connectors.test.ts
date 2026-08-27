/**
 * Third-party connector config tool-layer unit tests (complex / polymorphic).
 *
 * Verifies: tool registration (incl describe_schema), the describe tool returns
 * the embedded resolved schema, create merges typed params + config into the
 * exact API body (POST), mandatory/discriminator enforcement (no POST on
 * failure), netscaler's extra mandatory fields, the GET-strip-merge-PUT update
 * cycle (PUT on collection root, _id/tenant stripped), and the delete safety echo.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerThirdpartyConnectorTools } from '../../src/tools/config/thirdparty-connectors.js';

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
function structured(result: unknown): Record<string, unknown> {
  return (
    ((result as { structuredContent?: Record<string, unknown> })
      .structuredContent as Record<string, unknown>) ?? {}
  );
}

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerThirdpartyConnectorTools(
    server,
    mc as unknown as Parameters<typeof registerThirdpartyConnectorTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

const ROUTE = '/api/v1/thirdparty/connectors';

describe('thirdparty connector tools registration', () => {
  it('registers list/get/describe/create/update/delete', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_thirdparty_connectors',
      'get_thirdparty_connector',
      'describe_thirdparty_connector_schema',
      'create_thirdparty_connector',
      'update_thirdparty_connector',
      'delete_thirdparty_connector',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('describe_thirdparty_connector_schema', () => {
  it('returns the embedded resolved schema and subtype list', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_thirdparty_connector_schema',
      arguments: {},
    });
    const out = parse(res);
    expect(out['object']).toBe('thirdparty_connector');
    expect(out['discriminatorField']).toBe('type');
    expect(out['subtypes']).toContain('netscaler');
    expect(out['subtypes']).toContain('aws');
    const schema = out['jsonSchema'] as Record<string, unknown>;
    const defs = schema['$defs'] as Record<string, unknown>;
    expect(defs).toHaveProperty('NetscalerConnector');
    expect(defs).toHaveProperty('AWSConnector');
  });

  it('echoes the requested subtype', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_thirdparty_connector_schema',
      arguments: { subtype: 'netscaler' },
    });
    expect(parse(res)['requestedSubtype']).toBe('netscaler');
  });
});

describe('create_thirdparty_connector', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('merges typed params + config into the exact API body (aws)', async () => {
    mc.post.mockResolvedValueOnce({ name: 'aws1' });
    const res = await client.callTool({
      name: 'create_thirdparty_connector',
      arguments: {
        type: 'aws',
        name: 'aws1',
        throttle_duration: '5 seconds',
        config: { region: 'eu-west-1', credentials: 'aws-creds' },
      },
    });
    expect(mc.post).toHaveBeenCalledWith(ROUTE, {
      type: 'aws',
      name: 'aws1',
      throttleDuration: '5 seconds',
      region: 'eu-west-1',
      credentials: 'aws-creds',
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('rejects a missing typed mandatory field (throttle_duration) via schema', async () => {
    const res = await client.callTool({
      name: 'create_thirdparty_connector',
      arguments: {
        type: 'aws',
        name: 'aws1',
        config: { region: 'eu-west-1' },
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects a missing discriminator (type) via schema', async () => {
    const res = await client.callTool({
      name: 'create_thirdparty_connector',
      arguments: {
        name: 'aws1',
        throttle_duration: '5 seconds',
        config: { region: 'eu-west-1' },
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an invalid discriminator enum value', async () => {
    const res = await client.callTool({
      name: 'create_thirdparty_connector',
      arguments: {
        type: 'bogus',
        name: 'x',
        throttle_duration: '5 seconds',
        config: {},
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects a subtype-mandatory field missing in config (aws region)', async () => {
    const res = await client.callTool({
      name: 'create_thirdparty_connector',
      arguments: {
        type: 'aws',
        name: 'aws1',
        throttle_duration: '5 seconds',
        config: {},
      },
    });
    expect(isError(res)).toBe(true);
    expect(structured(res)['errorCode']).toBe('CONFIG-MISSING-MANDATORY');
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an unknown top-level config field', async () => {
    const res = await client.callTool({
      name: 'create_thirdparty_connector',
      arguments: {
        type: 'aws',
        name: 'aws1',
        throttle_duration: '5 seconds',
        config: { region: 'eu-west-1', bogusField: 1 },
      },
    });
    expect(isError(res)).toBe(true);
    expect(structured(res)['errorCode']).toBe('CONFIG-UNKNOWN-FIELD');
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('netscaler requires timeout + maxStoredCertificatePerHolder', async () => {
    const res = await client.callTool({
      name: 'create_thirdparty_connector',
      arguments: {
        type: 'netscaler',
        name: 'ns1',
        throttle_duration: '5 seconds',
        config: {
          throttleParallelism: 1,
          prefix: 'p',
          hostname: 'ns.local',
          credentials: 'ns-creds',
          certificateStorePath: '/store',
        },
      },
    });
    expect(isError(res)).toBe(true);
    const out = structured(res);
    expect(out['errorCode']).toBe('CONFIG-MISSING-MANDATORY');
    expect(String(out['message'])).toContain('timeout');
    expect(String(out['message'])).toContain('maxStoredCertificatePerHolder');
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('accepts a fully-specified netscaler body', async () => {
    mc.post.mockResolvedValueOnce({ name: 'ns1' });
    await client.callTool({
      name: 'create_thirdparty_connector',
      arguments: {
        type: 'netscaler',
        name: 'ns1',
        throttle_duration: '5 seconds',
        config: {
          throttleParallelism: 1,
          timeout: '30 seconds',
          maxStoredCertificatePerHolder: 5,
          prefix: 'p',
          hostname: 'ns.local',
          credentials: 'ns-creds',
          certificateStorePath: '/store',
        },
      },
    });
    expect(mc.post).toHaveBeenCalledWith(ROUTE, {
      type: 'netscaler',
      name: 'ns1',
      throttleDuration: '5 seconds',
      throttleParallelism: 1,
      timeout: '30 seconds',
      maxStoredCertificatePerHolder: 5,
      prefix: 'p',
      hostname: 'ns.local',
      credentials: 'ns-creds',
      certificateStorePath: '/store',
    });
  });

  it('rejects an invalid ldappub enum (userIdentifierAttribute)', async () => {
    const res = await client.callTool({
      name: 'create_thirdparty_connector',
      arguments: {
        type: 'ldappub',
        name: 'l1',
        throttle_duration: '5 seconds',
        config: {
          throttleParallelism: 1,
          maxStoredCertificatePerHolder: 5,
          hostname: 'ldap.local',
          credentials: 'ldap-creds',
          baseDn: 'dc=example,dc=com',
          userIdentifierAttribute: 'BOGUS',
          certificateAttribute: 'CN',
        },
      },
    });
    expect(isError(res)).toBe(true);
    expect(structured(res)['errorCode']).toBe('CONFIG-BAD-ENUM');
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_thirdparty_connector (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id+tenant, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      tenant: 'default',
      type: 'aws',
      name: 'aws1',
      throttleDuration: '5 seconds',
      region: 'eu-west-1',
      credentials: 'old-creds',
    });
    mc.put.mockResolvedValueOnce({ name: 'aws1' });
    await client.callTool({
      name: 'update_thirdparty_connector',
      arguments: {
        type: 'aws',
        name: 'aws1',
        throttle_duration: '10 seconds',
        config: { region: 'eu-west-1', credentials: 'new-creds' },
      },
    });
    expect(mc.get).toHaveBeenCalledWith(`${ROUTE}/aws1`);
    const [putPath, putBody] = mc.put.mock.calls[0]! as [
      string,
      Record<string, unknown>,
    ];
    expect(putPath).toBe(ROUTE);
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).not.toHaveProperty('tenant');
    expect(putBody).toMatchObject({
      type: 'aws',
      name: 'aws1',
      throttleDuration: '10 seconds',
      region: 'eu-west-1',
      credentials: 'new-creds',
    });
  });

  it('clear_fields nulls a field before merge', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      type: 'aws',
      name: 'aws1',
      throttleDuration: '5 seconds',
      region: 'eu-west-1',
      proxy: 'p1',
    });
    await client.callTool({
      name: 'update_thirdparty_connector',
      arguments: {
        type: 'aws',
        name: 'aws1',
        throttle_duration: '5 seconds',
        config: { region: 'eu-west-1' },
        clear_fields: ['proxy'],
      },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['proxy']).toBeNull();
  });
});

describe('delete_thirdparty_connector safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_thirdparty_connector',
      arguments: { name: 'aws1', expected_name: 'aws1' },
    });
    expect(mc.delete).toHaveBeenCalledWith(`${ROUTE}/aws1`);
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_thirdparty_connector',
      arguments: { name: 'aws1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
