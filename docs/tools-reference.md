# Tool reference

211 tools across 12 domains (incl. 126 Configuration CRUD tools). Safety tiers:

- **read-only**  -  no side effects
- **mutating-safe**  -  creates or modifies data, safe to retry
- **mutating-destructive**  -  deletes data or changes active behavior; requires confirmation

## Delete safety

All `delete_*` and `flush_*` tools require an `expected_name` (or `expected_identifier`) parameter that must exactly match the object's name. This forces the LLM to confirm what it intends to delete and prevents accidental destructive operations.

---

## Assist (21 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `whoami` | read-only | Current principal identity and permissions |
| `get_license_info` | read-only | Horizon license details, quotas, feature flags |
| `explain_grading_policy` | read-only | Explain policy; optionally explain a certificate against it |
| `explain_grading_ruleset` | read-only | Explain ruleset; optionally explain a certificate against it |
| `validate_hql` | read-only | Validate any Horizon search query by dialect (hcql/hrql/heql/hdql); canonical tool, the four validate_h*ql entries are thin aliases |
| `validate_hcql` | read-only | Validate a certificate search query |
| `validate_hrql` | read-only | Validate a request search query |
| `validate_heql` | read-only | Validate an event search query |
| `validate_hdql` | read-only | Validate a discovery event search query |
| `describe_query_fields` | read-only | List available fields and syntax for a query language |
| `translate_to_hql` | read-only | Translate natural language to an HQL query expression |
| `decode_x509` | read-only | Decode a PEM X.509 certificate |
| `decode_csr` | read-only | Decode a PEM PKCS#10 CSR |
| `detect_file` | read-only | Auto-detect and parse a cryptographic file (PEM, DER, PKCS#7, CRL, OCSP, TSA) |
| `fetch_exposed_certificate` | read-only | Fetch the TLS certificate from a remote server |
| `decode_crl` | read-only | Decode a PEM/DER CRL |
| `decode_ocsp` | read-only | Decode an OCSP response (RFC 6960) |
| `decode_tsa` | read-only | Decode a timestamping response (RFC 3161) |
| `simulate_computation_rule` | read-only | Test a computation rule template against a dictionary |
| `simulate_datasource_flow` | read-only | Test a datasource flow pipeline and translate MCP input to Horizon dsFlow payloads |
| `convert_pkcs12_to_jks` | read-only | Convert PKCS#12 to JKS keystore |

## Docs (3 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `search_docs` | read-only | Search official product documentation; use this first, then `get_doc_page` |
| `search_api_docs` | read-only | Search official Horizon API reference pages; use this first, then `get_doc_page` |
| `get_doc_page` | read-only | Fetch the full indexed content for a page returned by a docs-search tool |

## Lifecycle (17 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `search_certificates` | read-only | Search via HCQL with presets and pagination |
| `export_certificates_csv` | read-only | Export certificates to CSV (max 1000 rows) |
| `get_certificate` | read-only | Get full certificate details by ID |
| `download_certificate` | read-only | Download PEM certificate content; use `get_request` on the enrollment request for PKCS#12 retrieval |
| `aggregate_certificates` | read-only | Aggregate certificate counts by field |
| `search_requests` | read-only | Search requests via HRQL |
| `export_requests_csv` | read-only | Export requests to CSV |
| `get_request` | read-only | Get request details by ID |
| `aggregate_requests` | read-only | Aggregate request counts by field |
| `search_events` | read-only | Search audit events via HEQL |
| `get_event` | read-only | Get audit event details by ID |
| `export_events_csv` | read-only | Export audit events to a compact CSV via paged search (max 1000 rows, default core columns + optional `detail.*` fields) |
| `get_request_template` | read-only | Get request template for a workflow |
| `submit_request` | mutating-safe | Submit a lifecycle request (enroll, renew, revoke, ...) |
| `approve_request` | mutating-safe | Approve a pending request |
| `deny_request` | mutating-safe | Deny a pending request |
| `cancel_request` | mutating-safe | Cancel a pending request |

## Dashboards (12 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_dashboards` | read-only | List personal dashboards with optional filtering |
| `get_dashboard` | read-only | Get a dashboard and its charts by name |
| `create_dashboard` | mutating-safe | Create a new personal dashboard |
| `update_dashboard` | mutating-safe | Update dashboard metadata or replace its chart list |
| `delete_dashboard` | mutating-destructive | Delete a dashboard (requires name confirmation) |
| `add_dashboard_chart` | mutating-safe | Add a chart to an existing dashboard |
| `update_dashboard_chart` | mutating-safe | Update a single chart within a dashboard |
| `remove_dashboard_chart` | mutating-safe | Remove a chart from a dashboard |
| `list_saved_queries` | read-only | List saved HQL queries |
| `get_saved_query` | read-only | Get a saved query by name |
| `upsert_saved_query` | mutating-safe | Create or update a saved HQL query |
| `delete_saved_query` | mutating-destructive | Delete a saved query (requires name confirmation) |

## Discovery (6 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_discovery_campaigns` | read-only | List campaigns with optional name filter |
| `get_discovery_campaign` | read-only | Get a campaign by name |
| `create_discovery_campaign` | mutating-safe | Create a campaign with hosts, ports, and grading policies |
| `update_discovery_campaign` | mutating-safe | Update campaign settings |
| `delete_discovery_campaign` | mutating-destructive | Delete a campaign (requires name confirmation) |
| `flush_discovery_campaign` | mutating-destructive | Purge all events from a campaign (requires confirmation) |

## Discovery Events (3 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `search_discovery_events` | read-only | Search discovery events via HDQL |
| `get_discovery_event` | read-only | Get a discovery event by ID |
| `export_discovery_events_csv` | read-only | Export discovery events to CSV |

## Discovery Feed (4 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `start_discovery_feed_session` | mutating-safe | Open a feed session for a campaign |
| `feed_discovery_certificate` | mutating-safe | Push a certificate with host discovery data into an active feed session |
| `register_discovery_event` | mutating-safe | Register a discovery event for a feed session |
| `end_discovery_feed_session` | mutating-safe | Close a feed session and commit results |

## Reports (3 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_reports` | read-only | List reports with optional name filter and expiry toggle |
| `download_report` | read-only | Fetch raw CSV content by report UUID |
| `delete_report` | mutating-destructive | Delete a report (requires UUID confirmation) |

## Profiles (2 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_profiles` | read-only | List profiles with optional name and module filter |
| `get_profile` | read-only | Get full profile details by name |

## Datasources (8 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_datasources` | read-only | List datasources with optional type and name filtering |
| `get_datasource` | read-only | Get a datasource configuration by name |
| `create_dns_datasource` | mutating-safe | Create a DNS datasource for hostname/record lookups |
| `create_ldap_datasource` | mutating-safe | Create an LDAP datasource for directory lookups |
| `create_rest_datasource` | mutating-safe | Create a REST datasource for HTTP API lookups |
| `update_datasource` | mutating-safe | Update datasource configuration (GET-strip-merge-PUT) |
| `delete_datasource` | mutating-destructive | Delete a datasource (requires name confirmation) |
| `test_datasource` | read-only | Test a datasource config against a context dictionary |

## Triggers & Credentials (6 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_credentials` | read-only | List stored credentials (names/types only, secrets never exposed) |
| `list_triggers` | read-only | List triggers with optional type and name filtering |
| `get_trigger` | read-only | Get a trigger configuration by name |
| `create_rest_notification` | mutating-safe | Create a REST notification with multi-step sequences |
| `delete_trigger` | mutating-destructive | Delete a trigger (requires name confirmation) |
| `simulate_trigger` | read-only | Test-fire a trigger without real certificate context |

---

## Configuration (126 tools)

Source-grounded CRUD over Horizon configuration objects (see `docs/audit/` for
the per-object contracts). Every family has read tools (`list_*`, `get_*`);
mutating families add `create_*`/`update_*`/`delete_*`. Mandatory fields are
required parameters; `delete_*` needs an `expected_<id>` echo; update is
GET-strip-merge-PUT (omitted optional fields preserved). Polymorphic objects add
a `describe_<obj>_schema` read tool that must be called before create/update.

### Configuration: Certificate & PKI (31 tools)

| Object | Tools | Safety |
|--------|-------|--------|
| Certificate authorities | `list_cas` `get_ca` `create_ca` `update_ca` `delete_ca` | read-only + mutating |
| Certificate profiles (11 protocol subtypes) | `describe_certificate_profile_schema` `list/get/create/update/delete_certificate_profile` | read-only + mutating |
| Certificate labels | `list/get/create/update/delete_certificate_label` | read-only + mutating |
| Certificate grading policies | `list_certificate_grading_policies` `get_certificate_grading_policy` | read-only (no write API) |
| Certificate grading rulesets | `list_certificate_grading_rulesets` `get_certificate_grading_ruleset` | read-only (no write API) |
| PKI connectors (21 subtypes) | `describe_pki_connector_schema` `list/get/create/update/delete_pki_connector` | read-only + mutating |
| PKI queues | `list/get/create/update/delete_pki_queue` | read-only + mutating |

### Configuration: RBAC (22 tools)

| Object | Tools | Safety |
|--------|-------|--------|
| Roles | `list/get/create/update/delete_role`, `list/add/remove_role_members` | read-only + mutating (privilege grant) |
| Teams | `list/get/create/update/delete_team`, `list/add/remove_team_members`, `switch_team` | read-only + mutating (`switch_team` destructive) |
| Password policies | `list/get/create/update/delete_password_policy` | read-only + mutating |

### Configuration: Automation & integrations (29 tools)

| Object | Tools | Safety |
|--------|-------|--------|
| Automation policies | `list/get/create/update/delete_automation_policy` | read-only + mutating |
| Execution policies | `list/get/create/update/delete_execution_policy` | read-only + mutating |
| Third-party connectors (subtyped) | `describe_thirdparty_connector_schema` `list/get/create/update/delete_thirdparty_connector` | read-only + mutating |
| HTTP proxies | `list/get/create/update/delete_http_proxy` | read-only + mutating |
| WCCE forest mappings | `list/get/create/update/delete_wcce_forest` | read-only + mutating |
| Triggers (CRUD gap-fill, 11 subtypes) | `describe_trigger_schema` `create_trigger` `update_trigger` | read-only + mutating (list/get/delete in Triggers domain above) |

### Configuration: System & operations (20 tools)

| Object | Tools | Safety |
|--------|-------|--------|
| Storage backends (S3) | `list/get/create/update/delete_storage` | read-only + mutating |
| System configuration (4 singleton types) | `describe_system_config_schema` `list_system_configs` `get_system_config` `update_system_config` | read-only + mutating (no create/delete) |
| Scheduled tasks (report / thirdparty) | `describe_scheduled_task_schema` `list/get/create/update/delete_scheduled_task` | read-only + mutating |
| Archives (certificate / event) | `describe_archive_schema` `list/get/create/delete_archive` | read-only + mutating (no update) |
| Terms of Service (2.10 enrollment acceptance) | `list/get/create/update/delete_terms_of_service` | read-only + mutating |

### Configuration: DCV automation (15 tools, Horizon 2.10)

Domain Control Validation automation: a DCV policy binds a provider + provisioner
and renews domain validation on a schedule.

| Object | Tools | Safety |
|--------|-------|--------|
| DCV policies | `list/get/create/update/delete_dcv_policy` | read-only + mutating |
| DCV providers (digicert) | `list/get/create/update/delete_dcv_provider` | read-only + mutating |
| DCV provisioners (cloudflare/powerdns/efficientip/azuredns/route53) | `list/get/create/update/delete_dcv_provisioner` | read-only + mutating (per-type required fields) |

### Configuration: Identity & access (READ-ONLY, 4 tools)

Deliberately read-only: this identity/access surface is inspectable but never
mutable via the MCP server.

| Object | Tools | Safety |
|--------|-------|--------|
| Service accounts (incl. 2.10 JWKS trustConfig) | `list_service_accounts` `get_service_account` | read-only (no write tools) |
| Identity providers (OIDC group-claim / JIT) | `list_identity_providers` `get_identity_provider` | read-only (no write tools) |
