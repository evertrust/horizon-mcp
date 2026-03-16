# horizon-mcp

Production MCP server for [Evertrust Horizon](https://www.evertrust.fr/) Certificate Lifecycle Management (CLM). Exposes **96 tools** and **12 knowledge resources** over the [Model Context Protocol](https://modelcontextprotocol.io/), enabling any MCP-compatible LLM to manage certificates, profiles, and discovery through natural language.

## Why knowledge-first?

Most MCP servers hand an LLM a list of tools and leave it to figure out the domain. horizon-mcp ships **12 embedded knowledge resources** covering Horizon's query languages, profile modules, computation engine, workflows, RBAC model, discovery system, and more. The LLM reads these before it acts — so it constructs correct HCQL queries, builds valid profile payloads, and understands dependency order without needing a human to explain Horizon internals every session.

---

## Prerequisites

- Python 3.11+
- An Evertrust Horizon instance (tested on 2.8, expected to work on 2.7 and 2.9)
- API credentials or a client certificate with appropriate permissions

---

## Installation

```bash
git clone https://github.com/evertrust/horizon-mcp
cd horizon-mcp
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Verify:

```bash
horizon-mcp --help
```

For OIDC browser authentication, install the optional dependency:

```bash
pip install -e ".[oidc]"
```

---

## Authentication

Three authentication modes are supported. The server auto-detects which mode to use based on which environment variables are set. Priority: **mTLS > API Key > OIDC browser**.

### Mode 1: API Key

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_API_ID=your-api-id
HORIZON_API_KEY=your-api-key
```

### Mode 2: Mutual TLS (PEM files)

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_CLIENT_CERT=/path/to/client.crt
HORIZON_CLIENT_KEY=/path/to/client.key
HORIZON_CLIENT_KEY_PASSWORD=optional-key-password   # omit if key is unencrypted
```

### Mode 3: Mutual TLS (PKCS12 / PFX)

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_CLIENT_PFX=/path/to/client.p12
HORIZON_CLIENT_PFX_PASSWORD=optional-pfx-password   # omit if bundle is unencrypted
```

### Mode 4: OIDC browser session

Set only `HORIZON_URL`. A browser window opens for interactive login at startup. Requires the `oidc` extra (`pip install -e ".[oidc]"`).

```bash
HORIZON_URL=https://horizon.example.com
```

---

## Configuration reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HORIZON_URL` | Yes | `https://localhost` | Horizon instance URL |
| `HORIZON_API_ID` | Mode 1 | | API key identifier |
| `HORIZON_API_KEY` | Mode 1 | | API key secret |
| `HORIZON_CLIENT_CERT` | Mode 2 | | Path to PEM client certificate |
| `HORIZON_CLIENT_KEY` | Mode 2 | | Path to PEM private key |
| `HORIZON_CLIENT_KEY_PASSWORD` | No | | PEM key decryption password |
| `HORIZON_CLIENT_PFX` | Mode 3 | | Path to PKCS12 / PFX bundle |
| `HORIZON_CLIENT_PFX_PASSWORD` | No | | PFX decryption password |
| `HORIZON_VERIFY_SSL` | No | `true` | Verify server TLS certificates |
| `HORIZON_TIMEOUT` | No | `30` | HTTP request timeout (seconds) |
| `HORIZON_LOG_LEVEL` | No | `INFO` | Log verbosity: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

Copy the example file and fill in your values:

```bash
cp .env.example .env
# edit .env
```

---

## Quickstart by LLM client

### Claude Code

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "horizon": {
      "command": "/path/to/horizon-mcp/.venv/bin/horizon-mcp",
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

Start Claude Code from that directory. The 96 tools are available immediately.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "horizon": {
      "command": "/path/to/horizon-mcp/.venv/bin/horizon-mcp",
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

Restart Claude Desktop. The Horizon tools appear in the tools panel.

### OpenAI Codex CLI

Create `.mcp.json` in your project root (same format as Claude Code above).

### OpenCode

Add to `opencode.json`:

```json
{
  "mcp": {
    "horizon": {
      "command": "/path/to/horizon-mcp/.venv/bin/horizon-mcp",
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

### ChatGPT (via MCP bridge)

ChatGPT does not natively support MCP. Use a bridge such as [mcphost](https://github.com/nicobailey/mcphost):

```bash
pip install mcphost
mcphost --mcp-server "horizon=/path/to/horizon-mcp/.venv/bin/horizon-mcp" \
        --provider openai --model gpt-4o
```

Set the Horizon environment variables in your shell before running.

### MCP Inspector (debugging and exploration)

```bash
export HORIZON_URL=https://horizon.example.com
export HORIZON_API_ID=your-api-id
export HORIZON_API_KEY=your-api-key

npx @modelcontextprotocol/inspector .venv/bin/horizon-mcp
```

Opens a browser UI showing all 96 tools and 12 knowledge resources.

---

## Sample prompts

These natural language prompts work with any connected LLM.

### Discovery and inventory

```
What profiles are configured on this Horizon instance?
```

```
List all certificate authorities and show which ones are trusted for client authentication.
```

```
Show me the discovery campaigns and their current status.
```

### Certificate search

```
Find all certificates expiring in the next 30 days.
```

```
Search for revoked certificates issued by the "Internal-CA" profile.
```

```
Show me certificates with a grade lower than B.
```

```
Export a CSV of all valid certificates matching dn contains ".example.com".
```

### Certificate lifecycle

```
Enroll a new certificate through the WebRA-TLS profile with CN=app.example.com and SAN=DNS:app.example.com.
```

```
Download certificate abc123 in PKCS12 format with password "changeit".
```

```
Revoke the certificate with ID xyz789 — reason: keyCompromise.
```

### Profile management

```
Create a new WebRA profile called "API-Servers" with auto-validation and a 365-day renewal period.
```

```
Update the EST-Devices profile to require approval for enrollment.
```

```
What ACME profiles exist and what authorization methods do they support?
```

### Dashboards and analytics

```
Create a dashboard showing certificate status distribution by profile.
```

```
List my saved queries and show me the one named "expiring-soon".
```

```
What is the current analytics sync status for certificates?
```

### Diagnostics

```
Who am I authenticated as, and what permissions do I have?
```

```
Validate this HCQL query: dn matches ".*\.internal" and valid.until before 30d
```

```
Decode this PEM certificate and show me its details.
```

```
Describe the available fields for HCQL certificate queries.
```

---

## Knowledge resources

The server exposes 12 knowledge resources at `horizon://knowledge/*`. LLMs access these to understand Horizon domain concepts before constructing tool calls.

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

---

## Tool reference

96 tools in 11 domains. Safety tiers:

- `read-only` — no side effects
- `mutating-safe` — creates or modifies data, safe to retry
- `mutating-destructive` — deletes data or changes active behavior; requires confirmation
- `security-sensitive` — affects access control

### Assist (15 tools)

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
| `detect_file` | read-only | Auto-detect and parse a cryptographic file |
| `simulate_computation_rule` | read-only | Test a computation rule template against a dictionary |
| `simulate_datasource_flow` | read-only | Test a datasource flow pipeline against sample context |

### Lifecycle (17 tools)

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
| `submit_request` | mutating-safe | Submit a lifecycle request (enroll, renew, revoke, …) |
| `approve_request` | mutating-safe | Approve a pending request |
| `deny_request` | mutating-safe | Deny a pending request |
| `cancel_request` | mutating-safe | Cancel a pending request |

### Dashboards (12 tools)

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

### Discovery (6 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_discovery_campaigns` | read-only | List campaigns with optional name filter |
| `get_discovery_campaign` | read-only | Get a campaign by name |
| `create_discovery_campaign` | mutating-safe | Create a campaign with hosts, ports, and grading policies |
| `update_discovery_campaign` | mutating-safe | Update campaign settings (GET → strip → merge → PUT) |
| `delete_discovery_campaign` | mutating-destructive | Delete a campaign (requires name confirmation) |
| `flush_discovery_campaign` | mutating-destructive | Purge all events from a campaign (requires confirmation) |

### Discovery Events (3 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `search_discovery_events` | read-only | Search discovery events via HDQL |
| `get_discovery_event` | read-only | Get a discovery event by ID |
| `export_discovery_events_csv` | read-only | Export discovery events to CSV |

### Discovery Feed (4 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `start_discovery_feed_session` | mutating-safe | Open a feed session for a campaign |
| `feed_discovery_certificate` | mutating-safe | Push a certificate into the active feed session |
| `register_discovery_event` | mutating-safe | Register a discovery event for a feed session |
| `end_discovery_feed_session` | mutating-safe | Close a feed session and commit results |

### Reports (3 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_reports` | read-only | List reports with optional name filter and expiry toggle |
| `download_report` | read-only | Fetch raw CSV content by report UUID |
| `delete_report` | mutating-destructive | Delete a report (requires UUID confirmation) |

### Analytics (1 tool)

| Tool | Safety | Description |
|------|--------|-------------|
| `get_analytics` | read-only | Get analytics sync status for a domain (certificates, events, discovery) |

### Config — read-only (19 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_cas` | read-only | List certificate authorities |
| `get_ca` | read-only | Get CA details by name |
| `get_crl_cache` | read-only | Get CRL cache status for a CA |
| `list_trust_chains` | read-only | List trust chains |
| `get_trust_chain` | read-only | Get trust chain details by name |
| `list_labels` | read-only | List labels |
| `get_label` | read-only | Get label details by name |
| `list_http_proxies` | read-only | List HTTP proxies |
| `get_http_proxy` | read-only | Get proxy details by name |
| `list_datasources` | read-only | List datasources |
| `get_datasource` | read-only | Get datasource details by name |
| `simulate_datasource` | read-only | Test a datasource with optional context |
| `list_password_policies` | read-only | List password policies |
| `get_password_policy` | read-only | Get password policy details by name |
| `generate_password` | read-only | Generate a password from a policy |
| `list_grading_policies` | read-only | List grading policies |
| `get_grading_policy` | read-only | Get grading policy details by name |
| `list_grading_rulesets` | read-only | List grading rulesets |
| `get_grading_ruleset` | read-only | Get grading ruleset details by name |

### Profiles (12 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_profiles` | read-only | List profiles with optional name and module filter |
| `get_profile` | read-only | Get full profile details by name |
| `create_webra_profile` | mutating-safe | Create a WebRA profile |
| `update_webra_profile` | mutating-destructive | Update a WebRA profile |
| `create_acme_profile` | mutating-safe | Create an ACME profile |
| `update_acme_profile` | mutating-destructive | Update an ACME profile |
| `create_scep_profile` | mutating-safe | Create a SCEP profile |
| `update_scep_profile` | mutating-destructive | Update a SCEP profile |
| `create_est_profile` | mutating-safe | Create an EST profile |
| `update_est_profile` | mutating-destructive | Update an EST profile |
| `create_monitored_profile` | mutating-safe | Create a Monitored profile |
| `update_monitored_profile` | mutating-destructive | Update a Monitored profile |

### Security — read-only (4 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_roles` | read-only | List roles with optional name filter |
| `get_role` | read-only | Get role details and permissions by name |
| `list_credentials` | read-only | List credential metadata (no secrets returned) |
| `get_credential` | read-only | Get credential metadata by name (no secrets returned) |

---

## Update semantics

All `update_*` tools use a **GET → strip → merge → PUT** pattern:

1. Fetch current object state from Horizon
2. Strip server-populated fields (IDs, timestamps, computed state)
3. Merge provided parameters — only non-null values override
4. Apply `clear_fields` — explicitly sets named fields to null
5. PUT the merged payload

**Rules:**

- Omitted parameter = preserve existing value
- Provided parameter = override existing value
- `clear_fields=["description"]` = explicitly null the `description` field

---

## Delete safety

All `delete_*` and `flush_*` tools require an `expected_name` (or `expected_identifier`) parameter that must exactly match the object's name. This forces the LLM to confirm what it intends to delete and prevents accidental destructive operations.

---

## Compatibility matrix

| Horizon version | Status |
|-----------------|--------|
| 2.8 | Tested |
| 2.7 | Expected to work |
| 2.9 | Expected to work |

---

## What is not supported

The following capabilities require direct Horizon API calls or the Horizon UI. They are intentionally outside this server's scope:

- **Credential management** — creating, updating, or deleting stored credentials (private keys, API tokens, etc.)
- **PKI and third-party connector management** — creating, updating, or deleting connectors to ADCS, EJBCA, HashiCorp Vault, etc.
- **Trigger management** — creating, updating, or deleting email/webhook/script triggers
- **Role, team, IDP, and principal administration** — creating or modifying users, teams, identity providers, and access control assignments
- **CA import and trust chain management** — importing CAs or modifying trust anchor configuration
- **Label, proxy, datasource, and policy administration** — creating or modifying configuration objects
- **SMTP and notification server configuration**
- **Intune, Jamf, and MDM integration setup** — device management connector configuration
- **Scheduler and system-level automation** — cron-based jobs and system task configuration
- **Analytics reindex and reset operations** — rebuilding search indices

---

## Development

```bash
pip install -e ".[dev]"
pytest tests/ -v          # run the test suite
ruff check src/           # lint
mypy src/                 # type check
```

---

## License

TBD
