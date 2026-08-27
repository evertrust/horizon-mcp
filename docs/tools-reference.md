# Tool reference

The server has 222 tools in 12 domains, and 129 of them are configuration CRUD tools. Every tool has one safety tier:

- **read-only** - the tool has no side effects.
- **mutating-safe** - the tool creates or changes data, but the server does not classify the tool as destructive. A mutating-safe tool can still be non-idempotent, so do not retry it blindly.
- **mutating-destructive** - the tool deletes data, removes access, or changes active behavior. Read the arguments before you call it. Set approval controls in the MCP client.

## Delete safety

Every `delete_*` and `flush_*` tool needs an `expected_name` parameter, or an object-specific `expected_<identifier>` parameter. The value must match the target exactly. This echo is a safety check inside the tool, not an interactive prompt.

Other destructive tools do not all carry an echo, and they run as soon as the MCP client calls them. Set an approval policy in the MCP client for those tools too.

---

## Assist (21 tools)

| Tool                        | Safety    | Description                                                                                                                                                                         |
| --------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whoami`                    | read-only | Current principal identity and permissions                                                                                                                                          |
| `get_license_info`          | read-only | Horizon license details, quotas, feature flags                                                                                                                                      |
| `explain_grading_policy`    | read-only | Explain policy; optionally explain a certificate against it                                                                                                                         |
| `explain_grading_ruleset`   | read-only | Explain ruleset; optionally explain a certificate against it                                                                                                                        |
| `validate_hql`              | read-only | Validate any Horizon search query by dialect (`hcql`, `hrql`, `heql`, or `hdql`). This is the canonical tool. The four `validate_h*ql` tools are aliases that use the same handler. |
| `validate_hcql`             | read-only | Validate a certificate search query                                                                                                                                                 |
| `validate_hrql`             | read-only | Validate a request search query                                                                                                                                                     |
| `validate_heql`             | read-only | Validate an event search query                                                                                                                                                      |
| `validate_hdql`             | read-only | Validate a discovery event search query                                                                                                                                             |
| `describe_query_fields`     | read-only | List available fields and syntax for a query language                                                                                                                               |
| `translate_to_hql`          | read-only | Translate natural language to an HQL query expression                                                                                                                               |
| `decode_x509`               | read-only | Decode a PEM X.509 certificate                                                                                                                                                      |
| `decode_csr`                | read-only | Decode a PEM PKCS#10 CSR                                                                                                                                                            |
| `detect_file`               | read-only | Auto-detect and parse a cryptographic file (PEM, DER, PKCS#7, CRL, OCSP, TSA)                                                                                                       |
| `fetch_exposed_certificate` | read-only | Fetch the TLS certificate from a remote server                                                                                                                                      |
| `decode_crl`                | read-only | Decode a PEM/DER CRL                                                                                                                                                                |
| `decode_ocsp`               | read-only | Decode an OCSP response (RFC 6960)                                                                                                                                                  |
| `decode_tsa`                | read-only | Decode a timestamping response (RFC 3161)                                                                                                                                           |
| `simulate_computation_rule` | read-only | Test a computation rule template against a dictionary                                                                                                                               |
| `simulate_datasource_flow`  | read-only | Test a datasource flow pipeline and translate MCP input to Horizon dsFlow payloads                                                                                                  |
| `convert_pkcs12_to_jks`     | read-only | Convert PKCS#12 to JKS keystore                                                                                                                                                     |

## Docs (4 tools)

| Tool              | Safety    | Description                                                                                                               |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `search_docs`     | read-only | Search official product documentation; use this first, then `get_doc_page`                                                |
| `search_api_docs` | read-only | Search official Horizon API reference pages; use this first, then `get_doc_page`                                          |
| `get_doc_page`    | read-only | Fetch the indexed content of a page that a docs search tool returned. Use `max_chars` and `offset` to read it in windows. |
| `read_knowledge`  | read-only | Read an embedded `horizon://knowledge/*` topic as a tool, for clients without MCP resource support                        |

