# horizon-mcp

[![npm version](https://img.shields.io/npm/v/@evertrust/horizon-mcp.svg)](https://www.npmjs.com/package/@evertrust/horizon-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/evertrust/horizon-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/evertrust/horizon-mcp/actions/workflows/ci.yml)

Horizon MCP is an [MCP](https://modelcontextprotocol.io/) server for [Evertrust Horizon](https://www.evertrust.fr/). Horizon is a certificate lifecycle management (CLM) platform.

The server lets supported LLM clients operate Horizon. Supported clients include Claude Desktop, Claude Code, Cursor, Codex, and OpenCode.

You can issue, renew, and revoke certificates. You can also search Horizon data, manage discovery, decode cryptographic data, and read product documentation.

The server is for PKI engineers, platform teams, and security operators. They can operate Horizon from an integrated development environment or chat client.

## Why knowledge-first?

Horizon MCP provides tools and domain information. It includes **17 core knowledge URIs**, **4 integration playbooks**, and generated resources for long operational guides.

These resources explain Horizon concepts and help clients select tools. Clients can read the resources before they select a tool or create a payload.

The server does not preload these resources. The server also cannot guarantee that a client reads them before an operation.

## Features

- **212 tools across 12 domains**, each annotated with a safety tier (`read-only`, `mutating-safe`, `mutating-destructive`).
- **Knowledge catalog**: 17 core topic URIs and 4 curated playbooks.
  The server also generates section URIs from H2 headings in the longest guides.
- **Three HTTP authentication methods**: Horizon API key, TLS client certificate, and JWKS service-account JWT. A whitelist can enable multiple methods.
- **Service JWT renewal**: The MCP can use OAuth `client_credentials` to fetch and renew a caller's short-lived JWT.
- **HQL helpers**: validators and natural-language translators for HCQL (certificates), HRQL (requests), HEQL (events), and HDQL (discovery events).
- **Crypto decoding**: Parse X.509, PKCS#10 CSR, PKCS#7, CRL, OCSP, and RFC 3161 timestamp responses.
  The tools return structured JSON in the chat.
- **Destructive-operation safeguards**: `delete_*` and `flush_*` tools require an exact `expected_*` confirmation value.
  Other changes run when the client calls them. Use client approval controls and a Horizon identity with minimum privileges.
- **Standalone binaries** for macOS (x64/arm64), Linux (x64/arm64), and Windows (x64).

Tool counts per domain:

| Domain           | Tools | Highlights                                                                              |
| ---------------- | ----: | --------------------------------------------------------------------------------------- |
| Configuration    |   126 | CA / profile / RBAC / DCV / connector / policy administration, including 2.10 additions |
| Assist           |    21 | `whoami`, grading, HQL validators, crypto decoders, simulators                          |
| Lifecycle        |    17 | search/aggregate certs, requests, events, enroll, approve, revoke                       |
| Dashboards       |    12 | dashboard CRUD, charts, saved HQL queries                                               |
| Datasources      |     8 | DNS / LDAP / REST datasources, plus a `test_datasource` dry-run                         |
| Discovery        |     6 | campaign CRUD and flush                                                                 |
| Triggers         |     6 | REST notifications and credential listing                                               |
| Discovery feed   |     4 | push-mode certificate and event ingestion                                               |
| Discovery events |     3 | search, fetch, CSV export                                                               |
| Reports          |     3 | list, download, delete                                                                  |
| Docs             |     4 | search product docs, search API docs, fetch a page, read knowledge                      |
| Profiles         |     2 | list and inspect convenience tools; profile mutations live in the Configuration toolset |

Full per-tool table with safety tiers in [docs/tools-reference.md](docs/tools-reference.md).

## Prerequisites

- [Bun](https://bun.sh/) 1.x+ (recommended) or Node.js >= 24.10
- An Evertrust Horizon instance (tested on 2.8, expected to work on 2.7 and 2.9)
- API credentials or a client certificate for that instance
- An MCP client that speaks protocol revision **2026-07-28**. Version 3.0.0 serves that revision only.
  Check [docs/client-setup.md](docs/client-setup.md#client-compatibility) before upgrading, and stay on 2.x if your client is older.

## Install

### Option 1 - run from npm with bunx or npx

No install needed:

```bash
bunx @evertrust/horizon-mcp
# or
npx -y @evertrust/horizon-mcp
```

### Option 2 - standalone binary

Download the pre-built binary for your platform from the [releases page](https://github.com/evertrust/horizon-mcp/releases). The release artifacts cover:

- `horizon-mcp-darwin-x64`
- `horizon-mcp-darwin-arm64`
- `horizon-mcp-linux-x64`
- `horizon-mcp-linux-arm64`
- `horizon-mcp-windows-x64.exe`

Make it executable and run it:

```bash
chmod +x horizon-mcp-darwin-arm64
./horizon-mcp-darwin-arm64
```

### Option 3 - from source

```bash
git clone https://github.com/evertrust/horizon-mcp.git
cd horizon-mcp
bun install
bun run build
node dist/index.js
```

## Configuration

Configure the server with `HORIZON_*` environment variables. Copy [.env.example](.env.example) to `.env.local`, and then change the necessary values.

The server detects stdio authentication from the configured variables. It gives mTLS priority over an API key.

If you do not configure a credential, the server stops during startup.

### Connection and authentication

| Variable                          | Required?       | Default             | Description                                                                                                                                                                                                                                                                                        |
| --------------------------------- | --------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HORIZON_URL`                     | Yes             | `https://localhost` | Base URL of your Horizon instance. Trailing slash is stripped automatically.                                                                                                                                                                                                                       |
| `HORIZON_API_ID`                  | API key mode    |                     | API key identifier.                                                                                                                                                                                                                                                                                |
| `HORIZON_API_KEY`                 | API key mode    |                     | API key secret.                                                                                                                                                                                                                                                                                    |
| `HORIZON_CLIENT_CERT`             | mTLS (PEM) mode |                     | Filesystem path to a PEM client certificate.                                                                                                                                                                                                                                                       |
| `HORIZON_CLIENT_KEY`              | mTLS (PEM) mode |                     | Filesystem path to the matching PEM private key.                                                                                                                                                                                                                                                   |
| `HORIZON_CLIENT_KEY_PASSWORD`     | No              |                     | Decryption password for an encrypted PEM private key.                                                                                                                                                                                                                                              |
| `HORIZON_CLIENT_PFX`              | mTLS (PFX) mode |                     | Filesystem path to a PKCS12 / PFX bundle.                                                                                                                                                                                                                                                          |
| `HORIZON_CLIENT_PFX_PASSWORD`     | No              |                     | Decryption password for the PKCS12 bundle.                                                                                                                                                                                                                                                         |
| `HORIZON_VERIFY_SSL`              | No              | `true`              | Set to `false` or `0` to skip TLS verification on the Horizon endpoint (development only).                                                                                                                                                                                                         |
| `HORIZON_ALLOW_PRIVATE_TLS_PROBE` | No              | (blocked)           | By default `fetch_exposed_certificate` refuses to connect to private/link-local IPs (SSRF guard). Set to `1` to permit probing internal hosts (e.g. `10.x`, `192.168.x`, `127.0.0.1`).                                                                                                             |
| `HORIZON_TIMEOUT`                 | No              | `30`                | HTTP request timeout in seconds for standard API calls.                                                                                                                                                                                                                                            |
| `HORIZON_EXPORT_TIMEOUT`          | No              | `120`               | Timeout in seconds for CSV exports and other long-running endpoints.                                                                                                                                                                                                                               |
| `HORIZON_LOG_LEVEL`               | No              | `INFO`              | One of `DEBUG`, `INFO`, `WARNING`, `ERROR`.                                                                                                                                                                                                                                                        |
| `HORIZON_TESTED_VERSIONS`         | No              | `2.8`               | Comma-separated list of Horizon versions known to fully work with this build.                                                                                                                                                                                                                      |
| `HORIZON_WARN_VERSIONS`           | No              | `2.7,2.9`           | Comma-separated list of versions that are likely to work but emit a warning.                                                                                                                                                                                                                       |
| `HORIZON_ENABLED_TOOLSETS`        | No              | (all)               | Comma-separated list of tool domains to register, trimming the context cost of the full tool set. Valid names: `lifecycle`, `profiles`, `dashboards`, `discovery`, `datasources`, `reports`, `triggers`, `docs`, `assist`, `config`. Unset registers every toolset; an unknown name fails startup. |
| `HORIZON_READ_ONLY`               | No              | `false`             | Set to `true` or `1` to register only read-only tools; every mutating tool (create/update/delete/submit/...) is skipped at startup.                                                                                                                                                                |
| `HORIZON_AUTH_MODE`               | DEPRECATED      |                     | No longer required. Kept readable for backward compatibility; setting it logs a warning.                                                                                                                                                                                                           |

### Streamable HTTP (`HORIZON_TRANSPORT=http`)

These variables apply only when `HORIZON_TRANSPORT=http`; in stdio mode they are ignored.

| Var                                 | Default     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HORIZON_TRANSPORT`                 | `stdio`     | `stdio` \| `http`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `HORIZON_HTTP_HOST`                 | `127.0.0.1` | Bind address; `0.0.0.0` only behind a trusted edge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `HORIZON_HTTP_PORT`                 | `8080`      | Bind port.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `HORIZON_HTTP_PATH`                 | `/mcp`      | Endpoint path; absolute, no query or fragment; trailing slash normalized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `HORIZON_PUBLIC_URL`                | (unset)     | Public origin/base URL clients reach the server at; the endpoint is `new URL(HORIZON_HTTP_PATH, HORIZON_PUBLIC_URL)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `HORIZON_TRUSTED_HOSTS`             | derived     | Comma list of allowed `Host` values; derived from `HORIZON_PUBLIC_URL` or, on a loopback bind, the loopback hosts. A non-loopback bind with neither set refuses to start.                                                                                                                                                                                                                                                                                                                                                                                               |
| `HORIZON_TRUSTED_ORIGINS`           | (unset)     | Comma list of allowed CORS origins; unset means any request carrying an `Origin` is rejected (non-browser MCP clients send none).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `HORIZON_HTTP_AUTH_METHODS`         | `api-key`   | Comma- or pipe-separated whitelist of `api-key`, `mtls`, and `service`; multiple methods may be enabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `HORIZON_MAX_CONCURRENT_REQUESTS`   | `32`        | Max non-listen requests served at once across all callers (valid range `1` to `256`). This is the setting that bounds their memory.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `HORIZON_MAX_INFLIGHT_TOOLCALLS`    | `8`         | Max non-listen requests served at once for a single caller, so one busy client cannot consume the whole budget above.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `HORIZON_MAX_LISTEN_STREAMS_GLOBAL` | `8`         | Max listen streams across all callers (valid range `1` to `64`). Listen streams use this dedicated pair and do not consume the request/tool-call concurrency budgets.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `HORIZON_MAX_LISTEN_STREAMS`        | `2`         | Max listen streams served at once for a single caller (valid range `1` to `16`), paired with the dedicated global listen budget above.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `HORIZON_CREDENTIAL_CACHE_MAX`      | `64`        | How many validated caller credentials remain available for reuse (hard ceiling `512`). Retired entries stay alive only while in-flight requests still lease them.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `HORIZON_CREDENTIAL_CACHE_TTL`      | `300`       | Seconds a cached credential is reused before it is retired and revalidated against Horizon (`30` to `3600`), counted from validation rather than from last use. A non-CSRF Horizon `401` or `403` that reaches the end of the authentication-retry path retires the credential immediately, independent of the TTL; the client first makes one re-authentication attempt unless re-authentication backoff suppresses it. Retirement blocks new reuse immediately; revalidation happens on the first request after retirement, and cleanup waits for in-flight requests. |
| `HORIZON_VALIDATION_RATE_LIMIT`     | `5`         | Per-peer credential validations per second against Horizon (`0` to `100`); `0` disables. The aggregate cap is four times this value.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `HORIZON_MAX_BODY_BYTES`            | `1048576`   | Max request body bytes (1 MiB).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `HORIZON_SSE_MAX_DURATION`          | `3600`      | Absolute lifetime in seconds for each admitted MCP response (`1` to `86400`), including notification streams; SSE keep-alives do not reset it. Must be greater than `HORIZON_EXPORT_TIMEOUT` to leave headroom above the export budget.                                                                                                                                                                                                                                                                                                                                 |
| `HORIZON_SSE_KEEP_ALIVE`            | `15`        | Seconds between SSE keep-alive comments (`1` to `60`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `HORIZON_RATE_LIMIT_RPS`            | `20`        | Per-caller limit, counted per JSON-RPC message per second; `0` disables.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `HORIZON_IP_RATE_LIMIT`             | `600`       | Coarse per-IP request cap per second, a defense-in-depth backstop in front of the per-caller limits; `0` disables.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

When an MCP client disconnects, the server cancels credential validation and any
in-flight Horizon requests for that call.

Size non-listen request memory from `HORIZON_MAX_CONCURRENT_REQUESTS`, not from request throughput. The server builds
one short-lived tool registry per request, costing roughly 1.3 MiB each, on top of a process baseline of about 365 MiB.
The default of 32 concurrent requests fits comfortably in a 1 GiB container. Listen streams have the separate global
and per-caller limits above. Test under load before raising any concurrency limit.

Inbound mTLS settings (when `mtls` is included in `HORIZON_HTTP_AUTH_METHODS`):

| Var                                              | Notes                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HORIZON_HTTP_TLS_CERT` / `HORIZON_HTTP_TLS_KEY` | MCP terminates client TLS itself with its own server cert/key (requests a client cert without requiring a trusted CA).                                                   |
| `HORIZON_INBOUND_CERT_HEADER`                    | Alternative: a trusted ingress terminates client TLS and forwards the client cert to the MCP in this header.                                                             |
| `HORIZON_TRUSTED_PROXY`                          | IP/CIDR the inbound cert header is accepted from; REQUIRED with `HORIZON_INBOUND_CERT_HEADER`; matched on the direct TCP socket peer, never `X-Forwarded-For`.           |
| `HORIZON_FORWARD_CERT_HEADER`                    | Horizon-facing header the MCP sets with the captured cert; default `SSL_CLIENT_CERT` to match Horizon's `security.http.headers.certificate`; value is a URL-encoded PEM. |

`HORIZON_URL` and the existing authentication variables are unchanged. In per-caller `mtls` mode, set `HORIZON_URL` to the internal Horizon Play backend.

This backend must trust the forwarded certificate header. This connection bypasses the Horizon nginx server.

HTTP mode does not start if `HORIZON_ALLOW_PRIVATE_TLS_PROBE=1`.

### Development and testing

These variables are read by the test suite only and never by the server itself:

| Variable                 | Used by                 | Description                                                                                  |
| ------------------------ | ----------------------- | -------------------------------------------------------------------------------------------- |
| `HORIZON_E2E_URL`        | `bun run test:e2e`      | Base URL of the Horizon instance for E2E tests.                                              |
| `HORIZON_E2E_API_ID`     | `bun run test:e2e`      | API key identifier for E2E tests.                                                            |
| `HORIZON_E2E_API_KEY`    | `bun run test:e2e`      | API key secret for E2E tests.                                                                |
| `HORIZON_LLM_LIVE_MODEL` | `bun run test:llm:live` | Optional model override for the live LLM evaluation harness; defaults to `claude-haiku-4-5`. |

## Transports

`HORIZON_TRANSPORT` selects one of two MCP transports.

- **stdio** (default) - Use this transport for one local user. The MCP client starts the server as a child process.
  The client communicates through standard input and standard output. The client environment supplies an API key or an mTLS credential.
- **streamable HTTP** (`HORIZON_TRANSPORT=http`) - Use this transport for a hosted server. Deploy one MCP instance for each Horizon instance.
  The server always reads the Horizon URL from `HORIZON_URL`. A client cannot supply the Horizon URL.
  One endpoint serves every client. The endpoint accepts `POST` only; each request carries its own credential and is
  served independently, so there is no session to keep. Scale to as many replicas as you need behind an ordinary load
  balancer, with no session affinity.

See [Streamable HTTP](#streamable-http-horizon_transporthttp) for the full HTTP configuration and [Authentication methods](#authentication-methods) for how callers are identified in HTTP mode.

### Hosting

Deploy one MCP instance for each Horizon instance. Keep the connection from the MCP to Horizon on an internal network.

Use a trusted TLS termination point for client connections. Store secrets in the orchestrator secret store.

The server provides `/healthz` for liveness probes. It provides `/readyz` for readiness probes.

The repository includes a production `Dockerfile`. For a local, loopback-only per-caller deployment, create an untracked `.env.http` file:

```dotenv
HORIZON_URL=https://horizon.example.com
HORIZON_HTTP_AUTH_METHODS=api-key,service
HORIZON_TRUSTED_HOSTS=localhost:8080,127.0.0.1:8080
```

Then build, run, and probe it:

```bash
docker build -t horizon-mcp .
docker run --rm --name horizon-mcp \
  --env-file .env.http \
  -p 127.0.0.1:8080:8080 \
  horizon-mcp

curl -H 'Host: localhost:8080' http://127.0.0.1:8080/healthz
curl -H 'Host: localhost:8080' http://127.0.0.1:8080/readyz
```

The image defaults to HTTP on `0.0.0.0:8080`. For remote hosting, terminate TLS at a trusted edge and set `HORIZON_PUBLIC_URL=https://mcp.example.com`. Every caller must present one whitelisted credential. See [docs/installation.md](docs/installation.md) for the container checklist and [docs/client-setup.md](docs/client-setup.md) for remote clients.

## MCP client setup

The binary name shipped by this package is **`horizon-mcp`** (declared in `package.json` `bin`). Use that exact name in every client configuration; do not call it `horizon-mcp-server`.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "horizon": {
      "command": "bunx",
      "args": ["@evertrust/horizon-mcp"],
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "<your-api-id>",
        "HORIZON_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

### Claude Code

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "horizon": {
      "command": "bunx",
      "args": ["@evertrust/horizon-mcp"],
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "<your-api-id>",
        "HORIZON_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

### Cursor

Create `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` for global access) with the same `mcpServers` block as Claude Code.

For Codex, OpenCode, and MCP Inspector configurations, see [docs/client-setup.md](docs/client-setup.md).

To use a standalone binary, set `command` to the absolute path of the binary. Remove the `args` field.

## Authentication methods

Horizon applies RBAC to the authenticated principal. The MCP does not duplicate Horizon RBAC.

The MCP can reduce the available operations with these controls:

- `HORIZON_READ_ONLY`.
- `HORIZON_ENABLED_TOOLSETS`.
- The implemented tool set.
- Explicit confirmation values for delete and flush operations.

The MCP does not grant access beyond the forwarded Horizon credential.

In stdio mode, the environment supplies the credential. In streamable HTTP mode, `HORIZON_HTTP_AUTH_METHODS` accepts one or more methods.

For example, `api-key,service` enables both of these methods:

- **`service`** - The client sends `X-API-SVA` and `X-API-TOKEN`. The MCP forwards both values directly to Horizon.
  The client can also send protected OAuth credentials. The MCP uses them to fetch and renew the JWT with `client_credentials`.
- **`api-key`** - The client sends `X-API-ID` and `X-API-KEY`. The MCP forwards both headers to Horizon.
- **`mtls`** - The client presents a TLS client certificate. The MCP or a trusted ingress terminates TLS and forwards the certificate.
  Horizon validates the certificate chain, revocation status, and identity. Most MCP clients require a local mTLS proxy.

The MCP rejects invalid or ambiguous authentication without a fallback. This rule includes the following conditions:

- The request has no credential.
- The selected method is not enabled.
- The request has an incomplete credential pair.
- The request has more than one complete credential type.

Use TLS for header credentials on all non-loopback deployments.

> [!IMPORTANT]
> **Breaking change** - The server no longer supports OIDC browser login with Playwright.
> HTTP service accounts use `X-API-SVA` and `X-API-TOKEN`.
> Third-party JWT renewal uses the headless OAuth `client_credentials` flow.

See [docs/authentication.md](docs/authentication.md) for the full step-by-step guide and troubleshooting tips.

## Tool catalog overview

The 212 tools are in 12 domains. Each tool has explicit usage guidance for smaller models.

The table at the top of this README gives the tool counts. The [tool reference](docs/tools-reference.md) gives safety tiers and descriptions.

Knowledge resources are exposed at `horizon://knowledge/*` URIs. See [docs/knowledge-resources.md](docs/knowledge-resources.md) for the full catalog.

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

```
List my certificates (resolve me with whoami first, then query owner and team).
```

### Certificate lifecycle

```
Enroll a new certificate through the WebRA-TLS profile with CN=app.example.com and SAN=DNS:app.example.com.
```

```
Download certificate abc123 in PKCS12 format with password "changeit".
```

```
Revoke the certificate with ID xyz789, reason: keyCompromise.
```

### Decoding and diagnostics

```
Decode this PEM CSR and tell me which extensions it requests.
```

```
Fetch the live TLS certificate from horizon.example.com:443 and report its grade.
```

```
Who am I authenticated as, and what permissions do I have?
```

```
Validate this HCQL query: dn matches ".*\.internal" and valid.until before 30d
```

### Datasources, validation, and notifications

```
List all configured external datasources.
```

```
Create a DNS datasource that looks up CNAME records for certificate SAN validation.
```

```
Build a REST notification that creates a ServiceNow incident when a certificate
is about to expire, and assigns it to the team that owns the certificate.
```

## Building standalone binaries

The `build:binary` script compiles the current package for the host platform:

```bash
bun run build:binary
# -> dist/horizon-mcp
```

`build:binaries` cross-compiles for all five supported targets (macOS x64/arm64, Linux x64/arm64, Windows x64):

```bash
bun run build:binaries
# -> dist/horizon-mcp-{darwin,linux,windows}-{x64,arm64}[.exe]
```

The standalone binaries bundle everything needed to run; no extra runtime dependencies are required.

## Development

```bash
bun install
source .env.local       # QA credentials for E2E and LLM tests
bun run validate:ci     # format:check + lint + typecheck + build + truth checks + docs diff + unit + LLM scenarios
```

More granular scripts:

| Command                 | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `bun run dev`           | Start the server with Bun (no build step).            |
| `bun run build`         | Production build via `tsup`.                          |
| `bun run test`          | Unit tests with Vitest.                               |
| `bun run test:coverage` | Unit tests with V8 coverage thresholds.               |
| `bun run test:e2e`      | E2E tests against a live Horizon instance.            |
| `bun run test:llm`      | Deterministic tool-selection scenarios (no LLM call). |
| `bun run test:llm:live` | Real Claude-in-the-loop MCP usability tests.          |
| `bun run lint`          | ESLint over `src/` and `tests/`.                      |
| `bun run typecheck`     | `tsc --noEmit` only.                                  |
| `bun run docs:refresh`  | Regenerate embedded docs from upstream sources.       |

### Live LLM evaluation (`test:llm:live`)

`bun run test:llm:live` runs the Claude Agent SDK against the local Horizon MCP server. Claude receives a controlled set of questions.

The test verifies that Claude selects the correct MCP tools. Run it after you change tool names, descriptions, or input schemas.

The deterministic ranker in `test:llm` gives a fast initial result. A real model gives a better test of user wording.

Prerequisites:

- `claude` CLI on `PATH` with an active subscription session (run `claude login` once)
- `HORIZON_E2E_*` credentials in the environment (`source .env.local` first)
- `ANTHROPIC_API_KEY` **unset** - the suite refuses to run against API billing to avoid surprise per-token charges. Subscription-only by design.

Cost / billing:

- Each scenario uses Claude Haiku 4.5 by default. Each scenario consumes Claude subscription credits.
- The number of turns changes with tool discovery and response size.
- A hard `maxBudgetUsd` cap (default `$0.50`) and `maxTurns` cap (default `10`) are enforced per scenario to bound any runaway loop. Individual scenarios can declare stricter or higher caps; the largest current scenario cap is `$1.00`.
- Override the model with `HORIZON_LLM_LIVE_MODEL=claude-sonnet-4-6 bun run test:llm:live` when you want a stricter fidelity check.

The suite is intentionally excluded from `validate:ci` so PR builds never burn subscription credits.

See [docs/development.md](docs/development.md) for environment setup, fixture management, and contribution tips.

## Troubleshooting

- **`No Horizon credentials configured`** - exactly one auth mode must be fully configured. Provide both API key variables (`HORIZON_API_ID` + `HORIZON_API_KEY`) or the mTLS variables (cert+key, or pfx). Startup fails closed if neither is set.
- **TLS handshake failures** - Make sure that `HORIZON_URL` uses `https://`. Make sure that the system store trusts the Horizon certificate authority.
  For development only, you can set `HORIZON_VERIFY_SSL=false`.
- **`HQL-001` parse errors** - HQL field names are lowercase (`contactemail`, not `contactEmail`). The two exceptions are `groupBy` and `sortedBy`, which are camelCase because they are API parameters rather than query fields. See `horizon://knowledge/query-languages`.
- **Version compatibility warnings** - the server logs a warning when the connected Horizon version is in `HORIZON_WARN_VERSIONS`. Functionality is best-effort on those versions; promote to `HORIZON_TESTED_VERSIONS` only after running your own E2E suite.

## Compatibility

| Horizon version | Status                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| 2.8.5+          | Tested (full feature set including Base64/Raw computation rules)                                                |
| 2.8.0-2.8.4     | Tested (Base64/Raw computation rules not available)                                                             |
| 2.7             | Expected to work (in `HORIZON_WARN_VERSIONS`)                                                                   |
| 2.9             | Expected to work (in `HORIZON_WARN_VERSIONS`)                                                                   |
| 2.10            | Point-in-time QA E2E run completed on 2026-07-02; not yet in the default `HORIZON_TESTED_VERSIONS` support list |

The operator can configure the version lists. By default, the server identifies only version 2.8 as tested.

The server identifies versions 2.7 and 2.9 as warning versions. The version 2.10 result applies only to the specified QA snapshot.

## What is not supported

The server supports many configuration objects. These objects include profiles, certificate authorities, connectors, roles, teams, triggers, and scheduled-task definitions.

The [tool reference](docs/tools-reference.md) gives the complete list. The following limitations are intentional:

- **Stored credential mutations** - credentials can be listed, but not created, updated, fetched with secret material, or deleted.
- **Identity-provider and service-account mutations** - these objects are inspectable through read-only tools only.
- **Principal administration** - there are no principal create/update/delete tools.
- **Certificate grading policy/ruleset mutations** - listing and inspection are supported; Horizon's covered API surface has no corresponding write tools.
- **Selected singleton or asymmetric APIs** - System configuration is update-only. Archives have no update tool.
  Scheduled-task definitions have CRUD tools but do not have a `run_scheduled_task` tool.
- **Analytics maintenance and SMTP server configuration** - sync/reindex operations and SMTP server administration are not registered.

## Contributing

Before you open a pull request, run `bun run validate:ci`. This command runs all required local checks.

If you have QA credentials, load `.env.local` first. QA credentials give more test coverage.

Use one-line conventional commit messages with the `type: description` format.

## Safety and trust caveats

> [!CAUTION]
> **Experimental software** - this MCP server is experimental and should only be used for exploratory purposes at this time.
>
> **Permissions** - Horizon enforces RBAC for the configured identity or caller identity. The MCP can further restrict the available operations.
> These restrictions cannot make an identity with excessive privileges safe. Use an identity with minimum privileges and use client approval controls.
>
> **No approval prompt guarantee** - Most tools that change data run when the client calls them. The MCP client controls approval prompts.
> Only the delete and flush tools require explicit confirmation parameters.
>
> **AI-generated output** - all output is AI-generated and should be subject to manual human validation before being relied upon.
>
> **Third-party AI providers** - The AI provider's terms of service and privacy policy apply to AI agents.
> The MCP server and Evertrust do not control these terms or policies.

## Documentation

| Document                                           | Contents                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| [Installation](docs/installation.md)               | Install methods and troubleshooting                                 |
| [Authentication](docs/authentication.md)           | Supported credential types with environment variable reference      |
| [Client setup](docs/client-setup.md)               | Claude Desktop, Claude Code, Cursor, Codex, OpenCode, MCP Inspector |
| [Tool reference](docs/tools-reference.md)          | All 212 tools by domain with safety tiers                           |
| [Knowledge resources](docs/knowledge-resources.md) | 17 core URIs, 4 curated playbooks, generated section resources      |
| [Development](docs/development.md)                 | Dev setup, tests, linting                                           |

## License

Copyright 2025-2026 [Evertrust](https://www.evertrust.fr/). Licensed under the [Apache License 2.0](LICENSE).

## Acknowledgements

This project was developed with the assistance of [Anthropic's Claude](https://www.anthropic.com/claude) and [OpenAI's Codex](https://chatgpt.com/codex).
