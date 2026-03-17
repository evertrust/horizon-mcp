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

### Expression Types

Functions accept different expression types depending on their signature:

| Type | Description | Examples |
|------|-------------|---------|
| **simpleExpression** | A single value: template variable, literal string, number, or keyword | `{{csr.subject.cn}}`, `"text"`, `-4`, `NOW`, `NULL` |
| **multiExpression** | A multi-value reference or a function returning a list | `[[csr.san.dnsname]]`, `Split("a.b", ".")` |
| **expression** | Either simple or multi -- any expression | Any of the above |

### Literals and Keywords

| Literal | Description |
|---------|-------------|
| `"text"` | String literal (enclosed in double quotes) |
| `-4`, `1`, `0` | Numeric literal |
| `NULL` | Explicit null value. Clears a field when used as source. |
| `NOW` | Current date/time at evaluation time. |

---

## Functions Reference

All functions are case-sensitive and use parentheses for arguments.
Arguments are separated by commas.

### Any Expression Functions (accept single or multi)

These functions accept any expression type and return accordingly.

| Function | Signature | Returns | Description | Example |
|----------|-----------|---------|-------------|---------|
| `Upper` | `Upper(expression)` | string or list | Convert to uppercase. Returns None if no value. | `Upper("string")` -> `"STRING"` |
| `Lower` | `Lower(expression)` | string or list | Convert to lowercase. Returns None if no value. | `Lower("STRING")` -> `"string"` |
| `Trim` | `Trim(expression)` | string or list | Strip leading/trailing whitespace. Returns None if no value. | `Trim(" STRING")` -> `"STRING"` |
| `Substr` | `Substr(expression, start)` or `Substr(expression, start, end)` | string or list | Extract substring by start index and optional end index (not length). | `Substr("STRING", 2)` -> `"TRING"` |
| `Concat` | `Concat(expression, ...expression)` | string | Concatenate variable number of arguments. | `Concat("start", " middle ", "end")` -> `"start middle end"` |
| `Extract` | `Extract(expression, regex)` or `Extract(expression, regex, group)` | string or list | Regex match with optional capture group number. | `Extract("user@domain", "(.*)@", 1)` -> `"user"` |
| `Replace` | `Replace(expression, regex, replacement)` | string or list | Regex substitution. | `Replace("abcdATdomain.com", "AT", "@")` -> `"abcd@domain.com"` |
| `OrElse` | `OrElse(expression, ...expression)` | string or list | Returns the first non-None result from a variable number of arguments. | `OrElse({{missing}}, "fallback")` -> `"fallback"` |

### String Functions (accept simpleExpression, return single value)

| Function | Signature | Returns | Description | Example |
|----------|-----------|---------|-------------|---------|
| `Match` | `Match(simpleExpression, regex)` | string | Returns expression if it matches regex, None otherwise. | `Match("abcd", "[a-z]+")` -> `"abcd"` |
| `DateTimeFormat` | `DateTimeFormat(simpleExpression, format)` | string | Format a date using Java DateTimeFormatter syntax. Takes a date value and an output format pattern. | `DateTimeFormat(NOW, "hh:mm:ss")` -> `"10:54:57"` |
| `Get` | `Get(multiExpression, index)` | string | Element at index from a list. Supports negative indexing. | `Get(["str1", "str2", "str3"], -2)` -> `"str2"` |
| `First` | `First(multiExpression)` | string | First element of a list. | `First(["str1", "str2"])` -> `"str1"` |
| `Last` | `Last(multiExpression)` | string | Last element of a list. | `Last(["str1", "str2"])` -> `"str2"` |
| `Join` | `Join(multiExpression, separator)` | string | Combine list elements with a delimiter. | `Join(["str1", "str2"], ".")` -> `"str1.str2"` |

### List Functions (return multi-value)

