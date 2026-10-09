/** ACME management tools registrar (Horizon 2.11+). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { HorizonClient } from '../../client/http.js';
import { registerAcmeAccountTools } from './accounts.js';
import { registerAcmeEabTools } from './eab.js';
import { registerAcmeOrderTools } from './orders.js';

export function registerAcmeTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerAcmeAccountTools(server, client);
  registerAcmeOrderTools(server, client);
  registerAcmeEabTools(server, client);
}
