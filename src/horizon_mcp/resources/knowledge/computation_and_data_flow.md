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

## Two Expression Types

Horizon has two distinct expression types. Understanding the difference is
critical for the `simulate_computation_rule` tool and for profile configuration.

### Computation Rules

A **computation rule** is a full expression with functions. Used in profile
certificate templates to compute field values (subject, SANs, labels, owner).

- Dictionary lookups use `{{key}}` syntax: `{{csr.subject.cn}}`
- Multi-value lookups use `[[key]]` syntax: `[[csr.san.dnsname]]`
- Functions wrap around dictionary lookups: `Upper({{cn}})`, `DomainDNS({{fqdn}})`
- Functions can be nested: `Concat(OrElse({{prefix}}, "default"), "-", {{name}})`
- The expression itself is NOT wrapped in `{{ }}`

**Examples of computation rules:**
```
Upper({{csr.subject.cn}})                              → "MYSERVER.EXAMPLE.COM"
DomainDNS({{csr.subject.cn}})                          → "example.com"
Concat({{csr.subject.cn}}, ".", {{csr.subject.o}})     → "myserver.example.com.MyOrg"
OrElse({{csr.subject.ou}}, "Default")                  → "Default" (if ou is empty)
Extract({{email}}, "(.*)@", 1)                         → "user" (from "user@domain.com")
```

When using `simulate_computation_rule` with `mode="computation_rule"` (default),
pass the expression directly: `rule="Upper({{cn}})"`.

### Template Strings

A **template string** is free text with embedded `{{ }}` placeholders. Used in
email templates, webhook URLs, notification bodies, REST API call payloads.

- The text around `{{ }}` is preserved as-is
- Simple variables: `{{key}}` resolves to the dictionary value
- **Functions work inside `{{ }}`**: `{{Upper({{cn}})}}` — note the nested braces
- Multi-value: `[[key]]` resolves to all values

**Examples of template strings:**
```
"Hello {{principal.name}}, your cert expires on {{certificate.not_after}}"
"key={{credential.raw}}&cmd={{OrElse(Concat("commit", {{label.stack}}), "show")}}"
"https://api.example.com/v1/{{certificate.serial}}"
"web-{{csr.subject.cn}}-{{principal.name}}"  →  "web-myserver.example.com-jdoe"
```

When using `simulate_computation_rule` with `mode="template_string"`,
pass the full text: `rule="Hello {{Upper({{cn}})}}"`.

### Key Difference

| Aspect | Computation Rule | Template String |
|--------|-----------------|-----------------|
| **Purpose** | Compute a single field value | Build a text string with embedded values |
| **Outer wrapper** | None — bare expression | Free text around `{{ }}` blocks |
| **Function syntax** | `Upper({{key}})` | `{{Upper({{key}})}}` |
| **Multi-value** | `[[key]]` returns list | `[[key]]` returns comma-separated |
| **API field** | `computationRule` | `templateString` |
| **Profile usage** | Certificate template `source` field | Email/webhook/notification templates |

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

## How to Build Computation Rules — Decision Guide

When asked to create computation rules, follow this reasoning process:

### Step 1: Identify the goal

| Goal type | Approach |
|-----------|----------|
| Transform a single field value | One rule: `source` = function expression, `target` = field |
| Set a field with fallback | One rule: `OrElse(primary, fallback)` |
| Conditionally set a field | One rule with `condition` — rule only fires when condition resolves non-empty |
| Build up a multi-value list (SANs) | Multiple rules in sequence, each with `overwrite: false` to append |
| Enforce naming policy | Rule with `overwrite: true` to force computed value |
| Enrich from external data | Datasource flow first, then rules referencing `ds.0.*` results |

### Step 2: Choose between `overwrite: true` and `overwrite: false`

| Behavior | When to use |
|----------|-------------|
| `overwrite: true` | Enforce a policy — the computed value always wins, regardless of what the CSR contains |
| `overwrite: false` (default) | Augment — add the computed value only if the field is currently empty or the value is not already in the list |

