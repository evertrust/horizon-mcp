# Horizon Automation -- Triggers, Execution Policies, and Trust Chains

## Overview

Horizon automation enables certificate lifecycle actions to happen
automatically in response to events. The three pillars of automation are:

- **Triggers** -- event-driven notification and webhook rules
- **Execution Policies** -- schedules and constraints for automated operations
- **Trust Chains** -- automatic CA chain management for issued certificates

---

## Triggers

A trigger watches for certificate lifecycle events and executes notification
actions when conditions match.

### Trigger Types

| Type        | Description                                                   |
|-------------|---------------------------------------------------------------|
| `email`     | Send email notifications using configurable templates         |
| `webhook`   | Call an external HTTP endpoint with a JSON payload             |
| `thirdparty`| Invoke a third-party connector (publish, sync, etc.)          |
| `groupware` | Integration with groupware systems (calendars, ticketing)     |

### Trigger Structure

```json
{
  "name": "notify-expiring-30d",
  "type": "email",
  "description": "Notify certificate contacts 30 days before expiry",
  "events": ["on_expire"],
  "configuration": {
    "template": "expiration-warning",
    "recipients": ["{{ certificate.contactEmail }}"]
  },
  "retries": 3,
  "runPeriod": "P1D",
  "runOnRenewed": false
}
```

### Event Names

Triggers subscribe to events using snake_case event names. Each event maps
to a hook field on the profile's `triggerHooks` object.

#### Enrollment Events

| Event                | Fires when                                  | Hook Type |
|----------------------|---------------------------------------------|-----------|
| `on_enroll`          | Certificate is enrolled (issued)            | sync      |
| `on_pending_enroll`  | Enrollment enters pending queue             | async     |
| `on_submit_enroll`   | Enrollment request is submitted             | sync      |
| `on_approve_enroll`  | Enrollment request is approved              | sync      |
| `on_deny_enroll`     | Enrollment request is denied                | sync      |
| `on_cancel_enroll`   | Enrollment request is cancelled             | sync      |

#### Revocation Events

| Event                | Fires when                                  | Hook Type |
|----------------------|---------------------------------------------|-----------|
| `on_revoke`          | Certificate is revoked                      | sync      |
| `on_submit_revoke`   | Revocation request is submitted             | sync      |
| `on_approve_revoke`  | Revocation request is approved              | sync      |
| `on_deny_revoke`     | Revocation request is denied                | sync      |
| `on_cancel_revoke`   | Revocation request is cancelled             | sync      |

#### Renewal Events

| Event                | Fires when                                  | Hook Type |
|----------------------|---------------------------------------------|-----------|
| `on_renew`           | Certificate is renewed                      | sync      |
| `on_pending_renew`   | Renewal enters pending queue                | async     |
| `on_submit_renew`    | Renewal request is submitted                | sync      |
| `on_approve_renew`   | Renewal request is approved                 | sync      |
| `on_deny_renew`      | Renewal request is denied                   | sync      |
| `on_cancel_renew`    | Renewal request is cancelled                | sync      |

#### Other Lifecycle Events

| Event                | Fires when                                  | Hook Type |
|----------------------|---------------------------------------------|-----------|
| `on_update`          | Certificate metadata is updated             | sync      |
| `on_recover`         | Key is recovered                            | sync      |
| `on_migrate`         | Certificate is migrated                     | sync      |
| `on_import`          | Certificate is imported                     | sync      |
| `on_expire`          | Certificate expiration check triggers       | async     |

Each event also has submit/approve/deny/cancel variants for the full
request lifecycle.

### Sync vs. Async Hooks

- **Sync hooks** store trigger names as plain strings in a list.
  They fire during the action processing and can block the workflow.
- **Async hooks** store trigger references as objects (`{"name": "trigger-name"}`).
  They fire after the action completes and do not block the workflow.

### Attaching Triggers to Profiles

Triggers are attached to profiles via the `triggerHooks` object on the profile.
The MCP server provides `attach_trigger_to_profile` and
`detach_trigger_from_profile` tools that auto-map trigger events to the
correct hook fields.

---

## Execution Policies

Execution policies control the timing and constraints of automated actions
at the profile level.

### Policy Settings

| Setting              | Type    | Description                                           |
|----------------------|---------|-------------------------------------------------------|
| `autoRenewalEnabled` | boolean | Enable automatic renewal for this profile             |
| `autoRenewalDays`    | number  | Days before expiry to trigger auto-renewal            |
| `maxConcurrentOps`   | number  | Maximum concurrent automated operations               |
| `retryPolicy`        | object  | Retry behavior for failed operations                  |