## Lifecycle (24 tools)

| Tool                         | Safety               | Description                                                                                                                              |
| ---------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `search_certificates`        | read-only            | Search via HCQL with presets and pagination                                                                                              |
| `export_certificates_csv`    | read-only            | Export certificates to CSV (max 1000 rows)                                                                                               |
| `get_certificate`            | read-only            | Get full certificate details by ID                                                                                                       |
| `download_certificate`       | read-only            | Download the PEM certificate content. To get a PKCS#12, call `get_request` on the enrollment request.                                    |
| `aggregate_certificates`     | read-only            | Aggregate certificate counts by field                                                                                                    |
| `set_certificate_auto_renew` | mutating-safe        | Set WebRA automatic renewal for one certificate when its profile allows edits                                                            |
| `search_requests`            | read-only            | Search requests via HRQL                                                                                                                 |
| `export_requests_csv`        | read-only            | Export requests to CSV                                                                                                                   |
| `get_request`                | read-only            | Get request details by ID                                                                                                                |
| `aggregate_requests`         | read-only            | Aggregate request counts by field                                                                                                        |
| `search_events`              | read-only            | Search audit events via HEQL                                                                                                             |
| `get_event`                  | read-only            | Get audit event details by ID                                                                                                            |
| `export_events_csv`          | read-only            | Export audit events to a compact CSV with a paged search (max 1000 rows, core columns by default, optional `detail.*` fields)            |
| `get_request_template`       | read-only            | Get request template for a workflow                                                                                                      |
| `submit_request`             | mutating-destructive | Submit a lifecycle request (enroll, renew, revoke and so on). It is destructive because it can revoke a certificate or change its state. |
| `approve_request`            | mutating-safe        | Approve a pending request                                                                                                                |
| `deny_request`               | mutating-destructive | Deny a pending request                                                                                                                   |
| `cancel_request`             | mutating-destructive | Cancel a pending request                                                                                                                 |
| `list_dcv_policy_status`     | read-only            | List DCV policy lifecycle status                                                                                                         |
| `get_dcv_policy_status`      | read-only            | Get full DCV policy and domain status                                                                                                    |
| `run_dcv_policy`             | mutating-safe        | Start DCV for every eligible policy domain                                                                                               |
| `run_dcv_domain`             | mutating-safe        | Start DCV for one policy domain                                                                                                          |
| `cancel_dcv_run`             | mutating-destructive | Cancel the whole active DCV policy run                                                                                                   |
| `list_dcv_events`            | read-only            | List policy or domain DCV lifecycle events                                                                                               |

## Dashboards (12 tools)

| Tool                     | Safety               | Description                                         |
| ------------------------ | -------------------- | --------------------------------------------------- |
| `list_dashboards`        | read-only            | List personal dashboards with optional filtering    |
| `get_dashboard`          | read-only            | Get a dashboard and its charts by name              |
| `create_dashboard`       | mutating-safe        | Create a new personal dashboard                     |
| `update_dashboard`       | mutating-safe        | Update dashboard metadata or replace its chart list |
| `delete_dashboard`       | mutating-destructive | Delete a dashboard (requires name confirmation)     |
| `add_dashboard_chart`    | mutating-safe        | Add a chart to an existing dashboard                |
| `update_dashboard_chart` | mutating-safe        | Update a single chart within a dashboard            |
| `remove_dashboard_chart` | mutating-destructive | Remove a chart from a dashboard                     |
| `list_saved_queries`     | read-only            | List saved HQL queries                              |
| `get_saved_query`        | read-only            | Get a saved query by name                           |
| `upsert_saved_query`     | mutating-safe        | Create or update a saved HQL query                  |
| `delete_saved_query`     | mutating-destructive | Delete a saved query (requires name confirmation)   |

## Discovery (6 tools)

