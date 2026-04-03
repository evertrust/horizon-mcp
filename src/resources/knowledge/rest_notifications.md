# REST Notifications - Building Custom Connectors

## Overview

REST notifications are Horizon's most powerful automation mechanism. They let you
build **custom connectors** that call any REST API when certificate lifecycle
events occur. Unlike built-in third-party connectors (AKV, AWS, F5, etc.), REST
notifications are fully user-defined - you control the URL, authentication,
headers, body, and can chain multiple API calls in sequence.

**Use REST notifications to:**

- Deploy certificates to load balancers, API gateways, or IoT platforms
- Update DNS records for ACME DNS-01 challenges
- Push certificate data to SIEM, CMDB, or ticketing systems
- Trigger CI/CD pipelines after certificate renewal
- Revoke or clean up external resources when certificates are revoked
- Notify external systems via custom REST APIs (not just Slack/Teams)

---

## Core Concepts

### How REST Notifications Work

1. An event fires (e.g., certificate enrolled, request approved)
2. Horizon builds a **dictionary** of template variables from the context
3. Each step in the `sequence` array executes in order
4. Template variables (`{{certificate.serial}}`) are replaced with real values
5. Each step's response body is parsed and added to the dictionary for the next step
6. If any step fails (unexpected HTTP code or connection error), execution stops

### REST Notification vs Other Trigger Types

| Type                                         | Use case                                             | User-configurable             |
| -------------------------------------------- | ---------------------------------------------------- | ----------------------------- |
| `rest`                                       | Any REST API - fully custom URL, auth, headers, body | Yes - everything              |
| `webhook`                                    | Teams / Slack / Mattermost messages                  | Partial - fixed format        |
| `email`                                      | Email notifications with optional cert attachments   | Partial - template-based      |
| Third-party (`akv`, `aws`, `f5client`, etc.) | Built-in connectors                                  | Minimal - just connector name |

**Choose REST notifications when** no built-in connector exists for your target
system, or when you need custom payload formatting, multi-step API flows, or
response chaining.

---

## API Reference

### Create a REST Notification

```
POST /api/v1/triggers
Content-Type: application/json
```

### Full Schema

```json
{
  "name": "deploy-to-loadbalancer",
  "type": "rest",
  "retries": 10,
  "events": ["on_enroll"],
  "sequence": [
    {
      "url": "https://api.example.com/certificates",
      "authenticationType": "bearer",
      "credentials": "lb-api-token",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"cert\": \"{{certificate.pem}}\"}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200, 201, 204],
      "proxy": null
    }
  ],
  "triggers": {
    "onTriggerError": ["error-notifier"]
  }
}
```

### Top-Level Fields

| Field                     | Type         | Required    | Description                                                                                                                                                                         |
| ------------------------- | ------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                    | string       | yes         | Unique identifier (IMMUTABLE - cannot be changed after creation)                                                                                                                    |
| `type`                    | string       | yes         | Must be `"rest"`                                                                                                                                                                    |
| `events`                  | list[string] | yes         | Exactly ONE event - e.g., `["on_enroll"]`                                                                                                                                           |
| `retries`                 | integer      | no          | Retry count on failure (default: 10, exponential backoff)                                                                                                                           |
| `runPeriod`               | string       | conditional | Duration string - MANDATORY for `on_expire`, `on_pending_*`, `on_license_expiration`, `on_credentials_expiration`. FORBIDDEN for all others. Examples: `"24h"`, `"7d"`, `"30 days"` |
| `runOnRenewed`            | boolean      | conditional | MANDATORY for `on_expire` only. If true, fires even if certificate was already renewed                                                                                              |
| `licenceUsagePercent`     | integer      | conditional | MANDATORY for `on_license_usage` only. Threshold 1-100                                                                                                                              |
| `sequence`                | list[object] | yes         | Ordered list of REST call steps (see below)                                                                                                                                         |
| `triggers.onTriggerError` | list[string] | no          | Names of triggers to fire if this notification fails                                                                                                                                |

### Sequence Step Fields

Each object in the `sequence` array defines one HTTP request:

