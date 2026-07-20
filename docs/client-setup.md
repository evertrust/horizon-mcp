# Client setup

Configure your LLM client to connect to the horizon-mcp server.

## Trimming the tool surface (recommended)

The full server registers 212 tools, which costs roughly 45-55k context
tokens per session before the first user message. If you do not need every
domain, scope the server with two environment variables (they work in any
client's `env` block below, and server-side in HTTP mode):

- `HORIZON_ENABLED_TOOLSETS` - comma-separated list of domains to register.
  Valid names: `lifecycle`, `profiles`, `dashboards`, `discovery`,
  `datasources`, `reports`, `triggers`, `docs`, `assist`, `config`.
  Unknown names fail at startup with the valid list.
- `HORIZON_READ_ONLY=true` - drop every mutating tool (create/update/delete,
  request submission), keeping only read-only tools.

Suggested presets:

| Use case | Setting |
| -------- | ------- |
| Certificate operations (search, enroll, revoke, decode) | `HORIZON_ENABLED_TOOLSETS=lifecycle,assist,docs` |
| Read-only auditing and reporting | `HORIZON_READ_ONLY=true` (optionally add a toolset list) |
| Configuration administration | `HORIZON_ENABLED_TOOLSETS=config,assist,docs` |
| Discovery review | `HORIZON_ENABLED_TOOLSETS=discovery,lifecycle,assist` |

A scoped lifecycle+docs+assist read-only server registers ~38 tools instead
of 212, cutting the context cost by roughly 80%.

## Claude Desktop

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

Or with the standalone binary:

```json
{
  "mcpServers": {
    "horizon": {
      "command": "/path/to/horizon-mcp",
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "<your-api-id>",
        "HORIZON_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

Restart Claude Desktop. The Horizon tools appear in the tools panel.

## Claude Code

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "horizon": {
      "command": "bunx",
      "args": ["@evertrust/horizon-mcp"],
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or with the standalone binary:

```json
{
  "mcpServers": {
    "horizon": {
      "command": "/path/to/horizon-mcp",
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

Start Claude Code from that directory. The 212 tools are available immediately.

## Cursor

Create `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` for global access):

```json
{
  "mcpServers": {
    "horizon": {
      "command": "bunx",
      "args": ["@evertrust/horizon-mcp"],
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or with the standalone binary:

```json
{
  "mcpServers": {
    "horizon": {
      "command": "/path/to/horizon-mcp",
      "env": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

Restart Cursor. The Horizon tools appear in Cursor's MCP tools panel.

## Codex (CLI and Desktop app)

Codex CLI and the Codex Desktop app share the same configuration at `~/.codex/config.toml`:

```toml
[mcp_servers.horizon]
command = "bunx"
args = ["@evertrust/horizon-mcp"]

[mcp_servers.horizon.env]
HORIZON_URL = "https://horizon.example.com"
HORIZON_API_ID = "your-api-id"
HORIZON_API_KEY = "your-api-key"
```

Or with the standalone binary:

```toml
[mcp_servers.horizon]
command = "/path/to/horizon-mcp"

[mcp_servers.horizon.env]
HORIZON_URL = "https://horizon.example.com"
HORIZON_API_ID = "your-api-id"
HORIZON_API_KEY = "your-api-key"
```

Or with a local source checkout:

```toml
[mcp_servers.horizon]
command = "node"
args = ["/absolute/path/to/horizon-mcp/dist/index.js"]

[mcp_servers.horizon.env]
HORIZON_URL = "https://horizon.example.com"
HORIZON_API_ID = "your-api-id"
HORIZON_API_KEY = "your-api-key"
```

In the **Codex Desktop app**, you can also add the server through **Settings > MCP** and follow the GUI prompts.

Alternatively, add via the CLI:

```bash
codex mcp add horizon \
  --env HORIZON_URL=https://horizon.example.com \
  --env HORIZON_API_ID=your-api-id \
  --env HORIZON_API_KEY=your-api-key \
  -- bunx @evertrust/horizon-mcp
```

## OpenCode

Add to `opencode.json`:

```json
{
  "mcp": {
    "horizon": {
      "type": "local",
      "command": ["bunx", "@evertrust/horizon-mcp"],
      "enabled": true,
      "environment": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

Or with the standalone binary:

```json
{
  "mcp": {
    "horizon": {
      "type": "local",
      "command": ["/path/to/horizon-mcp"],
      "enabled": true,
      "environment": {
        "HORIZON_URL": "https://horizon.example.com",
        "HORIZON_API_ID": "your-api-id",
        "HORIZON_API_KEY": "your-api-key"
      }
    }
  }
}
```

## MCP Inspector (debugging and exploration)

```bash
export HORIZON_URL=https://horizon.example.com
export HORIZON_API_ID=your-api-id
export HORIZON_API_KEY=your-api-key

bunx @modelcontextprotocol/inspector bunx @evertrust/horizon-mcp
```

Opens a browser UI showing all 212 tools and the full knowledge resource catalog (17 core URIs + 4 curated playbooks + generated section URIs).

## Connecting over streamable HTTP (remote server)

The examples above launch horizon-mcp as a local subprocess over stdio. The server can also run as a long-lived process that speaks the MCP **streamable HTTP** transport, so clients connect to it over the network instead of spawning it. This is the right setup when the server is shared, runs in a container, or sits behind a gateway.

The server endpoint is `HORIZON_PUBLIC_URL` joined with `HORIZON_HTTP_PATH` (default `/mcp`), for example:

```
https://horizon.example.com/mcp
```

The server whitelists one or more caller methods via `HORIZON_HTTP_AUTH_METHODS`:

- `service` - each caller sends `X-API-SVA` and `X-API-TOKEN`; optional OAuth client headers let the MCP renew the JWT.
- `api-key` - each caller authenticates per-request with the `X-API-ID` and `X-API-KEY` HTTP headers.
- `mtls` - each caller authenticates by presenting a TLS client certificate on the connection.

(OIDC browser login has been removed. The `service` method is headless Horizon JWKS service-account authentication.)

These map onto three distinct client capabilities, and MCP clients differ in which they support:

1. **Connecting to a remote url** - native in Claude Code, Cursor, Codex CLI, OpenCode, MCP Inspector (CLI), and Claude Desktop's connector.
2. **Sending custom request headers** - required for `api-key` and `service`. Supported directly by some clients; for the rest, inject the headers with a local proxy (see below).
3. **Presenting a TLS client certificate** - required for `mtls` mode. Most MCP clients cannot do this directly; see the per-caller mTLS subsection for the local-proxy workaround.

### Claude Code

Use the HTTP transport form in `.mcp.json` instead of `command`/`args`. For `service`, supply the Horizon service account and JWT. Add the four `X-OAUTH-*` headers shown in [authentication](authentication.md#service-account-jwt-renewal) when the MCP should renew the token:

```json
{
  "mcpServers": {
    "horizon": {
      "type": "http",
      "url": "https://horizon.example.com/mcp",
      "headers": {
        "X-API-SVA": "your-horizon-service-account",
        "X-API-TOKEN": "your-jwt",
        "X-OAUTH-CLIENT-ID": "your-oauth-client-id",
        "X-OAUTH-CLIENT-SECRET": "your-oauth-client-secret",
        "X-OAUTH-SCOPE": "your-resource/.default"
      }
    }
  }
}
```

For `api-key` mode, add the `X-API-ID` and `X-API-KEY` headers:

```json
{
  "mcpServers": {
    "horizon": {
      "type": "http",
      "url": "https://horizon.example.com/mcp",
      "headers": {
        "X-API-ID": "your-api-id",
        "X-API-KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Desktop

Claude Desktop's local config file (`claude_desktop_config.json`) launches stdio servers only. To reach a remote HTTP server, add it as a custom connector: open **Settings > Connectors > Add custom connector** and paste the server url:

```
https://horizon.example.com/mcp
```

The connector UI does not expose arbitrary static request headers, so point it at a local proxy that injects the required API-key or service-account headers (same pattern as the mTLS workaround below).

### Codex (CLI and Desktop app)

In `~/.codex/config.toml`, give the server a `url` instead of a `command`. For `service`, environment-backed headers keep the JWT and OAuth client secret out of the file:

```toml
[mcp_servers.horizon]
url = "https://horizon.example.com/mcp"
env_http_headers = { "X-API-SVA" = "HORIZON_SERVICE_ACCOUNT", "X-API-TOKEN" = "HORIZON_SERVICE_JWT", "X-OAUTH-CLIENT-ID" = "OAUTH_CLIENT_ID", "X-OAUTH-CLIENT-SECRET" = "OAUTH_CLIENT_SECRET", "X-OAUTH-SCOPE" = "OAUTH_SCOPE" }
```

For `api-key` mode, Codex supports both literal `http_headers` and environment-backed `env_http_headers`. Environment-backed headers avoid storing the secret in `config.toml`:

```toml
[mcp_servers.horizon]
url = "https://horizon.example.com/mcp"
env_http_headers = { "X-API-ID" = "HORIZON_API_ID", "X-API-KEY" = "HORIZON_API_KEY" }
```

Set `HORIZON_API_ID` and `HORIZON_API_KEY` in the environment that launches Codex. If a managed environment cannot supply them, the literal form is available but stores credentials in plaintext:

```toml
[mcp_servers.horizon]
url = "https://horizon.example.com/mcp"
http_headers = { "X-API-ID" = "your-api-id", "X-API-KEY" = "your-api-key" }
```

In the **Codex Desktop app**, the same remote server can be added through **Settings > MCP servers** by entering the URL. Use the shared `config.toml` form above when custom headers are required.

### Cursor

For `service`, create `.cursor/mcp.json` with the required headers:

```json
{
  "mcpServers": {
    "horizon": {
      "url": "https://horizon.example.com/mcp",
      "headers": {
        "X-API-SVA": "your-horizon-service-account",
        "X-API-TOKEN": "your-jwt"
      }
    }
  }
}
```

For `api-key` mode, add `X-API-ID` and `X-API-KEY` in the remote server's `headers` object. Treat `.cursor/mcp.json` as sensitive if it contains literal credentials; client versions differ in environment interpolation support.

### OpenCode

OpenCode remote servers use `type: "remote"`. Disable automatic OAuth for Horizon's API-key mode and source the two headers from environment variables:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "horizon": {
      "type": "remote",
      "url": "https://horizon.example.com/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "X-API-ID": "{env:HORIZON_API_ID}",
        "X-API-KEY": "{env:HORIZON_API_KEY}"
      }
    }
  }
}
```

For `service`, replace the API-key pair with `X-API-SVA` / `X-API-TOKEN` and, when renewal is required, the protected `X-OAUTH-*` headers documented above.

### Per-caller mTLS: local proxy workaround

When `mtls` is included in `HORIZON_HTTP_AUTH_METHODS`, each mTLS caller must present a TLS **client** certificate to the MCP server. Most MCP clients (Claude Code, Claude Desktop, Codex, and others) cannot attach a client certificate to their outbound HTTPS connection. This is a current limitation of the clients, not of the server.

The workaround is to run a small **mTLS proxy** on the client machine:

- The MCP client speaks plain MCP over HTTP to the proxy on localhost, for example `http://127.0.0.1:8081/mcp`.
- The proxy opens the upstream TLS connection to the real server (`https://horizon.example.com/mcp`) and presents the client certificate and private key on that connection.

So the client config simply points at the loopback address instead of the server. For Claude Code:

```json
{
  "mcpServers": {
    "horizon": {
      "type": "http",
      "url": "http://127.0.0.1:8081/mcp"
    }
  }
}
```

Any TLS-terminating local proxy that can present a client certificate works here (for example stunnel, an nginx/Envoy stream proxy, or a purpose-built mTLS forwarder). The proxy holds the certificate and key; the MCP client stays unaware of them. The same loopback-proxy pattern also serves clients that cannot set custom request headers: have the proxy add `X-API-ID` and `X-API-KEY` for `api-key` mode.
