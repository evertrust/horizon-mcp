# Horizon CLM Architecture -- Object Model and Dependencies

## Overview

Horizon is a Certificate Lifecycle Management (CLM) platform built around
a directed acyclic graph (DAG) of configuration objects. Understanding the
dependency order is essential for correct creation and teardown sequences.

---

## Object Model DAG

```
Credential
  +---> PKI Connector --------------------------------+
  +---> Third-Party Connector ------------------------+
                                                      |
Proxy ------------------------------------------------+
                                                      |
Datasource -------------------------------------------+
                                                      |
Grading Policy ---------------------------------------+
                                                      |
Password Policy --------------------------------------+
                                                      |
Label Definition -------------------------------------+
                                                      v
                                                   Profile
                                                      |
                                    +-----------------+-----------------+
                                    v                 v                 v
                               Certificate         Request          Trigger
                                    |                                  |
                                    v                                  v
                                  Event                          Automation
```

### Dependency Order (Creation)

Create objects in this order -- each object may reference objects above it:

1. **Credentials** -- keystores, passwords, API keys stored in Horizon
2. **Proxies** -- HTTP proxy configurations for outbound connections
3. **PKI Connectors** -- CA integration endpoints (reference credentials + proxies)
4. **Third-Party Connectors** -- external system integrations (reference credentials)
5. **Datasources** -- LDAP, HTTP, DNS sources (reference credentials + proxies)
6. **Grading Policies** -- certificate security scoring rules
7. **Password Policies** -- PKCS#12 / key export password rules
8. **Label Definitions** -- organizational tags
9. **CAs** -- certificate authority trust objects (import CA certificates)
10. **Profiles** -- certificate lifecycle definitions (reference connectors, datasources, policies)
11. **Triggers** -- notification rules that react to certificate events (attach to profiles)
12. **Discovery Campaigns** -- network scanning configurations (reference profiles for import)

### Dependency Order (Deletion)

Delete in reverse order. Horizon will reject deletion of objects that are
still referenced by other objects. For example, you cannot delete a PKI
connector that is referenced by an active profile.

---

## Module Types

Horizon modules define the protocol-specific behavior of a profile:

| Module        | Enum Value     | Category   | Key Characteristics                                               |
| ------------- | -------------- | ---------- | ----------------------------------------------------------------- |
| WebRA         | `webra`        | Managed    | Web-based enrollment, richest configuration surface               |
| ACME          | `acme`         | Managed    | RFC 8555, automated domain validation, always auto-approve        |
| SCEP          | `scep`         | Managed    | Network device enrollment, challenge-based auth                   |
| EST           | `est`          | Managed    | RFC 7030, TLS-secured enrollment, modern devices                  |
| WCCE          | `wcce`         | Managed    | Windows Certificate auto-enrollment (AD-integrated)               |
| CRMP          | `crmp`         | Managed    | CMP (Certificate Management Protocol) enrollment                  |
| Intune        | `intune`       | Managed    | Microsoft Intune MDM enrollment (SCEP-based)                      |
| IntunePKCS    | `intunepkcs`   | Managed    | Microsoft Intune MDM enrollment (PKCS-based)                      |
| Jamf          | `jamf`         | Managed    | Jamf MDM enrollment                                               |
| ACME External | `acmeexternal` | Managed    | ACME enrollment via external ACME CA                              |
| Monitored     | `monitored`    | Monitored  | No issuance - observation, labeling, ownership, and notifications |
| Discovery     | `discovery`    | Discovered | Inventory only - stores discovery data, no enrichment             |

### Certificate Lifecycle Stages

Certificates progress through three stages, each corresponding to a module category:

```
Discovered  --->  Monitored  --->  Managed
(discovery)      (monitored)      (webra, acme, scep, ...)
```

- **Discovered**: The certificate exists in a `discovery` profile for inventory purposes only. The relevant data are the certificate's discovery metadata (hosts, ports, paths, services).
- **Monitored**: The certificate has been promoted to a `monitored` profile and enriched with labels, ownership metadata, and/or notification rules.
- **Managed**: The certificate is under full lifecycle control in a managed profile (enrollment, renewal, revocation, recovery).

All transitions are **one-way**: a certificate can move from discovered to monitored to managed, but never backwards. You can stop at any stage. A certificate cannot be both monitored and managed at the same time.

A certificate can simultaneously exist in a `discovery` profile (for its discovery data) and in a `monitored` or `managed` profile (for its lifecycle). The `discovery` module is only for certificates that are discovered and have no other profile assignment.

**Managed** modules control the full certificate lifecycle: enrollment,
renewal, revocation, and recovery. They require a PKI connector.

**Monitored** modules observe externally-issued certificates. They have
no PKI connector, no computation rules, and no key escrow, but support
labels, ownership, and notifications.

**Discovery** modules are pure inventory. They store only the discovery
metadata with no enrichment or lifecycle control.

---

## PKI Connector Types (22)

