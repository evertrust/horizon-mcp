# Installation

## Prerequisites

- Bun 1.x+ (recommended) or Node.js >= 24.10
- An Evertrust Horizon instance (tested on 2.8, expected to work on 2.7 and 2.9)
- API credentials or a client certificate with appropriate permissions

## Install methods

### bunx / npx (recommended)

No installation needed, run directly:

```bash
bunx @evertrust/horizon-mcp
# or
npx -y @evertrust/horizon-mcp
```

### Global install

```bash
bun install -g @evertrust/horizon-mcp
```

Then run:

```bash
horizon-mcp
```

### Local install (from source)

```bash
git clone https://github.com/evertrust/horizon-mcp.git
cd horizon-mcp
bun install
bun run build
node dist/index.js
```

### Standalone binary

Download the pre-built binary for your platform from the [releases page](https://github.com/evertrust/horizon-mcp/releases), then:

```bash
chmod +x horizon-mcp
./horizon-mcp
```

Binaries are published for macOS (x64/arm64), Linux (x64/arm64), and Windows (x64).

## Next steps

- [Authentication](authentication.md) - configure how the server connects to Horizon
- [Client setup](client-setup.md) - connect your LLM client to the server