| Field                | Type         | Required    | Description                                                                       |
| -------------------- | ------------ | ----------- | --------------------------------------------------------------------------------- |
| `url`                | string       | yes         | Target URL - supports template strings (`{{certificate.serial}}`)                 |
| `method`             | string       | yes         | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`                      |
| `authenticationType` | string       | yes         | One of: `noauth`, `basic`, `bearer`, `x509`, `custom`                             |
| `credentials`        | string       | conditional | Name of credential stored in Horizon. Required for all auth types except `noauth` |
| `headers`            | list[object] | no          | Each has `name` (string) and `value` (string, supports templates)                 |
| `payload`            | string       | no          | Request body - supports template strings                                          |
| `payloadType`        | string       | no          | `"json"`, `"text"`, or `"none"` (affects UI formatting only)                      |
| `expectedHttpCodes`  | list[int]    | yes         | HTTP status codes that mean success. Any other code = failure                     |
| `timeout`            | string       | yes         | Connection timeout as duration string: `"30 seconds"`, `"1 minute"`               |
| `proxy`              | string       | no          | Name of HTTP proxy configured in Horizon                                          |

### API Operations

| Operation            | Method | Path                                    |
| -------------------- | ------ | --------------------------------------- |
| Create               | POST   | `/api/v1/triggers`                      |
| List all             | GET    | `/api/v1/triggers`                      |
| Get by name          | GET    | `/api/v1/triggers/{name}`               |
| Update               | PUT    | `/api/v1/triggers/` (name in JSON body) |
| Delete               | DELETE | `/api/v1/triggers/{name}`               |
| Simulate (test-fire) | PATCH  | `/api/v1/triggers/` (name in JSON body) |

---

## Authentication Types

### No Authentication (`noauth`)

No authentication headers sent. Use for public APIs or when auth is handled
in custom headers.

```json
{
  "authenticationType": "noauth"
}
```

### Basic Authentication (`basic`)

Sends `Authorization: Basic <base64(login:password)>` header automatically.
Requires a **Login** type credential in Horizon.

```json
{
  "authenticationType": "basic",
  "credentials": "my-basic-cred"
}
```

**Credential type**: Password (has `login` and `password` fields)

### Bearer Token (`bearer`)

Sends `Authorization: Bearer <token>` header automatically.
Requires an **API Token** type credential in Horizon.

```json
{
  "authenticationType": "bearer",
  "credentials": "my-api-token"
}
```

**Credential type**: Raw (has a single `secret` field)

### Client Certificate / mTLS (`x509`)

Configures TLS with a client certificate for mutual authentication.
No auth header is added - authentication happens at the TLS layer.
Requires a **Certificate** type credential (PKCS#12 store) in Horizon.

```json
{
  "authenticationType": "x509",
  "credentials": "my-client-cert"
}
```

**Credential type**: Certificate (PKCS#12 file with private key)

### Custom Authentication (`custom`)

No auth headers are added automatically. Instead, the credential's secret
values are injected into the template dictionary so you can use them in
custom headers or the payload body.

```json
{
  "authenticationType": "custom",
  "credentials": "my-api-key",
  "headers": [{ "name": "X-API-Key", "value": "{{credentials.key}}" }]
}
```

**Available template variables for custom auth:**

- Raw credentials: `{{credentials.key}}` (the secret value)
- Password credentials: `{{credentials.login}}` and `{{credentials.password}}`

**Use custom auth when:** the API requires a non-standard auth scheme (API key
in a custom header, HMAC signature, or OAuth token in a specific format).

### Credential Types Summary

| Credential Type     | Fields                   | Used by            |
| ------------------- | ------------------------ | ------------------ |
| Password (Login)    | `login`, `password`      | `basic`, `custom`  |
| Raw (API Token)     | `secret` (single value)  | `bearer`, `custom` |
| Certificate (X.509) | PKCS#12 store + password | `x509`             |

Credentials are managed at: **Administration > Security > Credentials**
API: `GET/POST /api/v1/security/credentials`

---

## Multi-Step Sequences and Response Chaining

The most powerful feature of REST notifications is **multi-step sequences**.
Each step in the `sequence` array executes in order, and response data from
earlier steps is available to later steps via the `rest.response.N.key` pattern.

### How Response Chaining Works

1. Step 1 executes and receives a response
2. If the response body is valid JSON, it is parsed and flattened into
   dot-notation keys prefixed with `rest.response.1.`
3. Step 2 can reference these values in its URL, headers, or payload
4. Step 2's response becomes `rest.response.2.` for step 3, and so on

### JSON Response Parsing

Given step 1 returns:

```json
{
  "id": "cert-abc123",
  "status": "pending",
  "endpoints": {
    "activate": "/api/certs/cert-abc123/activate",
    "details": "/api/certs/cert-abc123"
  },
  "tags": ["production", "web"]
}
```

Available dictionary keys for subsequent steps:

- `rest.response.1.id` = `"cert-abc123"`
- `rest.response.1.status` = `"pending"`
- `rest.response.1.endpoints.activate` = `"/api/certs/cert-abc123/activate"`
- `rest.response.1.endpoints.details` = `"/api/certs/cert-abc123"`
- `rest.response.1.tags.1` = `"production"`
- `rest.response.1.tags.2` = `"web"`

### Non-JSON Response

If the response is not valid JSON, the entire body is stored as:

- `rest.response.N.body` = `"<raw text content>"`

### Index Convention

- Response indexes are **1-based** (first step = `rest.response.1`, second = `rest.response.2`)
- Array element indexes are also **1-based** (`tags.1`, `tags.2`)
- Nested objects use dot notation (`endpoints.activate`)

### Fail-Fast Behavior

If any step in the sequence fails (returns an unexpected HTTP code or a
connection error), **all subsequent steps are skipped**. The entire
notification is marked as failed and follows the retry policy.

### When to Use Multi-Step Sequences

Use this decision guide to determine whether chaining is needed:

**Single step is enough when:**

- The target API accepts everything in one call (cert + key + metadata)
- Authentication is static (API key, basic auth, bearer token)
- No resource needs to be created before another operation

**Multi-step chaining is needed when:**

- The API requires **OAuth/OIDC token acquisition** before the actual call
- You need to **create a resource first**, then **update or activate** it
- The API requires a **lookup step** (find resource ID by name) before updating
- You need to **upload certificate and key separately** (two distinct endpoints)
- The workflow involves **cleanup after deployment** (e.g., deploy, then invalidate cache)
- The target system uses **transactional APIs** (begin, commit pattern)

### Chaining Pattern Catalog

These are the recurring multi-step patterns that arise in real-world
certificate deployment scenarios.

#### Pattern A: OAuth Token Acquisition + API Call

**When to use:** The target API uses OAuth 2.0 client credentials flow and
does not accept static API tokens.

**Chain of thought:** User says "deploy to a service that requires OAuth" or
"the API needs a bearer token from an auth endpoint first" - this means step 1
must obtain a token, and step 2+ use `{{rest.response.1.access_token}}` in
the Authorization header.

**Steps:**

1. `POST` to token endpoint with client credentials - returns `{"access_token": "..."}`
2. Use `{{rest.response.1.access_token}}` as Bearer token in actual API call

**Typical token endpoint payloads:**

- Form-encoded: `grant_type=client_credentials&scope=certificates:write`
- JSON: `{"grant_type": "client_credentials"}`

#### Pattern B: Lookup + Update

**When to use:** The target system identifies resources by an internal ID that
is not known to Horizon. You need to look up the resource by CN, hostname, or
serial first.

**Chain of thought:** User says "update the certificate on the server" or
"replace the certificate for domain X" but the API needs an internal ID,
not the domain name - this means step 1 searches by a known field, and
step 2 updates by the returned ID.

**Steps:**

1. `GET` search endpoint with `{{certificate.san.dnsname.1}}` - returns `{"id": "abc123"}`
2. `PUT` to update endpoint using `{{rest.response.1.id}}`

#### Pattern C: Upload Certificate + Upload Key Separately

**When to use:** The target system has separate endpoints for certificate
and private key, or requires them uploaded sequentially.

**Chain of thought:** User says "the platform requires uploading the cert
first, then the key" or "certificate and key go to different API endpoints."

**Steps:**

1. `POST` certificate PEM to cert endpoint - returns `{"certId": "..."}`
2. `POST` private key to key endpoint, referencing `{{rest.response.1.certId}}`

#### Pattern D: Create + Activate (Two-Phase Deployment)

**When to use:** The target system requires creating a certificate resource
in draft/pending state, then explicitly activating it.

**Chain of thought:** User says "the API has a two-step deployment" or
"certificates need to be activated after upload."

**Steps:**

1. `POST` to create resource - returns `{"id": "...", "status": "pending"}`
2. `POST`/`PATCH` to activate endpoint using `{{rest.response.1.id}}`

#### Pattern E: Deploy + Invalidate Cache

**When to use:** After deploying a certificate, you need to purge a CDN
cache, restart a service, or trigger a reload.

**Chain of thought:** User mentions "CDN", "cache invalidation", "reload
config", or "restart after deploy."

**Steps:**

1. `PUT` certificate to deployment endpoint
2. `POST` to cache purge or reload endpoint

#### Pattern F: Transactional API (Begin + Commit)

**When to use:** The target system wraps changes in transactions that must
be explicitly committed.

**Chain of thought:** User mentions "the API uses transactions" or "changes
must be committed after upload."

**Steps:**

1. `POST` to begin transaction - returns `{"txId": "..."}`
2. `PUT` certificate data, referencing `{{rest.response.1.txId}}`
3. `POST` to commit endpoint using `{{rest.response.1.txId}}`

---

## Template Strings

All URL, header value, and payload fields support template strings.
Template strings use `{{variable}}` syntax to inject dynamic values
from the notification dictionary.

### Syntax

**Simple variable substitution:**

```
{{certificate.serial}}
{{certificate.subject.cn.1}}
{{request.id}}
```

**With computation rules (functions):**

```
{{Upper({{certificate.subject.cn.1}})}}
{{Lower({{certificate.san.dnsname.1}})}}
{{Base64(Raw({{certificate.pem}}))}}
{{DateTimeFormat({{certificate.not_after}}, "yyyy-MM-dd")}}
```

**Behavior when variable is missing:**

- Simple variables: the `{{...}}` placeholder is left as literal text
- Computation rules returning `None`: replaced with an empty string
- Computation rules returning an array: joined as comma-separated string

### JSON Escaping

When a step's headers contain `Content-Type: application/json`, Horizon
automatically JSON-escapes all dictionary values before substitution. This
prevents JSON injection from certificate fields that contain quotes,
backslashes, or newlines (e.g., PEM certificates).

This means you can safely write:

```json
{ "pem": "{{certificate.pem}}" }
```

And the PEM's newlines and special characters will be properly escaped.

### Available Computation Rules in Templates

These functions can wrap dictionary keys in template strings:

**String functions:**

- `Upper(expr)` - uppercase
- `Lower(expr)` - lowercase
- `Trim(expr)` - strip whitespace
- `Substr(expr, start, length)` - substring
- `Concat(expr1, expr2, ...)` - concatenate

**Pattern functions:**

- `Extract(expr, regex)` - extract regex match
- `Replace(expr, regex, replacement)` - regex replace
- `Match(expr, regex)` - test if matches

**Domain functions:**

- `ShortenDNS(expr)` - hostname from FQDN
- `DomainDNS(expr)` - domain from FQDN
- `EmailUser(expr)` - user part of email
- `EmailDomain(expr)` - domain part of email

**Utility functions:**

- `OrElse(expr, fallback)` - default if null
- `First(expr)` - first element of list
- `Last(expr)` - last element of list
- `DateTimeFormat(expr, pattern)` - format a date
- `Base64(expr)` - base64 encode
- `Raw(expr)` - raw string (no escaping)
- `Split(expr, delimiter)` - split string to list
- `Join(expr, delimiter)` - join list to string

See `horizon://knowledge/computation-and-data-flow` for the complete
computation rule reference.

