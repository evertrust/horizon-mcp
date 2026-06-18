/**
 * Live LLM scenarios. A curated subset of the deterministic
 * tests/llm-evaluation/scenarios.ts, focused on the highest-signal flows that
 * actually exercise MCP tool selection by the model.
 *
 * Keep this list small. Each scenario costs one Haiku turn against your Claude
 * subscription credit; ~10 scenarios per run is the design target.
 */
export interface LiveScenario {
  readonly id: string;
  readonly question: string;
  /**
   * Acceptable primary tools - the first tool Claude calls must be one of
   * these for the scenario to pass. Multiple values means several tools are
   * legitimate choices.
   */
  readonly acceptablePrimaryTools: readonly string[];
  /**
   * Optional. If set, fail the scenario when Claude calls any of these tools
   * before calling an acceptable primary tool.
   */
  readonly forbiddenTools?: readonly string[];
  /**
   * Optional. If set, the first acceptable tool call must include all of
   * these keys in its `input` object.
   */
  readonly requiredArgs?: readonly string[];
  /**
   * Optional per-scenario USD budget override. Use for scenarios that read
   * large payloads (e.g. full API-reference doc pages) and legitimately need
   * more headroom than the default.
   */
  readonly maxBudgetUsd?: number;
}

export const LIVE_SCENARIOS: readonly LiveScenario[] = [
  {
    id: 'expired-certificates-search',
    question: 'Search Horizon for every certificate that has already expired.',
    acceptablePrimaryTools: ['search_certificates'],
    requiredArgs: ['query'],
  },
  {
    id: 'aggregate-by-profile',
    question:
      'Give me the count of certificates expiring in 30 days grouped by profile.',
    acceptablePrimaryTools: ['aggregate_certificates'],
    requiredArgs: ['query'],
  },
  {
    id: 'get-request-by-id',
    question: 'Show me request 66f8d30a2f3d4e0011223344.',
    acceptablePrimaryTools: ['get_request'],
    forbiddenTools: ['search_requests'],
    requiredArgs: ['request_id'],
  },
  {
    id: 'events-csv-export',
    question:
      'Export all events from the Horizon audit log to a CSV file (no filtering).',
    acceptablePrimaryTools: ['export_events_csv'],
    forbiddenTools: ['search_events'],
    requiredArgs: ['query'],
  },
  {
    id: 'adcs-docs-flow',
    question: 'How do I configure the EverTrust ADCS Connector?',
    acceptablePrimaryTools: ['search_docs'],
    requiredArgs: ['query'],
  },
  {
    id: 'api-docs-flow',
    question:
      'Which API endpoint retrieves a request by ID and what does the response look like?',
    acceptablePrimaryTools: ['search_api_docs'],
    requiredArgs: ['query'],
    // Reading full API-reference doc pages is token-heavy; give it headroom.
    maxBudgetUsd: 1.0,
  },
  {
    id: 'live-certificate-exposure',
    question:
      'Fetch the certificate exposed on https://gateway.example.com:443 and decode it.',
    acceptablePrimaryTools: ['fetch_exposed_certificate'],
  },
  {
    id: 'datasource-flow-simulation',
    question:
      'I want to build a Horizon datasource flow that first gets an OAuth token and then calls a CMDB API. Start by listing the datasources already configured in Horizon.',
    // Multi-step + non-deterministic: Claude may go straight to the simulator
    // or first list existing datasources to ground the flow. Both are correct
    // datasource-domain choices; do not over-constrain the arg shape.
    acceptablePrimaryTools: ['simulate_datasource_flow', 'list_datasources'],
  },
  {
    id: 'query-translation',
    question:
      'Use Horizon\'s natural-language query translator to turn "certificates expiring in seven days" into a validated HCQL query - do not hand-write the syntax yourself.',
    acceptablePrimaryTools: ['translate_to_hql'],
    requiredArgs: ['natural_language'],
  },
  {
    id: 'whoami-ownership',
    question: 'Who am I in Horizon and what teams do I belong to?',
    acceptablePrimaryTools: ['whoami'],
  },

  // Configuration CRUD tools. Kept NON-DESTRUCTIVE (list / describe) on purpose:
  // the runner executes the first tool the model picks, so mutating selections
  // (create/update/delete) would write to the shared QA instance. Selection of
  // the mutating config tools is covered $0 in tests/llm-evaluation/scenarios.ts.
  {
    id: 'config-list-http-proxies',
    question: 'List all the HTTP proxy configurations in Horizon.',
    acceptablePrimaryTools: ['list_http_proxies'],
  },
  {
    id: 'config-list-cas',
    question: 'List the certificate authorities configured in Horizon.',
    acceptablePrimaryTools: ['list_cas'],
  },
  {
    id: 'config-describe-pki-connector',
    question:
      'What fields do I need to create a PKI connector? Show me its schema.',
    acceptablePrimaryTools: ['describe_pki_connector_schema'],
  },
  {
    id: 'config-describe-certificate-profile',
    question:
      'Show me the schema and required fields for creating a certificate profile.',
    acceptablePrimaryTools: ['describe_certificate_profile_schema'],
  },
] as const;
