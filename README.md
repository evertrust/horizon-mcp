# Evertrust CLM (Horizon) - MCP Server

Production MCP server for [Evertrust Horizon](https://www.evertrust.fr/) Certificate Lifecycle Management (CLM). Exposes **66 tools** and **12 knowledge resources** over the [Model Context Protocol](https://modelcontextprotocol.io/), enabling any MCP-compatible LLM to manage certificates, profiles, and discovery through natural language.

## Why knowledge-first?

Most MCP servers hand an LLM a list of tools and leave it to figure out the domain. horizon-mcp ships **12 embedded knowledge resources** covering Horizon's query languages, profile modules, computation engine, workflows, RBAC model, discovery system, and more. The LLM reads these before it acts  -  so it constructs correct HCQL queries, builds valid profile payloads, and understands dependency order without needing a human to explain Horizon internals every session.

## Architecture

66 tools organized in **8 domains**, each with a safety tier (`read-only`, `mutating-safe`, `mutating-destructive`):

| Domain | Tools | Purpose |
|--------|------:|---------|
| Assist | 19 | Identity, grading, query validation, crypto decoding, simulation |
| Lifecycle | 17 | Certificate search, requests, events, enrollment, revocation |
| Dashboards | 12 | Dashboard CRUD, charts, saved queries |
| Discovery | 6 | Campaign management |
| Discovery Events | 3 | Event search and export |
| Discovery Feed | 4 | Push certificates and events into campaigns |
| Reports | 3 | Report listing, download, deletion |
| Profiles | 2 | Profile listing and inspection |

All destructive operations require name confirmation to prevent accidental deletion. See the full [tool reference](docs/tools-reference.md).

---

## Quickstart

### Prerequisites

- Python 3.11+
- An Evertrust Horizon instance (tested on 2.8, expected to work on 2.7 and 2.9)
- API credentials or a client certificate with appropriate permissions

### Install

```bash
git clone https://github.com/evertrust/horizon-mcp
cd horizon-mcp
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
```

Note the absolute path to the venv Python binary  -  you'll need it below:

```bash
echo "$(pwd)/.venv/bin/python"
```

### Connect your LLM client

**Claude Desktop**  -  edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "horizon": {
      "command": "/absolute/path/to/horizon-mcp/.venv/bin/python",
      "args": ["-m", "horizon_mcp.server"],
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

**Claude Code**  -  create `.mcp.json` in your project root (same JSON format as above).

For **Cursor**, **Codex**, **OpenCode**, and **MCP Inspector** setup, see [client setup](docs/client-setup.md).

---

## Sample prompts

These natural language prompts work with any connected LLM.

### Discovery and inventory

```
What profiles are configured on this Horizon instance?
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
Revoke the certificate with ID xyz789  -  reason: keyCompromise.
```

### Dashboards

```
Create a dashboard showing certificate status distribution by profile.
```

```
List my saved queries and show me the one named "expiring-soon".
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

## Compatibility

| Horizon version | Status |
|-----------------|--------|
| 2.8 | Tested |
| 2.7 | Expected to work |
| 2.9 | Expected to work |

## What is not supported

The following capabilities require direct Horizon API calls or the Horizon UI:

- **Configuration objects**  -  CAs, trust chains, labels, HTTP proxies, datasources, password policies, grading policies, and grading rulesets
- **Profile management**  -  creating, updating, or deleting profiles (read-only listing and inspection are supported)
- **Credential management**  -  creating, updating, or deleting stored credentials
- **PKI and third-party connector management**  -  connectors to ADCS, EJBCA, HashiCorp Vault, etc.
- **Trigger management**  -  email/webhook/script triggers
- **Role, team, IDP, and principal administration**
- **Analytics**  -  sync status and reindex operations
- **SMTP and notification server configuration**
- **Intune, Jamf, and MDM integration setup**
- **Scheduler and system-level automation**

---

## Documentation

| Document | Contents |
|----------|----------|
| [Installation](docs/installation.md) | Full install guide, OIDC setup |
| [Authentication](docs/authentication.md) | 4 auth modes, environment variables reference |
| [Client setup](docs/client-setup.md) | Claude Desktop, Claude Code, Cursor, Codex, OpenCode, MCP Inspector |
| [Tool reference](docs/tools-reference.md) | All 66 tools by domain with safety tiers |
| [Knowledge resources](docs/knowledge-resources.md) | 12 embedded knowledge resources |
| [Development](docs/development.md) | Dev setup, tests, linting |

---

> [!CAUTION]
> **Experimental software**  -  This MCP server is experimental and should only be used for exploratory purposes at this time.
>
> **Permissions**  -  The MCP server authenticates as the configured user and the AI agent operates with that user's full permissions. Evertrust recommends against granting AI agents highly privileged access to the CLM to prevent unintended incidents.
>
> **No guaranteed boundaries**  -  While the MCP server attempts to enforce permission boundaries between the user and the AI agent, this may not work in all cases. Users bear sole responsibility for actions taken by the AI agent on their behalf.
>
> **AI-generated output**  -  All output is AI-generated and should be subject to manual human validation before being relied upon.
>
> **Third-party AI providers**  -  Use of AI agents is subject to the terms of service and privacy policy of the AI provider. These are not controlled by the MCP server or by Evertrust.

---

## Acknowledgements

This project was developed with the assistance of [Anthropic's Claude](https://www.anthropic.com/claude).

## License

Copyright 2025-2026 [Evertrust](https://www.evertrust.fr/). Licensed under the [Apache License 2.0](LICENSE).
