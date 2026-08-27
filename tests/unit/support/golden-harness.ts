import { McpServer } from '@modelcontextprotocol/server';
import { resolve } from 'node:path';

import {
  CORE_RESOURCE_URIS,
  CURATED_RESOURCE_URIS,
} from '../../../src/resources/catalog.js';
import { registerComputationTools } from '../../../src/tools/assist/computation.js';
import { registerCryptoTools } from '../../../src/tools/assist/crypto.js';
import { registerQueryTools } from '../../../src/tools/assist/query.js';
import { registerSystemTools } from '../../../src/tools/assist/system.js';
import { registerTranslateTools } from '../../../src/tools/assist/translate.js';
import { registerDashboardTools } from '../../../src/tools/dashboards.js';
import { registerDatasourceTools } from '../../../src/tools/datasources.js';
import { registerDiscoveryEventTools } from '../../../src/tools/discovery-events.js';
import { registerDiscoveryFeedTools } from '../../../src/tools/discovery-feed.js';
import { registerDiscoveryTools } from '../../../src/tools/discovery.js';
import { registerDocsTools } from '../../../src/tools/docs.js';
import { registerLifecycleTools } from '../../../src/tools/lifecycle.js';
import { registerProfileTools } from '../../../src/tools/profiles.js';
import { registerReportTools } from '../../../src/tools/reports.js';
import { registerTriggerTools } from '../../../src/tools/triggers.js';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

export const KNOWLEDGE_DIR = resolve(
  __dirname,
  '../../../src/resources/knowledge',
);

/** Minimal mock client that satisfies the HorizonClient interface. */
export function createMockClient(): unknown {
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
export function registerAllTools(server: McpServer, mockClient: unknown): void {
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

export const EXPECTED_TOOL_NAMES: string[] = [
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

export const REQUIRED_RESOURCE_URIS: string[] = [
  ...CORE_RESOURCE_URIS,
  ...CURATED_RESOURCE_URIS,
].sort();

export const CRITICAL_SECTION_RESOURCE_URIS: string[] = [
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
export const KNOWLEDGE_FILES: string[] = [
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

export const CURATED_KNOWLEDGE_FILES: string[] = [
  'tool_selection.md',
  'adcs_integration.md',
  'digicert_integration.md',
  'intune_integration.md',
];