| Function | Signature | Returns | Description | Example |
|----------|-----------|---------|-------------|---------|
| `Filter` | `Filter(multiExpression, regex)` | list | Keep only items matching regex. | `Filter(["string1", "match"], "[a-z]+")` -> `["match"]` |
| `Slice` | `Slice(multiExpression, start)` or `Slice(multiExpression, start, end)` | list | Sub-list extraction. Optional end index. | `Slice(["a", "b", "c"], 1, 3)` -> `["a", "b", "c"]` |
| `Sort` | `Sort(multiExpression)` | list | Alphabetical sort. | `Sort(["b", "a"])` -> `["a", "b"]` |
| `Split` | `Split(singleExpression, separator)` | list | Divide a string into a list by separator. | `Split("str1.str2", ".")` -> `["str1", "str2"]` |

### Specialized Parsing Functions

| Function | Signature | Returns | Description | Example |
|----------|-----------|---------|-------------|---------|
| `ShortenDNS` | `ShortenDNS(singleExpression)` | string | Extract first DNS label (hostname). | `ShortenDNS("subdomain.domain.com")` -> `"subdomain"` |
| `DomainDNS` | `DomainDNS(singleExpression)` | string | Extract domain from FQDN. | `DomainDNS("subdomain.domain.com")` -> `"domain.com"` |
| `EmailUser` | `EmailUser(singleExpression)` | string | Extract username from email address. | `EmailUser("user@domain.com")` -> `"user"` |
| `EmailDomain` | `EmailDomain(singleExpression)` | string | Extract domain from email address. | `EmailDomain("user@domain.com")` -> `"domain.com"` |
| `SamAccountNameUser` | `SamAccountNameUser(singleExpression)` | string | Extract user from DOMAIN\user format. | `SamAccountNameUser("DOMAIN\\User")` -> `"User"` |
| `SamAccountNameDomain` | `SamAccountNameDomain(singleExpression)` | string | Extract domain from DOMAIN\user format. | `SamAccountNameDomain("DOMAIN\\User")` -> `"DOMAIN"` |

---

## Dictionary Entries

Computation rules and notification templates access data through **dictionary entries** --
named values organized by category. The available entries depend on the context:
either **Profile** context (computation rules during enrollment) or
**Notification** context (trigger templates).

Entries are either **Single** (one value, use `{{ }}`) or **Multi** (list, use `[[ ]]`).
Entries marked "usable in computation rules" can appear inside function calls;
entries NOT usable in computation rules can only be used as raw template variables.

---

### Context: Profile (Computation Rules During Enrollment)

These dictionaries are available when computation rules execute during certificate enrollment.

#### Principal Dictionary

Information about the authenticated user performing the request.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `principal.identifier` | Single | Yes | Authenticated user identifier |
| `principal.name` | Single | Yes | User display name |
| `principal.mail` | Single | Yes | User email address |
| `principal.provider.name` | Single | Yes | Authentication provider name |
| `principal.team` | Multi | Yes | Assigned team names |
| `principal.team.<index>` | Single | Yes | Team at specific index |
| `principal.certificate.subject.<field>` | Multi | Yes | Subject fields from user's auth certificate |
| `principal.certificate.subject.<field>.<index>` | Single | Yes | Specific subject field value by index |
| `principal.certificate.san.<type>` | Multi | Yes | SAN values from user's auth certificate |
| `principal.certificate.san.<type>.<index>` | Single | Yes | Specific SAN value by index |
| `principal.certificate.extension.<type>` | Single | Yes | Extension value from user's auth certificate |

#### CSR Dictionary

Data extracted from the Certificate Signing Request.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `csr.subject.<field>` | Multi | Yes | Subject field values (see Subject sub-dictionary) |
| `csr.subject.<field>.<index>` | Single | Yes | Subject field value at index |
| `csr.san.<type>` | Multi | Yes | SAN values by type (see SANs sub-dictionary) |
| `csr.san.<type>.<index>` | Single | Yes | SAN value at index |
| `csr.extension.<type>` | Single | Yes | Extension value (see Extensions sub-dictionary) |

