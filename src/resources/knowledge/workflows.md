# Horizon Workflow Authorization, Request Policies, and Self-Permissions

## Overview

Horizon's workflow system controls the full certificate lifecycle through
three interlocking configuration surfaces:

1. **AuthorizationLevels** = WHO can perform each action
2. **RequestsPolicy** = HOW LONG requests remain valid and certificates last
3. **SelfPermissions** = what a certificate holder can do to their own certificate

These three objects live on every managed profile and together define the
complete access control and lifecycle behavior for certificates in that profile.

---

## The 7 Workflows

Every certificate lifecycle action maps to one of 7 workflow types:

| Workflow  | Purpose                                                                      | Creates new cert?  |
| --------- | ---------------------------------------------------------------------------- | ------------------ |
| `enroll`  | Issue a new certificate (CSR-based or centralized key generation)            | Yes                |
| `revoke`  | Revoke an existing certificate (add to CRL)                                  | No                 |
| `update`  | Update certificate metadata (labels, owner, contact email) without reissuing | No                 |
| `recover` | Recover a previously escrowed private key                                    | No (key retrieval) |
| `migrate` | Move a certificate from one profile to another                               | No                 |
| `renew`   | Issue a replacement certificate for an expiring one                          | Yes                |
| `import`  | Import an externally-issued certificate into Horizon                         | No (registration)  |

Each workflow supports up to four sub-actions:

- **Direct action**: The operation completes immediately (e.g., direct enrollment issues the cert)
- **API-specific action**: Separate access level for API callers (e.g., `enrollApi`)
- **Request submission**: Creates a pending request requiring later approval
- **Request approval**: Approves or denies a pending request

---

## WebRA Update Template: `autoRenew` (Horizon 2.10+)

Check the version with `get_license_info` before using automatic renewal.

For a WebRA `update` workflow, the request template can include the
per-certificate `autoRenew` element:

```json
{
  "autoRenew": {
    "value": true
  }
}
```

Call `get_request_template` for `workflow: "update"` and `module: "webra"`
before submitting the generic request. Submit the value in
`template.autoRenew`; Horizon accepts the change only when the profile's
`autoRenewalPolicy.editable` is `true`. The dedicated
`set_certificate_auto_renew` tool submits this exact update request for one
certificate.

This is WebRA per-certificate automatic renewal, not the trust-chain
automation-policy renewal in `automation.md`. The trust-chain automation policy
governs chain operations and does not set `template.autoRenew`.

---

## Renewal and Update Behavior (Horizon 2.11)

- Renewal: since Horizon 2.11, a renewal reuses the initial enrollment
  request (the certificate `requestedX509Data`: subject, SANs, extensions as
  sent to the PKI) instead of the issued certificate, so certificates changed
  by the CA at issuance renew as originally requested. Certificates without
  `requestedX509Data` (enrolled earlier, imported or discovered) still renew
  from the issued certificate. Before 2.11, renewal always starts from the
  issued certificate.
- Update, renew and migrate: since Horizon 2.11, only the modified fields
  are submitted, so concurrent edits do not overwrite each other and an
  unchanged submission creates no request. Before 2.11, the full data is
  submitted.

---

## AuthorizationLevels = WHO (28 Fields)

The `authorizationLevels` object on a profile contains **28 fields**, each
controlling access to a specific workflow action. Every field takes one of
three access levels.

### Access Levels

| Level           | Meaning                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `everyone`      | No authentication required. Anyone with network access can perform the action. |
| `authenticated` | The caller must be authenticated (valid session / API key / certificate).      |
| `authorized`    | The caller must have an explicit permission grant for this profile + workflow. |

### Enrollment Workflow Fields

| Field           | Description                                     |
| --------------- | ----------------------------------------------- |
| `enroll`        | Direct enrollment via web UI                    |
| `enrollApi`     | Direct enrollment via API call                  |
| `enrollRequest` | Submit an enrollment request (pending approval) |
| `enrollApprove` | Approve a pending enrollment request            |

### Revocation Workflow Fields