### Retry Policy

```json
{
  "retryPolicy": {
    "maxRetries": 3,
    "backoffMs": 60000,
    "backoffMultiplier": 2.0
  }
}
```

---

## Trust Chains

Trust chain management ensures that issued certificates include the correct
CA certificate chain. Horizon manages trust chains as CA objects.

### Trust Chain Object

```json
{
  "name": "internal-ca-chain",
  "certificates": ["intermediate-ca-pem", "root-ca-pem"],
  "autoUpdate": true,
  "source": "pki-connector"
}
```

### Chain Sources

| Source          | Description                                     |
|-----------------|-------------------------------------------------|
| `manual`        | Manually uploaded CA certificates               |
| `pki-connector` | Automatically fetched from the PKI connector    |
| `discovery`     | Extracted from discovered certificate chains    |

---

## Trigger API Operations

| Operation        | Method | Path                            |
|------------------|--------|---------------------------------|
| List triggers    | GET    | `/api/v1/triggers`              |
| Get trigger      | GET    | `/api/v1/triggers/{name}`       |
| Create trigger   | POST   | `/api/v1/triggers`              |
| Update trigger   | PUT    | `/api/v1/triggers/` (name in JSON body) |
| Delete trigger   | DELETE | `/api/v1/triggers/{name}`       |
| Simulate trigger | PATCH  | `/api/v1/triggers/` (name in JSON body) |

---

## Common Automation Patterns

### Expiration Notification at 30/14/7 Days

Create three triggers with different `runPeriod` values, all subscribing to
`on_expire`, and attach them to the profile.

### Publish Certificate to Load Balancer on Enrollment

```json
{
  "name": "publish-to-f5",
  "type": "thirdparty",
  "events": ["on_enroll", "on_renew"],
  "configuration": { "connector": "f5-prod" }
}
```

### Notify Security Team on Revocation

```json
{
  "name": "notify-revocation",
  "type": "email",
  "events": ["on_revoke"],
  "configuration": {
    "template": "revocation-alert",
    "recipients": ["security-team@example.com"]
  }
}
```

### Webhook Integration on Any Lifecycle Event

```json
{
  "name": "webhook-all-events",
  "type": "webhook",
  "events": ["on_enroll", "on_revoke", "on_renew", "on_update"],
  "configuration": {
    "url": "https://hooks.example.com/horizon",
    "method": "POST",
    "headers": { "Authorization": "Bearer {{ secret }}" }
  }
}
```

---

## Key Considerations

1. **Trigger ordering**: Multiple triggers can match the same event. They
   execute independently -- there is no guaranteed ordering between triggers.

2. **Failure handling**: If a trigger action fails, it follows the configured
   retry policy. Failed actions produce audit events for troubleshooting.

3. **Circular prevention**: Horizon prevents trigger loops (e.g., a renewal
   trigger that fires on renewal events would not re-trigger itself).

4. **Permissions**: Automated actions run with the permissions of the
   configured service account, not the original certificate holder.

5. **Testing**: Use `simulate_trigger` (`PATCH /api/v1/triggers/` with name
   in body) to test-fire a trigger without affecting real certificates.

---

## Trigger Type Catalog (10 Types)

Horizon supports 10 trigger types organized into two categories.

### Notification Triggers (3)

Notification triggers send alerts about certificate lifecycle events.
They are fully user-configured and support event selection, retries, and
run periods.

| Type      | Description                                      | Key Configuration                           |
|-----------|--------------------------------------------------|---------------------------------------------|
| `email`   | Send email with optional certificate attachments | `emailTemplate`, 7 attachment flags         |
| `rest`    | Sequential HTTP REST calls with authentication   | `sequence` of CustomRestTrigger steps       |
| `webhook` | Send to Teams / Slack / Mattermost               | `webhookTemplate` with recipient and message |

### Third-Party Triggers (7)

Third-party triggers push or remove certificates to/from external systems.
They require a third-party connector and have minimal user-configurable
fields -- events, retries, and runPeriod are auto-computed per type.

| Type         | Description                                 | Requires              |
|--------------|---------------------------------------------|-----------------------|
| `akv`        | Azure Key Vault                             | Third-party connector |
| `aws`        | AWS Certificate Manager / Secrets Manager   | Third-party connector |
| `f5client`   | F5 BIG-IP (client certificate)              | Third-party connector |
| `f5as3`      | F5 AS3 (Application Services 3)             | Third-party connector |
| `intunepkcs` | Microsoft Intune PKCS                       | Third-party connector |
| `ldappub`    | LDAP publish                                | Third-party connector |
| `gcm`        | Google Cloud Certificate Manager            | Third-party connector |

