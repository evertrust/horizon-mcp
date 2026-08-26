import { Client } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import {
  fakeResponse,
  makeClient,
  startApiKeyServer,
} from './support/http-server-fixture.js';
import { mockFetch } from './support/mcp-harness.js';

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

async function connectTools(): Promise<{
  client: Client;
  close(): Promise<void>;
}> {
  const server = await startApiKeyServer();
  const { client, transport } = makeClient(server.base, 'alice', 'key');
  await client.connect(transport);
  // Real hosts list tools before calling them, which arms the SDK client's
  // structuredContent validation against each tool's output schema.
  await client.listTools();
  return {
    client,
    async close() {
      await client.close();
      await server.handle.close();
    },
  };
}

function whoamiResult(result: unknown): Record<string, unknown> {
  const structured = (result as ToolResult).structuredContent;
  expect((result as ToolResult).isError).not.toBe(true);
  expect(structured).toBeDefined();
  return structured ?? {};
}

describe('tool output schemas', () => {
  it('accepts the API-key principal shape after listing tools', async () => {
    const principal = {
      identity: {
        identifier: 'alice',
        identityProviderType: 'API_KEY',
        name: 'Alice',
      },
      permissions: [{ value: 'certificate:read', filter: 'team=platform' }],
      roles: ['operator'],
      teams: ['platform'],
    };
    mockFetch.mockImplementation(() =>
      Promise.resolve(fakeResponse(200, principal)),
    );
    const tools = await connectTools();

    try {
      const result = whoamiResult(
        await tools.client.callTool({ name: 'whoami' }),
      );
      expect(
        (result['identity'] as Record<string, unknown>)['identifier'],
      ).toBe('alice');
    } finally {
      await tools.close();
    }
  });

  it('accepts the service-account principal shape after listing tools', async () => {
    const principal = {
      identity: {
        identifier: 'automation-3e46f2c08b6f90d1',
        identityProviderType: 'JWKS',
      },
      permissions: [{ value: 'certificate:read' }],
    };
    mockFetch.mockImplementation(() =>
      Promise.resolve(fakeResponse(200, principal)),
    );
    const tools = await connectTools();

    try {
      const result = whoamiResult(
        await tools.client.callTool({ name: 'whoami' }),
      );
      expect(
        (result['identity'] as Record<string, unknown>)['identifier'],
      ).toBe('automation-3e46f2c08b6f90d1');
    } finally {
      await tools.close();
    }
  });

  it('accepts future Horizon keys in the principal and identity DTOs', async () => {
    const principal = {
      identity: {
        identifier: 'alice',
        identityProviderType: 'API_KEY',
        futureKey: 1,
      },
      permissions: [{ value: 'certificate:read' }],
      futureKey: 1,
    };
    mockFetch.mockImplementation(() =>
      Promise.resolve(fakeResponse(200, principal)),
    );
    const tools = await connectTools();

    try {
      const result = whoamiResult(
        await tools.client.callTool({ name: 'whoami' }),
      );
      expect(result['futureKey']).toBe(1);
      expect((result['identity'] as Record<string, unknown>)['futureKey']).toBe(
        1,
      );
    } finally {
      await tools.close();
    }
  });

  it('accepts the events CSV search-fallback source after listing tools', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(fakeResponse(200, { results: [], hasMore: false })),
    );
    const tools = await connectTools();

    try {
      const result = (await tools.client.callTool({
        name: 'export_events_csv',
        arguments: { query: 'code equals "SEC-AUTHENTICATION"' },
      })) as ToolResult;
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent?.['source']).toBe('search_fallback');
    } finally {
      await tools.close();
    }
  });
});
