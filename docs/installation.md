# Installation

## Prerequisites

- Bun 1.x or later (recommended), or Node.js 24.10 or later.
- An Evertrust Horizon instance. The maintainers test version 2.10 and expect compatibility with versions 2.8 and 2.9.
- API credentials, a service-account JWT, or a client certificate with the necessary permissions.

## Install methods

### bunx / npx (recommended)

Run the package without an installation:

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

Download the prebuilt binary for your platform from the [releases page](https://github.com/evertrust/horizon-mcp/releases). Then, run these commands:

```bash
chmod +x horizon-mcp
./horizon-mcp
```

The project provides binaries for macOS, Linux, and Windows. The macOS and Linux binaries support x64 and arm64 architectures.

### Docker with streamable HTTP

The repository `Dockerfile` builds the TypeScript bundle. It runs the bundle on Node 24 as the unprivileged `node` user.

The image uses these default values:

- `HORIZON_TRANSPORT=http`.
- `HORIZON_HTTP_HOST=0.0.0.0`.
- Port `8080`.

Create an untracked `.env.http` file for a local per-caller deployment:

```dotenv
HORIZON_URL=https://horizon.example.com
HORIZON_HTTP_AUTH_METHODS=api-key,service
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

The server validates the `Host` header of both probes. Readiness means that the listener can accept requests.

Horizon validates each caller's credentials on their first request, and again whenever the cached result expires:

```bash
curl -H 'Host: localhost:8080' http://127.0.0.1:8080/healthz
curl -H 'Host: localhost:8080' http://127.0.0.1:8080/readyz
```

For remote hosting, complete these steps:

- Set `HORIZON_PUBLIC_URL` to the external HTTPS origin.
- Set `HORIZON_HTTP_PATH` if the endpoint does not use the default `/mcp` path.
- Terminate TLS at a trusted edge. Alternatively, configure the MCP inbound mTLS listener.
- Store secrets in the orchestrator secret store. Do not store them in the image or repository.
- Enable only the authentication methods that the deployment requires.
- Run as many replicas as you need. The server keeps no session state, so no session affinity is required.
- Send probes with a `Host` value from `HORIZON_PUBLIC_URL` or `HORIZON_TRUSTED_HOSTS`.

See the HTTP environment-variable table in the [README](../README.md#streamable-http-horizon_transporthttp) and remote examples in [client setup](client-setup.md).

## Next steps

- [Authentication](authentication.md) - configure how the server connects to Horizon
- [Client setup](client-setup.md) - connect your LLM client to the server