| Type         | CA / Protocol                   |
| ------------ | ------------------------------- |
| `stream`     | Stream CA (generic)             |
| `acmeenroll` | ACME enrollment connector       |
| `acmerevoke` | ACME revocation connector       |
| `evtadcs`    | Evertrust ADCS connector        |
| `ejbca_rest` | EJBCA REST                      |
| `awsacmpca`  | AWS ACM Private CA              |
| `certeurope` | CertEurope CA                   |
| `cmp`        | Certificate Management Protocol |
| `digicert`   | DigiCert CertCentral            |
| `ejbca`      | EJBCA                           |
| `gcp`        | Google Cloud Platform           |
| `idca`       | IDCA                            |
| `integrated` | Integrated CA (built-in)        |
| `fcms`       | FCMS                            |
| `gsatlas`    | GlobalSign Atlas                |
| `gsmssl`     | GlobalSign MSSL                 |
| `otpki`      | OpenTrust PKI                   |
| `metapki`    | MetaPKI                         |
| `nameshield` | Nameshield                      |
| `nexuscm`    | Nexus Certificate Manager       |
| `sectigo`    | Sectigo                         |
| `swisssign`  | SwissSign                       |

---

## Third-Party Connector Types (10)

| Type         | Target System                     |
| ------------ | --------------------------------- |
| `aws`        | AWS Certificate Manager / Secrets |
| `akv`        | Azure Key Vault                   |
| `f5as3`      | F5 BIG-IP (AS3 declarative)       |
| `f5client`   | F5 BIG-IP (iControl REST)         |
| `gcm`        | Google Cloud Certificate Manager  |
| `intune`     | Microsoft Intune (SCEP)           |
| `intunepkcs` | Microsoft Intune (PKCS)           |
| `jamf`       | Jamf Pro                          |
| `ldappub`    | LDAP Publishing                   |
| `msad`       | Microsoft Active Directory        |

---

## Core API Surface

| Domain            | Base Path                           | Key Operations                                             |
| ----------------- | ----------------------------------- | ---------------------------------------------------------- |
| Certificates      | `/api/v1/certificates`              | search, get, download, enroll, revoke, renew, update       |
| Requests          | `/api/v1/requests`                  | search, get, submit, approve, deny, cancel                 |
| Profiles          | `/api/v1/certificate/profiles`      | list, get, create, update, delete                          |
| PKI Connectors    | `/api/v1/pki/connectors`            | list, get, create, update, delete                          |
| 3P Connectors     | `/api/v1/thirdparty/connectors`     | list, get, create, update, delete                          |
| Datasources       | `/api/v1/datasources`               | list, get, create, update, delete, test                    |
| CAs               | `/api/v1/cas`                       | list, get, create, update, delete, CRL cache, trust chains |
| Security          | `/api/v1/security/*`                | roles, teams, principals, IDPs, credentials                |
| Triggers          | `/api/v1/triggers`                  | list, get, create, update, delete, test                    |
| Discovery         | `/api/v1/discovery/*`               | campaigns, events, results                                 |
| Events            | `/api/v1/events`                    | search, get, export                                        |
| Labels            | `/api/v1/certificate/labels`        | list, get, create, update, delete                          |
| Proxies           | `/api/v1/proxy/httpproxies`         | list, get, create, update, delete                          |
| Password Policies | `/api/v1/security/passwordpolicies` | list, get, generate                                        |
| Grading           | `/api/v1/certificate/grading/*`     | list, get (policies and rulesets)                          |

---

## Key Architectural Principles

1. **Profile-centric**: Everything revolves around profiles. A profile is the
   unit of policy, access control, and certificate lifecycle.

2. **Connector abstraction**: Horizon decouples certificate policy (profile)
   from CA technology (connector). You can swap CAs without changing profiles.

3. **Event-driven**: Every lifecycle action produces an event. Triggers react
   to events to drive automation (notifications, publishing, auto-renewal).

4. **Multi-tenant via teams**: Teams provide organizational boundaries.
   Certificate ownership, visibility, and approval flows are scoped by team.

5. **Protocol-agnostic core**: The core engine (computation rules, workflows,
   RBAC) is shared across all protocols. Protocol-specific behavior is
   isolated in the module layer.

6. **GET-strip-merge-PUT update pattern**: All configuration updates use the
   same pattern: fetch the current state, strip server-computed fields, merge
   in the desired changes, and PUT the complete object back.

7. **Immutable names**: ALL object names in Horizon are immutable after
   creation - names are used as primary keys in the database and CANNOT be
   changed. This applies to every configuration object: profiles, connectors,
   datasources, CAs, triggers, roles, teams, dashboards, saved queries,
   labels, discovery campaigns, etc. When creating any object, you MUST ask
   the user for the name - never invent or guess names on their behalf.
   To rename an object, the only option is to delete it and recreate it.
   Most objects also support a **display name** (`displayName`) - a mutable
   human-friendly label shown in the Horizon UI. When a creation tool accepts
   a `display_name` parameter, always ask the user for it alongside the name.
