/**
 * Golden tests: verify tool count, tool name enumeration, resource count,
 * resource URI enumeration, knowledge resource integrity, tool description
 * cross-references, knowledge field alignment, schema stability, and
 * safety-tier enforcement.
 *
 * Ported from Python test_golden.py, test_safety.py, and test_phase_split.py.
 * Uses MCP protocol (not private SDK internals).
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  CORE_RESOURCE_URIS,
  CURATED_RESOURCE_URIS,
} from '../../src/resources/catalog.js';
import { registerAllResources } from '../../src/resources/index.js';
import { registerComputationTools } from '../../src/tools/assist/computation.js';
import { registerCryptoTools } from '../../src/tools/assist/crypto.js';
import { registerQueryTools } from '../../src/tools/assist/query.js';
import { registerSystemTools } from '../../src/tools/assist/system.js';
import { registerTranslateTools } from '../../src/tools/assist/translate.js';
import { registerServiceAccountTools } from '../../src/tools/config/service-accounts.js';
import { registerDashboardTools } from '../../src/tools/dashboards.js';
import { registerDatasourceTools } from '../../src/tools/datasources.js';
import { registerDiscoveryEventTools } from '../../src/tools/discovery-events.js';
import { registerDiscoveryFeedTools } from '../../src/tools/discovery-feed.js';
import { registerDiscoveryTools } from '../../src/tools/discovery.js';
import { registerDocsTools } from '../../src/tools/docs.js';
import { registerLifecycleTools } from '../../src/tools/lifecycle.js';
import { registerProfileTools } from '../../src/tools/profiles.js';
import { registerReportTools } from '../../src/tools/reports.js';
import { registerTriggerTools } from '../../src/tools/triggers.js';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const KNOWLEDGE_DIR = resolve(__dirname, '../../src/resources/knowledge');

/** Minimal mock client that satisfies the HorizonClient interface. */
function createMockClient(): unknown {
  return {
    get: async () => ({}),
    post: async () => ({}),
    put: async () => ({}),
    patch: async () => ({}),
    delete: async () => null,
    getBytes: async () => new ArrayBuffer(0),
    getText: async () => '',
    postText: async () => '',
    postMultipart: async () => ({}),
    request: async () => new Response(),
    close: async () => {},
    fetchCsrfToken: async () => undefined,
    exportTimeout: 120,
    principalName: undefined,
    horizonVersion: undefined,
  };
}

/** Register all tool domains on a McpServer instance. */
function registerAllTools(server: McpServer, mockClient: unknown): void {
  const c = mockClient as Parameters<typeof registerProfileTools>[1];
  registerProfileTools(server, c);
  registerLifecycleTools(server, c);
  registerDashboardTools(server, c);
  registerDiscoveryTools(server, c);
  registerDiscoveryEventTools(server, c);
  registerDiscoveryFeedTools(server, c);
  registerDatasourceTools(server, c);
  registerReportTools(server, c);
  registerTriggerTools(server, c);
  registerDocsTools(server, c);
  registerSystemTools(server, c);
  registerQueryTools(server, c);
  registerCryptoTools(server, c);
  registerComputationTools(server, c);
  registerTranslateTools(server, c);
}

// ===================================================================
// 1. Full tool name enumeration (ported from test_golden.py)
// ===================================================================