#### HTTP Request Dictionary

Information about the HTTP request that triggered the enrollment.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `http.request.ip` | Single | Yes | Client IP address |
| `http.request.method` | Single | Yes | HTTP method (GET, POST, etc.) |
| `http.request.path` | Single | Yes | Request path |
| `http.request.host` | Single | Yes | Request host |
| `http.request.header.<name>` | Multi | Yes | Values of the named HTTP request header |

#### WebRA Enrollment Dictionary

Values submitted through the WebRA enrollment form.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `webra.enroll.subject.<field>` | Multi | Yes | Subject field values from WebRA form |
| `webra.enroll.subject.<field>.<index>` | Single | Yes | Subject field value at index |
| `webra.enroll.san.<type>` | Multi | Yes | SAN values from WebRA form |
| `webra.enroll.san.<type>.<index>` | Single | Yes | SAN value at index |
| `webra.enroll.extension.<type>` | Single | Yes | Extension value from WebRA form |
| `webra.enroll.label.<name>` | Single | Yes | Label value from WebRA form |
| `webra.enroll.metadata.<name>` | Single | Yes | Metadata value from WebRA form |
| `webra.enroll.mail` | Single | Yes | Contact email from WebRA form |
| `webra.enroll.owner` | Single | Yes | Owner from WebRA form |
| `webra.enroll.team` | Single | Yes | Team from WebRA form |

#### EST Enrollment Dictionary

Same structure as WebRA, with prefix `est.enroll.*`.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `est.enroll.subject.<field>` | Multi | Yes | Subject field values from EST enrollment |
| `est.enroll.subject.<field>.<index>` | Single | Yes | Subject field value at index |
| `est.enroll.san.<type>` | Multi | Yes | SAN values from EST enrollment |
| `est.enroll.san.<type>.<index>` | Single | Yes | SAN value at index |
| `est.enroll.extension.<type>` | Single | Yes | Extension value from EST enrollment |
| `est.enroll.label.<name>` | Single | Yes | Label value from EST enrollment |
| `est.enroll.metadata.<name>` | Single | Yes | Metadata value from EST enrollment |
| `est.enroll.mail` | Single | Yes | Contact email from EST enrollment |
| `est.enroll.owner` | Single | Yes | Owner from EST enrollment |
| `est.enroll.team` | Single | Yes | Team from EST enrollment |

#### SCEP Enrollment Dictionary

Same structure as WebRA, with prefix `scep.enroll.*`.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `scep.enroll.subject.<field>` | Multi | Yes | Subject field values from SCEP enrollment |
| `scep.enroll.subject.<field>.<index>` | Single | Yes | Subject field value at index |
| `scep.enroll.san.<type>` | Multi | Yes | SAN values from SCEP enrollment |
| `scep.enroll.san.<type>.<index>` | Single | Yes | SAN value at index |
| `scep.enroll.extension.<type>` | Single | Yes | Extension value from SCEP enrollment |
| `scep.enroll.label.<name>` | Single | Yes | Label value from SCEP enrollment |
| `scep.enroll.metadata.<name>` | Single | Yes | Metadata value from SCEP enrollment |
| `scep.enroll.mail` | Single | Yes | Contact email from SCEP enrollment |
| `scep.enroll.owner` | Single | Yes | Owner from SCEP enrollment |
| `scep.enroll.team` | Single | Yes | Team from SCEP enrollment |

#### CRMP Enrollment Dictionary

Same structure as WebRA, with prefix `crmp.enroll.*`.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `crmp.enroll.subject.<field>` | Multi | Yes | Subject field values from CRMP enrollment |
| `crmp.enroll.subject.<field>.<index>` | Single | Yes | Subject field value at index |
| `crmp.enroll.san.<type>` | Multi | Yes | SAN values from CRMP enrollment |
| `crmp.enroll.san.<type>.<index>` | Single | Yes | SAN value at index |
| `crmp.enroll.extension.<type>` | Single | Yes | Extension value from CRMP enrollment |
| `crmp.enroll.label.<name>` | Single | Yes | Label value from CRMP enrollment |
| `crmp.enroll.metadata.<name>` | Single | Yes | Metadata value from CRMP enrollment |
| `crmp.enroll.mail` | Single | Yes | Contact email from CRMP enrollment |
| `crmp.enroll.owner` | Single | Yes | Owner from CRMP enrollment |
| `crmp.enroll.team` | Single | Yes | Team from CRMP enrollment |

