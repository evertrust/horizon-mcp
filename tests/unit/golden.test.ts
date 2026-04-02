/**
 * Golden tests: verify tool count, resource count, and schema stability
 * via the MCP protocol (not private SDK internals).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { registerAllResources } from "../../src/resources/index.js";
import { registerProfileTools } from "../../src/tools/profiles.js";
import { registerLifecycleTools } from "../../src/tools/lifecycle.js";
import { registerDashboardTools } from "../../src/tools/dashboards.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";
import { registerDiscoveryEventTools } from "../../src/tools/discovery-events.js";
import { registerDiscoveryFeedTools } from "../../src/tools/discovery-feed.js";
import { registerDatasourceTools } from "../../src/tools/datasources.js";
import { registerReportTools } from "../../src/tools/reports.js";
import { registerTriggerTools } from "../../src/tools/triggers.js";
import { registerSystemTools } from "../../src/tools/assist/system.js";
import { registerQueryTools } from "../../src/tools/assist/query.js";
import { registerCryptoTools } from "../../src/tools/assist/crypto.js";
import { registerComputationTools } from "../../src/tools/assist/computation.js";
import { registerTranslateTools } from "../../src/tools/assist/translate.js";

// Minimal mock client that satisfies the HorizonClient interface for registration
function createMockClient(): any {
  return {
    get: async () => ({}),
    post: async () => ({}),
    put: async () => ({}),
    patch: async () => ({}),
    delete: async () => null,
    getBytes: async () => new ArrayBuffer(0),
    getText: async () => "",
    postText: async () => "",
    postMultipart: async () => ({}),
    request: async () => new Response(),
    close: async () => {},
    fetchCsrfToken: async () => undefined,
    exportTimeout: 120000,
    principalName: undefined,
    horizonVersion: undefined,
  };
}

describe("Golden tests", () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer(
      { name: "test", version: "0.0.0" },
    );

    const mockClient = createMockClient();

    // Register all resources
    registerAllResources(server);

    // Register all tool domains
    registerProfileTools(server, mockClient);
    registerLifecycleTools(server, mockClient);
    registerDashboardTools(server, mockClient);
    registerDiscoveryTools(server, mockClient);
    registerDiscoveryEventTools(server, mockClient);
    registerDiscoveryFeedTools(server, mockClient);
    registerDatasourceTools(server, mockClient);
    registerReportTools(server, mockClient);
    registerTriggerTools(server, mockClient);
    registerSystemTools(server, mockClient);
    registerQueryTools(server, mockClient);
    registerCryptoTools(server, mockClient);
    registerComputationTools(server, mockClient);
    registerTranslateTools(server, mockClient);

    // Connect via in-memory transport
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  it("registers exactly 81 tools", async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBe(81);
  });

  it("registers exactly 17 resources", async () => {
    const result = await client.listResources();
    expect(result.resources.length).toBe(17);
  });

  it("all tools have non-empty descriptions", async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description, `Tool ${tool.name} missing description`).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(10);
    }
  });

  it("all resources have horizon:// URIs", async () => {
    const result = await client.listResources();
    for (const resource of result.resources) {
      expect(resource.uri).toMatch(/^horizon:\/\/knowledge\//);
    }
  });

  it("tool names are unique", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("resource URIs are unique", async () => {
    const result = await client.listResources();
    const uris = result.resources.map((r) => r.uri);
    const uniqueUris = new Set(uris);
    expect(uniqueUris.size).toBe(uris.length);
  });

  it("all expected tool names are present", async () => {
    const result = await client.listTools();
    const names = new Set(result.tools.map((t) => t.name));

    // Spot-check critical tools across all domains
    const expectedTools = [
      // Profiles
      "list_profiles", "get_profile",
      // Lifecycle
      "search_certificates", "get_certificate", "download_certificate",
      "submit_request", "approve_request", "deny_request", "cancel_request",
      "search_requests", "get_request", "aggregate_certificates",
      // Dashboards
      "list_dashboards", "create_dashboard", "add_dashboard_chart",
      "list_saved_queries", "upsert_saved_query",
      // Discovery
      "list_discovery_campaigns", "create_discovery_campaign",
      "search_discovery_events", "start_discovery_feed_session",
      // Datasources
      "list_datasources", "create_dns_datasource", "create_rest_datasource",
      // Reports
      "list_reports", "download_report",
      // Triggers
      "list_credentials", "list_triggers", "create_rest_notification",
      // Assist
      "whoami", "get_license_info",
      "validate_hcql", "describe_query_fields",
      "decode_x509", "fetch_exposed_certificate", "convert_pkcs12_to_jks",
      "simulate_computation_rule",
      "translate_to_hql",
    ];

    for (const name of expectedTools) {
      expect(names.has(name), `Missing tool: ${name}`).toBe(true);
    }
  });

  it("all expected resource URIs are present", async () => {
    const result = await client.listResources();
    const uris = new Set(result.resources.map((r) => r.uri));

    const expectedUris = [
      "horizon://knowledge/profiles",
      "horizon://knowledge/computation-and-data-flow",
      "horizon://knowledge/workflows",
      "horizon://knowledge/query-languages",
      "horizon://knowledge/rbac",
      "horizon://knowledge/architecture",
      "horizon://knowledge/dictionary-matrix",
      "horizon://knowledge/dictionary-entries",
      "horizon://knowledge/discovery",
      "horizon://knowledge/automation",
      "horizon://knowledge/integrations",
      "horizon://knowledge/dashboards",
      "horizon://knowledge/system-admin",
      "horizon://knowledge/discovery-workflows",
      "horizon://knowledge/datasources",
      "horizon://knowledge/validation-rules",
      "horizon://knowledge/rest-notifications",
    ];

    for (const uri of expectedUris) {
      expect(uris.has(uri), `Missing resource: ${uri}`).toBe(true);
    }
  });

  it("tool schemas match snapshot", async () => {
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
});
