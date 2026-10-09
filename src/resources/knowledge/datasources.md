# External Datasources - DNS, LDAP, REST

## Overview

Datasources are external data assets queried during certificate enrollment to
enrich request data for computation rules and validation rule conditions.
They run at **enrollment time** (after request submission, before certificate
issuance) and populate dictionary entries prefixed with `ds.<flowIndex>`.

Three types exist: **DNS**, **LDAP**, and **REST**.

**Dependency chain**: Credentials -> Datasource -> Profile (references datasource in dsFlow)

---

## Decision Guide - Which Datasource Type to Use

| Use case                                                     | Type | Why                                       |
| ------------------------------------------------------------ | ---- | ----------------------------------------- |
| Validate SAN hostnames resolve in DNS                        | DNS  | Returns A/AAAA/CNAME/PTR/TXT records      |
| Check CNAME targets for PaaS/CDN validation                  | DNS  | CNAME record reveals the canonical target |
| Verify domain ownership via TXT records                      | DNS  | TXT records contain verification tokens   |
| Enrich certificates with user attributes (department, email) | LDAP | Queries AD/LDAP directories for user data |
| Validate user group membership for auto-approval             | LDAP | Check `memberOf` attribute                |
| Look up computer/server attributes in AD                     | LDAP | Query computer objects by hostname        |
| Call an internal CMDB or asset management API                | REST | HTTP request to any REST endpoint         |
| Validate hostnames against an internal registry              | REST | Custom HTTP API lookup                    |
| Fetch certificate metadata from an external system           | REST | Generic HTTP integration                  |

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

5. **Reference results in computation rules or validation rules** - inspect
   the flow dictionary and use the returned keys.

6. **Verify end-to-end** - use `simulate_datasource_flow` to test the complete
   pipeline with all chained datasources.

---

## DNS Datasource

Queries DNS servers and returns record data.

### Configuration Fields

| Field         | Type              | Required | Default      | Description                                                                                                        |
| ------------- | ----------------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `type`        | string            | Yes      | -            | Must be `"dns"`                                                                                                    |
| `name`        | string            | Yes      | -            | Unique datasource identifier. Keep the name when updating.                                                         |
| `displayName` | LocalizedString[] | No       | -            | Localized display names: `[{lang: "en", value: "..."}]`                                                            |
| `description` | string            | No       | -            | Human-readable description                                                                                         |
| `host`        | string            | No       | System DNS   | DNS server IP address. If omitted, uses Horizon's default resolver                                                 |
| `port`        | integer           | No       | 53           | DNS server port                                                                                                    |
| `timeout`     | FiniteDuration    | No       | "10 seconds" | Query timeout                                                                                                      |
| `recordTypes` | string[]          | No       | all          | Filter which record types to return. Values: `a`, `aaaa`, `cname`, `ptr`, `txt`. If omitted, ALL types are fetched |
| `lookup`      | TemplateString    | Yes      | -            | DNS hostname to look up. Supports `{{key}}` syntax for dynamic values                                              |

Select the record types to fetch with `recordTypes`. Use `test_datasource`
to inspect the returned dictionary before writing computation rules.

### DNS Datasource Constraints

- Does **NOT** support credentials or proxy
- Inputs are extracted from the `lookup` TemplateString dictionary keys

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

Use `simulate_datasource_flow` to inspect the dictionary keys before writing
computation rules or validation conditions.

---

## LDAP Datasource

Queries LDAP directories (Active Directory, OpenLDAP, etc.) for user/object attributes.

### Configuration Fields

| Field                       | Type               | Required | Default | Description                                                        |
| --------------------------- | ------------------ | -------- | ------- | ------------------------------------------------------------------ |
| `type`                      | string             | Yes      | -       | Must be `"ldap"`                                                   |
| `name`                      | string             | Yes      | -       | Unique datasource identifier. Keep the name when updating.         |
| `displayName`               | LocalizedString[]  | No       | -       | Localized display names                                            |
| `description`               | string             | No       | -       | Human-readable description                                         |
| `hostname`                  | string             | Yes      | -       | LDAP server URL (e.g., `"ldaps://ldap.corp.example.com"`)          |
| `port`                      | integer            | No       | 389/636 | Connection port. Default 389 (LDAP), 636 (LDAPS)                   |
| `credentials`               | string             | Yes      | -       | Name of existing PasswordCredentials for LDAP bind (DN + password) |
| `secure`                    | boolean            | Yes      | -       | Use LDAPS (TLS)                                                    |
| `disableHostnameValidation` | boolean            | No       | false   | Skip hostname validation on TLS                                    |
| `baseDn`                    | TemplateString     | Yes      | -       | LDAP search base DN. Supports `{{key}}` syntax                     |
| `filter`                    | TemplateString     | Yes      | -       | LDAP search filter. Supports `{{key}}` syntax                      |
| `attributes`                | DataSourceOutput[] | No       | -       | Attributes to return. Each: `{key, multi, selected}`               |
| `limit`                     | integer            | No       | -       | Maximum query result count                                         |
| `followReferrals`           | boolean            | No       | -       | Enable LDAP referral traversal                                     |
| `proxy`                     | string             | No       | -       | Name of an HTTP proxy object                                       |
| `timeout`                   | FiniteDuration     | Yes      | -       | Query timeout                                                      |

