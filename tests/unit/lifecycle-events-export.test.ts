import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

import { ApiKeyAuthProvider } from '../../src/auth/apikey.js';
import { HorizonClient } from '../../src/client/http.js';
import { registerLifecycleTools } from '../../src/tools/lifecycle.js';

type MockLifecycleClient = {
  readonly exportTimeout: number;
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  postText: ReturnType<typeof vi.fn>;
};

async function createLifecycleClient(
  mockClient: MockLifecycleClient,
): Promise<Client> {
  const server = new McpServer({ name: 'lifecycle-test', version: '0.0.0' });
  registerLifecycleTools(
    server,
    mockClient as unknown as Parameters<typeof registerLifecycleTools>[1],
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: 'lifecycle-test-client',
    version: '0.0.0',
  });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

async function callJsonTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>).find(
    (item) => item.type === 'text',
  )?.text;
  if (!text) {
    throw new Error(`Tool ${name} returned no text payload`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe('export_events_csv', () => {
  it('builds a compact CSV from paged search results', async () => {
    const mockClient: MockLifecycleClient = {
      exportTimeout: 120,
      get: vi.fn(),
      postText: vi.fn(),
      post: vi
        .fn()
        .mockResolvedValueOnce({
          results: [
            {
              _id: 'evt-1',
              code: 'SEC-AUTHENTICATION',
              module: 'security',
              node: 'node-1',
              timestamp: '2026-04-14T12:00:00.000Z',
              status: 'success',
              details: [
                { key: 'actorId', value: 'alice@example.com' },
                { key: 'ip', value: '10.0.0.4' },
              ],
            },
          ],
          count: 2,
          hasMore: true,
        })
        .mockResolvedValueOnce({
          results: [
            {
              _id: 'evt-2',
              code: 'REQUEST-APPROVE',
              module: 'request',
              node: 'node-1',
              timestamp: '2026-04-14T11:58:00.000Z',
              status: 'failure',
              details: [{ key: 'message', value: 'Denied by policy' }],
            },
          ],
          hasMore: false,
        }),
    };

    const client = await createLifecycleClient(mockClient);
    const result = await callJsonTool(client, 'export_events_csv', {
      query: 'code matches ".*"',
    });

    expect(result['source']).toBe('search_fallback');
    expect(result['returned_rows']).toBe(2);
    expect(result['truncated']).toBe(false);

    const csv = result['csv'] as string;
    expect(csv).toContain(
      '_id;code;module;node;timestamp;status;detail.actorId;detail.ip;detail.message',
    );
    expect(csv).toContain('evt-1;SEC-AUTHENTICATION;security;node-1');
    expect(csv).toContain('alice@example.com');
    expect(csv).toContain('Denied by policy');

    expect(mockClient.post).toHaveBeenCalledTimes(2);
    expect(mockClient.post.mock.calls[0]?.[0]).toBe('/api/v1/events/search');
    expect(mockClient.post.mock.calls[0]?.[1]).toMatchObject({
      pageIndex: 1,
      pageSize: 100,
      withCount: true,
    });
    expect(mockClient.post.mock.calls[1]?.[1]).toMatchObject({
      pageIndex: 2,
      pageSize: 100,
    });
  });

  it('respects explicit field selection and preserves order', async () => {
    const mockClient: MockLifecycleClient = {
      exportTimeout: 120,
      get: vi.fn(),
      postText: vi.fn(),
      post: vi.fn().mockResolvedValue({
        results: [
          {
            _id: 'evt-1',
            code: 'SEC-AUTHENTICATION',
            details: [{ key: 'actorId', value: 'alice@example.com' }],
            status: 'success',
            timestamp: '2026-04-14T12:00:00.000Z',
          },
        ],
        count: 1,
        hasMore: false,
      }),
    };

    const client = await createLifecycleClient(mockClient);
    const result = await callJsonTool(client, 'export_events_csv', {
      query: 'code matches ".*"',
      fields: ['timestamp', 'detail.actorId', 'code'],
    });

    const lines = (result['csv'] as string).split('\n');
    expect(lines[0]).toBe('timestamp;detail.actorId;code');
    expect(lines[1]).toBe(
      '2026-04-14T12:00:00.000Z;alice@example.com;SEC-AUTHENTICATION',
    );
  });

  it('uses the HorizonClient export timeout as the CSV request budget', async () => {
    const horizonClient = new HorizonClient(
      'https://horizon.test',
      new ApiKeyAuthProvider('id', 'key'),
      { timeout: 5, exportTimeout: 7, verifySsl: true },
    );
    const post = vi.spyOn(horizonClient, 'post').mockResolvedValue({
      results: [],
      count: 0,
      hasMore: false,
    });
    const client = await createLifecycleClient(
      horizonClient as unknown as MockLifecycleClient,
    );
    try {
      await callJsonTool(client, 'export_events_csv', {
        query: 'code matches ".*"',
      });

      expect(horizonClient.exportTimeout).toBe(7);
      expect(post).toHaveBeenCalledWith(
        '/api/v1/events/search',
        expect.any(Object),
        { timeout: 7 },
      );
    } finally {
      await client.close();
      await horizonClient.close();
    }
  });
});