const EXPECTED_TOOL_NAMES: string[] = [
  // assist/system.ts (4)
  'whoami',
  'get_license_info',
  'explain_grading_policy',
  'explain_grading_ruleset',
  // docs.ts (4)
  'search_docs',
  'search_api_docs',
  'get_doc_page',
  'read_knowledge',
  // assist/computation.ts (2)
  'simulate_computation_rule',
  'simulate_datasource_flow',
  // assist/crypto.ts (8 - includes convert_pkcs12_to_jks, TS-only)
  'decode_x509',
  'decode_csr',
  'decode_crl',
  'decode_ocsp',
  'decode_tsa',
  'detect_file',
  'fetch_exposed_certificate',
  'convert_pkcs12_to_jks',
  // assist/query.ts (6) - validate_hql + 4 backward-compat aliases
  'validate_hql',
  'validate_hcql',
  'validate_hrql',
  'validate_heql',
  'validate_hdql',
  'describe_query_fields',
  // assist/translate.ts (1)
  'translate_to_hql',
  // lifecycle.ts (24)
  'search_certificates',
  'export_certificates_csv',
  'get_certificate',
  'download_certificate',
  'get_request_template',
  'submit_request',
  'approve_request',
  'deny_request',
  'cancel_request',
  'search_requests',
  'get_request',
  'export_requests_csv',
  'search_events',
  'get_event',
  'export_events_csv',
  'aggregate_certificates',
  'set_certificate_auto_renew',
  'aggregate_requests',
  'list_dcv_policy_status',
  'get_dcv_policy_status',
  'run_dcv_policy',
  'run_dcv_domain',
  'cancel_dcv_run',
  'list_dcv_events',
  // profiles.ts (2)
  'list_profiles',
  'get_profile',
  // discovery.ts (6)
  'list_discovery_campaigns',
  'get_discovery_campaign',
  'create_discovery_campaign',
  'update_discovery_campaign',
  'delete_discovery_campaign',
  'flush_discovery_campaign',
  // discovery-events.ts (3)
  'search_discovery_events',
  'get_discovery_event',
  'export_discovery_events_csv',
  // discovery-feed.ts (4)
  'start_discovery_feed_session',
  'feed_discovery_certificate',
  'register_discovery_event',
  'end_discovery_feed_session',
  // dashboards.ts (12)
  'list_dashboards',
  'get_dashboard',
  'create_dashboard',
  'update_dashboard',
  'delete_dashboard',
  'add_dashboard_chart',
  'update_dashboard_chart',
  'remove_dashboard_chart',
  'list_saved_queries',
  'get_saved_query',
  'upsert_saved_query',
  'delete_saved_query',
  // reports.ts (3)
  'list_reports',
  'download_report',
  'delete_report',
  // datasources.ts (8)
  'list_datasources',
  'get_datasource',
  'create_dns_datasource',
  'create_ldap_datasource',
  'create_rest_datasource',
  'update_datasource',
  'delete_datasource',
  'test_datasource',
  // triggers.ts (6)
  'list_credentials',
  'list_triggers',
  'get_trigger',
  'create_rest_notification',
  'delete_trigger',
  'simulate_trigger',
].sort();

const REQUIRED_RESOURCE_URIS: string[] = [
  ...CORE_RESOURCE_URIS,
  ...CURATED_RESOURCE_URIS,
].sort();

const CRITICAL_SECTION_RESOURCE_URIS: string[] = [
  'horizon://knowledge/query-languages/ownership-patterns-hcql',
  'horizon://knowledge/query-languages/service-discovery-patterns-hcql',
  'horizon://knowledge/datasources/rest-datasource',
  'horizon://knowledge/datasources/testing-datasources',
  'horizon://knowledge/discovery-workflows/3-net-import-netimport',
  'horizon://knowledge/integrations/mdm-integrations-intune-jamf',
  'horizon://knowledge/validation-rules/complete-workflow-recipes',
  'horizon://knowledge/rest-notifications/real-world-examples',
].sort();

// Knowledge files that must exist and be non-empty (>50 lines)
const KNOWLEDGE_FILES: string[] = [
  'profiles.md',
  'computation_and_data_flow.md',
  'workflows.md',
  'query_languages.md',
  'rbac.md',
  'architecture.md',
  'dictionary_matrix.md',
  'discovery.md',
  'automation.md',
  'integrations.md',
  'dashboards.md',
  'system_admin.md',
  'discovery_workflows.md',
  'datasources.md',
  'dcv.md',
  'validation_rules.md',
  'rest_notifications.md',
];

const CURATED_KNOWLEDGE_FILES: string[] = [
  'tool_selection.md',
  'adcs_integration.md',
  'digicert_integration.md',
  'intune_integration.md',
];

// ===================================================================
// Tests
// ===================================================================

