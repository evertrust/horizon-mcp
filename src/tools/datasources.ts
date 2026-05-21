/**
 * External datasource management tools for Horizon MCP Server (barrel module).
 *
 * 8 tools covering the full datasource lifecycle:
 *   - list_datasources: list all datasources with optional type/name filtering
 *   - get_datasource: fetch a single datasource by name
 *   - create_dns_datasource: create a DNS-type datasource
 *   - create_ldap_datasource: create an LDAP-type datasource
 *   - create_rest_datasource: create a REST-type datasource
 *   - update_datasource: GET-strip-merge-PUT update
 *   - delete_datasource: delete with safety echo
 *   - test_datasource: test a datasource against a context dictionary
 *
 * Implementation is split per concern under ./datasources/.
 *
 * Knowledge resources:
 *   - horizon://knowledge/datasources
 *   - horizon://knowledge/validation-rules
 *   - horizon://knowledge/dictionary-entries
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { HorizonClient } from '../client/http.js';
import { registerCreateDatasourceTools } from './datasources/create.js';
import { registerMutateDatasourceTools } from './datasources/mutate.js';
import { registerReadDatasourceTools } from './datasources/read.js';
import { registerTestDatasourceTool } from './datasources/test.js';

export function registerDatasourceTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadDatasourceTools(server, client);
  registerCreateDatasourceTools(server, client);
  registerMutateDatasourceTools(server, client);
  registerTestDatasourceTool(server, client);
}
