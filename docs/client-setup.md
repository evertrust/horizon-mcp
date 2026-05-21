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

Start Claude Code from that directory. The 84 tools are available immediately.

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

Opens a browser UI showing all 84 tools and the full knowledge resource catalog (17 core URIs + 4 curated playbooks + generated section URIs).
