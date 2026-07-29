# ADR 0001: MCP authorization for horizon-mcp

- Status: Accepted (decision recorded; no implementation in this release)
- Date: 2026-07-29
- Applies to: horizon-mcp 3.0.0 (MCP revision 2026-07-28), HTTP transport only

## Context

horizon-mcp implements no MCP authorization. Over HTTP it authenticates callers
with Horizon's own credentials, passed as headers and validated by Horizon
itself: an API key, a service-account token, or a client certificate, selected by
`HORIZON_HTTP_AUTH_METHODS`. `Authorization`, `Proxy-Authorization`, and `Cookie`
are rejected outright with a 400 (`src/http/credentials.ts:44-48,157-169`).

This ADR records why that is the position for 3.0.0, and fixes the contracts any
future OAuth implementation must satisfy.

### Revision 2026-07-28 adds no resource-server obligation

Every authorization change in this revision is client-side or authorization-server
side: RFC 9207 `iss` validation (client MUST), `application_type` in Dynamic
Client Registration (client), credentials keyed by issuer (client), and the
deprecation of DCR in favour of Client ID Metadata Documents (AS and client).

The resource-server obligations - RFC 9728 protected-resource metadata, RFC 8707
audience validation, RFC 6750 `WWW-Authenticate` challenges, and the
token-passthrough prohibition - are unchanged since revision 2025-06-18.

Authorization is `OPTIONAL` in MCP. The HTTP transport `SHOULD` conform to the
authorization specification. So horizon-mcp is not failing an unconditional MUST;
it is departing from a SHOULD. That is a real interoperability and security gap,
but it is not a blocker for the 2026-07-28 migration, and nothing in this area
gates 3.0.0.

## Decision

**Ship no MCP authorization code in 3.0.0.** Implementation is deferred to a
follow-up release and is blocked on the seven contracts below.

An earlier draft of the migration plan proposed shipping a working-but-disabled
OAuth mode alongside the existing credential pass-through. That was rejected.

### Why a disabled toggle is not a safe intermediate step

Three findings, each independently disqualifying.

**1. Bearer authentication does not produce a Horizon identity.** The SDK's
`requireBearerAuth` authenticates a caller and populates `AuthInfo`. It does not
decide _which Horizon principal_ that caller acts as. `buildSessionAuth`
(`src/http/credentials.ts:324`) can only construct an upstream client from
API-key, service-token, or certificate material, so a Bearer-only request has no
usable `HorizonClient` at all. Bridging the gap with a shared service account
would silently grant that account's privileges to every accepted subject. Being
"off by default" does not make an unsafe option safe; it makes it a
configuration mistake away from being live.

**2. Reusing the service-account discovery path as an inbound token verifier is
an SSRF vector.** `src/auth/service-account.ts` extracts `iss` from an
_unverified_ JWT and performs OIDC discovery against that URL. Today that is safe
only because renewal happens after Horizon has already accepted the credential,
so the issuer is implicitly trusted. An inbound MCP token has no such prior trust
gate: an attacker would choose the issuer, and therefore the URL the server
fetches. Any future verifier must use a **pinned, independently validated**
authorization-server issuer and must never derive discovery targets from
untrusted token content.

**3. OAuth alongside pass-through is bypassable.** If the endpoint advertises
itself as an OAuth protected resource while `api-key`, `service`, and `mtls`
remain interchangeable, a caller simply presents a Horizon credential and skips
OAuth entirely. Requiring both instead creates two principals whose relationship
is undefined, letting a low-privilege OAuth subject attach a high-privilege
Horizon credential.

### A binding constraint from the spec

From the authorization security considerations:

> If the MCP server makes requests to upstream APIs, it may act as an OAuth
> client to them. The MCP server **MUST NOT** pass through the token it received
> from the MCP client.

and a server **MUST** reject tokens that do not carry it in the audience claim.

