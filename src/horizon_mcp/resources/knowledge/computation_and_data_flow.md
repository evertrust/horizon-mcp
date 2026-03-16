# Computation Rules, Template Syntax, and Datasource Flows

## Overview

Horizon's computation engine transforms and enriches certificate request data
at **enrollment time** (not request submission time). Computation rules and
datasource flows run *after* the request is submitted but *before* the
certificate is sent to the PKI connector for issuance.

This distinction matters: values resolved by computation rules reflect the
state of external datasources and dictionaries **at the moment of enrollment**,
which may differ from the moment of request creation (especially for requests
that go through a manual approval queue).

---

## Template String Syntax

Horizon uses two template delimiters:

| Syntax          | Resolves to     | Use case |
|-----------------|-----------------|----------|
| `{{ key }}`     | Single string value | Most fields: subject, SANs, extensions |
| `[[ key ]]`     | Multi-value (list) | SAN lists (dnsnames, ipaddresses), multi-valued attributes |

Templates can contain literal text mixed with variable references:

```
"web-{{ csr.subject.cn }}-{{ principal.name }}"
->  "web-myserver.example.com-jdoe"
```

Templates can also nest function calls (see below):

```
"{{ Upper(csr.subject.cn) }}"
->  "MYSERVER.EXAMPLE.COM"
```

---

## Functions Reference (30+)

All functions are case-sensitive and use parentheses for arguments.
Arguments are separated by commas. String literals use double quotes inside
templates.

### String Manipulation

| Function  | Signature                         | Description                                | Example                                      |
|-----------|-----------------------------------|--------------------------------------------|----------------------------------------------|
| `Upper`   | `Upper(value)`                    | Convert to uppercase                       | `Upper("hello")` -> `"HELLO"`                |
| `Lower`   | `Lower(value)`                    | Convert to lowercase                       | `Lower("Hello")` -> `"hello"`                |
| `Trim`    | `Trim(value)`                     | Strip leading/trailing whitespace          | `Trim("  x  ")` -> `"x"`                     |
| `Substr`  | `Substr(value, start, length)`    | Extract substring (0-indexed)              | `Substr("abcdef", 1, 3)` -> `"bcd"`          |
| `Concat`  | `Concat(a, b, ...)`              | Concatenate multiple values                | `Concat("a", "-", "b")` -> `"a-b"`           |
| `Replace` | `Replace(value, old, new)`        | Replace all occurrences                    | `Replace("a.b.c", ".", "-")` -> `"a-b-c"`    |
| `Extract` | `Extract(value, regex)`           | Extract first regex match                  | `Extract("abc123", "[0-9]+")` -> `"123"`      |
| `Match`   | `Match(value, regex)`             | Returns value if it matches regex, else empty | `Match("abc", "^a")` -> `"abc"`            |

### Fallback and Null Handling

| Function  | Signature                    | Description                                  | Example                                          |
|-----------|------------------------------|----------------------------------------------|--------------------------------------------------|
| `OrElse`  | `OrElse(value, fallback)`    | Return fallback if value is null/empty       | `OrElse(csr.subject.ou, "Default")` -> `"Default"` |
| `Null`    | `Null()`                     | Explicit null value                          | Used to clear a field                            |

### Collection Operations

| Function  | Signature                     | Description                                              |
|-----------|-------------------------------|----------------------------------------------------------|
| `Get`     | `Get(list, index)`            | Get element at index (0-based)                           |
| `First`   | `First(list)`                 | First element of a list                                  |
| `Last`    | `Last(list)`                  | Last element of a list                                   |
| `Filter`  | `Filter(list, regex)`         | Keep only elements matching regex                        |
| `Slice`   | `Slice(list, start, end)`     | Sub-list extraction (0-indexed, exclusive end)           |
| `Sort`    | `Sort(list)`                  | Alphabetically sort a list                               |
| `Unique`  | `Unique(list)`                | Remove duplicates from a list                            |

### String <-> List Conversion

