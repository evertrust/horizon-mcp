import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getAllResources } from './catalog.js';

export function registerAllResources(server: McpServer): void {
  for (const resource of getAllResources()) {
    server.registerResource(
      resource.name,
      resource.uri,
      { description: resource.description },
      async (uri) => ({
        contents: [{ uri: uri.href, text: resource.content }],
      }),
    );
  }
}
