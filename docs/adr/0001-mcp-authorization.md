# ADR 0001: MCP authorization for horizon-mcp

- Status: Accepted (decision recorded; no implementation in this release)
- Date: 2026-07-29
- Applies to: horizon-mcp 3.0.0 (MCP revision 2026-07-28), HTTP transport only

## Context

horizon-mcp implements no MCP authorization. Over HTTP it authenticates each
caller with a Horizon credential that the caller sends as headers, and Horizon
itself validates that credential. `HORIZON_HTTP_AUTH_METHODS` selects which
credential the server accepts: an API key, a service-account token, or a client
certificate. The server rejects `Authorization`, `Proxy-Authorization`, and
`Cookie` outright with a 400 (`src/http/credentials.ts`,
`UNSUPPORTED_CRED_HEADERS` in `extractCredential`).

This ADR records why that is the position for 3.0.0. It also fixes the contracts
that any future OAuth implementation must satisfy.

### Revision 2026-07-28 adds no resource-server obligation

Every authorization change in this revision applies to the client or to the
authorization server:

- RFC 9207 `iss` validation (client `MUST`)
- `application_type` in Dynamic Client Registration (client)
- credentials keyed by issuer (client)
- the deprecation of DCR in favour of Client ID Metadata Documents (AS and
  client)

The resource-server obligations have not changed since revision 2025-06-18. They
are RFC 9728 protected-resource metadata, RFC 8707 audience validation, RFC 6750
`WWW-Authenticate` challenges, and the token-passthrough prohibition.

MCP marks authorization as `OPTIONAL`. The HTTP transport `SHOULD` conform to
the authorization specification. So horizon-mcp departs from a `SHOULD`, not
from an unconditional `MUST`. The gap is real for interoperability and for
security. It does not block the 2026-07-28 migration, and nothing in this area
gates 3.0.0.

## Decision

**Ship no MCP authorization code in 3.0.0.** A follow-up release can implement
MCP authorization. That release must first fix the seven contracts below.

An earlier draft of the migration plan proposed a working-but-disabled OAuth
mode beside the existing credential pass-through. This ADR rejects that option.

### Why a disabled toggle is not a safe intermediate step

Three findings disqualify the option. Each one is enough on its own.

**1. Bearer authentication does not produce a Horizon identity.** The SDK's
`requireBearerAuth` authenticates a caller and populates `AuthInfo`. It does not
decide _which Horizon principal_ that caller acts as. `buildSessionAuth`
(`src/http/credentials.ts`) builds an upstream client from API-key,
service-token, or certificate material only. So a Bearer-only request has no
usable `HorizonClient` at all.

A shared service account would close the gap, but it would grant that account's
privileges to every accepted subject. An option that is off by default is still
unsafe: one configuration mistake makes it live.

**2. The service-account discovery fallback is an SSRF vector if it verifies
inbound tokens.** Service-account renewal supports an operator-pinned
`HORIZON_OAUTH_ISSUERS` map. If that variable is absent, the compatibility
fallback in `src/auth/service-account.ts` reads `iss` from a JWT and runs OIDC
discovery against that URL. The fallback runs only after Horizon accepts the
credential, so the issuer has passed that trust gate. It remains the
lower-assurance mode.

An inbound MCP token passes no such gate first. An attacker would choose the
issuer, and so the URL that the server fetches. Any future verifier must use a
**pinned, independently validated** authorization server issuer. It must never
derive a discovery target from untrusted token content.

**3. OAuth beside pass-through is bypassable.** Suppose the endpoint advertises
itself as an OAuth protected resource while `api-key`, `service`, and `mtls`
stay interchangeable. A caller then presents a Horizon credential and skips
OAuth. The other option is to demand both. That creates two principals with no
defined relationship, so a low-privilege OAuth subject can attach a
high-privilege Horizon credential.

### A binding constraint from the spec

From the authorization security considerations:

> If the MCP server makes requests to upstream APIs, it may act as an OAuth
> client to them. The MCP server **MUST NOT** pass through the token it received
> from the MCP client.

The specification also states that a server **MUST** reject a token that does
not name that server in its audience claim.

