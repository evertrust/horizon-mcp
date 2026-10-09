import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

import { HorizonError } from '../../src/client/errors.js';
import { registerChallengeTools } from '../../src/tools/lifecycle/challenge.js';

function createMockClient() {
  return {
    post: vi.fn().mockResolvedValue({}),
    exportTimeout: 120000,
  };
}

async function setup() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mockClient = createMockClient();
  registerChallengeTools(server, mockClient as never);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, mockClient };
}

describe('submit_webra_challenge', () => {
  it('returns certificate and PKCS#12 exactly as received', async () => {
    const { client, mockClient } = await setup();
    mockClient.post.mockResolvedValueOnce({
      certificate: 'pem',
      pkcs12: 'base64',
    });

    const result = await client.callTool({
      name: 'submit_webra_challenge',
      arguments: {
        profile: 'example-profile',
        challenge: 'one-time',
        template: { keyType: 'rsa-2048' },
      },
    });

    expect(mockClient.post).toHaveBeenCalledWith('/api/v1/challenge/submit', {
      profile: 'example-profile',
      challenge: 'one-time',
      template: { keyType: 'rsa-2048' },
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      certificate: 'pem',
      pkcs12: 'base64',
    });
  });

  it('removes an echoed challenge from an error', async () => {
    const { client, mockClient } = await setup();
    mockClient.post.mockRejectedValueOnce(
      new HorizonError(400, {
        errorCode: 'WEBRA-ENROLL-015',
        message: 'Invalid secret-value',
        detail: 'secret-value was consumed',
      }),
    );

    const result = await client.callTool({
      name: 'submit_webra_challenge',
      arguments: {
        profile: 'example-profile',
        challenge: 'secret-value',
        template: { csr: 'csr' },
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});
