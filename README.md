# Horizon MCP Server

Production MCP server for [Evertrust Horizon](https://www.evertrust.fr/) Certificate Lifecycle Management (CLM). Exposes **134 tools** and **10 knowledge resources** over the [Model Context Protocol](https://modelcontextprotocol.io/), enabling any MCP-compatible LLM to manage certificates, profiles, connectors, security, and more through natural language.

## Prerequisites

- Python 3.11+
- An Evertrust Horizon instance (2.7–2.9)
- API credentials (API ID + API Key) with appropriate permissions

## Installation

```bash
git clone <this-repo>
cd horizon-mcp-server
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Verify the installation:

```bash
horizon-mcp --help
```

## Configuration

The server reads configuration from environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HORIZON_URL` | Yes | `https://localhost` | Horizon instance URL |
| `HORIZON_API_ID` | Yes | | API key identifier |
| `HORIZON_API_KEY` | Yes | | API key secret |
| `HORIZON_VERIFY_SSL` | No | `true` | Verify TLS certificates |
| `HORIZON_TIMEOUT` | No | `30` | HTTP timeout (seconds) |
| `HORIZON_LOG_LEVEL` | No | `INFO` | Log level (DEBUG, INFO, WARNING, ERROR) |

Copy the example and fill in your credentials:

```bash
cp .env.example .env
# Edit .env with your Horizon credentials
```

---

## Quickstart by LLM Client

### Claude Code

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "horizon": {
      "command": "/path/to/horizon-mcp-server/.venv/bin/horizon-mcp",
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

Then start Claude Code in that project directory. The server will be available immediately.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "horizon": {
      "command": "/path/to/horizon-mcp-server/.venv/bin/horizon-mcp",
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

Restart Claude Desktop. The Horizon tools will appear in the tools menu.

### ChatGPT (via MCP bridge)

ChatGPT does not natively support MCP. Use an MCP-to-OpenAI bridge such as [mcp-openai](https://github.com/anthropics/mcp-openai) or [mcphost](https://github.com/nicobailey/mcphost):

```bash
# Example with mcphost
pip install mcphost
mcphost --mcp-server "horizon=/path/to/horizon-mcp-server/.venv/bin/horizon-mcp" \
        --provider openai --model gpt-4o
```

Set `HORIZON_URL`, `HORIZON_API_ID`, and `HORIZON_API_KEY` in your shell environment before launching.

### OpenAI Codex CLI

Create `.mcp.json` in your project root (same format as Claude Code):

```json
{
  "mcpServers": {
    "horizon": {
      "command": "/path/to/horizon-mcp-server/.venv/bin/horizon-mcp",
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

### OpenCode

Add to your `opencode.json` configuration:

```json
{
  "mcp": {
    "horizon": {
      "command": "/path/to/horizon-mcp-server/.venv/bin/horizon-mcp",
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

### MCP Inspector (debugging)

For interactive debugging and exploration:

```bash
export HORIZON_URL=https://horizon.example.com
export HORIZON_API_ID=your-api-id
export HORIZON_API_KEY=your-api-key

npx @modelcontextprotocol/inspector .venv/bin/horizon-mcp
```

Opens a browser UI showing all 134 tools and 10 knowledge resources.

---

## Sample Requests

These are natural language prompts you can use with any connected LLM.

### Discovery & Inventory

```
What profiles are configured on this Horizon instance?
```

```
List all certificate authorities and show which ones are trusted for client authentication.
```

```
Show me all PKI connectors and the third-party connectors.
```

### Certificate Search

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
Export a CSV of all certificates matching "dn matches '.*example.com' and status is valid".
```

### Certificate Operations

```
Enroll a new certificate through the WebRA-TLS profile with CN=app.example.com and SAN=DNS:app.example.com.
```

```
Download certificate abc123 in PKCS#12 format with password "changeit".
```

```
Revoke the certificate with ID xyz789 — reason: keyCompromise.
```

### Profile Management

```
Create a new WebRA profile called "API-Servers" using the ADCS-Connector PKI connector,
with auto-validation mode, RSA 2048+ keys, and a 365-day renewal period.
```

```
Update the EST-Devices profile to require approval for enrollment
(set the enroll access level to "request").
```

```
What ACME profiles exist and what authorization methods do they support?
```

### Security & RBAC

```
Create a read-only role called "Auditor" with permissions to search certificates
and view events on all profiles.
```

```
List all teams and their members.
```

```
Add user "alice@example.com" to the "PKI-Admins" role.
```

### Triggers & Notifications

```
Create an email trigger that fires on certificate enrollment and expiry (30 days before),
then attach it to the WebRA-TLS profile.
```

```
Show me all triggers and which profiles they're attached to.
```

### Diagnostics & Debugging

```
Who am I authenticated as, and what permissions do I have?
```

```
Validate this HCQL query: dn matches ".*\.internal" and valid.until before 30d
```

```
Decode this PEM certificate and show me its details:
-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAL...
-----END CERTIFICATE-----
```

```
Describe the available fields for HCQL certificate queries.
```

---

## Knowledge Resources

The server exposes 10 knowledge resources (accessible via `horizon://knowledge/*`) that LLMs use to understand Horizon concepts:

| Resource | URI | Description |
|----------|-----|-------------|
| Profiles | `horizon://knowledge/profiles` | Module types, field reference, authorization modes |
| Computation & Data Flow | `horizon://knowledge/computation-and-data-flow` | Template syntax, 30+ functions, dictionary entries, datasource chaining |
| Workflows | `horizon://knowledge/workflows` | 7 workflows, authorization levels, request policies, self-permissions |
| Query Languages | `horizon://knowledge/query-languages` | HCQL/HRQL/HEQL/HDQL syntax, fields, operators, examples |
| RBAC | `horizon://knowledge/rbac` | Permission format, 36-pattern catalog, role workflow guidance |
| Architecture | `horizon://knowledge/architecture` | Object model, dependency order, module types |
| Dictionary Matrix | `horizon://knowledge/dictionary-matrix` | Dictionary entries by protocol and lifecycle event |
| Discovery | `horizon://knowledge/discovery` | Scan types, campaigns, CLI usage |
| Automation | `horizon://knowledge/automation` | Trigger types, event hooks, execution policies |
| Integrations | `horizon://knowledge/integrations` | End-to-end patterns: ACME, MDM, LDAP, OIDC, cloud vaults |

---

## Tool Reference

134 tools organized by domain. Safety tiers indicate mutation risk:

- `read-only` — No side effects
- `mutating-safe` — Creates or modifies data, safe to retry
- `mutating-destructive` — Deletes data or changes active behavior; requires confirmation
- `security-sensitive` — Affects access control or authentication

### Configuration (31 tools)

#### Certificate Authorities

| Tool | Safety | Description |
|------|--------|-------------|
| `list_cas` | read-only | List certificate authorities. Params: `max_items`, `name_contains` |
| `get_ca` | read-only | Get CA details. Params: `name` |
| `create_ca` | mutating-safe | Import a CA. Params: `certificate`, `trusted_for_client_auth`, `trusted_for_server_auth`, `responder_url`, `crl_url`, `refresh`, `outdated_revocation_status_policy`, `timeout`, `proxy` |
| `update_ca` | mutating-safe | Update CA (GET->strip->merge->PUT). Params: `name`, `trusted_for_client_auth`, `trusted_for_server_auth`, `responder_url`, `crl_url`, `outdated_revocation_status_policy`, `timeout`, `proxy`, `clear_fields` |
| `delete_ca` | mutating-destructive | Delete CA. Params: `name`, `expected_name` |
| `get_crl_cache` | read-only | Get CRL cache status. Params: `ca_name` |
| `list_trust_chains` | read-only | List trust chains. Params: `max_items` |
| `get_trust_chain` | read-only | Get trust chain details. Params: `name` |

#### Labels

| Tool | Safety | Description |
|------|--------|-------------|
| `list_labels` | read-only | List labels. Params: `max_items`, `name_contains` |
| `get_label` | read-only | Get label details. Params: `name` |
| `create_label` | mutating-safe | Create label. Params: `name`, `display_name`, `description` |
| `update_label` | mutating-safe | Update label. Params: `name`, `display_name`, `description`, `clear_fields` |
| `delete_label` | mutating-destructive | Delete label. Params: `name`, `expected_name` |

#### HTTP Proxies

| Tool | Safety | Description |
|------|--------|-------------|
| `list_http_proxies` | read-only | List proxies. Params: `max_items`, `name_contains` |
| `get_http_proxy` | read-only | Get proxy details. Params: `name` |
| `create_http_proxy` | mutating-safe | Create proxy. Params: `name`, `host`, `port`, `credentials` |
| `update_http_proxy` | mutating-safe | Update proxy. Params: `name`, `host`, `port`, `credentials`, `clear_fields` |
| `delete_http_proxy` | mutating-destructive | Delete proxy. Params: `name`, `expected_name` |

#### Datasources

| Tool | Safety | Description |
|------|--------|-------------|
| `list_datasources` | read-only | List datasources. Params: `max_items`, `name_contains` |
| `get_datasource` | read-only | Get datasource details. Params: `name` |
| `create_datasource` | mutating-safe | Create datasource. Params: `name`, `type`, `configuration` |
| `update_datasource` | mutating-safe | Update datasource. Params: `name`, `type`, `configuration`, `clear_fields` |
| `delete_datasource` | mutating-destructive | Delete datasource. Params: `name`, `expected_name` |
| `simulate_datasource` | read-only | Test a datasource with optional context. Params: `name`, `context` |

#### Password Policies & Grading

| Tool | Safety | Description |
|------|--------|-------------|
| `list_password_policies` | read-only | List password policies. Params: `max_items`, `name_contains` |
| `get_password_policy` | read-only | Get password policy details. Params: `name` |
| `generate_password` | read-only | Generate password from policy. Params: `policy_name` |
| `list_grading_policies` | read-only | List grading policies. Params: `max_items`, `name_contains` |
| `get_grading_policy` | read-only | Get grading policy details. Params: `name` |
| `list_grading_rulesets` | read-only | List grading rulesets. Params: `max_items`, `name_contains` |
| `get_grading_ruleset` | read-only | Get grading ruleset details. Params: `name` |

### Connectors (10 tools)

#### PKI Connectors

| Tool | Safety | Description |
|------|--------|-------------|
| `list_pki_connectors` | read-only | List PKI connectors. Params: `max_items`, `name_contains` |
| `get_pki_connector` | read-only | Get connector details. Params: `name` |
| `create_pki_connector` | mutating-safe | Create connector. Params: `name`, `type`, `configuration`, `credential`, `proxy`, `description` |
| `update_pki_connector` | mutating-safe | Update connector. Params: `name`, `configuration`, `credential`, `proxy`, `description`, `clear_fields` |
| `delete_pki_connector` | mutating-destructive | Delete connector. Params: `name`, `expected_name` |

#### Third-Party Connectors

| Tool | Safety | Description |
|------|--------|-------------|
| `list_thirdparty_connectors` | read-only | List third-party connectors. Params: `max_items`, `name_contains` |
| `get_thirdparty_connector` | read-only | Get connector details. Params: `name` |
| `create_thirdparty_connector` | mutating-safe | Create connector. Params: `name`, `type`, `configuration`, `credential`, `description` |
| `update_thirdparty_connector` | mutating-safe | Update connector. Params: `name`, `configuration`, `credential`, `description`, `clear_fields` |
| `delete_thirdparty_connector` | mutating-destructive | Delete connector. Params: `name`, `expected_name` |

### Triggers (8 tools)

| Tool | Safety | Description |
|------|--------|-------------|
| `list_triggers` | read-only | List triggers. Params: `max_items`, `name_contains` |
| `get_trigger` | read-only | Get trigger details. Params: `name` |
| `create_trigger` | mutating-safe | Create trigger. Params: `name`, `type`, `events`, `configuration`, `retries`, `run_period`, `run_on_renewed`, `description` |
| `update_trigger` | mutating-safe | Update trigger. Params: `name`, `events`, `configuration`, `retries`, `run_period`, `run_on_renewed`, `description`, `clear_fields` |
| `delete_trigger` | mutating-destructive | Delete trigger. Params: `name`, `expected_name` |
| `simulate_trigger` | mutating-safe | Test-fire a trigger. Params: `name`, `dictionary` |
| `attach_trigger_to_profile` | mutating-safe | Wire trigger into profile hooks. Params: `profile_name`, `trigger_name` |
| `detach_trigger_from_profile` | mutating-safe | Remove trigger from profile hooks. Params: `profile_name`, `trigger_name` |

### Profiles (25 tools)

#### Generic Operations

| Tool | Safety | Description |
|------|--------|-------------|
| `list_profiles` | read-only | List profiles with filtering. Params: `max_items`, `name_contains`, `module` |
| `get_profile` | read-only | Get full profile details. Params: `name` |
| `delete_profile` | mutating-destructive | Delete profile. Params: `name`, `expected_name` |

#### Create Profile (by module)

All create tools share common parameters: `name`, `pki_connector` (except Monitored), `certificate_template`, `authorization_levels`, plus optional `display_name`, `description`, `enabled`, `crypto_policy`, `self_permissions`, `requests_policy`, `triggers`, `grading_policies`, `ds_flow`, `max_cert_per_holder_policy`, `renewal_period`, `pqc_allowed`, `third_party_discovery_sync`.

| Tool | Module | Extra Parameters |
|------|--------|-----------------|
| `create_webra_profile` | WebRA | `authorization_mode`, `validation_ruleset` |
| `create_acme_profile` | ACME | `authorization_methods`, `http01_port`, `tls_alpn01_port`, `authorize_short_name`, `max_dns_name`, `proxy` |
| `create_scep_profile` | SCEP | `mode`, `authorization_mode`, `scep_ra`, `caps`, `encryption_algorithm`, `dn_whitelist`, `validation_ruleset` |
| `create_est_profile` | EST | `authorization_mode`, `dn_whitelist`, `enroll_authorized_cas`, `renewal_authorized_cas`, `password_policy`, `validation_ruleset` |
| `create_monitored_profile` | Monitored | *(no pki_connector needed)* |
| `create_wcce_profile` | WCCE | `exchange_certificate` |
| `create_crmp_profile` | CRMP | `data_field_identifier` |
| `create_acme_external_profile` | ACME External | `acme_url`, `require_eab`, `authorized_cas` |
| `create_intune_profile` | Intune SCEP | `third_party_connector`, `device_id_field`, `device_id_separator` |
| `create_intunepkcs_profile` | IntunePKCS | `third_party_connector` |
| `create_jamf_profile` | Jamf | `third_party_connector`, `device_id_field` |

#### Update Profile (by module)

All update tools accept `name` + the same common/module-specific parameters as create (all optional) + `clear_fields`. Safety tier: **mutating-destructive (behavior-changing)**.

| Tool | Module |
|------|--------|
| `update_webra_profile` | WebRA |
| `update_acme_profile` | ACME |
| `update_scep_profile` | SCEP |
| `update_est_profile` | EST |
| `update_monitored_profile` | Monitored |
| `update_wcce_profile` | WCCE |
| `update_crmp_profile` | CRMP |
| `update_acme_external_profile` | ACME External |
| `update_intune_profile` | Intune SCEP |
| `update_intunepkcs_profile` | IntunePKCS |
| `update_jamf_profile` | Jamf |

### Lifecycle (17 tools)

#### Certificate Search & Export

| Tool | Safety | Description |
|------|--------|-------------|
| `search_certificates` | read-only | Search via HCQL. Params: `query`, `preset` (compact/diagnostic/compliance), `fields`, `page_index`, `page_size`, `sorted_by`, `with_count` |
| `export_certificates_csv` | read-only | Export to CSV (max 1000 rows). Params: `query`, `fields`, `sorted_by` |
| `get_certificate` | read-only | Get full certificate by ID. Params: `certificate_id` |
| `download_certificate` | read-only | Download in PEM/DER/PKCS7/PKCS12/JKS. Params: `certificate_id`, `format`, `password` |

#### Certificate Requests

| Tool | Safety | Description |
|------|--------|-------------|
| `get_request_template` | read-only | Get request template for a workflow. Params: `workflow`, `module`, `profile`, `certificate_id` |
| `submit_request` | mutating-safe | Submit lifecycle request. Params: `workflow`, `profile`, `data` |
| `approve_request` | mutating-safe | Approve pending request. Params: `request_id`, `comment` |
| `deny_request` | mutating-safe | Deny pending request. Params: `request_id`, `comment` |
| `cancel_request` | mutating-safe | Cancel pending request. Params: `request_id` |
| `search_requests` | read-only | Search via HRQL. Params: `query`, `preset`, `fields`, `page_index`, `page_size`, `sorted_by`, `with_count` |
| `get_request` | read-only | Get request details. Params: `request_id` |
| `export_requests_csv` | read-only | Export requests to CSV. Params: `query`, `fields`, `sorted_by` |

#### Challenges

| Tool | Safety | Description |
|------|--------|-------------|
| `request_est_challenge` | mutating-safe | Get EST enrollment challenge. Params: `profile` |
| `request_scep_challenge` | mutating-safe | Get SCEP challenge password. Params: `profile` |

#### Audit Events

| Tool | Safety | Description |
|------|--------|-------------|
| `search_events` | read-only | Search via HEQL. Params: `query`, `page_index`, `page_size`, `sorted_by` |
| `get_event` | read-only | Get event details. Params: `event_id` |
| `export_events_csv` | read-only | Export events to CSV. Params: `query`, `fields`, `sorted_by` |

### Security (29 tools)

#### Roles

| Tool | Safety | Description |
|------|--------|-------------|
| `list_roles` | read-only | List roles. Params: `max_items`, `name_contains` |
| `get_role` | read-only | Get role details. Params: `name` |
| `create_role` | mutating-safe | Create role. Params: `name`, `description`, `permissions` |
| `update_role` | security-sensitive | Update role (behavior-changing). Params: `name`, `description`, `permissions`, `clear_fields` |
| `delete_role` | mutating-destructive | Delete role. Params: `name`, `expected_name` |
| `get_role_members` | read-only | List role members. Params: `name`, `max_items` |
| `add_role_members` | mutating-safe | Add principals to role. Params: `name`, `members` |
| `remove_role_members` | mutating-safe | Remove principals from role. Params: `name`, `members` |

#### Teams

| Tool | Safety | Description |
|------|--------|-------------|
| `list_teams` | read-only | List teams. Params: `max_items`, `name_contains` |
| `get_team` | read-only | Get team details. Params: `name` |
| `create_team` | mutating-safe | Create team. Params: `name`, `display_name`, `description`, `contact`, `webhook`, `managers` |
| `update_team` | mutating-safe | Update team. Params: `name`, `display_name`, `description`, `contact`, `webhook`, `managers`, `clear_fields` |
| `delete_team` | mutating-destructive | Delete team. Params: `name`, `expected_name` |
| `get_team_members` | read-only | List team members. Params: `name`, `max_items` |
| `add_team_members` | mutating-safe | Add principals to team. Params: `name`, `members` |
| `remove_team_members` | mutating-safe | Remove principals from team. Params: `name`, `members` |
| `transfer_team_objects` | mutating-destructive | Transfer cert ownership. Params: `from_team`, `to_team` |

#### Identity Providers

| Tool | Safety | Description |
|------|--------|-------------|
| `list_identity_providers` | read-only | List IDPs. Params: `max_items`, `name_contains` |
| `get_identity_provider` | read-only | Get IDP details. Params: `name` |
| `create_identity_provider` | mutating-safe | Create IDP. Params: `name`, `type`, `configuration`, `description` |
| `update_identity_provider` | security-sensitive | Update IDP. Params: `name`, `configuration`, `description`, `clear_fields` |
| `delete_identity_provider` | mutating-destructive | Delete IDP. Params: `name`, `expected_name` |

#### Principals

| Tool | Safety | Description |
|------|--------|-------------|
| `search_principals` | read-only | Search principals. Params: `query`, `max_items` |
| `get_principal` | read-only | Get principal details. Params: `identifier` |
| `create_principal` | mutating-safe | Create principal. Params: `identifier`, `contact`, `roles`, `teams`, `permissions`, `enabled` |
| `update_principal` | security-sensitive | Update principal. Params: `identifier`, `contact`, `roles`, `teams`, `permissions`, `enabled`, `clear_fields` |
| `delete_principal` | mutating-destructive | Delete principal. Params: `identifier`, `expected_identifier` |

#### Credentials

| Tool | Safety | Description |
|------|--------|-------------|
| `list_credentials` | read-only | List credential metadata (no secrets). Params: `max_items`, `name_contains` |
| `get_credential` | read-only | Get credential metadata (no secrets). Params: `name` |

### Assist (14 tools)

#### Computation & Simulation

| Tool | Safety | Description |
|------|--------|-------------|
| `simulate_computation_rule` | read-only | Test computation rule against dictionary values. Params: `rule`, `dictionary` |
| `simulate_datasource_flow` | read-only | Test datasource flow pipeline. Params: `flow`, `context` |

#### Query Validation

| Tool | Safety | Description |
|------|--------|-------------|
| `validate_hcql` | read-only | Validate certificate search query. Params: `query` |
| `validate_hrql` | read-only | Validate request search query. Params: `query` |
| `validate_heql` | read-only | Validate event search query. Params: `query` |
| `validate_hdql` | read-only | Validate discovery event search query. Params: `query` |
| `describe_query_fields` | read-only | Discover fields/syntax for a query type. Params: `query_type` (hcql/hrql/heql/hdql) |

#### Cryptography

| Tool | Safety | Description |
|------|--------|-------------|
| `decode_x509` | read-only | Decode PEM X.509 certificate. Params: `pem` |
| `decode_csr` | read-only | Decode PEM CSR. Params: `pem` |
| `detect_file` | read-only | Auto-detect and parse cryptographic file. Params: `data` |

#### System

| Tool | Safety | Description |
|------|--------|-------------|
| `whoami` | read-only | Current principal identity and permissions |
| `get_license_info` | read-only | Horizon license information |
| `explain_grading_policy` | read-only | Explain grading policy, optionally evaluate cert. Params: `policy_name`, `certificate_pem` |
| `explain_grading_ruleset` | read-only | Explain grading ruleset, optionally evaluate cert. Params: `ruleset_name`, `certificate_pem` |

---

## Update Semantics

All `update_*` tools use a **GET -> strip -> merge -> PUT** pattern:

1. Fetch current object state
2. Strip server-populated fields (IDs, timestamps, computed state)
3. Merge provided parameters (only non-null values override)
4. Apply `clear_fields` (explicitly set named fields to null)
5. PUT the merged payload

**Key rules:**
- **Omitted parameter** = preserve existing value
- **Provided parameter** = override existing value
- **`clear_fields=["description"]`** = explicitly set `description` to null

## Delete Safety

All `delete_*` tools require an `expected_name` (or `expected_identifier`) parameter that must exactly match the object name. This prevents accidental deletions — the LLM must confirm what it intends to delete.

## Development

```bash
pip install -e ".[dev]"
pytest tests/ -v          # 232 tests
ruff check src/           # Lint
mypy src/                 # Type check
```

## License

Proprietary — Evertrust.