Today `X-API-TOKEN` is a Horizon token. The client sends it, and
`ServiceAccountAuthProvider.getHeaders()` (`src/auth/service-account.ts`)
forwards it unchanged. This falls outside the OAuth access-token rule, because
`X-API-TOKEN` is an upstream credential and not an MCP access token. The risk
has the same shape, so the design must decide contract 4 below and not assume it.

## Contracts that must be fixed before any implementation

After an authorization server issues tokens that depend on a contract, that
contract cannot change.

| #   | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Why it cannot be deferred                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | **Canonical resource URI.** One function must produce the URI for the PRM `resource` field, the client's OAuth `resource` parameter, audience comparison, and `resource_metadata` derivation. It must derive the URI from `config.publicEndpoint` (`src/http/config.ts`), not from the bare origin. The URI must use HTTPS outside loopback and carry no userinfo, query, or fragment. It must use a lowercase scheme and host, keep a non-root path and a non-default port, and end without a trailing slash. | A change invalidates every token already issued |
| 2   | **Pinned authorization-server issuer.** The server must discover and validate the issuer at startup. The issuer must be entirely independent of Horizon service-account renewal.                                                                                                                                                                                                                                                                                                                               | It determines who can mint tokens               |
| 3   | **Scope taxonomy and the tool/resource authorization matrix.** The design must choose one coarse `mcp` scope for the whole enabled surface, or named read, write, and domain scopes. It must state how a scope hierarchy expands. It must state if an unauthorized tool stays visible in `tools/list`.                                                                                                                                                                                                         | It appears in the PRM and in every challenge    |
| 4   | **Coexistence policy.** OAuth must be mutually exclusive with pass-through, live on a separate endpoint, or run as dual auth with an explicit identity binding.                                                                                                                                                                                                                                                                                                                                                | It decides if OAuth is bypassable               |
| 5   | **Principal key.** The key must be an HMAC of `(issuer, clientId, tenant, subject)`. Do not use the raw Bearer token, because it rotates. Do not use `sub` alone, because it collides across issuers.                                                                                                                                                                                                                                                                                                          | Rate limiting and audit both key on it          |
| 6   | **Bridge policy.** The bridge from an MCP principal to a Horizon identity must use token exchange, impersonation, or credential lookup. It must have at least one deny-safe default.                                                                                                                                                                                                                                                                                                                           | It determines what a token actually authorizes  |
| 7   | **Audit model, token format, and revocation posture.** The design must state if the server supports RFC 8705 certificate-bound tokens.                                                                                                                                                                                                                                                                                                                                                                         | It drives the PRM flags and the logging design  |

### Contract 6 cannot be satisfied against Horizon 2.10

Contract 6 blocks all the others. The Horizon 2.10 source confirms that **no
bridge exists today**. A bridge requires a Horizon-side change, not a
horizon-mcp change.

Four findings, in the order they close off the options:

1. **No token exchange.** RFC 8693 is an authorization-server feature and
   Horizon is not an authorization server. There is no `token-exchange` grant to
   call.
2. **No bearer authentication on the API.** A search of the authentication
   action chain (`app/actions/security/`) for `Bearer`, `access_token`, or
   `accessToken` returns nothing. Horizon accepts `X-API-ID`/`X-API-KEY`, HTTP
   Basic, `X-API-SVA` plus `X-API-TOKEN`, a client certificate, or a session
   cookie. An OIDC access token is not among them.
3. **The federated JWT path does not carry a stable human identity.** A service
   account with a `static_jwks` or `dynamic_jwks` trust config does accept an
   externally issued JWT. But the identity it produces embeds a hash of the
   token itself: `SecurityManagerActor.scala:591` builds the identifier from
   `s"$serviceAccountName-${jwtHash.take(16)}"`. Every token refresh then
   produces a _different_ Horizon principal. This works for machine federation,
   where the token is long-lived and the identity is the service account. It
   does not work for a human, whose ownership, team membership, and audit trail
   must survive a token refresh.
