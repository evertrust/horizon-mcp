/**
 * DCV provisioner config-tool unit tests (flat/typed, discriminated, 2.10).
 *
 * Verifies registration, the cloudflare create payload (incl. zoneIdMappings),
 * the per-type required-field guard (cloudflare/powerdns/efficientip need
 * endpoint+credentials; efficientip also dnsName; azuredns needs tenantId/
 * subscriptionId/resourceGroupName; route53 needs none extra), and the delete
 * safety echo.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDcvProvisionerTools } from '../../src/tools/config/dcv-provisioners.js';

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
  const r = result as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}
function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerDcvProvisionerTools(
    server,
    mc as unknown as Parameters<typeof registerDcvProvisionerTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('dcv provisioner tools registration', () => {
  it('registers the expected dcv_provisioner tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_dcv_provisioners',
      'get_dcv_provisioner',
      'create_dcv_provisioner',
      'update_dcv_provisioner',
      'delete_dcv_provisioner',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_dcv_provisioner per-type payload + validation', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs a cloudflare provisioner with zoneIdMappings', async () => {
    mc.post.mockResolvedValueOnce({ name: 'cf' });
    await client.callTool({
      name: 'create_dcv_provisioner',
      arguments: {
        name: 'cf',
        type: 'cloudflare',
        endpoint: 'https://api.cloudflare.com',
        credentials: 'cf-creds',
        timeout: '30 seconds',
        ttl: '60 seconds',
        zoneIdMappings: [{ regex: '.*', zoneId: 'z1' }],
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/dcv/provisioners', {
      name: 'cf',
      type: 'cloudflare',
      ttl: '60 seconds',
      timeout: '30 seconds',
      endpoint: 'https://api.cloudflare.com',
      credentials: 'cf-creds',
      zoneIdMappings: [{ regex: '.*', zoneId: 'z1' }],
    });
  });

  it('rejects cloudflare without endpoint+credentials (per-type guard, no POST)', async () => {
    const res = await client.callTool({
      name: 'create_dcv_provisioner',
      arguments: {
        name: 'cf',
        type: 'cloudflare',
        timeout: '30 seconds',
        ttl: '60 seconds',
      },
    });
    expect(parse(res)['error']).toMatch(/endpoint/);
    expect(parse(res)['error']).toMatch(/credentials/);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects azuredns without tenantId/subscriptionId/resourceGroupName', async () => {
    const res = await client.callTool({
      name: 'create_dcv_provisioner',
      arguments: {
        name: 'az',
        type: 'azuredns',
        timeout: '30 seconds',
        ttl: '60 seconds',
      },
    });
    expect(parse(res)['error']).toMatch(/tenantId/);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('POSTs azuredns when its required fields are present (endpoint/credentials optional)', async () => {
    mc.post.mockResolvedValueOnce({ name: 'az' });
    await client.callTool({
      name: 'create_dcv_provisioner',
      arguments: {
        name: 'az',
        type: 'azuredns',
        timeout: '30 seconds',
        ttl: '60 seconds',
        tenantId: 't',
        subscriptionId: 's',
        resourceGroupName: 'rg',
      },
    });
    const body = mc.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'azuredns',
      tenantId: 't',
      subscriptionId: 's',
      resourceGroupName: 'rg',
    });
    expect(body).not.toHaveProperty('endpoint');
    expect(body).not.toHaveProperty('credentials');
  });

  it('POSTs route53 with no extra required fields', async () => {
    mc.post.mockResolvedValueOnce({ name: 'r53' });
    await client.callTool({
      name: 'create_dcv_provisioner',
      arguments: {
        name: 'r53',
        type: 'route53',
        timeout: '30 seconds',
        ttl: '60 seconds',
        region: 'eu-west-1',
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/dcv/provisioners', {
      name: 'r53',
      type: 'route53',
      ttl: '60 seconds',
      timeout: '30 seconds',
      region: 'eu-west-1',
    });
  });
});

describe('delete_dcv_provisioner safety echo', () => {
  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_dcv_provisioner',
      arguments: { name: 'cf', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
