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
}

export const LIVE_SCENARIOS: readonly LiveScenario[] = [
  {
    id: 'expired-certificates-search',
    question: 'Find all expired certificates in Horizon.',
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
    question: 'Export the event audit log as CSV.',
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
      'Simulate a datasource flow that first gets an OAuth token and then calls a CMDB API.',
    acceptablePrimaryTools: ['simulate_datasource_flow'],
    requiredArgs: ['flow'],
  },
  {
    id: 'query-translation',
    question:
      'Translate "certificates expiring in seven days" to HCQL and validate it.',
    acceptablePrimaryTools: ['translate_to_hql'],
    requiredArgs: ['natural_language'],
  },
  {
    id: 'whoami-ownership',
    question: 'Who am I in Horizon and what teams do I belong to?',
    acceptablePrimaryTools: ['whoami'],
  },
] as const;