describe('Golden tests', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test', version: '0.0.0' });

    const mockClient = createMockClient();

    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  // -----------------------------------------------------------------
  // Tool count and enumeration
  // -----------------------------------------------------------------

  it('registers exactly 93 tools', async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBe(93);
  });

  it('tool name enumeration matches expected set exactly', async () => {
    const result = await client.listTools();
    const actual = result.tools.map((t) => t.name).sort();
    const added = actual.filter((n) => !EXPECTED_TOOL_NAMES.includes(n));
    const removed = EXPECTED_TOOL_NAMES.filter((n) => !actual.includes(n));
    expect(
      { added, removed },
      `Tool name drift.\n  Added: ${JSON.stringify(added)}\n  Removed: ${JSON.stringify(removed)}`,
    ).toEqual({ added: [], removed: [] });
  });

  // -----------------------------------------------------------------
  // Resource count and enumeration
  // -----------------------------------------------------------------

  it('registers all core resources, curated playbooks, and generated sections', async () => {
    const result = await client.listResources();
    expect(result.resources.length).toBeGreaterThan(
      REQUIRED_RESOURCE_URIS.length,
    );
  });

  it('registers all required core and curated resource URIs', async () => {
    const result = await client.listResources();
    const actual = new Set(result.resources.map((r) => r.uri));
    for (const uri of REQUIRED_RESOURCE_URIS) {
      expect(actual.has(uri), `Missing resource URI: ${uri}`).toBe(true);
    }
  });

  it('registers critical section resources for small-model retrieval', async () => {
    const result = await client.listResources();
    const actual = new Set(result.resources.map((r) => r.uri));
    for (const uri of CRITICAL_SECTION_RESOURCE_URIS) {
      expect(actual.has(uri), `Missing section resource URI: ${uri}`).toBe(
        true,
      );
    }
  });

  // -----------------------------------------------------------------
  // Basic integrity checks
  // -----------------------------------------------------------------

  it('all tools have non-empty descriptions, title, and annotations', async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(
        tool.description,
        `Tool ${tool.name} missing description`,
      ).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(10);
      expect(tool.title, `Tool ${tool.name} missing title`).toBeTruthy();
      expect(
        tool.annotations,
        `Tool ${tool.name} missing annotations`,
      ).toBeTruthy();
      expect(
        typeof tool.annotations!.readOnlyHint,
        `Tool ${tool.name} missing readOnlyHint`,
      ).toBe('boolean');
    }
  });

  it('submit_request is marked destructive (it can run revoke workflows)', async () => {
    const result = await client.listTools();
    const submit = result.tools.find((t) => t.name === 'submit_request');
    expect(submit, 'submit_request tool missing').toBeTruthy();
    expect(submit!.annotations?.destructiveHint).toBe(true);
    expect(submit!.annotations?.readOnlyHint).toBe(false);
  });

  it('tools with explicit guidance use the compact [when: ...] format', async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      if (tool.description?.includes('[when:')) {
        expect(
          tool.description,
          `Tool ${tool.name} guidance must be compact form`,
        ).toMatch(/\[when: [^|]+ \| not: [^|\]]+/);
      }
    }
  });

  it('all resources have horizon:// URIs', async () => {
    const result = await client.listResources();
    for (const resource of result.resources) {
      expect(resource.uri).toMatch(/^horizon:\/\/knowledge\//);
    }
  });

  it('tool names are unique', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('resource URIs are unique', async () => {
    const result = await client.listResources();
    const uris = result.resources.map((r) => r.uri);
    const uniqueUris = new Set(uris);
    expect(uniqueUris.size).toBe(uris.length);
  });

  it('all expected tool names are present', async () => {
    const result = await client.listTools();
    const names = new Set(result.tools.map((t) => t.name));

    // Spot-check critical tools across all domains
    const expectedTools = [
      // Profiles
      'list_profiles',
      'get_profile',
      // Lifecycle
      'search_certificates',
      'get_certificate',
      'download_certificate',
      'set_certificate_auto_renew',
      'submit_request',
      'approve_request',
      'deny_request',
      'cancel_request',
      'search_requests',
      'get_request',
      'aggregate_certificates',
      // Dashboards
      'list_dashboards',
      'create_dashboard',
      'add_dashboard_chart',
      'list_saved_queries',
      'upsert_saved_query',
      // Discovery
      'list_discovery_campaigns',
      'create_discovery_campaign',
      'search_discovery_events',
      'start_discovery_feed_session',
      // Datasources
      'list_datasources',
      'create_dns_datasource',
      'create_rest_datasource',
      // Reports
      'list_reports',
      'download_report',
      // Triggers
      'list_credentials',
      'list_triggers',
      'create_rest_notification',
      // Assist
      'whoami',
      'get_license_info',
      'search_docs',
      'search_api_docs',
      'get_doc_page',
      'validate_hcql',
      'describe_query_fields',
      'decode_x509',
      'fetch_exposed_certificate',
      'convert_pkcs12_to_jks',
      'simulate_computation_rule',
      'translate_to_hql',
    ];

    for (const name of expectedTools) {
      expect(names.has(name), `Missing tool: ${name}`).toBe(true);
    }
  });

  it('all required resource URIs are present', async () => {
    const result = await client.listResources();
    const uris = new Set(result.resources.map((r) => r.uri));

    for (const uri of REQUIRED_RESOURCE_URIS) {
      expect(uris.has(uri), `Missing resource: ${uri}`).toBe(true);
    }
  });

  it('tool schemas match snapshot', async () => {
    const result = await client.listTools();
    // Sort for deterministic snapshots
    const sorted = [...result.tools].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const schemas = sorted.map((t) => ({
      name: t.name,
      inputSchema: t.inputSchema,
    }));
    expect(schemas).toMatchSnapshot();
  });

  it('service-account mutation schemas match snapshot', async () => {
    const server = new McpServer({
      name: 'test-service-account-schemas',
      version: '0.0.0',
    });
    registerServiceAccountTools(server, createMockClient() as never);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const serviceClient = new Client({
      name: 'test-service-account-schemas-client',
      version: '0.0.0',
    });
    await Promise.all([serviceClient.connect(ct), server.connect(st)]);
    const tools = (await serviceClient.listTools()).tools
      .filter((tool) => tool.name.endsWith('_service_account'))
      .filter((tool) => !tool.name.startsWith('get_'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema }));

    expect(tools).toMatchSnapshot();
  });
});

