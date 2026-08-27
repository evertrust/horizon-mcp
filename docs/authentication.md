# Authentication

Horizon MCP has two credential ownership models:

- In **stdio** mode, one environment-owned credential authenticates the local
  server process to Horizon.
- In **streamable HTTP** mode, each caller supplies a Horizon credential. The
  server accepts only the configured authentication methods.

The server forwards the selected identity to Horizon. Horizon resolves the
identity to a principal and applies its role-based access control (RBAC). The
server does not duplicate Horizon RBAC.

The server rejects a request that contains more than one complete credential
type.

## Stdio server credentials

Configure exactly one complete stdio authentication method. The API key, the
service account, the PEM mTLS credential and the PFX mTLS credential are
mutually exclusive. If a pair is incomplete, or if more than one method is
present, the server does not start.

### API key

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_API_ID=your-api-id
HORIZON_API_KEY=your-api-key
```

### Mutual TLS

> Note: PEM mTLS and PFX mTLS to Horizon work only with Node. Bun's built-in
> fetch ignores the undici Agent that carries the client certificate.

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

Stdio can also start without `HORIZON_API_TOKEN` and mint the first token. See
[Service-account JWT renewal](#service-account-jwt-renewal) for the conditions:

```bash
HORIZON_SERVICE_ACCOUNT=automation-account
HORIZON_OAUTH_CLIENT_ID=oauth-client
HORIZON_OAUTH_CLIENT_SECRET=oauth-secret
HORIZON_OAUTH_ISSUERS='{"https://issuer.example.com":{"tokenUrl":"https://issuer.example.com/oauth/token","authMethod":"client_secret_basic"}}'
```

Horizon validates the JWT signature against the JWKS configured for the service
account. Horizon then maps the token to a Horizon principal and applies the RBAC
of that principal.

A service account trusts one of two JWKS sources. The `trustConfig` of the
account selects the source:

- `static_jwks` is a key set embedded in the service-account definition.
- `dynamic_jwks` is a key set that Horizon fetches from a URL and refreshes
  itself. Horizon can fetch it through a configured HTTP proxy.

In both modes, Horizon owns the JWKS retrieval and the signature verification.
The server only forwards `X-API-SVA` and `X-API-TOKEN`, and it does not verify
the JWT signature itself. It forwards the initial pair unchanged unless pinned
renewal is necessary. In discovery fallback mode, the server does not trust the
token-controlled `iss` claim or `exp` claim until Horizon accepts the token on
the first Horizon request.

For automatic renewal, configure the OAuth renewal settings:

```bash
HORIZON_OAUTH_CLIENT_ID=oauth-client
HORIZON_OAUTH_CLIENT_SECRET=oauth-secret
HORIZON_OAUTH_SCOPE=horizon.read       # optional, provider-specific
HORIZON_OAUTH_AUDIENCE=horizon-api     # optional, provider-specific
HORIZON_OAUTH_ISSUERS='{"https://issuer.example.com":{"tokenUrl":"https://issuer.example.com/oauth/token","authMethod":"client_secret_basic"}}'
```

Set the client ID and the client secret together. The server accepts the scope
and the audience only with that complete pair.

`HORIZON_OAUTH_ISSUERS` is operator configuration. Stdio renewal and HTTP
renewal share it. It pins each allowed JWT issuer to a token URL and to a client
authentication method. See
[Service-account JWT renewal](#service-account-jwt-renewal) for the pinned mode
and the fallback mode.

## HTTP authentication allowlist

`HORIZON_HTTP_AUTH_METHODS` is an allowlist of accepted authentication methods.
The accepted names are `api-key`, `mtls` and `service`. Separate the values with
a comma or with a pipe. Both spellings below enable `api-key` and `service`:

```bash
HORIZON_TRANSPORT=http
HORIZON_HTTP_AUTH_METHODS=api-key,service
# Equivalent spelling:
# HORIZON_HTTP_AUTH_METHODS=api-key|service
```

The default value is `api-key`. The server no longer supports the singular
`HORIZON_HTTP_AUTH_MODE` variable. If you set the old variable, the server stops
during HTTP startup. The error message gives the new variable name.

> Note: Do not confuse `HORIZON_HTTP_AUTH_MODE` with `HORIZON_AUTH_MODE`. The
> server only logs a deprecation warning for `HORIZON_AUTH_MODE`, but
> `HORIZON_HTTP_AUTH_MODE` stops HTTP startup.

| Method    | Caller credential                                            | Horizon forwarding                               |
| --------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `api-key` | `X-API-ID` + `X-API-KEY`                                     | Same header pair                                 |
| `service` | `X-API-SVA` + `X-API-TOKEN`                                  | Same service-account name and JWT                |
| `mtls`    | TLS client certificate or trusted ingress certificate header | URL-encoded PEM in `HORIZON_FORWARD_CERT_HEADER` |

Each credential pair must be complete. The server rejects these requests without
a fallback:

- A request with no credential.
- A request with an incomplete credential pair.
- A request with a credential type that is not on the allowlist.
- A request with more than one complete credential type.

Every `401` response includes a `WWW-Authenticate` header. The value is
`Horizon methods="<accepted methods>"`. The comma-separated list reflects
`HORIZON_HTTP_AUTH_METHODS`. A caller can use this challenge to select a
credential type. The caller does not need to read the server configuration.

### Credential cache lifecycle

You do not need to tune this. Read it if you debug a stale-credential symptom.

Under Node, the HTTP server caches validated credentials by fingerprint. Each
admitted request holds a lease on its cached Horizon client.

Concurrent misses of the same fingerprint share one validation build:

- If one waiter disconnects, the server cancels only that wait.
- The server cancels the build after its last waiter disconnects.

The TTL is absolute and counts from the validation. The server revalidates a
credential periodically, even if Horizon has not rejected it.

The server rate limits the validation of an unknown credential per peer and in
aggregate. If a request exceeds either limit, the server answers with HTTP 429.

A Horizon `401` or `403` that is not a CSRF rejection retires the cached
credential:

- The Horizon client tries to re-authenticate one time first, unless the
  re-authentication backoff suppresses this try.
- When the `401` or `403` reaches the end of the authentication-retry path of
  the Horizon client, the server retires the cached credential immediately. The
  next request revalidates against Horizon.
- A CSRF-token rejection uses a separate retry path and does not retire the
  credential.

TTL expiry, LRU eviction, invalidation and shutdown remove a record from reuse
immediately. The Horizon client closure and the authentication cleanup wait
until every request that holds the record releases its lease. A later request
never gets a retired record. It revalidates a fresh record instead.

Cache shutdown waits for the outstanding leases. The HTTP server applies its
configured graceful-shutdown timeout as the process-level bound.

### Service-account JWT renewal

Horizon JWKS service-account authentication needs a JSON Web Token (JWT) on each
Horizon request. Both transports support it:

- Stdio reads the service-account settings from environment variables.
- HTTP reads a complete service-account pair, and optional renewal settings,
  from the request headers.

In stdio mode, the server loads the service-account name from its environment.
It usually loads an initial JWT from the environment too.

If you omit the initial JWT, the server can mint the first token during startup.
This needs the complete OAuth client pair and exactly one
`HORIZON_OAUTH_ISSUERS` entry. The server does not read the token claims for
this mint.

If the startup mint fails, the server logs a safe error and continues to serve.
The error does not contain the response body of the token endpoint. Tool calls
report that the server did not mint the token. The request path retries after
the 30-second cooldown.

> Note: An MCP client built on MCP SDK 2.0 starts a stdio server twice per
> connection. A short-lived sibling process answers the connect-time
> `server/discover` probe. The session process starts next. The startup mint
> therefore runs twice per launch. The sibling exits immediately after the
> probe, so this is harmless. Identity-provider logs show two token requests.

The startup mint does not change HTTP mode. Every HTTP service-account request
must send both `X-API-SVA` and `X-API-TOKEN`. This is also true when the request
sends OAuth client headers and the operator configured exactly one pinned
issuer. The server never constructs an HTTP request provider with an empty
token.

For renewal, stdio can load the OAuth 2.0 client credentials from its
environment. An HTTP caller can send the equivalent values in these headers:

| Header                  | Required for renewal | Purpose                                                               |
| ----------------------- | -------------------- | --------------------------------------------------------------------- |
| `X-OAUTH-CLIENT-ID`     | Yes                  | OAuth client identifier                                               |
| `X-OAUTH-CLIENT-SECRET` | Yes                  | OAuth client secret                                                   |
| `X-OAUTH-SCOPE`         | Provider-specific    | Space-separated scopes, such as an Entra ID resource with `/.default` |
| `X-OAUTH-AUDIENCE`      | Provider-specific    | Non-standard audience parameter used by providers such as Auth0       |

The server does not forward the OAuth client headers to Horizon. The server does
not expose these headers to the MCP tools.

The server removes them from the parsed request headers and from the raw request
headers. It uses them only in the credential fingerprint.

The issuer allowlist is process-level operator configuration. There is no HTTP
header for an issuer map, a token URL or an authentication method. A caller
cannot override `HORIZON_OAUTH_ISSUERS`.

Configure the OAuth client to permit the `client_credentials` grant. Configure
the necessary resource, audience or scopes in your identity provider.

A JWT does not contain a standard renewal URL. We recommend that you configure
the higher-assurance pinned mode at startup:

```bash
HORIZON_OAUTH_ISSUERS='{
  "https://issuer.example.com": {
    "tokenUrl": "https://issuer.example.com/oauth/token",
    "authMethod": "client_secret_basic"
  }
}'
```

The value is a JSON map. Each key is an exact JWT `iss` value, and each entry
gives a `tokenUrl` and an `authMethod`. The map has these constraints:

- The issuer keys and the token URLs must be absolute HTTPS URLs.
- The only accepted methods are `client_secret_basic` and `client_secret_post`.
- The value has a limit of 65,536 characters.
- If the map contains a malformed entry, the server does not start. The error
  names that issuer key.

If you configure the allowlist, the `iss` value of a presented JWT must match an
own-property key of the map exactly. If it does not match, the server refuses
the renewal, and the error names the configured issuers.

A map with exactly one issuer is also the condition for the startup mint
described above. With no entry, or with more than one entry, the startup
settings validation needs `HORIZON_API_TOKEN`.

The token endpoint and the authentication method come only from the operator
configuration. As a result, pinned mode can renew an expired or rejected token
before Horizon validates the presented token. The server sends the credentials
only to the mapped `tokenUrl`, and it uses only the mapped authentication
method. The server does not use discovery in this mode.

If `HORIZON_OAUTH_ISSUERS` is unset, the lower-assurance fallback stays
available for compatibility. After Horizon validates the initial JWT, the server
does these steps:

1. The server reads the `iss` claim of the JWT.
2. The server requests the OpenID Connect discovery document of the issuer.
3. The server checks the issuer of the discovery document.
4. The server uses the `token_endpoint` of the discovery document.

The fallback mode has these constraints:

- The issuer and the token endpoint must use HTTPS.
- The token endpoint must have the same origin as the issuer.
- The server refuses redirects.

> Caution: The fallback mode derives a network target from a token claim. Use it
> only where operator pinning is not available.

The discovery fallback never contacts an issuer before Horizon accepts the
presented token. So an unpinned stdio deployment cannot self-heal through
automatic renewal when Horizon rejects its initial token.

The renewal sequence is as follows:

1. Stdio loads the service-account settings from the environment. An HTTP client
   instead sends a complete service-account pair and optional renewal headers.
2. Stdio with no initial token mints one at startup. This happens only when the
   OAuth client pair is complete and the issuer map contains exactly one entry.
3. In the other pinned cases, the server can renew before Horizon validation. It
   first makes sure that the `iss` value of the presented JWT matches an
   own-property key exactly.
4. In all other cases, the server forwards the initial `X-API-TOKEN` to Horizon
   unchanged.
5. Horizon validates the presented JWT. Only after this step can fallback mode
   trust the `iss` claim and the `exp` claim and do the constrained discovery.
6. In pinned mode, the server selects only the mapped token URL and the mapped
   authentication method. In fallback mode, the server does the constrained
   discovery described above.
7. The server requests a token 60 seconds before expiry. It also requests a
   token after Horizon rejects the authentication.
8. The request contains `grant_type=client_credentials`. It also contains the
   configured scope or audience.
9. The server checks that the `iss` value of the renewed JWT matches the
   selected issuer before it uses the token.
10. The server uses the returned `access_token` as the new `X-API-TOKEN`.
11. Concurrent refresh requests share one renewal request. After a failed
    renewal, that provider waits 30 seconds before the next try.

Operator pinning removes the token-controlled discovery request. We recommend it
as the SSRF control. Entra ID and Okta deployments usually support this flow.

Google Workspace service accounts usually use JWT bearer assertions or
domain-wide delegation. These flows are different from the `client_credentials`
flow. The server does not support them.

> Caution: Every token rotation changes the Horizon principal.

Horizon derives the identity of a service-account caller as
`<service-account name>-<first 16 hex characters of sha256(jwt)>`. When the
account configures an `identifierMapping` template, Horizon adds the value of
that template after the hash segment.

The hash segment is always present, and Horizon computes it over the presented
token. A renewed token gives a new identifier even when its issuer, its subject
and every other claim match the previous token. `identifierMapping` adds
claim-derived context to the name, but it never removes the hash.

Ownership, the permissions granted to the identifier, and the audit identity
that Horizon records do not carry over across renewals. Grant the permissions
through the roles of the service account. Use team-based ownership for anything
that must survive a rotation.

During renewal, the server checks the issuer only to block a renewed token from
a different issuer. This check does not preserve identity.

If stdio omits the renewal settings, or if an HTTP caller omits the OAuth
headers, the server forwards the JWT but cannot renew it.

### API-key forwarding

Send `X-API-ID` and `X-API-KEY` on each HTTP request to the server. The server
authenticates every request on its own. There is no session to establish first.

The server forwards both headers to Horizon.

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

The server listener requests a certificate with `requestCert: true` and
`rejectUnauthorized: false`. This is by design. The HTTP listener proves
possession of the client key, but it does not validate the certificate
authority.

The server forwards the URL-encoded PEM certificate. Horizon validates the
certificate chain, the revocation status and the identity.

A trusted ingress can forward the certificate instead. The server identifies the
ingress by its direct TCP peer IP address or CIDR.

The server does not use `X-Forwarded-For` for this check.

### Readiness

`/readyz` reports process readiness only. In HTTP mode, the server has no
Horizon credential of its own, so it cannot probe Horizon for an operator.

## MCP OAuth authorization is not supported

The MCP specification defines an optional OAuth flow. In that flow, the client
gets a token for the MCP server itself and sends it in an
`Authorization: Bearer` header. This server does not implement the flow. The
server rejects `Authorization`, `Proxy-Authorization` and `Cookie` with a 400,
and the error names `HORIZON_HTTP_AUTH_METHODS` so the cause is clear.

Use one of the Horizon-native methods above instead. They give you a per-user
identity in Horizon. Ownership, team membership and the audit trail depend on
that identity.

If your MCP client only speaks MCP OAuth, it cannot use this server over HTTP
today.
[ADR 0001](adr/0001-mcp-authorization.md) records the reasoning and the changes
that Horizon needs first.

## Transport security

API keys, service JWTs and OAuth client secrets are header credentials. The
server rejects an unencrypted, non-loopback configuration for these credentials.

Use an HTTPS `HORIZON_PUBLIC_URL` behind a TLS termination point, or bind the
server to a loopback address.

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
| `HORIZON_HTTP_AUTH_METHODS`                               | HTTP                | `api-key`           | Comma/pipe allowlist of `api-key`, `mtls`, and `service`                                |
| `HORIZON_HTTP_TLS_CERT` / `HORIZON_HTTP_TLS_KEY`          | Direct inbound mTLS |                     | MCP listener certificate and key                                                        |
| `HORIZON_INBOUND_CERT_HEADER`                             | Ingress mTLS        |                     | Trusted ingress certificate header                                                      |
| `HORIZON_TRUSTED_PROXY`                                   | Ingress mTLS        |                     | Direct peer IP or IPv4 CIDR allowed to set that header                                  |
| `HORIZON_FORWARD_CERT_HEADER`                             | No                  | `SSL_CLIENT_CERT`   | Horizon-facing certificate header                                                       |
| `HORIZON_VERIFY_SSL`                                      | No                  | `true`              | Verify Horizon TLS certificates; disabling verification requires Node                   |

See [client setup](client-setup.md) for remote-client header examples.
