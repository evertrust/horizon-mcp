import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllResources } from '../../src/resources/index.js';
import { registerServiceAccountTools } from '../../src/tools/config/service-accounts.js';
import {
  CRITICAL_SECTION_RESOURCE_URIS,
  EXPECTED_TOOL_NAMES,
  REQUIRED_RESOURCE_URIS,
  createMockClient,
  registerAllTools,
} from './support/golden-harness.js';

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
