# horizon-mcp

[![npm version](https://img.shields.io/npm/v/@evertrust/horizon-mcp.svg)](https://www.npmjs.com/package/@evertrust/horizon-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/evertrust/horizon-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/evertrust/horizon-mcp/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io/) server for [Evertrust Horizon](https://www.evertrust.fr/) - a Certificate Lifecycle Management (CLM) platform. It lets MCP-compatible LLM clients (Claude Desktop, Claude Code, Cursor, Codex, OpenCode) drive certificate issuance, renewal and revocation, run HQL searches over certificates/requests/events, manage discovery campaigns and external datasources, decode X.509/CSR/CRL/OCSP/TSA payloads, and look up Evertrust's official product documentation through natural language. It is aimed at PKI engineers, platform teams and security operators who want to operate Horizon without leaving their IDE or chat client.

## Why knowledge-first?

Most MCP servers hand an LLM a list of tools and leave it to figure out the domain. horizon-mcp ships **17 core knowledge URIs**, **4 curated integration playbooks**, and generated section resources for the longest operational guides. Together they cover Horizon's query languages, profile modules, computation engine, workflows, RBAC model, discovery system, external datasources, validation rules, dictionary entries, REST notification connectors, and deterministic tool-selection guidance for smaller models. MCP clients can read these resources to ground tool selection and payload construction, but the server does not force a preload step or guarantee that every client will read them before acting.

## Features

- **211 tools across 12 domains**, each annotated with a safety tier (`read-only`, `mutating-safe`, `mutating-destructive`).
- **Knowledge catalog**: 17 core topic URIs, 4 curated playbooks, plus auto-generated section URIs derived from H2 headings of the longest guides.
- **Two credential types**: Horizon API key (`X-API-ID` / `X-API-KEY`) and TLS client certificate (PEM or PKCS12/PFX). Usable as a single server identity, or per caller over the HTTP transport.
- **HQL helpers**: validators and natural-language translators for HCQL (certificates), HRQL (requests), HEQL (events), and HDQL (discovery events).
- **Crypto decoding**: parse X.509, PKCS#10 CSR, PKCS#7, CRL, OCSP, and RFC 3161 timestamp responses to structured JSON without leaving the chat.
- **Confirmation safeguards**: every mutating tool emits a STOP confirmation block; destructive tools additionally require an `expected_name` parameter that must match the target object.
- **Standalone binaries** for macOS (x64/arm64), Linux (x64/arm64), and Windows (x64).

Tool counts per domain:

| Domain            | Tools | Highlights                                                            |
| ----------------- | ----: | --------------------------------------------------------------------- |
| Configuration     |   126 | CA / profile / RBAC / DCV / connector / policy CRUD (Horizon 2.8-2.10)|
| Assist            |    21 | `whoami`, grading, HQL validators, crypto decoders, simulators        |
| Lifecycle         |    17 | search/aggregate certs, requests, events, enroll, approve, revoke     |
| Dashboards        |    12 | dashboard CRUD, charts, saved HQL queries                             |
| Datasources       |     8 | DNS / LDAP / REST datasources, plus a `test_datasource` dry-run       |
| Discovery         |     6 | campaign CRUD and flush                                               |
| Triggers          |     6 | REST notifications and credential listing                             |
| Discovery feed    |     4 | push-mode certificate and event ingestion                             |
| Discovery events  |     3 | search, fetch, CSV export                                             |
| Reports           |     3 | list, download, delete                                                |
| Docs              |     3 | search product docs, search API docs, fetch a page                    |
| Profiles          |     2 | list and inspect (CRUD lives in the Horizon admin UI)                 |

Full per-tool table with safety tiers in [docs/tools-reference.md](docs/tools-reference.md).

## Prerequisites

- [Bun](https://bun.sh/) 1.x+ (recommended) or Node.js >= 24.10
- An Evertrust Horizon instance (tested on 2.8, expected to work on 2.7 and 2.9)
- API credentials or a client certificate for that instance

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

The server is configured entirely through `HORIZON_*` environment variables. A starter template lives in [.env.example](.env.example); copy it to `.env.local` and adjust.

The server auto-detects the authentication mode based on which variables are set. Priority order: **mTLS > API key**. If neither is configured, startup fails closed.

### Connection and authentication

| Variable                       | Required?         | Default              | Description                                                                                  |
| ------------------------------ | ----------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `HORIZON_URL`                  | Yes               | `https://localhost`  | Base URL of your Horizon instance. Trailing slash is stripped automatically.                 |
| `HORIZON_API_ID`               | API key mode      |                      | API key identifier.                                                                          |
| `HORIZON_API_KEY`              | API key mode      |                      | API key secret.                                                                              |
| `HORIZON_CLIENT_CERT`          | mTLS (PEM) mode   |                      | Filesystem path to a PEM client certificate.                                                 |
| `HORIZON_CLIENT_KEY`           | mTLS (PEM) mode   |                      | Filesystem path to the matching PEM private key.                                             |
| `HORIZON_CLIENT_KEY_PASSWORD`  | No                |                      | Decryption password for an encrypted PEM private key.                                        |
| `HORIZON_CLIENT_PFX`           | mTLS (PFX) mode   |                      | Filesystem path to a PKCS12 / PFX bundle.                                                    |
| `HORIZON_CLIENT_PFX_PASSWORD`  | No                |                      | Decryption password for the PKCS12 bundle.                                                   |
| `HORIZON_VERIFY_SSL`           | No                | `true`               | Set to `false` or `0` to skip TLS verification on the Horizon endpoint (development only).   |
| `HORIZON_ALLOW_PRIVATE_TLS_PROBE` | No             | (blocked)            | By default `fetch_exposed_certificate` refuses to connect to private/link-local IPs (SSRF guard). Set to `1` to permit probing internal hosts (e.g. `10.x`, `192.168.x`, `127.0.0.1`). |
| `HORIZON_TIMEOUT`              | No                | `30`                 | HTTP request timeout in seconds for standard API calls.                                      |
| `HORIZON_EXPORT_TIMEOUT`       | No                | `120`                | Timeout in seconds for CSV exports and other long-running endpoints.                         |
| `HORIZON_LOG_LEVEL`            | No                | `INFO`               | One of `DEBUG`, `INFO`, `WARNING`, `ERROR`.                                                  |
| `HORIZON_TESTED_VERSIONS`      | No                | `2.8`                | Comma-separated list of Horizon versions known to fully work with this build.                |
| `HORIZON_WARN_VERSIONS`        | No                | `2.7,2.9`            | Comma-separated list of versions that are likely to work but emit a warning.                 |
| `HORIZON_ENABLED_TOOLSETS`     | No                | (all)                | Comma-separated list of tool domains to register, trimming the context cost of the full tool set. Valid names: `lifecycle`, `profiles`, `dashboards`, `discovery`, `datasources`, `reports`, `triggers`, `docs`, `assist`, `config`. Unset registers every toolset; an unknown name fails startup. |
| `HORIZON_READ_ONLY`            | No                | `false`              | Set to `true` or `1` to register only read-only tools; every mutating tool (create/update/delete/submit/...) is skipped at startup. |
| `HORIZON_AUTH_MODE`            | DEPRECATED        |                      | No longer required. Kept readable for backward compatibility; setting it logs a warning.     |

### Streamable HTTP (`HORIZON_TRANSPORT=http`)

These variables apply only when `HORIZON_TRANSPORT=http`; in stdio mode they are ignored.

| Var                              | Default     | Notes                                                                                                                                                     |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HORIZON_TRANSPORT`              | `stdio`     | `stdio` \| `http`                                                                                                                                         |
| `HORIZON_HTTP_HOST`              | `127.0.0.1` | Bind address; `0.0.0.0` only behind a trusted edge.                                                                                                       |
| `HORIZON_HTTP_PORT`              | `8080`      | Bind port.                                                                                                                                                 |
| `HORIZON_HTTP_PATH`              | `/mcp`      | Endpoint path; absolute, no query or fragment; trailing slash normalized.                                                                                 |
| `HORIZON_PUBLIC_URL`             | (unset)     | Public origin/base URL clients reach the server at; the endpoint is `new URL(HORIZON_HTTP_PATH, HORIZON_PUBLIC_URL)`.                                      |
| `HORIZON_TRUSTED_HOSTS`          | derived     | Comma list of allowed `Host` values; derived from `HORIZON_PUBLIC_URL` or, on a loopback bind, the loopback hosts. A non-loopback bind with neither set refuses to start. |
| `HORIZON_TRUSTED_ORIGINS`        | (unset)     | Comma list of allowed CORS origins; unset means any request carrying an `Origin` is rejected (non-browser MCP clients send none).                         |
| `HORIZON_HTTP_AUTH_MODE`         | `service`   | `service` \| `api-key` \| `mtls`                                                                                                                          |
| `HORIZON_SESSION_IDLE_TTL`       | `300`       | Seconds.                                                                                                                                                   |
| `HORIZON_SESSION_ABS_TTL`        | `3600`      | Seconds.                                                                                                                                                   |
| `HORIZON_MAX_SESSIONS`           | `256`       | Max concurrent sessions.                                                                                                                                   |
| `HORIZON_MAX_INFLIGHT_TOOLCALLS` | `8`         | Per-session in-flight tool calls.                                                                                                                          |
| `HORIZON_MAX_BODY_BYTES`         | `1048576`   | Max request body bytes (1 MiB).                                                                                                                            |
| `HORIZON_SSE_MAX_DURATION`       | `3600`      | Max SSE stream lifetime, seconds.                                                                                                                          |
| `HORIZON_RATE_LIMIT_RPS`         | `20`        | Per-session limit, counted per JSON-RPC message per second; `0` disables.                                                                                 |
| `HORIZON_INIT_RATE_LIMIT`        | `5`         | Pre-session `initialize` attempts per second (global cap and per remote address); `0` disables.                                                           |
| `HORIZON_IP_RATE_LIMIT`          | `600`       | Coarse per-IP request cap per second, a defense-in-depth backstop in front of the per-session limits; `0` disables.                                        |

Inbound mTLS settings (only when `HORIZON_HTTP_AUTH_MODE=mtls`):

| Var                                              | Notes                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HORIZON_HTTP_TLS_CERT` / `HORIZON_HTTP_TLS_KEY` | MCP terminates client TLS itself with its own server cert/key (requests a client cert without requiring a trusted CA).                                         |
| `HORIZON_INBOUND_CERT_HEADER`                    | Alternative: a trusted ingress terminates client TLS and forwards the client cert to the MCP in this header.                                                   |
| `HORIZON_TRUSTED_PROXY`                          | IP/CIDR the inbound cert header is accepted from; REQUIRED with `HORIZON_INBOUND_CERT_HEADER`; matched on the direct TCP socket peer, never `X-Forwarded-For`. |
| `HORIZON_FORWARD_CERT_HEADER`                    | Horizon-facing header the MCP sets with the captured cert; default `SSL_CLIENT_CERT` to match Horizon's `security.http.headers.certificate`; value is a URL-encoded PEM. |

`HORIZON_URL` and the existing auth env vars (`HORIZON_API_ID`/`HORIZON_API_KEY`, `HORIZON_CLIENT_CERT`/`HORIZON_CLIENT_KEY`/`HORIZON_CLIENT_PFX`) are unchanged. In per-caller `mtls` mode `HORIZON_URL` must point at the internal Horizon Play backend that trusts the forwarded cert header (bypassing Horizon's own nginx). HTTP mode refuses to start if `HORIZON_ALLOW_PRIVATE_TLS_PROBE=1`.

### Development and testing

These variables are read by the test suite only and never by the server itself:

| Variable               | Used by                  | Description                                                  |
| ---------------------- | ------------------------ | ------------------------------------------------------------ |
| `HORIZON_E2E_URL`      | `bun run test:e2e`       | Base URL of the Horizon instance for E2E tests.              |
| `HORIZON_E2E_API_ID`   | `bun run test:e2e`       | API key identifier for E2E tests.                            |
| `HORIZON_E2E_API_KEY`  | `bun run test:e2e`       | API key secret for E2E tests.                                |
| `HORIZON_LLM_EVAL_MODEL` | `bun run test:llm`     | Model identifier used by the LLM evaluation harness.         |

## Transports

The server speaks MCP over one of two transports, selected by `HORIZON_TRANSPORT`.

- **stdio** (default) - local, single user. The MCP client launches the server as a child process and talks to it over stdin/stdout. The credential comes from the environment the client sets (an API key or mTLS to Horizon). This is the right choice for a developer running the server next to their IDE or chat client.
- **streamable HTTP** (`HORIZON_TRANSPORT=http`) - hosted next to its Horizon, one MCP instance per Horizon. The Horizon URL is always taken from the `HORIZON_URL` environment variable and is never supplied by the client, so there is no multi-tenant routing. A single endpoint (default `/mcp`) serves multiple concurrent client sessions over `POST` / `GET` / `DELETE` with Server-Sent Events (SSE) responses, and each caller's session is isolated. Run a single replica to avoid session affinity; if you must scale out, route on the `Mcp-Session-Id` header so a session always lands on the same replica.

See [Streamable HTTP](#streamable-http-horizon_transporthttp) for the full HTTP configuration and [Authentication modes](#authentication-modes) for how callers are identified in HTTP mode.

### Hosting

Deploy one MCP per Horizon, co-located so the MCP-to-Horizon hop stays internal. Reuse Horizon's existing edge (its TLS termination and access control) for the client-to-MCP path rather than exposing the MCP unauthenticated, and pull secrets from your orchestrator's secret store. The server exposes `/healthz` (liveness) and `/readyz` (readiness) endpoints for container probes.

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

For Codex, OpenCode, and MCP Inspector configurations, see [docs/client-setup.md](docs/client-setup.md). To point any of the above clients at a standalone binary instead of `bunx`, replace `command` with the absolute path to the downloaded binary and drop the `args` field.

## Authentication modes

The MCP supports exactly two credential types against Horizon: a **Horizon API key** (`X-API-ID` / `X-API-KEY`) and a **TLS client certificate** (supplied as PEM or PKCS12 / PFX, see the [Connection and authentication](#connection-and-authentication) table). The MCP never makes authorization decisions of its own: it forwards a Horizon credential and Horizon applies that principal's RBAC.

In stdio mode the credential comes from the environment. In streamable HTTP mode, `HORIZON_HTTP_AUTH_MODE` selects how each caller's identity is established:

- **`service`** - the MCP holds one env credential (an API key or mTLS to Horizon) and acts as a single identity for every caller; clients send only the URL. The anti-hijack session fingerprint does not apply in this mode (`Mcp-Session-Id` behaves as a bearer), so the front door must be access-controlled by network placement or an authenticating edge; use a least-privileged identity.
- **`api-key`** (per-caller) - the client sends its own `X-API-ID` / `X-API-KEY`, which the MCP forwards to Horizon. This forwards a long-lived secret through the MCP, so on a non-loopback bind the endpoint must terminate TLS (set `HORIZON_PUBLIC_URL` to an `https` origin behind a TLS-terminating proxy); a cleartext `http` endpoint on a non-loopback host refuses to start.
- **`mtls`** (per-caller, terminate-and-forward) - the client presents a TLS client certificate; the MCP (or a trusted ingress) terminates the TLS with `optional_no_ca` semantics (proving possession, not validating the chain) and forwards the certificate to Horizon's Play backend in `HORIZON_FORWARD_CERT_HEADER`. Horizon validates the chain, revocation, and identity. No long-lived secret is forwarded. Most MCP clients cannot present a client certificate, so a local mTLS proxy on the client side is usually needed (see [docs/client-setup.md](docs/client-setup.md)).

> [!IMPORTANT]
> **Breaking change** - OIDC browser login (Playwright) has been **removed** in all transports, stdio included. Users who relied on it must switch to an API key or mTLS. A headless OIDC bearer token is deferred until Horizon supports a forwardable token.

See [docs/authentication.md](docs/authentication.md) for the full step-by-step guide and troubleshooting tips.

## Tool catalog overview

The 211 tools are grouped into 12 domains. Each tool ships with explicit "use when / do not use when" guidance for smaller models. The table at the top of this README lists tool counts; [docs/tools-reference.md](docs/tools-reference.md) has the full per-tool table with safety tiers and one-line descriptions.

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

| Command                  | Purpose                                                 |
| ------------------------ | ------------------------------------------------------- |
| `bun run dev`            | Start the server with `tsx` (no build step).            |
| `bun run build`          | Production build via `tsup`.                            |
| `bun run test`           | Unit tests with Vitest (80%+ coverage threshold).       |
| `bun run test:e2e`       | E2E tests against a live Horizon instance.              |
| `bun run test:llm`       | Deterministic tool-selection scenarios (no LLM call).   |
| `bun run test:llm:live`  | Real Claude-in-the-loop MCP usability tests.            |
| `bun run lint`           | ESLint over `src/` and `tests/`.                        |
| `bun run typecheck`      | `tsc --noEmit` only.                                    |
| `bun run docs:refresh`   | Regenerate embedded docs from upstream sources.         |

### Live LLM evaluation (`test:llm:live`)

`bun run test:llm:live` drives the real Claude Agent SDK against the local Horizon MCP server, asking Claude a curated set of natural-language questions and asserting that it picks the right MCP tools. Use it before merging changes that alter tool names, descriptions, or input schemas - the deterministic ranker in `test:llm` is a fast proxy, but only a real model exposes whether your wording works for an actual user.

Prerequisites:

- `claude` CLI on `PATH` with an active subscription session (run `claude login` once)
- `HORIZON_E2E_*` credentials in the environment (`source .env.local` first)
- `ANTHROPIC_API_KEY` **unset** - the suite refuses to run against API billing to avoid surprise per-token charges. Subscription-only by design.

Cost / billing:

- Each scenario consumes one or two Claude Haiku 4.5 turns drawn from your Claude plan's credits (or the dedicated Agent SDK monthly credit after Anthropic's 2026-06-15 billing change).
- A hard `maxBudgetUsd` cap (default `$0.05`) and `maxTurns` cap (default `2`) are enforced per scenario to bound any runaway loop.
- Override the model with `HORIZON_LLM_LIVE_MODEL=claude-sonnet-4-6 bun run test:llm:live` when you want a stricter fidelity check.

The suite is intentionally excluded from `validate:ci` so PR builds never burn subscription credits.

See [docs/development.md](docs/development.md) for environment setup, fixture management, and contribution tips.

## Troubleshooting

- **`No Horizon credentials configured`** - exactly one auth mode must be fully configured. Provide both API key variables (`HORIZON_API_ID` + `HORIZON_API_KEY`) or the mTLS variables (cert+key, or pfx). Startup fails closed if neither is set.
- **TLS handshake failures** - check `HORIZON_URL` uses `https://`, that the Horizon CA is trusted by your system store, and (for development only) that `HORIZON_VERIFY_SSL=false` is honoured.
- **`HQL-001` parse errors** - HQL field names are lowercase (`contactemail`, not `contactEmail`). The two exceptions are `groupBy` and `sortedBy`, which are camelCase because they are API parameters rather than query fields. See `horizon://knowledge/query-languages`.
- **Version compatibility warnings** - the server logs a warning when the connected Horizon version is in `HORIZON_WARN_VERSIONS`. Functionality is best-effort on those versions; promote to `HORIZON_TESTED_VERSIONS` only after running your own E2E suite.

## Compatibility

| Horizon version | Status                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| 2.8.5+          | Tested (full feature set including Base64/Raw computation rules)        |
| 2.8.0-2.8.4     | Tested (Base64/Raw computation rules not available)                     |
| 2.7             | Expected to work (in `HORIZON_WARN_VERSIONS`)                           |
| 2.9             | Expected to work (in `HORIZON_WARN_VERSIONS`)                           |

## What is not supported

The following capabilities require direct Horizon API calls or the Horizon UI:

- **Configuration objects** - CAs, trust chains, labels, HTTP proxies, password policies, grading policies, and grading rulesets
- **Profile management** - creating, updating, or deleting profiles (read-only listing and inspection are supported)
- **Credential management** - creating, updating, or deleting stored credentials (read-only listing IS supported via `list_credentials`)
- **PKI and third-party connector management** - connectors to ADCS, EJBCA, HashiCorp Vault, etc.
- **Email/webhook trigger management** - email and webhook (Teams/Slack/Mattermost) triggers (REST notifications ARE supported via `create_rest_notification`)
- **Trigger attachment to profiles** - use the Horizon admin UI or profile API
- **Role, team, IDP, and principal administration**
- **Analytics** - sync status and reindex operations
- **SMTP and notification server configuration**
- **Intune, Jamf, and MDM integration setup**
- **Scheduler and system-level automation**

## Contributing

PRs welcome. Before opening a pull request, run `bun run validate:ci` (it runs formatting, lint, typecheck, build, truth checks, docs diff, unit tests, and the LLM scenario suite). Source `.env.local` first if you have QA credentials; the LLM scenarios degrade gracefully without them but you get more signal with them set. Keep commits to one-line conventional messages (`type: description`).

## Safety and trust caveats

> [!CAUTION]
> **Experimental software** - this MCP server is experimental and should only be used for exploratory purposes at this time.
>
> **Permissions** - the MCP server authenticates as the configured user and the AI agent operates with that user's full permissions. Evertrust recommends against granting AI agents highly privileged access to the CLM to prevent unintended incidents.
>
> **No guaranteed boundaries** - while the MCP server attempts to enforce permission boundaries between the user and the AI agent, this may not work in all cases. Users bear sole responsibility for actions taken by the AI agent on their behalf.
>
> **AI-generated output** - all output is AI-generated and should be subject to manual human validation before being relied upon.
>
> **Third-party AI providers** - use of AI agents is subject to the terms of service and privacy policy of the AI provider. These are not controlled by the MCP server or by Evertrust.

## Documentation

| Document                                          | Contents                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Installation](docs/installation.md)              | Install methods and troubleshooting                                            |
| [Authentication](docs/authentication.md)          | Supported credential types with environment variable reference                 |
| [Client setup](docs/client-setup.md)              | Claude Desktop, Claude Code, Cursor, Codex, OpenCode, MCP Inspector            |
| [Tool reference](docs/tools-reference.md)         | All 211 tools by domain with safety tiers                                      |
| [Knowledge resources](docs/knowledge-resources.md)| 17 core URIs, 4 curated playbooks, generated section resources                 |
| [Development](docs/development.md)                | Dev setup, tests, linting                                                      |

## License

Copyright 2025-2026 [Evertrust](https://www.evertrust.fr/). Licensed under the [Apache License 2.0](LICENSE).

## Acknowledgements

This project was developed with the assistance of [Anthropic's Claude](https://www.anthropic.com/claude) and [OpenAI's Codex](https://chatgpt.com/codex).