#### ACME Order Dictionary

Values from the ACME order.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `acme.order.initialip` | Single | Yes | IP address of the ACME client |
| `acme.order.label.<name>` | Single | Yes | Label value from ACME order |
| `acme.order.metadata.<name>` | Single | Yes | Metadata value from ACME order |
| `acme.order.mail` | Single | Yes | Contact email from ACME order |
| `acme.order.owner` | Single | Yes | Owner from ACME order |
| `acme.order.team` | Single | Yes | Team from ACME order |

#### ACME Account Dictionary

Values from the ACME account.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `acme.account.initialip` | Single | Yes | IP address of the ACME account |
| `acme.account.contact.<index>` | Single | Yes | Contact at specific index |

#### WCCE Caller Identity Dictionary

Identity information from Windows Certificate Connector for Entra (WCCE).

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `calleridentity.dn` | Single | Yes | Full distinguished name |
| `calleridentity.cn` | Single | Yes | Common name |
| `calleridentity.msguid` | Single | Yes | Microsoft GUID |
| `calleridentity.msupn` | Single | Yes | Microsoft UPN |
| `calleridentity.c` | Single | Yes | Country |
| `calleridentity.company` | Single | Yes | Company |
| `calleridentity.department` | Single | Yes | Department |
| `calleridentity.description` | Single | Yes | Description |
| `calleridentity.displayname` | Single | Yes | Display name |
| `calleridentity.dnshostname` | Single | Yes | DNS hostname |
| `calleridentity.employeeid` | Single | Yes | Employee ID |
| `calleridentity.employeenumber` | Single | Yes | Employee number |
| `calleridentity.mail` | Single | Yes | Email address |
| `calleridentity.o` | Single | Yes | Organization |
| `calleridentity.ou` | Single | Yes | Organizational unit |
| `calleridentity.samaccountname` | Single | Yes | SAM account name |
| `calleridentity.serialnumber` | Single | Yes | Serial number |
| `calleridentity.sn` | Single | Yes | Surname |
| `calleridentity.title` | Single | Yes | Title |
| `calleridentity.uid` | Single | Yes | User ID |
| `calleridentity.sid` | Single | Yes | Security identifier |
| `calleridentity.subject.<field>` | Multi | Yes | Subject sub-dictionary fields |
| `calleridentity.subject.<field>.<index>` | Single | Yes | Subject field value at index |

#### URL Parameters Dictionary

Values passed via URL parameters during enrollment.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `url.enroll.label.<name>` | Single | Yes | Label value from URL parameter |
| `url.enroll.metadata.<name>` | Single | Yes | Metadata value from URL parameter |
| `url.enroll.mail` | Single | Yes | Contact email from URL parameter |
| `url.enroll.owner` | Single | Yes | Owner from URL parameter |
| `url.enroll.team` | Single | Yes | Team from URL parameter |

---

### Context: Notifications (Trigger Templates)

These dictionaries are available in notification trigger templates (email, webhook, etc.).
The available entries depend on the trigger event.

#### Certificate Dictionary