| Field           | Description                                    |
| --------------- | ---------------------------------------------- |
| `revoke`        | Direct revocation via web UI                   |
| `revokeApi`     | Direct revocation via API                      |
| `revokeRequest` | Submit a revocation request (pending approval) |
| `revokeApprove` | Approve a pending revocation request           |

### Update Workflow Fields

| Field           | Description                                 |
| --------------- | ------------------------------------------- |
| `update`        | Direct metadata update via web UI           |
| `updateApi`     | Direct metadata update via API              |
| `updateRequest` | Submit an update request (pending approval) |
| `updateApprove` | Approve a pending update request            |

### Recovery Workflow Fields

| Field            | Description                                  |
| ---------------- | -------------------------------------------- |
| `recover`        | Direct key recovery via web UI               |
| `recoverApi`     | Direct key recovery via API                  |
| `recoverRequest` | Submit a recovery request (pending approval) |
| `recoverApprove` | Approve a pending recovery request           |

### Migration Workflow Fields

| Field            | Description                                   |
| ---------------- | --------------------------------------------- |
| `migrate`        | Direct certificate migration via web UI       |
| `migrateApi`     | Direct certificate migration via API          |
| `migrateRequest` | Submit a migration request (pending approval) |
| `migrateApprove` | Approve a pending migration request           |

### Renewal Workflow Fields

| Field          | Description                                 |
| -------------- | ------------------------------------------- |
| `renew`        | Direct certificate renewal via web UI       |
| `renewApi`     | Direct certificate renewal via API          |
| `renewRequest` | Submit a renewal request (pending approval) |
| `renewApprove` | Approve a pending renewal request           |

### Import Workflow Fields

| Field           | Description                                 |
| --------------- | ------------------------------------------- |
| `import`        | Direct certificate import via web UI        |
| `importApi`     | Direct certificate import via API           |
| `importRequest` | Submit an import request (pending approval) |
| `importApprove` | Approve a pending import request            |

### Example AuthorizationLevels Object

```json
{
  "authorizationLevels": {
    "enroll": "authenticated",
    "enrollApi": "authorized",
    "enrollRequest": "authenticated",
    "enrollApprove": "authorized",
    "revoke": "authorized",
    "revokeApi": "authorized",
    "revokeRequest": "authenticated",
    "revokeApprove": "authorized",
    "update": "authenticated",
    "updateApi": "authenticated",
    "updateRequest": "everyone",
    "updateApprove": "authorized",
    "recover": "authorized",
    "recoverApi": "authorized",
    "recoverRequest": "authorized",
    "recoverApprove": "authorized",
    "migrate": "authorized",
    "migrateApi": "authorized",
    "migrateRequest": "authorized",
    "migrateApprove": "authorized",
    "renew": "authenticated",
    "renewApi": "authenticated",
    "renewRequest": "authenticated",
    "renewApprove": "authorized",
    "import": "authorized",
    "importApi": "authorized",
    "importRequest": "authorized",
    "importApprove": "authorized"
  }
}
```

---

## Direct Actions vs. Request/Approve Flows

### Direct Action Flow

```
Caller -> enroll/enrollApi -> [computation rules] -> PKI connector -> certificate issued
```

The action completes in a single API call. The caller must meet the access
level requirement for the direct action field.

### Request/Approve Flow

```
Caller -> enrollRequest -> pending request created
Approver -> enrollApprove -> [computation rules] -> PKI connector -> certificate issued
```

Two-step process: the requester submits a request, then a separate approver
approves it. The requester must meet `enrollRequest` access level; the
approver must meet `enrollApprove` access level.

### Asynchronous Enrollment Flow (Horizon 2.10+)

Check the version with `get_license_info` before using asynchronous enrollment.

Some PKI connectors submit enrollment to an external CA that does not return
the certificate immediately. Horizon records the request as `in_progress`
while certificate issuance is pending. Asynchronous enrollment is available
for WebRA enroll and renew workflows; ACME, SCEP, and EST remain synchronous.

```
Caller -> submit_request -> in_progress request -> external CA polling -> certificate issued
                                            -> deny_request or cancel_request
```

Use `search_requests` to find requests with status `in_progress`, then
`get_request` to inspect the full record. Poll rather than submitting another
request. `approve_request` is only valid for `pending` requests; `deny_request`
and `cancel_request` accept both `pending` and `in_progress` requests.

