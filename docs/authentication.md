# Authentication

Two Horizon credential types are supported: a **Horizon API key** and a **TLS client certificate**. Each can be used in one of two ways:

- as a **server credential** (an environment variable), where the MCP authenticates to Horizon as one fixed identity for every caller, or
- as a **per-caller credential** (HTTP transport only), where the client supplies its own credential and the MCP forwards it to Horizon on that caller's behalf.

**The MCP never makes authorization decisions.** It only forwards a Horizon credential; Horizon resolves that credential to a principal and applies that principal's RBAC. Whatever the caller can do in Horizon is exactly what they can do through the MCP.

| Credential type | Server credential (env) | Per-caller credential (HTTP) |
|-----------------|-------------------------|------------------------------|
| Horizon API key | `HORIZON_API_ID` / `HORIZON_API_KEY` | `HORIZON_HTTP_AUTH_MODE=api-key` |
| TLS client certificate | `HORIZON_CLIENT_CERT` + `HORIZON_CLIENT_KEY`, or `HORIZON_CLIENT_PFX` | `HORIZON_HTTP_AUTH_MODE=mtls` |

## Server credentials (stdio and HTTP service mode)

These are the credentials the MCP uses to authenticate as a single identity. They apply to the stdio transport and to the HTTP transport's default `service` mode. The server auto-detects which credential to use from the environment variables that are set.

**Priority:** mTLS (client certificate) > API key. Setting both `HORIZON_CLIENT_CERT` and `HORIZON_CLIENT_PFX` is an error.

### API key

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_API_ID=your-api-id
HORIZON_API_KEY=your-api-key
```

The MCP sends `X-API-ID` / `X-API-KEY` to Horizon as that one identity.

### Mutual TLS (PEM files)

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_CLIENT_CERT=/path/to/client.crt
HORIZON_CLIENT_KEY=/path/to/client.key
HORIZON_CLIENT_KEY_PASSWORD=optional-key-password   # omit if key is unencrypted
```

The MCP performs a real mTLS handshake to Horizon as that identity.

