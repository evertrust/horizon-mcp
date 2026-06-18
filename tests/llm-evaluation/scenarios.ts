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

  // ---------------------------------------------------------------------------
  // Configuration CRUD tools
  // ---------------------------------------------------------------------------
  {
    id: 'config-create-http-proxy',
    question:
      'Create an HTTP proxy named corp-proxy pointing at proxy.corp.local on port 3128.',
    expectedPrimaryTools: ['create_http_proxy'],
    primaryMaxRank: 4,
    requiredArgs: {
      create_http_proxy: ['name', 'host', 'port'],
    },
  },
  {
    id: 'config-delete-http-proxy',
    question: 'Delete the HTTP proxy called legacy-proxy.',
    expectedPrimaryTools: ['delete_http_proxy'],
    primaryMaxRank: 4,
    requiredArgs: {
      delete_http_proxy: ['name', 'expected_name'],
    },
  },
  {
    id: 'config-create-role',
    question: 'Create a security role named auditors.',
    expectedPrimaryTools: ['create_role'],
    primaryMaxRank: 4,
    requiredArgs: {
      create_role: ['name', 'permissions'],
    },
  },
  {
    id: 'config-add-team-member',
    question: 'Add the members alice and bob to the operators team.',
    expectedPrimaryTools: ['add_team_members'],
    primaryMaxRank: 4,
    requiredArgs: {
      add_team_members: ['name', 'identifiers'],
    },
  },
  {
    id: 'config-update-storage',
    question:
      'Update the S3 storage backend named archive-store to use the bucket new-archive.',
    expectedPrimaryTools: ['update_storage'],
    primaryMaxRank: 4,
    requiredArgs: {
      update_storage: ['name', 'bucket'],
    },
  },
  {
    id: 'config-pki-connector-polymorphic',
    question:
      'Create a new PKI connector backed by DigiCert for issuing certificates.',
    expectedPrimaryTools: ['create_pki_connector'],
    primaryMaxRank: 5,
    expectedSupportTools: ['describe_pki_connector_schema'],
    supportMaxRank: 8,
    requiredArgs: {
      create_pki_connector: ['name', 'type', 'config'],
      describe_pki_connector_schema: ['subtype'],
    },
  },
  {
    id: 'config-certificate-profile-polymorphic',
    question: 'Create a managed certificate profile called web-servers.',
    expectedPrimaryTools: ['create_certificate_profile'],
    primaryMaxRank: 6,
    expectedSupportTools: ['describe_certificate_profile_schema'],
    supportMaxRank: 10,
    requiredArgs: {
      create_certificate_profile: ['module', 'name'],
    },
  },
] as const;
