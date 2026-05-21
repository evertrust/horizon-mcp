# Horizon MCP server rules

Operating rules that apply across every Horizon tool call. The most important
rules are surfaced inline in tool descriptions and annotations; this resource
holds the longer explanations for when you need them.

## 1. Immutable names

Every Horizon object name is the primary key and cannot change after creation.
Applies to profiles, connectors, dashboards, roles, teams, CAs, triggers,
labels, REST notifications, datasources, saved queries, and any other named
object. Always ask the user for the `name` (and, where supported, the
human-friendly `display_name` which can change) before calling a `create_*`
tool. Never invent a name on the user's behalf.

## 2. Ownership queries

When the user asks about "my certificates" or "certificates I own", call
`whoami` first to get the principal identifier and team list, then run an
HCQL query that covers both:

```
owner equals "<identifier>" or team in ("<team1>", "<team2>", ...)
```

Querying `owner` alone misses team-owned certificates.

## 3. HQL field names are lowercase

All HCQL/HRQL/HEQL/HDQL field names are lowercase: `contactemail` (not
`contactEmail`), `keytype` (not `keyType`), `valid.until` (not `notAfter`),
`registration.date` (not `registrationDate`), `certificateid` (not
`certificateId`). camelCase causes `HQL-001` parse errors.

Exception: `groupBy` and `sortedBy` parameters are camelCase because they
reference API element names, not query fields. See
`horizon://knowledge/query-languages` for the full reference.

## 4. Service discovery searches multiple fields

When the user asks for certificates serving a service (tomcat, nginx, apache,
load balancer, etc.), search `discoverydata.paths`, `discoverydata.usages`,
and `discoverydata.hostnames` in addition to `dn` and `san`. Service hints
often live only in the discovery metadata.

## 5. PKCS#12 / PFX retrieval

The PKCS#12 bundle (certificate plus private key) is never on the certificate
object. It is only returned in the enrollment REQUEST response. When the user
asks for a PKCS#12, PFX, or private key:

1. Find the enrollment request via `search_requests`.
2. Call `get_request` to read it; the `pkcs12` / `keyStore` field contains the
   base64-encoded bundle.

Do not say PKCS#12 retrieval is impossible. It is available through the
request.

## 6. Lifecycle requests: inspect the template first

Before calling `submit_request`, call `get_request_template` to discover
which fields are required, editable, computed, or fixed by the profile, then
ask the user for any missing values. For `revoke`, `revocationReason` is
mandatory. For any workflow, optionally offer the user a free-text
`requesterComment` justification.

The outcome of `submit_request` depends on permissions:

- Direct action permissions (`enrollApi`, `revokeApi`, `renewApi`) complete the
  operation immediately.
- Request-only permissions (`enrollRequest`, `revokeRequest`, `renewRequest`)
  create a pending request that needs `approve_request`.

Surface the response status to the user so they know whether approval is
still required.

## 7. Live exposure check

When the user asks if a certificate is exposed, deployed, live, or reachable
on a server, use `fetch_exposed_certificate` to connect to the target host
and retrieve the actual TLS certificate. Compare its thumbprint or serial
with what Horizon manages. This is the only reliable way to verify real-world
deployment.

## 8. Prefer the built-in decode tools over local CLIs

This server provides structured decoders for the common crypto objects:

- `decode_x509` (X.509 certificates, PEM or DER)
- `decode_csr` (PKCS#10 certificate signing requests)
- `decode_crl` (certificate revocation lists)
- `decode_ocsp` (OCSP responses, RFC 6960)
- `decode_tsa` (timestamping responses, RFC 3161)
- `detect_file` (auto-detect format and parse any of the above)

These return structured JSON with subject, SANs, extensions, key usage, AIA,
CRL DPs, thumbprints, and the other parsed fields. Prefer them over invoking
`openssl` and parsing text output.

## 9. Discovery workflows

When the user asks how to perform certificate discovery (network scans,
local scans, importing from cloud services, PKI migrations, etc.), read
`horizon://knowledge/discovery-workflows` for CLI commands and parameters,
and `horizon://knowledge/discovery` for concepts, data structures, and search
patterns. Both resources matter for a complete answer.

## 10. Datasources and validation rules

When the user asks about auto-validation, datasource configuration, or
enriching enrollment requests with external data, consult:

- `horizon://knowledge/datasources` for DNS/LDAP/REST datasource setup
- `horizon://knowledge/validation-rules` for rule condition syntax (operators,
  boolean logic, datasource references, `resolvesDNS`, CIDR matching)
- `horizon://knowledge/dictionary-matrix` for all dictionary entries by
  context and protocol module

## 11. REST notifications and custom connectors

When the user asks about building custom connectors, deploying certificates
to external systems via REST APIs, creating REST notifications, chaining
multiple API calls, or automating certificate deployment to load balancers,
CDNs, IoT platforms, or any REST service, consult:

- `horizon://knowledge/rest-notifications` for the full REST notification
  API schema, multi-step sequence chaining, authentication types, template
  string dictionary, and real-world examples
- `horizon://knowledge/automation` for trigger attachment to profiles

## 12. Official documentation lookup

When the user asks how to configure, install, or integrate a product, call
`search_docs` first, then `get_doc_page` with one of the returned `page_id`
values. Do not guess page IDs.

When the user asks about HTTP endpoints, request payloads, or response
schemas, call `search_api_docs` first, then `get_doc_page`.

If the docs tool returns a version-detection warning, tell the user that the
connected Horizon instance could not reliably expose its version and that
the result fell back to the latest indexed docs. Use the warning instead of
pretending the version match is exact.