### WebRA Challenge Enrollment (Horizon 2.11+)

On a WebRA profile with `authorizationMode: "challenge"`, enrollment is two
steps:

```
Requester -> enroll request on the profile -> response `password` holds the challenge
Client    -> submit_webra_challenge (POST /api/v1/challenge/submit) -> certificate
```

1. Get a challenge: submit an `enroll` request on the challenge profile (or
   use "Request a WebRA Challenge" in the RA UI). The owner, contact email
   and team of the future certificate are set on this request. The response
   `password` field holds the generated challenge, not a PKCS#12 password.
   With the enroll permission, the challenge is returned at once. With only
   the request permission, wait until an operator approves the request and
   its status is `completed`, then read the challenge from the request.
2. Consume it with `submit_webra_challenge`: body {`profile`, `challenge`,
   `template`}. The endpoint needs no authentication: the challenge is the
   authorization. It is single use, expires, and is bound to its profile.
   Enrollment is always synchronous (HTTP 201).
3. `template`: `csr` (decentralized) or `keyType` (centralized), never both.
   `subject`, `sans` and `extensions` are accepted only when the profile
   certificate template is empty; otherwise the identity comes from the
   challenge. `metadata` accepts only `automation_policy`, with a policy
   authorized on the profile.
4. Response: `certificate` (PEM) and, in centralized mode only, `pkcs12`
   (DER Base64, encrypted with the challenge as password). Save the bundle
   from this response.

Errors: WEBRA-ENROLL-015 (invalid challenge),
WEBRA-ENROLL-001/009/012 and REQ-002 (400), LIC-003/004 (403),
WEBRA-ENROLL-011 (500). The event code is `WEBRA-CHALLENGE-SUBMIT`.

### API-Specific Actions

The `*Api` fields (e.g., `enrollApi`, `revokeApi`, `renewApi`, `recoverApi`)
provide separate access control for API-only callers. This allows setting
different security levels for human operators (UI) vs. automated systems (API).

Common pattern: `enroll: "authenticated"` for UI users,
`enrollApi: "authorized"` for API automation (requiring explicit permission grants).

---

## RequestsPolicy = HOW LONG

The `requestsPolicy` object controls timing constraints for each workflow.
Each workflow can have its own sub-object with these fields:

| Field                 | Type   | Description                                                                  |
| --------------------- | ------ | ---------------------------------------------------------------------------- |
| `maxDuration`         | string | Maximum duration a request can remain pending before auto-expiry (ISO 8601). |
| `maxCertDuration`     | string | Maximum certificate validity duration (for enroll/renew workflows).          |
| `defaultCertDuration` | string | Default certificate validity if not specified by the requester.              |

### Example RequestsPolicy Object

```json
{
  "requestsPolicy": {
    "enroll": {
      "maxDuration": "P30D",
      "maxCertDuration": "P365D",
      "defaultCertDuration": "P90D"
    },
    "renew": {
      "maxDuration": "P7D",
      "maxCertDuration": "P365D",
      "defaultCertDuration": "P90D"
    },
    "revoke": {
      "maxDuration": "P7D"
    },
    "recover": {
      "maxDuration": "P3D"
    }
  }
}
```

Duration values use ISO 8601 duration format:

- `P30D` = 30 days
- `P365D` = 365 days (1 year)
- `P90D` = 90 days
- `PT24H` = 24 hours
- `P1Y` = 1 year

---

## SelfPermissions

The `selfPermissions` object controls what a certificate holder can do with
their own certificates, without needing explicit workflow permissions.

| Field           | Type    | Description                                                                             |
| --------------- | ------- | --------------------------------------------------------------------------------------- |
| `selfRecover`   | boolean | Holder can recover their own escrowed private key.                                      |
| `selfUpdate`    | boolean | Holder can update metadata on their own certificate.                                    |
| `selfRevoke`    | boolean | Holder can revoke their own certificate.                                                |
| `selfRenew`     | boolean | Holder can renew their own certificate.                                                 |
| `selfPopRenew`  | boolean | Holder can renew using proof-of-possession (current private key signs the renewal CSR). |
| `selfPopRevoke` | boolean | Holder can revoke using proof-of-possession.                                            |
| `selfPopUpdate` | boolean | Holder can update using proof-of-possession.                                            |

