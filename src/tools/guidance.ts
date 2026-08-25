/**
 * Per-tool disambiguation hints surfaced to the model alongside the tool
 * description. Format is intentionally compact:
 *
 *   [when: <fragment> | not: <fragment> | pre: <fragment>]
 *
 * `pre:` is optional. No prose, no leading "Use when:" sentences -- the format
 * is small-model legible while remaining ~35% smaller than the original.
 *
 * Only tools whose role would otherwise be confused with a sibling get an
 * entry. There is intentionally no family-prefix fallback: the tool name
 * already encodes the verb, and a generic "use when the action implied by the
 * verb matches" sentence costs tokens without adding signal.
 */
export interface ToolGuidance {
  readonly useWhen: string;
  readonly doNotUseWhen: string;
  readonly beforeCall?: string;
}

const EXPLICIT_GUIDANCE: Record<string, ToolGuidance> = {
  whoami: {
    useWhen: 'caller asks who they are, teams, or permissions',
    doNotUseWhen:
      'caller asks Horizon version or license; use get_license_info',
  },
  get_license_info: {
    useWhen:
      'caller needs Horizon version, license status, or instance details',
    doNotUseWhen: 'caller asks own identity or permissions; use whoami',
  },
  describe_query_fields: {
    useWhen: 'you need valid HCQL/HRQL/HEQL/HDQL fields before writing a query',
    doNotUseWhen:
      'caller already has a complete query and wants validation or execution',
  },
  translate_to_hql: {
    useWhen:
      'caller describes a search in natural language; you need a draft query',
    doNotUseWhen: 'caller supplied Horizon query syntax already',
    beforeCall:
      'run validate_hql with the matching dialect when correctness matters',
  },
  search_certificates: {
    useWhen:
      'caller wants to find, list, or export individual certificates matching criteria',
    doNotUseWhen:
      'caller wants a count, total, or breakdown grouped by a field; use aggregate_certificates',
  },
  aggregate_certificates: {
    useWhen:
      'caller wants counts, totals, statistics, or a grouped-by breakdown (e.g. how many certificates per profile, status, or issuer)',
    doNotUseWhen:
      'caller wants the matching certificate records themselves; use search_certificates',
  },
  search_docs: {
    useWhen:
      'caller asks how to install/configure/integrate a product (admin docs)',
    doNotUseWhen:
      'caller already has a page_id or asks about REST API behavior',
    beforeCall: 'call get_doc_page with a returned page_id; do not guess',
  },
  search_api_docs: {
    useWhen:
      'caller asks about REST endpoints, payloads, responses, error codes',
    doNotUseWhen: 'caller wants installation or admin-guide content',
    beforeCall: 'call get_doc_page with a returned page_id',
  },
  get_doc_page: {
    useWhen: 'you already have a page_id and need the full page',
    doNotUseWhen: 'you have not searched yet or are guessing a page id',
  },
  simulate_computation_rule: {
    useWhen: 'caller is drafting or debugging a computation rule or template',
    doNotUseWhen: 'caller wants to persist the rule on a profile',
  },
  simulate_datasource_flow: {
    useWhen:
      'caller wants to validate a datasource flow design without persisting',
    doNotUseWhen: 'caller wants to create or update real datasource objects',
  },
  fetch_exposed_certificate: {
    useWhen: 'caller wants the live certificate exposed by a host or endpoint',
    doNotUseWhen:
      'caller already has PEM/DER/CSR/OCSP/CRL data to decode locally',
  },
  detect_file: {
    useWhen: 'opaque PEM/DER/binary and the type is unknown',
    doNotUseWhen: 'type is known; use the matching decode_* tool',
  },
  decode_x509: {
    useWhen: 'input is already known to be an X.509 certificate',
    doNotUseWhen: 'the data type is unknown',
  },
  decode_csr: {
    useWhen: 'input is already known to be a PKCS#10 CSR',
    doNotUseWhen: 'the data type is unknown',
  },
  decode_crl: {
    useWhen: 'input is already known to be a CRL',
    doNotUseWhen: 'the data type is unknown',
  },
  decode_ocsp: {
    useWhen: 'input is already known to be an OCSP response',
    doNotUseWhen: 'the data type is unknown',
  },
  decode_tsa: {
    useWhen: 'input is already known to be a TSA/timestamp token',
    doNotUseWhen: 'the data type is unknown',
  },
  convert_pkcs12_to_jks: {
    useWhen: 'caller explicitly needs a JKS converted from an existing PKCS#12',
    doNotUseWhen: 'caller only needs inspection or Horizon inventory',
  },
  list_credentials: {
    useWhen:
      'caller needs names/types of reusable credentials for connectors/triggers',
    doNotUseWhen:
      'caller expects secret material; this tool only lists inventory',
  },
  create_rest_notification: {
    useWhen: 'caller explicitly wants to create a REST notification trigger',
    doNotUseWhen: 'caller only wants design guidance or schema examples',
    beforeCall:
      'use list_credentials if the notification needs an existing credential',
  },
  create_service_account: {
    useWhen:
      'caller explicitly provides the JWT trust configuration and grants',
    doNotUseWhen: 'caller only wants to inspect service-account configuration',
    beforeCall:
      'confirm exact roles and permissions; do not infer broad access',
  },
  update_service_account: {
    useWhen: 'caller wants to change an existing service account',
    doNotUseWhen: 'caller only wants to inspect service-account configuration',
    beforeCall:
      'get the account first; omitted fields are preserved, trustConfig may be omitted when unchanged, and only an explicitly replaced static JWKS must be a JSON string',
  },
  delete_service_account: {
    useWhen: 'caller explicitly wants to permanently remove a service account',
    doNotUseWhen: 'caller only wants to revoke or inspect its access',
    beforeCall:
      'confirm expected_name and check that the account is not read-only',
  },
  simulate_trigger: {
    useWhen: 'caller wants to dry-run a trigger payload or REST notification',
    doNotUseWhen: 'caller wants to create/update/delete the trigger itself',
  },
  submit_request: {
    useWhen:
      'caller wants to submit a lifecycle request and template fields are known',
    doNotUseWhen: 'the request template has not been inspected yet',
    beforeCall:
      'call get_request_template first; ask user for any missing mandatory fields',
  },
  approve_request: {
    useWhen: 'caller wants to approve a pending request and the id is known',
    doNotUseWhen: 'the request id is unknown or caller is only inspecting',
  },
  deny_request: {
    useWhen: 'caller wants to deny a pending request and the id is known',
    doNotUseWhen: 'the request id is unknown or caller is only inspecting',
  },
  cancel_request: {
    useWhen: 'caller wants to cancel a pending request and the id is known',
    doNotUseWhen: 'the request id is unknown or caller is only inspecting',
  },
};

function getGuidance(name: string): ToolGuidance | undefined {
  return EXPLICIT_GUIDANCE[name];
}

export function buildToolDescription(
  name: string,
  description?: string,
): string | undefined {
  if (!description) return description;
  if (
    description.includes('Use when:') &&
    description.includes('Do not use when:')
  ) {
    return description;
  }
  // Honor the compact form too, so callers can pre-stamp it.
  if (description.includes('[when:') && description.includes(' | not:')) {
    return description;
  }

  const guidance = getGuidance(name);
  if (!guidance) return description;

  let suffix = `\n[when: ${guidance.useWhen} | not: ${guidance.doNotUseWhen}`;
  if (guidance.beforeCall) suffix += ` | pre: ${guidance.beforeCall}`;
  suffix += ']';

  return `${description.trimEnd()}${suffix}`;
}
