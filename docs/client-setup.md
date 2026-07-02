# Client setup

Configure your LLM client to connect to the horizon-mcp server.

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

The server decides how callers authenticate via `HORIZON_HTTP_AUTH_MODE`:

- `service` - the server holds a single set of Horizon credentials. Callers send no credentials of their own; the client needs only the url.
- `api-key` - each caller authenticates per-request with the `X-API-ID` and `X-API-KEY` HTTP headers.
- `mtls` - each caller authenticates by presenting a TLS client certificate on the connection.

(OIDC browser login has been removed; use one of the three modes above.)

These map onto three distinct client capabilities, and MCP clients differ in which they support:

1. **Connecting to a remote url** - native in Claude Code, Cursor, Codex CLI, OpenCode, MCP Inspector (CLI), and Claude Desktop's connector. This is all that `service` mode needs.
2. **Sending custom request headers** - additionally required for `api-key` mode (the `X-API-ID` and `X-API-KEY` headers). Supported directly by some clients; for the rest, inject the headers with a local proxy (see below).
3. **Presenting a TLS client certificate** - required for `mtls` mode. Most MCP clients cannot do this directly; see the per-caller mTLS subsection for the local-proxy workaround.

### Claude Code

Use the HTTP transport form in `.mcp.json` instead of `command`/`args`. For `service` mode the url is all you need:

```json
{
  "mcpServers": {
    "horizon": {
      "type": "http",
      "url": "https://horizon.example.com/mcp"
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

That covers `service` mode, where the url is all the client needs (no credentials). The connector UI does not expose arbitrary static request headers, so for `api-key` mode point the connector at a local proxy that injects `X-API-ID` and `X-API-KEY` on the upstream request (same pattern as the mTLS workaround below).

### Codex (CLI and Desktop app)

In `~/.codex/config.toml`, give the server a `url` instead of a `command`. For `service` mode:

```toml
[mcp_servers.horizon]
url = "https://horizon.example.com/mcp"
```

For `api-key` mode the client must attach `X-API-ID` and `X-API-KEY` to each request. If your Codex version supports static request headers for remote MCP servers, set them there; otherwise point `url` at a local proxy that injects the headers (see below). In the **Codex Desktop app**, the same remote server can be added through **Settings > MCP** by entering the url.

### Per-caller mTLS: local proxy workaround

When the server runs with `HORIZON_HTTP_AUTH_MODE=mtls`, each caller must present a TLS **client** certificate to the MCP server. Most MCP clients (Claude Code, Claude Desktop, Codex, and others) cannot attach a client certificate to their outbound HTTPS connection. This is a current limitation of the clients, not of the server.

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