For multi-value fields like `sans.dnsnames`, `overwrite: false` **appends** to
the existing list. Combined with ordered rules, this enables building up a SAN
list incrementally from multiple sources without losing any values.

### Step 3: Order rules correctly

Rules execute **in order**. Later rules can reference values set by earlier rules.
For list accumulation patterns:
1. First rule: copy existing values from CSR (`overwrite: true` to initialize)
2. Subsequent rules: add computed values (`overwrite: false` to append)

### Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| Function call returns raw template text | You're using `templateString` mode — switch to `computationRule` mode, or use `{{Function({{key}})}}` syntax inside template strings |
| SAN list gets overwritten instead of appended | Use `overwrite: false` for all rules after the first |
| Rule fires when source is empty | Add a `condition` that mirrors the source expression — prevents setting empty values |
| Multi-value target only gets one value | Use `[[ ]]` syntax for the source: `[[ csr.san.dnsname ]]` not `{{ csr.san.dnsname }}` |
| LDAP lookup results are empty | Check datasource flow `inputs` mapping — key must match the datasource's expected parameter name |

---

## Real-World PKI Patterns

Organized by certificate use case, from simple to complex. Each pattern includes
the **business requirement**, the **computation rules**, and an explanation of
**why** each rule is structured the way it is.

### TLS Server Certificate — Basic Web Server

**Requirement:** Internal web servers get certificates with:
- CN forced to lowercase FQDN
- Organization and OU from corporate policy (not from CSR)
- DNS SANs preserved from CSR
- Contact email from the requesting user

```json
[
  { "source": "Lower({{csr.subject.cn}})", "target": "subject.commonName", "overwrite": true },
  { "source": "\"Acme Corp\"", "target": "subject.organization", "overwrite": true },
  { "source": "\"IT Infrastructure\"", "target": "subject.organizationalUnit", "overwrite": true },
  { "source": "[[ csr.san.dnsname ]]", "target": "sans.dnsnames", "overwrite": true },
  { "source": "OrElse({{webra.enroll.mail}}, {{principal.mail}})", "target": "contactEmail" }
]
```

**Why:** `overwrite: true` on subject fields enforces corporate naming policy
regardless of what the CSR contains. DNS SANs are preserved as-is from the CSR.
The contact email falls back to the authenticated user's email if not provided.

### TLS Server Certificate — Ensure CN in DNS SANs

**Requirement:** Some TLS clients (notably older Java and .NET) require the
server's FQDN to appear in the DNS SANs, not just the CN. Ensure the CN is
always present as a DNS SAN without duplicating it if it's already there.

```json
[
  { "source": "[[ csr.san.dnsname ]]", "target": "sans.dnsnames", "overwrite": true },
  {
    "source": "{{csr.subject.cn}}",
    "target": "sans.dnsnames",
    "condition": "{{csr.subject.cn}}",
    "overwrite": false
  }
]
```

**Why:** Rule 1 copies all DNS SANs from the CSR. Rule 2 adds the CN with
`overwrite: false` — if the CN is already in the list (because the CSR
included it as a SAN), this is a no-op. If the CN was missing, it gets
appended. The `condition` prevents adding an empty value if the CN is unset.

### TLS Server Certificate — Domain Controller (LDAPS)

**Requirement:** Active Directory domain controllers need the **parent domain**
as a DNS SAN for LDAPS connectivity. For `dc01.corp.example.com`, the cert
must include `corp.example.com` as a SAN so that LDAP clients connecting to
`ldaps://corp.example.com:636` can validate the certificate.

```json
[
  { "source": "[[ csr.san.dnsname ]]", "target": "sans.dnsnames", "overwrite": true },
  {
    "source": "{{csr.subject.cn}}",
    "target": "sans.dnsnames",
    "condition": "{{csr.subject.cn}}",
    "overwrite": false
  },
  {
    "source": "DomainDNS({{csr.subject.cn}})",
    "target": "sans.dnsnames",
    "condition": "DomainDNS({{csr.subject.cn}})",
    "overwrite": false
  }
]
```

