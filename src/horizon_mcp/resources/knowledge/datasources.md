# External Datasources - DNS, LDAP, REST

## Overview

Datasources are external data assets queried during certificate enrollment to
enrich request data for computation rules and validation rule conditions.
They run at **enrollment time** (after request submission, before certificate
issuance) and populate dictionary entries accessible as `ds.<flowIndex>.<resultIndex>.<key>`.

Three types exist: **DNS**, **LDAP**, and **REST**.

**Dependency chain**: Credentials -> Datasource -> Profile (references datasource in dsFlow)

---

## Decision Guide - Which Datasource Type to Use

| Use case | Type | Why |
|----------|------|-----|
| Validate SAN hostnames resolve in DNS | DNS | Returns A/AAAA/CNAME/PTR/TXT records |
| Check CNAME targets for PaaS/CDN validation | DNS | CNAME record reveals the canonical target |
| Verify domain ownership via TXT records | DNS | TXT records contain verification tokens |
| Enrich certificates with user attributes (department, email) | LDAP | Queries AD/LDAP directories for user data |
| Validate user group membership for auto-approval | LDAP | Check `memberOf` attribute |
| Look up computer/server attributes in AD | LDAP | Query computer objects by hostname |
| Call an internal CMDB or asset management API | REST | HTTP request to any REST endpoint |
| Validate hostnames against an internal registry | REST | Custom HTTP API lookup |
| Fetch certificate metadata from an external system | REST | Generic HTTP integration |

## Step-by-Step - Creating and Using a Datasource

1. **Create credentials** (if LDAP or authenticated REST) - credentials must exist
   before the datasource. This step is done outside the MCP server.

2. **Test the datasource** - use `test_datasource` to validate connectivity and
   configuration before committing. Pass a `context` dict to simulate the
   TemplateString values that will be resolved at enrollment time.

3. **Create the datasource** - use `create_dns_datasource`, `create_ldap_datasource`,
   or `create_rest_datasource`. The name is IMMUTABLE - ask the user first.

4. **Add to a profile's dsFlow** - the datasource must be referenced in the
   profile's `dataSourceFlows` (dsFlow) list with input mappings that connect
   dictionary entries to datasource parameters.

5. **Reference results in computation rules or validation rules** - use
   `ds.<flowIndex>.<resultIndex>.<key>` to access the enriched data.

6. **Verify end-to-end** - use `simulate_datasource_flow` to test the complete
   pipeline with all chained datasources.

---

## DNS Datasource

Queries DNS servers and returns record data.

### Configuration Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | string | Yes | - | Must be `"dns"` |
| `name` | string | Yes | - | Unique primary key. **IMMUTABLE after creation.** |
| `displayName` | LocalizedString[] | No | - | Localized display names: `[{lang: "en", value: "..."}]` |
| `description` | string | No | - | Human-readable description |
| `host` | string | No | System DNS | DNS server IP address. If omitted, uses Horizon's default resolver |
| `port` | integer | No | 53 | DNS server port |
| `timeout` | FiniteDuration | No | "10 seconds" | Query timeout |
| `recordTypes` | string[] | No | all | Filter which record types to return. Values: `a`, `aaaa`, `cname`, `ptr`, `txt`. If omitted, ALL types are fetched |
| `lookup` | TemplateString | Yes | - | DNS hostname to look up. Supports `{{key}}` syntax for dynamic values |

### DNS Record Type Characteristics

| Record Type | Multi-valued | Description |
|-------------|:------------:|-------------|
| `a` | Yes | IPv4 addresses (can return multiple) |
| `aaaa` | Yes | IPv6 addresses (can return multiple) |
| `cname` | No | Canonical name alias (single value) |
| `ptr` | No | Reverse DNS pointer (single value) |
| `txt` | Yes | Text records (can return multiple) |

### DNS Datasource Constraints

- Does **NOT** support credentials or proxy
- Inputs are extracted from the `lookup` TemplateString dictionary keys
- Outputs are all five record types, prefixed with `*` for multi-valued

### Multi-Lookup via Comma Separation

The DNS datasource has a built-in multi-lookup capability: if the evaluated
`lookup` string contains commas, it splits the string and performs a **separate
DNS query per value**. Results are indexed per-lookup: `1.cname`, `2.cname`, etc.

