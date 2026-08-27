/**
 * SDK-dispatch regression tests.
 *
 * Unit tests elsewhere invoke tool handlers directly, bypassing the MCP
 * SDK's `registerTool` path. This suite drives a representative tool through
 * the real McpServer + InMemoryTransport client so that whatever config keys
 * `registerTool` forwards to the SDK are actually accepted. It locks in that
 * the handler executes and the call does not fail with the SDK's
 * `taskSupport` registration error (the SDK hardcodes
 * `execution.taskSupport: 'forbidden'` and drops any injected `execution`).
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import type { HorizonClient } from '../../src/client/http.js';
import { registerCertificateTools } from '../../src/tools/lifecycle/certificates.js';

function createMockClient(): HorizonClient {
  return {
    async postText(): Promise<string> {
      return 'dn,serial\nCN=a,01\n';
    },
  } as unknown as HorizonClient;
}

async function createCertToolClient(): Promise<Client> {
  const server = new McpServer({ name: 'dispatch-test', version: '0.0.0' });
  registerCertificateTools(server, createMockClient());

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: 'dispatch-test-client',
    version: '0.0.0',
  });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

describe('SDK tool dispatch', () => {
  it('executes export_certificates_csv through the real SDK without a taskSupport error', async () => {
    const client = await createCertToolClient();

    const result = await client.callTool({
      name: 'export_certificates_csv',
      arguments: { query: 'dn contains "example"' },
    });

    const text = (
      result.content as Array<{ type: string; text?: string }>
    ).find((item) => item.type === 'text')?.text;

    expect(result.isError).toBeFalsy();
    expect(text).toBeDefined();
    expect(text).not.toContain('taskSupport');

    const payload = JSON.parse(text!) as Record<string, unknown>;
    expect(payload['csv']).toBe('dn,serial\nCN=a,01\n');

    await client.close();
  });
});
