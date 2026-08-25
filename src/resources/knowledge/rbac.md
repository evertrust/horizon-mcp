# Horizon RBAC -- Role-Based Access Control Model

## Overview

Horizon's RBAC model controls access to every API operation and UI action.
The model has four core concepts:

- **Permissions** -- granular action grants following a `domain:action:scope` pattern
- **Roles** -- named bundles of permissions, assignable to principals
- **Teams** -- organizational scope for certificate ownership and visibility
- **Principals** -- user identities with roles, team memberships, and optional direct permissions

---

## Permission Format

Every permission follows a three-level colon-delimited pattern:

```
domain:action:scope
```

| Level    | Description         | Examples                                                        |
| -------- | ------------------- | --------------------------------------------------------------- |
| `domain` | The functional area | `certificates`, `configuration`, `security`, `discovery`        |
| `action` | The operation       | `search`, `enroll`, `revoke`, `create`, `update`, `delete`, `*` |
| `scope`  | The target boundary | `*` (all), a specific profile name, a specific object name      |

### Wildcard Support

The `*` wildcard is supported at every level:

| Pattern                   | Meaning                                       |
| ------------------------- | --------------------------------------------- |
| `certificates:*:*`        | All certificate actions on all profiles       |
| `certificates:search:*`   | Search certificates across all profiles       |
| `certificates:enroll:TLS` | Enroll certificates only in the "TLS" profile |
| `configuration:*:*`       | Full configuration admin                      |
| `security:*:*`            | Full security/RBAC admin                      |
| `*:*:*`                   | Superadmin -- all permissions in the system   |

### Implication Rules

Broader permissions **imply** narrower ones. This is evaluated transitively:

- `certificates:*:*` implies `certificates:search:*`, `certificates:enroll:*`, etc.
- `certificates:search:*` implies `certificates:search:TLS-Internal`
- `*:*:*` implies every permission in the system
- `configuration:profiles:*` implies `configuration:profiles:TLS-Internal`

A principal needs only **one** matching permission -- either direct, from a
role, or via wildcard implication.

---

## Permission Catalog (36 Patterns)

### Certificate Permissions (9)

Control lifecycle operations on certificates within specific profiles.
Scope = profile name or `*`.

| Permission Pattern             | Description                           |
| ------------------------------ | ------------------------------------- |
| `certificates:search:{scope}`  | Search and view certificates          |
| `certificates:enroll:{scope}`  | Submit enrollment requests            |
| `certificates:revoke:{scope}`  | Submit revocation requests            |
| `certificates:update:{scope}`  | Update certificate metadata           |
| `certificates:recover:{scope}` | Recover escrowed private keys         |
| `certificates:migrate:{scope}` | Migrate certificates between profiles |
| `certificates:renew:{scope}`   | Submit renewal requests               |
| `certificates:import:{scope}`  | Import externally-issued certificates |
| `certificates:approve:{scope}` | Approve or deny pending requests      |

### Configuration Permissions (9)

Control management of Horizon configuration objects.
Scope = object name or `*`.

| Permission Pattern                  | Description                                   |
| ----------------------------------- | --------------------------------------------- |
| `configuration:profiles:{scope}`    | Manage certificate profiles (CRUD)            |
| `configuration:cas:{scope}`         | Manage CA trust objects                       |
| `configuration:connectors:{scope}`  | Manage PKI and third-party connectors         |
| `configuration:triggers:{scope}`    | Manage automation triggers                    |
| `configuration:labels:{scope}`      | Manage label definitions                      |
| `configuration:proxies:{scope}`     | Manage proxy configurations                   |
| `configuration:datasources:{scope}` | Manage external datasources (LDAP, REST, DNS) |
| `configuration:grading:{scope}`     | Manage security grading policies and rulesets |
| `configuration:passwords:{scope}`   | Manage password policies                      |

### Security Permissions (5)

Control the RBAC system itself. Scope = object name or `*`.

| Permission Pattern             | Description                                      |
| ------------------------------ | ------------------------------------------------ |
| `security:roles:{scope}`       | Manage roles (create, update, delete, list)      |
| `security:teams:{scope}`       | Manage teams                                     |
| `security:principals:{scope}`  | Manage user principals (assign roles/teams)      |
| `security:idps:{scope}`        | Manage identity provider configurations          |
| `security:credentials:{scope}` | Manage stored credentials (keystores, passwords) |

**Warning**: `security:roles:*` and `security:principals:*` together
effectively grant full admin -- a user who can create roles and assign
them can escalate to any permission level.

### Discovery Permissions (2)

Control certificate discovery campaigns and results.

| Permission Pattern            | Description                                      |
| ----------------------------- | ------------------------------------------------ |
| `discovery:campaigns:{scope}` | Manage discovery campaigns (create, run, delete) |
| `discovery:events:{scope}`    | View and manage discovery events/results         |