---

## Notification Trigger Fields

All triggers share a small set of base fields. Notification triggers
(email, rest, webhook) add event-binding and scheduling fields that
third-party triggers do not use.

### Base Fields (All Triggers)

| Field      | Type         | Description                                                        |
|------------|--------------|--------------------------------------------------------------------|
| `name`     | string       | Trigger identifier (unique across the Horizon instance)            |
| `type`     | string       | One of the 10 types listed above                                   |
| `triggers` | dict or null | Sub-triggers for error handling (FORBIDDEN for `on_trigger_error`) |

### Notification-Specific Fields (email, rest, webhook ONLY)

| Field                 | Type         | Description                                                                 | Constraints                                                                                                                  |
|-----------------------|--------------|-----------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| `events`              | list[string] | Event(s) this trigger subscribes to                                         | MUST contain EXACTLY 1 event -- multiple events → HTTP 400                                                                   |
| `retries`             | int or null  | Retry count on error                                                        | Default: 10                                                                                                                  |
| `runPeriod`           | string/null  | FiniteDuration (e.g. `"24h"`, `"7d"`)                                       | MANDATORY for `on_pending_*`, `on_expire`, `on_license_expiration`, `on_credentials_expiration`. FORBIDDEN for all others.   |
| `runOnRenewed`        | bool or null | Keep firing after certificate is renewed                                    | MANDATORY for `on_expire` ONLY. FORBIDDEN for all other events.                                                              |
| `licenceUsagePercent` | int or null  | Threshold percentage (1-100)                                                | MANDATORY for `on_license_usage`. FORBIDDEN for all other events.                                                            |

> **Critical constraint**: Each notification trigger binds to exactly ONE
> event. To fire on multiple events, create separate triggers.

---

## Event Reference (48 Events)

### Workflow Events (7 workflows x 6 events = 42)

Each of the 7 workflows produces 6 events following a consistent naming
pattern:

| Pattern                    | Description                          |
|----------------------------|--------------------------------------|
| `on_<workflow>`            | Workflow action completes            |
| `on_submit_<workflow>`     | Request is submitted                 |
| `on_cancel_<workflow>`     | Request is cancelled                 |
| `on_approve_<workflow>`    | Request is approved                  |
| `on_deny_<workflow>`       | Request is denied                    |
| `on_pending_<workflow>`    | Request enters pending queue (async) |

The 7 workflows:

| Workflow   | Example Events                                                   |
|------------|------------------------------------------------------------------|
| `enroll`   | `on_enroll`, `on_submit_enroll`, `on_cancel_enroll`, `on_approve_enroll`, `on_deny_enroll`, `on_pending_enroll`   |
| `revoke`   | `on_revoke`, `on_submit_revoke`, `on_cancel_revoke`, `on_approve_revoke`, `on_deny_revoke`, `on_pending_revoke`   |
| `update`   | `on_update`, `on_submit_update`, `on_cancel_update`, `on_approve_update`, `on_deny_update`, `on_pending_update`   |
| `recover`  | `on_recover`, `on_submit_recover`, `on_cancel_recover`, `on_approve_recover`, `on_deny_recover`, `on_pending_recover` |
| `migrate`  | `on_migrate`, `on_submit_migrate`, `on_cancel_migrate`, `on_approve_migrate`, `on_deny_migrate`, `on_pending_migrate` |
| `renew`    | `on_renew`, `on_submit_renew`, `on_cancel_renew`, `on_approve_renew`, `on_deny_renew`, `on_pending_renew`       |
| `import`   | `on_import`, `on_submit_import`, `on_cancel_import`, `on_approve_import`, `on_deny_import`, `on_pending_import`   |

### System Events (6)

| Event                        | Description                                           | Notes                                                    |
|------------------------------|-------------------------------------------------------|----------------------------------------------------------|
| `on_expire`                  | Certificate expiration check fires                    | Requires `runPeriod` and `runOnRenewed`                  |
| `on_license_expiration`      | Horizon license is approaching expiration             | Requires `runPeriod`                                     |
| `on_credentials_expiration`  | Stored credentials are approaching expiration         | Requires `runPeriod`                                     |
| `on_license_usage`           | License usage crosses threshold                       | Requires `licenceUsagePercent` (1-100)                   |
| `on_test`                    | Manual test fire via simulate                         | Used with `PATCH /api/v1/triggers/`                      |
| `on_trigger_error`           | A trigger execution failed                            | Sub-triggers (`triggers` field) are FORBIDDEN on this event |

