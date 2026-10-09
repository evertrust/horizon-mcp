import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { expect, it, vi } from 'vitest';

import { registerDiscoveryTools } from '../../src/tools/discovery.js';

it.each([
  { providers: [{ type: 'OpenId', name: 'example-idp' }], accepted: true },
  { providers: null, accepted: true },
  { providers: ['example-idp'], accepted: false },
  { providers: [{ type: 'OpenId' }], accepted: false },
  { providers: [{ name: 'example-idp' }], accepted: false },
  { providers: [{ type: 'Unknown', name: 'example-idp' }], accepted: false },
])(
  'validates enforced identity providers: $accepted',
  async ({ providers, accepted }) => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const post = vi.fn().mockResolvedValue({});
    registerDiscoveryTools(server, { post } as unknown as Parameters<
      typeof registerDiscoveryTools
    >[1]);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(ct), server.connect(st)]);
    try {
      const authorizationLevels = {
        search: {
          accessLevel: 'authenticated',
          enforcedIdentityProviders: providers,
        },
        feed: { accessLevel: 'authorized' },
      };
      const result = await client.callTool({
        name: 'create_discovery_campaign',
        arguments: {
          name: 'example-campaign',
          authorization_levels: authorizationLevels,
        },
      });
      expect(result.isError === true).toBe(!accepted);
      if (accepted) {
        expect(post).toHaveBeenCalledWith(
          '/api/v1/discovery/campaigns',
          expect.objectContaining({ authorizationLevels }),
        );
      } else {
        expect(post).not.toHaveBeenCalled();
      }
    } finally {
      await client.close();
      await server.close();
    }
  },
);