**Result for `CN=dc01.corp.example.com`:**
- DNS SANs: all from CSR + `dc01.corp.example.com` + `corp.example.com`

**Why:** `DomainDNS("dc01.corp.example.com")` extracts `"corp.example.com"`.
The `overwrite: false` ensures no duplication. The `condition` mirrors the
source so the rule is skipped if the CN doesn't contain a domain part.

### TLS Server Certificate — Full SAN Expansion (FQDN + hostname + domain)

**Requirement:** Some environments need the certificate to contain all three
forms: the FQDN, the short hostname, and the parent domain. Common for servers
that are accessed by different names depending on context (FQDN from DNS,
hostname from local network, domain for service discovery).

```json
[
  { "source": "[[ csr.san.dnsname ]]", "target": "sans.dnsnames", "overwrite": true },
  { "source": "{{csr.subject.cn}}", "target": "sans.dnsnames", "overwrite": false },
  {
    "source": "ShortenDNS({{csr.subject.cn}})",
    "target": "sans.dnsnames",
    "condition": "ShortenDNS({{csr.subject.cn}})",
    "overwrite": false
  },
  {
    "source": "DomainDNS({{csr.subject.cn}})",
    "target": "sans.dnsnames",
    "condition": "DomainDNS({{csr.subject.cn}})",
    "overwrite": false
  }
]
```

**Result for `CN=web01.corp.example.com`:**
- DNS SANs: original CSR SANs + `web01.corp.example.com` + `web01` + `corp.example.com`

### TLS Server Certificate — SAN Restriction (Security Policy)

**Requirement:** Only allow DNS SANs within the corporate domain. Reject or
strip SANs pointing to external domains. This prevents a server from getting a
cert valid for `evil.com` through an internal CA.

```json
[
  {
    "source": "[[ Filter(csr.san.dnsname, \".*\\.corp\\.example\\.com$\") ]]",
    "target": "sans.dnsnames",
    "overwrite": true
  }
]
```

**Why:** `Filter` with a regex keeps only SANs matching `*.corp.example.com`.
`overwrite: true` replaces whatever the CSR requested with only the allowed SANs.
External SANs like `evil.com` or `other.example.net` are silently dropped.

### TLS Client Certificate — User Identity from LDAP

**Requirement:** Enrich client certificates with user attributes from
corporate LDAP. The CN comes from the CSR, but the organization, department,
and email are looked up in LDAP using the requesting user's identifier.

**Datasource flow:**
```json
{
  "dataSourceFlows": [
    {
      "ds": "corporate-ldap",
      "stopOnSuccess": true,
      "inputs": [{"key": "uid", "value": "${principal.identifier}"}]
    }
  ]
}
```

**Computation rules:**
```json
[
  { "source": "{{csr.subject.cn}}", "target": "subject.commonName" },
  { "source": "OrElse({{ds.0.o}}, \"Acme Corp\")", "target": "subject.organization" },
  { "source": "{{ds.0.department}}", "target": "subject.organizationalUnit", "condition": "{{ds.0.department}}" },
  { "source": "{{ds.0.mail}}", "target": "sans.rfc822names", "condition": "{{ds.0.mail}}" },
  { "source": "OrElse({{ds.0.mail}}, {{principal.mail}})", "target": "contactEmail" },
  { "source": "{{ds.0.department}}", "target": "label.department", "condition": "{{ds.0.department}}" }
]
```

**Why:** The datasource flow runs first, querying LDAP with the authenticated
user's ID. Results populate `ds.0.*` entries. Computation rules then map those
values into certificate fields. `OrElse` provides fallbacks. The `condition`
on OU and email prevents setting empty values if the LDAP lookup returned
nothing for those attributes.

### TLS Client Certificate — Smart Card / PIV

