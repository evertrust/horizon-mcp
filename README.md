# horizon-mcp

[![npm version](https://img.shields.io/npm/v/@evertrust/horizon-mcp.svg)](https://www.npmjs.com/package/@evertrust/horizon-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/evertrust/horizon-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/evertrust/horizon-mcp/actions/workflows/ci.yml)

Horizon MCP is an [MCP](https://modelcontextprotocol.io/) server for [Evertrust Horizon](https://www.evertrust.fr/). Horizon is a certificate lifecycle management (CLM) platform.

The server lets a supported MCP client operate Horizon: Claude Desktop, Claude Code, Cursor, Codex, and OpenCode.

PKI engineers, platform teams, and security operators can issue, renew, and revoke certificates from an integrated development environment or a chat interface. They can also search Horizon data, manage discovery, decode cryptographic data, and read the product documentation.

## Why knowledge-first?

Horizon MCP ships both the tools and the domain knowledge to use them. The catalog holds **111 knowledge URIs**: **18 core knowledge guides**, **4 integration playbooks**, and **89 generated section resources**.

These resources explain Horizon concepts and help a client pick the right tool. A client can read them before it selects a tool or builds a payload.

The server does not preload these resources and cannot guarantee that a client reads them before an operation.

## Features

- **222 tools across 12 domains**, each with a safety tier (`read-only`, `mutating-safe`, `mutating-destructive`).
- **Knowledge catalog**: 111 registered topic URIs: 18 core guides, 4 curated playbooks, and 89 generated section resources.
- **Three HTTP authentication methods**: Horizon API key, TLS client certificate, and JWKS service-account JWT. The allowlist can turn on more than one method.
- **Service JWT renewal**: The server can use OAuth `client_credentials` to fetch and renew a short-lived stdio or HTTP caller JWT.
- **HQL helpers**: validators and natural-language translators for HCQL (certificates), HRQL (requests), HEQL (events), and HDQL (discovery events).
- **Crypto decoding**: Parse X.509, PKCS#10 CSR, PKCS#7, CRL, OCSP, and RFC 3161 timestamp responses.
  The tools return structured JSON in the chat.
- **Destructive-operation safeguards**: `delete_*` and `flush_*` tools need an exact `expected_*` confirmation value.
  Every other change runs as soon as the client calls it. Use the client approval controls and a Horizon identity with minimum privileges.
- **Standalone binaries** for macOS (x64/arm64), Linux (x64/arm64), and Windows (x64).

Tool counts per domain:

| Domain           | Tools | Highlights                                                                              |
| ---------------- | ----: | --------------------------------------------------------------------------------------- |
| Configuration    |   129 | CA / profile / RBAC / DCV / connector / policy administration, including 2.10 additions |
| Assist           |    21 | `whoami`, grading, HQL validators, crypto decoders, simulators                          |
| Lifecycle        |    24 | search and aggregate certificates, requests, events, enrollment, DCV runs               |
| Dashboards       |    12 | dashboard CRUD, charts, saved HQL queries                                               |
| Datasources      |     8 | DNS / LDAP / REST datasources, plus a `test_datasource` dry-run                         |
| Discovery        |     6 | campaign CRUD and flush                                                                 |
| Triggers         |     6 | REST notifications and credential listing                                               |
| Discovery feed   |     4 | push-mode certificate and event ingestion                                               |
| Discovery events |     3 | search, fetch, CSV export                                                               |
| Reports          |     3 | list, download, delete                                                                  |
| Docs             |     4 | search product docs, search API docs, fetch a page, read knowledge                      |
| Profiles         |     2 | list and inspect convenience tools. Profile mutations live in the Configuration toolset |

The full per-tool table with safety tiers is in [docs/tools-reference.md](docs/tools-reference.md).

## Prerequisites

- [Bun](https://bun.sh/) 1.x+ (recommended) or Node.js >= 24.10
- An Evertrust Horizon instance (tested on 2.10, expected to work on 2.8 and 2.9)
- API credentials, a service-account JWT, or a client certificate for that instance
- An MCP client that supports protocol revision **2026-07-28**. Version 3.0.0 serves that revision only.
  Before you upgrade, check [docs/client-setup.md](docs/client-setup.md#client-compatibility). If your client is older, stay on 2.x.

## Install

### Option 1 - run from npm with bunx or npx

No install needed:

```bash
bunx @evertrust/horizon-mcp
# or
npx -y @evertrust/horizon-mcp
```

### Option 2 - standalone binary

Download the prebuilt binary for your platform from the [releases page](https://github.com/evertrust/horizon-mcp/releases). The release artifacts are:

- `horizon-mcp-darwin-x64`
- `horizon-mcp-darwin-arm64`
- `horizon-mcp-linux-x64`
- `horizon-mcp-linux-arm64`
- `horizon-mcp-windows-x64.exe`

Make the binary executable. Then run the binary:

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

Configure the server with the `HORIZON_*` environment variables. Copy [.env.example](.env.example) to `.env.local`. Change the values for your environment.

In stdio mode the server needs exactly one complete authentication method. The API key,
service-account, PEM mTLS, and PFX mTLS credentials are mutually exclusive. If you configure
no credential, or more than one, the server does not start.

In HTTP mode the server holds no credential of its own. Each caller sends one on every
request. See [Authentication methods](#authentication-methods).

### Connection and authentication

| Variable                          | Required?       | Default             | Description                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HORIZON_URL`                     | Yes             | `https://localhost` | Base URL of your Horizon instance. The server strips a trailing slash.                                                                                                                                                                                                                                                                                                               |
| `HORIZON_API_ID`                  | API key mode    |                     | API key identifier.                                                                                                                                                                                                                                                                                                                                                                  |
| `HORIZON_API_KEY`                 | API key mode    |                     | API key secret.                                                                                                                                                                                                                                                                                                                                                                      |
| `HORIZON_SERVICE_ACCOUNT`         | Service mode    |                     | Horizon service-account name (maximum 255 characters).                                                                                                                                                                                                                                                                                                                               |
| `HORIZON_API_TOKEN`               | Service mode    |                     | Initial JWKS service-account JWT that the server forwards to Horizon (maximum 16,384 characters). One stdio configuration can omit it: see the startup mint below the table.                                                                                                                                                                                                         |
| `HORIZON_OAUTH_CLIENT_ID`         | Renewal         |                     | OAuth `client_credentials` client identifier (maximum 512 characters). Set it together with `HORIZON_OAUTH_CLIENT_SECRET`.                                                                                                                                                                                                                                                           |
| `HORIZON_OAUTH_CLIENT_SECRET`     | Renewal         |                     | OAuth client secret (maximum 4,096 characters). Set it together with `HORIZON_OAUTH_CLIENT_ID`.                                                                                                                                                                                                                                                                                      |
| `HORIZON_OAUTH_SCOPE`             | No              |                     | Provider-specific OAuth scope (maximum 2,048 characters). Valid only with the complete OAuth client pair.                                                                                                                                                                                                                                                                            |
| `HORIZON_OAUTH_AUDIENCE`          | No              |                     | Provider-specific OAuth audience (maximum 2,048 characters). Valid only with the complete OAuth client pair.                                                                                                                                                                                                                                                                         |
| `HORIZON_OAUTH_ISSUERS`           | No              |                     | Operator-pinned JSON map for service-account renewal (maximum 65,536 characters). Each issuer URL maps to a `tokenUrl` and an `authMethod`, either `client_secret_basic` or `client_secret_post`. Issuer keys and token URLs must be absolute HTTPS URLs.                                                                                                                            |
| `HORIZON_CLIENT_CERT`             | mTLS (PEM) mode |                     | Filesystem path to a PEM client certificate.                                                                                                                                                                                                                                                                                                                                         |
| `HORIZON_CLIENT_KEY`              | mTLS (PEM) mode |                     | Filesystem path to the matching PEM private key.                                                                                                                                                                                                                                                                                                                                     |
| `HORIZON_CLIENT_KEY_PASSWORD`     | No              |                     | Decryption password for an encrypted PEM private key.                                                                                                                                                                                                                                                                                                                                |
| `HORIZON_CLIENT_PFX`              | mTLS (PFX) mode |                     | Filesystem path to a PKCS12 / PFX bundle.                                                                                                                                                                                                                                                                                                                                            |
| `HORIZON_CLIENT_PFX_PASSWORD`     | No              |                     | Decryption password for the PKCS12 bundle.                                                                                                                                                                                                                                                                                                                                           |
| `HORIZON_VERIFY_SSL`              | No              | `true`              | Set to `false` or `0` to skip TLS verification on the Horizon endpoint. Use it in development only. It requires Node.                                                                                                                                                                                                                                                                |
| `HORIZON_ALLOW_PRIVATE_TLS_PROBE` | No              | (blocked)           | By default, `fetch_exposed_certificate` refuses to connect to private or link-local IPs (SSRF guard). Set to `1` to let it probe internal hosts such as `10.x`, `192.168.x`, and `127.0.0.1`. Stdio mode only: if you set `1`, HTTP mode does not start.                                                                                                                             |
| `HORIZON_TIMEOUT`                 | No              | `30`                | HTTP request timeout in seconds for standard API calls.                                                                                                                                                                                                                                                                                                                              |
| `HORIZON_EXPORT_TIMEOUT`          | No              | `120`               | Timeout in seconds for CSV exports and other long-running endpoints.                                                                                                                                                                                                                                                                                                                 |
| `HORIZON_LOG_LEVEL`               | No              | `INFO`              | One of `DEBUG`, `INFO`, `WARNING`, `ERROR`.                                                                                                                                                                                                                                                                                                                                          |
| `HORIZON_TESTED_VERSIONS`         | No              | `2.10`              | Comma-separated list of Horizon versions known to fully work with this build.                                                                                                                                                                                                                                                                                                        |
| `HORIZON_WARN_VERSIONS`           | No              | `2.8,2.9`           | Comma-separated list of versions that probably work. The server logs a warning when it connects to one of them.                                                                                                                                                                                                                                                                      |
| `HORIZON_ENABLED_TOOLSETS`        | No              | (all)               | Comma-separated list of tool domains to register. A shorter list cuts the context cost of the full tool set. Valid names: `lifecycle`, `profiles`, `dashboards`, `discovery`, `datasources`, `reports`, `triggers`, `docs`, `assist`, `config`. If you leave it unset, the server registers every toolset. An unknown name stops startup. See the mapping to the domain table below. |
| `HORIZON_READ_ONLY`               | No              | `false`             | Set to `true` or `1` to register only the read-only tools. The server then skips every mutating tool (create/update/delete/submit/...) at startup.                                                                                                                                                                                                                                   |
| `HORIZON_AUTH_MODE`               | DEPRECATED      |                     | No longer needed. The server still reads it for backward compatibility. If you set it, the server logs a warning.                                                                                                                                                                                                                                                                    |

**Startup mint.** Stdio can omit `HORIZON_API_TOKEN` when you set the OAuth client pair and `HORIZON_OAUTH_ISSUERS` pins exactly one issuer. The server then mints the first token at startup. If minting fails, stdio logs a sanitized error and keeps serving, and tool calls retry after the 30-second cooldown. HTTP mode does not change: it always needs `X-API-TOKEN`.

**Toolset names.** The `HORIZON_ENABLED_TOOLSETS` names map to the domain table above. The `discovery` name registers the Discovery, Discovery events, and Discovery feed domains. The `config` name registers Configuration. Every other domain uses its own lowercase name.

### Streamable HTTP (`HORIZON_TRANSPORT=http`)

These variables apply only when `HORIZON_TRANSPORT=http`. In stdio mode the server ignores them.

| Var                                 | Default     | Notes                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HORIZON_TRANSPORT`                 | `stdio`     | `stdio` \| `http`                                                                                                                                                                                                                                                        |
| `HORIZON_HTTP_HOST`                 | `127.0.0.1` | Bind address. Use `0.0.0.0` only behind a trusted edge.                                                                                                                                                                                                                  |
| `HORIZON_HTTP_PORT`                 | `8080`      | Bind port.                                                                                                                                                                                                                                                               |
| `HORIZON_HTTP_PATH`                 | `/mcp`      | Endpoint path. It must be absolute, with no query and no fragment. The server normalizes a trailing slash.                                                                                                                                                               |
| `HORIZON_PUBLIC_URL`                | (unset)     | Public origin or base URL that clients use to reach the server. The endpoint is `new URL(HORIZON_HTTP_PATH, HORIZON_PUBLIC_URL)`.                                                                                                                                        |
| `HORIZON_TRUSTED_HOSTS`             | derived     | Comma list of allowed `Host` values. The server derives it from `HORIZON_PUBLIC_URL` or, on a loopback bind, from the loopback hosts. If you bind to a non-loopback address and set neither `HORIZON_PUBLIC_URL` nor `HORIZON_TRUSTED_HOSTS`, the server does not start. |
| `HORIZON_TRUSTED_ORIGINS`           | (unset)     | Comma list of allowed CORS origins. If you leave it unset, the server rejects every request that carries an `Origin` header. Non-browser MCP clients send none.                                                                                                          |
| `HORIZON_HTTP_AUTH_METHODS`         | `api-key`   | Comma- or pipe-separated allowlist of `api-key`, `mtls`, and `service`. You can turn on more than one method.                                                                                                                                                            |
| `HORIZON_MAX_CONCURRENT_REQUESTS`   | `32`        | Maximum non-listen requests served at once across all callers (valid range `1` to `256`). This setting bounds the memory that non-listen requests use.                                                                                                                   |
| `HORIZON_MAX_INFLIGHT_TOOLCALLS`    | `8`         | Maximum non-listen requests served at once for a single caller. One busy client cannot consume the whole budget above.                                                                                                                                                   |
| `HORIZON_MAX_LISTEN_STREAMS_GLOBAL` | `8`         | Maximum listen streams across all callers (valid range `1` to `64`). Listen streams use this dedicated pair. They do not consume the request or tool-call concurrency budgets.                                                                                           |
| `HORIZON_MAX_LISTEN_STREAMS`        | `2`         | Maximum listen streams served at once for a single caller (valid range `1` to `16`). This limit pairs with the dedicated global listen budget above.                                                                                                                     |
| `HORIZON_CREDENTIAL_CACHE_MAX`      | `64`        | How many validated caller credentials stay available for reuse (hard ceiling `512`). A retired entry stays alive only while in-flight requests still lease it.                                                                                                           |
| `HORIZON_CREDENTIAL_CACHE_TTL`      | `300`       | Seconds that the server reuses a cached credential before it retires the credential and revalidates it against Horizon (`30` to `3600`). See credential retirement below the table.                                                                                      |
| `HORIZON_VALIDATION_RATE_LIMIT`     | `5`         | Credential validations per second per peer against Horizon (`0` to `100`). Set `0` to disable the limit. The aggregate cap is four times this value.                                                                                                                     |
| `HORIZON_MAX_BODY_BYTES`            | `1048576`   | Maximum request body size in bytes (1 MiB).                                                                                                                                                                                                                              |
| `HORIZON_SSE_MAX_DURATION`          | `3600`      | Absolute lifetime in seconds for each admitted MCP response, including notification streams (`1` to `86400`). SSE keep-alives do not reset it. It must be greater than `HORIZON_EXPORT_TIMEOUT` to leave headroom above the export budget.                               |
| `HORIZON_SSE_KEEP_ALIVE`            | `15`        | Seconds between SSE keep-alive comments (`1` to `60`).                                                                                                                                                                                                                   |
| `HORIZON_RATE_LIMIT_RPS`            | `20`        | Per-caller limit, counted per JSON-RPC message per second. Set `0` to disable it.                                                                                                                                                                                        |
| `HORIZON_IP_RATE_LIMIT`             | `600`       | Coarse per-IP request cap per second. The cap is a defense-in-depth backstop in front of the per-caller limits. Set `0` to disable it.                                                                                                                                   |

**Credential retirement.** The `HORIZON_CREDENTIAL_CACHE_TTL` count starts at validation, not at last use. A non-CSRF Horizon `401` or `403` that reaches the end of the authentication-retry path retires the credential at once, whatever the TTL. Before that, the Horizon client tries to re-authenticate once, unless the re-authentication backoff suppresses it. Retirement blocks new reuse at once. Revalidation happens on the first request after retirement, and cleanup waits for the in-flight requests.

#### Removed in 3.0.0

| Removed variable           | Replacement                                          |
| -------------------------- | ---------------------------------------------------- |
| `HORIZON_SESSION_IDLE_TTL` | `HORIZON_CREDENTIAL_CACHE_TTL`                       |
| `HORIZON_SESSION_ABS_TTL`  | `HORIZON_CREDENTIAL_CACHE_TTL`                       |
| `HORIZON_MAX_SESSIONS`     | `HORIZON_MAX_CONCURRENT_REQUESTS`                    |
| `HORIZON_INIT_RATE_LIMIT`  | `HORIZON_RATE_LIMIT_RPS` and `HORIZON_IP_RATE_LIMIT` |
| `HORIZON_HTTP_AUTH_MODE`   | `HORIZON_HTTP_AUTH_METHODS`                          |

Under Node, if an MCP client disconnects, the server cancels the credential validation and any
in-flight Horizon requests for that call.

Size the memory for non-listen requests from `HORIZON_MAX_CONCURRENT_REQUESTS`, not from request throughput. The server
builds one short-lived tool registry per request. Each registry costs about 1.3 MiB, on top of a process baseline of
about 365 MiB. The default of 32 concurrent requests fits in a 1 GiB container. Listen streams have the separate global
and per-caller limits above. Test under load before you raise any concurrency limit.

Inbound mTLS settings, for when `HORIZON_HTTP_AUTH_METHODS` includes `mtls`:

| Var                                              | Notes                                                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HORIZON_HTTP_TLS_CERT` / `HORIZON_HTTP_TLS_KEY` | The server terminates client TLS itself with its own server certificate and key. It requests a client certificate, but it does not need a trusted CA.                                                        |
| `HORIZON_INBOUND_CERT_HEADER`                    | Alternative: a trusted ingress terminates client TLS and forwards the client certificate to the server in this header.                                                                                       |
| `HORIZON_TRUSTED_PROXY`                          | IP or CIDR that the server accepts the inbound certificate header from. You must set it with `HORIZON_INBOUND_CERT_HEADER`. The server matches it on the direct TCP socket peer, never on `X-Forwarded-For`. |
| `HORIZON_FORWARD_CERT_HEADER`                    | Horizon-facing header that the server sets with the captured certificate. The default is `SSL_CLIENT_CERT`, to match Horizon's `security.http.headers.certificate`. The value is a URL-encoded PEM.          |

`HORIZON_URL` and the existing authentication variables are unchanged. In `mtls` mode, set `HORIZON_URL` to the internal Horizon Play backend. That backend must trust the forwarded certificate header, and the connection to it bypasses the Horizon nginx server.

### Development and testing

Only the test suite reads these variables. The server never reads them:

| Variable                 | Used by                 | Description                                                                            |
| ------------------------ | ----------------------- | -------------------------------------------------------------------------------------- |
| `HORIZON_E2E_URL`        | `bun run test:e2e`      | Base URL of the Horizon instance for E2E tests.                                        |
| `HORIZON_E2E_API_ID`     | `bun run test:e2e`      | API key identifier for API-key E2E tests.                                              |
| `HORIZON_E2E_API_KEY`    | `bun run test:e2e`      | API key secret for API-key E2E tests.                                                  |
| `HORIZON_E2E_SVA`        | `bun run test:e2e`      | Service-account name for the service-account authentication E2E suite.                 |
| `HORIZON_E2E_SVA_TOKEN`  | `bun run test:e2e`      | JWT for the service-account authentication E2E suite.                                  |
| `HORIZON_LLM_LIVE_MODEL` | `bun run test:llm:live` | Model override for the live LLM evaluation harness. The default is `claude-haiku-4-5`. |

## Transports

`HORIZON_TRANSPORT` selects one of two MCP transports.

- **stdio** (default) - Use this transport for one local user. The MCP client starts the server as a child process.
  The client communicates through standard input and standard output. The client environment supplies an API key,
  a service-account JWT, or an mTLS credential.
- **streamable HTTP** (`HORIZON_TRANSPORT=http`) - Use this transport for a hosted server. Deploy one MCP instance for each Horizon instance.
  The server always reads the Horizon URL from `HORIZON_URL`. A client cannot supply the Horizon URL.
  One endpoint serves every client. The endpoint accepts `POST` only. Each request carries its own credential, and the
  server serves each request independently, so there is no session to keep. Run as many replicas as you need behind an
  ordinary load balancer, with no session affinity.

This documentation calls the streamable HTTP transport **HTTP mode**. The server holds no credential of its own in HTTP mode, and each caller sends its own credential on every request.

For the full HTTP configuration, see [Streamable HTTP](#streamable-http-horizon_transporthttp). For how the server identifies a caller in HTTP mode, see [Authentication methods](#authentication-methods).

### Hosting

Deploy one MCP instance for each Horizon instance. Keep the connection from the server to Horizon on an internal network.

Use a trusted TLS termination point for client connections. Store secrets in the orchestrator secret store.

Bun supports stdio with an API key, a service account, and trusted Horizon TLS. PEM or PFX mTLS to Horizon and `HORIZON_VERIFY_SSL=false` need Node, because Bun's built-in fetch ignores the undici Agent that carries those settings. If you configure either setting under Bun, the server refuses to start and names the setting in its error.

The server supports HTTP mode under Node >= 24.10. Bun compiles the standalone binaries for the stdio transport. They can serve HTTP, but Bun's `node:http` implementation (verified on Bun 1.3.14) does not surface client disconnects after the server consumes the request body. In that setup the server does not cancel in-flight Horizon calls, and it does not release the permit early on disconnect. The request timeouts and `HORIZON_SSE_MAX_DURATION` still bound the capacity. The server logs a warning at startup in that configuration.

The server serves `/healthz` for liveness probes and `/readyz` for readiness probes.

The repository includes a production `Dockerfile`. The container holds no credential of its own, and each caller sends one, so the file below configures no credential. For a local, loopback-only deployment, create an untracked `.env.http` file:

```dotenv
HORIZON_URL=https://horizon.example.com
HORIZON_HTTP_AUTH_METHODS=api-key,service
HORIZON_TRUSTED_HOSTS=localhost:8080,127.0.0.1:8080
```

Run these commands in order:

```bash
docker build -t horizon-mcp .
docker run --rm --name horizon-mcp \
  --env-file .env.http \
  -p 127.0.0.1:8080:8080 \
  horizon-mcp

curl -H 'Host: localhost:8080' http://127.0.0.1:8080/healthz
curl -H 'Host: localhost:8080' http://127.0.0.1:8080/readyz
```

The image defaults to HTTP on `0.0.0.0:8080`. For remote hosting, terminate TLS at a trusted edge and set `HORIZON_PUBLIC_URL=https://mcp.example.com`. Every caller must present a credential from the allowlist. See [docs/installation.md](docs/installation.md) for the container checklist and [docs/client-setup.md](docs/client-setup.md) for remote clients.

## MCP client setup

This package ships the binary as **`horizon-mcp`**, declared in the `package.json` `bin` field. Use that exact name in every client configuration. Do not call it `horizon-mcp-server`.

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

Horizon applies RBAC to the authenticated principal. The server does not duplicate Horizon RBAC.

The server can reduce the available operations with these controls:

- `HORIZON_READ_ONLY`.
- `HORIZON_ENABLED_TOOLSETS`.
- The implemented tool set.
- Explicit confirmation values for delete and flush operations.

The server does not grant access beyond the forwarded Horizon credential.

In stdio mode, the environment supplies the credential. In HTTP mode, `HORIZON_HTTP_AUTH_METHODS` accepts one or more methods.

For example, `api-key,service` turns on both of these methods:

- **`service`** - The client sends `X-API-SVA` and `X-API-TOKEN`. The server forwards both values directly to Horizon.
  The client can also send protected OAuth credentials. The server uses them to fetch and renew the JWT with `client_credentials`. We recommend that you pin the allowed issuers, token URLs, and client authentication methods with `HORIZON_OAUTH_ISSUERS`. An HTTP caller cannot supply or override the token URL.
- **`api-key`** - The client sends `X-API-ID` and `X-API-KEY`. The server forwards both headers to Horizon.
- **`mtls`** - The client presents a TLS client certificate. The server or a trusted ingress terminates TLS and forwards the certificate.
  Horizon validates the certificate chain, the revocation status, and the identity. Most MCP clients need a local mTLS proxy.

The server rejects invalid or ambiguous authentication and has no fallback. The rule covers these conditions:

- The request has no credential.
- `HORIZON_HTTP_AUTH_METHODS` does not include the selected method.
- The request has an incomplete credential pair.
- The request has more than one complete credential type.

Use TLS for header credentials on all non-loopback deployments.

> [!IMPORTANT]
> **Breaking change** - The server no longer supports OIDC browser login with Playwright.
> HTTP service accounts use `X-API-SVA` and `X-API-TOKEN`.
> Third-party JWT renewal uses the headless OAuth `client_credentials` flow.

See [docs/authentication.md](docs/authentication.md) for the full step-by-step guide and troubleshooting tips.

## Tool catalog overview

Each tool carries explicit usage guidance for smaller models.

The table at the top of this README gives the tool counts. The [tool reference](docs/tools-reference.md) gives the safety tiers and descriptions.

The server exposes the knowledge resources at `horizon://knowledge/*` URIs. For the full catalog, see [docs/knowledge-resources.md](docs/knowledge-resources.md).

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
List my certificates (resolve `identity.identifier` and `teams` with whoami first, then query owner and team).
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

The standalone binaries bundle everything they need to run. They have no extra runtime dependencies. They support trusted-TLS stdio authentication with an API key or a service account. Use Node for PEM or PFX mTLS to Horizon and for `HORIZON_VERIFY_SSL=false`.

For HTTP hosting, see the [Hosting](#hosting) note.

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
| `bun run build`         | Production build with `tsup`.                         |
| `bun run test`          | Unit tests with Vitest.                               |
| `bun run test:coverage` | Unit tests with V8 coverage thresholds.               |
| `bun run test:e2e`      | E2E tests against a live Horizon instance.            |
| `bun run test:llm`      | Deterministic tool-selection scenarios (no LLM call). |
| `bun run test:llm:live` | Real Claude-in-the-loop MCP usability tests.          |
| `bun run lint`          | ESLint over `src/` and `tests/`.                      |
| `bun run typecheck`     | `tsc --noEmit` only.                                  |
| `bun run docs:refresh`  | Regenerate embedded docs from upstream sources.       |

### Live LLM evaluation (`test:llm:live`)

`bun run test:llm:live` runs the Claude Agent SDK against the local Horizon MCP server. The suite asks Claude a controlled set of questions.

The test checks that Claude selects the correct MCP tools. Run it after you change tool names, descriptions, or input schemas.

The deterministic ranker in `test:llm` gives a fast initial result. A real model gives a better test of user wording.

Prerequisites:

- `claude` CLI on `PATH` with an active subscription session (run `claude login` once)
- `HORIZON_E2E_*` credentials in the environment (`source .env.local` first)
- `ANTHROPIC_API_KEY` **unset**. The suite refuses to run against API billing, to avoid unexpected per-token charges. It is subscription-only by design.

Cost / billing:

- Each scenario uses Claude Haiku 4.5 by default and consumes Claude subscription credits.
- The number of turns changes with tool discovery and response size.
- Each scenario has a hard `maxBudgetUsd` cap (default `$0.50`) and a `maxTurns` cap (default `10`) that bound any runaway loop. A scenario can declare a stricter or a higher cap. The largest current scenario cap is `$1.00`.
- For a stricter fidelity check, override the model with `HORIZON_LLM_LIVE_MODEL=claude-sonnet-4-6 bun run test:llm:live`.

`validate:ci` excludes the suite on purpose, so PR builds never spend subscription credits.

See [docs/development.md](docs/development.md) for the documentation language rules, the CI gates, and the test commands.

## Troubleshooting

- **`Exactly one complete stdio authentication method must be configured`** - Set exactly one of these credentials:
  - a complete API key pair (`HORIZON_API_ID` + `HORIZON_API_KEY`)
  - a service-account name with `HORIZON_API_TOKEN`
  - a service-account name with the complete OAuth client pair and exactly one pinned issuer
  - a PEM mTLS pair
  - a PFX bundle

  Startup also fails closed if you combine methods. If startup minting fails, stdio logs a sanitized error and keeps serving, and tool calls retry after the 30-second cooldown. HTTP mode is unchanged and always needs `X-API-TOKEN`.

- **`HORIZON_CLIENT_CERT`, `HORIZON_CLIENT_PFX`, or `HORIZON_VERIFY_SSL=false` is not supported under Bun** - Run the server with Node (`node dist/index.js`). Bun supports trusted-TLS stdio with an API key or a service account. But its built-in fetch ignores the undici Agent that mTLS and disabled verification need.
- **TLS handshake failures** - Make sure that `HORIZON_URL` uses `https://`. Make sure that the system store trusts the Horizon certificate authority.
  For development only, you can set `HORIZON_VERIFY_SSL=false` when you run under Node.
- **`HQL-001` parse errors** - Write HQL field names in lowercase (`contactemail`, not `contactEmail`). `groupBy` and `sortedBy` are the two exceptions. They are camelCase because they are API parameters, not query fields. See `horizon://knowledge/query-languages`.
- **Version compatibility warnings** - The server logs a warning when the connected Horizon version is in `HORIZON_WARN_VERSIONS`. Support is best-effort on those versions. Move a version to `HORIZON_TESTED_VERSIONS` only after you run your own E2E suite.

## Compatibility

| Horizon version    | Status                                        |
| ------------------ | --------------------------------------------- |
| 2.10               | Tested (full Horizon 2.10 feature coverage)   |
| 2.8                | Expected to work (in `HORIZON_WARN_VERSIONS`) |
| 2.9                | Expected to work (in `HORIZON_WARN_VERSIONS`) |
| All other versions | Untested. Use with care                       |

You can configure both version lists. By default, the server treats only version 2.10 as tested, and versions 2.8 and 2.9 as warning versions.

## What is not supported

The server supports many configuration objects. These objects include profiles, certificate authorities, connectors, roles, teams, triggers, and scheduled-task definitions.

The [tool reference](docs/tools-reference.md) gives the complete list. These limitations are deliberate:

- **Stored credential mutations** - You can list stored credentials. You cannot create them, update them, delete them, or fetch them with their secret material.
- **Identity-provider mutations** - Read-only tools inspect identity providers. Service-account CRUD is available to a principal that holds `access-management:service-account:*`.
- **Principal administration** - There are no principal create, update, or delete tools.
- **Certificate grading policy/ruleset mutations** - You can list and inspect them. The covered Horizon API surface has no matching write tools.
- **Selected singleton or asymmetric APIs** - System configuration is update-only. Archives have no update tool.
  Scheduled-task definitions have CRUD tools but do not have a `run_scheduled_task` tool.
- **Analytics maintenance and SMTP server configuration** - The server does not register the sync and reindex operations, or the SMTP server administration tools.

## Contributing

Before you open a pull request, run `bun run validate:ci`. The command runs all required local checks.

If you have QA credentials, load `.env.local` first. QA credentials give more test coverage.

Use one-line conventional commit messages with the `type: description` format.

## Safety and trust caveats

> [!CAUTION]
> **Experimental software** - This MCP server is experimental. For now, we recommend that you use this MCP server for exploratory purposes only.
>
> **Permissions** - Horizon enforces RBAC for the configured identity or the caller identity. The server can restrict the available operations further.
> Those restrictions cannot make an identity with excessive privileges safe. Use an identity with minimum privileges. Use the client approval controls.
>
> **No approval prompt guarantee** - Most tools that change data run as soon as the client calls them. The MCP client controls the approval prompts.
> Only the delete and flush tools need explicit confirmation parameters.
>
> **AI-generated output** - All output is AI-generated. We recommend manual validation before you rely on any output.
>
> **Third-party AI providers** - The AI provider's terms of service and privacy policy apply to AI agents.
> The MCP server and Evertrust do not control those terms or policies.

## Documentation

| Document                                           | Contents                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| [Installation](docs/installation.md)               | Install methods, Docker, and the remote hosting checklist           |
| [Authentication](docs/authentication.md)           | Supported credential types with environment variable reference      |
| [Client setup](docs/client-setup.md)               | Claude Desktop, Claude Code, Cursor, Codex, OpenCode, MCP Inspector |
| [Tool reference](docs/tools-reference.md)          | All 222 tools by domain with safety tiers                           |
| [Knowledge resources](docs/knowledge-resources.md) | 111 registered URIs: 18 core guides, 4 playbooks, 89 sections       |
| [Development](docs/development.md)                 | Dev setup, CI gates, tests, linting                                 |

## License

Copyright 2025-2026 [Evertrust](https://www.evertrust.fr/). Licensed under the [Apache License 2.0](LICENSE).

## Acknowledgements

This project was developed with help from [Anthropic's Claude](https://www.anthropic.com/claude) and [OpenAI's Codex](https://chatgpt.com/codex).
