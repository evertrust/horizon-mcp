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

### Docker (streamable HTTP)

The repository `Dockerfile` builds the TypeScript bundle and runs it on Node 24
as the unprivileged `node` user. The image defaults to
`HORIZON_TRANSPORT=http`, `HORIZON_HTTP_HOST=0.0.0.0`, and port `8080`.

Create an untracked `.env.http` file for a local service-mode deployment:

```dotenv
HORIZON_URL=https://horizon.example.com
HORIZON_API_ID=your-api-id
HORIZON_API_KEY=your-api-key
HORIZON_HTTP_AUTH_MODE=service
HORIZON_TRUSTED_HOSTS=localhost:8080,127.0.0.1:8080
```

Build and bind the published port to loopback:

```bash
docker build -t horizon-mcp .
docker run --rm --name horizon-mcp \
  --env-file .env.http \
  -p 127.0.0.1:8080:8080 \
  horizon-mcp
```

Both probes are Host-validated. In `service` mode, readiness also validates the
configured Horizon credential and caches the result briefly; per-caller modes
have no server credential to probe:

```bash
curl -H 'Host: localhost:8080' http://127.0.0.1:8080/healthz
curl -H 'Host: localhost:8080' http://127.0.0.1:8080/readyz
```

For remote hosting:

- set `HORIZON_PUBLIC_URL` to the externally reachable HTTPS origin (the MCP
  endpoint is that origin joined with `HORIZON_HTTP_PATH`, default `/mcp`);
- terminate TLS at a trusted edge unless the MCP is configured with its own
  inbound mTLS listener;
- keep secrets in the orchestrator's secret store, not the image or repository;
- protect `service` mode with network placement or an authenticating edge,
  because every reachable caller acts as the server credential;
- run one replica, or configure session affinity using `Mcp-Session-Id`;
- send liveness/readiness probes with a Host value derived from
  `HORIZON_PUBLIC_URL` or included in `HORIZON_TRUSTED_HOSTS`.

See the HTTP environment-variable table in the [README](../README.md#streamable-http-horizon_transporthttp) and remote examples in [client setup](client-setup.md).

## Next steps

- [Authentication](authentication.md) - configure how the server connects to Horizon
- [Client setup](client-setup.md) - connect your LLM client to the server