This enables per-element DNS validation of multi-valued fields. For example,
to look up every DNS SAN in a CSR, use `Join([[csr.san.dnsname]], ",")` as
the dsFlow input value. The `Join` function concatenates the list into a
comma-separated string, the DNS datasource splits and queries each one, and
`all of [[ds.1.*.cname]]` in a validation rule checks all results.

This pattern works for **any number of elements** without hardcoding one
dsFlow entry per index. LDAP and REST datasources do NOT have this comma-split
behavior.

### Example: CNAME Lookup for SAN Validation

```json
{
  "type": "dns",
  "name": "san-cname-check",
  "description": "Look up CNAME for certificate SAN validation",
  "lookup": "{{csr.san.dnsname.1}}",
  "recordTypes": ["cname"],
  "timeout": "10s"
}
```

After execution, access results as `ds.1.1.cname` in computation rules or validation conditions.

---

## LDAP Datasource

Queries LDAP directories (Active Directory, OpenLDAP, etc.) for user/object attributes.

### Configuration Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | string | Yes | - | Must be `"ldap"` |
| `name` | string | Yes | - | Unique primary key. **IMMUTABLE after creation.** |
| `displayName` | LocalizedString[] | No | - | Localized display names |
| `description` | string | No | - | Human-readable description |
| `hostname` | string | Yes | - | LDAP server URL (e.g., `"ldaps://ldap.corp.example.com"`) |
| `port` | integer | No | 389/636 | Connection port. Default 389 (LDAP), 636 (LDAPS) |
| `credentials` | string | Yes | - | Name of existing PasswordCredentials for LDAP bind (DN + password) |
| `secure` | boolean | Yes | - | Use LDAPS (TLS) |
| `disableHostnameValidation` | boolean | No | false | Skip hostname validation on TLS |
| `baseDn` | TemplateString | Yes | - | LDAP search base DN. Supports `{{key}}` syntax |
| `filter` | TemplateString | Yes | - | LDAP search filter. Supports `{{key}}` syntax |
| `attributes` | DataSourceOutput[] | No | - | Attributes to return. Each: `{key, multi, selected}` |
| `limit` | integer | No | - | Maximum query result count |
| `followReferrals` | boolean | No | - | Enable LDAP referral traversal |
| `proxy` | string | No | - | Name of an HTTP proxy object |
| `timeout` | FiniteDuration | Yes | - | Query timeout |

### Special LDAP Attribute Handling

The LDAP datasource automatically decodes these attributes:
- `objectSid`: decoded from binary SID format to string representation
- `objectGuid`: decoded from binary GUID format to hex string
- `userCertificate`: parsed as X.509 PEM with subject elements extracted
- `dn`: parsed into subject components as `subject.<type>.<index>` (e.g.,
  `subject.cn.1`, `subject.ou.1`, `subject.dc.1`). The raw DN is also
  available as the `dn` key. This parsing happens automatically for every
  LDAP result - the `dn` attribute does not need to be in the `attributes`
  list.

### LDAP Result Structure and Indexing

LDAP results are indexed like DNS: `ds.<flowIndex>.<resultIndex>.<attribute>`.
Multiple LDAP results (when `limit > 1`) get separate result indexes:
- `ds.1.1.department` = department of first LDAP result
- `ds.1.2.department` = department of second LDAP result

Multi-valued LDAP attributes (e.g., `memberOf` with `multi: true`) are
sub-indexed: `ds.1.1.memberOf.1`, `ds.1.1.memberOf.2`, etc.

Use `[[ds.1.*.memberOf.*]]` (double wildcard) to match all values of a
multi-valued attribute across all results.

### Attribute Selection Behavior

The `attributes` array controls which LDAP attributes appear in the dsFlow
results:
- `selected: true` - attribute IS included in the dictionary output
- `selected: false` - attribute is known but EXCLUDED from output
- `multi: true` - attribute may have multiple values (sub-indexed as `.1`, `.2`, etc.)
- `multi: false` - only the first value is returned (no sub-index)
- If `attributes` is omitted entirely, ALL attributes from the LDAP entry
  are returned (auto-discovery mode). After the first test, Horizon populates
  the `attributes` list with discovered attributes.

**Important**: Only attributes with `selected: true` are sent in the LDAP
search request. Setting `selected: false` is not just a filter on the output -
it also means the attribute is not requested from the LDAP server.

