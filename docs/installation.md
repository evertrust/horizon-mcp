# Installation

## Prerequisites

- Bun 1.x or later (recommended), or Node.js 24.10 or later.
- An Evertrust Horizon instance. The maintainers test version 2.10 and expect compatibility with versions 2.8 and 2.9.
- API credentials, a service-account JWT, or a client certificate with the necessary permissions.

## Install methods

### bunx / npx (recommended)

Set `HORIZON_URL` and one complete credential first. See [Authentication](authentication.md). Then run the package without an installation:

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

Download the prebuilt binary for your platform from the [releases page](https://github.com/evertrust/horizon-mcp/releases). Each artifact carries its platform in the name, such as `horizon-mcp-darwin-arm64`. Then, run these commands:

```bash
chmod +x horizon-mcp-darwin-arm64
./horizon-mcp-darwin-arm64
```

Rename the file to `horizon-mcp` if you prefer the short command.

The project supplies binaries for macOS, Linux, and Windows. The macOS and Linux binaries support the x64 and arm64 architectures. The binaries support trusted-TLS stdio authentication with an API key or with a service account.

> Note: Use Node for PEM mTLS or PFX mTLS to Horizon, and for `HORIZON_VERIFY_SSL=false`. Bun's built-in fetch ignores the undici Agent that those settings need.

### Docker with streamable HTTP

The repository `Dockerfile` builds the TypeScript bundle. It runs the bundle on Node 24 as the unprivileged `node` user.

The image uses these default values:

- `HORIZON_TRANSPORT=http`.
- `HORIZON_HTTP_HOST=0.0.0.0`.
- Port `8080`.

The container holds no credential of its own, and each caller sends one. Create an untracked `.env.http` file for a local deployment:

```dotenv
HORIZON_URL=https://horizon.example.com
HORIZON_HTTP_AUTH_METHODS=api-key,service
HORIZON_TRUSTED_HOSTS=localhost:8080,127.0.0.1:8080
```

Run these commands to build the image and bind the published port to loopback:

```bash
docker build -t horizon-mcp .
docker run --rm --name horizon-mcp \
  --env-file .env.http \
  -p 127.0.0.1:8080:8080 \
  horizon-mcp
```

Call the liveness probe and the readiness probe:

```bash
curl -H 'Host: localhost:8080' http://127.0.0.1:8080/healthz
curl -H 'Host: localhost:8080' http://127.0.0.1:8080/readyz
```

The server validates the `Host` header of both probes, and readiness means that the listener can accept requests. Without a matching `Host` value the server answers `421`, because it validates the header against `HORIZON_TRUSTED_HOSTS`.

For remote hosting, complete these steps:

- Set `HORIZON_PUBLIC_URL` to the external HTTPS origin.
- If the endpoint does not use the default `/mcp` path, set `HORIZON_HTTP_PATH`.
- Terminate TLS at a trusted edge, or configure the inbound mTLS listener of the server.
- Store the secrets in the orchestrator secret store. Do not store them in the image or in the repository.
- Enable only the authentication methods that the deployment needs. Horizon validates the credentials of a caller on the first request, and again when the cached result expires.
- Run as many replicas as you need. The server keeps no session state, so it needs no session affinity.
- Send the probes with a `Host` value from `HORIZON_PUBLIC_URL` or `HORIZON_TRUSTED_HOSTS`.

See the HTTP environment-variable table in the [README](../README.md#streamable-http-horizon_transporthttp) and remote examples in [client setup](client-setup.md).

## Next steps

- [Authentication](authentication.md) - configure how the server connects to Horizon
- [Client setup](client-setup.md) - connect your LLM client to the server