**Requirement:** Smart card certificates need the UPN (User Principal Name) as
an `otherName` SAN, the user's email as an RFC822 SAN, and the CN in
`LastName.FirstName` format derived from LDAP attributes.

**Datasource flow:**
```json
{
  "dataSourceFlows": [
    {
      "ds": "corporate-ldap",
      "stopOnSuccess": true,
      "inputs": [{"key": "uid", "value": "${principal.identifier}"}]
    }
  ]
}
```

**Computation rules:**
```json
[
  {
    "source": "Concat({{ds.0.sn}}, \".\", {{ds.0.givenName}})",
    "target": "subject.commonName",
    "condition": "{{ds.0.sn}}"
  },
  { "source": "{{ds.0.mail}}", "target": "sans.rfc822names", "condition": "{{ds.0.mail}}" },
  { "source": "{{ds.0.userPrincipalName}}", "target": "sans.othername_upn", "condition": "{{ds.0.userPrincipalName}}" },
  { "source": "OrElse({{ds.0.o}}, \"Acme Corp\")", "target": "subject.organization" },
  { "source": "{{ds.0.department}}", "target": "subject.organizationalUnit", "condition": "{{ds.0.department}}" },
  { "source": "{{ds.0.mail}}", "target": "contactEmail", "condition": "{{ds.0.mail}}" }
]
```

### ACME Certificate — Contact Email Mapping

**Requirement:** ACME certificates should set the contact email from the ACME
account's contact information, and tag the certificate with the requesting
IP for audit.

```json
[
  { "source": "{{acme.account.contact.0}}", "target": "contactEmail", "condition": "{{acme.account.contact.0}}" },
  { "source": "{{acme.order.initialip}}", "target": "label.requestingIP", "condition": "{{acme.order.initialip}}" }
]
```

### EST Certificate — Mutual TLS Renewal

**Requirement:** EST re-enrollment uses mutual TLS. Copy the authenticated
client certificate's CN to the new certificate's CN, and preserve the original
subject organization. This ensures certificate continuity during renewal.

```json
[
  { "source": "{{principal.certificate.subject.cn}}", "target": "subject.commonName", "condition": "{{principal.certificate.subject.cn}}" },
  { "source": "{{principal.certificate.subject.o}}", "target": "subject.organization", "condition": "{{principal.certificate.subject.o}}" },
  { "source": "[[ csr.san.dnsname ]]", "target": "sans.dnsnames" }
]
```

**Why:** During EST re-enrollment, `principal.certificate.*` contains the
attributes from the existing (expiring) client certificate used for mTLS
authentication. This copies them to the new certificate.

### SCEP Certificate — Device Identity with LDAP Enrichment

**Requirement:** SCEP device certificates (e.g., for network equipment, printers)
should map the SCEP challenge to a device identity, look up the device in LDAP,
and populate the certificate with the device's assigned department and location.

**Datasource flow:**
```json
{
  "dataSourceFlows": [
    {
      "ds": "device-inventory-ldap",
      "stopOnSuccess": true,
      "inputs": [{"key": "cn", "value": "${csr.subject.cn}"}]
    }
  ]
}
```

**Computation rules:**
```json
[
  { "source": "Lower({{csr.subject.cn}})", "target": "subject.commonName", "overwrite": true },
  { "source": "OrElse({{ds.0.l}}, \"Unknown Site\")", "target": "subject.locality" },
  { "source": "OrElse({{ds.0.department}}, \"IT\")", "target": "subject.organizationalUnit" },
  { "source": "\"Acme Corp\"", "target": "subject.organization", "overwrite": true },
  { "source": "{{ds.0.managedBy}}", "target": "contactEmail", "condition": "{{ds.0.managedBy}}" },
  { "source": "{{ds.0.location}}", "target": "label.site", "condition": "{{ds.0.location}}" }
]
```

### WCCE Certificate — Active Directory User Mapping

**Requirement:** Windows Certificate Client Enrollment (WCCE) certificates
should map the caller's Active Directory identity to certificate fields.
The caller identity is provided by the WCCE connector from the AD account.

