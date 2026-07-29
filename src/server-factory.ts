import { McpServer } from '@modelcontextprotocol/server';

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
import { configureToolRegistration } from './tools/register.js';
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
  "  `revocationReason` is strongly recommended for revoke; ask the user (Horizon defaults to 'unspecified').",
  '- PKCS#12 lives on the enrollment or recover request response, never on the',
  '  certificate object.',
  '',
  'Where to look:',
  '- Full rules + workflows: horizon://knowledge/server-rules',
  '- Query syntax (HCQL/HRQL/HEQL/HDQL): horizon://knowledge/query-languages',
  '- Picking the right tool: horizon://knowledge/tool-selection',
].join('\n');

type ToolsetRegistrar = (server: McpServer, client: HorizonClient) => void;

/**
 * Registry of tool domains keyed by a stable toolset name. `HORIZON_ENABLED_TOOLSETS`
 * selects a subset of these; the object insertion order is also the registration
 * order. Grouping mirrors the `src/tools/` file layout:
 *
 *  - `lifecycle`    certificate/request/event lifecycle tools
 *  - `profiles`     profile listing/inspection
 *  - `dashboards`   dashboards and saved queries
 *  - `discovery`    discovery campaigns, events, and feed sessions
 *  - `datasources`  datasource CRUD and simulation
 *  - `reports`      report generation
 *  - `triggers`     trigger/automation tools
 *  - `docs`         product/API doc search, fetch, and read_knowledge
 *  - `assist`       whoami/license/HQL/crypto/computation/translate helpers
 *  - `config`       Horizon configuration-object CRUD (CAs, roles, teams, ...)
 */
const TOOLSET_REGISTRY: Record<string, ToolsetRegistrar> = {
  lifecycle: registerLifecycleTools,
  profiles: registerProfileTools,
  dashboards: registerDashboardTools,
  discovery: (server, client) => {
    registerDiscoveryTools(server, client);
    registerDiscoveryEventTools(server, client);
    registerDiscoveryFeedTools(server, client);
  },
  datasources: registerDatasourceTools,
  reports: registerReportTools,
  triggers: registerTriggerTools,
  docs: registerDocsTools,
  assist: (server, client) => {
    registerSystemTools(server, client);
    registerQueryTools(server, client);
    registerCryptoTools(server, client);
    registerComputationTools(server, client);
    registerTranslateTools(server, client);
  },
  config: registerConfigTools,
};

/** All registered toolset names, in registration order. */
export const TOOLSET_NAMES = Object.keys(TOOLSET_REGISTRY);

export interface SessionServerOptions {
  /**
   * Toolset names to register (see `TOOLSET_REGISTRY`). Undefined registers
   * every toolset. Unknown names throw at startup with the valid list.
   */
  readonly enabledToolsets?: readonly string[];
  /** When true, only read-only tools are registered (mutating tools skipped). */
  readonly readOnly?: boolean;
}

/**
 * Throw with the valid list if any requested toolset name is unknown. Called at
 * startup so a misconfigured `HORIZON_ENABLED_TOOLSETS` refuses to start (in HTTP
 * mode session servers are built per request, so per-session validation would be
 * too late).
 */
export function assertToolsetsValid(enabled?: readonly string[]): void {
  if (enabled === undefined) return;

  const unknown = enabled.filter((name) => !(name in TOOLSET_REGISTRY));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown toolset(s) in HORIZON_ENABLED_TOOLSETS: ${unknown.join(', ')}. ` +
        `Valid toolsets: ${TOOLSET_NAMES.join(', ')}.`,
    );
  }
}

function resolveToolsets(enabled?: readonly string[]): string[] {
  assertToolsetsValid(enabled);
  if (enabled === undefined) return TOOLSET_NAMES;

  // Register in registry order regardless of the order supplied.
  const requested = new Set(enabled);
  return TOOLSET_NAMES.filter((name) => requested.has(name));
}

/**
 * Build a fully-wired McpServer bound to a single HorizonClient: knowledge
 * resources plus the selected tool domains. Transport-agnostic - stdio builds
 * one at startup, HTTP builds one per session so each session's tools close over
 * that session's client (no shared client state across sessions).
 */
export function createSessionServer(
  client: HorizonClient,
  options: SessionServerOptions = {},
): McpServer {
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

  // Wire read-only gating before any tool is registered.
  configureToolRegistration(server, { readOnly: options.readOnly ?? false });

  // Knowledge resources first (mirrors prior startup order).
  registerAllResources(server);

  // Tools by domain, filtered by the selected toolsets.
  for (const name of resolveToolsets(options.enabledToolsets)) {
    TOOLSET_REGISTRY[name]!(server, client);
  }

  return server;
}