// ===================================================================
// Knowledge resource accessibility (ported from test_golden.py)
// ===================================================================

describe('Knowledge resource accessibility', () => {
  it.each(KNOWLEDGE_FILES)(
    'knowledge file %s exists and has >50 lines',
    (filename) => {
      const filePath = join(KNOWLEDGE_DIR, filename);
      expect(
        existsSync(filePath),
        `Knowledge file not found: ${filePath}`,
      ).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      const lineCount = content.split('\n').length;
      expect(
        lineCount,
        `${filename} has only ${lineCount} lines (expected >50)`,
      ).toBeGreaterThan(50);
    },
  );

  it.each(CURATED_KNOWLEDGE_FILES)(
    'curated knowledge file %s exists and is non-empty',
    (filename) => {
      const filePath = join(KNOWLEDGE_DIR, filename);
      expect(
        existsSync(filePath),
        `Curated knowledge file not found: ${filePath}`,
      ).toBe(true);
      const content = readFileSync(filePath, 'utf-8').trim();
      expect(content.length, `${filename} must not be empty`).toBeGreaterThan(
        50,
      );
    },
  );
});

// ===================================================================
// Tool description -> knowledge URI cross-references
// (ported from test_golden.py TestToolDescriptionKnowledgeReferences)
// ===================================================================

