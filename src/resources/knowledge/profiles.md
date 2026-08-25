# Horizon Certificate Profiles -- Complete Field Reference

## Overview

A **profile** is the central configuration object in Horizon CLM. It defines
how certificates are requested, validated, issued, and managed for a specific
enrollment protocol. Every certificate in Horizon belongs to exactly one profile.

Horizon supports two categories of profiles:

| Category      | Module Types                                                 | Description                                                                     |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Managed**   | WebRA, ACME, SCEP, EST, WCCE, CRMP, Intune, IntunePKCS, Jamf | Horizon controls the full lifecycle: enrollment, renewal, revocation, recovery. |
| **Monitored** | Monitored (CertMonitor)                                      | Horizon _observes_ externally-issued certificates but does not issue them.      |

Each profile is accessed via `GET /api/v1/certificate/profiles/{name}` (read)
or `PUT /api/v1/certificate/profiles/` with the name in the JSON body (update),
and contains protocol-specific settings nested under a `module` object.

---

## Common Fields (All Managed Profiles)

These fields appear on every managed profile regardless of protocol module:

| Field                           | Type     | Description                                                                                                 |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `name`                          | string   | Unique profile identifier. Immutable after creation.                                                        |
| `displayName`                   | string   | Human-readable label shown in the UI.                                                                       |
| `description`                   | string   | Free-text description of the profile's purpose.                                                             |
| `enabled`                       | boolean  | Whether the profile accepts new enrollment requests.                                                        |
| `module`                        | string   | Protocol type: `webra`, `acme`, `scep`, `est`, `wcce`, `crmp`, `intune`, `intunepkcs`, `jamf`, `monitored`. |
| `pkiConnector`                  | string   | Name of the PKI connector used for enrollment. Required for all managed profiles.                           |
| `certificateTemplate`           | object   | Default DN, SANs, key type, key size, extensions, labels, and policies for certificates.                    |
| `authorizationLevels`           | object   | WHO can perform each workflow action (enroll, revoke, update, etc.). See _workflows_ knowledge.             |
| `cryptoPolicy`                  | object   | Key generation mode (`centralized` or `decentralized`), allowed key types, PKCS#12 settings.                |
| `selfPermissions`               | object   | What a certificate holder can do with their own certificate (self-revoke, self-renew, etc.).                |
| `requestsPolicy`                | object   | HOW LONG: duration limits, request expiry, and workflow-specific timing per workflow type.                  |
| `triggers`                      | object   | Hook configuration mapping lifecycle events to notification triggers.                                       |
| `gradingPolicies`               | string[] | Names of grading policies applied to certificates in this profile.                                          |
| `dsFlow`                        | object[] | Ordered list of datasource flow entries for external data enrichment during enrollment.                     |
| `maxCertificatePerHolderPolicy` | object   | Limit on concurrent active certificates per holder identity.                                                |
| `renewalPeriod`                 | integer  | Number of days before expiry when renewal becomes available.                                                |
| `pqcAllowed`                    | boolean  | Whether post-quantum cryptography key types are permitted.                                                  |
| `thirdPartyDiscoverySync`       | boolean  | Whether certificates discovered by third-party sources are synced into this profile.                        |

---

## WebRA Auto-Renewal Policy

WebRA profiles can set `autoRenewalPolicy` to control the initial auto-renew
flag on their certificates:

```json
{
  "autoRenewalPolicy": {
    "default": true,
    "editable": true
  }
}
```

`default` is the auto-renew value for new certificates. `editable` determines
whether a certificate's auto-renew value can be changed through the WebRA
`update` workflow. The server-side transitions are important: adding the policy
where none existed bulk-sets existing certificates to the new `default`;
removing it disables auto-renew on all the profile's certificates; changing an
existing policy does not bulk-rewrite existing certificate flags.

This is WebRA per-certificate automatic renewal. It is not the trust-chain
automation-policy renewal described in `automation.md`; that older automation
controls trust-chain operations rather than this certificate flag.

