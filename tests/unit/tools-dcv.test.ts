import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDcvLifecycleTools } from '../../src/tools/dcv-lifecycle.js';

function createMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
  };
}

type MockClient = ReturnType<typeof createMockClient>;

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerDcvLifecycleTools(
    server,
    mc as unknown as Parameters<typeof registerDcvLifecycleTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

function parseResult(result: { content: unknown }) {
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content[0]!.text!) as unknown;
}

describe('DCV lifecycle tools', () => {
  let client: Client;
  let mc: MockClient;

  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('registers the six tools with the correct safety classifications', async () => {
    const tools = (await client.listTools()).tools;
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of [
      'list_dcv_policy_status',
      'get_dcv_policy_status',
      'run_dcv_policy',
      'run_dcv_domain',
      'cancel_dcv_run',
      'list_dcv_events',
    ]) {
      expect(byName.has(name), `${name} is registered`).toBe(true);
    }
    expect(
      byName.get('list_dcv_policy_status')?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(byName.get('get_dcv_policy_status')?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(byName.get('run_dcv_policy')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('run_dcv_domain')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('cancel_dcv_run')?.annotations?.destructiveHint).toBe(
      true,
    );
  });

  it('lists policy status and normalizes an empty 204 response to an array', async () => {
    mc.get.mockResolvedValueOnce(null);
    const result = await client.callTool({
      name: 'list_dcv_policy_status',
      arguments: {},
    });

    expect(mc.get).toHaveBeenCalledWith('/api/v1/dcv/lifecycle/policies');
    expect(parseResult(result)).toEqual([]);
  });

  it('gets the full status DTO for an encoded policy name', async () => {
    mc.get.mockResolvedValueOnce({
      name: 'policy one',
      enabled: true,
      renewalPeriod: 'P30D',
      executionTimeout: '5 minutes',
      retryDelay: '1 minute',
      runnable: true,
      status: 'enabled',
      domainsStatus: { domains: [] },
    });
    const result = await client.callTool({
      name: 'get_dcv_policy_status',
      arguments: { name: 'policy one' },
    });

    expect(mc.get).toHaveBeenCalledWith(
      '/api/v1/dcv/lifecycle/policies/policy%20one',
    );
    expect(parseResult(result)).toMatchObject({
      name: 'policy one',
      domainsStatus: { domains: [] },
    });
  });

  it('posts policy, domain, and cancellation lifecycle actions to their exact routes', async () => {
    mc.post.mockResolvedValue({});
    await client.callTool({
      name: 'run_dcv_policy',
      arguments: { name: 'policy one' },
    });
    await client.callTool({
      name: 'run_dcv_domain',
      arguments: { name: 'policy one', domain: 'www.example.test' },
    });
    await client.callTool({
      name: 'cancel_dcv_run',
      arguments: { name: 'policy one' },
    });

    expect(mc.post).toHaveBeenNthCalledWith(
      1,
      '/api/v1/dcv/lifecycle/policies/policy%20one/run',
    );
    expect(mc.post).toHaveBeenNthCalledWith(
      2,
      '/api/v1/dcv/lifecycle/policies/policy%20one/run/www.example.test',
    );
    expect(mc.post).toHaveBeenNthCalledWith(
      3,
      '/api/v1/dcv/lifecycle/policies/policy%20one/cancel',
    );
  });

  it('posts only the accepted event paging body and preserves removeAt', async () => {
    mc.post.mockResolvedValueOnce({
      results: [
        {
          status: 'success',
          timestamp: '2026-01-01T00:00:00Z',
          domain: 'www.example.test',
          policy: 'policy one',
          removeAt: '2026-02-01T00:00:00Z',
        },
      ],
      pageIndex: 2,
      pageSize: 10,
      count: 1,
      hasMore: false,
    });
    const result = await client.callTool({
      name: 'list_dcv_events',
      arguments: {
        policy: 'policy one',
        domain: 'www.example.test',
        sorted_by: 'timestamp:Desc',
        page_index: 2,
        page_size: 10,
        with_count: true,
      },
    });

    expect(mc.post).toHaveBeenCalledWith(
      '/api/v1/dcv/lifecycle/events/policy%20one/www.example.test',
      {
        sortedBy: 'timestamp:Desc',
        pageIndex: 2,
        pageSize: 10,
        withCount: true,
      },
    );
    expect(parseResult(result)).toMatchObject({
      results: [{ removeAt: '2026-02-01T00:00:00Z' }],
    });
  });
});