| Function  | Signature                     | Description                            |
|-----------|-------------------------------|----------------------------------------|
| `Split`   | `Split(value, delimiter)`     | Split string into list                 |
| `Join`    | `Join(list, delimiter)`       | Join list into string                  |

### DNS and Email Helpers

| Function                 | Signature                          | Description                              | Example                                            |
|--------------------------|------------------------------------|------------------------------------------|----------------------------------------------------|
| `ShortenDNS`             | `ShortenDNS(fqdn)`                | Remove domain suffix, keep hostname      | `ShortenDNS("web.corp.com")` -> `"web"`             |
| `DomainDNS`              | `DomainDNS(fqdn)`                 | Extract domain from FQDN                | `DomainDNS("web.corp.com")` -> `"corp.com"`         |
| `EmailUser`              | `EmailUser(email)`                 | Extract user part                        | `EmailUser("j@x.com")` -> `"j"`                     |
| `EmailDomain`            | `EmailDomain(email)`               | Extract domain part                      | `EmailDomain("j@x.com")` -> `"x.com"`               |
| `SamAccountNameUser`     | `SamAccountNameUser(sam)`          | Extract user from `DOMAIN\user`          | `SamAccountNameUser("CORP\\jdoe")` -> `"jdoe"`       |
| `SamAccountNameDomain`   | `SamAccountNameDomain(sam)`        | Extract domain from `DOMAIN\user`        | `SamAccountNameDomain("CORP\\jdoe")` -> `"CORP"`     |

### Date and Time

| Function          | Signature                                       | Description                                                               |
|-------------------|-------------------------------------------------|---------------------------------------------------------------------------|
| `DateTimeFormat`  | `DateTimeFormat(value, inputFormat, outputFormat)` | Reformat a date/time string. Uses Java SimpleDateFormat patterns.         |
| `Now`             | `Now()`                                         | Current timestamp. Equivalent to the special value `NOW`.                 |

### Encoding and Serialization

| Function       | Signature                | Description                                      |
|----------------|--------------------------|--------------------------------------------------|
| `URLEncode`    | `URLEncode(value)`       | Percent-encode for URLs                          |
| `URLDecode`    | `URLDecode(value)`       | Decode percent-encoded string                    |
| `EscapeJson`   | `EscapeJson(value)`      | Escape special characters for JSON embedding     |
| `JsonArray`    | `JsonArray(list)`        | Serialize list as a JSON array string            |
| `DerAsBase64`  | `DerAsBase64(binary)`    | Encode DER binary as Base64                      |

---

## Special Values

| Value  | Description                                                        |
|--------|--------------------------------------------------------------------|
| `NULL` | Represents an explicit null. Use to clear a field. Equivalent to `Null()`. |
| `NOW`  | Current date/time at evaluation. Equivalent to `Now()`.            |

---

## Dictionary Entries

Computation rules access request data through **dictionary entries** -- named
values organized by category. The available entries depend on the context
(protocol, event type).

### Core Categories

| Category       | Prefix           | Description                                            |
|----------------|------------------|--------------------------------------------------------|
| **CSR**        | `csr.*`          | Data extracted from the Certificate Signing Request    |
| **Principal**  | `principal.*`    | Authenticated user information                         |
| **Request**    | `request.*`      | Request metadata (id, date, status)                    |
| **Certificate**| `certificate.*`  | Existing certificate data (for renewal/update)         |
| **HTTP**       | `http.*`         | HTTP request headers and parameters                    |
| **Protocol**   | `acme.*`, `scep.*`, `est.*` | Protocol-specific context values          |

### Common CSR Entries

