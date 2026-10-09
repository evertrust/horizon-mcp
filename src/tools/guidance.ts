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
    useWhen:
      'you need valid HCQL/HRQL/HEQL/HDQL/HAQL/HEABQL fields before writing a query',
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
    useWhen:
      'caller explicitly wants to fire a trigger test; it sends real notifications',
    doNotUseWhen:
      'caller wants a dry run, or wants to create/update/delete the trigger',
    beforeCall: 'confirm the intent and use a test recipient',
  },
  submit_request: {
    useWhen:
      'caller wants to submit a lifecycle request and template fields are known',
    doNotUseWhen: 'the request template has not been inspected yet',
    beforeCall:
      'call get_request_template first; for WebRA update inspect template.autoRenew; on Horizon 2.11+ a WebRA challenge profile returns the challenge in password.value',
  },
  approve_request: {
    useWhen: 'caller wants to approve a pending request and the id is known',
    doNotUseWhen: 'the request id is unknown or caller is only inspecting',
  },
  submit_webra_challenge: {
    useWhen:
      'caller holds a one-time WebRA challenge and wants the certificate it authorizes (Horizon 2.11+)',
    doNotUseWhen:
      'caller has no challenge yet or wants an EST/SCEP challenge; use submit_request',
    beforeCall:
      'confirm profile and key mode (keyType for centralized, csr for decentralized); the challenge works once',
  },
  deny_request: {
    useWhen: 'caller wants to deny a pending request and the id is known',
    doNotUseWhen: 'the request id is unknown or caller is only inspecting',
  },
  cancel_request: {
    useWhen: 'caller wants to cancel a pending request and the id is known',
    doNotUseWhen: 'the request id is unknown or caller is only inspecting',
  },
  set_certificate_auto_renew: {
    useWhen:
      'caller wants to turn WebRA auto-renew on or off for one certificate (Horizon 2.10+)',
    doNotUseWhen:
      'caller wants to change the auto-renewal policy of a profile; use update_certificate_profile',
    beforeCall:
      'check that the profile has autoRenewalPolicy.editable set to true',
  },
  list_dcv_policy_status: {
    useWhen:
      'caller wants an overview of DCV policy readiness or current state',
    doNotUseWhen: 'caller needs domains, timing, or errors for one policy',
  },
  get_dcv_policy_status: {
    useWhen: "caller needs one policy's domain status, schedule, or run errors",
    doNotUseWhen: 'caller only needs the available policy list',
  },
  run_dcv_policy: {
    useWhen:
      'caller explicitly wants to start DCV for every eligible policy domain',
    doNotUseWhen: 'caller wants a single domain or is only inspecting status',
    beforeCall: 'confirm the policy is intended and inspect its status first',
  },
  run_dcv_domain: {
    useWhen: 'caller explicitly wants to start DCV for one named policy domain',
    doNotUseWhen:
      'caller intends a full policy run or is only inspecting status',
    beforeCall:
      'confirm the policy and domain, then inspect policy status first',
  },
  cancel_dcv_run: {
    useWhen: 'caller explicitly wants to stop an active DCV policy run',
    doNotUseWhen:
      'caller wants to stop only one domain or merely inspect status',
    beforeCall:
      'confirm this cancels the whole policy run, including its domains',
  },
  list_dcv_events: {
    useWhen:
      'caller needs DCV run history, failures, retries, or retention timing',
    doNotUseWhen: 'caller needs the current policy or domain status instead',
  },
  search_acme_accounts: {
    useWhen:
      'caller wants to find ACME accounts by contact, EAB, status, or date (2.11+)',
    doNotUseWhen: 'caller already has the account ID; use get_acme_account',
  },
  get_acme_account: {
    useWhen: 'caller has an ACME account ID and wants its details (2.11+)',
    doNotUseWhen:
      'caller wants the orders of the account; use list_acme_orders',
  },
  update_acme_account_status: {
    useWhen:
      'caller explicitly wants to suspend, deactivate, revoke, reactivate, or compromise an ACME account',
    doNotUseWhen:
      'caller only inspects the account or wants to revoke one certificate',
    beforeCall:
      'confirm status with the user; compromised is final and revokes certificates',
  },
  delete_acme_account: {
    useWhen:
      'caller explicitly wants to permanently remove an ACME account and its orders',
    doNotUseWhen:
      'caller only wants to block it; use update_acme_account_status',
    beforeCall: 'confirm expected_account_id with the user',
  },
  list_acme_orders: {
    useWhen: 'caller wants the orders of one known ACME account (2.11+)',
    doNotUseWhen:
      'caller does not know the account ID yet; use search_acme_accounts first',
  },
  get_acme_order: {
    useWhen: 'caller has an ACME order ID and wants its details (2.11+)',
    doNotUseWhen: 'caller wants all orders of an account; use list_acme_orders',
  },
  search_acme_eabs: {
    useWhen:
      'caller wants to find ACME EABs by name, policy, status, or date (2.11+)',
    doNotUseWhen: 'caller already has the EAB name; use get_acme_eab',
  },
  get_acme_eab: {
    useWhen: 'caller has an EAB name and wants its details (2.11+)',
    doNotUseWhen:
      'caller wants the MAC key; it is shown only by create_acme_eab or renew_acme_eab',
  },
  create_acme_eab: {
    useWhen:
      'caller explicitly wants new ACME EAB credentials and gave name, policy, and MAC algorithm',
    doNotUseWhen:
      'caller wants a new MAC key for an existing EAB; use renew_acme_eab',
    beforeCall:
      'check the EAB policy exists; give the one-time macKey and macKeyId to the user',
  },
  update_acme_eab: {
    useWhen: 'caller wants to change the policy or constraints of an EAB',
    doNotUseWhen:
      'caller wants to change the status (update_acme_eab_status) or the MAC key (renew_acme_eab)',
  },
  update_acme_eab_status: {
    useWhen:
      'caller explicitly wants to disable, suspend, deactivate, reactivate, or compromise an EAB',
    doNotUseWhen: 'caller wants to edit EAB constraints; use update_acme_eab',
    beforeCall:
      'confirm status with the user; compromised is irreversible, compromises every bound account and revokes their certificates',
  },
  renew_acme_eab: {
    useWhen: 'caller lost the EAB MAC key or wants a new one',
    doNotUseWhen: 'caller wants a new EAB; use create_acme_eab',
    beforeCall:
      'confirm with the user: the previous MAC key stops working, and without eab_validity_duration the EAB has no expiry; give the one-time macKey and macKeyId to the user',
  },
  delete_acme_eab: {
    useWhen: 'caller explicitly wants to permanently remove an ACME EAB',
    doNotUseWhen: 'caller only wants to block it; use update_acme_eab_status',
    beforeCall: 'confirm expected_name with the user',
  },
  list_eab_policies: {
    useWhen: 'caller wants the ACME EAB policies or a policy name (2.11+)',
    doNotUseWhen: 'caller wants the EABs themselves; use search_acme_eabs',
  },
  get_eab_policy: {
    useWhen: 'caller has an EAB policy name and wants its constraints',
    doNotUseWhen: 'caller wants the EABs themselves; use search_acme_eabs',
  },
  create_eab_policy: {
    useWhen: 'caller explicitly wants a new ACME EAB policy and gave its name',
    doNotUseWhen: 'caller wants EAB credentials; use create_acme_eab',
  },
  update_eab_policy: {
    useWhen: 'caller wants to change the constraints of an EAB policy',
    doNotUseWhen: 'caller wants to change one EAB; use update_acme_eab',
    beforeCall: 'tell the user the change applies to every EAB on the policy',
  },
  delete_eab_policy: {
    useWhen: 'caller explicitly wants to permanently remove an EAB policy',
    doNotUseWhen: 'an EAB still references the policy',
    beforeCall: 'confirm expected_name with the user',
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
