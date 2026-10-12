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
6. If a step fails (response code outside `expectedHttpCodes`, or a connection error), Horizon does not call the remaining steps and the notification fails

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

| Field                     | Type         | Required    | Description                                                                                                                                                                                                                 |
| ------------------------- | ------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                    | string       | yes         | Unique identifier (IMMUTABLE - cannot be changed after creation)                                                                                                                                                            |
| `type`                    | string       | yes         | Must be `"rest"`                                                                                                                                                                                                            |
| `events`                  | list[string] | yes         | Exactly ONE event - e.g., `["on_enroll"]`                                                                                                                                                                                   |
| `retries`                 | integer      | no          | Number of retries when the notification fails                                                                                                                                                                               |
| `runPeriod`               | string       | conditional | Duration string - MANDATORY for `on_expire`, `on_pending_*`, `on_license_expiration`, `on_credentials_expiration`. FORBIDDEN for all others. Examples: `"24h"`, `"7d"`, `"30 days"`                                         |
| `runOnRenewed`            | boolean      | conditional | MANDATORY for `on_expire` only. If true, fires even if certificate was already renewed                                                                                                                                      |
| `licenceUsagePercent`     | integer      | conditional | MANDATORY for `on_license_usage` only. Threshold 1-100                                                                                                                                                                      |
| `sequence`                | list[object] | yes         | Ordered list of REST call steps (see below)                                                                                                                                                                                 |
| `triggers.onTriggerError` | list[string] | no          | Notification triggers to run when this notification fails ("On execution error" in the UI). Each must use the `on_trigger_error` event; other names are ignored. Not allowed when this notification uses `on_trigger_error` |

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

No auth headers are added automatically. The credential values become
template keys that you can use in headers and in the payload (not in the URL).

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

#### Pattern C: Create + Activate (Two-Phase Deployment)

**When to use:** The target system requires creating a certificate resource
in draft/pending state, then explicitly activating it.

**Chain of thought:** User says "the API has a two-step deployment" or
"certificates need to be activated after upload."

**Steps:**

1. `POST` to create resource - returns `{"id": "...", "status": "pending"}`
2. `POST`/`PATCH` to activate endpoint using `{{rest.response.1.id}}`

#### Pattern D: Deploy + Invalidate Cache

**When to use:** After deploying a certificate, you need to purge a CDN
cache, restart a service, or trigger a reload.

**Chain of thought:** User mentions "CDN", "cache invalidation", "reload
config", or "restart after deploy."

**Steps:**

1. `PUT` certificate to deployment endpoint
2. `POST` to cache purge or reload endpoint

#### Pattern E: Transactional API (Begin + Commit)

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

When a step has a `Content-Type: application/json` header, Horizon
JSON-escapes certificate and request values from the event dictionary before
substitution. Quotes, backslashes and newlines in `{{certificate.pem}}` stay
valid inside a JSON string. Write `{ "pem": "{{certificate.pem}}" }` and do
not escape it again.

This automatic escaping does not cover `rest.response.*` or authentication
credential values. Use `EscapeJson` when you insert these raw values into a
JSON string:

```json
{
  "owner": "{{EscapeJson({{rest.response.1.owner}})}}",
  "token": "{{EscapeJson({{credentials.key}})}}"
}
```

Horizon 2.10 needs the exact value `application/json`. Horizon 2.11 also
accepts parameters (`application/json; charset=utf-8`) and `+json` types.
Other content types get raw values.

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

**Private key fields** (`on_enroll` and `on_renew`, and `on_import` when the
import includes the key; only when Horizon has the private key):

- `certificate.private_key` - PEM private key
- `certificate.private_key_pkcs8` - PKCS#8 PEM
- `certificate.private_key_pkcs1` - PKCS#1 PEM (RSA only)

`on_recover` and request events do not get these keys.

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

**PKCS#12 fields** (`on_approve_enroll`, `on_approve_renew`,
`on_approve_recover` for WebRA requests, only when Horizon generated the key
pair):

- `pkcs12` - base64 PKCS#12 bundle
- `pkcs12.password` - PKCS#12 password

On request events, use `request.certificate.*` for certificate fields.

### Profile Dictionary

Available in all notification contexts:

| Key                          | Description                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| `profile.name`               | Technical profile name                                              |
| `profile.module`             | Module name                                                         |
| `profile.displaynames`       | All display names formatted                                         |
| `profile.displayname.<lang>` | Display name in one language (for example `profile.displayname.en`) |
| `profile.descriptions`       | All descriptions formatted                                          |
| `profile.description.<lang>` | Description in one language                                         |

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

| Key                       | Description                                       |
| ------------------------- | ------------------------------------------------- |
| `license.expiration_date` | License expiration                                |
| `license.used`            | Current holder count, only for `on_license_usage` |
| `license.percent_used`    | Usage percentage, only for `on_license_usage`     |
| `license.limit`           | Holder limit, only for `on_license_usage`         |
| `license.available`       | Remaining holders, only for `on_license_usage`    |

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

A WebRA request fires `on_approve_<workflow>` when it is approved, and the
certificate event (`on_enroll`, `on_renew`, ...) when the operation runs.

- Direct action (the user may run it without approval): `on_approve_*`
  fires at once. `on_submit_*` does not fire.
- Request workflow: `on_submit_*` fires when the pending request is
  created. `on_approve_*` fires when an approver approves it.

| Data needed                 | Event                                                               |
| --------------------------- | ------------------------------------------------------------------- |
| PEM certificate             | Certificate events; `request.certificate.*` on request events       |
| PEM private key             | `on_enroll`, `on_renew`; `on_import` when the import includes a key |
| PKCS#12 bundle and password | `on_approve_enroll`, `on_approve_renew`, `on_approve_recover`       |

Private keys are available when Horizon generated the key pair or an import
included the key. PKCS#12 fields need a key pair that Horizon generated. See the
[notification guide](https://docs.evertrust.fr/horizon/2.11/admin-guide/notifications/rest.html).

Use dictionary keys documented for the selected event. `request.password`
is the PKCS#12 password or challenge value. `request.certificate` contains
the request's certificate. `previous.certificate` is documented for renewal
notifications. See the public
[dictionary reference](https://docs.evertrust.fr/horizon/2.11/admin-guide/other/dictionary_entries.html).

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

Trigger results expose `status` (`success` or `failure`), remaining
`retries`, `nextExecutionDate`, and `nextDelay`.

When a notification fails and `retries` is above 0, Horizon runs it again
later. Each retry lowers `retries` by one and doubles `nextDelay`. When
`retries` reaches 0, or is not set, the result stays `failure`.

### What Counts as Failure

- HTTP response code NOT in `expectedHttpCodes`
- Connection error (DNS failure, timeout, refused)
- TLS handshake failure (for mTLS / x509 auth)
- A failed step in a multi-step sequence (later steps are not called)

### Error Notifications

Set `triggers.onTriggerError` to send an alert when this notification fails:

```json
{
  "name": "deploy-cert",
  "type": "rest",
  "events": ["on_enroll"],
  "sequence": [
    {
      "url": "https://api.example.com/certificates",
      "method": "POST",
      "authenticationType": "noauth",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200],
      "payload": "{{certificate.pem}}"
    }
  ],
  "triggers": { "onTriggerError": ["notify-ops-team"] }
}
```

`notify-ops-team` must use the `on_trigger_error` event. It gets the
`trigger.*` keys. A trigger with the `on_trigger_error` event cannot set
`triggers`: Horizon rejects it with "triggers cannot be specified on event
'on_trigger_error'".

---