**Available for events:** `on_enroll`, `on_revoke`, `on_update`, `on_recover`, `on_migrate`, `on_expire`, `on_renew`

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `certificate.id` | Single | Yes | Certificate unique identifier |
| `certificate.module` | Single | Yes | Module name |
| `certificate.not_after` | Single | Yes | Expiration date |
| `certificate.not_before` | Single | Yes | Start of validity date |
| `certificate.serial` | Single | Yes | Serial number |
| `certificate.thumbprint` | Single | Yes | Certificate thumbprint (SHA-1 fingerprint) |
| `certificate.public_key_thumbprint` | Single | Yes | Public key thumbprint |
| `certificate.revoked` | Single | Yes | Revocation status |
| `certificate.key_type` | Single | Yes | Key type (RSA, EC, etc.) |
| `certificate.signing_algorithm` | Single | Yes | Signing algorithm |
| `certificate.holder_id` | Single | Yes | Holder identifier |
| `certificate.friendly_name` | Single | Yes | Friendly name |
| `certificate.pem` | Single | Yes | PEM-encoded certificate |
| `certificate.profile` | Single | Yes | Profile name |
| `certificate.revocation_date` | Single | Yes | Revocation date (if revoked) |
| `certificate.revocation_reason` | Single | Yes | Revocation reason (if revoked) |
| `certificate.mail` | Single | Yes | Contact email |
| `certificate.owner` | Single | Yes | Owner |
| `certificate.issuer` | Single | No | Issuer DN (not usable in computation rules) |
| `certificate.dn` | Single | No | Subject DN (not usable in computation rules) |
| `certificate.sans` | Single | No | SANs (not usable in computation rules) |
| `certificate.extensions` | Single | No | Extensions (not usable in computation rules) |
| `certificate.metadata` | Single | No | All metadata (not usable in computation rules) |
| `certificate.metadata.<name>` | Single | Yes | Specific metadata value by name |
| `certificate.subject.<field>` | Multi | Yes | Subject sub-dictionary |
| `certificate.subject.<field>.<index>` | Single | Yes | Subject field value at index |
| `certificate.san.<type>` | Multi | Yes | SANs sub-dictionary |
| `certificate.san.<type>.<index>` | Single | Yes | SAN value at index |
| `certificate.extension.<type>` | Single | Yes | Extensions sub-dictionary |
| `certificate.label.<name>` | Single | Yes | Labels sub-dictionary |
| `certificate.team` | Single | Yes | Team value |
| `certificate.team.displaynames` | Single | No | Team display names |
| `certificate.team.descriptions` | Single | No | Team descriptions |
| `certificate.team.displayname.<lang>` | Single | No | Team display name in language |
| `certificate.team.description.<lang>` | Single | No | Team description in language |

#### Request Dictionary

**Available for events:** `on_submit_enroll`, `on_cancel_enroll`, `on_approve_enroll`, `on_deny_enroll`, `on_pending_enroll`, and equivalent events for `revoke`, `update`, `recover`, `migrate`, `renew`.

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `request.id` | Single | Yes | Request unique identifier |
| `request.workflow` | Single | Yes | Workflow name |
| `request.module` | Single | Yes | Module name |
| `request.status` | Single | Yes | Request status |
| `request.profile` | Single | Yes | Profile name |
| `request.requester` | Single | Yes | Requester identifier |
| `request.approver` | Single | Yes | Approver identifier |
| `request.requester_comment` | Single | Yes | Requester comment |
| `request.approver_comment` | Single | Yes | Approver comment |
| `request.registration_date` | Single | Yes | Registration date |
| `request.last_modification_date` | Single | Yes | Last modification date |
| `request.password` | Single | Yes | Request password |
| `request.mail` | Single | Yes | Contact email |
| `request.owner` | Single | Yes | Owner |
| `request.my.url` | Single | No | URL for requester view (not usable in computation rules) |
| `request.manage.url` | Single | No | URL for management view (not usable in computation rules) |
| `request.dn` | Single | No | Subject DN (not usable in computation rules) |
| `request.sans` | Single | No | SANs (not usable in computation rules) |
| `request.extensions` | Single | No | Extensions (not usable in computation rules) |
| `request.metadata` | Single | No | All metadata (not usable in computation rules) |
| `request.labels` | Single | No | All labels (not usable in computation rules) |
| `request.metadata.<name>` | Single | Yes | Specific metadata value by name |
| `request.subject.<field>` | Multi | Yes | Subject sub-dictionary |
| `request.subject.<field>.<index>` | Single | Yes | Subject field value at index |
| `request.san.<type>` | Multi | Yes | SANs sub-dictionary |
| `request.san.<type>.<index>` | Single | Yes | SAN value at index |
| `request.extension.<type>` | Single | Yes | Extensions sub-dictionary |
| `request.label.<name>` | Single | Yes | Labels sub-dictionary |
| `request.certificate.*` | -- | -- | Same structure as Certificate dictionary (embedded) |
| `request.team` | Single | Yes | Team value |
| `request.team.displaynames` | Single | No | Team display names |
| `request.team.descriptions` | Single | No | Team descriptions |
| `request.team.displayname.<lang>` | Single | No | Team display name in language |
| `request.team.description.<lang>` | Single | No | Team description in language |