### LDAP Result Fields

`LDAPDataSourceResult` exposes `computedDN`, `computedFilter`, and the
result `dictionary`. Use `test_datasource` to inspect the returned dictionary
before writing computation rules.

### LDAP Result Access

Use `{{ds.1.1.mail}}` to access an LDAP mail value.
Run `test_datasource` or `simulate_datasource_flow` and read the returned
dictionary keys for your selected attributes.

### Attribute Selection Behavior

The `attributes` array lists outputs to fetch. Each `DataSourceOutput` has
a required `key`, optional nullable `selected` (default `true`), and optional
nullable `multi` (default `false`). `multi` identifies multivalued attributes;
`selected` selects an attribute for future fetches.

### LDAP Filter Syntax

The `filter` field uses standard LDAP filter syntax (RFC 4515) with
TemplateString `{{key}}` substitution. Common patterns:

- `(sAMAccountName={{principal.identifier}})` - match by user login
- `(cn={{csr.subject.cn.1}})` - match by CN from CSR
- `(&(objectClass=computer)(dNSHostName={{csr.san.dnsname.1}}))` - match computer by hostname
- `(|(uid={{user}})(mail={{user}}))` - match by UID or email

Use an LDAP mail value, with the authenticated principal's mail as a fallback:

```text
OrElse({{ds.1.1.mail}}, {{principal.mail}})
```