---

## Complete Dictionary Reference

### Certificate Dictionary

Available for events: `on_enroll`, `on_revoke`, `on_update`, `on_recover`,
`on_migrate`, `on_expire`, `on_renew`, `on_import`

| Key                                 | Description                  | Example Value                        |
| ----------------------------------- | ---------------------------- | ------------------------------------ |
| `certificate.id`                    | Horizon internal ID          | `"507f1f77bcf86cd799439011"`         |
| `certificate.module`                | Module name                  | `"webra"`                            |
| `certificate.dn`                    | Full subject DN              | `"CN=web.example.com, O=ACME Corp"`  |
| `certificate.serial`                | Serial number                | `"1a2b3c4d"`                         |
| `certificate.thumbprint`            | SHA-256 thumbprint           | `"ab12cd34..."`                      |
| `certificate.public_key_thumbprint` | Public key thumbprint        | `"ef56gh78..."`                      |
| `certificate.pem`                   | Full PEM-encoded certificate | `"-----BEGIN CERTIFICATE-----\n..."` |
| `certificate.not_before`            | Start date (ISO-8601)        | `"2025-01-15T10:30:00Z"`             |
| `certificate.not_after`             | Expiration date (ISO-8601)   | `"2026-01-15T10:30:00Z"`             |
| `certificate.key_type`              | Key algorithm and size       | `"rsa-2048"`                         |
| `certificate.signing_algorithm`     | Signature algorithm          | `"SHA256withRSA"`                    |
| `certificate.revoked`               | Revocation status            | `"true"` or `"false"`                |
| `certificate.revocation_date`       | When revoked (ISO-8601)      | `"2025-06-01T12:00:00Z"`             |
| `certificate.revocation_reason`     | Revocation reason            | `"keyCompromise"`                    |
| `certificate.issuer`                | Issuer DN                    | `"CN=Issuing CA, O=ACME"`            |
| `certificate.profile`               | Profile name                 | `"web-tls-1y"`                       |
| `certificate.holder_id`             | Unique holder identifier     | `"holder-abc123"`                    |
| `certificate.friendly_name`         | Friendly name                | `"Production Web Cert"`              |
| `certificate.owner`                 | Owner principal              | `"john.doe"`                         |
| `certificate.mail`                  | Contact email                | `"admin@example.com"`                |
| `certificate.auto_renew`            | Auto-renewal status          | `"true"` or `"false"`                |

**Subject fields** (one per DN element type):

- `certificate.subject.cn`, `certificate.subject.cn.1`, `certificate.subject.cn.2`, ...
- `certificate.subject.o`, `certificate.subject.ou`, `certificate.subject.c`, ...
- Valid types: `cn`, `uid`, `serialnumber`, `surname`, `givenname`, `ou`, `o`, `c`, `l`, `st`, `street`, `dc`, `e`, `description`, `organizationidentifier`, `uniqueidentifier`, `unstructuredaddress`, `unstructuredname`

**SAN fields** (one per SAN type):

- `certificate.san.dnsname`, `certificate.san.dnsname.1`, ...
- `certificate.san.ipaddress`, `certificate.san.rfc822name`, ...
- Valid types: `dnsname`, `ipaddress`, `rfc822name`, `uri`, `othername_upn`, `othername_guid`, `registered_id`

**Extension fields:**

- `certificate.extension.ms_sid`, `certificate.extension.ms_template`, `certificate.extension.ms_template_v2`

**Label fields:**

- `certificate.label.<label-name>` - value of a specific label

**Metadata fields:**

- `certificate.metadata.<metadata-name>` - value of a specific metadata entry

**Aggregate string fields** (comma-separated summaries):

