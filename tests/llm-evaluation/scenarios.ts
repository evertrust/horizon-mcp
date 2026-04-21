export interface SelectionScenario {
  readonly id: string;
  readonly question: string;
  readonly expectedPrimaryTools: readonly string[];
  readonly primaryMaxRank: number;
  readonly expectedSupportTools?: readonly string[];
  readonly supportMaxRank?: number;
  readonly disallowedTools?: readonly string[];
  readonly expectedResourceUris?: readonly string[];
  readonly resourceMaxRank?: number;
  readonly requiredArgs?: Readonly<Record<string, readonly string[]>>;
}

export const TOOL_SELECTION_SCENARIOS: readonly SelectionScenario[] = [
  {
    id: 'expired-certificates-search',
    question: 'Find all expired certificates in Horizon.',
    expectedPrimaryTools: ['search_certificates'],
    primaryMaxRank: 4,
    requiredArgs: {
      search_certificates: ['query'],
    },
    expectedResourceUris: ['horizon://knowledge/query-languages'],
    resourceMaxRank: 10,
  },
  {
    id: 'aggregate-expiring-by-profile',
    question:
      'Give me the count of certificates expiring in 30 days grouped by profile.',
    expectedPrimaryTools: ['aggregate_certificates'],
    primaryMaxRank: 3,
    requiredArgs: {
      aggregate_certificates: ['query', 'group_by'],
    },
  },
  {
    id: 'get-request-by-id',
    question: 'Show me request 66f8d30a2f3d4e0011223344.',
    expectedPrimaryTools: ['get_request'],
    primaryMaxRank: 3,
    disallowedTools: ['search_requests'],
    requiredArgs: {
      get_request: ['request_id'],
    },
  },
  {
    id: 'events-csv-export',
    question: 'Export the event audit log as CSV.',
    expectedPrimaryTools: ['export_events_csv'],
    primaryMaxRank: 3,
    disallowedTools: ['search_events'],
    requiredArgs: {
      export_events_csv: ['query'],
    },
  },
  {
    id: 'adcs-docs-flow',
    question: 'How do I configure the EverTrust ADCS Connector?',
    expectedPrimaryTools: ['search_docs'],
    primaryMaxRank: 3,
    expectedSupportTools: ['get_doc_page'],
    supportMaxRank: 8,
    requiredArgs: {
      search_docs: ['query'],
      get_doc_page: ['page_id'],
    },
    expectedResourceUris: ['horizon://knowledge/adcs-integration'],
    resourceMaxRank: 5,
  },
  {
    id: 'intune-docs-flow',
    question: 'How do I configure an Intune PKCS integration with Horizon?',
    expectedPrimaryTools: ['search_docs'],
    primaryMaxRank: 3,
    expectedSupportTools: ['get_doc_page'],
    supportMaxRank: 8,
    requiredArgs: {
      search_docs: ['query'],
      get_doc_page: ['page_id'],
    },
    expectedResourceUris: ['horizon://knowledge/intune-integration'],
    resourceMaxRank: 5,
  },
  {
    id: 'api-docs-flow',
    question:
      'Which API endpoint retrieves a request by ID and what does the response look like?',
    expectedPrimaryTools: ['search_api_docs'],
    primaryMaxRank: 3,
    expectedSupportTools: ['get_doc_page'],
    supportMaxRank: 8,
    requiredArgs: {
      search_api_docs: ['query'],
      get_doc_page: ['page_id'],
    },
  },
  {
    id: 'live-certificate-exposure',
    question:
      'Fetch the certificate exposed on https://gateway.example.com:443 and decode it.',
    expectedPrimaryTools: ['fetch_exposed_certificate'],
    primaryMaxRank: 3,
    expectedSupportTools: ['decode_x509'],
    supportMaxRank: 10,
  },
  {
    id: 'datasource-flow-simulation',
    question:
      'Simulate a datasource flow that first gets an OAuth token and then calls a CMDB API.',
    expectedPrimaryTools: ['simulate_datasource_flow'],
    primaryMaxRank: 3,
    requiredArgs: {
      simulate_datasource_flow: ['flow'],
    },
    expectedResourceUris: ['horizon://knowledge/datasources/rest-datasource'],
    resourceMaxRank: 12,
  },
  {
    id: 'rest-notification-oauth-pattern',
    question:
      'How do I build an OAuth multi-step REST notification that reuses the token in the second call?',
    expectedPrimaryTools: [],
    primaryMaxRank: 0,
    expectedResourceUris: [
      'horizon://knowledge/rest-notifications/real-world-examples',
    ],
    resourceMaxRank: 10,
  },
  {
    id: 'query-translation',
    question:
      'Translate "certificates expiring in seven days" to HCQL and validate it.',
    expectedPrimaryTools: ['translate_to_hql'],
    primaryMaxRank: 4,
    expectedSupportTools: ['validate_hcql'],
    supportMaxRank: 10,
    requiredArgs: {
      translate_to_hql: ['natural_language'],
      validate_hcql: ['query'],
    },
  },
] as const;