---

## Certificate Template Structure

The `certificateTemplate` object defines the _defaults_ for certificates
enrolled under this profile. Computation rules can override any of these
at enrollment time.

```json
{
  "certificateTemplate": {
    "subject": {
      "dnQualifier": "",
      "commonName": "",
      "organization": "",
      "organizationalUnit": "",
      "country": "",
      "stateOrProvince": "",
      "locality": "",
      "email": ""
    },
    "sans": {
      "dnsnames": [],
      "rfc822names": [],
      "ipaddresses": [],
      "uris": [],
      "othernames": []
    },
    "keyType": "rsa",
    "keySize": 2048,
    "signatureAlgorithm": "SHA256WithRSA",
    "extensions": {},
    "labels": [],
    "policies": []
  }
}
```

**Important**: The `subject` fields use the Horizon internal naming convention
(camelCase), not the X.500 OID names. The `extensions` object allows defining
custom X.509v3 extensions by OID. The `labels` array associates profile-level
tags that flow down to every certificate. The `policies` array can embed
certificate policy OIDs and qualifiers.

---

## Per-Module Specific Fields (v1A Modules)

### WebRA Module (`module: "webra"`)

WebRA is the primary web-based enrollment protocol. It supports the richest
set of configuration options.

| Field                  | Type     | Description                                                                                        |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `authorizationMode`    | string   | `authorized`, `auto-validation`, `auto-validation-authorized`. Controls how requests are approved. |
| `validationRuleset`    | string   | Required when `authorizationMode` contains `auto-validation`. Ruleset that decides auto-approval.  |
| `computationRules`     | object[] | Ordered list of computation rules that transform request data before enrollment.                   |
| `dataSourceFlows`      | object[] | Chained datasource lookups that enrich request data.                                               |
| `enrollmentMode`       | string   | `centralized` (Horizon generates key pair) or `decentralized` (CSR-based).                         |
| `passwordPolicy`       | object   | Password requirements for PKCS#12 download (centralized mode).                                     |
| `notificationTemplate` | string   | Email template for enrollment notifications.                                                       |
| `webhooks`             | object[] | Webhook triggers for lifecycle events.                                                             |

#### WebRA Authorization Modes

- **`authorized`**: Every enrollment request requires explicit approval by an
  authorized operator before the certificate is issued.
- **`auto-validation`**: Enrollment proceeds automatically if the request
  passes the configured `validationRuleset`. No human approval needed.
- **`auto-validation-authorized`**: Enrollment tries auto-validation first.
  If the rules reject the request, it falls back to the manual approval queue
  for an authorized operator.

See horizon://knowledge/validation-rules for the complete validation rule
condition syntax (operators, boolean logic, datasource references, resolvesDNS,
CIDR matching, array quantifiers).

### ACME Module (`module: "acme"`)

ACME (RFC 8555) profiles support automated certificate issuance via the
ACME protocol. Horizon acts as an ACME server.

| Field                    | Type     | Description                                                                            |
| ------------------------ | -------- | -------------------------------------------------------------------------------------- |
| `authorizationMode`      | string   | Always effectively auto -- ACME protocol handles domain validation through challenges. |
| `challengeTypes`         | string[] | Supported ACME challenge types: `http-01`, `dns-01`, `tls-alpn-01`.                    |
| `dns01Provider`          | object   | DNS provider configuration for `dns-01` challenges.                                    |
| `externalAccountBinding` | boolean  | Whether EAB is required for new ACME accounts.                                         |
| `allowWildcard`          | boolean  | Whether wildcard certificates are permitted.                                           |
| `computationRules`       | object[] | Computation rules applied after ACME validation, before certificate issuance.          |

**Note**: ACME profiles do not use `authorizationMode` in the same way as
WebRA. The ACME protocol itself handles domain validation through challenges.
The `validationRuleset` field is not applicable.

### SCEP Module (`module: "scep"`)