### Wildcard Shortcuts (2)

| Pattern                  | Description                                  |
| ------------------------ | -------------------------------------------- |
| `certificates:*:{scope}` | All certificate actions on scoped profile(s) |
| `*:*:*`                  | Unrestricted superadmin access               |

### Action-Level Wildcards (9 implied)

Any domain supports `*` as its action, granting all actions within that domain:

| Pattern                       | Equivalent to                                  |
| ----------------------------- | ---------------------------------------------- |
| `certificates:*:TLS`          | All 9 certificate actions on the "TLS" profile |
| `configuration:*:MyConnector` | All configuration actions on "MyConnector"     |
| `security:*:*`                | Full RBAC admin                                |
| `discovery:*:*`               | Full discovery admin                           |

---

## Roles

A role is a named, reusable bundle of permissions.

### Role Object Structure

```json
{
  "name": "tls-operator",
  "description": "Can enroll and revoke TLS certificates",
  "permissions": [
    "certificates:search:TLS-Internal",
    "certificates:search:TLS-Public",
    "certificates:enroll:TLS-Internal",
    "certificates:enroll:TLS-Public",
    "certificates:revoke:TLS-Internal",
    "certificates:revoke:TLS-Public",
    "certificates:renew:TLS-Internal",
    "certificates:renew:TLS-Public"
  ]
}
```

### Common Role Patterns

| Role Name           | Typical Permissions                                                       |
| ------------------- | ------------------------------------------------------------------------- |
| `superadmin`        | `*:*:*`                                                                   |
| `certificate-admin` | `certificates:*:*`, `configuration:profiles:*`                            |
| `operator`          | `certificates:search:*`, `certificates:enroll:*`, `certificates:revoke:*` |
| `auditor`           | `certificates:search:*`, `discovery:events:*` (read-only)                 |
| `config-admin`      | `configuration:*:*`                                                       |
| `security-admin`    | `security:*:*`                                                            |
| `profile-scoped`    | `certificates:*:ProfileName` (single-profile access)                      |
| `approver`          | `certificates:approve:*` (can approve but not enroll)                     |

### Role API Operations

| Operation      | Method | Path                                     |
| -------------- | ------ | ---------------------------------------- |
| List roles     | GET    | `/api/v1/security/roles`                 |
| Get role       | GET    | `/api/v1/security/roles/{name}`          |
| Create role    | POST   | `/api/v1/security/roles`                 |
| Update role    | PUT    | `/api/v1/security/roles/` (name in body) |
| Delete role    | DELETE | `/api/v1/security/roles/{name}`          |
| Get members    | GET    | `/api/v1/security/roles/{name}/members`  |
| Add members    | POST   | `/api/v1/security/roles/{name}/members`  |
| Remove members | DELETE | `/api/v1/security/roles/{name}/members`  |

---

## Teams

Teams provide an **organizational scope** for certificate ownership. Every
certificate can be assigned to a team, and team membership controls which
certificates a principal can see and act on.

### Team Object Structure

```json
{
  "name": "platform-team",
  "displayName": "Platform Engineering",
  "description": "Platform engineering team",
  "contact": "platform@example.com",
  "managers": ["alice", "bob"]
}
```

### How Teams Interact with Permissions

1. A certificate's `owner` field references a team name
2. When a profile's authorization level is `"authorized"`, Horizon checks:
   - Does the principal have the required permission? (role-based)
   - Is the principal a member of the certificate's owning team? (team-based)
3. Team membership acts as an **additional scope filter**, not a replacement
   for permissions

### Certificate Ownership Transfer

Certificates can be transferred between teams using:

```
PATCH /api/v1/security/teams/{prev}/{new}
```

This bulk operation moves all certificate ownership from one team to another.

### Team API Operations

| Operation      | Method | Path                                     |
| -------------- | ------ | ---------------------------------------- |
| List teams     | GET    | `/api/v1/security/teams`                 |
| Get team       | GET    | `/api/v1/security/teams/{name}`          |
| Create team    | POST   | `/api/v1/security/teams`                 |
| Update team    | PUT    | `/api/v1/security/teams/` (name in body) |
| Delete team    | DELETE | `/api/v1/security/teams/{name}`          |
| Get members    | GET    | `/api/v1/security/teams/{name}/members`  |
| Add members    | POST   | `/api/v1/security/teams/{name}/members`  |
| Remove members | DELETE | `/api/v1/security/teams/{name}/members`  |
| Transfer       | PATCH  | `/api/v1/security/teams/{prev}/{new}`    |

---

## Principals

A principal is a user identity in Horizon. Principals aggregate:

- **Roles** -- permission bundles
- **Teams** -- organizational membership
- **Direct permissions** -- individual permission grants (bypass roles)

### Principal Object Structure