- `certificate.sans` - all SANs as `"dnsname: web.example.com, ipaddress: 10.0.0.1"`
- `certificate.extensions` - all extensions formatted
- `certificate.metadata` - all metadata formatted
- `certificate.labels` - all labels formatted

**Team fields:**

- `certificate.team` - team name

**Private key fields** (available when key is centrally generated):

- `certificate.private_key` - PEM private key
- `certificate.private_key_pkcs8` - PKCS#8 PEM format
- `certificate.private_key_pkcs1` - PKCS#1 PEM format (RSA only)

**PKCS#12 fields** (available on enrollment/recovery/renewal):

- `pkcs12` - base64-encoded PKCS#12 bundle
- `pkcs12.password` - PKCS#12 password

### Previous Certificate Dictionary

Available for: `on_renew` event only

All certificate fields above are also available with the prefix
`previous.certificate` instead of `certificate`. This lets you reference
the old certificate being replaced during renewal.

Example: `{{previous.certificate.serial}}`, `{{previous.certificate.thumbprint}}`

### Request Dictionary

Available for events: `on_submit_*`, `on_cancel_*`, `on_approve_*`,
`on_deny_*`, `on_pending_*`

| Key                              | Description                                                                |
| -------------------------------- | -------------------------------------------------------------------------- |
| `request.id`                     | Request ID                                                                 |
| `request.workflow`               | Workflow type: `ENROLL`, `REVOKE`, `UPDATE`, `RECOVER`, `MIGRATE`, `RENEW` |
| `request.module`                 | Module name                                                                |
| `request.status`                 | Request status                                                             |
| `request.profile`                | Profile name                                                               |
| `request.requester`              | Who submitted the request                                                  |
| `request.approver`               | Who approved/denied (if applicable)                                        |
| `request.requester_comment`      | Requester's justification text                                             |
| `request.approver_comment`       | Approver's comment                                                         |
| `request.registration_date`      | Submission date (ISO-8601)                                                 |
| `request.last_modification_date` | Last update (ISO-8601)                                                     |
| `request.password`               | PKCS#12 password or challenge value                                        |
| `request.owner`                  | Owner principal                                                            |
| `request.mail`                   | Contact email                                                              |
| `request.my.url`                 | Link to "My Requests" drawer in Horizon UI                                 |
| `request.manage.url`             | Link to "Manage Requests" drawer in Horizon UI                             |

Request also has subject, SAN, label, metadata, extension, and team
sub-dictionaries with the same structure as certificate (prefixed with
`request.` instead of `certificate.`).

When a request contains a certificate (approved enrollment), the full
certificate dictionary is available under `request.certificate.*`.

### Profile Dictionary

Available in all notification contexts:

| Key                          | Description                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `profile.name`               | Technical profile name                                             |
| `profile.module`             | Module name                                                        |
| `profile.displaynames`       | All display names formatted                                        |
| `profile.displayname.<lang>` | Display name in specific language (e.g., `profile.displayname.en`) |
| `profile.descriptions`       | All descriptions formatted                                         |
| `profile.description.<lang>` | Description in specific language                                   |

### Credentials Dictionary

Available for: `on_credentials_expiration`

| Key                           | Description                      |
| ----------------------------- | -------------------------------- |
| `credentials.name`            | Credential name                  |
| `credentials.description`     | Description                      |
| `credentials.type`            | Type (`password`, `raw`, `x509`) |
| `credentials.expiration_date` | Expiration date                  |

### License Dictionary

Available for: `on_license_expiration`, `on_license_usage`

| Key                       | Description          |
| ------------------------- | -------------------- |
| `license.expiration_date` | License expiration   |
| `license.used`            | Current holder count |
| `license.percent_used`    | Usage percentage     |

### Trigger Error Dictionary

Available for: `on_trigger_error`

| Key                         | Description                    |
| --------------------------- | ------------------------------ |
| `trigger.name`              | Failed trigger name            |
| `trigger.event`             | Event that was being processed |
| `trigger.lastExecutionDate` | Last execution timestamp       |
| `trigger.status`            | Trigger status                 |
| `trigger.retryable`         | `"true"` or `"false"`          |
| `trigger.retries`           | Remaining retry count          |
| `trigger.nextExecutionDate` | Next retry timestamp           |
| `trigger.detail`            | Error details                  |

### REST Response Chaining Dictionary

Available for: steps 2+ in a multi-step sequence

| Key Pattern                     | Description                                  |
| ------------------------------- | -------------------------------------------- |
| `rest.response.<N>.<json.path>` | Parsed JSON field from step N response       |
| `rest.response.<N>.body`        | Full body text if response is not valid JSON |

N is 1-based (first step = 1, second step = 2, etc.).

---

## Event Reference

### Certificate Events (for `events` field)

| Event        | Fires when                               | Requires                       |
| ------------ | ---------------------------------------- | ------------------------------ |
| `on_enroll`  | Certificate is enrolled/issued           | -                              |
| `on_revoke`  | Certificate is revoked                   | -                              |
| `on_update`  | Certificate metadata is updated          | -                              |
| `on_recover` | Private key is recovered                 | -                              |
| `on_migrate` | Certificate is migrated between profiles | -                              |
| `on_renew`   | Certificate is renewed                   | -                              |
| `on_import`  | Certificate is imported                  | -                              |
| `on_expire`  | Certificate expiration check             | `runPeriod` and `runOnRenewed` |

### Request Events

| Event               | Fires when                                                 |
| ------------------- | ---------------------------------------------------------- |
| `on_submit_enroll`  | Enrollment request submitted                               |
| `on_approve_enroll` | Enrollment request approved                                |
| `on_deny_enroll`    | Enrollment request denied                                  |
| `on_cancel_enroll`  | Enrollment request cancelled                               |
| `on_pending_enroll` | Enrollment request pending too long (requires `runPeriod`) |

The same pattern applies for all 7 workflows: `enroll`, `revoke`, `update`,
`recover`, `migrate`, `renew`, `import`. Replace `enroll` with the workflow
name to get the event name.

### System Events

| Event                       | Fires when                         | Requires              |
| --------------------------- | ---------------------------------- | --------------------- |
| `on_license_expiration`     | License approaching expiration     | `runPeriod`           |
| `on_credentials_expiration` | Credentials approaching expiration | `runPeriod`           |
| `on_license_usage`          | License usage crosses threshold    | `licenceUsagePercent` |
| `on_trigger_error`          | Another trigger execution failed   | -                     |

### Critical Constraint

Each REST notification binds to **exactly ONE event**. The `events` array
must contain a single string. To fire on multiple events (e.g., both
`on_enroll` and `on_renew`), create separate REST notifications.