Note that `X-API-TOKEN` today is a Horizon token received from the client and
forwarded unchanged by `ServiceAccountAuthProvider.getHeaders()`
(`src/auth/service-account.ts:121-126`). That falls outside the OAuth
access-token rule, because it is an upstream credential rather than an MCP
access token. It is nonetheless the same shape of risk, which is why contract 4
below has to be decided rather than assumed.

## Contracts that must be fixed before any implementation

Each is irreversible once tokens are issued against it.

| #   | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                    | Why it cannot be deferred                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | **Canonical resource URI.** One function, used identically for the PRM `resource` field, the client's OAuth `resource` parameter, audience comparison, and `resource_metadata` derivation. Derived from `config.publicEndpoint` (`src/http/config.ts:28,305`), not the bare origin. HTTPS outside loopback; no userinfo, query, or fragment; lowercase scheme and host; preserve a non-root path and a non-default port; no trailing slash. | Changing it invalidates every already-issued token |
| 2   | **Pinned authorization-server issuer**, discovered and validated at startup, entirely independent of Horizon service-account renewal.                                                                                                                                                                                                                                                                                                       | Determines who can mint tokens                     |
| 3   | **Scope taxonomy and the tool/resource authorization matrix.** Either one coarse `mcp` scope covering the whole enabled surface, or named read/write/domain scopes. Must state hierarchy expansion and whether unauthorized tools stay visible in `tools/list`.                                                                                                                                                                             | Appears in PRM and in every challenge              |
| 4   | **Coexistence policy.** OAuth mutually exclusive with pass-through, on separate endpoints, or dual auth with an explicit identity binding.                                                                                                                                                                                                                                                                                                  | Decides whether OAuth is bypassable                |
| 5   | **Principal key.** An HMAC of `(issuer, clientId, tenant, subject)`. Not the raw Bearer token, which rotates; not `sub` alone, which collides across issuers.                                                                                                                                                                                                                                                                               | Rate limiting and audit both key on it             |
| 6   | **Bridge policy** from MCP principal to Horizon identity: token exchange, impersonation, or credential lookup. At minimum one deny-safe default.                                                                                                                                                                                                                                                                                            | Determines what a token actually authorizes        |
| 7   | **Audit model and token format/revocation posture**, including whether RFC 8705 certificate-bound tokens are supported.                                                                                                                                                                                                                                                                                                                     | Drives the PRM flags and the logging design        |

### Contract 6 cannot be satisfied against Horizon 2.10

Contract 6 is the one that blocks all the others, and it was investigated
directly against the Horizon 2.10 source rather than left open. The conclusion is
that **no bridge exists today**, and building one is a Horizon-side change, not
an horizon-mcp change.

Four findings, in the order they close off the options:

1. **No token exchange.** RFC 8693 is an authorization-server feature and Horizon
   is not an authorization server. There is no `token-exchange` grant to call.
2. **No bearer authentication on the API.** Searching the authentication action
   chain (`app/actions/security/`) for `Bearer`, `access_token`, or
   `accessToken` returns nothing. Horizon accepts `X-API-ID`/`X-API-KEY`, HTTP
   Basic, `X-API-SVA` plus `X-API-TOKEN`, a client certificate, or a session
   cookie. An OIDC access token is not among them.
3. **The federated JWT path does not carry a stable human identity.** A service
   account with a `static_jwks` or `dynamic_jwks` trust config does accept an
   externally issued JWT, but the identity it produces embeds a hash of the token
   itself (`SecurityManagerActor.scala:591` builds the identifier from
   `s"$serviceAccountName-${jwtHash.take(16)}"`). Every token refresh therefore
   produces a _different_ Horizon principal. That is workable for machine
   federation, where the token is long-lived and the identity is the service
   account. It is unusable for a human, whose ownership, team membership, and
   audit trail must survive a token refresh.