SCEP (Simple Certificate Enrollment Protocol) is used primarily for network
device enrollment.

| Field                   | Type     | Description                                                              |
| ----------------------- | -------- | ------------------------------------------------------------------------ |
| `authorizationMode`     | string   | `challenge`, `auto-validation`, `auto-validation-authorized`, or `ndes`. |
| `validationRuleset`     | string   | Ruleset for auto-validation modes.                                       |
| `challengePassword`     | string   | Static challenge password for SCEP clients (when mode is `challenge`).   |
| `challengePasswordMode` | string   | `static` (single password) or `dynamic` (per-request OTP).               |
| `computationRules`      | object[] | Transformation rules applied to SCEP requests.                           |
| `caCapabilities`        | string[] | Advertised CA capabilities (`POSTPKIOperation`, `SHA-256`, etc.).        |

#### SCEP Authorization Modes

- **`challenge`**: Client must present a valid challenge password.
- **`auto-validation`**: Automatic validation via ruleset.
- **`auto-validation-authorized`**: Try rules first, fall back to manual.
- **`ndes`**: Network Device Enrollment Service mode for Microsoft NDES integration.

### EST Module (`module: "est"`)

EST (Enrollment over Secure Transport, RFC 7030) provides modern,
TLS-secured enrollment.

| Field                 | Type     | Description                                              |
| --------------------- | -------- | -------------------------------------------------------- |
| `authorizationMode`   | string   | `x509`, `auto-validation`, `auto-validation-authorized`. |
| `validationRuleset`   | string   | Ruleset for auto-validation modes.                       |
| `computationRules`    | object[] | Transformation rules for EST requests.                   |
| `clientCertAuth`      | boolean  | Whether to require client certificate authentication.    |
| `reenrollmentAllowed` | boolean  | Whether simple re-enrollment is permitted.               |

#### EST Authorization Modes

- **`x509`**: Client must authenticate with a valid client certificate.
- **`auto-validation`**: Automatic validation via ruleset.
- **`auto-validation-authorized`**: Try rules first, fall back to manual.

### Monitored Module (`module: "monitored"`)

Monitored profiles do not issue certificates. They define a _bucket_ for
certificates discovered or imported from external sources.

| Field               | Type     | Description                                                         |
| ------------------- | -------- | ------------------------------------------------------------------- |
| `discoveryEnabled`  | boolean  | Whether this profile accepts certificates from discovery campaigns. |
| `importEnabled`     | boolean  | Whether manual/API import is allowed.                               |
| `gradingPolicy`     | string   | Security grading policy name applied to monitored certificates.     |
| `notificationRules` | object[] | Expiration notification rules.                                      |

**Note**: Monitored profiles have no `pkiConnector`, no `authorizationMode`,
no `computationRules`, and no `keyEscrowPolicy` -- because Horizon does not
issue certificates for them.

---

## AuthorizationMode Summary by Module

| Module     | Supported `authorizationMode` Values                                 | `validationRuleset` Required? |
| ---------- | -------------------------------------------------------------------- | ----------------------------- |
| WebRA      | `authorized`, `auto-validation`, `auto-validation-authorized`        | Yes for `auto-validation*`    |
| ACME       | N/A (inherently automated via ACME challenges)                       | Never                         |
| SCEP       | `challenge`, `auto-validation`, `auto-validation-authorized`, `ndes` | Yes for `auto-validation*`    |
| EST        | `x509`, `auto-validation`, `auto-validation-authorized`              | Yes for `auto-validation*`    |
| Monitored  | N/A (no enrollment)                                                  | Never                         |
| WCCE       | Windows auto-enrollment (AD integrated)                              | Depends on configuration      |
| CRMP       | CMP-based authorization                                              | Depends on configuration      |
| Intune     | MDM-based authorization (Intune SCEP)                                | Depends on configuration      |
| IntunePKCS | MDM-based authorization (Intune PKCS)                                | Depends on configuration      |
| Jamf       | MDM-based authorization (Jamf)                                       | Depends on configuration      |

