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