4. **OIDC identity exists only inside a Play session.** `OpenIdAuthenticateAction`
   is a browser redirect and PKCE flow. Its output is a `PLAY_SESSION` cookie.
   The cookie is a JWT that carries its own state and signature, with a
   15-minute sliding lifetime, no revocation, and no header-based equivalent. A
   caller outside the browser flow would need `play.http.secret.key` to mint
   one. That key signs every session in the deployment, so it could forge any
   identity, including an administrator. This ADR rejects that option.

**What would unblock contract 6.** Horizon would need a new authentication
action. That action must accept an OIDC access token on a Horizon-specific
header. It must validate the token against the existing `OidcIdentityProvider`
JWKS configuration. It must map claims to an `Identity` with the same claim
mapping that the browser flow already uses.

Identifiers would then match the browser flow exactly, so ownership and audit
line up, and operators would configure nothing new. Until that action exists, no
OAuth implementation here can preserve per-user Horizon RBAC, and this ADR's
decision stands.

### One coupling back into 3.0.0

If contract 3 makes tool visibility vary by caller, the cache hints in
`src/server-factory.ts` must change from `cacheScope: 'public'` to `'private'`.
They are `public` today for one reason only: the exposed surface varies by
_server_ environment (`HORIZON_ENABLED_TOOLSETS`, `HORIZON_READ_ONLY`), never by
caller. A comment at the call site records that constraint.

### A structural collision to resolve

Any implementation must separate two things that want the same slot today.
`req.auth` holds the verified MCP `AuthInfo`, and `requireBearerAuth` owns it.
The upstream Horizon credential needs a distinct private context. They are
different principals and must not share a field.

## Consequences

**For 3.0.0:**

- No PRM document, no `WWW-Authenticate` challenge, no Bearer acceptance.
- The server continues to reject `Authorization`, `Proxy-Authorization`, and
  `Cookie` with 400. The message now names `HORIZON_HTTP_AUTH_METHODS` and
  states that the server does not support OAuth. A conformant client gets a
  diagnosable error instead of a bare failure.
- A client that only speaks MCP OAuth cannot use this server over HTTP.
  Operators must use one of the Horizon-native methods.

**stdio does not change, and stays that way.** The specification says that stdio
implementations `SHOULD NOT` follow the authorization framework and `SHOULD`
take credentials from the environment. stdio does exactly that today. The HTTP
config must validate any future OAuth settings, so that stdio startup never
depends on them.

**For the follow-up release**, beyond the seven contracts:

- `verifyAccessToken` needs an explicit JWT or introspection path. It must cover
  an algorithm allow-list, `kid` rotation, issuer, `exp`/`nbf`, and an audience
  given as a string or an array. It must throw the SDK's `OAuthError`. A generic
  throw becomes an HTTP 500.
- Mount `mcpAuthMetadataRouter` at the **path-aware** location
  (`/.well-known/oauth-protected-resource/mcp`) with
  `getOAuthProtectedResourceMetadataUrl`, not at the root.
- A PRM document that carries `resource`, at least one `authorization_servers`
  entry, `scopes_supported` without `offline_access`,
  `bearer_methods_supported: ["header"]`, and `resource_name`.
- CORS changes: allow `Authorization` in preflight, expose `WWW-Authenticate`,
  let `OPTIONS` return a response before Bearer auth, and serve metadata
  unauthenticated.
- Bearer verification **before** header scrubbing, then scrubbing `Authorization`
  from both `req.headers` and `req.rawHeaders`.
- Three separate caches: token verification (bounded by token expiry), principal
  identity, and upstream credential.
- Structured audit events that never log raw tokens, whole `AuthInfo` objects,
  or full JWT payloads.
- An operator must not be able to turn OAuth on until the contract 6 bridge
  exists. Until then, any OAuth configuration must cause a startup failure. The
  server must not start with incomplete OAuth support.

## References

- MCP revision 2026-07-28, `basic/authorization` and its security considerations
- RFC 9728 (protected resource metadata), RFC 8707 (resource indicators),
  RFC 9207 (`iss`), RFC 6750 (Bearer), RFC 8705 (certificate-bound tokens)
- `docs/authentication.md` for the Horizon-native methods this server does support
