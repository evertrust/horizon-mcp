# Client setup

Configure your LLM client to connect to the horizon-mcp server. In every example below, replace `/absolute/path/to/horizon-mcp/.venv/bin/python` with the actual path from `echo "$(pwd)/.venv/bin/python"` (see [installation](installation.md)).

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Restart Claude Desktop. The Horizon tools appear in the tools panel.

## Claude Code

Create `.mcp.json` in your project root:

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

Start Claude Code from that directory. The 66 tools are available immediately.

## Cursor

Create `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` for global access):

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

Restart Cursor. The Horizon tools appear in Cursor's MCP tools panel.

## Codex (CLI and Desktop app)

Codex CLI and the Codex Desktop app share the same configuration at `~/.codex/config.toml`:

```toml
[mcp_servers.horizon]
command = "/absolute/path/to/horizon-mcp/.venv/bin/python"
args = ["-m", "horizon_mcp.server"]

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
  -- /absolute/path/to/horizon-mcp/.venv/bin/python -m horizon_mcp.server
```

## OpenCode

Add to `opencode.json`:

```json
{
  "mcp": {
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

## MCP Inspector (debugging and exploration)

```bash
export HORIZON_URL=https://horizon.example.com
export HORIZON_API_ID=your-api-id
export HORIZON_API_KEY=your-api-key

npx @modelcontextprotocol/inspector /absolute/path/to/horizon-mcp/.venv/bin/python -- -m horizon_mcp.server
```

Opens a browser UI showing all 66 tools and 12 knowledge resources.