---

## `csrDataMapping` -- DEPRECATED

The `csrDataMapping` field was the original mechanism for extracting values
from CSR fields and mapping them to certificate attributes. It has been
**fully superseded by computation rules**.

Do not use `csrDataMapping` in new profiles. If you encounter it in an
existing profile, recommend migrating to `computationRules`.

Migration example:

```
# Old csrDataMapping
"csrDataMapping": {
  "commonName": "CN",
  "organization": "O"
}

# New computation rule equivalent
"computationRules": [
  {
    "source": "{{ csr.subject.cn }}",
    "target": "subject.commonName"
  },
  {
    "source": "{{ csr.subject.o }}",
    "target": "subject.organization"
  }
]
```

---

## Profile <-> PKI Connector Relationship

Every managed profile must reference exactly one PKI connector. The connector
determines:

1. **Which CA** issues the certificate (ADCS, EJBCA, Sectigo, etc.)
2. **How** Horizon communicates with the CA (protocol, credentials, endpoint)
3. **Which CA template** to use (if the CA supports templates)

The profile's `pkiConnector` field is a string reference to a connector name.
The connector must exist before the profile can be created or updated to
reference it.

```
Profile "TLS-Internal"
  +-- pkiConnector: "adcs-prod"
       +-- type: "msadcs"
       +-- configuration:
            +-- url: "https://adcs.corp.example.com/certsrv"
            +-- template: "WebServer"
```

**Dependency order**: Credential -> PKI Connector -> Profile.

---

## API Operations

| Operation         | Method | Path                                  |
| ----------------- | ------ | ------------------------------------- |
| List all profiles | GET    | `/api/v1/certificate/profiles`        |
| Get a profile     | GET    | `/api/v1/certificate/profiles/{name}` |
| Create a profile  | POST   | `/api/v1/certificate/profiles`        |
| Update a profile  | PUT    | `/api/v1/certificate/profiles/`       |
| Delete a profile  | DELETE | `/api/v1/certificate/profiles/{name}` |

**Update pattern**: Always use GET -> strip server fields -> merge changes -> PUT
with the profile name in the JSON body (not in the URL path).
Never send a partial object -- the PUT replaces the entire profile.

---

## Quick Decision Guide

