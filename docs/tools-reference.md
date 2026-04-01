# Tool reference

74 tools in 9 domains. Safety tiers:

- **read-only**  -  no side effects
- **mutating-safe**  -  creates or modifies data, safe to retry
- **mutating-destructive**  -  deletes data or changes active behavior; requires confirmation

## Delete safety

All `delete_*` and `flush_*` tools require an `expected_name` (or `expected_identifier`) parameter that must exactly match the object's name. This forces the LLM to confirm what it intends to delete and prevents accidental destructive operations.

---

## Assist (19 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `whoami` | read-only | Current principal identity and permissions |
| `get_license_info` | read-only | Horizon license details, quotas, feature flags |
| `explain_grading_policy` | read-only | Explain policy; optionally evaluate a certificate |
| `explain_grading_ruleset` | read-only | Explain ruleset; optionally evaluate a certificate |
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
| `simulate_datasource_flow` | read-only | Test a datasource flow pipeline against sample context |

## Lifecycle (17 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `search_certificates` | read-only | Search via HCQL with presets and pagination |
| `export_certificates_csv` | read-only | Export certificates to CSV (max 1000 rows) |
| `get_certificate` | read-only | Get full certificate details by ID |
| `download_certificate` | read-only | Download in PEM / DER / PKCS7 / PKCS12 / JKS |
| `aggregate_certificates` | read-only | Aggregate certificate counts by field |
| `search_requests` | read-only | Search requests via HRQL |
| `export_requests_csv` | read-only | Export requests to CSV |
| `get_request` | read-only | Get request details by ID |
| `aggregate_requests` | read-only | Aggregate request counts by field |
| `search_events` | read-only | Search audit events via HEQL |
| `get_event` | read-only | Get audit event details by ID |
| `export_events_csv` | read-only | Export audit events to CSV |
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