4. **OIDC identity exists only inside a Play session.** `OpenIdAuthenticateAction`
   is a browser redirect and PKCE flow whose output is a `PLAY_SESSION` cookie.
   The cookie is a self-contained signed JWT with a 15-minute sliding lifetime,
   no revocation, and no header-based equivalent. Minting one outside the browser
   flow would require `play.http.secret.key`, which signs every session in the
   deployment and would forge any identity including an administrator. Rejected.

**What would unblock it.** A Horizon-side authentication action that accepts an
OIDC access token on a Horizon-specific header, validates it against the existing
`OidcIdentityProvider` JWKS configuration, and maps claims to an `Identity` using
the same claim mapping the browser flow already uses. Identifiers would then match
the browser flow exactly, so ownership and audit line up, and operators would
configure nothing new. Until that exists, OAuth cannot be implemented here in a
way that preserves per-user Horizon RBAC, and this ADR's decision stands.

### One coupling back into 3.0.0

If contract 3 makes tool visibility vary by caller, the cache hints in
`src/server-factory.ts` must change from `cacheScope: 'public'` to `'private'`.
They are `public` today only because the exposed surface varies by _server_
environment (`HORIZON_ENABLED_TOOLSETS`, `HORIZON_READ_ONLY`) and never by
caller. That constraint is recorded as a comment at the call site.

### A structural collision to resolve

Any implementation must separate two things that currently want the same slot:
`req.auth` for verified MCP `AuthInfo` (which `requireBearerAuth` owns), and a
distinct private context for the upstream Horizon credential. They are different
principals and must not share a field.

## Consequences

**For 3.0.0:**

- No PRM document, no `WWW-Authenticate` challenge, no Bearer acceptance.
- `Authorization`, `Proxy-Authorization`, and `Cookie` continue to be rejected
  with 400. The message now names `HORIZON_HTTP_AUTH_METHODS` and states that
  OAuth is unsupported, so a conformant client gets a diagnosable error rather
  than a bare failure.
- A client that only speaks MCP OAuth cannot use this server over HTTP. Operators
  must use one of the Horizon-native methods.

**stdio is unaffected and stays that way.** The specification says stdio
implementations **SHOULD NOT** follow the authorization framework and should take
credentials from the environment, which is exactly what stdio does today. Any
future OAuth settings must be validated only inside HTTP config so that stdio
startup never depends on them.

**For the follow-up release**, in addition to the seven contracts:

- `verifyAccessToken` with an explicit JWT or introspection path: algorithm
  allow-list, `kid` rotation, issuer, `exp`/`nbf`, and audience accepted as both
  string and array. It must throw the SDK's `OAuthError`; a generic throw becomes
  an HTTP 500.
- `mcpAuthMetadataRouter` mounted at the **path-aware** location
  (`/.well-known/oauth-protected-resource/mcp`) via
  `getOAuthProtectedResourceMetadataUrl`, not at the root.
- A PRM document carrying `resource`, at least one `authorization_servers` entry,
  `scopes_supported` without `offline_access`, `bearer_methods_supported:
["header"]`, and `resource_name`.
- CORS changes: allow `Authorization` in preflight, expose `WWW-Authenticate`,
  let `OPTIONS` terminate before Bearer auth, and serve metadata unauthenticated.
- Bearer verification **before** header scrubbing, then scrubbing `Authorization`
  from both `req.headers` and `req.rawHeaders`.
- Three separate caches: token verification (bounded by token expiry), principal
  identity, and upstream credential.
- Structured audit events that never log raw tokens, whole `AuthInfo` objects, or
  full JWT payloads.
- OAuth must not be operator-enableable until the contract 6 bridge exists. Until
  then, configuring it fails startup rather than half-working.

## References

- MCP revision 2026-07-28, `basic/authorization` and its security considerations
- RFC 9728 (protected resource metadata), RFC 8707 (resource indicators),
  RFC 9207 (`iss`), RFC 6750 (Bearer), RFC 8705 (certificate-bound tokens)
- `docs/authentication.md` for the Horizon-native methods this server does support