### Proof-of-Possession (PoP) Explained

PoP-based self-actions require the caller to cryptographically prove they
hold the private key of the certificate they want to act on. This is done
by signing the request with the certificate's private key.

**Why PoP matters**: It provides a higher assurance level than session-based
authentication. Even if a user's Horizon session is compromised, the attacker
cannot perform PoP actions without also possessing the private key.

**When to use PoP**:

- `selfPopRenew` = true: Enable when clients have their private keys and
  can sign renewal CSRs (e.g., EST re-enrollment, ACME renewal).
- `selfPopRevoke` = true: Enable for automated clients that need to self-revoke
  (e.g., decommissioned servers revoking their own certs).
- `selfPopUpdate` = true: Rarely needed; enable for clients that need to
  update their own metadata with cryptographic proof.

### Example SelfPermissions Object

```json
{
  "selfPermissions": {
    "selfRecover": false,
    "selfUpdate": true,
    "selfRevoke": true,
    "selfRenew": true,
    "selfPopRenew": true,
    "selfPopRevoke": true,
    "selfPopUpdate": false
  }
}
```

---

## IDP Enforcement in Authorization Levels

When `authorizationLevels` uses `authenticated` or `authorized`, the profile
can optionally restrict which identity providers are acceptable for
authentication. This is configured per authorization level via the
`identityProviders` list.

If `identityProviders` is empty or absent, any configured IDP is accepted.
If populated, only principals authenticated through a listed IDP can perform
the action.

Example: restrict enrollment to corporate OIDC users only:

```json
{
  "authorizationLevels": {
    "enroll": "authenticated",
    "enrollIdp": ["corporate-oidc"]
  }
}
```

---

## Business Intent -> Settings Mapping

| I want to...                                           | Settings to configure                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Let anyone request certs, admins approve               | `enrollRequest: "everyone"`, `enrollApprove: "authorized"`               |
| Fully automated enrollment, no human approval          | `enroll: "authenticated"`, `authorizationMode: "auto-validation"`        |
| Only API clients can enroll, with admin approval       | `enrollApi: "authorized"`, `enrollApprove: "authorized"`                 |
| Certificate holders can self-renew                     | `selfPermissions.selfRenew: true`                                        |
| Certificate holders self-renew with PoP only           | `selfPermissions.selfPopRenew: true`, `selfPermissions.selfRenew: false` |
| Requests expire after 7 days                           | `requestsPolicy.enroll.maxDuration: "P7D"`                               |
| Certificates max 1 year validity                       | `requestsPolicy.enroll.maxCertDuration: "P365D"`                         |
| Only OIDC-authenticated users can enroll               | `enroll: "authenticated"` + `enrollIdp: ["my-oidc-idp"]`                 |
| Block all enrollment on a profile                      | `enabled: false` or set all enroll fields to `authorized` with no grants |
| Allow self-revocation without session (device decomm.) | `selfPermissions.selfPopRevoke: true`                                    |
| Restrict migration to authorized operators only        | `migrate: "authorized"`, `migrateApi: "authorized"`                      |
| API enrollment only (no web UI)                        | `enrollApi: "authenticated"`, `enroll: "authorized"`                     |
| Nobody can import certificates                         | `import: "authorized"`, `importApi: "authorized"` (no grants)            |

---

## Workflow Interaction with RBAC

Authorization levels work _in conjunction with_ the RBAC system:

1. The `authorizationLevels` on the profile set the _minimum bar_
2. The user's permissions (from roles/teams) determine if they pass that bar
3. `"everyone"` = no RBAC check at all
4. `"authenticated"` = must have a valid session, no specific permission needed
5. `"authorized"` = must have the corresponding permission
   (e.g., `certificates:enroll:{profile}`)

This two-layer model means you can have a profile that allows authenticated
enrollment but still restrict _which_ authenticated users can enroll by
narrowing the `search` authorization level or by using team-based ownership.