---

## Type-Specific Configuration Schemas

### Email Notification (`email`)

```json
{
  "emailTemplate": {
    "to": [{"type": "static", "email": "admin@example.com"}],
    "cc": [],
    "bcc": [],
    "from": "horizon@example.com",
    "title": "Certificate issued: {{ csr.subject.cn }}",
    "body": "<p>Certificate issued.</p>",
    "isHtml": true,
    "headers": [{"key": "X-Priority", "value": "1"}]
  },
  "attachPemCertificate": true,
  "attachPkcs7Bundle": false
}
```

**7 attachment flags** (all boolean, default `false`):
`attachPemCertificate`, `attachPkcs7Bundle`, `attachDerCertificate`,
`attachPemChain`, `attachPkcs7Chain`, `attachDerChain`,
`attachPrivateKey`.

**EmailRecipientType values (11)**:

| Type                     | `email` field | `label` field | Notes                              |
|--------------------------|:-------------:|:-------------:|------------------------------------|
| `static`                 | required      | forbidden     | Send to a fixed email address      |
| `label`                  | forbidden     | required      | Resolve address from a label value |
| `certificate_owner`      | forbidden     | forbidden     | Certificate holder's email         |
| `certificate_rfc822name` | forbidden     | forbidden     | Email from certificate SAN         |
| `contact`                | forbidden     | forbidden     | Profile contact email              |
| `approver`               | forbidden     | forbidden     | Request approver                   |
| `requester`              | forbidden     | forbidden     | Request submitter                  |
| `lifecycle_operators`    | forbidden     | forbidden     | All lifecycle operators            |
| `team_contact`           | forbidden     | forbidden     | Team contact email                 |
| `team_manager`           | forbidden     | forbidden     | Team manager email                 |
| `team_members`           | forbidden     | forbidden     | All team member emails             |

### Custom REST Notification (`rest`)

```json
{
  "sequence": [
    {
      "url": "https://api.example.com/webhook",
      "authenticationType": "bearer",
      "credentials": "my-cred",
      "method": "POST",
      "headers": [{"name": "Content-Type", "value": "application/json"}],
      "payloadType": "json",
      "payload": "{\"cn\": \"{{ csr.subject.cn }}\"}",
      "expectedHttpCodes": [200, 201],
      "proxy": null,
      "timeout": 30000
    }
  ]
}
```

Steps in the `sequence` array execute **sequentially** -- each step must
succeed (return one of `expectedHttpCodes`) before the next step runs.

**authenticationType values**: `noauth`, `basic`, `x509`, `bearer`, `custom`.

When `authenticationType` is not `noauth`, the `credentials` field references
a credential name stored in Horizon (`/api/v1/security/credentials`).

### Webhook Notification (`webhook`)

```json
{
  "webhookTemplate": {
    "to": {
      "type": "static",
      "webhook": {
        "type": "TEAMS",
        "url": "https://outlook.office.com/webhook/..."
      }
    },
    "title": "Certificate Alert",
    "body": "Certificate {{ csr.subject.cn }} has been issued."
  },
  "proxy": null,
  "timeout": 30000
}
```

**WebhookType values**: `TEAMS`, `SLACK`, `MATTERMOST`.

**WebhookRecipientType values**: `static`, `team`.
- `static` -- the webhook URL is provided directly in the `webhook` object.
- `team` -- the webhook URL is resolved from the certificate's team configuration.

### Third-Party Triggers (akv, aws, f5client, f5as3, intunepkcs, ldappub, gcm)

Third-party triggers have only 3 user-configurable fields:

| Field       | Type         | Description                                                    |
|-------------|--------------|----------------------------------------------------------------|
| `name`      | string       | Trigger identifier                                             |
| `connector` | string       | Name of the third-party connector to invoke                    |
| `triggers`  | dict or null | Sub-triggers for error handling                                |

All other fields (`events`, `retries`, `runPeriod`, etc.) are
**auto-computed** per trigger type. User-supplied values for these fields
are silently ignored by the API.

---

## Automation Policies

An automation policy binds a certificate profile to an execution policy
and optional compliance constraints. It defines WHAT gets automated and
under WHICH rules.

### Automation Policy Fields

