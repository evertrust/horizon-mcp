#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createAuthProvider } from './auth/index.js';
import { HorizonClient } from './client/http.js';
import { configureLogging, getLogger } from './logging.js';
import { registerAllResources } from './resources/index.js';
import { loadSettings } from './settings.js';
import { registerComputationTools } from './tools/assist/computation.js';
import { registerCryptoTools } from './tools/assist/crypto.js';
import { registerQueryTools } from './tools/assist/query.js';
import { registerSystemTools } from './tools/assist/system.js';
import { registerTranslateTools } from './tools/assist/translate.js';
import { registerDashboardTools } from './tools/dashboards.js';
import { registerDatasourceTools } from './tools/datasources.js';
import { registerDiscoveryEventTools } from './tools/discovery-events.js';
import { registerDiscoveryFeedTools } from './tools/discovery-feed.js';
import { registerDiscoveryTools } from './tools/discovery.js';
import { registerLifecycleTools } from './tools/lifecycle.js';
import { registerProfileTools } from './tools/profiles.js';
import { registerReportTools } from './tools/reports.js';
import { registerTriggerTools } from './tools/triggers.js';

const logger = getLogger('horizon_mcp.server');

const SERVER_INSTRUCTIONS =
  'Production MCP server for Evertrust Horizon CLM - ' +
  'certificate lifecycle management, configuration, RBAC, and discovery.\n\n' +
  'CRITICAL RULES:\n' +
  '1. IMMUTABLE NAMES: All object names in Horizon are primary keys and ' +
  'CANNOT be changed after creation. This applies to every object: profiles, ' +
  'connectors, dashboards, roles, teams, CAs, triggers, labels, etc. ' +
  'You MUST ask the user for the name before creating any object - never ' +
  'invent or guess names. When the tool also accepts a display_name ' +
  'parameter, always ask for that too - it is the human-friendly label ' +
  'shown in the UI and can be changed later.\n' +
  "2. OWNERSHIP QUERIES: When searching for 'my certificates', call whoami " +
  "first to get the user's identifier AND team list, then query both: " +
  'owner equals "<id>" or team in ("<team1>", "<team2>", ...). ' +
  'Direct owner alone misses team-owned certificates.\n' +
  '3. SERVICE DISCOVERY: When searching for certificates by service (tomcat, ' +
  'nginx, apache, etc.), search discoverydata.paths, discoverydata.usages, ' +
  'and discoverydata.hostnames in addition to dn and san. ' +
  'See horizon://knowledge/query-languages for patterns.\n' +
  '4. HQL FIELD NAMES: ALL query field names (HCQL, HRQL, HEQL, HDQL) are ' +
  'LOWERCASE - never camelCase. Common mistakes: contactEmail->contactemail, ' +
  'keyType->keytype, notAfter->valid.until, registrationDate->registration.date, ' +
  'certificateId->certificateid. Using camelCase causes HQL-001 parse errors. ' +
  'Note: groupBy and sortedBy fields ARE camelCase (API context, not query context).\n' +
  '5. CERTIFICATE EXPOSURE CHECK: When the user asks to check if a certificate ' +
  'is exposed, deployed, live, or reachable on a server, use the ' +
  'fetch_exposed_certificate tool to connect to the target host and retrieve ' +
  'the actual TLS certificate. Then compare its thumbprint or serial with ' +
  'what Horizon manages. This is the only way to verify real-world deployment.\n' +
  '6. PKCS#12 / PFX RETRIEVAL: The PKCS#12 bundle (certificate + private key) ' +
  'is NEVER on the certificate object. It is only available in the enrollment ' +
  'REQUEST response. When the user asks for a PKCS#12, PFX, or private key: ' +
  '(1) find the enrollment request via search_requests, ' +
  '(2) use get_request to retrieve it - the pkcs12/keyStore field contains ' +
  "the base64-encoded PKCS#12. Do NOT say it's impossible - it IS available " +
  'through the request.\n' +
  '7. CERTIFICATE PARSING TOOLS AVAILABLE: This server provides built-in ' +
  'tools for parsing cryptographic objects. Before reaching for openssl or ' +
  'local CLI tools, consider using these - they return structured JSON with ' +
  'all fields parsed, which is easier to work with programmatically:\n' +
  '  - decode_x509: parse X.509 certificates (PEM or DER)\n' +
  '  - decode_csr: parse PKCS#10 certificate signing requests\n' +
  '  - decode_crl: parse certificate revocation lists\n' +
  '  - decode_ocsp: parse OCSP responses (RFC 6960)\n' +
  '  - decode_tsa: parse timestamping responses (RFC 3161)\n' +
  '  - detect_file: auto-detect format and parse any of the above\n' +
  '  - fetch_exposed_certificate: fetch a live TLS cert from a remote server\n' +
  'These return structured JSON (DN, SANs, extensions, key usage, AIA, CRL ' +
  'DPs, thumbprints, etc.) rather than text output that needs further parsing.\n' +
  '8. LIFECYCLE REQUESTS - ASK BEFORE SUBMITTING: Before calling ' +
  'submit_request, you MUST call get_request_template first to discover ' +
  'which fields are required and editable. Then ask the user for all ' +
  'missing information. For revoke workflows, the revocationReason is ' +
  'MANDATORY - always ask the user. For all workflows, optionally offer ' +
  'the user to add a requesterComment (free-text justification).\n' +
  '9. DISCOVERY WORKFLOWS: When the user asks about performing certificate ' +
  'discovery (network scans, local scans, importing from cloud services, ' +
  'PKI migrations, etc.), consult horizon://knowledge/discovery-workflows ' +
  'for CLI commands and parameters. Consult horizon://knowledge/discovery ' +
  'for concepts, data structures, and search patterns. Both resources are ' +
  'needed for a complete answer.\n' +
  '10. DATASOURCE AND VALIDATION RULES: When the user asks about auto-validation, ' +
  'datasource configuration, or enriching enrollment requests with external data, ' +
  'consult horizon://knowledge/datasources for DNS/LDAP/REST datasource setup, ' +
  'horizon://knowledge/validation-rules for validation rule condition syntax ' +
  '(operators, boolean logic, datasource references, resolvesDNS, CIDR matching), ' +
  'and horizon://knowledge/dictionary-entries for all available dictionary entries ' +
  'by context and protocol module.\n' +
  '11. REST NOTIFICATIONS AND CUSTOM CONNECTORS: When the user asks about building ' +
  'custom connectors, deploying certificates to external systems via REST APIs, ' +
  'creating REST notifications, chaining multiple API calls, or automating ' +
  'certificate deployment to load balancers, CDNs, IoT platforms, or any REST ' +
  'service, consult horizon://knowledge/rest-notifications for the full REST ' +
  'notification API schema, multi-step sequence chaining patterns, authentication ' +
  'types, template string dictionary, and real-world examples. Also consult ' +
  'horizon://knowledge/automation for trigger attachment to profiles.';

async function main(): Promise<void> {
  const settings = loadSettings();
  configureLogging(settings.logLevel);

  const server = new McpServer(
    { name: 'Horizon MCP Server', version: '2.0.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const auth = createAuthProvider(settings);
  const client = new HorizonClient(settings.url, auth, {
    timeout: settings.timeout,
    exportTimeout: settings.exportTimeout,
    verifySsl: settings.verifySsl,
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
  registerSystemTools(server, client);
  registerQueryTools(server, client);
  registerCryptoTools(server, client);
  registerComputationTools(server, client);
  registerTranslateTools(server, client);

  logger.info(
    'Horizon MCP server ready - auth will trigger on first tool call.',
  );

  // Shutdown lifecycle
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      await client.close();
      await auth.cleanup();
      logger.info('Horizon MCP server shut down.');
      process.exit(0);
    });
  }

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
