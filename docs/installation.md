# Installation

## Prerequisites

- Bun 1.x+ (recommended) or Node.js >=24.10
- An Evertrust Horizon instance (tested on 2.8, expected to work on 2.7 and 2.9)
- API credentials or a client certificate with appropriate permissions

## Install methods

### bunx (recommended)

No installation needed - run directly:

```bash
bunx horizon-mcp-server
```

### Global install

```bash
bun install -g horizon-mcp-server
```

Then run:

```bash
horizon-mcp-server
```

### Local install

```bash
npm install
npm run build
```

### Standalone binary

Download the pre-built binary for your platform from the [releases page](https://github.com/evertrust/horizon-mcp/releases), then:

```bash
chmod +x horizon-mcp
./horizon-mcp
```

## OIDC browser authentication (optional)

For OIDC browser-based login, install Playwright and its Chromium browser:

```bash
bun install playwright
bunx playwright install chromium
```

## Next steps

- [Authentication](authentication.md) - configure how the server connects to Horizon
- [Client setup](client-setup.md) - connect your LLM client to the server