describe('Tool description -> knowledge URI references', () => {
  let toolsByName: Map<string, { description?: string }>;

  beforeAll(async () => {
    const server = new McpServer({ name: 'test-xref', version: '0.0.0' });
    const mockClient = createMockClient();
    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'test-xref-client',
      version: '0.0.0',
    });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const result = await client.listTools();
    toolsByName = new Map(
      result.tools.map((t) => [t.name, { description: t.description }]),
    );
  });

  it('profile tools reference horizon://knowledge/profiles', () => {
    for (const name of ['list_profiles', 'get_profile']) {
      const desc = toolsByName.get(name)?.description ?? '';
      expect(desc, `${name} description`).toContain(
        'horizon://knowledge/profiles',
      );
    }
  });

  it('lifecycle search tools reference horizon://knowledge/query-languages', () => {
    for (const name of [
      'search_certificates',
      'search_requests',
      'search_events',
    ]) {
      const desc = toolsByName.get(name)?.description ?? '';
      expect(desc, `${name} description`).toContain(
        'horizon://knowledge/query-languages',
      );
    }
  });

  it('workflow tools reference horizon://knowledge/workflows', () => {
    for (const name of ['get_request_template', 'submit_request']) {
      const desc = toolsByName.get(name)?.description ?? '';
      expect(desc, `${name} description`).toContain(
        'horizon://knowledge/workflows',
      );
    }
  });

  it('computation tools reference horizon://knowledge/computation-and-data-flow', () => {
    const desc =
      toolsByName.get('simulate_computation_rule')?.description ?? '';
    expect(desc).toContain('horizon://knowledge/computation-and-data-flow');
  });

  it('trigger tools reference horizon://knowledge/rest-notifications', () => {
    for (const name of [
      'list_triggers',
      'get_trigger',
      'create_rest_notification',
      'delete_trigger',
      'simulate_trigger',
    ]) {
      const desc = toolsByName.get(name)?.description ?? '';
      expect(desc, `${name} description`).toContain(
        'horizon://knowledge/rest-notifications',
      );
    }
  });

  it('datasource tools reference horizon://knowledge/datasources', () => {
    for (const name of [
      'list_datasources',
      'get_datasource',
      'create_dns_datasource',
      'create_ldap_datasource',
      'create_rest_datasource',
      'update_datasource',
      'delete_datasource',
      'test_datasource',
    ]) {
      const desc = toolsByName.get(name)?.description ?? '';
      expect(desc, `${name} description`).toContain(
        'horizon://knowledge/datasources',
      );
    }
  });
});

// ===================================================================
// Knowledge field alignment
// (ported from test_golden.py TestKnowledgeFieldAlignment)
// ===================================================================

describe('Knowledge field alignment', () => {
  let toolsByName: Map<string, { inputSchema: Record<string, unknown> }>;

  beforeAll(async () => {
    const server = new McpServer({
      name: 'test-align',
      version: '0.0.0',
    });
    const mockClient = createMockClient();
    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'test-align-client',
      version: '0.0.0',
    });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const result = await client.listTools();
    toolsByName = new Map(
      result.tools.map((t) => [
        t.name,
        { inputSchema: t.inputSchema as Record<string, unknown> },
      ]),
    );
  });

  function getParamNames(toolName: string): Set<string> {
    const schema = toolsByName.get(toolName)?.inputSchema;
    if (!schema) return new Set();
    const props = (schema['properties'] as Record<string, unknown>) ?? {};
    return new Set(Object.keys(props));
  }

  it("workflows knowledge mentions workflow types and submit_request accepts 'workflow'", () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'workflows.md'),
      'utf-8',
    );
    for (const wf of [
      'enroll',
      'revoke',
      'update',
      'recover',
      'migrate',
      'renew',
    ]) {
      expect(
        knowledgeText,
        `Workflow '${wf}' not found in workflows.md`,
      ).toContain(wf);
    }
    expect(getParamNames('submit_request').has('workflow')).toBe(true);
  });

  it('rest-notifications knowledge mentions auth types and template keys', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'rest_notifications.md'),
      'utf-8',
    );
    for (const authType of ['noauth', 'basic', 'bearer', 'x509', 'custom']) {
      expect(
        knowledgeText,
        `Auth type '${authType}' not in rest_notifications.md`,
      ).toContain(authType);
    }
    for (const key of [
      'certificate.pem',
      'certificate.serial',
      'rest.response',
      'credentials.key',
    ]) {
      expect(
        knowledgeText,
        `Template key '${key}' not in rest_notifications.md`,
      ).toContain(key);
    }
  });

  it('rest-notifications knowledge documents event semantics', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'rest_notifications.md'),
      'utf-8',
    );
    for (const concept of [
      'on_approve_enroll',
      'pkcs12',
      'certificate.private_key',
      'previous.certificate',
      'fire-and-forget',
      'Dictionary Availability Matrix',
    ]) {
      expect(
        knowledgeText,
        `Event semantics concept '${concept}' not in rest_notifications.md`,
      ).toContain(concept);
    }
  });

  it('rest-notifications knowledge mentions chaining patterns', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'rest_notifications.md'),
      'utf-8',
    );
    for (const pattern of [
      'Pattern A',
      'Pattern B',
      'Pattern C',
      'OAuth',
      'Lookup',
    ]) {
      expect(
        knowledgeText,
        `Chaining pattern '${pattern}' not in rest_notifications.md`,
      ).toContain(pattern);
    }
  });

  it("query-languages knowledge mentions HCQL fields and search_certificates accepts 'query'", () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'query_languages.md'),
      'utf-8',
    );
    for (const field of ['dn', 'serial', 'profile', 'module']) {
      expect(
        knowledgeText,
        `HCQL field '${field}' not in query_languages.md`,
      ).toContain(field);
    }
    expect(getParamNames('search_certificates').has('query')).toBe(true);
  });

  it('tool-selection playbook documents docs lookup choreography', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'tool_selection.md'),
      'utf-8',
    );
    expect(knowledgeText).toContain('search_docs');
    expect(knowledgeText).toContain('search_api_docs');
    expect(knowledgeText).toContain('get_doc_page');
  });

  it('adcs integration recipe documents connector verification points', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'adcs_integration.md'),
      'utf-8',
    );
    for (const concept of ['evtadcs', 'msadcs', '4443', 'CertHash']) {
      expect(knowledgeText, `ADCS recipe missing ${concept}`).toContain(
        concept,
      );
    }
  });

  it('digicert integration recipe documents required connector fields', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'digicert_integration.md'),
      'utf-8',
    );
    for (const concept of [
      'digicert',
      'apiCredentials',
      'organizationId',
      'baseUrl',
    ]) {
      expect(knowledgeText, `DigiCert recipe missing ${concept}`).toContain(
        concept,
      );
    }
  });

  it('intune integration recipe documents azureTenant drift and both modules', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'intune_integration.md'),
      'utf-8',
    );
    for (const concept of ['azureTenant', 'intune', 'intunepkcs']) {
      expect(knowledgeText, `Intune recipe missing ${concept}`).toContain(
        concept,
      );
    }
  });
});

