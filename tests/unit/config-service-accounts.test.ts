/**
 * Service account config-tool unit tests.
 *
 * Verifies the typed CRUD family, collection-root POST/PUT routes, the delete
 * safety echo, and the static-JWKS GET/update serialization boundary.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    exportTimeout: 120000,
    principalName: undefined,
    horizonVersion: undefined,
  };
}
type MockClient = ReturnType<typeof createMockClient>;

function staticTrustConfig(jwks = '{"keys":[]}') {
  return { type: 'static_jwks', jwks };
}

function serviceAccountArgs() {
  return {
    name: 'ci-runner',
    trustConfig: staticTrustConfig(),
    validationRules: ['{{iss}} equals "https://issuer.example.com"'],
    permissions: [{ value: 'lifecycle:*:*:enroll' }],
    roles: ['operator'],
    iatFutureRestriction: '5 minutes',
    iatPastRestriction: '1 hour',
    jwtAllowedClockSkew: '30 seconds',
    identifierMapping: '{{sub}}',
  };
}

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

describe('service account tool registration', () => {
  it('registers list/get/create/update/delete', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of [
      'list_service_accounts',
      'get_service_account',
      'create_service_account',
      'update_service_account',
      'delete_service_account',
    ]) {
      expect(names).toContain(name);
    }
  });
});

describe('service account read tools', () => {
  it('lists from the collection', async () => {
    const { client, mc } = await setup();
    await client.callTool({ name: 'list_service_accounts', arguments: {} });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/security/service-accounts');
  });

  it('gets an item by name', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'get_service_account',
      arguments: { name: 'sa1' },
    });
    expect(mc.get).toHaveBeenCalledWith(
      '/api/v1/security/service-accounts/sa1',
    );
  });
});

describe('create_service_account', () => {
  let client: Client;
  let mc: MockClient;

  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs the typed payload to the collection', async () => {
    const args = serviceAccountArgs();
    await client.callTool({ name: 'create_service_account', arguments: args });
    expect(mc.post).toHaveBeenCalledWith(
      '/api/v1/security/service-accounts',
      args,
    );
  });

  it('creates dynamic JWKS trust with its configured proxy', async () => {
    const args = {
      ...serviceAccountArgs(),
      trustConfig: {
        type: 'dynamic_jwks',
        url: 'https://issuer.example.com/jwks',
        proxy: 'outbound-proxy',
      },
    };
    const result = await client.callTool({
      name: 'create_service_account',
      arguments: args,
    });
    expect(result.isError).not.toBe(true);
    expect(mc.post).toHaveBeenCalledWith(
      '/api/v1/security/service-accounts',
      args,
    );
  });

  it('rejects a dynamic JWKS URL without http(s)', async () => {
    const args = {
      ...serviceAccountArgs(),
      trustConfig: {
        type: 'dynamic_jwks',
        url: 'ftp://issuer.example.com/jwks',
      },
    };
    const result = await client.callTool({
      name: 'create_service_account',
      arguments: args,
    });
    expect(result.isError).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it.each(['iatPastRestriction', 'iatFutureRestriction'])(
    'rejects creating an account with only %s',
    async (field) => {
      const args: Record<string, unknown> = serviceAccountArgs();
      delete args[field];
      const result = await client.callTool({
        name: 'create_service_account',
        arguments: args,
      });
      expect(result.isError).toBe(true);
      expect(mc.post).not.toHaveBeenCalled();
    },
  );
});

describe('update_service_account', () => {
  it('PUTs the collection and re-stringifies static JWKS from the GET response', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'internal-id',
      tenant: 'default',
      readonly: true,
      name: 'ci-runner',
      trustConfig: { type: 'static_jwks', jwks: { keys: [{ kid: 'old' }] } },
      validationRules: ['{{iss}} equals "https://issuer.example.com"'],
      permissions: [{ value: 'lifecycle:*:*:enroll' }],
      roles: ['operator'],
    });
    await client.callTool({
      name: 'update_service_account',
      arguments: {
        name: 'ci-runner',
        validationRules: ['{{aud}} equals "horizon"'],
      },
    });

    expect(mc.get).toHaveBeenCalledWith(
      '/api/v1/security/service-accounts/ci-runner',
    );
    expect(mc.put).toHaveBeenCalledWith('/api/v1/security/service-accounts', {
      name: 'ci-runner',
      trustConfig: staticTrustConfig('{"keys":[{"kid":"old"}]}'),
      validationRules: ['{{aud}} equals "horizon"'],
      permissions: [{ value: 'lifecycle:*:*:enroll' }],
      roles: ['operator'],
    });
  });
});

describe('service-account clear fields', () => {
  it('clears optional restrictions while preserving trust and permissions', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce(serviceAccountArgs());
    const result = await client.callTool({
      name: 'update_service_account',
      arguments: {
        name: 'ci-runner',
        clear_fields: ['iatPastRestriction', 'iatFutureRestriction'],
      },
    });
    expect(result.isError).not.toBe(true);
    const expected: Record<string, unknown> = serviceAccountArgs();
    delete expected['iatPastRestriction'];
    delete expected['iatFutureRestriction'];
    expect(mc.put).toHaveBeenCalledWith(
      '/api/v1/security/service-accounts',
      expected,
    );
  });

  it.each(['iatPastRestriction', 'iatFutureRestriction'])(
    'rejects clearing only %s from a stored restriction pair',
    async (field) => {
      const { client, mc } = await setup();
      mc.get.mockResolvedValueOnce(serviceAccountArgs());
      const result = await client.callTool({
        name: 'update_service_account',
        arguments: { name: 'ci-runner', clear_fields: [field] },
      });
      expect(result.isError).toBe(true);
      expect(mc.put).not.toHaveBeenCalled();
    },
  );

  it('validates restrictions after merging with the stored account', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce(serviceAccountArgs());
    const result = await client.callTool({
      name: 'update_service_account',
      arguments: { name: 'ci-runner', iatPastRestriction: '2 hours' },
    });
    expect(result.isError).not.toBe(true);
    expect(mc.put).toHaveBeenCalledWith('/api/v1/security/service-accounts', {
      ...serviceAccountArgs(),
      iatPastRestriction: '2 hours',
    });
  });

  it('omits cleared optional strings instead of sending null', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce(serviceAccountArgs());
    const result = await client.callTool({
      name: 'update_service_account',
      arguments: {
        name: 'ci-runner',
        clear_fields: ['jwtAllowedClockSkew', 'identifierMapping'],
      },
    });
    expect(result.isError).not.toBe(true);
    const expected: Record<string, unknown> = serviceAccountArgs();
    delete expected['jwtAllowedClockSkew'];
    delete expected['identifierMapping'];
    expect(mc.put).toHaveBeenCalledWith(
      '/api/v1/security/service-accounts',
      expected,
    );
  });

  it.each([
    'name',
    'readonly',
    'trustConfig',
    'validationRules',
    'permissions',
    'roles',
    'unknownField',
  ])('rejects clearing %s before reading or writing Horizon', async (field) => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce(serviceAccountArgs());
    const result = await client.callTool({
      name: 'update_service_account',
      arguments: { name: 'ci-runner', clear_fields: [field] },
    });
    expect(result.isError).toBe(true);
    expect(mc.get).not.toHaveBeenCalled();
    expect(mc.put).not.toHaveBeenCalled();
  });
});

describe('delete_service_account', () => {
  it('DELETEs the item path when the safety echo matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_service_account',
      arguments: { name: 'ci-runner', expected_name: 'ci-runner' },
    });
    expect(mc.delete).toHaveBeenCalledWith(
      '/api/v1/security/service-accounts/ci-runner',
    );
  });
});