---

## Event Semantics: Direct Actions vs Request/Approve Workflow

Understanding the relationship between certificate events and request events
is CRITICAL for choosing the right event and knowing which dictionary keys
are available.

### Two Paths to Certificate Issuance

Horizon supports two authorization models for lifecycle operations:

**Path 1 - Direct action** (user has full permissions on the profile):

```
User submits enrollment
  -> on_approve_enroll fires (auto-approved)
  -> on_enroll fires (certificate issued)
```

**Path 2 - Request/approve workflow** (user has only request permissions):

```
User submits enrollment request
  -> on_submit_enroll fires (request created, pending)
  ...time passes, approver reviews...
  -> on_approve_enroll fires (request approved)
  -> on_enroll fires (certificate issued)
```

In **both paths**, `on_approve_enroll` and `on_enroll` always fire. The
difference is that in Path 1, `on_approve_enroll` fires immediately (auto-
approval), while in Path 2, it fires when the approver explicitly approves.

This applies identically to all workflows: enroll, revoke, update, recover,
migrate, renew, import.

### PKCS#12 vs Private Key: Which Event Gets What?

This is the most important distinction for certificate deployment:

| Data needed                                      | Available in event                                            | NOT available in                                              |
| ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------- |
| **PKCS#12 bundle** (cert + key in one file)      | `on_approve_enroll`, `on_approve_renew`, `on_approve_recover` | `on_enroll`, `on_renew`, `on_recover`                         |
| **PEM certificate + PEM private key** (separate) | `on_enroll`, `on_renew`, `on_recover`                         | `on_approve_enroll`, `on_approve_renew`, `on_approve_recover` |
| **PEM certificate only** (no key)                | ALL certificate and request events                            | -                                                             |

**Why?** The PKCS#12 bundle is generated during request processing and stored
transiently on the request object. It is available during request events
(`on_approve_*`) but is sanitized before database persistence. The raw private
key, conversely, is a transient in-memory value available only during the
certificate issuance event (`on_enroll`, `on_renew`, `on_recover`).

### Dictionary Availability Matrix by Event Type

#### Certificate events (`on_enroll`, `on_revoke`, `on_renew`, etc.)

| Dictionary                      |    Available    | Notes                                               |
| ------------------------------- | :-------------: | --------------------------------------------------- |
| `certificate.*`                 |       YES       | Full certificate data                               |
| `certificate.private_key`       |       YES       | Only if key was centrally generated (not CSR-based) |
| `certificate.private_key_pkcs8` |       YES       | Only if key was centrally generated                 |
| `certificate.private_key_pkcs1` |       YES       | Only for RSA keys, centrally generated              |
| `pkcs12`                        |     **NO**      | Not available on certificate events                 |
| `pkcs12.password`               |     **NO**      | Not available on certificate events                 |
| `request.*`                     |     **NO**      | No request context on certificate events            |
| `previous.certificate.*`        | only `on_renew` | The certificate being replaced                      |
| `profile.*`                     |       YES       | Profile configuration                               |

#### Request events (`on_submit_enroll`, `on_approve_enroll`, etc.)

| Dictionary                 |     Available     | Notes                                                                                           |
| -------------------------- | :---------------: | ----------------------------------------------------------------------------------------------- |
| `certificate.*`            |        YES        | Via `request.certificate.*` (after approval)                                                    |
| `certificate.private_key*` |      **NO**       | Raw key not available on request events                                                         |
| `pkcs12`                   |        YES        | Only on approval events (`on_approve_enroll/renew/recover`) and only for centralized enrollment |
| `pkcs12.password`          |        YES        | Same as above                                                                                   |
| `request.*`                |        YES        | Full request data including workflow, requester, comments                                       |
| `request.certificate.*`    |        YES        | Certificate nested in request (after issuance)                                                  |
| `previous.certificate.*`   | only `on_*_renew` | On renewal request events                                                                       |
| `profile.*`                |        YES        | Profile configuration                                                                           |

### Choosing the Right Event for Your Use Case

| I need to...                              | Use this event                           | Why                                                    |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| Deploy cert PEM + private key separately  | `on_enroll` / `on_renew`                 | Only certificate events have `certificate.private_key` |
| Deploy PKCS#12 bundle                     | `on_approve_enroll` / `on_approve_renew` | Only request approval events have `pkcs12`             |
| Notify requester about approval decision  | `on_approve_enroll` / `on_deny_enroll`   | Request events have `request.requester`                |
| Create a ticket when request is submitted | `on_submit_enroll`                       | Fires immediately when user submits                    |
| Track the old serial being replaced       | `on_renew` or `on_approve_renew`         | `previous.certificate.serial` available                |
| Alert on certificate expiration           | `on_expire`                              | Requires `runPeriod` and `runOnRenewed`                |
| Alert on license threshold                | `on_license_usage`                       | Requires `licenceUsagePercent`                         |

---

## Duration Format

The `timeout` and `runPeriod` fields accept duration strings:

| Unit         | Short | Long                                             |
| ------------ | ----- | ------------------------------------------------ |
| Days         | `d`   | `day`, `days`                                    |
| Hours        | `h`   | `hour`, `hours`                                  |
| Minutes      | `m`   | `min`, `mins`, `minute`, `minutes`               |
| Seconds      | `s`   | `sec`, `secs`, `second`, `seconds`               |
| Milliseconds | `ms`  | `milli`, `millis`, `millisecond`, `milliseconds` |

Examples: `"30 seconds"`, `"5m"`, `"24h"`, `"7 days"`, `"30000ms"`

---

## Error Handling and Retries

### Retry Behavior

When a REST notification fails:

1. A `TriggerResult` with status `FAILURE` is recorded
2. If `retries > 0`, the notification is rescheduled with exponential backoff
3. Each retry doubles the delay: 1st retry after ~1 delay, 2nd after ~2x delay, etc.
4. Retries decrement until reaching 0, then the notification stays in FAILURE state

### What Counts as Failure

- HTTP response code NOT in `expectedHttpCodes`
- Connection error (DNS failure, timeout, refused)
- TLS handshake failure (for mTLS / x509 auth)
- Any step in a multi-step sequence failing (fail-fast)

### Sub-Triggers for Error Handling

You can chain error-handling triggers using `triggers.onTriggerError`:

```json
{
  "name": "deploy-cert",
  "type": "rest",
  "events": ["on_enroll"],
  "sequence": [...],
  "triggers": {
    "onTriggerError": ["notify-ops-team"]
  }
}
```

The `"notify-ops-team"` trigger fires with `on_trigger_error` event context
and has access to the `trigger.*` dictionary keys describing the failure.

