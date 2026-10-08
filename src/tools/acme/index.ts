/**
 * ACME management tools registrar (Horizon 2.11+): accounts, orders, and
 * External Account Bindings. EAB policies are config CRUD and live in
 * `src/tools/config/eab-policies.ts`.
 */
import type { McpServer } from '@modelcontextprotocol/server';

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
