import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import pkg from '../package.json';
import type { HorizonClient } from './client/http.js';
import { registerAllResources } from './resources/index.js';
import { registerComputationTools } from './tools/assist/computation.js';
import { registerCryptoTools } from './tools/assist/crypto.js';
import { registerQueryTools } from './tools/assist/query.js';
import { registerSystemTools } from './tools/assist/system.js';
import { registerTranslateTools } from './tools/assist/translate.js';
import { registerConfigTools } from './tools/config/index.js';
import { registerDashboardTools } from './tools/dashboards.js';
import { registerDatasourceTools } from './tools/datasources.js';
import { registerDiscoveryEventTools } from './tools/discovery-events.js';
import { registerDiscoveryFeedTools } from './tools/discovery-feed.js';
import { registerDiscoveryTools } from './tools/discovery.js';
import { registerDocsTools } from './tools/docs.js';
import { registerLifecycleTools } from './tools/lifecycle.js';
import { registerProfileTools } from './tools/profiles.js';
import { registerReportTools } from './tools/reports.js';
import { registerTriggerTools } from './tools/triggers.js';

export const SERVER_INSTRUCTIONS = [
  'MCP server for Evertrust Horizon CLM (certificate lifecycle, RBAC,',
  'discovery, configuration).',
  '',
  'Core rules:',
  '- Object names are immutable. Ask the user for `name` (and `display_name`',
  '  where supported) before any create_* call.',
  '- HQL field names are lowercase (contactemail, keytype, valid.until,',
  '  registration.date). camelCase causes HQL-001. groupBy/sortedBy are',
  '  camelCase (API context).',
  '- Ownership queries: call `whoami` first; then',
  '  `owner equals "<id>" or team in (...)`.',
  '- Lifecycle: call `get_request_template` before `submit_request`.',
  '  `revocationReason` is mandatory for revoke.',
  '- PKCS#12 lives on the enrollment request response only, never on the',
  '  certificate object.',
  '',
  'Where to look:',
  '- Full rules + workflows: horizon://knowledge/server-rules',
  '- Query syntax (HCQL/HRQL/HEQL/HDQL): horizon://knowledge/query-languages',
  '- Picking the right tool: horizon://knowledge/tool-selection',
].join('\n');

/**
 * Build a fully-wired McpServer bound to a single HorizonClient: knowledge
 * resources plus every tool domain. Transport-agnostic - stdio builds one at
 * startup, HTTP builds one per session so each session's tools close over that
 * session's client (no shared client state across sessions).
 */
export function createSessionServer(client: HorizonClient): McpServer {
  const server = new McpServer(
    { name: 'Horizon MCP Server', version: pkg.version },
    {
      instructions: SERVER_INSTRUCTIONS,
      capabilities: {
        tools: {},
        resources: {},
        logging: {},
      },
    },
  );

  // Knowledge resources first (mirrors prior startup order).
  registerAllResources(server);

  // Tools by domain.
  registerProfileTools(server, client);
  registerLifecycleTools(server, client);
  registerDashboardTools(server, client);
  registerDiscoveryTools(server, client);
  registerDiscoveryEventTools(server, client);
  registerDiscoveryFeedTools(server, client);
  registerDatasourceTools(server, client);
  registerReportTools(server, client);
  registerTriggerTools(server, client);
  registerDocsTools(server, client);
  registerSystemTools(server, client);
  registerQueryTools(server, client);
  registerCryptoTools(server, client);
  registerComputationTools(server, client);
  registerTranslateTools(server, client);
  registerConfigTools(server, client);

  return server;
}
