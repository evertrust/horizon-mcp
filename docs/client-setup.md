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
  "mcp": {
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

The server accepts one or more methods from `HORIZON_HTTP_AUTH_METHODS`:

- `service` - Send `X-API-SVA` and `X-API-TOKEN`. Send the OAuth client headers if the server must renew the JWT.
- `api-key` - Send `X-API-ID` and `X-API-KEY` on each request.
- `mtls` - Present a TLS client certificate on the connection.

The server does not support OpenID Connect (OIDC) browser login. The `service` method uses Horizon service-account authentication with JWKS, which needs no browser.

MCP clients do not all support the same connection capabilities. Your client must have the capability that your authentication method needs:

- **Connect to a remote URL.** Claude Code, Cursor, Codex CLI, OpenCode, MCP Inspector, and the Claude Desktop connector support remote URLs.
- **Send custom request headers.** The `api-key` and `service` methods need this capability. If your client cannot send them, use a local proxy.
- **Present a TLS client certificate.** The `mtls` method needs this capability. Most MCP clients need the local proxy procedure below.

Each session is bound to the credential used for initialization. Send the same credential headers on all requests with `Mcp-Session-Id`, including GET and DELETE. Start a new session to use a different credential.

### Claude Code

Use the HTTP transport form in `.mcp.json`. Do not use `command` or `args` for this configuration.

For `service`, give the Horizon service-account name and an initial JWT. The server sends the active pair to Horizon. Pinned renewal can replace an expired or rejected JWT before the first Horizon validation.

Add the OAuth client headers when the server must renew the JWT. See [Service-account JWT renewal](authentication.md#service-account-jwt-renewal) for the header requirements.

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

The connector interface does not let you set arbitrary static request headers. Use a local proxy to add the authentication headers that your method needs.

Use the same proxy pattern as the [mTLS procedure](#per-caller-mtls-local-proxy-workaround).

### Codex (CLI and Desktop app)

In `~/.codex/config.toml`, set `url` instead of `command`. For `service`, use environment-backed headers.

This configuration keeps the JWT and the OAuth client secret out of the file:

```toml
[mcp_servers.horizon]
url = "https://horizon.example.com/mcp"
env_http_headers = { "X-API-SVA" = "HORIZON_SERVICE_ACCOUNT", "X-API-TOKEN" = "HORIZON_API_TOKEN", "X-OAUTH-CLIENT-ID" = "OAUTH_CLIENT_ID", "X-OAUTH-CLIENT-SECRET" = "OAUTH_CLIENT_SECRET", "X-OAUTH-SCOPE" = "OAUTH_SCOPE" }
```

For `api-key` mode the client must attach `X-API-ID` and `X-API-KEY` to each request. If your Codex version supports static request headers for remote MCP servers, set them there; otherwise point `url` at a local proxy that injects the headers (see below). In the **Codex Desktop app**, the same remote server can be added through **Settings > MCP** by entering the url.

### Per-caller mTLS: local proxy workaround

When the server runs with `HORIZON_HTTP_AUTH_METHODS=mtls`, each caller must present a TLS **client** certificate to the MCP server. Most MCP clients (Claude Code, Claude Desktop, Codex, and others) cannot attach a client certificate to their outbound HTTPS connection. This is a current limitation of the clients, not of the server.

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

Any TLS-terminating local proxy that can present a client certificate works here (for example stunnel, an nginx/Envoy stream proxy, or a purpose-built mTLS forwarder). The proxy holds the certificate and key; the MCP client stays unaware of them. The same loopback-proxy pattern also serves clients that cannot set custom request headers. Have the proxy add `X-API-ID` and `X-API-KEY` for `api-key`, or `X-API-SVA` and `X-API-TOKEN` for `service`.
