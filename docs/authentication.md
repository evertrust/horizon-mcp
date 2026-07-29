# Authentication

Horizon MCP supports two credential models:

- In **stdio** mode, one environment-owned credential authenticates the local MCP process to Horizon.
- In **streamable HTTP** mode, each caller supplies a Horizon credential. The server accepts only configured authentication methods.

The MCP forwards the selected identity to Horizon. Horizon resolves the identity to a principal and applies its role-based access control (RBAC).

The MCP does not duplicate Horizon RBAC. The MCP rejects requests that contain more than one complete credential type.

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

### Service-account JWT renewal

Horizon JWKS service-account authentication requires a JSON Web Token (JWT) on each Horizon request.

The client sends the service-account name and an initial JWT to the MCP. The MCP forwards both values directly to Horizon.

The client can also send OAuth 2.0 client credentials. The MCP uses these credentials to fetch and renew a short-lived JWT.

| Header                  | Required for renewal | Purpose                                                               |
| ----------------------- | -------------------- | --------------------------------------------------------------------- |
| `X-OAUTH-CLIENT-ID`     | Yes                  | OAuth client identifier                                               |
| `X-OAUTH-CLIENT-SECRET` | Yes                  | OAuth client secret                                                   |
| `X-OAUTH-SCOPE`         | Provider-specific    | Space-separated scopes, such as an Entra ID resource with `/.default` |
| `X-OAUTH-AUDIENCE`      | Provider-specific    | Non-standard audience parameter used by providers such as Auth0       |

The MCP does not forward the OAuth client headers to Horizon. The MCP does not expose these headers to MCP tools.

The MCP removes them from parsed and raw request headers. It uses them only in the credential fingerprint.

Configure the OAuth client to allow the `client_credentials` grant. Configure the required resource, audience, or scopes in your identity provider.

A JWT does not contain a standard renewal URL. The MCP reads the `iss` claim from the initial JWT.

It then gets the `token_endpoint` from the issuer's OpenID Connect discovery document.

The renewal sequence is as follows:

1. The client sends `X-API-SVA`, `X-API-TOKEN`, and the required OAuth headers.
2. The MCP forwards the initial `X-API-TOKEN` to Horizon without a change.
3. Horizon validates the initial JWT.
4. After validation, the MCP trusts the JWT `iss` and `exp` claims.
5. The MCP reads the issuer's HTTPS `/.well-known/openid-configuration` document. It does not follow redirects.
6. The MCP verifies the issuer in the discovery response.
7. The MCP selects `client_secret_basic` or `client_secret_post`. The discovery document must list the selected method.
8. The MCP requests a token 60 seconds before expiry. It also requests a token after Horizon rejects authentication.
9. The request contains `grant_type=client_credentials`. It also contains the configured scope or audience.
10. The MCP uses the returned `access_token` as the new `X-API-TOKEN`.
11. Concurrent refresh requests use one shared renewal request.

The issuer and token endpoint must use HTTPS. The token endpoint must have the same origin as the issuer.

These requirements reduce the risk of server-side request forgery (SSRF). Entra ID and Okta deployments usually support this flow.

Google Workspace service accounts usually use JWT bearer assertions or domain-wide delegation. These flows are different from the `client_credentials` flow.

The MCP does not support these Google Workspace flows.

If the client omits the OAuth headers, the MCP forwards the JWT. The MCP cannot renew that JWT.

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

The MCP listener requests a certificate with `requestCert: true` and `rejectUnauthorized: false`. This configuration proves possession but does not validate the certificate authority.

The MCP forwards the URL-encoded PEM certificate. Horizon validates the certificate chain, revocation status, and identity.

Alternatively, a trusted ingress can forward the certificate. The MCP identifies the ingress by its direct TCP peer IP address or CIDR.

The MCP does not use `X-Forwarded-For` for this check.

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

| Variable                                         | Required            | Default             | Description                                              |
| ------------------------------------------------ | ------------------- | ------------------- | -------------------------------------------------------- |
| `HORIZON_URL`                                    | Yes                 | `https://localhost` | Horizon instance URL                                     |
| `HORIZON_API_ID` / `HORIZON_API_KEY`             | Stdio API key       |                     | Environment-owned stdio credential                       |
| `HORIZON_CLIENT_CERT` / `HORIZON_CLIENT_KEY`     | Stdio PEM mTLS      |                     | Environment-owned stdio certificate credential           |
| `HORIZON_CLIENT_PFX`                             | Stdio PFX mTLS      |                     | Environment-owned stdio certificate bundle               |
| `HORIZON_TRANSPORT`                              | No                  | `stdio`             | `stdio` or `http`                                        |
| `HORIZON_HTTP_AUTH_METHODS`                      | HTTP                | `api-key`           | Comma/pipe whitelist of `api-key`, `mtls`, and `service` |
| `HORIZON_HTTP_TLS_CERT` / `HORIZON_HTTP_TLS_KEY` | Direct inbound mTLS |                     | MCP listener certificate and key                         |
| `HORIZON_INBOUND_CERT_HEADER`                    | Ingress mTLS        |                     | Trusted ingress certificate header                       |
| `HORIZON_TRUSTED_PROXY`                          | Ingress mTLS        |                     | Direct peer IP or IPv4 CIDR allowed to set that header   |
| `HORIZON_FORWARD_CERT_HEADER`                    | No                  | `SSL_CLIENT_CERT`   | Horizon-facing certificate header                        |
| `HORIZON_VERIFY_SSL`                             | No                  | `true`              | Verify Horizon TLS certificates                          |

See [client setup](client-setup.md) for remote-client header examples.