#### Previous Certificate Dictionary

**Available for event:** `on_renew` only

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `previous.certificate.*` | -- | -- | Same complete structure as the Certificate dictionary above |

#### Credentials Dictionary

**Available for event:** `on_credentials_expiration`

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `credentials.name` | Single | Yes | Credential name |
| `credentials.description` | Single | Yes | Credential description |
| `credentials.type` | Single | Yes | Credential type |
| `credentials.expiration_date` | Single | Yes | Expiration date |

#### Profile Dictionary

**Available in:** all notification contexts

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `profile.name` | Single | Yes | Profile name |
| `profile.module` | Single | Yes | Module name |
| `profile.displaynames` | Single | No | All display names (not usable in computation rules) |
| `profile.descriptions` | Single | No | All descriptions (not usable in computation rules) |
| `profile.<name>.displayname.<lang>` | Single | No | Display name in language (not usable in computation rules) |
| `profile.<name>.description.<lang>` | Single | No | Description in language (not usable in computation rules) |

#### License Dictionary

**Available for events:** `on_license_expiration`, `on_license_usage`

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `license.expiration_date` | Single | Yes | License expiration date |
| `license.used` | Single | Yes | Number of licenses used |
| `license.percent_used` | Single | Yes | Percentage of licenses used |

#### Failed Trigger Dictionary

**Available for event:** `on_trigger_error`

| Entry | Type | Computation Rule | Description |
|-------|------|-----------------|-------------|
| `trigger.name` | Single | Yes | Trigger name |
| `trigger.event` | Single | Yes | Trigger event type |
| `trigger.lastExecutionDate` | Single | Yes | Last execution date |
| `trigger.status` | Single | Yes | Trigger status |
| `trigger.retryable` | Single | Yes | Whether the trigger can be retried |
| `trigger.type` | Single | Yes | Trigger type |
| `trigger.retries` | Single | Yes | Number of retries attempted |
| `trigger.nextExecutionDate` | Single | Yes | Next scheduled execution date |
| `trigger.nextDelay` | Single | Yes | Delay before next retry |
| `trigger.detail` | Single | Yes | Error detail message |

---

### Sub-dictionaries Reference

These sub-dictionaries are used across multiple parent dictionaries (csr, certificate, request, webra.enroll, etc.).

#### Subject Sub-dictionary

Valid field names for `<parent>.subject.<field>`:

| Field | Description |
|-------|-------------|
| `cn` | Common Name |
| `uid` | User ID |
| `serialnumber` | Serial Number |
| `surname` | Surname |
| `givenname` | Given Name |
| `unstructuredaddress` | Unstructured Address |
| `unstructuredname` | Unstructured Name |
| `e` | Email Address |
| `ou` | Organizational Unit |
| `organizationidentifier` | Organization Identifier |
| `uniqueidentifier` | Unique Identifier |
| `street` | Street Address |
| `st` | State or Province |
| `l` | Locality |
| `o` | Organization |
| `c` | Country |
| `description` | Description |
| `dc` | Domain Component |

