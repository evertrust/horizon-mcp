# Authentication

Horizon MCP supports two credential models:

- In **stdio** mode, one environment-owned API key or client certificate authenticates the local MCP process to Horizon.
- In **streamable HTTP** mode, every caller supplies its own Horizon credential. The server whitelists one or more accepted methods and forwards only the selected identity to Horizon.

Horizon resolves the credential to a principal and applies its RBAC. The MCP does not reimplement Horizon RBAC, and ambiguous requests carrying more than one credential type are rejected.

## Stdio server credentials

Stdio credentials are auto-detected with the priority mTLS > API key.

### API key

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_API_ID=your-api-id
HORIZON_API_KEY=your-api-key
```

### Mutual TLS

```bash
# PEM
HORIZON_CLIENT_CERT=/path/to/client.crt
HORIZON_CLIENT_KEY=/path/to/client.key
HORIZON_CLIENT_KEY_PASSWORD=optional-password

# Or PKCS12 / PFX
HORIZON_CLIENT_PFX=/path/to/client.p12
HORIZON_CLIENT_PFX_PASSWORD=optional-password
```

## HTTP authentication whitelist

`HORIZON_HTTP_AUTH_METHODS` is a comma- or pipe-separated whitelist. Its internal representation is a bit mask (`api-key = 0b001`, `mtls = 0b010`, `service = 0b100`), so methods can be combined:

```bash
HORIZON_TRANSPORT=http
HORIZON_HTTP_AUTH_METHODS=api-key,service
# Equivalent spelling:
# HORIZON_HTTP_AUTH_METHODS=api-key|service
```

The default is `api-key`. The removed singular `HORIZON_HTTP_AUTH_MODE` fails HTTP startup with a migration error instead of being silently ignored.

| Method | Caller credential | Horizon forwarding |
|--------|-------------------|--------------------|
| `api-key` | `X-API-ID` + `X-API-KEY` | Same header pair |
| `service` | `X-API-SVA` + `X-API-TOKEN` | Same service-account name and JWT |
| `mtls` | TLS client certificate or trusted ingress certificate header | URL-encoded PEM in `HORIZON_FORWARD_CERT_HEADER` |

Credential pairs must be complete. A credential outside the whitelist, no credential, or multiple complete credential types are rejected without fallback.

### Service-account JWT renewal

Horizon JWKS service-account authentication requires the JWT on every Horizon request. Callers may let the MCP renew a short-lived third-party JWT with OAuth 2.0 `client_credentials` by also sending:

| Header | Required for renewal | Purpose |
|--------|----------------------|---------|
| `X-OAUTH-CLIENT-ID` | Yes | OAuth client identifier |
| `X-OAUTH-CLIENT-SECRET` | Yes | OAuth client secret |
| `X-OAUTH-SCOPE` | Provider-specific | Space-separated requested scopes (for example Entra ID's resource `/.default`) |
| `X-OAUTH-AUDIENCE` | Provider-specific | Non-standard audience parameter used by providers such as Auth0 |

The MCP never forwards these OAuth client headers to Horizon or exposes them to MCP tools. They are scrubbed from both parsed and raw request headers and included only in the session's one-way credential fingerprint.

Renewal works as follows:

1. The initial `X-API-TOKEN` is forwarded unchanged to Horizon.
2. Only after Horizon accepts it does the MCP trust its `iss` and `exp` claims. This prevents an unvalidated JWT from triggering server-side network requests.
3. The MCP reads the issuer's HTTPS `/.well-known/openid-configuration`, with redirects disabled, and verifies the returned issuer.
4. It selects `client_secret_basic` or `client_secret_post` from `token_endpoint_auth_methods_supported`.
5. Within 60 seconds of expiry—or after Horizon rejects authentication—it posts `grant_type=client_credentials`, plus the configured scope/audience, and uses the standard `access_token` response as the new `X-API-TOKEN`.
6. Concurrent refresh requests share one in-flight renewal.

Issuer discovery and token endpoints must use HTTPS, and the token endpoint must be same-origin with the issuer to prevent SSRF. Entra ID and Okta client-credential deployments generally fit this flow. Google Workspace service accounts commonly use JWT bearer assertions or domain-wide delegation instead of `client_credentials`; those flows are not interchangeable and are not implemented here.

If the OAuth headers are omitted, the MCP forwards the caller JWT but cannot renew it automatically.

### API-key forwarding

The client sends `X-API-ID` and `X-API-KEY` on every MCP HTTP request. The MCP binds the session to their fingerprint and forwards them to Horizon.

### mTLS terminate-and-forward

```bash
HORIZON_HTTP_AUTH_METHODS=mtls

# Either terminate client TLS in the MCP:
HORIZON_HTTP_TLS_CERT=/path/to/listener.crt
HORIZON_HTTP_TLS_KEY=/path/to/listener.key

# Or trust one ingress forwarding the captured certificate:
HORIZON_INBOUND_CERT_HEADER=ssl-client-cert
HORIZON_TRUSTED_PROXY=10.0.0.0/24

HORIZON_FORWARD_CERT_HEADER=SSL_CLIENT_CERT
```

The MCP listener requests a certificate with `requestCert: true` and `rejectUnauthorized: false`, proving possession without validating the CA. Horizon validates the chain, revocation status, and identity after the MCP forwards the URL-encoded PEM. A trusted ingress alternative is bound to the direct TCP peer IP/CIDR, never `X-Forwarded-For`.

## Transport security

API keys, service JWTs, and OAuth client secrets are header credentials. HTTP startup refuses a non-loopback cleartext deployment whenever `api-key` or `service` is enabled. Use an HTTPS `HORIZON_PUBLIC_URL` behind a TLS-terminating edge, or bind to loopback.

## Configuration reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HORIZON_URL` | Yes | `https://localhost` | Horizon instance URL |
| `HORIZON_API_ID` / `HORIZON_API_KEY` | Stdio API key | | Environment-owned stdio credential |
| `HORIZON_CLIENT_CERT` / `HORIZON_CLIENT_KEY` | Stdio PEM mTLS | | Environment-owned stdio certificate credential |
| `HORIZON_CLIENT_PFX` | Stdio PFX mTLS | | Environment-owned stdio certificate bundle |
| `HORIZON_TRANSPORT` | No | `stdio` | `stdio` or `http` |
| `HORIZON_HTTP_AUTH_METHODS` | HTTP | `api-key` | Comma/pipe whitelist of `api-key`, `mtls`, and `service` |
| `HORIZON_HTTP_TLS_CERT` / `HORIZON_HTTP_TLS_KEY` | Direct inbound mTLS | | MCP listener certificate and key |
| `HORIZON_INBOUND_CERT_HEADER` | Ingress mTLS | | Trusted ingress certificate header |
| `HORIZON_TRUSTED_PROXY` | Ingress mTLS | | Direct peer IP or IPv4 CIDR allowed to set that header |
| `HORIZON_FORWARD_CERT_HEADER` | No | `SSL_CLIENT_CERT` | Horizon-facing certificate header |
| `HORIZON_VERIFY_SSL` | No | `true` | Verify Horizon TLS certificates |

See [client setup](client-setup.md) for remote-client header examples.