// ===================================================================
// Critical tool schema spot-checks
// (ported from test_golden.py TestCriticalToolSchemas)
// ===================================================================

describe('Critical tool schema spot-checks', () => {
  let toolsByName: Map<string, { inputSchema: Record<string, unknown> }>;

  beforeAll(async () => {
    const server = new McpServer({
      name: 'test-schemas',
      version: '0.0.0',
    });
    const mockClient = createMockClient();
    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'test-schemas-client',
      version: '0.0.0',
    });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const result = await client.listTools();
    toolsByName = new Map(
      result.tools.map((t) => [
        t.name,
        { inputSchema: t.inputSchema as Record<string, unknown> },
      ]),
    );
  });

  function getParamNames(toolName: string): Set<string> {
    const schema = toolsByName.get(toolName)?.inputSchema;
    if (!schema) return new Set();
    const props = (schema['properties'] as Record<string, unknown>) ?? {};
    return new Set(Object.keys(props));
  }

  it('search_certificates has expected params', () => {
    const params = getParamNames('search_certificates');
    for (const expected of [
      'query',
      'preset',
      'fields',
      'page_index',
      'page_size',
      'sorted_by',
      'with_count',
    ]) {
      expect(
        params.has(expected),
        `search_certificates missing param: ${expected}`,
      ).toBe(true);
    }
  });

  it('submit_request has expected params', () => {
    const params = getParamNames('submit_request');
    for (const expected of [
      'workflow',
      'profile',
      'module',
      'template',
      'data',
    ]) {
      expect(
        params.has(expected),
        `submit_request missing param: ${expected}`,
      ).toBe(true);
    }
  });

  it('create_dns_datasource has expected params', () => {
    const params = getParamNames('create_dns_datasource');
    for (const expected of [
      'name',
      'lookup',
      'host',
      'port',
      'timeout',
      'record_types',
    ]) {
      expect(
        params.has(expected),
        `create_dns_datasource missing param: ${expected}`,
      ).toBe(true);
    }
  });

  it('create_ldap_datasource has expected params', () => {
    const params = getParamNames('create_ldap_datasource');
    for (const expected of [
      'name',
      'hostname',
      'credentials',
      'base_dn',
      'filter',
      'secure',
      'timeout',
    ]) {
      expect(
        params.has(expected),
        `create_ldap_datasource missing param: ${expected}`,
      ).toBe(true);
    }
  });

  it('create_rest_notification has expected params', () => {
    const params = getParamNames('create_rest_notification');
    for (const expected of [
      'name',
      'event',
      'sequence',
      'retries',
      'run_period',
      'run_on_renewed',
    ]) {
      expect(
        params.has(expected),
        `create_rest_notification missing param: ${expected}`,
      ).toBe(true);
    }
  });
});