| I want to...                             | Set...                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Issue certs from a web UI                | `module: "webra"`                                                       |
| Automate with ACME (Let's Encrypt style) | `module: "acme"`, configure challenges                                  |
| Enroll network devices                   | `module: "scep"`                                                        |
| Modern device enrollment                 | `module: "est"`                                                         |
| Windows auto-enrollment (WCCE)           | `module: "wcce"`                                                        |
| CMP-based enrollment                     | `module: "crmp"`                                                        |
| Intune MDM enrollment (SCEP)             | `module: "intune"`                                                      |
| Intune MDM enrollment (PKCS)             | `module: "intunepkcs"`                                                  |
| Jamf MDM enrollment                      | `module: "jamf"`                                                        |
| Track external certs                     | `module: "monitored"`                                                   |
| Require human approval                   | `authorizationMode: "authorized"`                                       |
| Auto-approve all requests via rules      | `authorizationMode: "auto-validation"` + `validationRuleset`            |
| Auto-approve with fallback to manual     | `authorizationMode: "auto-validation-authorized"` + `validationRuleset` |
| Server-side key generation               | `cryptoPolicy.mode: "centralized"`                                      |
| Client generates CSR                     | `cryptoPolicy.mode: "decentralized"`                                    |

---

## CertificateTemplate Schema (API-Level)

The `certificateTemplate` object sent in create/update API calls is composed of
8 nested sub-structures. This section documents the **API-level JSON schema**
(what the Horizon server expects and returns), which is the authoritative
reference for building profile payloads.

```
CertificateTemplate:
  subject:            list[DNElement]
  sans:               list[SANElement]
  extensions:         list[ExtensionElement]
  ownerPolicy:        OwnerPolicy | null
  teamPolicy:         TeamPolicy | null
  metadataPolicies:   list[MetadataPolicy] | null
  labels:             list[LabelElement] | null
  contactEmailPolicy: ContactEmailPolicy | null
```

### DNElement (Subject Distinguished Name)

Each element describes one DN attribute (CN, O, OU, etc.) with value/editability
constraints.

| Field                 | Type          | Required | Description                                                                       |
| --------------------- | ------------- | -------- | --------------------------------------------------------------------------------- |
| `type`                | string        | yes      | DN attribute type: `CN`, `O`, `OU`, `C`, `ST`, `L`, `EMAIL`, `SERIALNUMBER`, etc. |
| `value`               | string\|null  | no       | Static value. Mutually exclusive with `computationRule`.                          |
| `computationRule`     | string\|null  | no       | Dynamic value from the computation engine.                                        |
| `mandatory`           | boolean       | yes      | Whether the field is required during enrollment.                                  |
| `editableByRequester` | boolean\|null | no       | Can the requester modify this field in the request form.                          |
| `editableByApprover`  | boolean\|null | no       | Can the approver modify this field during approval.                               |
| `regex`               | string\|null  | no       | Validation regex applied to the field value.                                      |

```json
{
  "type": "CN",
  "value": null,
  "computationRule": null,
  "mandatory": true,
  "editableByRequester": true,
  "editableByApprover": true,
  "regex": "^[a-zA-Z0-9.-]+\\.example\\.com$"
}
```

### SANElement (Subject Alternative Names)

SAN elements define cardinality and editability constraints. **Unlike DNElement,
SANElement has NO `value` field** -- SAN values are always provided at enrollment
time or computed via `computationRule`.

| Field                 | Type          | Required | Description                                                                           |
| --------------------- | ------------- | -------- | ------------------------------------------------------------------------------------- |
| `type`                | string        | yes      | SAN type: `DNSNAME`, `RFC822`, `IPADDRESS`, `URI`, `OTHERNAME`, `DIRECTORYNAME`, etc. |
| `computationRule`     | string\|null  | no       | Dynamic value from the computation engine.                                            |
| `editableByRequester` | boolean\|null | no       | Can the requester add/modify SANs of this type.                                       |
| `editableByApprover`  | boolean\|null | no       | Can the approver add/modify SANs of this type.                                        |
| `regex`               | string\|null  | no       | Validation regex applied to each SAN value.                                           |
| `min`                 | integer\|null | no       | Minimum cardinality (how many values are required).                                   |
| `max`                 | integer\|null | no       | Maximum cardinality (how many values are allowed).                                    |

```json
{
  "type": "DNSNAME",
  "computationRule": null,
  "editableByRequester": true,
  "editableByApprover": true,
  "regex": "^[a-zA-Z0-9.-]+\\.example\\.com$",
  "min": 1,
  "max": 10
}
```

### ExtensionElement (X.509v3 Extensions)

| Field                 | Type          | Required | Description                                                   |
| --------------------- | ------------- | -------- | ------------------------------------------------------------- |
| `type`                | string        | yes      | Extension OID or well-known name (e.g., `2.5.29.37` for EKU). |
| `value`               | string\|null  | no       | Static extension value.                                       |
| `computationRule`     | string\|null  | no       | Dynamic value from the computation engine.                    |
| `mandatory`           | boolean       | yes      | Whether the extension is required.                            |
| `editableByRequester` | boolean\|null | no       | Can the requester modify this extension.                      |
| `editableByApprover`  | boolean\|null | no       | Can the approver modify this extension.                       |
| `regex`               | string\|null  | no       | Validation regex.                                             |

### Policy Sub-Structures

These lightweight objects control editability and auto-fill behavior for
ownership, team assignment, metadata, labels, and contact email fields.

| Sub-Structure          | Fields                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| **OwnerPolicy**        | `editable: bool`, `required: bool`, `autoFill: bool`                         |
| **TeamPolicy**         | `editable: bool`, `required: bool`                                           |
| **MetadataPolicy**     | `key: str`, `editable: bool`, `required: bool`, `regexValidation: str\|null` |
| **LabelElement**       | `label: str`, `value: str`, `editable: bool`, `regexValidation: str\|null`   |
| **ContactEmailPolicy** | `editable: bool`, `required: bool`, `autoFill: bool`                         |

### Full CertificateTemplate Example

```json
{
  "certificateTemplate": {
    "subject": [
      {
        "type": "CN",
        "mandatory": true,
        "editableByRequester": true,
        "editableByApprover": true,
        "regex": "^[a-zA-Z0-9.-]+$"
      },
      {
        "type": "O",
        "value": "Acme Corp",
        "mandatory": true,
        "editableByRequester": false
      },
      {
        "type": "OU",
        "computationRule": "{{ datasource.department }}",
        "mandatory": false,
        "editableByRequester": false
      }
    ],
    "sans": [
      {
        "type": "DNSNAME",
        "editableByRequester": true,
        "regex": "^[a-zA-Z0-9.-]+\\.acme\\.com$",
        "min": 1,
        "max": 5
      },
      {
        "type": "IPADDRESS",
        "editableByRequester": true,
        "min": 0,
        "max": 2
      }
    ],
    "extensions": [
      {
        "type": "2.5.29.37",
        "value": "1.3.6.1.5.5.7.3.1",
        "mandatory": true,
        "editableByRequester": false
      }
    ],
    "ownerPolicy": {
      "editable": true,
      "required": true,
      "autoFill": true
    },
    "teamPolicy": {
      "editable": true,
      "required": false
    },
    "contactEmailPolicy": {
      "editable": true,
      "required": true,
      "autoFill": true
    },
    "metadataPolicies": [
      {
        "key": "environment",
        "editable": true,
        "required": true,
        "regexValidation": "^(prod|staging|dev)$"
      }
    ],
    "labels": [
      {
        "label": "department",
        "value": "engineering",
        "editable": true,
        "regexValidation": null
      }
    ]
  }
}
```

---

## AuthorizationLevels Schema (26 Fields)

The `authorizationLevels` object controls **WHO** can perform each workflow
action on certificates in this profile. It contains 26 fields: 4 required and
22 optional, organized by workflow.

### Required Fields (4)

These fields **must** be present on every profile:

| Field           | Description                                  |
| --------------- | -------------------------------------------- |
| `search`        | Who can search certificates in this profile. |
| `update`        | Who can update certificates.                 |
| `requestUpdate` | Who can request a certificate update.        |
| `approveUpdate` | Who can approve update requests.             |

### Optional Fields (22) Grouped by Workflow

| Workflow   | Fields                                                      |
| ---------- | ----------------------------------------------------------- |
| Enrollment | `enroll`, `enrollApi`, `requestEnroll`, `approveEnroll`     |
| Revocation | `revoke`, `requestRevoke`, `approveRevoke`                  |
| Renewal    | `renew`, `renewApi`, `requestRenew`, `approveRenew`         |
| Recovery   | `recover`, `recoverApi`, `requestRecover`, `approveRecover` |
| Migration  | `migrate`, `requestMigrate`, `approveMigrate`               |
| Import     | `import`, `requestImport`, `approveImport`                  |
| Audit      | `auditRequest`                                              |

### AuthorizationLevel Object

Each field value is an `AuthorizationLevel` object:

```json
{
  "accessLevel": "authorized",
  "enforcedIdentityProviders": [
    { "type": "X509", "name": "corporate-ca" },
    { "type": "OpenId", "name": "azure-ad" }
  ]
}
```

| Field                       | Type                     | Required | Description                                        |
| --------------------------- | ------------------------ | -------- | -------------------------------------------------- |
| `accessLevel`               | string                   | yes      | `"everyone"`, `"authenticated"`, or `"authorized"` |
| `enforcedIdentityProviders` | list[{type, name}]\|null | no       | IDP constraints for this action.                   |

The `type` field in each enforced IDP entry is one of: `"X509"`, `"Pop"`,
`"Local"`, `"OpenId"`.

### Access Level Semantics

| Level           | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `everyone`      | No authentication required (anonymous access).                 |
| `authenticated` | Any authenticated user, regardless of role or team membership. |
| `authorized`    | Only users with explicit permission via role/team assignment.  |

### AuthorizationLevels Example

```json
{
  "authorizationLevels": {
    "search": { "accessLevel": "authenticated" },
    "update": { "accessLevel": "authorized" },
    "requestUpdate": { "accessLevel": "authenticated" },
    "approveUpdate": { "accessLevel": "authorized" },
    "enroll": { "accessLevel": "authorized" },
    "enrollApi": { "accessLevel": "authorized" },
    "requestEnroll": { "accessLevel": "authenticated" },
    "approveEnroll": {
      "accessLevel": "authorized",
      "enforcedIdentityProviders": [{ "type": "X509", "name": "corporate-pki" }]
    },
    "revoke": { "accessLevel": "authorized" },
    "requestRevoke": { "accessLevel": "authenticated" },
    "approveRevoke": { "accessLevel": "authorized" },
    "renew": { "accessLevel": "authorized" },
    "renewApi": { "accessLevel": "authorized" },
    "requestRenew": { "accessLevel": "authenticated" },
    "approveRenew": { "accessLevel": "authorized" },
    "auditRequest": { "accessLevel": "authorized" }
  }
}
```

---

## CryptoPolicy (Discriminated by Profile Category)

The `cryptoPolicy` object differs between managed and monitored profiles.

### ManagedCryptoPolicy (WebRA, ACME, SCEP, EST, WCCE, CRMP, Intune, IntunePKCS, Jamf)

Controls what key types the profile accepts during enrollment and how keys are
generated/escrowed.

| Field             | Type         | Required | Description                                                           |
| ----------------- | ------------ | -------- | --------------------------------------------------------------------- |
| `allowedKeyTypes` | list[string] | yes      | Accepted key type specs, e.g., `["rsa-2048", "rsa-4096", "ec-p256"]`. |
| `defaultKeyType`  | string\|null | no       | Default if requester does not specify a key type.                     |

```json
{
  "cryptoPolicy": {
    "allowedKeyTypes": ["rsa-2048", "rsa-4096", "ec-p256", "ec-p384"],
    "defaultKeyType": "rsa-2048"
  }
}
```

**Key type format**: Algorithm family + size/curve, lowercase with hyphen.
Common values: `rsa-2048`, `rsa-3072`, `rsa-4096`, `ec-p256`, `ec-p384`,
`ec-p521`, `ed25519`.

### MonitoredCryptoPolicy (Monitored profiles)

Controls grading and compliance rules for discovered/imported certificates.

| Field                      | Type               | Required | Description                                         |
| -------------------------- | ------------------ | -------- | --------------------------------------------------- |
| `minimumKeySize`           | integer\|null      | no       | Minimum acceptable key size for compliance grading. |
| `allowedSigningAlgorithms` | list[string]\|null | no       | Accepted signing algorithms for compliance grading. |

```json
{
  "cryptoPolicy": {
    "minimumKeySize": 2048,
    "allowedSigningAlgorithms": [
      "SHA256WithRSA",
      "SHA384WithRSA",
      "SHA256WithECDSA"
    ]
  }
}
```

---

## ValidationRuleset Structure

A `validationRuleset` is required when a profile uses `authorizationMode` of
`auto-validation` or `auto-validation-authorized`. It defines a set of boolean
conditions and a threshold that controls auto-approval.

| Field       | Type         | Required | Description                                                               |
| ----------- | ------------ | -------- | ------------------------------------------------------------------------- |
| `rules`     | list[string] | yes      | Boolean condition expressions (plain strings, NOT objects).               |
| `threshold` | integer      | yes      | Minimum number of rules that must match. Must be > 0 and <= `len(rules)`. |

The `threshold` means "at least N rules must match for the request to be
auto-approved." If fewer than `threshold` rules pass, the request either fails
(in `auto-validation` mode) or falls through to manual approval (in
`auto-validation-authorized` mode).

```json
{
  "validationRuleset": {
    "rules": ["dn matches \".*\\.example\\.com\"", "keytype contains \"rsa\""],
    "threshold": 1
  }
}
```

**Important**: Rules are plain strings containing HCQL-style boolean
expressions, not structured objects. Each rule evaluates to true or false
against the enrollment request data.

### Threshold Semantics

| Threshold    | Behavior                                                |
| ------------ | ------------------------------------------------------- |
| `1`          | At least one rule must match (logical OR across rules). |
| `N`          | At least N rules must match (quorum).                   |
| `len(rules)` | All rules must match (logical AND across rules).        |

---

## Composing a Complete Profile (Practical Example)

This example shows how all the documented structures compose in a
`create_webra_profile` call, creating a WebRA profile with auto-validation,
centralized key generation, and enforced IDP constraints:

```json
{
  "module": "webra",
  "name": "tls-internal-webra",
  "displayName": "TLS Internal (WebRA)",
  "description": "Internal TLS certificates via web enrollment",
  "enabled": true,
  "pkiConnector": "adcs-prod",
  "pqcAllowed": false,
  "thirdPartyDiscoverySync": false,
  "renewalPeriod": 30,
  "authorizationMode": "auto-validation-authorized",
  "validationRuleset": {
    "rules": [
      "dn matches \".*\\.internal\\.acme\\.com\"",
      "keytype contains \"rsa\""
    ],
    "threshold": 2
  },
  "certificateTemplate": {
    "subject": [
      { "type": "CN", "mandatory": true, "editableByRequester": true },
      {
        "type": "O",
        "value": "Acme Corp",
        "mandatory": true,
        "editableByRequester": false
      },
      {
        "type": "C",
        "value": "US",
        "mandatory": true,
        "editableByRequester": false
      }
    ],
    "sans": [
      { "type": "DNSNAME", "editableByRequester": true, "min": 1, "max": 10 }
    ],
    "extensions": [],
    "ownerPolicy": { "editable": true, "required": true, "autoFill": true },
    "teamPolicy": { "editable": true, "required": false },
    "contactEmailPolicy": {
      "editable": true,
      "required": true,
      "autoFill": true
    },
    "metadataPolicies": [
      {
        "key": "environment",
        "editable": true,
        "required": true,
        "regexValidation": "^(prod|staging|dev)$"
      }
    ],
    "labels": [{ "label": "use-case", "value": "tls", "editable": false }]
  },
  "authorizationLevels": {
    "search": { "accessLevel": "authenticated" },
    "update": { "accessLevel": "authorized" },
    "requestUpdate": { "accessLevel": "authenticated" },
    "approveUpdate": { "accessLevel": "authorized" },
    "enroll": { "accessLevel": "authorized" },
    "requestEnroll": { "accessLevel": "authenticated" },
    "approveEnroll": {
      "accessLevel": "authorized",
      "enforcedIdentityProviders": [{ "type": "OpenId", "name": "azure-ad" }]
    },
    "revoke": { "accessLevel": "authorized" },
    "requestRevoke": { "accessLevel": "authenticated" },
    "approveRevoke": { "accessLevel": "authorized" },
    "renew": { "accessLevel": "authorized" },
    "requestRenew": { "accessLevel": "authenticated" },
    "approveRenew": { "accessLevel": "authorized" }
  },
  "cryptoPolicy": {
    "allowedKeyTypes": ["rsa-2048", "rsa-4096"],
    "defaultKeyType": "rsa-2048"
  },
  "gradingPolicies": ["default-tls-grading"]
}
```
