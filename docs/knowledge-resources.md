# Knowledge resources

The server exposes a generated knowledge catalog at `horizon://knowledge/*`:

- 18 core resource URIs backed by the main Horizon knowledge guides
- 4 curated playbooks for smaller-model usability and integration recipes
- generated section resources for the longest operational guides (`query-languages`, `datasources`, `discovery-workflows`, `integrations`, `dcv`, `validation-rules`, `rest-notifications`)

MCP clients can read these resources to ground tool choice and payload construction, but the server does not guarantee that every client will preload them before issuing tool calls.

For clients with weak or missing MCP resource support, the same content is reachable through the `read_knowledge` tool (in the `docs` toolset): pass a `topic` slug (for example `query-languages`) and optionally a `section`, and page through long guides with `max_chars` / `offset`. Tool descriptions that reference `horizon://knowledge/*` URIs can always be resolved this way.

| Resource                  | URI                                             | Contents                                                                                                     |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Profiles                  | `horizon://knowledge/profiles`                  | Module types, field reference, authorization modes                                                           |
| Computation and Data Flow | `horizon://knowledge/computation-and-data-flow` | Template syntax, 30+ built-in functions, datasource chaining                                                 |
| Workflows                 | `horizon://knowledge/workflows`                 | 7 lifecycle workflows, authorization levels, request policies                                                |
| Query Languages           | `horizon://knowledge/query-languages`           | HCQL/HRQL/HEQL/HDQL syntax, fields, operators, examples                                                      |
| RBAC                      | `horizon://knowledge/rbac`                      | Permission format, 36-pattern catalog, role guidance                                                         |
| Architecture              | `horizon://knowledge/architecture`              | Object model, module types, dependency order                                                                 |
| Dictionary Matrix         | `horizon://knowledge/dictionary-matrix`         | Certificate field dictionary and matrix reference                                                            |
| Datasources               | `horizon://knowledge/datasources`               | DNS, LDAP, REST datasource config, multi-lookup patterns, end-to-end recipes                                 |
| DCV                       | `horizon://knowledge/dcv`                       | DCV providers, policies, lifecycle status, and events                                                        |
| Validation Rules          | `horizon://knowledge/validation-rules`          | Auto-approval conditions, operator reference (API-verified syntax), module support matrix                    |
| Dictionary Entries        | `horizon://knowledge/dictionary-entries`        | Alias URI for `dictionary-matrix` content                                                                    |
| Discovery                 | `horizon://knowledge/discovery`                 | Concepts, campaigns, data structures, search patterns                                                        |
| Discovery Workflows       | `horizon://knowledge/discovery-workflows`       | CLI commands for netscan, localscan, netimport, importscan, localimport                                      |
| Automation                | `horizon://knowledge/automation`                | Trigger types, event hooks, execution policies                                                               |
| Integrations              | `horizon://knowledge/integrations`              | End-to-end patterns: ACME, MDM, LDAP, OIDC, cloud vaults                                                     |
| Dashboards                | `horizon://knowledge/dashboards`                | Dashboard and chart structure, saved query types                                                             |
| REST Notifications        | `horizon://knowledge/rest-notifications`        | Custom REST connectors, multi-step chaining, auth types, template dictionary, real-world deployment patterns |
| System Admin              | `horizon://knowledge/system-admin`              | Licensing, analytics sync, report management                                                                 |

## Curated playbooks

| Resource             | URI                                        | Contents                                                              |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Tool Selection       | `horizon://knowledge/tool-selection`       | Deterministic tool-choice and call-order guide for smaller models     |
| ADCS integration     | `horizon://knowledge/adcs-integration`     | ADCS connector prerequisites, required fields, verification checklist |
| DigiCert integration | `horizon://knowledge/digicert-integration` | DigiCert connector field mapping and rollout checklist                |
| Intune integration   | `horizon://knowledge/intune-integration`   | Intune / Intune PKCS setup guidance and known API-version drift       |

## Generated section resources

For the seven longest guides, the server also registers section-level URIs derived from the H2 headings. Examples:

- `horizon://knowledge/query-languages/ownership-patterns-hcql`
- `horizon://knowledge/datasources/rest-datasource`
- `horizon://knowledge/discovery-workflows/3-net-import-netimport`
- `horizon://knowledge/integrations/mdm-integrations-intune-jamf`
- `horizon://knowledge/dcv/event-stream`
- `horizon://knowledge/validation-rules/complete-workflow-recipes`
- `horizon://knowledge/rest-notifications/real-world-examples`