| Entry                    | Type   | Description                         |
|--------------------------|--------|-------------------------------------|
| `csr.subject.cn`         | string | Common Name from CSR subject        |
| `csr.subject.o`          | string | Organization                        |
| `csr.subject.ou`         | string | Organizational Unit                 |
| `csr.subject.c`          | string | Country                             |
| `csr.subject.st`         | string | State or Province                   |
| `csr.subject.l`          | string | Locality                            |
| `csr.subject.email`      | string | Email in subject                    |
| `csr.sans.dnsnames`      | list   | DNS Subject Alternative Names       |
| `csr.sans.rfc822names`   | list   | Email SANs                          |
| `csr.sans.ipaddresses`   | list   | IP address SANs                     |
| `csr.sans.uris`          | list   | URI SANs                            |
| `csr.keyType`            | string | Key algorithm (rsa, ec)             |
| `csr.keySize`            | int    | Key size in bits                    |

### Principal Entries

| Entry                    | Type   | Description                         |
|--------------------------|--------|-------------------------------------|
| `principal.name`         | string | Authenticated user identifier       |
| `principal.email`        | string | User's email address                |
| `principal.roles`        | list   | Assigned role names                 |
| `principal.teams`        | list   | Assigned team names                 |

### Protocol-Specific Entries

| Entry                      | Protocol | Description                            |
|----------------------------|----------|----------------------------------------|
| `acme.account.contact`     | ACME     | ACME account contact emails            |
| `acme.identifiers`         | ACME     | Requested ACME identifiers             |
| `scep.challenge`           | SCEP     | SCEP challenge password                |
| `scep.transactionId`       | SCEP     | SCEP transaction identifier            |
| `est.tlsClientCert`        | EST      | Client certificate from TLS handshake  |

### HTTP Entries

| Entry                         | Type   | Description                                  |
|-------------------------------|--------|----------------------------------------------|
| `http.header.<name>`          | string | Value of the named HTTP request header       |
| `http.param.<name>`           | string | Value of the named HTTP query parameter      |
| `http.remoteAddr`             | string | Client IP address                            |

---

## Computation Rule Structure

A computation rule has these fields:

```json
{
  "source": "{{ Upper(csr.subject.cn) }}",
  "target": "subject.commonName",
  "condition": "{{ csr.subject.cn }}",
  "overwrite": true
}
```

| Field       | Required | Description                                                                 |
|-------------|----------|-----------------------------------------------------------------------------|
| `source`    | Yes      | Template expression that produces the value.                                |
| `target`    | Yes      | Destination field in the certificate data.                                  |
| `condition` | No       | Template that must resolve to a non-empty value for the rule to execute.    |
| `overwrite` | No       | If `true`, overwrites existing values. Default `false`.                     |

Rules execute **in order** -- later rules can reference values set by earlier
rules. This ordering is critical for multi-step transformations.

### Common Targets

| Target                        | Description                                  |
|-------------------------------|----------------------------------------------|
| `subject.commonName`          | Certificate subject CN                       |
| `subject.organization`        | Certificate subject O                        |
| `subject.organizationalUnit`  | Certificate subject OU                       |
| `subject.country`             | Certificate subject C                        |
| `subject.stateOrProvince`     | Certificate subject ST                       |
| `subject.locality`            | Certificate subject L                        |
| `subject.email`               | Certificate subject email                    |
| `sans.dnsnames`               | DNS SANs (use `[[ ]]` for multi-value)       |
| `sans.rfc822names`            | Email SANs                                   |
| `sans.ipaddresses`            | IP address SANs                              |
| `sans.uris`                   | URI SANs                                     |
| `extensions.<oid>`            | Custom X.509v3 extension by OID              |
| `label.<name>`                | Certificate label value                      |
| `owner`                       | Certificate owner (team name)                |
| `contactEmail`                | Contact email for notifications              |

---

## Datasource Flow Chaining

Datasource flows allow profiles to query external data sources (LDAP, HTTP,
databases) during enrollment and feed results into computation rules.

### DataSourceFlowEntry

```json
{
  "dataSourceFlows": [
    {
      "ds": "corporate-ldap",
      "stopOnSuccess": true,
      "inputs": [
        {"key": "username", "value": "${holderid}"}
      ]
    },
    {
      "ds": "backup-ldap",
      "stopOnSuccess": false,
      "inputs": [
        {"key": "username", "value": "${holderid}"}
      ]
    }
  ]
}
```