Set this expression on `certificateTemplate.contactEmailPolicy.computationRule`.

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
    { "key": "department", "multi": false, "selected": true },
    { "key": "mail", "multi": false, "selected": true },
    { "key": "memberOf", "multi": true, "selected": true }
  ]
}
```

---

## REST Datasource

Calls HTTP APIs and returns parsed response data.

### Configuration Fields

| Field                | Type               | Required | Default | Description                                                              |
| -------------------- | ------------------ | -------- | ------- | ------------------------------------------------------------------------ |
| `type`               | string             | Yes      | -       | Must be `"rest"`                                                         |
| `name`               | string             | Yes      | -       | Unique datasource identifier. Keep the name when updating.               |
| `displayName`        | LocalizedString[]  | No       | -       | Localized display names                                                  |
| `description`        | string             | No       | -       | Human-readable description                                               |
| `method`             | string             | Yes      | -       | HTTP method (GET, POST, PUT, DELETE, etc.)                               |
| `url`                | TemplateString     | Yes      | -       | Endpoint URL. Supports `{{key}}` syntax. Must not contain whitespace     |
| `authenticationType` | string             | Yes      | -       | `"noauth"`, `"basic"`, `"x509"`, `"bearer"`, or `"custom"`               |
| `credentials`        | string             | Cond.    | -       | Credentials name. Required when authenticationType is not `"noauth"`     |
| `headers`            | Header[]           | No       | -       | Custom HTTP headers: `[{name: "X-Custom", value: "{{key}}"}]`            |
| `payloadType`        | string             | No       | -       | Payload format hint (e.g., `"json"`) for UI display                      |
| `payload`            | TemplateString     | No       | -       | Request body. Supports `{{key}}` syntax                                  |
| `expectedHttpCodes`  | integer[]          | Yes      | -       | HTTP codes that mean success (e.g., `[200, 201]`). At least one required |
| `proxy`              | string             | No       | -       | Name of an HTTP proxy object                                             |
| `timeout`            | FiniteDuration     | Yes      | -       | Request timeout                                                          |
| `attributes`         | DataSourceOutput[] | No       | -       | Response fields to extract                                               |

### Authentication Types and Credential Mappings

Each authentication type requires a specific Horizon credential type.
Using the wrong combination causes a validation error.

| Auth type | Required credential type              | Auto-generated behavior                                      |
| --------- | ------------------------------------- | ------------------------------------------------------------ |
| `noauth`  | None (MUST NOT provide)               | No auth headers added                                        |
| `basic`   | PasswordCredentials                   | `Authorization: Basic base64(login:password)` auto-generated |
| `bearer`  | RawCredentials                        | `Authorization: Bearer <secret>` auto-generated              |
| `x509`    | CertificateCredentials                | mTLS client certificate attached to request                  |
| `custom`  | PasswordCredentials OR RawCredentials | Credential values are available in headers                   |

### Response and Output Fields

Configure `expectedHttpCodes` with the response codes that indicate success.
Other response codes produce a failure.
Use `test_datasource` to inspect the response and output dictionary before
writing computation rules.

Output selections use `DataSourceOutput`: `key`, `selected`, and `multi`.

### REST Result Structure

REST datasource results include:

- `computedUrl`: the URL after TemplateString resolution
- `computedPayload`: the payload after TemplateString resolution
- `computedHeaders`: headers after TemplateString resolution
- `responseCode`: HTTP status code received
- `responseHeaders`: response headers
- `responseBody`: raw response body
- `dictionary`: extracted attributes as key-value pairs

### Example: CMDB API Lookup

```json
{
  "type": "rest",
  "name": "cmdb-api",
  "method": "GET",
  "url": "https://cmdb.corp.example.com/api/v1/hosts/{{csr.san.dnsname.1}}",
  "authenticationType": "bearer",
  "credentials": "cmdb-api-token",
  "timeout": "10s",
  "expectedHttpCodes": [200],
  "attributes": [
    { "key": "owner", "multi": false, "selected": true },
    { "key": "environment", "multi": false, "selected": true }
  ]
}
```

---

## Datasource Flow Integration (in Profiles)

Datasources are used in profiles through the `dsFlow` field - an ordered list
of `DataSourceFlowEntry` objects.

### DataSourceFlowEntry Structure

| Field           | Type              | Description                                                         |
| --------------- | ----------------- | ------------------------------------------------------------------- |
| `ds`            | string            | Name of a configured datasource                                     |
| `inputs`        | DataSourceInput[] | Input mappings: `[{key: "param", value: "{{dict.entry}}"}]`         |
| `stopOnSuccess` | boolean           | If true and this datasource returns results, skip remaining entries |

### Result Access Patterns

Datasource flow results use the prefix `ds.<flowIndex>`, starting from 1.
Run `test_datasource` or `simulate_datasource_flow` and read the returned
dictionary keys before writing expressions.

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
      "inputs": [{ "key": "uid", "value": "{{principal.identifier}}" }]
    },
    {
      "ds": "backup-ldap",
      "stopOnSuccess": false,
      "inputs": [{ "key": "uid", "value": "{{principal.identifier}}" }]
    }
  ]
}
```

---

## Dictionary Key Patterns by Datasource Type

Run `test_datasource` or `simulate_datasource_flow` and read the returned
dictionary keys before writing computation rules or validation conditions.

### DNS Dictionary Keys

`DNSDataSourceResult` exposes `computedLookupValues` and a result `dictionary`.
Run `test_datasource` or `simulate_datasource_flow` and read the returned keys.

When updating a DNS datasource flow from before Horizon 2.7.7, replace
`ds.1.a` with `ds.1.a.1`.

