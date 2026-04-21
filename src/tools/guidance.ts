export interface ToolGuidance {
  readonly useWhen: string;
  readonly doNotUseWhen: string;
  readonly beforeCall?: string;
}

const EXPLICIT_GUIDANCE: Record<string, ToolGuidance> = {
  whoami: {
    useWhen:
      'the user asks who they are, what teams they belong to, or what permissions they have on the connected Horizon instance.',
    doNotUseWhen:
      'the user is asking about Horizon product version or license details; use get_license_info for that instead.',
  },
  get_license_info: {
    useWhen:
      'the user needs the connected Horizon version, license status, or instance-level license details.',
    doNotUseWhen:
      'the user is asking about their own identity or permissions; use whoami instead.',
  },
  describe_query_fields: {
    useWhen:
      'you need to know which fields are valid for HCQL, HRQL, HEQL, or HDQL before writing or validating a query.',
    doNotUseWhen:
      'the user already provided a complete query string and wants syntax checking or execution.',
  },
  translate_to_hql: {
    useWhen:
      'the user describes a search in natural language and you need a first draft of HCQL, HRQL, HEQL, or HDQL.',
    doNotUseWhen:
      'the user already supplied Horizon query syntax and only needs validation or execution.',
    beforeCall:
      'Use validate_hcql, validate_hrql, validate_heql, or validate_hdql after translation when correctness matters.',
  },
  search_docs: {
    useWhen:
      'the user asks how to install, configure, or integrate Horizon or a companion product using official product documentation.',
    doNotUseWhen:
      'the user already has a page_id or is asking about Horizon REST endpoints, request payloads, or response schemas.',
    beforeCall:
      'Call get_doc_page with one of the returned page_id values instead of guessing a page ID.',
  },
  search_api_docs: {
    useWhen:
      'the user asks about Horizon REST endpoints, methods, request payloads, response schemas, or error codes.',
    doNotUseWhen:
      'the user is asking for installation or admin-guide content rather than API behavior.',
    beforeCall:
      'Call get_doc_page with a returned page_id to read the authoritative API page in full.',
  },
  get_doc_page: {
    useWhen:
      'you already have a page_id from search_docs or search_api_docs and need the full page content.',
    doNotUseWhen:
      'you have not searched yet or are guessing the page identifier.',
    beforeCall:
      'Search first, then fetch the selected page verbatim by page_id.',
  },
  simulate_computation_rule: {
    useWhen:
      'the user is drafting or debugging a computation rule or template string and wants to verify the output.',
    doNotUseWhen:
      'the user wants to save a profile change or persist a computation rule in Horizon.',
  },
  simulate_datasource_flow: {
    useWhen:
      'the user wants to validate a datasource flow design and inspect how datasource results chain together.',
    doNotUseWhen:
      'the user wants to create or update real datasource objects in Horizon.',
  },
  fetch_exposed_certificate: {
    useWhen:
      'the user wants the live certificate currently exposed by a host or service endpoint.',
    doNotUseWhen:
      'the user already has PEM, DER, CSR, OCSP, or CRL data to decode locally.',
  },
  detect_file: {
    useWhen:
      'the user has opaque PEM, DER, or binary data and needs to identify whether it is a certificate, CSR, CRL, key, or container.',
    doNotUseWhen:
      'the user already knows the input type and wants decoded fields from a specific artifact.',
  },
  decode_x509: {
    useWhen:
      'the user already has an X.509 certificate and wants the decoded fields.',
    doNotUseWhen: 'the data type is unknown or might not be a certificate.',
  },
  decode_csr: {
    useWhen:
      'the user already has a CSR and wants the decoded subject, SANs, or extensions.',
    doNotUseWhen: 'the data type is unknown or might not be a CSR.',
  },
  decode_crl: {
    useWhen:
      'the user already has a CRL and wants the decoded issuer, nextUpdate, or revoked entries.',
    doNotUseWhen: 'the data type is unknown or might not be a CRL.',
  },
  decode_ocsp: {
    useWhen:
      'the user already has an OCSP response and wants the decoded status details.',
    doNotUseWhen: 'the input type is not known yet.',
  },
  decode_tsa: {
    useWhen:
      'the user already has a timestamp token or TSA response and wants the decoded details.',
    doNotUseWhen: 'the input type is not known yet.',
  },
  convert_pkcs12_to_jks: {
    useWhen:
      'the user explicitly needs a Java keystore converted from an existing PKCS#12 bundle.',
    doNotUseWhen:
      'the user only needs certificate inspection or Horizon inventory data.',
  },
  list_credentials: {
    useWhen:
      'the user needs the names and types of reusable credentials to reference in connector or trigger configuration.',
    doNotUseWhen:
      'the user expects secret material to be revealed; this tool only exposes inventory, not secret values.',
  },
  create_rest_notification: {
    useWhen:
      'the user explicitly wants to create a REST notification trigger in Horizon.',
    doNotUseWhen:
      'the user only wants design guidance or schema examples without changing Horizon.',
    beforeCall:
      'Use list_credentials first if the notification needs an existing credential by name.',
  },
  simulate_trigger: {
    useWhen:
      'the user wants to dry-run a trigger payload or validate a REST notification definition without waiting for a real event.',
    doNotUseWhen:
      'the user wants to create, update, or delete the trigger itself.',
  },
  submit_request: {
    useWhen:
      'the user explicitly wants to submit a certificate lifecycle request and you already know the editable and mandatory template fields.',
    doNotUseWhen: 'the required request template has not been inspected yet.',
    beforeCall:
      'Call get_request_template first and ask for any missing mandatory fields before submitting.',
  },
  approve_request: {
    useWhen:
      'the user explicitly wants to approve a pending request and you already know the request ID.',
    doNotUseWhen:
      'the request ID is unknown or the user only wants to inspect pending requests.',
  },
  deny_request: {
    useWhen:
      'the user explicitly wants to deny a pending request and you already know the request ID.',
    doNotUseWhen:
      'the request ID is unknown or the user only wants to inspect pending requests.',
  },
  cancel_request: {
    useWhen:
      'the user explicitly wants to cancel a pending request and you already know the request ID.',
    doNotUseWhen:
      'the request ID is unknown or the user only wants to inspect requests.',
  },
};