// ===================================================================
// Delete tool enumeration (ported from test_safety.py)
// ===================================================================

describe('Delete tool safety-tier enumeration', () => {
  const EXPECTED_DELETE_TOOLS = [
    'delete_dashboard',
    'delete_datasource',
    'delete_discovery_campaign',
    'delete_report',
    'delete_saved_query',
    'delete_trigger',
  ].sort();

  it('only expected delete tools are registered', async () => {
    const server = new McpServer({
      name: 'test-safety',
      version: '0.0.0',
    });
    const mockClient = createMockClient();
    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'test-safety-client',
      version: '0.0.0',
    });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const result = await client.listTools();
    const deleteTools = result.tools
      .map((t) => t.name)
      .filter((n) => n.startsWith('delete_'))
      .sort();

    expect(deleteTools).toEqual(EXPECTED_DELETE_TOOLS);
  });
});

// ===================================================================
// Tool registration verification (ported from test_phase_split.py)
// ===================================================================

describe('Tool registration verification', () => {
  let toolNames: Set<string>;

  beforeAll(async () => {
    const server = new McpServer({
      name: 'test-phase',
      version: '0.0.0',
    });
    const mockClient = createMockClient();
    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'test-phase-client',
      version: '0.0.0',
    });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const result = await client.listTools();
    toolNames = new Set(result.tools.map((t) => t.name));
  });

  it('registers exactly 93 tools', () => {
    expect(toolNames.size).toBe(93);
  });

  it('excludes admin tools', () => {
    const adminTools = [
      // Config admin
      'list_cas',
      'get_ca',
      'create_ca',
      'update_ca',
      'delete_ca',
      'list_labels',
      'get_label',
      'create_label',
      'update_label',
      'delete_label',
      'create_http_proxy',
      'update_http_proxy',
      'delete_http_proxy',
      'create_password_policy',
      'update_password_policy',
      'delete_password_policy',
      // Security admin
      'list_roles',
      'get_role',
      'create_role',
      'delete_role',
      'create_team',
      'delete_team',
      'create_principal',
      'delete_principal',
      'create_identity_provider',
      'delete_identity_provider',
      'get_credential',
      // Analytics
      'get_analytics',
      // Profile create/update
      'create_webra_profile',
      'update_webra_profile',
      'create_acme_profile',
      'update_acme_profile',
      'create_scep_profile',
      'update_scep_profile',
      'create_est_profile',
      'update_est_profile',
      'create_monitored_profile',
      'update_monitored_profile',
      'delete_profile',
      'create_wcce_profile',
      'create_crmp_profile',
      'create_intune_profile',
      'create_jamf_profile',
      // Connectors / Triggers
      'create_pki_connector',
      'create_trigger',
    ];
    for (const tool of adminTools) {
      expect(
        toolNames.has(tool),
        `Tool '${tool}' should not be registered`,
      ).toBe(false);
    }
  });

  it('includes expected tools', () => {
    const expected = [
      // Assist
      'whoami',
      'search_docs',
      'search_api_docs',
      'get_doc_page',
      'decode_x509',
      'validate_hcql',
      // Lifecycle
      'search_certificates',
      'get_certificate',
      'download_certificate',
      'set_certificate_auto_renew',
      // Profiles readonly
      'list_profiles',
      'get_profile',
      // Discovery
      'create_discovery_campaign',
      // Dashboards
      'list_dashboards',
      'create_dashboard',
      // Reports
      'list_reports',
      // Datasources
      'list_datasources',
      'create_dns_datasource',
      'create_ldap_datasource',
      'create_rest_datasource',
      // Triggers & Credentials
      'list_triggers',
      'list_credentials',
      'create_rest_notification',
    ];
    for (const tool of expected) {
      expect(toolNames.has(tool), `Expected tool '${tool}' missing`).toBe(true);
    }
  });
});
