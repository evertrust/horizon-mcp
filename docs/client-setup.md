# Client setup

Connect your large language model (LLM) client to Horizon MCP. Each section gives the configuration for one client. Read [Client compatibility](#client-compatibility) first, because the server needs a client that speaks MCP revision 2026-07-28.

## Client compatibility

Horizon MCP 3.0.0 serves MCP protocol revision **2026-07-28** and nothing else. Revision 2026-07-28 removed the `initialize` handshake and protocol sessions, so a client built for an earlier revision cannot negotiate with it.

| Server version | Protocol revision served | Works with                                  |
| -------------- | ------------------------ | ------------------------------------------- |
| 3.x            | `2026-07-28` only        | Clients updated for revision 2026-07-28     |
| 2.x            | `2025-11-25` and earlier | Clients released before revision 2026-07-28 |

Revision 2026-07-28 is recent, and clients adopt it on their own schedules. Check your client's release notes for the protocol revision it speaks. **If your client has not adopted it yet, stay on horizon-mcp 2.x.** Both lines talk to the same Horizon instance, so you can move when your client is ready.

### Check your client before upgrading

An older client fails at connection time. It reports an "unsupported protocol version" error that names `2026-07-28`. That message is the symptom to look for. Horizon itself works normally when this happens.

To check the revision that a running HTTP deployment serves, ask the deployment directly:

```bash
curl -s -X POST https://mcp.example.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -H 'X-API-ID: <id>' -H 'X-API-KEY: <key>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientCapabilities":{}}}}'
```

A healthy server returns its capabilities and instructions. If a request names any other revision, the server answers with an error that lists the revisions it does support.

The MCP endpoint accepts `POST` only. Any other HTTP method gets a `405` response with an `Allow: POST` header. If the body sets `params._meta["io.modelcontextprotocol/protocolVersion"]` to a string but omits the `MCP-Protocol-Version` header, the server returns `400` with JSON-RPC error code `-32020`. The error says that the body claims a protocol version but the required header is absent. The curl example above sends the header and names the same revision in both places.

## Reduce the tool surface (recommended)

The full server registers exactly 222 tools. These tools use about 45,000 to 55,000 context tokens before the first user message.

If you do not need all domains, use these environment variables to reduce the tool set:

- `HORIZON_ENABLED_TOOLSETS` - Enter a comma-separated list of domains. You can use this variable in all client `env` blocks and HTTP deployments.
- `HORIZON_READ_ONLY=true` - Remove all tools that change data. Keep only read-only tools.

`HORIZON_ENABLED_TOOLSETS` accepts these names:

- `lifecycle`
- `profiles`
- `dashboards`
- `discovery`
- `datasources`
- `reports`
- `triggers`
- `docs`
- `assist`
- `config`

If a name is not valid, the server stops during startup. The error message gives the valid names.

Suggested presets:

| Use case                                                | Setting                                                  |
| ------------------------------------------------------- | -------------------------------------------------------- |
| Certificate operations (search, enroll, revoke, decode) | `HORIZON_ENABLED_TOOLSETS=lifecycle,assist,docs`         |
| Read-only auditing and reporting                        | `HORIZON_READ_ONLY=true` (optionally add a toolset list) |
| Configuration administration                            | `HORIZON_ENABLED_TOOLSETS=config,assist,docs`            |
| Discovery review                                        | `HORIZON_ENABLED_TOOLSETS=discovery,lifecycle,assist`    |

A read-only `lifecycle,docs,assist` server registers about 41 tools. This configuration cuts the context use by about 80 percent.

## Claude Desktop

1. Open `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).
2. Add the `horizon` server:

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

For the standalone binary, use this block instead:

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

3. Restart Claude Desktop. The Horizon tools appear in the tools panel.

## Claude Code

1. Create `.mcp.json` in your project root.
2. Add the `horizon` server:

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

For the standalone binary, use this block instead:

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

3. Start Claude Code from that directory. The server makes the 222 tools available immediately.

## Cursor

1. Create `.cursor/mcp.json` in your project root. For global access, create `~/.cursor/mcp.json` instead.
2. Add the `horizon` server:

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

For the standalone binary, use this block instead:

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

3. Restart Cursor. The Horizon tools appear in Cursor's MCP tools panel.

## Codex (CLI and Desktop app)

Codex CLI and the Codex Desktop app share the same configuration at `~/.codex/config.toml`.

1. Open `~/.codex/config.toml`.
2. Add the `horizon` server:

```toml
[mcp_servers.horizon]
command = "bunx"
args = ["@evertrust/horizon-mcp"]

[mcp_servers.horizon.env]
HORIZON_URL = "https://horizon.example.com"
HORIZON_API_ID = "your-api-id"
HORIZON_API_KEY = "your-api-key"
```

For the standalone binary, use this block instead:

```toml
[mcp_servers.horizon]
command = "/path/to/horizon-mcp"

[mcp_servers.horizon.env]
HORIZON_URL = "https://horizon.example.com"
HORIZON_API_ID = "your-api-id"
HORIZON_API_KEY = "your-api-key"
```

For a local source checkout, use this block instead:

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

Or add the server from the command line:

```bash
codex mcp add horizon \
  --env HORIZON_URL=https://horizon.example.com \
  --env HORIZON_API_ID=your-api-id \
  --env HORIZON_API_KEY=your-api-key \
  -- bunx @evertrust/horizon-mcp
```

## OpenCode

Add the `horizon` server to `opencode.json`:

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

For the standalone binary, use this block instead:

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

Set the credentials in the environment and start the inspector:

```bash
export HORIZON_URL=https://horizon.example.com
export HORIZON_API_ID=your-api-id
export HORIZON_API_KEY=your-api-key

bunx @modelcontextprotocol/inspector bunx @evertrust/horizon-mcp
```

This command opens the MCP Inspector in a browser. The inspector shows all tools and knowledge resources.

## Connect through streamable HTTP

The previous examples start Horizon MCP as a local stdio process. You can also run the server with the **streamable HTTP** transport.

This transport lets remote clients connect to one long-running server. Use it for a shared server, a container, or a server behind a gateway.

Host the HTTP endpoint under Node >= 24.10. See the [Hosting](../README.md#hosting) note in the README.

The server joins `HORIZON_PUBLIC_URL` with `HORIZON_HTTP_PATH`. The default path is `/mcp`.

For example:

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

For `api-key`, add the `X-API-ID` and `X-API-KEY` headers:

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

The Claude Desktop local configuration file starts stdio servers only. To connect to a remote server, add a custom connector:

1. Open **Settings > Connectors > Add custom connector**.
2. Paste the server URL:

```
https://horizon.example.com/mcp
```

The connector interface does not let you set arbitrary static request headers. Use a local proxy to add the authentication headers that your method needs.

Use the same proxy pattern as the [mTLS procedure](#per-caller-mtls-local-proxy-procedure).

### Codex (CLI and Desktop app)

In `~/.codex/config.toml`, set `url` instead of `command`. For `service`, use environment-backed headers.

This configuration keeps the JWT and the OAuth client secret out of the file:

```toml
[mcp_servers.horizon]
url = "https://horizon.example.com/mcp"
env_http_headers = { "X-API-SVA" = "HORIZON_SERVICE_ACCOUNT", "X-API-TOKEN" = "HORIZON_API_TOKEN", "X-OAUTH-CLIENT-ID" = "OAUTH_CLIENT_ID", "X-OAUTH-CLIENT-SECRET" = "OAUTH_CLIENT_SECRET", "X-OAUTH-SCOPE" = "OAUTH_SCOPE" }
```

For `api-key`, Codex supports `http_headers` and `env_http_headers`. Use `env_http_headers` to keep the secret out of `config.toml`:

```toml
[mcp_servers.horizon]
url = "https://horizon.example.com/mcp"
env_http_headers = { "X-API-ID" = "HORIZON_API_ID", "X-API-KEY" = "HORIZON_API_KEY" }
```

Set `HORIZON_API_ID` and `HORIZON_API_KEY` in the environment that starts Codex.

If you cannot set them in the environment, use literal headers.

> Caution: Literal headers store the credentials in `config.toml` as plain text. Restrict access to the file.

```toml
[mcp_servers.horizon]
url = "https://horizon.example.com/mcp"
http_headers = { "X-API-ID" = "your-api-id", "X-API-KEY" = "your-api-key" }
```

In the **Codex Desktop app**, add the remote server through **Settings > MCP servers**. Enter the server URL.

Use the shared `config.toml` configuration when you need custom headers.

### Cursor

For `service`, create `.cursor/mcp.json` with the headers that the method needs:

> Caution: If `.cursor/mcp.json` holds credentials, restrict access to the file.

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

For `api-key`, add `X-API-ID` and `X-API-KEY` to the remote server `headers` object.

Cursor versions have different support for environment variable interpolation.

### OpenCode

OpenCode remote servers use `type: "remote"`. Turn off automatic OAuth for Horizon's API-key mode and read the two headers from environment variables:

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

For `service`, replace the API-key headers with `X-API-SVA` and `X-API-TOKEN`.

If the server must renew the JWT, also add the protected `X-OAUTH-*` headers.

### Per-caller mTLS: local proxy procedure

When you enable `mtls`, each caller must present a TLS **client** certificate. Most MCP clients cannot attach this certificate to an HTTPS connection.

Use an **mTLS proxy** on the client computer:

1. Configure the proxy to listen on a loopback address, such as `http://127.0.0.1:8081/mcp`.
2. Configure the proxy to connect to `https://horizon.example.com/mcp`.
3. Configure the proxy to present the client certificate and private key to the server.
4. Configure the MCP client to connect to the proxy loopback address.

For example, use this Claude Code configuration:

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

Use a local proxy that can present a client certificate. Examples include stunnel, an nginx or Envoy stream proxy, and an mTLS forwarder.

The proxy holds the certificate and private key. The MCP client does not access them.

You can also use the proxy to add custom request headers. For `api-key`, configure the proxy to add `X-API-ID` and `X-API-KEY`.