**Access patterns:**
- `<parent>.subject.<field>` -- Multi-value (all values for that field)
- `<parent>.subject.<field>.<index>` -- Single value at index

#### SANs Sub-dictionary

Valid type names for `<parent>.san.<type>`:

| Type | Description |
|------|-------------|
| `rfc822name` | Email address |
| `dnsname` | DNS name |
| `uri` | Uniform Resource Identifier |
| `ipaddress` | IP address |
| `othername_upn` | OtherName UPN |
| `othername_guid` | OtherName GUID |
| `registered_id` | Registered ID |

**Access patterns:**
- `<parent>.san.<type>` -- Multi-value (all values for that SAN type)
- `<parent>.san.<type>.<index>` -- Single value at index

#### Extensions Sub-dictionary

Valid type names for `<parent>.extension.<type>`:

| Type | Description |
|------|-------------|
| `ms_sid` | Microsoft Security Identifier |
| `ms_template` | Microsoft Certificate Template |
| `ms_template_v2` | Microsoft Certificate Template v2 |

**Access pattern:**
- `<parent>.extension.<type>` -- Single value

#### Labels Sub-dictionary

Labels are identified by name (configured per profile).

**Access patterns:**
- `<parent>.label.<name>` -- Single value (usable in computation rules)
- `<parent>.label.<name>.displaynames` -- All display names (not usable in computation rules)
- `<parent>.label.<name>.descriptions` -- All descriptions (not usable in computation rules)
- `<parent>.label.<name>.displayname.<lang>` -- Display name in language (not usable in computation rules)
- `<parent>.label.<name>.description.<lang>` -- Description in language (not usable in computation rules)

#### Team Sub-dictionary

