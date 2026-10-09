# Computation Rules, Template Syntax, and Datasource Flows

## Before Writing a Computation Rule

Use the functions and syntax in the
[computation guide](https://docs.evertrust.fr/horizon/2.11/admin-guide/other/computation_rules.html).
Call `simulate_computation_rule` with the relevant context before configuring
an enrollment field. Do not invent function names.

---

## Overview

Computation rules evaluate dictionary expressions to produce field values.
Configure them on certificate-template fields that expose `computationRule`.
Datasource flow results can provide inputs to these expressions.

---

## Two Expression Types

Horizon has two distinct expression types. Understanding the difference is
critical for the `simulate_computation_rule` tool and for profile configuration.

### Computation Rules

A **computation rule** is a full expression with functions. Used in profile
certificate templates to compute field values (subject, SANs, labels, owner).

- Dictionary lookups use `{{key}}` syntax: `{{csr.subject.cn.1}}`
- Multi-value lookups use `[[key]]` syntax: `[[csr.san.dnsname]]`
- Functions wrap around dictionary lookups: `Upper({{cn}})`, `DomainDNS({{fqdn}})`
- Functions can be nested: `Concat(OrElse({{prefix}}, "default"), "-", {{name}})`
- The expression itself is NOT wrapped in `{{ }}`

**Examples of computation rules:**

```
Upper({{csr.subject.cn.1}})                              → "MYSERVER.EXAMPLE.COM"
DomainDNS({{csr.subject.cn.1}})                          → "example.com"
Concat({{csr.subject.cn.1}}, ".", {{csr.subject.o.1}})     → "myserver.example.com.MyOrg"
OrElse({{csr.subject.ou.1}}, "Default")                  → "Default" (if ou is empty)
Extract({{email}}, "(.*)@", 1)                         → "user" (from "user@example.com")
```

When using `simulate_computation_rule` with `mode="computation_rule"` (default),
pass the expression directly: `rule="Upper({{cn}})"`.

### Template Strings

A **template string** is free text with embedded `{{ }}` placeholders. Used in
email templates, webhook URLs, notification bodies, REST API call payloads.

- The text around `{{ }}` is preserved as-is
- Simple variables: `{{key}}` resolves to the dictionary value
- **Functions work inside `{{ }}`**: `{{Upper({{cn}})}}` - note the nested braces
- Multi-value: `[[key]]` resolves to all values

**Examples of template strings:**

```
"Hello {{principal.name}}, your cert expires on {{certificate.not_after}}"
"serial={{certificate.serial}}"
"https://api.example.com/v1/{{certificate.serial}}"
"web-{{csr.subject.cn.1}}-{{principal.name}}"  →  "web-myserver.example.com-jdoe"
```

When using `simulate_computation_rule` with `mode="template_string"`,
pass the full text: `rule="Hello {{Upper({{cn}})}}"`.

### Key Difference

| Aspect              | Computation Rule                             | Template String                          |
| ------------------- | -------------------------------------------- | ---------------------------------------- |
| **Purpose**         | Compute a single field value                 | Build a text string with embedded values |
| **Outer wrapper**   | None - bare expression                       | Free text around `{{ }}` blocks          |
| **Function syntax** | `Upper({{key}})`                             | `{{Upper({{key}})}}`                     |
| **Multi-value**     | `[[key]]` returns list                       | `[[key]]` returns comma-separated        |
| **API field**       | `computationRule`                            | TemplateString fields                    |
| **Profile usage**   | Certificate template `computationRule` field | Email/webhook/notification templates     |

### Expression Types

Functions accept different expression types depending on their signature:

| Type                 | Description                                                           | Examples                                              |
| -------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| **simpleExpression** | A single value: template variable, literal string, number, or keyword | `{{csr.subject.cn.1}}`, `"text"`, `-4`, `NOW`, `NULL` |
| **multiExpression**  | A multi-value reference or a function returning a list                | `[[csr.san.dnsname]]`, `Split("a.b", ".")`            |
| **expression**       | Either simple or multi -- any expression                              | Any of the above                                      |

### Literals and Keywords

| Literal        | Description                                |
| -------------- | ------------------------------------------ |
| `"text"`       | String literal (enclosed in double quotes) |
| `-4`, `1`, `0` | Numeric literal                            |
| `NULL`         | Evaluates to `None`.                       |
| `NOW`          | Current date/time at evaluation time.      |

---

## Functions Reference

Function names are not case-sensitive. Dictionary keys are case-sensitive.
Functions use parentheses for arguments.
Arguments are separated by commas.

### Any Expression Functions (accept single or multi)

These functions accept single values or lists. `Upper`, `Lower`, `Trim`,
`Substr`, `Extract`, and `Replace` transform each value in a list.
`Concat` combines values. `OrElse` selects the first non-None result.

| Function  | Signature                                               | Returns            | Description                                                                                                                    | Example                                                        |
| --------- | ------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `Upper`   | `Upper(expression)`                                     | string or list     | Convert to uppercase. None if input is None.                                                                                   | `Upper("hello")` → `"HELLO"`, `Upper(["a","b"])` → `["A","B"]` |
| `Lower`   | `Lower(expression)`                                     | string or list     | Convert to lowercase. None if input is None.                                                                                   | `Lower("HELLO")` → `"hello"`                                   |
| `Trim`    | `Trim(expression)`                                      | string or list     | Strip whitespace. None if input is None.                                                                                       | `Trim(" x ")` → `"x"`                                          |
| `Substr`  | `Substr(expr, start)` or `Substr(expr, start, end)`     | string or list     | Substring by index range (not length).                                                                                         | `Substr("STRING", 2)` → `"TRING"`                              |
| `Concat`  | `Concat(expr, ...expr)`                                 | **string or list** | Concatenate strings if all arguments are single values. Otherwise, combine values into an array. An empty result returns None. | `Concat("a", "-", "b")` → `"a-b"`                              |
| `Extract` | `Extract(expr, regex)` or `Extract(expr, regex, group)` | string or list     | Regex match. Optional capture group (1-indexed).                                                                               | `Extract("user@domain", "(.*)@", 1)` → `"user"`                |
| `Replace` | `Replace(expr, regex, replacement)`                     | string or list     | Regex substitution.                                                                                                            | `Replace("a.b", "\\.", "-")` → `"a-b"`                         |
| `OrElse`  | `OrElse(expr, ...expr)`                                 | string or list     | First non-None result, or None if all arguments are None.                                                                      | `OrElse({{missing}}, "fallback")` → `"fallback"`               |

**Concat with arrays:** `Concat(["a"], ["b"])` → `["a", "b"]` (merges lists).
`Concat(["string1", "string2", "string3"], "string4")` → `["string1", "string2", "string3", "string4"]`.

### String Functions (accept simpleExpression, return single value)

| Function         | Signature                            | Returns | Description                                        | Example                                              |
| ---------------- | ------------------------------------ | ------- | -------------------------------------------------- | ---------------------------------------------------- |
| `Match`          | `Match(simpleExpr, regex)`           | string  | Returns value if it matches regex, None otherwise. | `Match("abcd", "[a-z]+")` → `"abcd"`                 |
| `DateTimeFormat` | `DateTimeFormat(simpleExpr, format)` | string  | Format date using Java DateTimeFormatter pattern.  | `DateTimeFormat(NOW, "yyyy-MM-dd")` → `"2026-03-17"` |
| `Get`            | `Get(multiExpr, index)`              | string  | Element at index (0-based). Supports negative.     | `Get(["a","b","c"], -1)` → `"c"`                     |
| `First`          | `First(multiExpr)`                   | string  | First element.                                     | `First(["a","b"])` → `"a"`                           |
| `Last`           | `Last(multiExpr)`                    | string  | Last element.                                      | `Last(["a","b"])` → `"b"`                            |
| `Join`           | `Join(multiExpr, separator)`         | string  | Join list into string.                             | `Join(["a","b"], ".")` → `"a.b"`                     |

### List Functions (return multi-value)

| Function | Signature                                                   | Returns | Description                                               | Example                                                                              |
| -------- | ----------------------------------------------------------- | ------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Filter` | `Filter(multiExpr, regex)`                                  | list    | Keep items matching regex.                                | `Filter(["string1", "string2", "match"], "[a-z]+")` → `["match"]`                    |
| `Slice`  | `Slice(multiExpr, start)` or `Slice(multiExpr, start, end)` | list    | Sub-list extraction. Negative indexes count from the end. | `Slice(["string1", "string2", "string3", "string4"], -2)` → `["string3", "string4"]` |
| `Sort`   | `Sort(multiExpr)`                                           | list    | Alphabetical sort.                                        | `Sort(["b","a"])` → `["a","b"]`                                                      |
| `Unique` | `Unique(multiExpr)`                                         | list    | Remove duplicate values.                                  | `Unique(["a","b","a"])` → `["a","b"]`                                                |
| `Split`  | `Split(singleExpr, separator)`                              | list    | Divide string into list.                                  | `Split("a.b", ".")` → `["a","b"]`                                                    |

[Template string guide](https://docs.evertrust.fr/horizon/2.5/admin-guide/other/template_string.html).

### Specialized Parsing Functions

| Function               | Signature                          | Returns | Description                 | Example                                            |
| ---------------------- | ---------------------------------- | ------- | --------------------------- | -------------------------------------------------- |
| `ShortenDNS`           | `ShortenDNS(singleExpr)`           | string  | First DNS label (hostname). | `ShortenDNS("web01.example.com")` → `"web01"`      |
| `DomainDNS`            | `DomainDNS(singleExpr)`            | string  | Domain from FQDN.           | `DomainDNS("web01.example.com")` → `"example.com"` |
| `EmailUser`            | `EmailUser(singleExpr)`            | string  | User from email.            | `EmailUser("j@example.com")` → `"j"`               |
| `EmailDomain`          | `EmailDomain(singleExpr)`          | string  | Domain from email.          | `EmailDomain("j@example.com")` → `"example.com"`   |
| `SamAccountNameUser`   | `SamAccountNameUser(singleExpr)`   | string  | User from DOMAIN\user.      | `SamAccountNameUser("CORP\\jdoe")` → `"jdoe"`      |
| `SamAccountNameDomain` | `SamAccountNameDomain(singleExpr)` | string  | Domain from DOMAIN\user.    | `SamAccountNameDomain("CORP\\jdoe")` → `"CORP"`    |

### Encoding and Serialization Functions

| Function | Signature            | Returns | Description                                                                                                                                           |
| -------- | -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Base64` | `Base64(singleExpr)` | string  | Encode a string as Base64. `Base64("string1")` -> `"c3RyaW5nMQ=="`. **Available since Horizon 2.8.5.**                                                |
| `Raw`    | `Raw(singleExpr)`    | string  | Extract the raw value from a JSON-encoded string (strips JSON escaping). `Raw("str\"in\ng1==")` -> `str"in\ng1==`. **Available since Horizon 2.8.5.** |

---

See the [encoding examples](https://docs.evertrust.fr/horizon/2.8/admin-guide/other/computation_rules.html)
for `Base64` and `Raw`.

## Working with Multi-Value Fields

Use `{{key}}` for a single dictionary value and `[[key]]` for a list.
Use the key type shown in the public dictionary reference. A subject field
such as `csr.subject.cn` is multivalued. Use `{{csr.subject.cn.1}}` for its
first value, or `[[csr.subject.cn]]` for its values.

Functions such as `Concat`, `Filter`, `Sort`, and `Unique` can produce lists.
Configure the resulting expression on the documented template field.

Combine DNS and IP SAN values from a CSR:

```text
Concat([[csr.san.dnsname]], [[csr.san.ipaddress]])
```

Use an LDAP mail value, with the authenticated principal's mail as a fallback:

```text
OrElse({{ds.1.1.mail}}, {{principal.mail}})
```

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

| Entry                                           | Type   | Computation Rule | Description                                  |
| ----------------------------------------------- | ------ | ---------------- | -------------------------------------------- |
| `principal.identifier`                          | Single | Yes              | Authenticated user identifier                |
| `principal.name`                                | Single | Yes              | User display name                            |
| `principal.mail`                                | Single | Yes              | User email address                           |
| `principal.provider.name`                       | Single | Yes              | Authentication provider name                 |
| `principal.team`                                | Multi  | Yes              | Assigned team names                          |
| `principal.team.<index>`                        | Single | Yes              | Team at specific index                       |
| `principal.certificate.subject.<field>`         | Multi  | Yes              | Subject fields from user's auth certificate  |
| `principal.certificate.subject.<field>.<index>` | Single | Yes              | Specific subject field value by index        |
| `principal.certificate.san.<type>`              | Multi  | Yes              | SAN values from user's auth certificate      |
| `principal.certificate.san.<type>.<index>`      | Single | Yes              | Specific SAN value by index                  |
| `principal.certificate.extension.<type>`        | Single | Yes              | Extension value from user's auth certificate |

#### CSR Dictionary

Data extracted from the Certificate Signing Request.

| Entry                         | Type   | Computation Rule | Description                                       |
| ----------------------------- | ------ | ---------------- | ------------------------------------------------- |
| `csr.subject.<field>`         | Multi  | Yes              | Subject field values (see Subject sub-dictionary) |
| `csr.subject.<field>.<index>` | Single | Yes              | Subject field value at index                      |
| `csr.san.<type>`              | Multi  | Yes              | SAN values by type (see SANs sub-dictionary)      |
| `csr.san.<type>.<index>`      | Single | Yes              | SAN value at index                                |
| `csr.extension.<type>`        | Single | Yes              | Extension value (see Extensions sub-dictionary)   |

#### HTTP Request Dictionary

Information about the HTTP request that triggered the enrollment.

| Entry                        | Type   | Computation Rule | Description                             |
| ---------------------------- | ------ | ---------------- | --------------------------------------- |
| `http.request.ip`            | Single | Yes              | Client IP address                       |
| `http.request.method`        | Single | Yes              | HTTP method (GET, POST, etc.)           |
| `http.request.path`          | Single | Yes              | Request path                            |
| `http.request.host`          | Single | Yes              | Request host                            |
| `http.request.header.<name>` | Multi  | Yes              | Values of the named HTTP request header |

#### WebRA Enrollment Dictionary

Values submitted through the WebRA enrollment form.

| Entry                                  | Type   | Computation Rule | Description                          |
| -------------------------------------- | ------ | ---------------- | ------------------------------------ |
| `webra.enroll.subject.<field>`         | Multi  | Yes              | Subject field values from WebRA form |
| `webra.enroll.subject.<field>.<index>` | Single | Yes              | Subject field value at index         |
| `webra.enroll.san.<type>`              | Multi  | Yes              | SAN values from WebRA form           |
| `webra.enroll.san.<type>.<index>`      | Single | Yes              | SAN value at index                   |
| `webra.enroll.extension.<type>`        | Single | Yes              | Extension value from WebRA form      |
| `webra.enroll.label.<name>`            | Single | Yes              | Label value from WebRA form          |
| `webra.enroll.metadata.<name>`         | Single | Yes              | Metadata value from WebRA form       |
| `webra.enroll.mail`                    | Single | Yes              | Contact email from WebRA form        |
| `webra.enroll.owner`                   | Single | Yes              | Owner from WebRA form                |
| `webra.enroll.team`                    | Single | Yes              | Team from WebRA form                 |

#### EST Enrollment Dictionary

Same structure as WebRA, with prefix `est.enroll.*`.

| Entry                                | Type   | Computation Rule | Description                              |
| ------------------------------------ | ------ | ---------------- | ---------------------------------------- |
| `est.enroll.subject.<field>`         | Multi  | Yes              | Subject field values from EST enrollment |
| `est.enroll.subject.<field>.<index>` | Single | Yes              | Subject field value at index             |
| `est.enroll.san.<type>`              | Multi  | Yes              | SAN values from EST enrollment           |
| `est.enroll.san.<type>.<index>`      | Single | Yes              | SAN value at index                       |
| `est.enroll.extension.<type>`        | Single | Yes              | Extension value from EST enrollment      |
| `est.enroll.label.<name>`            | Single | Yes              | Label value from EST enrollment          |
| `est.enroll.metadata.<name>`         | Single | Yes              | Metadata value from EST enrollment       |
| `est.enroll.mail`                    | Single | Yes              | Contact email from EST enrollment        |
| `est.enroll.owner`                   | Single | Yes              | Owner from EST enrollment                |
| `est.enroll.team`                    | Single | Yes              | Team from EST enrollment                 |

#### SCEP Enrollment Dictionary

Same structure as WebRA, with prefix `scep.enroll.*`.

| Entry                                 | Type   | Computation Rule | Description                               |
| ------------------------------------- | ------ | ---------------- | ----------------------------------------- |
| `scep.enroll.subject.<field>`         | Multi  | Yes              | Subject field values from SCEP enrollment |
| `scep.enroll.subject.<field>.<index>` | Single | Yes              | Subject field value at index              |
| `scep.enroll.san.<type>`              | Multi  | Yes              | SAN values from SCEP enrollment           |
| `scep.enroll.san.<type>.<index>`      | Single | Yes              | SAN value at index                        |
| `scep.enroll.extension.<type>`        | Single | Yes              | Extension value from SCEP enrollment      |
| `scep.enroll.label.<name>`            | Single | Yes              | Label value from SCEP enrollment          |
| `scep.enroll.metadata.<name>`         | Single | Yes              | Metadata value from SCEP enrollment       |
| `scep.enroll.mail`                    | Single | Yes              | Contact email from SCEP enrollment        |
| `scep.enroll.owner`                   | Single | Yes              | Owner from SCEP enrollment                |
| `scep.enroll.team`                    | Single | Yes              | Team from SCEP enrollment                 |

#### CRMP Enrollment Dictionary

Same structure as WebRA, with prefix `crmp.enroll.*`.

| Entry                                 | Type   | Computation Rule | Description                               |
| ------------------------------------- | ------ | ---------------- | ----------------------------------------- |
| `crmp.enroll.subject.<field>`         | Multi  | Yes              | Subject field values from CRMP enrollment |
| `crmp.enroll.subject.<field>.<index>` | Single | Yes              | Subject field value at index              |
| `crmp.enroll.san.<type>`              | Multi  | Yes              | SAN values from CRMP enrollment           |
| `crmp.enroll.san.<type>.<index>`      | Single | Yes              | SAN value at index                        |
| `crmp.enroll.extension.<type>`        | Single | Yes              | Extension value from CRMP enrollment      |
| `crmp.enroll.label.<name>`            | Single | Yes              | Label value from CRMP enrollment          |
| `crmp.enroll.metadata.<name>`         | Single | Yes              | Metadata value from CRMP enrollment       |
| `crmp.enroll.mail`                    | Single | Yes              | Contact email from CRMP enrollment        |
| `crmp.enroll.owner`                   | Single | Yes              | Owner from CRMP enrollment                |
| `crmp.enroll.team`                    | Single | Yes              | Team from CRMP enrollment                 |

#### ACME Order Dictionary

Values from the ACME order.

| Entry                        | Type   | Computation Rule | Description                    |
| ---------------------------- | ------ | ---------------- | ------------------------------ |
| `acme.order.initialip`       | Single | Yes              | IP address of the ACME client  |
| `acme.order.label.<name>`    | Single | Yes              | Label value from ACME order    |
| `acme.order.metadata.<name>` | Single | Yes              | Metadata value from ACME order |
| `acme.order.mail`            | Single | Yes              | Contact email from ACME order  |
| `acme.order.owner`           | Single | Yes              | Owner from ACME order          |
| `acme.order.team`            | Single | Yes              | Team from ACME order           |

#### ACME Account Dictionary

Values from the ACME account.

| Entry                          | Type   | Computation Rule | Description                    |
| ------------------------------ | ------ | ---------------- | ------------------------------ |
| `acme.account.initialip`       | Single | Yes              | IP address of the ACME account |
| `acme.account.contact.<index>` | Single | Yes              | Contact at specific index      |

#### WCCE Caller Identity Dictionary

Identity information from Windows Certificate Connector for Entra (WCCE).

| Entry                                    | Type   | Computation Rule | Description                   |
| ---------------------------------------- | ------ | ---------------- | ----------------------------- |
| `calleridentity.dn`                      | Single | Yes              | Full distinguished name       |
| `calleridentity.cn`                      | Single | Yes              | Common name                   |
| `calleridentity.msguid`                  | Single | Yes              | Microsoft GUID                |
| `calleridentity.msupn`                   | Single | Yes              | Microsoft UPN                 |
| `calleridentity.c`                       | Single | Yes              | Country                       |
| `calleridentity.company`                 | Single | Yes              | Company                       |
| `calleridentity.department`              | Single | Yes              | Department                    |
| `calleridentity.description`             | Single | Yes              | Description                   |
| `calleridentity.displayname`             | Single | Yes              | Display name                  |
| `calleridentity.dnshostname`             | Single | Yes              | DNS hostname                  |
| `calleridentity.employeeid`              | Single | Yes              | Employee ID                   |
| `calleridentity.employeenumber`          | Single | Yes              | Employee number               |
| `calleridentity.mail`                    | Single | Yes              | Email address                 |
| `calleridentity.o`                       | Single | Yes              | Organization                  |
| `calleridentity.ou`                      | Single | Yes              | Organizational unit           |
| `calleridentity.samaccountname`          | Single | Yes              | SAM account name              |
| `calleridentity.serialnumber`            | Single | Yes              | Serial number                 |
| `calleridentity.sn`                      | Single | Yes              | Surname                       |
| `calleridentity.title`                   | Single | Yes              | Title                         |
| `calleridentity.uid`                     | Single | Yes              | User ID                       |
| `calleridentity.sid`                     | Single | Yes              | Security identifier           |
| `calleridentity.subject.<field>`         | Multi  | Yes              | Subject sub-dictionary fields |
| `calleridentity.subject.<field>.<index>` | Single | Yes              | Subject field value at index  |

#### URL Parameters Dictionary

Values passed via URL parameters during enrollment.

| Entry                        | Type   | Computation Rule | Description                       |
| ---------------------------- | ------ | ---------------- | --------------------------------- |
| `url.enroll.label.<name>`    | Single | Yes              | Label value from URL parameter    |
| `url.enroll.metadata.<name>` | Single | Yes              | Metadata value from URL parameter |
| `url.enroll.mail`            | Single | Yes              | Contact email from URL parameter  |
| `url.enroll.owner`           | Single | Yes              | Owner from URL parameter          |
| `url.enroll.team`            | Single | Yes              | Team from URL parameter           |

---

### Context: Notifications (Trigger Templates)

These dictionaries are available in notification trigger templates (email, webhook, etc.).
The available entries depend on the trigger event.

#### Certificate Dictionary

**Available for events:** `on_enroll`, `on_revoke`, `on_update`, `on_recover`, `on_migrate`, `on_expire`, `on_renew`

| Entry                                 | Type   | Computation Rule | Description                                    |
| ------------------------------------- | ------ | ---------------- | ---------------------------------------------- |
| `certificate.id`                      | Single | Yes              | Certificate unique identifier                  |
| `certificate.module`                  | Single | Yes              | Module name                                    |
| `certificate.not_after`               | Single | Yes              | Expiration date                                |
| `certificate.not_before`              | Single | Yes              | Start of validity date                         |
| `certificate.serial`                  | Single | Yes              | Serial number                                  |
| `certificate.thumbprint`              | Single | Yes              | Certificate thumbprint (SHA-1 fingerprint)     |
| `certificate.public_key_thumbprint`   | Single | Yes              | Public key thumbprint                          |
| `certificate.revoked`                 | Single | Yes              | Revocation status                              |
| `certificate.key_type`                | Single | Yes              | Key type (RSA, EC, etc.)                       |
| `certificate.signing_algorithm`       | Single | Yes              | Signing algorithm                              |
| `certificate.holder_id`               | Single | Yes              | Holder identifier                              |
| `certificate.friendly_name`           | Single | Yes              | Friendly name                                  |
| `certificate.pem`                     | Single | Yes              | PEM-encoded certificate                        |
| `certificate.profile`                 | Single | Yes              | Profile name                                   |
| `certificate.revocation_date`         | Single | Yes              | Revocation date (if revoked)                   |
| `certificate.revocation_reason`       | Single | Yes              | Revocation reason (if revoked)                 |
| `certificate.mail`                    | Single | Yes              | Contact email                                  |
| `certificate.owner`                   | Single | Yes              | Owner                                          |
| `certificate.issuer`                  | Single | No               | Issuer DN (not usable in computation rules)    |
| `certificate.dn`                      | Single | No               | Subject DN (not usable in computation rules)   |
| `certificate.sans`                    | Single | No               | SANs (not usable in computation rules)         |
| `certificate.extensions`              | Single | No               | Extensions (not usable in computation rules)   |
| `certificate.metadata`                | Single | No               | All metadata (not usable in computation rules) |
| `certificate.metadata.<name>`         | Single | Yes              | Specific metadata value by name                |
| `certificate.subject.<field>`         | Multi  | Yes              | Subject sub-dictionary                         |
| `certificate.subject.<field>.<index>` | Single | Yes              | Subject field value at index                   |
| `certificate.san.<type>`              | Multi  | Yes              | SANs sub-dictionary                            |
| `certificate.san.<type>.<index>`      | Single | Yes              | SAN value at index                             |
| `certificate.extension.<type>`        | Single | Yes              | Extensions sub-dictionary                      |
| `certificate.label.<name>`            | Single | Yes              | Labels sub-dictionary                          |
| `certificate.team`                    | Single | Yes              | Team value                                     |
| `certificate.team.displaynames`       | Single | No               | Team display names                             |
| `certificate.team.descriptions`       | Single | No               | Team descriptions                              |
| `certificate.team.displayname.<lang>` | Single | No               | Team display name in language                  |
| `certificate.team.description.<lang>` | Single | No               | Team description in language                   |

#### Request Dictionary

**Available for events:** `on_submit_enroll`, `on_cancel_enroll`, `on_approve_enroll`, `on_deny_enroll`, `on_pending_enroll`, and equivalent events for `revoke`, `update`, `recover`, `migrate`, `renew`.

| Entry                             | Type   | Computation Rule | Description                                               |
| --------------------------------- | ------ | ---------------- | --------------------------------------------------------- |
| `request.id`                      | Single | Yes              | Request unique identifier                                 |
| `request.workflow`                | Single | Yes              | Workflow name                                             |
| `request.module`                  | Single | Yes              | Module name                                               |
| `request.status`                  | Single | Yes              | Request status                                            |
| `request.profile`                 | Single | Yes              | Profile name                                              |
| `request.requester`               | Single | Yes              | Requester identifier                                      |
| `request.approver`                | Single | Yes              | Approver identifier                                       |
| `request.requester_comment`       | Single | Yes              | Requester comment                                         |
| `request.approver_comment`        | Single | Yes              | Approver comment                                          |
| `request.registration_date`       | Single | Yes              | Registration date                                         |
| `request.last_modification_date`  | Single | Yes              | Last modification date                                    |
| `request.password`                | Single | Yes              | Request password                                          |
| `request.mail`                    | Single | Yes              | Contact email                                             |
| `request.owner`                   | Single | Yes              | Owner                                                     |
| `request.my.url`                  | Single | No               | URL for requester view (not usable in computation rules)  |
| `request.manage.url`              | Single | No               | URL for management view (not usable in computation rules) |
| `request.dn`                      | Single | No               | Subject DN (not usable in computation rules)              |
| `request.sans`                    | Single | No               | SANs (not usable in computation rules)                    |
| `request.extensions`              | Single | No               | Extensions (not usable in computation rules)              |
| `request.metadata`                | Single | No               | All metadata (not usable in computation rules)            |
| `request.labels`                  | Single | No               | All labels (not usable in computation rules)              |
| `request.metadata.<name>`         | Single | Yes              | Specific metadata value by name                           |
| `request.subject.<field>`         | Multi  | Yes              | Subject sub-dictionary                                    |
| `request.subject.<field>.<index>` | Single | Yes              | Subject field value at index                              |
| `request.san.<type>`              | Multi  | Yes              | SANs sub-dictionary                                       |
| `request.san.<type>.<index>`      | Single | Yes              | SAN value at index                                        |
| `request.extension.<type>`        | Single | Yes              | Extensions sub-dictionary                                 |
| `request.label.<name>`            | Single | Yes              | Labels sub-dictionary                                     |
| `request.certificate.*`           | --     | --               | Same structure as Certificate dictionary (embedded)       |
| `request.team`                    | Single | Yes              | Team value                                                |
| `request.team.displaynames`       | Single | No               | Team display names                                        |
| `request.team.descriptions`       | Single | No               | Team descriptions                                         |
| `request.team.displayname.<lang>` | Single | No               | Team display name in language                             |
| `request.team.description.<lang>` | Single | No               | Team description in language                              |

#### Previous Certificate Dictionary

**Available for event:** `on_renew` only

| Entry                    | Type | Computation Rule | Description                                                 |
| ------------------------ | ---- | ---------------- | ----------------------------------------------------------- |
| `previous.certificate.*` | --   | --               | Same complete structure as the Certificate dictionary above |

#### Credentials Dictionary

**Available for event:** `on_credentials_expiration`

| Entry                         | Type   | Computation Rule | Description            |
| ----------------------------- | ------ | ---------------- | ---------------------- |
| `credentials.name`            | Single | Yes              | Credential name        |
| `credentials.description`     | Single | Yes              | Credential description |
| `credentials.type`            | Single | Yes              | Credential type        |
| `credentials.expiration_date` | Single | Yes              | Expiration date        |

#### Profile Dictionary

**Available in:** all notification contexts

| Entry                               | Type   | Computation Rule | Description                                                |
| ----------------------------------- | ------ | ---------------- | ---------------------------------------------------------- |
| `profile.name`                      | Single | Yes              | Profile name                                               |
| `profile.module`                    | Single | Yes              | Module name                                                |
| `profile.displaynames`              | Single | No               | All display names (not usable in computation rules)        |
| `profile.descriptions`              | Single | No               | All descriptions (not usable in computation rules)         |
| `profile.<name>.displayname.<lang>` | Single | No               | Display name in language (not usable in computation rules) |
| `profile.<name>.description.<lang>` | Single | No               | Description in language (not usable in computation rules)  |

#### License Dictionary

**Available for events:** `on_license_expiration`, `on_license_usage`

| Entry                     | Type   | Computation Rule | Description                 |
| ------------------------- | ------ | ---------------- | --------------------------- |
| `license.expiration_date` | Single | Yes              | License expiration date     |
| `license.used`            | Single | Yes              | Number of licenses used     |
| `license.percent_used`    | Single | Yes              | Percentage of licenses used |

#### Failed Trigger Dictionary

**Available for event:** `on_trigger_error`

| Entry                       | Type   | Computation Rule | Description                        |
| --------------------------- | ------ | ---------------- | ---------------------------------- |
| `trigger.name`              | Single | Yes              | Trigger name                       |
| `trigger.event`             | Single | Yes              | Trigger event type                 |
| `trigger.lastExecutionDate` | Single | Yes              | Last execution date                |
| `trigger.status`            | Single | Yes              | Trigger status                     |
| `trigger.retryable`         | Single | Yes              | Whether the trigger can be retried |
| `trigger.type`              | Single | Yes              | Trigger type                       |
| `trigger.retries`           | Single | Yes              | Number of retries attempted        |
| `trigger.nextExecutionDate` | Single | Yes              | Next scheduled execution date      |
| `trigger.nextDelay`         | Single | Yes              | Delay before next retry            |
| `trigger.detail`            | Single | Yes              | Error detail message               |

---

### Sub-dictionaries Reference

These sub-dictionaries are used across multiple parent dictionaries (csr, certificate, request, webra.enroll, etc.).

#### Subject Sub-dictionary

Valid field names for `<parent>.subject.<field>`:

| Field                    | Description             |
| ------------------------ | ----------------------- |
| `cn`                     | Common Name             |
| `uid`                    | User ID                 |
| `serialnumber`           | Serial Number           |
| `surname`                | Surname                 |
| `givenname`              | Given Name              |
| `unstructuredaddress`    | Unstructured Address    |
| `unstructuredname`       | Unstructured Name       |
| `e`                      | Email Address           |
| `ou`                     | Organizational Unit     |
| `organizationidentifier` | Organization Identifier |
| `uniqueidentifier`       | Unique Identifier       |
| `street`                 | Street Address          |
| `st`                     | State or Province       |
| `l`                      | Locality                |
| `o`                      | Organization            |
| `c`                      | Country                 |
| `description`            | Description             |
| `dc`                     | Domain Component        |

**Access patterns:**

- `<parent>.subject.<field>` -- Multi-value (all values for that field)
- `<parent>.subject.<field>.<index>` -- Single value at index

#### SANs Sub-dictionary

Valid type names for `<parent>.san.<type>`:

| Type             | Description                 |
| ---------------- | --------------------------- |
| `rfc822name`     | Email address               |
| `dnsname`        | DNS name                    |
| `uri`            | Uniform Resource Identifier |
| `ipaddress`      | IP address                  |
| `othername_upn`  | OtherName UPN               |
| `othername_guid` | OtherName GUID              |
| `registered_id`  | Registered ID               |

**Access patterns:**

- `<parent>.san.<type>` -- Multi-value (all values for that SAN type)
- `<parent>.san.<type>.<index>` -- Single value at index

#### Extensions Sub-dictionary

Valid type names for `<parent>.extension.<type>`:

| Type             | Description                       |
| ---------------- | --------------------------------- |
| `ms_sid`         | Microsoft Security Identifier     |
| `ms_template`    | Microsoft Certificate Template    |
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

Set `computationRule` to an expression string. For example, a
certificate-template DN element can contain:

```json
{
  "type": "CN",
  "mandatory": true,
  "computationRule": "Lower({{csr.subject.cn.1}})"
}
```

Set `computationRule` on the selected subject, SAN, extension, or policy
field. Use `describe_certificate_profile_schema` to inspect the element
structure before creating or updating the profile.

---

## Datasource Flow Chaining

Datasource flows allow profiles to query external data sources (LDAP, HTTP,
databases) during enrollment and feed results into computation rules.

### DataSourceFlowEntry

```json
{
  "dsFlow": [
    {
      "ds": "corporate-ldap",
      "stopOnSuccess": true,
      "inputs": [{ "key": "username", "value": "{{principal.identifier}}" }]
    },
    {
      "ds": "backup-ldap",
      "stopOnSuccess": false,
      "inputs": [{ "key": "username", "value": "{{principal.identifier}}" }]
    }
  ]
}
```

| Field           | Type    | Description                                                                      |
| --------------- | ------- | -------------------------------------------------------------------------------- |
| `ds`            | string  | Name of a configured datasource object.                                          |
| `stopOnSuccess` | boolean | If `true` and this datasource returns results, skip subsequent entries.          |
| `inputs`        | array   | List of `{key, value}` pairs mapping datasource parameters to computation rules. |

Datasource flows run in order. Inputs can use outputs from earlier flows.
Use `simulate_datasource_flow` to inspect the returned dictionary before
configuring an expression on a certificate-template field.

---

## Templates Beyond Certificate Fields

The template syntax (`{{ }}` / `[[ ]]`) is used in many places beyond
certificate templates:

| Context                | Where templates work               |
| ---------------------- | ---------------------------------- |
| **Email templates**    | Subject, body, recipient addresses |
| **Webhook payloads**   | URL, headers, request body         |
| **OIDC claims**        | Claim mappings from IDP tokens     |
| **Notification rules** | Condition expressions              |
| **Validation rules**   | Match conditions for auto-approval |

All contexts share the same function library and dictionary entries, though
the available entries vary by context (e.g., email templates have access to
`certificate.*` entries that are not available during enrollment).

**Related resources:**

- horizon://knowledge/datasources - DNS, LDAP, REST datasource configuration
- horizon://knowledge/validation-rules - validation rule condition syntax
- horizon://knowledge/dictionary-matrix - all dictionary entries by context and module

---
