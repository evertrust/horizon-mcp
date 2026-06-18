/**
 * WCCE forest mapping config-tool unit tests (typed object).
 *
 * Verifies: tool registration, snake_case -> camelCase payload mapping (incl.
 * the nested templateMappings array), mandatory-field enforcement, the
 * GET-strip-merge-PUT update cycle (PUT on collection root, _id stripped, item
 * route keyed by `forest`), and the delete safety echo via expected_forest.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerWcceForestTools } from '../../src/tools/config/wcce-forests.js';

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
  registerWcceForestTools(
    server,
    mc as unknown as Parameters<typeof registerWcceForestTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('wcce_forest tools registration', () => {
  it('registers the expected wcce_forest tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_wcce_forests',
      'get_wcce_forest',
      'create_wcce_forest',
      'update_wcce_forest',
      'delete_wcce_forest',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_wcce_forest (mandatory + nested camelCase mapping)', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('maps snake_case inputs to the exact camelCase payload', async () => {
    mc.post.mockResolvedValueOnce({ forest: 'corp.example' });
    const res = await client.callTool({
      name: 'create_wcce_forest',
      arguments: {
        forest: 'corp.example',
        template_mappings: [
          {
            template: 'Web Server',
            profile: 'wcce-web',
            enrollment_mode: 'eobo',
            eobo_trusted_cas: ['ca-1', 'ca-2'],
            template_version: 'v2',
          },
        ],
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/wcce/forests', {
      forest: 'corp.example',
      templateMappings: [
        {
          template: 'Web Server',
          profile: 'wcce-web',
          enrollmentMode: 'eobo',
          eoboTrustedCas: ['ca-1', 'ca-2'],
          templateVersion: 'v2',
        },
      ],
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('omits optional nested fields when not supplied', async () => {
    mc.post.mockResolvedValueOnce({ forest: 'corp.example' });
    await client.callTool({
      name: 'create_wcce_forest',
      arguments: {
        forest: 'corp.example',
        template_mappings: [
          { template: 'User', profile: 'wcce-user', enrollment_mode: 'entity' },
        ],
      },
    });
    const body = mc.post.mock.calls[0]![1] as Record<string, unknown>;
    const mapping = (body['templateMappings'] as Record<string, unknown>[])[0]!;
    expect(mapping).toEqual({
      template: 'User',
      profile: 'wcce-user',
      enrollmentMode: 'entity',
    });
    expect(mapping).not.toHaveProperty('eoboTrustedCas');
    expect(mapping).not.toHaveProperty('templateVersion');
  });

  it('rejects a missing mandatory field (template_mappings) and does not POST', async () => {
    const res = await client.callTool({
      name: 'create_wcce_forest',
      arguments: { forest: 'corp.example' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an invalid enrollment_mode enum', async () => {
    const res = await client.callTool({
      name: 'create_wcce_forest',
      arguments: {
        forest: 'corp.example',
        template_mappings: [
          { template: 'User', profile: 'p', enrollment_mode: 'bogus' },
        ],
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_wcce_forest (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item by forest, strips _id, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      forest: 'corp.example',
      templateMappings: [
        { template: 'Old', profile: 'p-old', enrollmentMode: 'entity' },
      ],
    });
    mc.put.mockResolvedValueOnce({ forest: 'corp.example' });
    await client.callTool({
      name: 'update_wcce_forest',
      arguments: {
        forest: 'corp.example',
        template_mappings: [
          {
            template: 'New',
            profile: 'p-new',
            enrollment_mode: 'trust_request',
          },
        ],
      },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/wcce/forests/corp.example');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/wcce/forests');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).toMatchObject({
      forest: 'corp.example',
      templateMappings: [
        { template: 'New', profile: 'p-new', enrollmentMode: 'trust_request' },
      ],
    });
  });
});

describe('delete_wcce_forest safety echo', () => {
  it('deletes when expected_forest matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_wcce_forest',
      arguments: { forest: 'corp.example', expected_forest: 'corp.example' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/wcce/forests/corp.example');
  });

  it('refuses when expected_forest does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_wcce_forest',
      arguments: { forest: 'corp.example', expected_forest: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