**Constraint**: Triggers that subscribe to `on_trigger_error` CANNOT have
their own `onTriggerError` sub-triggers (prevents infinite loops).

---

## Real-World Examples

### Example 1: Deploy Certificate to a Load Balancer API

When a certificate is enrolled or renewed, push it to a load balancer:

```json
{
  "name": "deploy-to-nginx-api",
  "type": "rest",
  "retries": 5,
  "events": ["on_enroll"],
  "sequence": [
    {
      "url": "https://lb-manager.internal/api/v1/certificates",
      "authenticationType": "bearer",
      "credentials": "lb-api-token",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"domain\": \"{{certificate.san.dnsname.1}}\", \"certificate\": \"{{certificate.pem}}\", \"private_key\": \"{{certificate.private_key}}\", \"serial\": \"{{certificate.serial}}\"}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200, 201]
    }
  ]
}
```

Create a second trigger for `on_renew` with the same sequence to also handle
renewals.

### Example 2: Multi-Step OAuth + API Call

First obtain an OAuth token, then use it to deploy:

```json
{
  "name": "deploy-with-oauth",
  "type": "rest",
  "retries": 3,
  "events": ["on_enroll"],
  "sequence": [
    {
      "url": "https://auth.example.com/oauth/token",
      "authenticationType": "basic",
      "credentials": "oauth-client-creds",
      "method": "POST",
      "headers": [
        { "name": "Content-Type", "value": "application/x-www-form-urlencoded" }
      ],
      "payloadType": "text",
      "payload": "grant_type=client_credentials&scope=certificates:write",
      "timeout": "10 seconds",
      "expectedHttpCodes": [200]
    },
    {
      "url": "https://api.example.com/certificates/{{certificate.san.dnsname.1}}",
      "authenticationType": "noauth",
      "method": "PUT",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        {
          "name": "Authorization",
          "value": "Bearer {{rest.response.1.access_token}}"
        }
      ],
      "payloadType": "json",
      "payload": "{\"pem\": \"{{certificate.pem}}\", \"key\": \"{{certificate.private_key}}\", \"chain\": \"{{certificate.pem}}\"}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200, 201, 204]
    }
  ]
}
```

**How it works:**

1. Step 1 calls the OAuth endpoint with Basic auth (client ID + secret)
2. The OAuth response `{"access_token": "eyJ..."}` is parsed
3. Step 2 references `{{rest.response.1.access_token}}` in the Authorization header

### Example 3: Update DNS Record for ACME Challenge

Create a TXT record for DNS-01 validation:

```json
{
  "name": "create-acme-dns-record",
  "type": "rest",
  "retries": 3,
  "events": ["on_submit_enroll"],
  "sequence": [
    {
      "url": "https://dns-api.example.com/v1/zones/example.com/records",
      "authenticationType": "custom",
      "credentials": "dns-api-key",
      "method": "POST",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "X-API-Key", "value": "{{credentials.key}}" }
      ],
      "payloadType": "json",
      "payload": "{\"type\": \"TXT\", \"name\": \"_acme-challenge.{{certificate.san.dnsname.1}}\", \"content\": \"{{certificate.metadata.acme_challenge}}\", \"ttl\": 300}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [200, 201]
    }
  ]
}
```

### Example 4: Push Certificate to IoT Device Management Platform

Deploy certificates with embedded private key data for Wi-Fi EAP-TLS profiles:

```json
{
  "name": "push-to-iot-platform",
  "type": "rest",
  "retries": 10,
  "events": ["on_enroll"],
  "sequence": [
    {
      "url": "https://iot-platform.example.com/api/devices/{{certificate.label.deviceId}}/certificates",
      "authenticationType": "custom",
      "credentials": "iot-api-key",
      "method": "PATCH",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "x-api-key", "value": "{{credentials.key}}" }
      ],
      "payloadType": "json",
      "payload": "{\"clientCert\": {\"data\": \"{{Base64(Raw({{certificate.pem}}))}}\", \"name\": \"{{certificate.serial}}.pem\"}, \"clientKey\": {\"data\": \"{{Base64(Raw({{certificate.private_key_pkcs1}}))}}\", \"name\": \"{{certificate.serial}}.key\"}}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200]
    }
  ]
}
```

**Note:** `Base64(Raw(...))` double-encodes the PEM to base64, which is
required by some APIs that expect binary certificate data as base64 strings
within a JSON payload.

### Example 5: Notify SIEM on Revocation

Push revocation events to a SIEM or log aggregation system:

```json
{
  "name": "siem-revocation-alert",
  "type": "rest",
  "retries": 5,
  "events": ["on_revoke"],
  "sequence": [
    {
      "url": "https://siem.example.com/api/events",
      "authenticationType": "bearer",
      "credentials": "siem-token",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"event_type\": \"certificate_revoked\", \"severity\": \"high\", \"certificate_dn\": \"{{certificate.dn}}\", \"serial\": \"{{certificate.serial}}\", \"revocation_reason\": \"{{certificate.revocation_reason}}\", \"revocation_date\": \"{{certificate.revocation_date}}\", \"profile\": \"{{certificate.profile}}\", \"owner\": \"{{certificate.owner}}\"}",
      "timeout": "10 seconds",
      "expectedHttpCodes": [200, 201, 202]
    }
  ]
}
```

### Example 6: Multi-Step - Create Resource Then Activate It

Some APIs require creating a resource first, then activating it:

```json
{
  "name": "create-and-activate",
  "type": "rest",
  "retries": 3,
  "events": ["on_enroll"],
  "sequence": [
    {
      "url": "https://api.example.com/certificates",
      "authenticationType": "bearer",
      "credentials": "api-token",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"cn\": \"{{certificate.subject.cn.1}}\", \"pem\": \"{{certificate.pem}}\"}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [201]
    },
    {
      "url": "https://api.example.com/certificates/{{rest.response.1.id}}/activate",
      "authenticationType": "bearer",
      "credentials": "api-token",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"activate\": true}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200]
    }
  ]
}
```

**How it works:**

1. Step 1 creates the certificate resource and returns `{"id": "cert-abc123", ...}`
2. Step 2 uses `{{rest.response.1.id}}` in the URL to activate the newly created resource

### Example 7: Expiration Warning to External Ticketing System

Create a ticket 30 days before certificate expiration:

