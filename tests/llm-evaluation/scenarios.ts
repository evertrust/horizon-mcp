/**
 * Golden evaluation scenarios - tool selection and resource usage expectations.
 *
 * Each scenario represents a user question and the expected tools/concepts
 * that Claude should mention or invoke when answering with the Horizon MCP
 * server attached.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Scenario {
  readonly id: string;
  readonly question: string;
  readonly expectedTools: readonly string[];
  readonly expectedConcepts: readonly string[];
}

// ---------------------------------------------------------------------------
// Golden scenarios
// ---------------------------------------------------------------------------

export const TOOL_SELECTION_SCENARIOS: readonly Scenario[] = [
  {
    id: 'certificate-search-hcql',
    question: 'How do I find all expired certificates?',
    expectedTools: ['search_certificates', 'validate_hcql'],
    expectedConcepts: ['query-languages'],
  },
  {
    id: 'webra-enrollment',
    question: 'Show me an example of enrolling a certificate through WebRA',
    expectedTools: ['get_request_template', 'submit_request'],
    expectedConcepts: ['workflows', 'profiles'],
  },
  {
    id: 'dashboard-creation',
    question: 'Create a dashboard showing certificate expiry by month',
    expectedTools: ['create_dashboard', 'add_dashboard_chart'],
    expectedConcepts: ['dashboards'],
  },
  {
    id: 'discovery-campaign',
    question: 'Set up a discovery campaign to scan my network',
    expectedTools: ['create_discovery_campaign'],
    expectedConcepts: ['discovery'],
  },
  {
    id: 'identity-check',
    question: 'Who am I and what permissions do I have?',
    expectedTools: ['whoami'],
    expectedConcepts: ['rbac'],
  },
  {
    id: 'hql-translation',
    question: "Translate 'expiring in 30 days' to HCQL",
    expectedTools: ['translate_to_hql'],
    expectedConcepts: ['query-languages'],
  },
  {
    id: 'knowledge-acme-profiles',
    question: 'How do ACME profiles work in Horizon?',
    expectedTools: [],
    expectedConcepts: ['profiles', 'integrations'],
  },
  {
    id: 'knowledge-query-languages',
    question: "What's the difference between HCQL and HRQL?",
    expectedTools: [],
    expectedConcepts: ['query-languages'],
  },

  // --- Computation rule scenarios ---
  {
    id: 'computation-uppercase-cn',
    question: 'Write a computation rule that uppercases the CN from the CSR',
    expectedTools: ['simulate_computation_rule'],
    expectedConcepts: ['computation-and-data-flow'],
  },
  {
    id: 'computation-email-domain',
    question:
      'Build a template string that extracts the domain from an email ' +
      'address found in the certificate subject',
    expectedTools: ['simulate_computation_rule'],
    expectedConcepts: ['computation-and-data-flow'],
  },
  {
    id: 'knowledge-webra-dictionary',
    question: 'What dictionary entries are available during WebRA enrollment?',
    expectedTools: [],
    expectedConcepts: ['computation-and-data-flow'],
  },
  {
    id: 'computation-cn-dns-san',
    question:
      "Write a computation rule that ensures the CSR's CN is always present " +
      "as a DNS SAN. If the CN is already in the DNS SANs from the CSR, don't " +
      'duplicate it. But if the CSR does not contain the CN as a DNS SAN, add it.',
    expectedTools: ['simulate_computation_rule'],
    expectedConcepts: ['computation-and-data-flow'],
  },
  {
    id: 'computation-parent-domain-san',
    question:
      'Write a computation rule that always adds the parent domain as a DNS SAN. ' +
      'For example, if my FQDN is machine.domain.local, the rule should add an ' +
      "extra DNS SAN containing 'domain.local' to ensure compatibility for LDAPS " +
      'connectivity to domain controllers.',
    expectedTools: ['simulate_computation_rule'],
    expectedConcepts: ['computation-and-data-flow'],
  },

  // --- Certificate decode/crypto scenarios ---
  {
    id: 'fetch-decode-live-cert',
    question:
      'Check what certificate is exposed on https://www.google.com ' +
      'and decode it to show me the full details',
    expectedTools: ['fetch_exposed_certificate', 'decode_x509'],
    expectedConcepts: [],
  },
  {
    id: 'detect-crypto-file',
    question:
      "I have a PEM file and I'm not sure what it contains - could be a cert, " +
      'a CSR, or something else. How do I identify it?',
    expectedTools: ['detect_file'],
    expectedConcepts: [],
  },
  {
    id: 'verify-deployed-cert',
    question:
      'Is the certificate currently deployed on ldaps://dc01.corp.local:636 ' +
      'the same one managed in Horizon?',
    expectedTools: ['fetch_exposed_certificate', 'search_certificates'],
    expectedConcepts: [],
  },

  // --- Datasource scenarios ---
  {
    id: 'list-datasources',
    question: 'List all configured external datasources in Horizon',
    expectedTools: ['list_datasources'],
    expectedConcepts: ['datasources'],
  },
  {
    id: 'dns-datasource-san-validation',
    question:
      'I need to set up a DNS datasource to look up CNAME records for ' +
      "certificate SAN validation during enrollment. What's the approach?",
    expectedTools: ['create_dns_datasource'],
    expectedConcepts: ['datasources', 'validation-rules'],
  },
  {
    id: 'ldap-datasource-ad-enrichment',
    question:
      'How do I configure an LDAP datasource to enrich certificate ' +
      'requests with user department information from Active Directory?',
    expectedTools: ['create_ldap_datasource'],
    expectedConcepts: ['datasources'],
  },

  // --- Validation rule scenarios ---
  {
    id: 'knowledge-validation-modules',
    question:
      'Which certificate profile modules support auto-validation rules? ' +
      'What are the differences in authorization modes?',
    expectedTools: [],
    expectedConcepts: ['validation-rules'],
  },
  {
    id: 'knowledge-validation-complex',
    question:
      'Write a validation rule that checks if the certificate CN ends ' +
      "with .corp.local AND the requesting user's IP is in the 10.0.0.0/8 range",
    expectedTools: [],
    expectedConcepts: ['validation-rules'],
  },
  {
    id: 'knowledge-est-dictionary',
    question: 'What dictionary entries are available during EST enrollment?',
    expectedTools: [],
    expectedConcepts: ['dictionary-entries'],
  },

  // --- REST notification scenarios ---
  {
    id: 'knowledge-rest-notif-deployment',
    question:
      'I need to deploy certificates to our internal load balancer via its ' +
      'REST API whenever a certificate is enrolled. The API requires a ' +
      'bearer token and accepts JSON with the PEM and private key.',
    expectedTools: [],
    expectedConcepts: ['rest-notifications', 'automation'],
  },
  {
    id: 'knowledge-rest-notif-oauth',
    question:
      'How do I build a REST notification that first obtains an OAuth token ' +
      'from an auth server, then uses that token to push the certificate ' +
      'to our deployment API?',
    expectedTools: [],
    expectedConcepts: ['rest-notifications'],
  },
  {
    id: 'knowledge-rest-notif-variables',
    question:
      'What template variables can I use in a REST notification payload? ' +
      'I need the certificate PEM, CN, SANs, and serial number.',
    expectedTools: [],
    expectedConcepts: ['rest-notifications'],
  },
  {
    id: 'knowledge-rest-notif-revocation',
    question:
      'When a certificate is revoked, I want to notify our security ' +
      'operations platform via a REST API call. How do I set this up?',
    expectedTools: [],
    expectedConcepts: ['rest-notifications'],
  },

  // --- Trigger tool scenarios ---
  {
    id: 'list-rest-triggers',
    question: 'List all REST notifications configured on this Horizon instance',
    expectedTools: ['list_triggers'],
    expectedConcepts: ['rest-notifications'],
  },
  {
    id: 'create-rest-notification',
    question:
      'Create a REST notification that POSTs certificate data to ' +
      'https://webhook.site/test when a certificate is enrolled. ' +
      'Use no authentication and expect HTTP 200.',
    expectedTools: ['create_rest_notification'],
    expectedConcepts: ['rest-notifications'],
  },
] as const;