---

## Request Submission API Payload

All lifecycle requests are submitted via `POST /api/v1/requests/submit`.
The JSON body has a specific structure -- certificate fields MUST be nested
inside a `template` object, NOT placed at the top level.

### Payload Structure

```json
{
  "workflow": "<enroll|renew|revoke|update|recover|migrate|import>",
  "profile": "<profile-name>",
  "module": "<webra|est|scep|acme|crmp|wcce|intune|jamf>",
  "template": {
    "subject": [
      { "element": "cn.1", "type": "CN", "value": "server.example.com" }
    ],
    "sans": [
      {
        "type": "DNSNAME",
        "value": ["server.example.com", "alias.example.com"]
      },
      { "type": "IPADDRESS", "value": ["192.168.1.10"] }
    ],
    "labels": [
      { "label": "environment", "value": "PRODUCTION" },
      { "label": "application_name", "value": "my-app" }
    ],
    "contactEmail": { "value": "admin@example.com" },
    "owner": { "value": "jdoe" },
    "team": { "value": "infra" },
    "keyType": "ec-secp256r1"
  },
  "password": "changeit",
  "certificateId": "<id>"
}
```

### Top-level fields

| Field           | Required                                | Description                                                                                                                            |
| --------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow`      | Always                                  | Lifecycle action type                                                                                                                  |
| `profile`       | Always                                  | Target profile name                                                                                                                    |
| `module`        | Always                                  | Profile module type                                                                                                                    |
| `template`      | enroll, renew                           | Certificate data (subject, SANs, labels, key type, etc.)                                                                               |
| `password`      | Centralized only                        | PKCS#12 password (omit if profile uses random mode). On a WebRA challenge profile (2.11+), the response `password` holds the challenge |
| `certificateId` | renew, revoke, update, recover, migrate | Existing certificate ID                                                                                                                |

### Template fields

| Field          | Type   | Description                                                   |
| -------------- | ------ | ------------------------------------------------------------- |
| `subject`      | array  | DN elements: `{"element": "cn.1", "type": "CN", "value": ""}` |
| `sans`         | array  | SAN entries: `{"type": "DNSNAME", "value": ["..."]}`          |
| `labels`       | array  | Labels: `{"label": "<name>", "value": "<value>"}`             |
| `contactEmail` | object | `{"value": "user@example.com"}`                               |
| `owner`        | object | `{"value": "principal-id"}`                                   |
| `team`         | object | `{"value": "team-name"}`                                      |
| `keyType`      | string | Key algorithm (e.g., `rsa-2048`, `ec-secp256r1`)              |
| `csr`          | string | PEM-encoded CSR (for decentralized enrollment)                |

**Important**: Only include editable fields in the template. Fixed fields
(like O, OU, C with `editable: false` in the profile) are set by the server.
Call `GET /api/v1/requests/template?workflow=enroll&profile=<name>&module=<module>`
first to discover which fields are required and editable.

### Enrollment Example (centralized, WebRA)

```bash
curl -X POST "https://<HORIZON_URL>/api/v1/requests/submit" \
  -H "Content-Type: application/json" \
  -H "x-api-id: <API_KEY_ID>" \
  -H "x-api-key: <API_KEY>" \
  -d '{
    "workflow": "enroll",
    "profile": "TLS-Internal",
    "module": "webra",
    "template": {
      "subject": [{"element": "cn.1", "type": "CN", "value": "server.local"}],
      "sans": [{"type": "DNSNAME", "value": ["server.local"]}],
      "labels": [{"label": "env", "value": "prod"}],
      "keyType": "rsa-3072"
    },
    "password": "changeit"
  }'
```

### Revocation Example

```bash
curl -X POST "https://<HORIZON_URL>/api/v1/requests/submit" \
  -H "Content-Type: application/json" \
  -H "x-api-id: <API_KEY_ID>" \
  -H "x-api-key: <API_KEY>" \
  -d '{
    "workflow": "revoke",
    "profile": "TLS-Internal",
    "module": "webra",
    "certificateId": "abc123",
    "template": {
      "revocationReason": "keycompromise"
    }
  }'
```