| Tool                        | Safety               | Description                                               |
| --------------------------- | -------------------- | --------------------------------------------------------- |
| `list_discovery_campaigns`  | read-only            | List campaigns with optional name filter                  |
| `get_discovery_campaign`    | read-only            | Get a campaign by name                                    |
| `create_discovery_campaign` | mutating-safe        | Create a campaign with hosts, ports, and grading policies |
| `update_discovery_campaign` | mutating-safe        | Update campaign settings                                  |
| `delete_discovery_campaign` | mutating-destructive | Delete a campaign (requires name confirmation)            |
| `flush_discovery_campaign`  | mutating-destructive | Purge all events from a campaign (requires confirmation)  |

## Discovery events (3 tools)

| Tool                          | Safety    | Description                      |
| ----------------------------- | --------- | -------------------------------- |
| `search_discovery_events`     | read-only | Search discovery events via HDQL |
| `get_discovery_event`         | read-only | Get a discovery event by ID      |
| `export_discovery_events_csv` | read-only | Export discovery events to CSV   |

## Discovery feed (4 tools)

| Tool                           | Safety        | Description                                                             |
| ------------------------------ | ------------- | ----------------------------------------------------------------------- |
| `start_discovery_feed_session` | mutating-safe | Open a feed session for a campaign                                      |
| `feed_discovery_certificate`   | mutating-safe | Push a certificate with host discovery data into an active feed session |
| `register_discovery_event`     | mutating-safe | Register a discovery event for a feed session                           |
| `end_discovery_feed_session`   | mutating-safe | Close a feed session and commit results                                 |

## Reports (3 tools)

| Tool              | Safety               | Description                                              |
| ----------------- | -------------------- | -------------------------------------------------------- |
| `list_reports`    | read-only            | List reports with optional name filter and expiry toggle |
| `download_report` | read-only            | Fetch raw CSV content by report UUID                     |
| `delete_report`   | mutating-destructive | Delete a report (requires UUID confirmation)             |

## Profiles (2 tools)

| Tool            | Safety    | Description                                        |
| --------------- | --------- | -------------------------------------------------- |
| `list_profiles` | read-only | List profiles with optional name and module filter |
| `get_profile`   | read-only | Get full profile details by name                   |

## Datasources (8 tools)

| Tool                     | Safety               | Description                                            |
| ------------------------ | -------------------- | ------------------------------------------------------ |
| `list_datasources`       | read-only            | List datasources with optional type and name filtering |
| `get_datasource`         | read-only            | Get a datasource configuration by name                 |
| `create_dns_datasource`  | mutating-safe        | Create a DNS datasource for hostname/record lookups    |
| `create_ldap_datasource` | mutating-safe        | Create an LDAP datasource for directory lookups        |
| `create_rest_datasource` | mutating-safe        | Create a REST datasource for HTTP API lookups          |
| `update_datasource`      | mutating-safe        | Update datasource configuration (GET-strip-merge-PUT)  |
| `delete_datasource`      | mutating-destructive | Delete a datasource (requires name confirmation)       |
| `test_datasource`        | read-only            | Test a datasource config against a context dictionary  |

## Triggers (6 tools)

| Tool                       | Safety               | Description                                                       |
| -------------------------- | -------------------- | ----------------------------------------------------------------- |
| `list_credentials`         | read-only            | List stored credentials (names/types only, secrets never exposed) |
| `list_triggers`            | read-only            | List triggers with optional type and name filtering               |
| `get_trigger`              | read-only            | Get a trigger configuration by name                               |
| `create_rest_notification` | mutating-safe        | Create a REST notification with multi-step sequences              |
| `delete_trigger`           | mutating-destructive | Delete a trigger (requires name confirmation)                     |
| `simulate_trigger`         | read-only            | Test-fire a trigger without real certificate context              |

---

## Configuration (129 tools)

These tools do CRUD on Horizon configuration objects. Every tool contract comes
from the Horizon source, not from inference.