### Mutual TLS (PKCS12 / PFX)

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_CLIENT_PFX=/path/to/client.p12
HORIZON_CLIENT_PFX_PASSWORD=optional-pfx-password   # omit if bundle is unencrypted
```

## Per-caller credentials (HTTP transport)

When the server runs the streamable HTTP transport (`HORIZON_TRANSPORT=http`), `HORIZON_HTTP_AUTH_MODE` selects how each caller is authenticated:

| `HORIZON_HTTP_AUTH_MODE` | Behaviour |
|--------------------------|-----------|
| `service` (default) | The MCP uses its own server credential (above) for every caller. Client-supplied credential headers and client certificates are rejected. |
| `api-key` | Each caller sends its own `X-API-ID` / `X-API-KEY`; the MCP forwards them to Horizon. |
| `mtls` | Each caller presents a TLS client certificate; the MCP forwards it to Horizon (terminate-and-forward, below). |

### `api-key` (forward the caller's API key)

```bash
HORIZON_TRANSPORT=http
HORIZON_HTTP_AUTH_MODE=api-key
```

The client sends its own `X-API-ID` / `X-API-KEY` headers and the MCP forwards them to Horizon. Be aware that this forwards a long-lived secret through the MCP: the caller's API key transits the MCP process on every request.

### `mtls` (terminate-and-forward)

```bash
HORIZON_TRANSPORT=http
HORIZON_HTTP_AUTH_MODE=mtls
# Either the MCP terminates client TLS itself:
HORIZON_HTTP_TLS_CERT=/path/to/listener.crt
HORIZON_HTTP_TLS_KEY=/path/to/listener.key
# ...or a trusted ingress terminates it and forwards the captured cert header:
HORIZON_INBOUND_CERT_HEADER=ssl-client-cert
HORIZON_TRUSTED_PROXY=10.0.0.0/24
# Header used to forward the cert to Horizon's Play backend:
HORIZON_FORWARD_CERT_HEADER=SSL_CLIENT_CERT   # default
```

How it works:

1. The client presents a TLS client certificate. The MCP (or a trusted ingress in front of it) terminates the client TLS with `optional_no_ca` semantics (Node `requestCert: true`, `rejectUnauthorized: false`). This proves the client holds the certificate's private key **without** validating the issuing CA.
2. The MCP forwards the certificate to Horizon's Play backend in the `HORIZON_FORWARD_CERT_HEADER` (default `SSL_CLIENT_CERT`, matching Horizon's `security.http.headers.certificate` config) as a URL-encoded PEM.
3. Horizon validates the chain, checks revocation, and maps the certificate to an identity.

The MCP strips any client-supplied copy of the forward header, so only the possession-verified certificate is ever forwarded. Trust between the MCP and Horizon's Play backend is established by network isolation, not by a shared secret. Note that most MCP clients cannot present a client certificate directly, so a local mTLS proxy on the client side is usually needed.

## Removed: OIDC browser login

The OIDC browser login flow (Playwright) has been **removed entirely**, in every transport including stdio. This is a breaking change. Deployments that relied on browser login must switch to an API key or a TLS client certificate. `HORIZON_AUTH_MODE` is deprecated and ignored; the auth mode is now derived from the credentials that are present.

## Future: headless OIDC bearer token

A headless OIDC bearer token is deferred to future work. It is blocked until Horizon supports a forwardable, API-validatable token. Once it does, the MCP will forward an `Authorization: Bearer` credential the same way it forwards an API key or a client certificate today.

## Configuration reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HORIZON_URL` | Yes | `https://localhost` | Horizon instance URL |
| `HORIZON_API_ID` | API key | | API key identifier (server credential) |
| `HORIZON_API_KEY` | API key | | API key secret (server credential) |
| `HORIZON_CLIENT_CERT` | mTLS (PEM) | | Path to PEM client certificate |
| `HORIZON_CLIENT_KEY` | mTLS (PEM) | | Path to PEM private key |
| `HORIZON_CLIENT_KEY_PASSWORD` | No | | PEM key decryption password |
| `HORIZON_CLIENT_PFX` | mTLS (PFX) | | Path to PKCS12 / PFX bundle |
| `HORIZON_CLIENT_PFX_PASSWORD` | No | | PFX decryption password |
| `HORIZON_TRANSPORT` | No | `stdio` | Transport: `stdio` or `http` |
| `HORIZON_HTTP_AUTH_MODE` | No | `service` | HTTP per-caller mode: `service`, `api-key`, or `mtls` |
| `HORIZON_HTTP_TLS_CERT` | mTLS listener | | Listener cert when the MCP terminates client TLS itself |
| `HORIZON_HTTP_TLS_KEY` | mTLS listener | | Listener key (paired with `HORIZON_HTTP_TLS_CERT`) |
| `HORIZON_INBOUND_CERT_HEADER` | mTLS ingress | | Header a trusted ingress uses to forward the captured client cert |
| `HORIZON_TRUSTED_PROXY` | mTLS ingress | | IP or CIDR allowed to present the inbound cert header (required with `HORIZON_INBOUND_CERT_HEADER`) |
| `HORIZON_FORWARD_CERT_HEADER` | No | `SSL_CLIENT_CERT` | Header the MCP sets on the Horizon-facing request to carry the client cert |
| `HORIZON_VERIFY_SSL` | No | `true` | Verify server TLS certificates |
| `HORIZON_ALLOW_PRIVATE_TLS_PROBE` | No | (blocked) | `fetch_exposed_certificate` blocks private/link-local IPs (SSRF guard); set to `1` to allow probing internal hosts. Rejected in HTTP mode. |
| `HORIZON_TIMEOUT` | No | `30` | HTTP request timeout (seconds) |
| `HORIZON_LOG_LEVEL` | No | `INFO` | Log verbosity: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

Set these as environment variables in your MCP client configuration (see [client setup](client-setup.md)).