[Horizon 2.7.7 release notes](https://docs.evertrust.fr/horizon/2.7/release-notes/2.7.7.html).

### LDAP Dictionary Keys

Use `{{ds.1.1.mail}}` to access an LDAP mail value. Run `test_datasource`
or `simulate_datasource_flow` and read the returned dictionary keys for
other attributes.

[Validation guide](https://docs.evertrust.fr/horizon/2.11/admin-guide/protocols/autovalidation.html).

### REST Dictionary Keys

The result exposes a `dictionary`. Use `simulate_datasource_flow` to inspect
its keys before writing computation rules or validation conditions.

### Using Datasource Results in Computation Rules

Computation rules use `{{key}}` for single values and `[[key]]` for lists:

Set a string `computationRule` on the selected certificate-template field.
For example, use `{{ds.1.1.mail}}` for an LDAP mail value. Run
`test_datasource` or `simulate_datasource_flow` and read the returned
dictionary keys before choosing another attribute.

### Using Datasource Results in Validation Rules

Validation rules use the same `{{key}}` / `[[key]]` syntax but with
condition operators:

```
{{csr.san.rfc822name.1}} equals {{ds.1.1.mail}}
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
  "context": [{ "key": "hostname", "value": "app.corp.example.com" }]
}
```

### Test a Flow Pipeline

Use the existing `simulate_datasource_flow` tool to test a complete flow chain
with context. The MCP accepts a friendly input shape:

- `flow`: ordered entries shaped as `{datasource, inputs, stopOnSuccess}`
- `context`: key/value object used to resolve template expressions

Internally, the MCP translates that input to Horizon's raw
`POST /api/v1/datasource/flows` payload with `dsFlow` entries and `context`
map-entry lists.

---

## Finite Duration Format

Timeout fields accept `"<length><unit>"` (whitespace optional):

| Unit         | Short | Long forms                               |
| ------------ | ----- | ---------------------------------------- |
| Days         | d     | day, days                                |
| Hours        | h     | hour, hours                              |
| Minutes      | m     | min, mins, minute, minutes               |
| Seconds      | s     | sec, secs, second, seconds               |
| Milliseconds | ms    | milli, millis, millisecond, milliseconds |

Examples: `"10s"`, `"10 seconds"`, `"30s"`, `"5m"`, `"1h"`

---

## API Endpoints

| Method | Path                       | Operation               |
| ------ | -------------------------- | ----------------------- |
| GET    | /api/v1/datasources        | List all datasources    |
| GET    | /api/v1/datasources/{name} | Get by name             |
| POST   | /api/v1/datasources        | Create                  |
| PUT    | /api/v1/datasources        | Update                  |
| DELETE | /api/v1/datasources/{name} | Delete                  |
| PATCH  | /api/v1/datasources        | Test (ad-hoc execution) |

## RBAC Permissions

- `configuration:datasources:audit` - read operations (list, get, test, flow template)
- `configuration:datasources:manage` - write operations (create, update, delete)

## Error Codes

| Code   | HTTP | Description                                                          |
| ------ | ---- | -------------------------------------------------------------------- |
| DS-001 | 500  | Unexpected error                                                     |
| DS-002 | 400  | Invalid datasource configuration                                     |
| DS-003 | 404  | Datasource not found                                                 |
| DS-004 | 400  | Datasource name already exists                                       |
| DS-005 | 400  | Cannot delete - datasource is still referenced by a profile's dsFlow |
| DS-006 | 400  | Invalid test request                                                 |

---

## End-to-End Recipes

### Recipe 2: LDAP User Enrichment + Group Validation

**Goal**: Enrich certificates with department from AD and auto-validate the
user belongs to the PKI-Users group.

**Step 1** - Create LDAP datasource:

```
create_ldap_datasource(
    name="corp-ad",
    hostname="ldaps://dc01.corp.example.com",
    credentials="ad-bind-creds",
    base_dn="DC=example,DC=com",
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
  "dsFlow": [
    {
      "ds": "corp-ad",
      "inputs": [
        { "key": "principal.identifier", "value": "{{principal.identifier}}" }
      ],
      "stopOnSuccess": false
    }
  ]
}
```

**Step 3** - Run `simulate_datasource_flow` and read the returned dictionary
keys. Use the department key in the `computationRule` of a certificate-template
OU field.

**Step 4** - Add validation rule for group membership:

Run `test_datasource` or `simulate_datasource_flow` and read the returned
dictionary keys for `memberOf`. Use the returned key with `[[key]]` and
`contains` to compare the list with the full group DN.

### Recipe 3: REST API Host Ownership Check

**Goal**: Look up the hostname owner in a CMDB before enrollment and set it as
the certificate contact email.

**Step 1** - Create REST datasource:

```
create_rest_datasource(
    name="cmdb-lookup",
    method="GET",
    url="https://cmdb.corp.example.com/api/hosts/{{hostname}}",
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
  "dsFlow": [
    {
      "ds": "cmdb-lookup",
      "inputs": [{ "key": "hostname", "value": "{{csr.san.dnsname.1}}" }],
      "stopOnSuccess": false
    }
  ]
}
```

**Step 3** - Inspect the flow dictionary with `simulate_datasource_flow`.
Use the returned owner email key in `contactEmailPolicy.computationRule`.
Use `OrElse` with `{{principal.mail}}` as a fallback.

---

## Related Resources

- horizon://knowledge/computation-and-data-flow - computation rule syntax and datasource flow chaining
- horizon://knowledge/validation-rules - validation rule conditions that reference datasource entries
- horizon://knowledge/dictionary-matrix - all dictionary entries including datasource results
- horizon://knowledge/profiles - profile configuration including dsFlow and authorizationMode
