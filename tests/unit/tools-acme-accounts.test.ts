import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAcmeTools } from '../../src/tools/acme/index.js';

function mockClient() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(null),
    exportTimeout: 120000,
  };
}

type MockClient = ReturnType<typeof mockClient>;

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = mockClient();
  registerAcmeTools(server, mc as any);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, mc };
}

function parse(result: unknown): Record<string, unknown> {
  return JSON.parse(
    (result as { content: Array<{ text: string }> }).content[0]!.text,
  ) as Record<string, unknown>;
}

describe('ACME account and order tools', () => {
  let client: Client;
  let mc: MockClient;

  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('registers the thirteen ACME tools and marks destructive actions', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);
    const annotations = new Map(
      tools.map((tool) => [tool.name, tool.annotations]),
    );
    expect(annotations.get('update_acme_account_status')?.destructiveHint).toBe(
      true,
    );
    expect(annotations.get('renew_acme_eab')?.destructiveHint).toBe(true);
  });

  it('searches accounts with the shared 0-based pagination convention', async () => {
    mc.post.mockResolvedValueOnce({
      results: [{ _id: 'account-1' }],
      count: 1,
      hasMore: false,
    });
    const result = await client.callTool({
      name: 'search_acme_accounts',
      arguments: {
        query: 'status equals "valid"',
        page_size: 10,
        sorted_by: 'createdAt:desc',
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/acme/accounts/search', {
      query: 'status equals "valid"',
      pageIndex: 1,
      pageSize: 10,
      sortedBy: [{ element: 'createdAt', order: 'Desc' }],
      withCount: true,
    });
    expect(parse(result)['results']).toEqual([{ _id: 'account-1' }]);
  });

  it('encodes account IDs and sends status compromise details', async () => {
    await client.callTool({
      name: 'get_acme_account',
      arguments: { account_id: 'a/b' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/acme/accounts/a%2Fb');
    await client.callTool({
      name: 'update_acme_account_status',
      arguments: {
        account_id: 'account-1',
        status: 'compromised',
        compromised_at: 1,
        compromission_reason: 'keycompromise',
      },
    });
    expect(mc.post).toHaveBeenLastCalledWith(
      '/api/v1/acme/accounts/account-1/status',
      {
        status: 'compromised',
        compromisedAt: 1,
        compromissionReason: 'keycompromise',
      },
    );
  });

  it('requires an exact account echo before deletion', async () => {
    const refused = await client.callTool({
      name: 'delete_acme_account',
      arguments: { account_id: 'account-1', expected_account_id: 'other' },
    });
    expect((refused as { isError?: boolean }).isError).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });

  it('lists account orders and gets an individual order', async () => {
    mc.post.mockResolvedValueOnce({ results: [], hasMore: false });
    await client.callTool({
      name: 'list_acme_orders',
      arguments: { account_id: 'account-1' },
    });
    expect(mc.post).toHaveBeenCalledWith(
      '/api/v1/acme/orders/account/account-1',
      {
        pageIndex: 1,
        pageSize: 25,
        withCount: true,
      },
    );
    await client.callTool({
      name: 'get_acme_order',
      arguments: { order_id: 'order/1' },
    });
    expect(mc.get).toHaveBeenLastCalledWith('/api/v1/acme/orders/order%2F1');
  });
});