| Field              | Type            | Required | Description                                                                      |
|--------------------|-----------------|----------|----------------------------------------------------------------------------------|
| `name`             | string          | yes      | Unique policy identifier                                                         |
| `profile`          | string          | yes      | Certificate profile name this policy applies to                                  |
| `executionPolicy`  | string or null  | no       | NAME reference to an Execution Policy (NOT an embedded object)                   |
| `compliancePolicy` | object or null  | no       | Inline compliance constraints (see below)                                        |
| `trustChains`      | list[str]/null  | no       | List of CA names for trust chain validation                                      |

### Compliance Policy Object

```json
{
  "compliancePolicy": {
    "authorizedCas": ["Internal-Root-CA", "Partner-CA"],
    "authorizedSigningAlgorithms": ["SHA256withRSA", "SHA384withECDSA"]
  }
}
```

- `authorizedCas` -- only certificates issued by these CAs are considered
  compliant.
- `authorizedSigningAlgorithms` -- only certificates using these signing
  algorithms are considered compliant.

> **Important**: `executionPolicy` is a string name reference, not an
> embedded dictionary. The execution policy must already exist before being
> referenced.

---

## Execution Policies

An execution policy defines WHEN automated operations are allowed to run.
It uses authorized and forbidden time windows to control scheduling.

### Execution Policy Fields

| Field               | Type                       | Required | Description                                          |
|---------------------|----------------------------|----------|------------------------------------------------------|
| `name`              | string                     | yes      | Unique policy identifier                             |
| `description`       | string or null             | no       | Human-readable description                           |
| `authorizedPeriods` | list[ExecutionPeriod]/null | no       | Time windows when execution IS allowed               |
| `forbiddenPeriods`  | list[ExecutionPeriod]/null | no       | Time windows when execution is NOT allowed           |

### ExecutionPeriod Structure

Each period can combine multiple constraints. All specified constraints
must match simultaneously for the period to apply.

| Field       | Type                                              | Description                                      |
|-------------|---------------------------------------------------|--------------------------------------------------|
| `dateRange` | `{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}` or null | Calendar date range (inclusive)                |
| `weeks`     | list[int] or null                                 | ISO week numbers (1-52)                          |
| `weekDays`  | list[string] or null                              | Days of week, ALL CAPS: `MONDAY` through `SUNDAY` |
| `timeRange` | `{"start": "HH:mm:ss", "end": "HH:mm:ss"}` or null    | Time-of-day range (24-hour format)            |

### Execution Policy Examples

**Business hours only (weekdays 08:00-18:00)**:

```json
{
  "name": "business-hours-only",
  "description": "Allow automated operations during business hours",
  "authorizedPeriods": [
    {
      "weekDays": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
      "timeRange": {"start": "08:00:00", "end": "18:00:00"}
    }
  ],
  "forbiddenPeriods": null
}
```

**Blackout during change freeze**:

```json
{
  "name": "no-year-end-changes",
  "description": "Block automation during year-end change freeze",
  "authorizedPeriods": null,
  "forbiddenPeriods": [
    {
      "dateRange": {"start": "2026-12-20", "end": "2027-01-05"}
    }
  ]
}
```

**Combined: weekday business hours, excluding specific weeks**:

```json
{
  "name": "controlled-automation",
  "description": "Business hours on weekdays, skip audit weeks",
  "authorizedPeriods": [
    {
      "weekDays": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
      "timeRange": {"start": "09:00:00", "end": "17:00:00"}
    }
  ],
  "forbiddenPeriods": [
    {
      "weeks": [13, 26, 39, 52]
    }
  ]
}
```

### Execution Policy API Operations

| Operation              | Method | Path                                  |
|------------------------|--------|---------------------------------------|
| List execution policies | GET    | `/api/v1/executionpolicies`          |
| Get execution policy   | GET    | `/api/v1/executionpolicies/{name}`    |
| Create execution policy | POST   | `/api/v1/executionpolicies`          |
| Update execution policy | PUT    | `/api/v1/executionpolicies/` (name in JSON body) |
| Delete execution policy | DELETE | `/api/v1/executionpolicies/{name}`   |

### Automation Policy API Operations

| Operation               | Method | Path                                   |
|-------------------------|--------|----------------------------------------|
| List automation policies | GET    | `/api/v1/automationpolicies`          |
| Get automation policy   | GET    | `/api/v1/automationpolicies/{name}`    |
| Create automation policy | POST   | `/api/v1/automationpolicies`          |
| Update automation policy | PUT    | `/api/v1/automationpolicies/` (name in JSON body) |
| Delete automation policy | DELETE | `/api/v1/automationpolicies/{name}`   |