Every object family has the read tools `list_*` and `get_*`. A family that
supports mutation adds `create_*`, `update_*` and `delete_*`. Mandatory Horizon
fields become required parameters, and every `delete_*` tool needs an
`expected_<id>` echo.

An update follows the GET-strip-merge-PUT pattern: the merge keeps every stored
field that the call does not mention, and `clear_fields` resets a field. A
polymorphic object adds a `describe_<obj>_schema` read tool. Call that tool
before you create or update the object.

### Configuration: certificate and PKI (31 tools)

| Object                                      | Tools                                                                                     | Safety                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------ |
| Certificate authorities                     | `list_cas` `get_ca` `create_ca` `update_ca` `delete_ca`                                   | read-only + mutating     |
| Certificate profiles (11 protocol subtypes) | `describe_certificate_profile_schema` `list/get/create/update/delete_certificate_profile` | read-only + mutating     |
| Certificate labels                          | `list/get/create/update/delete_certificate_label`                                         | read-only + mutating     |
| Certificate grading policies                | `list_certificate_grading_policies` `get_certificate_grading_policy`                      | read-only (no write API) |
| Certificate grading rulesets                | `list_certificate_grading_rulesets` `get_certificate_grading_ruleset`                     | read-only (no write API) |
| PKI connectors (22 subtypes)                | `describe_pki_connector_schema` `list/get/create/update/delete_pki_connector`             | read-only + mutating     |
| PKI queues                                  | `list/get/create/update/delete_pki_queue`                                                 | read-only + mutating     |

### Configuration: RBAC (22 tools)

| Object            | Tools                                                                               | Safety                                           |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| Roles             | `list/get/create/update/delete_role`, `list/add/remove_role_members`                | read-only + mutating (privilege grant)           |
| Teams             | `list/get/create/update/delete_team`, `list/add/remove_team_members`, `switch_team` | read-only + mutating (`switch_team` destructive) |
| Password policies | `list/get/create/update/delete_password_policy`                                     | read-only + mutating                             |

### Configuration: automation and integrations (29 tools)

| Object                                | Tools                                                                                       | Safety                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Automation policies                   | `list/get/create/update/delete_automation_policy`                                           | read-only + mutating                                            |
| Execution policies                    | `list/get/create/update/delete_execution_policy`                                            | read-only + mutating                                            |
| Third-party connectors (subtyped)     | `describe_thirdparty_connector_schema` `list/get/create/update/delete_thirdparty_connector` | read-only + mutating                                            |
| HTTP proxies                          | `list/get/create/update/delete_http_proxy`                                                  | read-only + mutating                                            |
| WCCE forest mappings                  | `list/get/create/update/delete_wcce_forest`                                                 | read-only + mutating                                            |
| Triggers (CRUD gap-fill, 11 subtypes) | `describe_trigger_schema` `create_trigger` `update_trigger`                                 | read-only + mutating (list/get/delete in Triggers domain above) |

### Configuration: system and operations (25 tools)

| Object                                        | Tools                                                                                            | Safety                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Storage backends (S3)                         | `list/get/create/update/delete_storage`                                                          | read-only + mutating                    |
| System configuration (4 singleton types)      | `describe_system_config_schema` `list_system_configs` `get_system_config` `update_system_config` | read-only + mutating (no create/delete) |
| Scheduled tasks (report / thirdparty)         | `describe_scheduled_task_schema` `list/get/create/update/delete_scheduled_task`                  | read-only + mutating                    |
| Archives (certificate / event)                | `describe_archive_schema` `list/get/create/delete_archive`                                       | read-only + mutating (no update)        |
| Terms of Service (2.10 enrollment acceptance) | `list/get/create/update/delete_terms_of_service`                                                 | read-only + mutating                    |

### Configuration: DCV automation (15 tools, Horizon 2.10)

DCV is Domain Control Validation. A DCV policy binds a provider and a
provisioner, then renews the domain validation on a schedule.

