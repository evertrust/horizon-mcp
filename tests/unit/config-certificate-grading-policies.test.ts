/**
 * Certificate grading policy config tool-layer unit tests (READ-ONLY object).
 *
 * Verifies that only the read tools are registered (no create/update/delete -
 * Horizon exposes no write body for grading policies), that list GETs the
 * collection route, and that get GETs the item route with the name encoded.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

import { registerCertificateGradingPolicyTools } from '../../src/tools/config/certificate-grading-policies.js';

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

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerCertificateGradingPolicyTools(
    server,
    mc as unknown as Parameters<
      typeof registerCertificateGradingPolicyTools
    >[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('certificate grading policy tools registration', () => {
  it('registers exactly the read tools (list + get), no write tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('list_certificate_grading_policies');
    expect(names).toContain('get_certificate_grading_policy');
    for (const n of [
      'create_certificate_grading_policy',
      'update_certificate_grading_policy',
      'delete_certificate_grading_policy',
    ]) {
      expect(names).not.toContain(n);
    }
  });
});

describe('list_certificate_grading_policies', () => {
  it('GETs the collection route', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce([
      { _id: 'a', name: 'Horizon-Grading-Policy', rulesets: [] },
    ]);
    await client.callTool({
      name: 'list_certificate_grading_policies',
      arguments: {},
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/certificate/grading/policies');
  });
});

describe('get_certificate_grading_policy', () => {
  it('GETs the item route with the name encoded', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'a',
      name: 'Horizon-Grading-Policy',
      rulesets: [{ ruleset: 'r1', weight: 2 }],
    });
    await client.callTool({
      name: 'get_certificate_grading_policy',
      arguments: { name: 'Horizon-Grading-Policy' },
    });
    expect(mc.get).toHaveBeenCalledWith(
      '/api/v1/certificate/grading/policies/Horizon-Grading-Policy',
    );
  });
});
