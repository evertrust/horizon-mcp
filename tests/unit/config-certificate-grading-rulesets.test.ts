/**
 * Certificate grading ruleset config-tool unit tests (READ-ONLY object).
 *
 * Verifies that exactly the read tools (list + get) are registered per the
 * contract verbs ["list", "get_one"] (no create/update/delete), that list GETs
 * the collection route, that get GETs the item route with the name encoded, and
 * that the list result is shaped as a list response. Modeled on
 * tests/unit/config-certificate-grading-policies.test.ts.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

import { registerCertificateGradingRulesetTools } from '../../src/tools/config/certificate-grading-rulesets.js';

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

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerCertificateGradingRulesetTools(
    server,
    mc as unknown as Parameters<
      typeof registerCertificateGradingRulesetTools
    >[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('certificate grading ruleset tools registration', () => {
  it('registers exactly the read tools (list + get), no write tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('list_certificate_grading_rulesets');
    expect(names).toContain('get_certificate_grading_ruleset');
    for (const n of [
      'create_certificate_grading_ruleset',
      'update_certificate_grading_ruleset',
      'delete_certificate_grading_ruleset',
    ]) {
      expect(names).not.toContain(n);
    }
  });
});

describe('list_certificate_grading_rulesets', () => {
  it('GETs the collection route and returns a list response', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce([
      {
        _id: 'abc',
        name: 'default',
        rules: [{ description: [], condition: 'true', score: 100 }],
      },
    ]);
    const res = await client.callTool({
      name: 'list_certificate_grading_rulesets',
      arguments: {},
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/certificate/grading/rulesets');
    const body = parse(res);
    expect(body['kind']).toBe('certificate_grading_ruleset');
    expect(Array.isArray(body['items'])).toBe(true);
    expect((body['items'] as unknown[]).length).toBe(1);
  });

  it('applies the name_contains filter', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce([
      { _id: '1', name: 'default', rules: [] },
      { _id: '2', name: 'strict', rules: [] },
    ]);
    const res = await client.callTool({
      name: 'list_certificate_grading_rulesets',
      arguments: { name_contains: 'strict' },
    });
    const items = parse(res)['items'] as Array<Record<string, unknown>>;
    expect(items.length).toBe(1);
    expect(items[0]!['name']).toBe('strict');
  });
});

describe('get_certificate_grading_ruleset', () => {
  it('GETs the item route with the name encoded', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      name: 'TLS Server',
      rules: [{ description: [], condition: 'true', score: 100 }],
    });
    const res = await client.callTool({
      name: 'get_certificate_grading_ruleset',
      arguments: { name: 'TLS Server' },
    });
    expect(mc.get).toHaveBeenCalledWith(
      '/api/v1/certificate/grading/rulesets/TLS%20Server',
    );
    const body = parse(res);
    expect(body['name']).toBe('TLS Server');
  });
});