```json
{
  "name": "create-expiry-ticket-30d",
  "type": "rest",
  "retries": 3,
  "runPeriod": "30 days",
  "runOnRenewed": false,
  "events": ["on_expire"],
  "sequence": [
    {
      "url": "https://jira.example.com/rest/api/2/issue",
      "authenticationType": "basic",
      "credentials": "jira-service-account",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"fields\": {\"project\": {\"key\": \"OPS\"}, \"summary\": \"Certificate expiring: {{certificate.subject.cn.1}}\", \"description\": \"Certificate {{certificate.dn}} (serial: {{certificate.serial}}) expires on {{DateTimeFormat({{certificate.not_after}}, \\\"yyyy-MM-dd\\\")}}. Profile: {{certificate.profile}}. Owner: {{OrElse({{certificate.owner}}, \\\"unassigned\\\")}}\", \"issuetype\": {\"name\": \"Task\"}, \"priority\": {\"name\": \"High\"}}}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [201]
    }
  ]
}
```

**Key points:**

- `runPeriod: "30 days"` means this fires 30 days before expiration
- `runOnRenewed: false` means it won't fire if the certificate was already renewed
- Uses `DateTimeFormat()` to format the expiration date
- Uses `OrElse()` to provide a fallback if owner is not set

---

## Advanced Use-Cases

These examples demonstrate complex, real-world deployment scenarios that
require multi-step chaining, creative workarounds for fire-and-forget
constraints, and careful event selection.

### Use-Case A: ServiceNow Incident on Certificate Expiration with Team Assignment

**Goal:** When a certificate is about to expire, create a ServiceNow incident
and assign it to the team that owns the certificate. This requires looking up
the team's ServiceNow assignment group ID first.

**Why multi-step:** ServiceNow needs an `assignment_group` sys_id, but Horizon
only has the team name. Step 1 looks up the sys_id, step 2 creates the incident.

```json
{
  "name": "servicenow-expiry-incident",
  "type": "rest",
  "retries": 5,
  "runPeriod": "30 days",
  "runOnRenewed": false,
  "events": ["on_expire"],
  "sequence": [
    {
      "url": "https://myinstance.service-now.com/api/now/table/sys_user_group?sysparm_query=name={{certificate.team}}&sysparm_fields=sys_id,name&sysparm_limit=1",
      "authenticationType": "basic",
      "credentials": "servicenow-api-creds",
      "method": "GET",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "Accept", "value": "application/json" }
      ],
      "timeout": "15 seconds",
      "expectedHttpCodes": [200]
    },
    {
      "url": "https://myinstance.service-now.com/api/now/table/incident",
      "authenticationType": "basic",
      "credentials": "servicenow-api-creds",
      "method": "POST",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "Accept", "value": "application/json" }
      ],
      "payloadType": "json",
      "payload": "{\"short_description\": \"Certificate expiring: {{certificate.subject.cn.1}}\", \"description\": \"Certificate {{certificate.dn}} (serial: {{certificate.serial}}) expires on {{DateTimeFormat({{certificate.not_after}}, \\\"yyyy-MM-dd\\\")}}. Profile: {{certificate.profile}}. Owner: {{OrElse({{certificate.owner}}, \\\"unassigned\\\")}}.\", \"urgency\": \"2\", \"impact\": \"2\", \"assignment_group\": \"{{rest.response.1.result.1.sys_id}}\", \"category\": \"certificate\", \"subcategory\": \"expiration\"}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [201]
    }
  ]
}
```

**How chaining works:**

1. Step 1 queries ServiceNow's `sys_user_group` table filtering by the
   certificate's team name (`{{certificate.team}}`). ServiceNow returns
   JSON: `{"result": [{"sys_id": "abc123", "name": "DevOps"}]}`
2. Step 2 references `{{rest.response.1.result.1.sys_id}}` to use the
   resolved group sys_id as the `assignment_group` for the incident.

### Use-Case B: Jira ITSM Ticket on License Expiration

**Goal:** Create a high-priority Jira ticket when the Horizon license is
about to expire or when the license cap is about to be reached.

**For license expiration:**

```json
{
  "name": "jira-license-expiry",
  "type": "rest",
  "retries": 3,
  "runPeriod": "30 days",
  "events": ["on_license_expiration"],
  "sequence": [
    {
      "url": "https://jira.example.com/rest/api/2/issue",
      "authenticationType": "basic",
      "credentials": "jira-service-account",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"fields\": {\"project\": {\"key\": \"OPS\"}, \"summary\": \"Horizon license expiring on {{license.expiration_date}}\", \"description\": \"The Horizon CLM license expires on {{license.expiration_date}}. Current usage: {{license.used}} / {{license.limit}} holders ({{license.percent_used}}%). Please renew the license before expiration to avoid service disruption.\", \"issuetype\": {\"name\": \"Task\"}, \"priority\": {\"name\": \"High\"}}}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [201]
    }
  ]
}
```

**For license usage threshold (e.g., 80%):**

```json
{
  "name": "jira-license-usage-80pct",
  "type": "rest",
  "retries": 3,
  "licenceUsagePercent": 80,
  "events": ["on_license_usage"],
  "sequence": [
    {
      "url": "https://jira.example.com/rest/api/2/issue",
      "authenticationType": "basic",
      "credentials": "jira-service-account",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"fields\": {\"project\": {\"key\": \"OPS\"}, \"summary\": \"Horizon license usage at {{license.percent_used}}%\", \"description\": \"License usage has reached {{license.percent_used}}% ({{license.used}} / {{license.limit}} holders, {{license.available}} remaining). Consider upgrading the license.\", \"issuetype\": {\"name\": \"Task\"}, \"priority\": {\"name\": \"High\"}}}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [201]
    }
  ]
}
```

### Use-Case C: Close ServiceNow Incident on Certificate Renewal

**Goal:** When a certificate is renewed, close the expiration incident that
was previously opened.

**Challenge:** REST notifications are fire-and-forget - Horizon does not store
the incident number from the creation step. You must use a creative approach.

**Solution:** Use the certificate's serial number or thumbprint as a
correlation key. When creating the incident (Use-Case A), include the serial
in a custom field. When closing, search ServiceNow by that correlation key.

```json
{
  "name": "servicenow-close-on-renew",
  "type": "rest",
  "retries": 3,
  "events": ["on_renew"],
  "sequence": [
    {
      "url": "https://myinstance.service-now.com/api/now/table/incident?sysparm_query=category=certificate^subcategory=expiration^short_descriptionLIKE{{previous.certificate.subject.cn.1}}^state!=7&sysparm_fields=sys_id,number&sysparm_limit=1",
      "authenticationType": "basic",
      "credentials": "servicenow-api-creds",
      "method": "GET",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "Accept", "value": "application/json" }
      ],
      "timeout": "15 seconds",
      "expectedHttpCodes": [200]
    },
    {
      "url": "https://myinstance.service-now.com/api/now/table/incident/{{rest.response.1.result.1.sys_id}}",
      "authenticationType": "basic",
      "credentials": "servicenow-api-creds",
      "method": "PATCH",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "Accept", "value": "application/json" }
      ],
      "payloadType": "json",
      "payload": "{\"state\": \"7\", \"close_code\": \"Solved (Permanently)\", \"close_notes\": \"Certificate renewed. New serial: {{certificate.serial}}, new expiry: {{DateTimeFormat({{certificate.not_after}}, \\\"yyyy-MM-dd\\\")}}\"}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [200]
    }
  ]
}
```

