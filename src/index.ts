#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import pkg from '../package.json';
import { createAuthProvider } from './auth/index.js';
import { HorizonClient } from './client/http.js';
import { configureLogging, getLogger, setMcpLoggingSink } from './logging.js';
import { registerAllResources } from './resources/index.js';
import { loadSettings } from './settings.js';
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

const logger = getLogger('horizon_mcp.server');

const SERVER_INSTRUCTIONS = [
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

async function main(): Promise<void> {
  const settings = loadSettings();
  configureLogging(settings.logLevel);

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

  const auth = createAuthProvider(settings);
  const client = new HorizonClient(settings.url, auth, {
    timeout: settings.timeout,
    exportTimeout: settings.exportTimeout,
    verifySsl: settings.verifySsl,
    testedVersions: settings.testedVersions,
    warnVersions: settings.warnVersions,
  });

  // Register all resources
  registerAllResources(server);

  // Register all tools by domain
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

  logger.info(
    'Horizon MCP server ready - auth will trigger on first tool call.',
  );

  // Shutdown lifecycle
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      let exitCode = 0;
      try {
        await client.close();
        await auth.cleanup();
      } catch (err) {
        logger.error(`Error during shutdown: ${err}`);
        exitCode = 1;
      } finally {
        logger.info('Horizon MCP server shut down.');
        process.exit(exitCode);
      }
    });
  }

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Forward server logs through `notifications/message` now that the transport
  // is connected. Best-effort: any failure (client opted out, transport
  // closing) stays local and must never crash the server.
  setMcpLoggingSink((level, payload) => {
    void Promise.resolve()
      .then(() =>
        server.server.sendLoggingMessage({
          level: level as
            | 'debug'
            | 'info'
            | 'notice'
            | 'warning'
            | 'error'
            | 'critical'
            | 'alert'
            | 'emergency',
          logger: payload.logger,
          data: { msg: payload.msg, ...(payload.extra ?? {}) },
        }),
      )
      .catch(() => {
        // transport not ready or closing -- keep the log local only
      });
  });
}

main().catch((err) => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});