function familyGuidance(name: string): ToolGuidance {
  if (name.startsWith('search_')) {
    return {
      useWhen:
        'the user wants to filter or inspect multiple matching objects with query criteria.',
      doNotUseWhen:
        'you already know the exact object identifier or the user explicitly asked for CSV export or aggregation.',
    };
  }

  if (name.startsWith('list_')) {
    return {
      useWhen:
        'the user wants a broad inventory of objects by type, optionally filtered by a simple name fragment.',
      doNotUseWhen:
        'the user needs query-language filtering, exact-object retrieval, or a destructive operation.',
    };
  }

  if (name.startsWith('get_')) {
    return {
      useWhen:
        'you already know the exact object ID, name, UUID, or page_id and need the full details for that single object.',
      doNotUseWhen:
        'the user is still searching or filtering across multiple objects.',
    };
  }

  if (name.startsWith('export_')) {
    return {
      useWhen:
        'the user explicitly wants CSV output or a bulk export instead of an interactive JSON response.',
      doNotUseWhen:
        'the user only needs a few records for inspection or analysis in chat.',
    };
  }

  if (name.startsWith('aggregate_')) {
    return {
      useWhen:
        'the user wants counts, grouping, or trend-style summaries rather than individual records.',
      doNotUseWhen: 'the user needs the raw matching objects themselves.',
    };
  }

  if (name.startsWith('create_')) {
    return {
      useWhen:
        'the user explicitly asked to create a new Horizon object or configuration item.',
      doNotUseWhen:
        'the user only wants guidance, simulation, or inspection without changing Horizon.',
    };
  }

  if (name.startsWith('update_')) {
    return {
      useWhen:
        'the user explicitly asked to modify an existing Horizon object and you already know which one.',
      doNotUseWhen:
        'the target object has not been identified yet or the user only wants to inspect current state.',
    };
  }

  if (name.startsWith('delete_')) {
    return {
      useWhen:
        'the user explicitly asked to delete an existing Horizon object and you already have the exact identifier.',
      doNotUseWhen:
        'the user has not confirmed the exact target or is only exploring current configuration.',
    };
  }

  if (name.startsWith('download_')) {
    return {
      useWhen:
        'the user needs the raw report, certificate, or file content rather than metadata.',
      doNotUseWhen: 'metadata or object details are sufficient.',
    };
  }

  if (name.startsWith('add_')) {
    return {
      useWhen:
        'the user wants to append a new element to an existing object, such as adding a chart to a dashboard.',
      doNotUseWhen:
        'the user wants to replace the whole object or remove an existing element.',
    };
  }

  if (name.startsWith('remove_')) {
    return {
      useWhen:
        'the user wants to remove one element from an existing composite object.',
      doNotUseWhen: 'the user wants to delete the entire parent object.',
    };
  }

  return {
    useWhen:
      'the user intent directly matches the action implied by this tool name and the required identifiers are already known.',
    doNotUseWhen:
      'a search, list, get, simulation, or documentation lookup tool would answer the question with less risk.',
  };
}

function getGuidance(name: string): ToolGuidance {
  return EXPLICIT_GUIDANCE[name] ?? familyGuidance(name);
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

  const guidance = getGuidance(name);
  let suffix =
    `\n\nUse when: ${guidance.useWhen}\n` +
    `Do not use when: ${guidance.doNotUseWhen}`;
  if (guidance.beforeCall) {
    suffix += `\nBefore calling: ${guidance.beforeCall}`;
  }

  return `${description.trimEnd()}${suffix}`;
}