| Object                                                              | Tools                                           | Safety                                          |
| ------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| DCV policies                                                        | `list/get/create/update/delete_dcv_policy`      | read-only + mutating                            |
| DCV providers (digicert/gs_mssl)                                    | `list/get/create/update/delete_dcv_provider`    | read-only + mutating                            |
| DCV provisioners (cloudflare/powerdns/efficientip/azuredns/route53) | `list/get/create/update/delete_dcv_provisioner` | read-only + mutating (per-type required fields) |

### Configuration: identity and access (7 tools)

The identity provider tools are read-only. The service account tools do full
CRUD for a caller that has `access-management:service-account:*`. The `list` and
`get` service account tools also work with audit access.

| Object                                         | Tools                                             | Safety                     |
| ---------------------------------------------- | ------------------------------------------------- | -------------------------- |
| Service accounts (incl. 2.10 JWKS trustConfig) | `list/get/create/update/delete_service_account`   | read-only + mutating       |
| Identity providers (OIDC group-claim / JIT)    | `list_identity_providers` `get_identity_provider` | read-only (no write tools) |

### Complete configuration tool index

The family tables above show which objects the tools cover and how the subtypes
behave. The table below lists every configuration tool one by one. The safety
values in the table match the annotations that MCP `tools/list` returns.