| Field            | Type    | Description                                                           |
|------------------|---------|-----------------------------------------------------------------------|
| `ds`             | string  | Name of a configured datasource object.                               |
| `stopOnSuccess`  | boolean | If `true` and this datasource returns results, skip subsequent entries. |
| `inputs`         | array   | List of `{key, value}` pairs mapping datasource parameters to computation rules. |

**Indexed results**: Datasource results are accessed as `ds.<flowIndex>.<key>` where
`flowIndex` is 0-based (first datasource = `ds.0.*`, second = `ds.1.*`, etc.).

**Chaining logic**: Datasource flows are evaluated in order. Each flow can
populate dictionary entries that subsequent flows and computation rules can
reference. Use `stopOnSuccess: true` to implement fallback chains (try the
primary source first, fall back to secondary).

### Flow -> Computation Rule Integration

The typical pattern is:

1. **Datasource flow** queries LDAP for user attributes
2. Flow results populate entries like `ds.0.department` (0-based flow index)
3. **Computation rules** map those entries to certificate fields:
   ```json
   {
     "source": "{{ ds.0.department }}",
     "target": "subject.organizationalUnit"
   }
   ```

---

## Templates Beyond Certificate Fields

The template syntax (`{{ }}` / `[[ ]]`) is used in many places beyond
certificate templates:

| Context               | Where templates work                                    |
|-----------------------|---------------------------------------------------------|
| **Email templates**    | Subject, body, recipient addresses                     |
| **Webhook payloads**   | URL, headers, request body                             |
| **OIDC claims**        | Claim mappings from IDP tokens                         |
| **Notification rules** | Condition expressions                                 |
| **Validation rules**   | Match conditions for auto-approval                    |

All contexts share the same function library and dictionary entries, though
the available entries vary by context (e.g., email templates have access to
`certificate.*` entries that are not available during enrollment).

---

## Common Patterns

### Force uppercase CN from CSR

```json
{ "source": "{{ Upper(csr.subject.cn) }}", "target": "subject.commonName" }
```

### Default OU when CSR has none

```json
{ "source": "{{ OrElse(csr.subject.ou, \"IT Department\") }}", "target": "subject.organizationalUnit" }
```

### Extract hostname from FQDN for SAN

```json
{ "source": "{{ ShortenDNS(csr.subject.cn) }}", "target": "sans.dnsnames", "overwrite": false }
```

### Combine LDAP lookup with fallback

```json
{
  "dataSourceFlows": [
    { "ds": "primary-ldap", "stopOnSuccess": true, "inputs": [{"key": "cn", "value": "${csr.subject.cn}"}] },
    { "ds": "fallback-ldap", "stopOnSuccess": false, "inputs": [{"key": "cn", "value": "${csr.subject.cn}"}] }
  ]
}
```

### Multi-value SAN from split string

```json
{ "source": "[[ Split(http.header.x-san-list, \",\") ]]", "target": "sans.dnsnames" }
```

### Filter SANs to only .corp.com domains

```json
{ "source": "[[ Filter(csr.sans.dnsnames, \".*\\.corp\\.com$\") ]]", "target": "sans.dnsnames", "overwrite": true }
```

### Set a label from a datasource lookup

```json
{ "source": "{{ ds.0.department }}", "target": "label.department" }
```

### Conditional rule: only set OU if principal has a specific role

```json
{
  "source": "\"Security Team\"",
  "target": "subject.organizationalUnit",
  "condition": "{{ Match(Join(principal.roles, \",\"), \".*security-admin.*\") }}"
}
```

### Format a date value for use in a label

```json
{ "source": "{{ DateTimeFormat(Now(), \"yyyy-MM-dd'T'HH:mm:ss\", \"yyyy-MM-dd\") }}", "target": "label.issuedDate" }
```

### Build a JSON payload for a webhook

```json
{ "source": "{{ Concat(\"{\", \"\\\"cn\\\":\\\"\", EscapeJson(csr.subject.cn), \"\\\"}\") }}", "target": "webhook.body" }
```