```json
[
  { "source": "{{calleridentity.cn}}", "target": "subject.commonName" },
  { "source": "{{calleridentity.mail}}", "target": "sans.rfc822names", "condition": "{{calleridentity.mail}}" },
  { "source": "{{calleridentity.msupn}}", "target": "sans.othername_upn", "condition": "{{calleridentity.msupn}}" },
  { "source": "{{calleridentity.o}}", "target": "subject.organization", "condition": "{{calleridentity.o}}" },
  { "source": "{{calleridentity.department}}", "target": "subject.organizationalUnit", "condition": "{{calleridentity.department}}" },
  { "source": "{{calleridentity.samaccountname}}", "target": "owner" },
  { "source": "{{calleridentity.mail}}", "target": "contactEmail", "condition": "{{calleridentity.mail}}" }
]
```

### Environment-Based Subject Naming

**Requirement:** Server names follow a pattern like `env-service-index.domain.com`
(e.g., `prod-web-01.corp.example.com`). Extract the environment from the CN
and use it to set the OU and a label for filtering.

```json
[
  {
    "source": "Extract({{csr.subject.cn}}, \"^([a-z]+)-\", 1)",
    "target": "label.environment",
    "condition": "Extract({{csr.subject.cn}}, \"^([a-z]+)-\", 1)"
  },
  {
    "source": "Upper(Extract({{csr.subject.cn}}, \"^([a-z]+)-\", 1))",
    "target": "subject.organizationalUnit",
    "condition": "Extract({{csr.subject.cn}}, \"^([a-z]+)-\", 1)"
  }
]
```

**Result for `CN=prod-web-01.corp.example.com`:**
- `label.environment` = `prod`
- OU = `PROD`

**Why:** `Extract` with capture group 1 isolates the environment prefix.
The nested `Upper(Extract(...))` demonstrates composing functions.
The `condition` ensures the rule is skipped if the CN doesn't match the pattern.

### Conditional Team Assignment

**Requirement:** Certificates requested by members of the "infra-team" should
be owned by the "Infrastructure" team. All others get the default "PKI-Ops" team.

```json
[
  {
    "source": "\"Infrastructure\"",
    "target": "owner",
    "condition": "Match(Join({{principal.team}}, \",\"), \".*infra-team.*\")"
  },
  {
    "source": "\"PKI-Ops\"",
    "target": "owner",
    "overwrite": false
  }
]
```

**Why:** Rule 1 sets owner to "Infrastructure" only if the principal belongs to
"infra-team" (checked via Join + Match). Rule 2 sets "PKI-Ops" with
`overwrite: false` — it only fires if Rule 1 didn't set the owner (because the
condition was false). This implements an if/else pattern.

### Notification Template String — Certificate Expiry Email

**Requirement:** Send an expiry warning email with certificate details embedded
in the body. This uses **template string** syntax (free text with embedded
`{{ }}` placeholders), not computation rules.

```
Subject: Certificate {{certificate.dn}} expires on {{certificate.not_after}}

Body:
Hello {{certificate.owner}},

Your certificate for {{certificate.dn}} (serial: {{certificate.serial}})
issued by profile {{certificate.profile}} will expire on
{{certificate.not_after}}.

Please renew it before expiry. You can access your certificate at:
{{request.my.url}}

Regards,
PKI Operations Team
```

### Notification Template String — REST Webhook with Functions

**Requirement:** Call an external API with a payload that varies based on
certificate labels. Uses functions inside template string `{{ }}`.

```
action={{OrElse(Concat("deploy-", {{label.target_env}}), "noop")}}&host={{certificate.san.dnsname.0}}&serial={{certificate.serial}}
```

**Why:** This template string embeds `OrElse(Concat(...), fallback)` inside
`{{ }}`. If the label `target_env` exists, it builds a deploy action like
`deploy-prod`. Otherwise, it falls back to `noop`. Functions inside template
strings use the nested `{{Function({{key}})}}` syntax.
