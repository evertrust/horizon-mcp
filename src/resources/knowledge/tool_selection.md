# Tool Selection Playbook

## Core Rule

Choose the narrowest tool that can answer the question without guessing.
Prefer search or list tools before mutate tools when the target object is not
fully identified.

## Querying Horizon Data

### Search vs Get vs Export vs Aggregate

- Use `search_*` when the user wants matching records and a conversational JSON response.
- Use `get_*` when the exact name, ID, UUID, or `page_id` is already known.
- Use `export_*_csv` only when the user explicitly wants CSV or bulk extraction.
- Use `aggregate_*` for counts, grouping, thresholds, and dashboard-style summaries.

### Horizon Query Languages

1. Use `translate_to_hql` when the user starts in natural language. It drafts HCQL, HRQL, HEQL, and HDQL only. For HAQL and HEABQL, write the query from the field list, then validate it.
2. Use `validate_hcql`, `validate_hrql`, `validate_heql`, or `validate_hdql` when the query must be checked before execution. For HAQL (ACME accounts) and HEABQL (EABs) on Horizon 2.11+, use `validate_hql` with `dialect` `haql` or `heabql`.
3. Use `describe_query_fields` when the user asks which fields are available or when field names are unclear (it also covers `haql` and `heabql` on Horizon 2.11+).
4. Execute with the matching `search_*` or `aggregate_*` tool after the query is ready.

### Ownership and Permissions

- Use `whoami` before answering "my certificates", "my requests", or permission questions.
- Build ownership queries with `identity.identifier` and the `teams` list. Do not assume direct ownership alone is enough.

## Documentation Lookup

### Product Docs

1. Call `search_docs` first.
2. Pick a returned `page_id`.
3. Call `get_doc_page`.

Do not guess `page_id` values.

### API Docs

1. Call `search_api_docs` first for endpoint, payload, or response questions.
2. Fetch the chosen page with `get_doc_page`.

For Horizon docs and Horizon API docs, trust the tool's resolved version and warnings.

## Lifecycle Requests

1. Call `get_request_template` before `submit_request`.
2. Collect every mandatory field from the template.
3. Submit only after the target profile and workflow are clear.

Use `approve_request`, `deny_request`, and `cancel_request` only when the exact
request ID is known.

WebRA challenge profiles (Horizon 2.11+): an `enroll` request returns the
challenge in its `password` field; `submit_webra_challenge` consumes it and
returns the certificate (and, in centralized mode, the only copy of the
PKCS#12).

## ACME (Horizon 2.11+)

Check the version with `get_license_info` first. Read
`horizon://knowledge/acme` for the object model.

- Accounts: `search_acme_accounts` (HAQL), `get_acme_account`,
  `update_acme_account_status`, `delete_acme_account`.
- Orders of an account: `list_acme_orders`, `get_acme_order`.
- EABs: `search_acme_eabs` (HEABQL), `get_acme_eab`, `create_acme_eab`,
  `update_acme_eab`, `update_acme_eab_status`, `renew_acme_eab`,
  `delete_acme_eab`. `create_acme_eab` and `renew_acme_eab` return the MAC
  key once: give it to the user immediately.
- EAB policies: `list_eab_policies`, `get_eab_policy`, `create_eab_policy`,
  `update_eab_policy`, `delete_eab_policy`.
- ACME profile options (`excludeRootCA`, `ipIdentifierConstraint`): use the
  certificate profile tools.

## Datasources and Rules

- Use `simulate_datasource_flow` to design or debug a flow without persisting configuration.
- Use `simulate_computation_rule` to debug expressions or template strings.
- Use datasource create/update tools only when the user explicitly wants configuration changes.
- Use `test_datasource` after creating or updating a datasource when the user wants live verification.

## Certificates on Live Services

- Use `fetch_exposed_certificate` when the question is about the certificate currently deployed on a host or port.
- Use `decode_x509` only after you already have certificate bytes or PEM.

## Integration Recipes

- `horizon://knowledge/adcs-integration`
- `horizon://knowledge/digicert-integration`
- `horizon://knowledge/intune-integration`

Use these recipe resources when the user wants end-to-end configuration guidance
instead of a single API answer.
