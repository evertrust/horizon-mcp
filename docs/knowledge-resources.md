# Knowledge resources

The server exposes 12 knowledge resources at `horizon://knowledge/*`. LLMs read these before acting  -  so they construct correct HCQL queries, build valid profile payloads, and understand dependency order without needing a human to explain Horizon internals.

| Resource | URI | Contents |
|----------|-----|----------|
| Profiles | `horizon://knowledge/profiles` | Module types, field reference, authorization modes |
| Computation and Data Flow | `horizon://knowledge/computation-and-data-flow` | Template syntax, 30+ built-in functions, datasource chaining |
| Workflows | `horizon://knowledge/workflows` | 7 lifecycle workflows, authorization levels, request policies |
| Query Languages | `horizon://knowledge/query-languages` | HCQL/HRQL/HEQL/HDQL syntax, fields, operators, examples |
| RBAC | `horizon://knowledge/rbac` | Permission format, 36-pattern catalog, role guidance |
| Architecture | `horizon://knowledge/architecture` | Object model, module types, dependency order |
| Dictionary Matrix | `horizon://knowledge/dictionary-matrix` | Dictionary entries by protocol and lifecycle event |
| Discovery | `horizon://knowledge/discovery` | Scan types, campaigns, feed API, CLI usage |
| Automation | `horizon://knowledge/automation` | Trigger types, event hooks, execution policies |
| Integrations | `horizon://knowledge/integrations` | End-to-end patterns: ACME, MDM, LDAP, OIDC, cloud vaults |
| Dashboards | `horizon://knowledge/dashboards` | Dashboard and chart structure, saved query types |
| System Admin | `horizon://knowledge/system-admin` | Licensing, analytics sync, report management |
