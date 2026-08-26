# Authentication

Horizon MCP supports two credential ownership models:

- In **stdio** mode, one environment-owned credential authenticates the local MCP process to Horizon.
- In **streamable HTTP** mode, each caller supplies a Horizon credential. The server accepts only configured authentication methods.

The MCP forwards the selected identity to Horizon. Horizon resolves the identity to a principal and applies its role-based access control (RBAC).

The MCP does not duplicate Horizon RBAC. The MCP rejects requests that contain more than one complete credential type.

## Stdio server credentials

Configure exactly one complete stdio authentication method. API key,
service-account, PEM mTLS, and PFX mTLS credentials are mutually exclusive.
Startup fails when a pair is incomplete or more than one method is present.

### API key

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_API_ID=your-api-id
HORIZON_API_KEY=your-api-key
```

### Mutual TLS

PEM and PFX mTLS to Horizon are supported only with Node because Bun's built-in fetch ignores the undici Agent that carries the client certificate.

```bash
# PEM
HORIZON_CLIENT_CERT=/path/to/client.crt
HORIZON_CLIENT_KEY=/path/to/client.key
HORIZON_CLIENT_KEY_PASSWORD=optional-password

# Or PKCS12 / PFX
HORIZON_CLIENT_PFX=/path/to/client.p12
HORIZON_CLIENT_PFX_PASSWORD=optional-password
```

### Service-account JWT

```bash
HORIZON_SERVICE_ACCOUNT=automation-account
HORIZON_API_TOKEN=initial-jwt
```

Alternatively, stdio can mint the first token at startup when exactly one
issuer is pinned:

```bash
HORIZON_SERVICE_ACCOUNT=automation-account
HORIZON_OAUTH_CLIENT_ID=oauth-client
HORIZON_OAUTH_CLIENT_SECRET=oauth-secret
HORIZON_OAUTH_ISSUERS='{"https://issuer.example.com":{"tokenUrl":"https://issuer.example.com/oauth/token","authMethod":"client_secret_basic"}}'
```

Horizon validates the JWT signature against the JWKS configured for the
service account, maps it to a Horizon principal, and applies that principal's
RBAC. A service account trusts one of two JWKS sources, chosen in its
`trustConfig`: `static_jwks`, a key set embedded in the service-account
definition, or `dynamic_jwks`, a key set Horizon fetches from a URL (optionally
through a configured HTTP proxy) and refreshes itself. In both modes Horizon
owns JWKS retrieval and signature verification; the MCP only forwards
`X-API-SVA` and `X-API-TOKEN` and does not independently verify the JWT
signature. It forwards the
initial pair unchanged unless pinned renewal is required. In discovery fallback
mode, it does not trust the token-controlled `iss` or `exp` claims until Horizon
accepts the token during lazy initialization.

For automatic renewal, configure the OAuth `client_credentials` tuple:

```bash
HORIZON_OAUTH_CLIENT_ID=oauth-client
HORIZON_OAUTH_CLIENT_SECRET=oauth-secret
HORIZON_OAUTH_SCOPE=horizon.read       # optional, provider-specific
HORIZON_OAUTH_AUDIENCE=horizon-api     # optional, provider-specific
HORIZON_OAUTH_ISSUERS='{"https://issuer.example.com":{"tokenUrl":"https://issuer.example.com/oauth/token","authMethod":"client_secret_basic"}}'
```

Client ID and secret must be set together. Scope and audience are accepted
only with that complete pair. `HORIZON_OAUTH_ISSUERS` is operator configuration
shared by stdio and HTTP renewal. It pins each allowed JWT issuer to a token URL
and client authentication method. See
[Service-account JWT renewal](#service-account-jwt-renewal) for the pinned and
fallback modes.

## HTTP authentication whitelist

`HORIZON_HTTP_AUTH_METHODS` is a comma-separated or pipe-separated whitelist. The server stores the whitelist as this bit mask:

- `api-key = 0b001`
- `mtls = 0b010`
- `service = 0b100`

You can combine the values with binary OR (`|`). For example, both values below enable `api-key` and `service`:

```bash
HORIZON_TRANSPORT=http
HORIZON_HTTP_AUTH_METHODS=api-key,service
# Equivalent spelling:
# HORIZON_HTTP_AUTH_METHODS=api-key|service
```

The default value is `api-key`. The server no longer supports the singular `HORIZON_HTTP_AUTH_MODE` variable.

If you use the old variable, the server stops during HTTP startup. The error message gives the new variable name.

| Method    | Caller credential                                            | Horizon forwarding                               |
| --------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `api-key` | `X-API-ID` + `X-API-KEY`                                     | Same header pair                                 |
| `service` | `X-API-SVA` + `X-API-TOKEN`                                  | Same service-account name and JWT                |
| `mtls`    | TLS client certificate or trusted ingress certificate header | URL-encoded PEM in `HORIZON_FORWARD_CERT_HEADER` |

Credential pairs must be complete. The MCP rejects these requests without a fallback:

- A request with no credential.
- A request with an incomplete credential pair.
- A request with a credential type that is not in the whitelist.
- A request with more than one complete credential type.

Every `401` response includes a `WWW-Authenticate` header. Its value is `Horizon methods="<accepted methods>"`, where the comma-separated list reflects `HORIZON_HTTP_AUTH_METHODS`. A caller can use this challenge to select a credential type without consulting the server configuration.

### Credential cache lifecycle

Under Node, the HTTP server caches validated credentials by fingerprint; concurrent misses share one validation build, where disconnecting one waiter cancels only its wait and the build is cancelled after its last waiter disconnects. Each admitted request holds a lease on its cached Horizon client. The TTL is absolute and counted from validation, so credentials are periodically revalidated even if Horizon has not rejected them. Unknown-credential validation is rate limited per peer and in aggregate, and exceeding either limit is answered with HTTP 429. When a non-CSRF Horizon `401` or `403` reaches the end of the client's authentication-retry path, it retires the cached credential immediately, so the next request revalidates against Horizon. The client makes one re-authentication attempt first unless re-authentication backoff suppresses it. CSRF-token rejections use a separate retry path and do not retire the credential. TTL expiry, LRU eviction, invalidation, and shutdown remove a record from reuse immediately, but client closure and authentication cleanup wait until every request holding that record has released its lease. A later request never receives a retired record and revalidates a fresh one instead.

Cache shutdown waits for outstanding leases. The HTTP server applies its configured graceful-shutdown timeout as the process-level bound.

### Service-account JWT renewal

Horizon JWKS service-account authentication requires a JSON Web Token (JWT) on each Horizon request. It is available to both transports: stdio reads service-account settings from environment variables, while HTTP reads a complete service-account pair and optional renewal tuple from request headers.

In stdio mode, the MCP loads the service-account name and normally an initial
JWT from its environment. When the initial JWT is omitted, the complete OAuth
client pair and exactly one `HORIZON_OAUTH_ISSUERS` entry let the MCP mint the
first token during startup without reading token claims. If the startup mint
fails, the MCP logs a safe error without the token endpoint response body and
continues serving. Tool calls report that the token has not been minted, and
the request path retries after the existing 30-second cooldown.

Hosts built on MCP SDK 2.0 start a stdio server twice per connection: a
short-lived sibling process answers the connect-time `server/discover` probe,
then the session process starts. The startup mint therefore runs twice per
launch. This is harmless (the sibling exits right after the probe) but it is
visible as two token requests in identity-provider logs.

HTTP mode is unchanged. Every HTTP service-account request must send both
`X-API-SVA` and `X-API-TOKEN`, even if it also sends OAuth client headers and
the operator configured exactly one pinned issuer. The MCP never constructs an
HTTP request provider with an empty token.

For renewal, stdio can load OAuth 2.0 client credentials from its environment,
and an HTTP caller can send the equivalent values in these headers:

| Header                  | Required for renewal | Purpose                                                               |
| ----------------------- | -------------------- | --------------------------------------------------------------------- |
| `X-OAUTH-CLIENT-ID`     | Yes                  | OAuth client identifier                                               |
| `X-OAUTH-CLIENT-SECRET` | Yes                  | OAuth client secret                                                   |
| `X-OAUTH-SCOPE`         | Provider-specific    | Space-separated scopes, such as an Entra ID resource with `/.default` |
| `X-OAUTH-AUDIENCE`      | Provider-specific    | Non-standard audience parameter used by providers such as Auth0       |

The MCP does not forward the OAuth client headers to Horizon. The MCP does not expose these headers to MCP tools.

The MCP removes them from parsed and raw request headers. It uses them only in the credential fingerprint.

The issuer allowlist is process-level operator configuration. There is no HTTP
header for an issuer map, token URL, or authentication method. A caller cannot
override `HORIZON_OAUTH_ISSUERS`.

Configure the OAuth client to allow the `client_credentials` grant. Configure the required resource, audience, or scopes in your identity provider.

A JWT does not contain a standard renewal URL. Operators should configure the
higher-assurance pinned mode at startup:

```bash
HORIZON_OAUTH_ISSUERS='{
  "https://issuer.example.com": {
    "tokenUrl": "https://issuer.example.com/oauth/token",
    "authMethod": "client_secret_basic"
  }
}'
```

The value is a JSON map from the exact JWT `iss` value to `tokenUrl` and
`authMethod`. Issuer keys and token URLs must be absolute HTTPS URLs. The only
accepted methods are `client_secret_basic` and `client_secret_post`. The value
is limited to 65,536 characters and malformed entries stop startup with an
error naming the offending issuer key.

With the allowlist configured, a presented JWT's `iss` must exactly match an
own-property map key. Otherwise renewal is refused and the error names the
configured issuers. When stdio starts without a JWT and the map contains
exactly one issuer, the MCP selects that entry directly and mints the first
token. With zero or multiple entries, startup settings validation requires
`HORIZON_API_TOKEN`. Because the token endpoint and authentication method come
only from operator configuration, pinned mode may renew an expired or rejected
token before Horizon validates the presented token. The MCP sends credentials
only to the mapped `tokenUrl`, using only the mapped authentication method. It
does not perform discovery in this mode.

When `HORIZON_OAUTH_ISSUERS` is unset, the existing lower-assurance fallback
remains available for compatibility. After Horizon validates the initial JWT,
the MCP reads its `iss` claim, requests the issuer's OpenID Connect discovery
document, verifies the discovery issuer, and uses its `token_endpoint`. The
issuer and token endpoint must use HTTPS, the endpoint must have the same origin
as the issuer, and redirects are refused. This mode derives a network target
from a token claim and should be used only where operator pinning is unavailable.
The discovery fallback never contacts an issuer before Horizon accepts the
presented token. Consequently, an unpinned stdio deployment whose initial token
is rejected cannot self-heal through automatic renewal.

The renewal sequence is as follows:

1. Stdio loads the service-account settings from the environment, or an HTTP
   client sends a complete service-account pair and optional renewal headers.
2. Stdio with no initial token mints one at startup only when the OAuth client
   pair is complete and the issuer map contains exactly one entry.
3. In other pinned cases, the MCP may renew before Horizon validation after
   requiring the presented JWT's `iss` to exactly match an own-property key.
4. Otherwise, the MCP forwards the initial `X-API-TOKEN` to Horizon unchanged.
5. Horizon validates the presented JWT. Only after this succeeds may fallback
   mode trust its `iss` and `exp` claims and perform constrained discovery.
6. In pinned mode, the MCP selects only the mapped token URL and authentication
   method. In fallback mode, it performs the constrained discovery described
   above.
7. The MCP requests a token 60 seconds before expiry. It also requests a token after Horizon rejects authentication.
8. The request contains `grant_type=client_credentials`. It also contains the configured scope or audience.
9. The MCP verifies that the renewed JWT's `iss` matches the selected issuer before using the token.
10. The MCP uses the returned `access_token` as the new `X-API-TOKEN`.
11. Concurrent refresh requests use one shared renewal request. After a failed
    renewal, that provider waits 30 seconds before another attempt.

Operator pinning removes the token-controlled discovery request and is the
recommended SSRF control. Entra ID and Okta deployments usually support this
flow.

Google Workspace service accounts usually use JWT bearer assertions or domain-wide delegation. These flows are different from the `client_credentials` flow.

The MCP does not support these Google Workspace flows.

Every token rotation changes the Horizon principal. Horizon derives the
identity of a service-account caller as
`<service-account name>-<first 16 hex characters of sha256(jwt)>`, followed by
the value of the account's `identifierMapping` template when one is configured.
The hash segment is always present and is computed over the presented token, so
a renewed token yields a new identifier even when its issuer, subject and every
other claim match the previous one; `identifierMapping` adds claim-derived
context to the name but never removes the hash. Ownership, permissions granted
to the identifier, and the audit identity recorded by Horizon therefore do not
carry over across renewals. Grant permissions through the service account's
roles and use team-based ownership for anything that must survive rotation. The
MCP's issuer check on renewal only prevents a renewed token from coming from a
different issuer; it does not preserve identity.

If stdio omits the renewal tuple, or an HTTP caller omits the OAuth headers, the
MCP forwards the JWT but cannot renew it.

### API-key forwarding

Send `X-API-ID` and `X-API-KEY` on each MCP HTTP request. Every request is authenticated on its own; there is no session to establish first.

The MCP forwards both headers to Horizon.

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

The MCP listener requests a certificate with `requestCert: true` and `rejectUnauthorized: false`. This is by design: the HTTP listener proves possession of the client key, but does not validate the certificate authority.

The MCP forwards the URL-encoded PEM certificate. Horizon validates the certificate chain, revocation status, and identity.

Alternatively, a trusted ingress can forward the certificate. The MCP identifies the ingress by its direct TCP peer IP address or CIDR.

The MCP does not use `X-Forwarded-For` for this check.

### Readiness

`/readyz` reports process readiness only. In HTTP mode the server holds no Horizon credential of its own, so it cannot probe Horizon on an operator's behalf.

## MCP OAuth authorization is not supported

The MCP specification defines an optional OAuth flow in which the client obtains a token for the MCP server itself and
sends it in an `Authorization: Bearer` header. This server does not implement it. `Authorization`, `Proxy-Authorization`,
and `Cookie` are rejected with a 400, and the error names `HORIZON_HTTP_AUTH_METHODS` so the cause is clear.

Use one of the Horizon-native methods above instead. They give you per-user identity in Horizon, which is what
ownership, team membership, and the audit trail depend on.

If your client only speaks MCP OAuth, it cannot use this server over HTTP today. The reasoning, and what would have to
change in Horizon first, is recorded in [ADR 0001](adr/0001-mcp-authorization.md).

## Transport security

API keys, service JWTs, and OAuth client secrets are header credentials. The server rejects an unencrypted, non-loopback configuration for these credentials.

Use an HTTPS `HORIZON_PUBLIC_URL` behind a TLS termination point. Alternatively, bind the server to a loopback address.

## Configuration reference

| Variable                                                  | Required            | Default             | Description                                                                             |
| --------------------------------------------------------- | ------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `HORIZON_URL`                                             | Yes                 | `https://localhost` | Horizon instance URL                                                                    |
| `HORIZON_API_ID` / `HORIZON_API_KEY`                      | Stdio API key       |                     | Environment-owned stdio credential                                                      |
| `HORIZON_SERVICE_ACCOUNT` / `HORIZON_API_TOKEN`           | Stdio service       |                     | Service-account name and initial JWT; the JWT has the documented startup-mint exception |
| `HORIZON_OAUTH_CLIENT_ID` / `HORIZON_OAUTH_CLIENT_SECRET` | Stdio renewal       |                     | OAuth client credentials for JWT renewal                                                |
| `HORIZON_OAUTH_SCOPE` / `HORIZON_OAUTH_AUDIENCE`          | Provider-specific   |                     | Optional OAuth renewal parameters                                                       |
| `HORIZON_OAUTH_ISSUERS`                                   | Recommended renewal |                     | Operator-pinned issuer, token URL, and auth-method map                                  |
| `HORIZON_CLIENT_CERT` / `HORIZON_CLIENT_KEY`              | Stdio PEM mTLS      |                     | Environment-owned stdio certificate credential; Node only                               |
| `HORIZON_CLIENT_PFX`                                      | Stdio PFX mTLS      |                     | Environment-owned stdio certificate bundle; Node only                                   |
| `HORIZON_TRANSPORT`                                       | No                  | `stdio`             | `stdio` or `http`                                                                       |
| `HORIZON_HTTP_AUTH_METHODS`                               | HTTP                | `api-key`           | Comma/pipe whitelist of `api-key`, `mtls`, and `service`                                |
| `HORIZON_HTTP_TLS_CERT` / `HORIZON_HTTP_TLS_KEY`          | Direct inbound mTLS |                     | MCP listener certificate and key                                                        |
| `HORIZON_INBOUND_CERT_HEADER`                             | Ingress mTLS        |                     | Trusted ingress certificate header                                                      |
| `HORIZON_TRUSTED_PROXY`                                   | Ingress mTLS        |                     | Direct peer IP or IPv4 CIDR allowed to set that header                                  |
| `HORIZON_FORWARD_CERT_HEADER`                             | No                  | `SSL_CLIENT_CERT`   | Horizon-facing certificate header                                                       |
| `HORIZON_VERIFY_SSL`                                      | No                  | `true`              | Verify Horizon TLS certificates; disabling verification requires Node                   |

See [client setup](client-setup.md) for remote-client header examples.