| Tool                                   | Safety               | Description                                             |
| -------------------------------------- | -------------------- | ------------------------------------------------------- |
| `list_cas`                             | read-only            | List certificate authorities                            |
| `get_ca`                               | read-only            | Get a certificate authority                             |
| `create_ca`                            | mutating-safe        | Create a certificate authority                          |
| `update_ca`                            | mutating-destructive | Update a certificate authority                          |
| `delete_ca`                            | mutating-destructive | Delete a certificate authority                          |
| `describe_certificate_profile_schema`  | read-only            | Describe the schema for a certificate-profile subtype   |
| `list_certificate_profiles`            | read-only            | List certificate profiles                               |
| `get_certificate_profile`              | read-only            | Get a certificate profile                               |
| `create_certificate_profile`           | mutating-safe        | Create a certificate profile                            |
| `update_certificate_profile`           | mutating-destructive | Update a certificate profile                            |
| `delete_certificate_profile`           | mutating-destructive | Delete a certificate profile                            |
| `list_certificate_labels`              | read-only            | List certificate labels                                 |
| `get_certificate_label`                | read-only            | Get a certificate label                                 |
| `create_certificate_label`             | mutating-safe        | Create a certificate label                              |
| `update_certificate_label`             | mutating-destructive | Update a certificate label                              |
| `delete_certificate_label`             | mutating-destructive | Delete a certificate label                              |
| `list_certificate_grading_policies`    | read-only            | List certificate grading policies                       |
| `get_certificate_grading_policy`       | read-only            | Get a certificate grading policy                        |
| `list_certificate_grading_rulesets`    | read-only            | List certificate grading rulesets                       |
| `get_certificate_grading_ruleset`      | read-only            | Get a certificate grading ruleset                       |
| `describe_pki_connector_schema`        | read-only            | Describe the schema for a PKI-connector subtype         |
| `list_pki_connectors`                  | read-only            | List PKI connectors                                     |
| `get_pki_connector`                    | read-only            | Get a PKI connector                                     |
| `create_pki_connector`                 | mutating-safe        | Create a PKI connector                                  |
| `update_pki_connector`                 | mutating-destructive | Update a PKI connector                                  |
| `delete_pki_connector`                 | mutating-destructive | Delete a PKI connector                                  |
| `list_pki_queues`                      | read-only            | List PKI queues                                         |
| `get_pki_queue`                        | read-only            | Get a PKI queue                                         |
| `create_pki_queue`                     | mutating-safe        | Create a PKI queue                                      |
| `update_pki_queue`                     | mutating-destructive | Update a PKI queue                                      |
| `delete_pki_queue`                     | mutating-destructive | Delete a PKI queue                                      |
| `list_roles`                           | read-only            | List roles                                              |
| `get_role`                             | read-only            | Get a role                                              |
| `create_role`                          | mutating-safe        | Create a role                                           |
| `update_role`                          | mutating-destructive | Update a role and its privileges                        |
| `delete_role`                          | mutating-destructive | Delete a role                                           |
| `list_role_members`                    | read-only            | List members assigned to a role                         |
| `add_role_members`                     | mutating-safe        | Add members to a role                                   |
| `remove_role_members`                  | mutating-destructive | Remove members from a role                              |
| `list_teams`                           | read-only            | List teams                                              |
| `get_team`                             | read-only            | Get a team                                              |
| `create_team`                          | mutating-safe        | Create a team                                           |
| `update_team`                          | mutating-destructive | Update a team                                           |
| `delete_team`                          | mutating-destructive | Delete a team                                           |
| `list_team_members`                    | read-only            | List members assigned to a team                         |
| `add_team_members`                     | mutating-safe        | Add members to a team                                   |
| `remove_team_members`                  | mutating-destructive | Remove members from a team                              |
| `switch_team`                          | mutating-destructive | Switch the active Horizon team context                  |
| `list_password_policies`               | read-only            | List password policies                                  |
| `get_password_policy`                  | read-only            | Get a password policy                                   |
| `create_password_policy`               | mutating-safe        | Create a password policy                                |
| `update_password_policy`               | mutating-destructive | Update a password policy                                |
| `delete_password_policy`               | mutating-destructive | Delete a password policy                                |
| `list_automation_policies`             | read-only            | List automation policies                                |
| `get_automation_policy`                | read-only            | Get an automation policy                                |
| `create_automation_policy`             | mutating-safe        | Create an automation policy                             |
| `update_automation_policy`             | mutating-destructive | Update an automation policy                             |
| `delete_automation_policy`             | mutating-destructive | Delete an automation policy                             |
| `list_execution_policies`              | read-only            | List execution policies                                 |
| `get_execution_policy`                 | read-only            | Get an execution policy                                 |
| `create_execution_policy`              | mutating-safe        | Create an execution policy                              |
| `update_execution_policy`              | mutating-destructive | Update an execution policy                              |
| `delete_execution_policy`              | mutating-destructive | Delete an execution policy                              |
| `list_thirdparty_connectors`           | read-only            | List third-party connectors                             |
| `get_thirdparty_connector`             | read-only            | Get a third-party connector                             |
| `describe_thirdparty_connector_schema` | read-only            | Describe the schema for a third-party connector subtype |
| `create_thirdparty_connector`          | mutating-safe        | Create a third-party connector                          |
| `update_thirdparty_connector`          | mutating-safe        | Update a third-party connector                          |
| `delete_thirdparty_connector`          | mutating-destructive | Delete a third-party connector                          |
| `describe_trigger_schema`              | read-only            | Describe the schema for a trigger subtype               |
| `create_trigger`                       | mutating-safe        | Create a trigger                                        |
| `update_trigger`                       | mutating-destructive | Update a trigger                                        |
| `list_http_proxies`                    | read-only            | List HTTP proxies                                       |
| `get_http_proxy`                       | read-only            | Get an HTTP proxy                                       |
| `create_http_proxy`                    | mutating-safe        | Create an HTTP proxy                                    |
| `update_http_proxy`                    | mutating-destructive | Update an HTTP proxy                                    |
| `delete_http_proxy`                    | mutating-destructive | Delete an HTTP proxy                                    |
| `list_wcce_forests`                    | read-only            | List WCCE forest mappings                               |
| `get_wcce_forest`                      | read-only            | Get a WCCE forest mapping                               |
| `create_wcce_forest`                   | mutating-safe        | Create a WCCE forest mapping                            |
| `update_wcce_forest`                   | mutating-destructive | Update a WCCE forest mapping                            |
| `delete_wcce_forest`                   | mutating-destructive | Delete a WCCE forest mapping                            |
| `list_storages`                        | read-only            | List storage backends                                   |
| `get_storage`                          | read-only            | Get a storage backend                                   |
| `create_storage`                       | mutating-safe        | Create a storage backend                                |
| `update_storage`                       | mutating-destructive | Update a storage backend                                |
| `delete_storage`                       | mutating-destructive | Delete a storage backend                                |
| `describe_system_config_schema`        | read-only            | Describe a system-configuration subtype                 |
| `list_system_configs`                  | read-only            | List system-configuration objects                       |
| `get_system_config`                    | read-only            | Get a system-configuration object                       |
| `update_system_config`                 | mutating-destructive | Update a system-configuration singleton                 |
| `describe_scheduled_task_schema`       | read-only            | Describe the schema for a scheduled-task subtype        |
| `list_scheduled_tasks`                 | read-only            | List scheduled tasks                                    |
| `get_scheduled_task`                   | read-only            | Get a scheduled task                                    |
| `create_scheduled_task`                | mutating-safe        | Create a scheduled-task definition                      |
| `update_scheduled_task`                | mutating-destructive | Update a scheduled-task definition                      |
| `delete_scheduled_task`                | mutating-destructive | Delete a scheduled-task definition                      |
| `describe_archive_schema`              | read-only            | Describe the schema for an archive subtype              |
| `list_archives`                        | read-only            | List archives                                           |
| `get_archive`                          | read-only            | Get an archive                                          |
| `create_archive`                       | mutating-safe        | Create an archive definition                            |
| `delete_archive`                       | mutating-destructive | Delete an archive definition                            |
| `list_terms_of_services`               | read-only            | List Terms of Service objects                           |
| `get_terms_of_service`                 | read-only            | Get a Terms of Service object                           |
| `create_terms_of_service`              | mutating-safe        | Create a Terms of Service object                        |
| `update_terms_of_service`              | mutating-destructive | Update a Terms of Service object                        |
| `delete_terms_of_service`              | mutating-destructive | Delete a Terms of Service object                        |
| `list_dcv_providers`                   | read-only            | List DCV providers                                      |
| `get_dcv_provider`                     | read-only            | Get a DCV provider                                      |
| `create_dcv_provider`                  | mutating-safe        | Create a DCV provider                                   |
| `update_dcv_provider`                  | mutating-destructive | Update a DCV provider                                   |
| `delete_dcv_provider`                  | mutating-destructive | Delete a DCV provider                                   |
| `list_dcv_provisioners`                | read-only            | List DCV provisioners                                   |
| `get_dcv_provisioner`                  | read-only            | Get a DCV provisioner                                   |
| `create_dcv_provisioner`               | mutating-safe        | Create a DCV provisioner                                |
| `update_dcv_provisioner`               | mutating-destructive | Update a DCV provisioner                                |
| `delete_dcv_provisioner`               | mutating-destructive | Delete a DCV provisioner                                |
| `list_dcv_policies`                    | read-only            | List DCV policies                                       |
| `get_dcv_policy`                       | read-only            | Get a DCV policy                                        |
| `create_dcv_policy`                    | mutating-safe        | Create a DCV policy                                     |
| `update_dcv_policy`                    | mutating-destructive | Update a DCV policy                                     |
| `delete_dcv_policy`                    | mutating-destructive | Delete a DCV policy                                     |
| `list_service_accounts`                | read-only            | List service accounts                                   |
| `get_service_account`                  | read-only            | Get a service account                                   |
| `create_service_account`               | mutating-safe        | Create a service account                                |
| `update_service_account`               | mutating-destructive | Update a service account                                |
| `delete_service_account`               | mutating-destructive | Delete a service account                                |
| `list_identity_providers`              | read-only            | List identity providers                                 |
| `get_identity_provider`                | read-only            | Get an identity provider                                |