```json
{
  "identifier": "jdoe",
  "contact": "jane.doe@example.com",
  "roles": ["tls-operator", "auditor"],
  "teams": ["platform-team"],
  "permissions": ["certificates:import:Legacy-Profile"],
  "enabled": true
}
```

### Effective Permission Calculation

A principal's effective permissions are the **union** of:

1. All permissions from all assigned roles
2. All direct permissions on the principal
3. Wildcard expansion (e.g., `certificates:*:*` expands to cover all actions)

```
Effective = Union(
  role1.permissions,
  role2.permissions,
  ...,
  principal.directPermissions
)
```

### Principal API Operations

| Operation         | Method | Path                                        |
| ----------------- | ------ | ------------------------------------------- |
| Search principals | GET    | `/api/v1/security/principals`               |
| Get principal     | GET    | `/api/v1/security/principals/{id}`          |
| Get self          | GET    | `/api/v1/security/principals/self`          |
| Create principal  | POST   | `/api/v1/security/principals`               |
| Update principal  | PUT    | `/api/v1/security/principals/` (id in body) |
| Delete principal  | DELETE | `/api/v1/security/principals/{id}`          |

---

## IDP Enforcement

Identity Providers (IDPs) determine how principals authenticate. Horizon
supports two IDP types:

| Type     | Description                                                                  |
| -------- | ---------------------------------------------------------------------------- |
| `local`  | Built-in username/password authentication with password policy               |
| `openid` | OpenID Connect SSO via an external provider (Entra ID, Keycloak, Okta, etc.) |

Profiles can restrict specific workflow actions to principals authenticated
through specific IDPs. See the `identityProviders` field in authorization
levels (workflows knowledge).

---

## X.509 Client-Authentication Identity Mapping

When a client authenticates with an X.509 certificate, Horizon selects its
trusted CA and evaluates that CA's TemplateString mappings:

| CA field            | Default TemplateString             | Result                          |
| ------------------- | ---------------------------------- | ------------------------------- |
| `identifierMapping` | `{{certificate.dn}}`               | Required principal identifier   |
| `nameMapping`       | `{{certificate.subject.cn.1}}`     | Optional principal display name |
| `emailMapping`      | `{{certificate.san.rfc822name.1}}` | Optional principal email        |

Set these fields through `create_ca` or `update_ca` using the corresponding
snake_case inputs: `identifier_mapping`, `name_mapping`, and `email_mapping`.
The `identifierMapping` is the required anchor: if it does not evaluate for a
certificate, Horizon fails the entire client-auth identity computation. Name
and email mappings may independently evaluate to no value without substituting
an identifier.

---

## Role Workflow Guidance

When setting up access for a new use case, follow this workflow:

### Step 1: Check Existing Roles

Use `list_roles` to review existing roles. If one already has the needed
permissions, skip to Step 3.

### Step 2: Create a Role (if Needed)

```json
{
  "name": "my-new-role",
  "description": "Purpose-specific role",
  "permissions": [
    "certificates:enroll:MyProfile",
    "certificates:search:MyProfile"
  ]
}
```

**Best practice**: Create purpose-specific roles with minimal permissions
(principle of least privilege). Avoid `*:*:*` unless truly needed.

### Step 3: Assign Role to Principal

Use `update_principal` with the GET -> merge -> PUT pattern to add the new
role to the principal's existing roles without overwriting:

```json
{
  "roles": ["existing-role-1", "existing-role-2", "my-new-role"]
}
```

### Step 4: Verify

Use `get_principal` to confirm the role assignment. The principal's effective
permissions are computed server-side and include all implied permissions from
wildcard expansion.

---

## Common RBAC Patterns

### Profile-Scoped Operator

Grant full certificate lifecycle on a single profile:

```json
{
  "name": "operator-TLS",
  "permissions": [
    "certificates:search:TLS-Internal",
    "certificates:enroll:TLS-Internal",
    "certificates:revoke:TLS-Internal",
    "certificates:renew:TLS-Internal",
    "certificates:update:TLS-Internal",
    "certificates:approve:TLS-Internal"
  ]
}
```

### Read-Only Auditor

```json
{
  "name": "auditor",
  "permissions": ["certificates:search:*", "discovery:events:*"]
}
```

### Configuration Admin (No Certificate Access)

```json
{
  "name": "config-admin",
  "permissions": ["configuration:*:*"]
}
```

### Emergency Break-Glass

```json
{
  "name": "break-glass",
  "permissions": ["*:*:*"],
  "description": "Emergency full-admin role. Assign temporarily, audit usage."
}
```

### Separation of Duties: Requester vs. Approver

Create two roles to enforce four-eyes principle:

```json
// Requester role
{
  "name": "cert-requester",
  "permissions": ["certificates:enroll:TLS-Internal", "certificates:search:TLS-Internal"]
}

// Approver role (different principal)
{
  "name": "cert-approver",
  "permissions": ["certificates:approve:TLS-Internal", "certificates:search:TLS-Internal"]
}
```