**How it works:**

1. Step 1 searches ServiceNow for open incidents (`state!=7`) in the
   `certificate/expiration` category that mention the **previous** certificate's
   CN (`{{previous.certificate.subject.cn.1}}` - available on `on_renew`).
2. Step 2 uses the returned `sys_id` to close the incident with resolution notes
   including the new certificate serial and expiration date.

**Important:** This uses `previous.certificate.subject.cn.1` (the old cert's CN)
to find the matching incident, because the incident was created with the old
certificate's CN. The `previous.certificate.*` dictionary is only available
on `on_renew` events.

**Alternative correlation approaches:**

- Store the certificate thumbprint in a ServiceNow custom field during creation,
  search by `{{previous.certificate.thumbprint}}` during closure
- Use a label on the certificate to store an external reference (if the external
  system's identifier is known at enrollment time)

### Use-Case D: Deploy TLS Certificate to a vCenter-Managed Host

**Goal:** After enrollment, deploy the certificate and private key to a
VMware vCenter/ESXi host via the vSphere Automation REST API.

**Event choice:** Use `on_enroll` because we need `certificate.private_key`
(PEM format), which is only available on certificate events (not request events).
If you need the PKCS#12 bundle instead, use `on_approve_enroll`.

**Authentication note:** The vSphere REST API uses session-based auth - step 1
obtains a session token via Basic auth, step 2 uses it to deploy the certificate.
This is Pattern A (token acquisition + API call).

```json
{
  "name": "deploy-to-vcenter-host",
  "type": "rest",
  "retries": 3,
  "events": ["on_enroll"],
  "sequence": [
    {
      "url": "https://{{certificate.san.dnsname.1}}/api/session",
      "authenticationType": "basic",
      "credentials": "vcenter-admin",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [201]
    },
    {
      "url": "https://{{certificate.san.dnsname.1}}/api/vcenter/certificate-management/vcenter/tls",
      "authenticationType": "noauth",
      "method": "PUT",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "vmware-api-session-id", "value": "{{rest.response.1.body}}" }
      ],
      "payloadType": "json",
      "payload": "{\"spec\": {\"cert\": \"{{certificate.pem}}\", \"key\": \"{{certificate.private_key}}\"}}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200, 204]
    }
  ]
}
```

**How it works:**

1. Step 1 authenticates to the vSphere API with Basic auth, receiving a session
   token in the response body.
2. Step 2 uses `noauth` (because auth is in the custom header) and passes the
   session token via `vmware-api-session-id: {{rest.response.1.body}}`.
3. The certificate PEM and private key are sent in the vSphere `spec` format.

**Note:** The URL uses `{{certificate.san.dnsname.1}}` to dynamically target
the host by its DNS SAN. The `certificate.private_key` field is only
available when the key was centrally generated by Horizon (not CSR-based
enrollment).

For PKCS#12-based deployment (e.g., systems that accept .pfx files):

```json
{
  "name": "deploy-pkcs12-to-target",
  "type": "rest",
  "events": ["on_approve_enroll"],
  "sequence": [
    {
      "url": "https://target-system.example.com/api/certificates",
      "authenticationType": "bearer",
      "credentials": "target-api-token",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"pkcs12\": \"{{pkcs12}}\", \"password\": \"{{pkcs12.password}}\", \"hostname\": \"{{request.certificate.san.dnsname.1}}\"}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200, 201]
    }
  ]
}
```

**Key difference:** This uses `on_approve_enroll` (not `on_enroll`) because
the PKCS#12 bundle is only available during request approval events. Note
that `request.certificate.san.dnsname.1` is used instead of `certificate.san.dnsname.1`
because on request events the certificate is nested under the request.

---

## Attaching REST Notifications to Profiles

After creating a REST notification, you must attach it to one or more
certificate profiles for it to fire. Triggers are attached via the profile's
`triggerHooks` object.

Triggers are attached to profiles by updating the profile's `triggerHooks`
object via the Horizon admin UI or the profile API (`PUT /api/v1/profiles/`).
Each event maps to a hook field: `on_enroll` -> `onEnroll`,
`on_approve_enroll` -> `onApproveEnroll`, etc.
See `horizon://knowledge/automation` for the full hook field mapping.

---

## Key Considerations

1. **Immutable names**: REST notification names are primary keys and CANNOT
   be changed after creation. Choose meaningful names.

2. **One event per notification**: Each notification binds to exactly one
   event. Create separate notifications for `on_enroll` and `on_renew`.

3. **Template variable availability**: Not all dictionary keys are available
   for all events. Certificate fields are only available for certificate
   events, request fields only for request events. See the dictionary
   reference above.

4. **JSON auto-escaping**: When `Content-Type: application/json` is set,
   dictionary values are automatically JSON-escaped. Do not double-escape.

5. **Credentials must exist first**: Referenced credentials must be created
   in Horizon before creating the REST notification.

6. **Timeout tuning**: Set appropriate timeouts. Too short causes false
   failures. Too long blocks the notification queue.

7. **Expected HTTP codes**: Be explicit about which codes mean success.
   A `204 No Content` is common for PUT/DELETE operations but must be
   listed in `expectedHttpCodes`.

8. **Private key availability**: `certificate.private_key` and related
   fields are only available when the key was centrally generated by Horizon.
   Decentralized key generation (CSR-based) does not make the key available.

9. **Multi-step ordering**: Steps execute strictly in order. Design your
   sequence so that each step builds on the previous one's response.

10. **Error notification chains**: Use `triggers.onTriggerError` to create
    alerting chains. A common pattern is to have a Slack/Teams webhook that
    fires when a REST deployment fails.

---

## Related Resources

- `horizon://knowledge/automation` - trigger attachment, execution policies, all trigger types
- `horizon://knowledge/computation-and-data-flow` - complete computation rule reference
- `horizon://knowledge/dictionary-entries` - dictionary entry matrix by context and module
- `horizon://knowledge/profiles` - profile configuration and trigger hooks
- `horizon://knowledge/workflows` - certificate lifecycle workflows and events