**Access patterns:**
- `<parent>.team` -- Single value (usable in computation rules)
- `<parent>.team.displaynames` -- All display names (not usable in computation rules)
- `<parent>.team.descriptions` -- All descriptions (not usable in computation rules)
- `<parent>.team.displayname.<lang>` -- Display name in language (not usable in computation rules)
- `<parent>.team.description.<lang>` -- Description in language (not usable in computation rules)

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
{ "source": "[[ Split(http.request.header.x-san-list, \",\") ]]", "target": "sans.dnsnames" }
```

### Filter SANs to only .corp.com domains

```json
{ "source": "[[ Filter(csr.san.dnsname, \".*\\.corp\\.com$\") ]]", "target": "sans.dnsnames", "overwrite": true }
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
  "condition": "{{ Match(Join(principal.team, \",\"), \".*security-admin.*\") }}"
}
```

### Format current date for a label

```json
{ "source": "{{ DateTimeFormat(NOW, \"yyyy-MM-dd\") }}", "target": "label.issuedDate" }
```

### Extract username from email in CSR subject

```json
{ "source": "{{ EmailUser(csr.subject.e) }}", "target": "label.username" }
```

### Use OrElse with multiple fallbacks

```json
{ "source": "{{ OrElse(webra.enroll.mail, principal.mail, \"default@corp.com\") }}", "target": "contactEmail" }
```

### Extract regex capture group from CN

```json
{ "source": "{{ Extract(csr.subject.cn, \"^([a-z]+)-\", 1) }}", "target": "label.environment" }
```

### Get domain from first DNS SAN

```json
{ "source": "{{ DomainDNS(First(csr.san.dnsname)) }}", "target": "label.domain" }
```

### Sort and join SANs for display

```json
{ "source": "{{ Join(Sort(csr.san.dnsname), \", \") }}", "target": "label.allSans" }
```

### Set owner from WCCE caller identity

```json
{ "source": "{{ calleridentity.samaccountname }}", "target": "owner" }
```

### Map ACME account contact to certificate email

```json
{ "source": "{{ acme.account.contact.0 }}", "target": "contactEmail" }
```

---

## Advanced Multi-Rule Patterns

These patterns require **multiple computation rules executed in order**.
Rules execute sequentially — later rules can reference values set by earlier ones.

### Ensure CN is present in DNS SANs (no duplication)

Goal: if the CSR's CN is already a DNS SAN, keep SANs as-is. If not, add the
CN as an extra DNS SAN. This prevents duplication while guaranteeing coverage.

**Strategy:** Use two rules. Rule 1 copies all existing DNS SANs from the CSR.
Rule 2 adds the CN with `overwrite: false` so it only appends if not already
present. The `[[ ]]` multi-value syntax ensures lists are handled correctly.

```json
[
  {
    "source": "[[ csr.san.dnsname ]]",
    "target": "sans.dnsnames",
    "overwrite": true
  },
  {
    "source": "{{ csr.subject.cn }}",
    "target": "sans.dnsnames",
    "condition": "{{ csr.subject.cn }}",
    "overwrite": false
  }
]
```

**How it works:**
1. Rule 1 copies all DNS SANs from the CSR (overwrites any existing value)
2. Rule 2 adds the CN to `sans.dnsnames` with `overwrite: false` — if the CN
   is already in the list (because the CSR included it as a SAN), this is a
   no-op. If the CN was missing from the SANs, it gets appended.

### Always add parent domain as DNS SAN (LDAPS compatibility)

Goal: for a certificate with CN `machine.domain.local`, automatically add
`domain.local` as a DNS SAN. This enables LDAPS connectivity to Active
Directory domain controllers, which require the domain name in the cert SANs.

**Strategy:** Use `DomainDNS` to extract the parent domain from the CN, then
add it to DNS SANs with `overwrite: false` to avoid replacing existing SANs.

```json
[
  {
    "source": "[[ csr.san.dnsname ]]",
    "target": "sans.dnsnames",
    "overwrite": true
  },
  {
    "source": "{{ csr.subject.cn }}",
    "target": "sans.dnsnames",
    "condition": "{{ csr.subject.cn }}",
    "overwrite": false
  },
  {
    "source": "{{ DomainDNS(csr.subject.cn) }}",
    "target": "sans.dnsnames",
    "condition": "{{ DomainDNS(csr.subject.cn) }}",
    "overwrite": false
  }
]
```

**How it works:**
1. Rule 1 copies all existing DNS SANs from the CSR
2. Rule 2 adds the CN if missing (same pattern as above)
3. Rule 3 extracts the parent domain (`DomainDNS("machine.domain.local")`
   → `"domain.local"`) and adds it if not already present

For `CN=dc01.corp.example.com`, the resulting DNS SANs would include:
- All original SANs from the CSR
- `dc01.corp.example.com` (the CN, if not already a SAN)
- `corp.example.com` (the parent domain, for LDAPS)

### Combine CN, hostname, and domain in SANs

Goal: ensure the certificate has the FQDN, short hostname, and parent domain
all present as DNS SANs — common for web servers and domain controllers.

```json
[
  {
    "source": "[[ csr.san.dnsname ]]",
    "target": "sans.dnsnames",
    "overwrite": true
  },
  {
    "source": "{{ csr.subject.cn }}",
    "target": "sans.dnsnames",
    "overwrite": false
  },
  {
    "source": "{{ ShortenDNS(csr.subject.cn) }}",
    "target": "sans.dnsnames",
    "condition": "{{ ShortenDNS(csr.subject.cn) }}",
    "overwrite": false
  },
  {
    "source": "{{ DomainDNS(csr.subject.cn) }}",
    "target": "sans.dnsnames",
    "condition": "{{ DomainDNS(csr.subject.cn) }}",
    "overwrite": false
  }
]
```

For `CN=web01.corp.example.com`, resulting DNS SANs:
`web01.corp.example.com`, `web01`, `corp.example.com` + original CSR SANs

### Key principle: `overwrite: false` for list accumulation

When the target is a multi-value field (like `sans.dnsnames`), setting
`overwrite: false` **appends** to the existing list rather than replacing it.
Combined with ordered rules, this enables building up a SAN list incrementally
from multiple sources without losing any values.