### LDAP Filter Syntax

The `filter` field uses standard LDAP filter syntax (RFC 4515) with
TemplateString `{{key}}` substitution. Common patterns:
- `(sAMAccountName={{principal.identifier}})` - match by user login
- `(cn={{csr.subject.cn.1}})` - match by CN from CSR
- `(&(objectClass=computer)(dNSHostName={{csr.san.dnsname.1}}))` - match computer by hostname
- `(|(uid={{user}})(mail={{user}}))` - match by UID or email

**Escaping**: LDAP special characters in template values (`*`, `(`, `)`, `\`,
NUL) are NOT automatically escaped. If user-supplied values may contain these
characters, consider sanitizing at the profile level.

### Validation on Create/Update

- Referenced credentials must exist and be of type `PasswordCredentials`
- Referenced HTTP proxy must exist (if specified)

### Example: Corporate LDAP User Lookup

```json
{
  "type": "ldap",
  "name": "corp-ldap",
  "hostname": "ldaps://ldap.corp.example.com",
  "port": 636,
  "credentials": "ldap-bind-creds",
  "baseDn": "OU=Users,DC=corp,DC=example,DC=com",
  "filter": "(sAMAccountName={{principal.identifier}})",
  "secure": true,
  "timeout": "10s",
  "limit": 1,
  "attributes": [
    {"key": "department", "multi": false, "selected": true},
    {"key": "mail", "multi": false, "selected": true},
    {"key": "memberOf", "multi": true, "selected": true}
  ]
}
```

---

## REST Datasource

Calls HTTP APIs and returns parsed response data.

### Configuration Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | string | Yes | - | Must be `"rest"` |
| `name` | string | Yes | - | Unique primary key. **IMMUTABLE after creation.** |
| `displayName` | LocalizedString[] | No | - | Localized display names |
| `description` | string | No | - | Human-readable description |
| `method` | string | Yes | - | HTTP method (GET, POST, PUT, DELETE, etc.) |
| `url` | TemplateString | Yes | - | Endpoint URL. Supports `{{key}}` syntax. Must not contain whitespace |
| `authenticationType` | string | Yes | - | `"noauth"`, `"basic"`, `"x509"`, `"bearer"`, or `"custom"` |
| `credentials` | string | Cond. | - | Credentials name. Required when authenticationType is not `"noauth"` |
| `headers` | Header[] | No | - | Custom HTTP headers: `[{name: "X-Custom", value: "{{key}}"}]` |
| `payloadType` | string | No | - | Payload format hint (e.g., `"json"`) for UI display |
| `payload` | TemplateString | No | - | Request body. Supports `{{key}}` syntax |
| `expectedHttpCodes` | integer[] | Yes | - | HTTP codes that mean success (e.g., `[200, 201]`). At least one required |
| `proxy` | string | No | - | Name of an HTTP proxy object |
| `timeout` | FiniteDuration | Yes | - | Request timeout |
| `attributes` | DataSourceOutput[] | No | - | Response fields to extract |

### Authentication Types and Credential Mappings

Each authentication type requires a specific Horizon credential type.
Using the wrong combination causes a validation error.

| Auth type | Required credential type | Auto-generated behavior |
|-----------|------------------------|------------------------|
| `noauth` | None (MUST NOT provide) | No auth headers added |
| `basic` | PasswordCredentials | `Authorization: Basic base64(login:password)` auto-generated |
| `bearer` | RawCredentials | `Authorization: Bearer <secret>` auto-generated |
| `x509` | CertificateCredentials | mTLS client certificate attached to request |
| `custom` | PasswordCredentials OR RawCredentials | NO auto-headers. Credentials exposed as dictionary keys (see below) |

**Credential dictionary keys** (available in `payload` and `headers` TemplateStrings only - NOT in `url`):

| Credential type | Dictionary keys |
|----------------|-----------------|
| PasswordCredentials | `{{credentials.login}}` (username), `{{credentials.password}}` (password) |
| RawCredentials | `{{credentials.key}}` (raw secret value) |

**Important**: Credential dictionary keys are excluded from the datasource's
`getInputs` list (they are filtered out by the `filterNot(_.startsWith("credentials."))`)
and are only injected during payload and header evaluation, not URL evaluation.
This means `{{credentials.login}}` works in headers and payload but NOT in the URL.

### Chaining Pattern: OAuth Token Then API Call

Many external APIs require OAuth client_credentials authentication. Since
Horizon doesn't have a native OAuth auth type, use two chained REST
datasources: one to acquire a token, one to call the API.

**Pattern**:
1. **Datasource A** (token): POST to the OAuth token endpoint with `custom`
   auth + PasswordCredentials. The `{{credentials.login}}` provides the
   client_id and `{{credentials.password}}` provides the client_secret in
   the payload. The JSON response's `access_token` field becomes
   `ds.<flowIndex>.access_token` in the dictionary.

2. **Datasource B** (API call): GET/POST to the actual API with `noauth`.
   Pass the token via a custom header:
   `[{"name": "Authorization", "value": "Bearer {{ds.<flowIndexOfA>.access_token}}"}]`

3. **dsFlow**: Chain A then B. B's headers reference A's output because
   dsFlow entries execute in order and merge results into the dictionary.

4. **Computation rule**: Map API response fields to certificate elements:
   `{"source": "{{ds.<flowIndexOfB>.fieldName}}", "target": "sans.othername_upn"}`

This pattern works for any OAuth-protected API (identity providers, cloud
services, CMDBs, etc.). The key insight is that `noauth` + manual header
construction lets you inject tokens from previous datasource results.

Note: REST results have NO result index level. The dictionary key is
`ds.<flowIndex>.<jsonPath>`, not `ds.<flowIndex>.1.<jsonPath>`.

### JSON Response Parsing (Critical Behavior)

The REST datasource **only supports JSON responses**. Non-JSON responses
(plain text, XML, HTML) cause a parse failure with status `failure`.

JSON responses are automatically parsed into **flattened dot-notation
dictionary entries**:
- Nested objects: `parent.child.grandchild`
- Arrays: `parent.1`, `parent.2` (1-based indexing)
- Nested arrays of objects: `users.1.name`, `users.1.roles.1`, `users.2.name`
- Empty arrays/objects produce a key with empty value: `parent =` (present but empty)

Example: a response of `{"users": [{"name": "alice", "roles": ["admin", "user"]}]}`
produces:
```
users =              (empty - marks array presence)
users.1.name = alice
users.1.roles =      (empty - marks array presence)
users.1.roles.1 = admin
users.1.roles.2 = user
```

### Attribute Selection Behavior

Same pattern as LDAP:
- `selected: true` - attribute IS included in dictionary output
- `selected: false` - attribute is EXCLUDED
- `multi: true` - matches the attribute key as a prefix pattern (includes
  all nested children, e.g., `users` with `multi: true` includes `users.1.name`,
  `users.1.roles.1`, etc.)
- `multi: false` - exact key match only
- If `attributes` is omitted entirely, ALL parsed JSON fields are returned

### HTTP Error Handling

- Response code in `expectedHttpCodes` list: status `success`, dictionary populated
- Response code NOT in list: status `failure`, error message includes actual vs expected codes, dictionary is EMPTY
- Connection timeout or network error: status `failure`, no response code

To handle APIs that return different codes for different outcomes (e.g., 200
for found, 404 for not found), include both codes in `expectedHttpCodes` and
check the response in your validation rule.

### REST Result Structure

REST datasource results include:
- `computedUrl`: the URL after TemplateString resolution
- `computedPayload`: the payload after TemplateString resolution
- `computedHeaders`: headers after TemplateString resolution
- `responseCode`: HTTP status code received
- `responseHeaders`: response headers
- `responseBody`: raw response body
- `dictionary`: extracted attributes as key-value pairs

**Unlike DNS and LDAP, REST results are NOT multi-indexed** - there is one
result per REST call (no result index level). Dictionary entries are directly
at `ds.<flowIndex>.<jsonPath>`.

### Example: CMDB API Lookup

```json
{
  "type": "rest",
  "name": "cmdb-api",
  "method": "GET",
  "url": "https://cmdb.corp.local/api/v1/hosts/{{csr.san.dnsname.1}}",
  "authenticationType": "bearer",
  "credentials": "cmdb-api-token",
  "timeout": "10s",
  "expectedHttpCodes": [200],
  "attributes": [
    {"key": "owner", "multi": false, "selected": true},
    {"key": "environment", "multi": false, "selected": true}
  ]
}
```

---

## Datasource Flow Integration (in Profiles)

Datasources are used in profiles through the `dsFlow` field - an ordered list
of `DataSourceFlowEntry` objects.

### DataSourceFlowEntry Structure

| Field | Type | Description |
|-------|------|-------------|
| `ds` | string | Name of a configured datasource |
| `inputs` | DataSourceInput[] | Input mappings: `[{key: "param", value: "{{dict.entry}}"}]` |
| `stopOnSuccess` | boolean | If true and this datasource returns results, skip remaining entries |

### Result Access Patterns

Results are indexed by flow position (1-based in dictionary):

| Pattern | Description |
|---------|-------------|
| `ds.<flowIndex>.<resultIndex>.<key>` | Specific result attribute |
| `ds.<flowIndex>.*.<key>` | Wildcard over all results (multi-valued) |

### Flow Execution

1. Flows execute **in order** - each flow's results are available to subsequent flows
2. Input `value` fields are ComputationRule expressions resolved against the current dictionary
3. `stopOnSuccess: true` implements fallback chains (try primary, skip to next on failure)
4. Results feed into both **computation rules** and **validation rules**

### Example: Chained LDAP with DNS Fallback

```json
{
  "dsFlow": [
    {
      "ds": "primary-ldap",
      "stopOnSuccess": true,
      "inputs": [{"key": "uid", "value": "{{principal.identifier}}"}]
    },
    {
      "ds": "backup-ldap",
      "stopOnSuccess": false,
      "inputs": [{"key": "uid", "value": "{{principal.identifier}}"}]
    }
  ]
}
```

---

## Dictionary Key Patterns by Datasource Type

Each datasource type produces different key structures in the dictionary.
Understanding these patterns is essential for writing computation rules and
validation rule conditions.

### DNS Dictionary Keys

Pattern: `ds.<flowIndex>.<lookupIndex>.<recordType>[.<subIndex>]`

| Key pattern | Example | Description |
|-------------|---------|-------------|
| `ds.1.1.cname` | `"app.paas.internal"` | CNAME target for 1st hostname (single-valued) |
| `ds.1.1.a.1` | `"10.0.0.1"` | First A record for 1st hostname |
| `ds.1.1.a.2` | `"10.0.0.2"` | Second A record for 1st hostname |
| `ds.1.2.cname` | `"app2.paas.internal"` | CNAME for 2nd hostname (when using Join comma-split) |
| `ds.1.1.aaaa.1` | `"2001:db8::1"` | First AAAA record |
| `ds.1.1.txt.1` | `"v=spf1 ..."` | First TXT record |
| `ds.1.1.ptr` | `"host.example.com"` | PTR record (single-valued) |

**Wildcards**: `[[ds.1.*.cname]]` = all CNAMEs across all lookups.
`[[ds.1.*.a.*]]` = all A records across all lookups and sub-indexes.

### LDAP Dictionary Keys

Pattern: `ds.<flowIndex>.<resultIndex>.<attribute>[.<subIndex>]`

| Key pattern | Example | Description |
|-------------|---------|-------------|
| `ds.1.1.department` | `"Engineering"` | Single-valued attribute, 1st result |
| `ds.1.1.mail` | `"user@corp.local"` | Single-valued attribute |
| `ds.1.1.memberOf.1` | `"CN=Admins,..."` | First value of multi-valued attribute |
| `ds.1.1.memberOf.2` | `"CN=Users,..."` | Second value of multi-valued attribute |
| `ds.1.2.department` | `"Marketing"` | Same attribute, 2nd LDAP result (when limit > 1) |
| `ds.1.1.dn` | `"CN=user,OU=..."` | Auto-parsed DN (always present) |
| `ds.1.1.subject.cn.1` | `"username"` | Auto-parsed DN component |
| `ds.1.1.subject.ou.1` | `"Users"` | Auto-parsed DN component |

**Wildcards**: `[[ds.1.*.department]]` = department from all LDAP results.
`[[ds.1.1.memberOf.*]]` = all memberOf values for 1st result.

### REST Dictionary Keys

Pattern: `ds.<flowIndex>.<jsonPath>` (no result index level)

| Key pattern | Example | Description |
|-------------|---------|-------------|
| `ds.1.status` | `"active"` | Top-level JSON field |
| `ds.1.user.name` | `"alice"` | Nested object field |
| `ds.1.roles.1` | `"admin"` | First array element |
| `ds.1.roles.2` | `"user"` | Second array element |
| `ds.1.users.1.name` | `"alice"` | Nested array of objects |
| `ds.1.users.1.roles.1` | `"admin"` | Deeply nested array |

**Important**: REST has NO result index (unlike DNS/LDAP). The JSON path
starts directly after the flow index. `ds.1.field` not `ds.1.1.field`.

### Using Datasource Results in Computation Rules

Computation rules use `{{key}}` for single values and `[[key]]` for lists:

```json
{"source": "{{ds.1.1.department}}", "target": "subject.organizationalUnit", "condition": "{{ds.1.1.department}}"}
{"source": "OrElse({{ds.1.1.mail}}, {{principal.mail}})", "target": "contactEmail"}
{"source": "Upper({{ds.1.status}})", "target": "label.api-status"}
{"source": "[[ ds.1.*.a.* ]]", "target": "sans.ipaddresses", "overwrite": true}
```

The `condition` field prevents setting empty values when the datasource
returned nothing for that attribute.

### Using Datasource Results in Validation Rules

Validation rules use the same `{{key}}` / `[[key]]` syntax but with
condition operators:

```
{{ds.1.1.department}} equals "Engineering"
{{ds.1.1.memberOf}} contains "CN=PKI-Users"
all of [[ds.1.*.cname]] matches ".*\\.paas\\.internal$"
(all of [[ds.1.*.a.*]] in 10.0.0.0/8) and (all of [[ds.1.*.aaaa.*]] in fd00::/48)
{{ds.1.status}} equals "active"
```

---

## Testing Datasources

### Test a Single Datasource

Use the `test_datasource` tool (PATCH /api/v1/datasources) to test a datasource
definition with a context dictionary **without creating it first**.

```json
{
  "ds": {
    "type": "dns",
    "name": "test-dns",
    "lookup": "{{hostname}}"
  },
  "context": [
    {"key": "hostname", "value": "app.corp.local"}
  ]
}
```

### Test a Flow Pipeline

Use the existing `simulate_datasource_flow` tool (POST /api/v1/datasource/flows)
to test a complete flow chain with context.

---

## Finite Duration Format

Timeout fields accept `"<length><unit>"` (whitespace optional):

| Unit | Short | Long forms |
|------|-------|------------|
| Days | d | day, days |
| Hours | h | hour, hours |
| Minutes | m | min, mins, minute, minutes |
| Seconds | s | sec, secs, second, seconds |
| Milliseconds | ms | milli, millis, millisecond, milliseconds |

Examples: `"10s"`, `"10 seconds"`, `"30s"`, `"5m"`, `"1h"`

---

## API Endpoints

| Method | Path | Operation |
|--------|------|-----------|
| GET | /api/v1/datasources | List all datasources |
| GET | /api/v1/datasources/{name} | Get by name |
| POST | /api/v1/datasources | Create |
| PUT | /api/v1/datasources | Update |
| DELETE | /api/v1/datasources/{name} | Delete |
| PATCH | /api/v1/datasources | Test (ad-hoc execution) |

## RBAC Permissions

- `configuration:datasources:audit` - read operations (list, get, test, flow template)
- `configuration:datasources:manage` - write operations (create, update, delete)

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| DS-001 | 500 | Unexpected error |
| DS-002 | 400 | Invalid datasource configuration |
| DS-003 | 404 | Datasource not found |
| DS-004 | 400 | Datasource name already exists |
| DS-005 | 400 | Cannot delete - datasource is still referenced by a profile's dsFlow |
| DS-006 | 400 | Invalid test request |

---

## End-to-End Recipes

### Recipe 1: DNS CNAME Validation for ALL SANs (Unbounded)

**Goal**: Auto-validate that ALL DNS SANs in an enrollment request point
to a CNAME under `paas.internal`, for any number of SANs.

**Key insight**: The DNS datasource splits comma-separated lookup values and
performs a separate DNS query per value (see `DNSDataSource.scala:140`).
Combined with `Join` in the dsFlow input and `all of [[ds.1.*.cname]]` in
the validation rule, this handles any number of SANs without hardcoding.

**Step 1** - Create DNS datasource:
```
create_dns_datasource(
    name="san-cname-check",
    lookup="{{hostnames}}",
    record_types=["cname"],
    timeout="10s"
)
```

**Step 2** - Add to profile dsFlow using `Join` to pass ALL SANs:
```json
{
  "dsFlow": [{
    "ds": "san-cname-check",
    "inputs": [{"key": "hostnames", "value": "Join([[csr.san.dnsname]], \",\")"}],
    "stopOnSuccess": false
  }]
}
```
If the CSR has 3 DNS SANs, `Join` produces `"host1.corp.local,host2.corp.local,host3.corp.local"`.
The DNS datasource splits this by comma and does 3 separate lookups, producing
results at `ds.1.1.cname`, `ds.1.2.cname`, `ds.1.3.cname`.

**Step 3** - Add validation rule with array quantifier:
```json
{
  "validationRuleset": {
    "rules": ["all of [[ds.1.*.cname]] matches \".*\\.paas\\.internal$\""],
    "threshold": 1
  }
}
```
The `[[ds.1.*.cname]]` wildcard matches all CNAME results regardless of count.

**Edge case**: If a SAN has no CNAME (resolves directly via A record),
`ds.1.N.cname` won't exist for that index. The `all of` check only validates
existing CNAMEs. If the DNS infrastructure guarantees all hosts have CNAMEs,
this is safe. Otherwise, add SAN regex constraints in the profile template.

### Recipe 2: LDAP User Enrichment + Group Validation

**Goal**: Enrich certificates with department from AD and auto-validate the
user belongs to the PKI-Users group.

**Step 1** - Create LDAP datasource:
```
create_ldap_datasource(
    name="corp-ad",
    hostname="ldaps://dc01.corp.local",
    credentials="ad-bind-creds",
    base_dn="DC=corp,DC=local",
    filter="(sAMAccountName={{principal.identifier}})",
    secure=True,
    timeout="10s",
    limit=1,
    attributes=[
        {"key": "department", "multi": false, "selected": true},
        {"key": "memberOf", "multi": true, "selected": true}
    ]
)
```

**Step 2** - Add to profile dsFlow:
```json
{
  "dsFlow": [{
    "ds": "corp-ad",
    "inputs": [{"key": "principal.identifier", "value": "{{principal.identifier}}"}],
    "stopOnSuccess": false
  }]
}
```

**Step 3** - Add computation rule to enrich department:
```json
{"source": "{{ds.1.1.department}}", "target": "subject.organizationalUnit", "condition": "{{ds.1.1.department}}"}
```

**Step 4** - Add validation rule for group membership:
```json
{
  "validationRuleset": {
    "rules": ["{{ds.1.1.memberOf}} contains \"CN=PKI-Users\""],
    "threshold": 1
  }
}
```

### Recipe 3: REST API Host Ownership Check

**Goal**: Look up the hostname owner in a CMDB before enrollment and set it as
the certificate contact email.

**Step 1** - Create REST datasource:
```
create_rest_datasource(
    name="cmdb-lookup",
    method="GET",
    url="https://cmdb.corp.local/api/hosts/{{hostname}}",
    authentication_type="bearer",
    credentials="cmdb-api-token",
    timeout="10s",
    expected_http_codes=[200],
    attributes=[
        {"key": "owner_email", "multi": false, "selected": true},
        {"key": "environment", "multi": false, "selected": true}
    ]
)
```

**Step 2** - Add to profile dsFlow:
```json
{
  "dsFlow": [{
    "ds": "cmdb-lookup",
    "inputs": [{"key": "hostname", "value": "{{csr.san.dnsname.1}}"}],
    "stopOnSuccess": false
  }]
}
```

**Step 3** - Add computation rule:
```json
{"source": "OrElse({{ds.1.1.owner_email}}, {{principal.mail}})", "target": "contactEmail"}
```

---

## Related Resources

- horizon://knowledge/computation-and-data-flow - computation rule syntax and datasource flow chaining
- horizon://knowledge/validation-rules - validation rule conditions that reference ds.* entries
- horizon://knowledge/dictionary-entries - all dictionary entries including datasource results
- horizon://knowledge/profiles - profile configuration including dsFlow and authorizationMode
