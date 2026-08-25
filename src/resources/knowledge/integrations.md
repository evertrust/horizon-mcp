# Horizon Integrations -- End-to-End Patterns

## Overview

Horizon integrates with external systems at multiple levels: CA enrollment
(PKI connectors), identity management (IDPs), data enrichment (datasources),
certificate distribution (third-party connectors), and automated clients
(ACME, EST, SCEP). This document covers the common end-to-end integration
patterns and the correct creation order for each.

---

## Creation Order for Integrations

Every integration follows the same dependency chain. Create objects in this
order:

```
1. Credential (if needed -- e.g., API keys, client certificates, passwords)
2. Proxy (if needed -- for outbound HTTP connections through a proxy)
3. Connector / Datasource / IDP (references credential and/or proxy)
4. Profile (references connector, datasource, IDP)
5. Trigger (attaches to profile for automation)
```

---

## Asynchronous PKI Connector Enrollment

The following PKI connector types use asynchronous enrollment and accept a
`retryInterval`: `digicert`, `acmeenroll`, `integrated`, `gsmssl`, `gsatlas`,
`awsacmpca`, `certeurope`, `sectigo`, and `nameshield`. Set it to a positive
finite duration such as `"6 seconds"` when creating or updating the connector.

Horizon keeps a request in `in_progress` while it waits for an external CA.
Find it with `search_requests`, inspect it with `get_request`, and poll for its
completion. A request in `in_progress` can be denied or cancelled if needed.

`retryInterval` is not valid for synchronous PKI connector types. Call
`describe_pki_connector_schema` before configuring a connector to discover the
other fields required by its subtype.

---

## ACME DNS-01 Integration

Use case: Automated certificate issuance for wildcard domains or domains
where HTTP-01 is not feasible.

### Components

| Object        | Type        | Purpose                      |
| ------------- | ----------- | ---------------------------- |
| Credential    | API key     | DNS provider API credentials |
| PKI Connector | CA-specific | Connects to the target CA    |
| Profile       | `acme`      | ACME enrollment with DNS-01  |

### Configuration Flow

1. Create a credential with the DNS provider API key
2. Create a PKI connector for the target CA
3. Create an ACME profile with:
   - `challengeTypes: ["dns-01"]`
   - `dns01Provider` configured with the DNS provider details
   - `allowWildcard: true` if wildcard certificates are needed
   - `externalAccountBinding: true` if the CA requires EAB

### DNS Provider Configuration

```json
{
  "dns01Provider": {
    "type": "rfc2136",
    "configuration": {
      "server": "ns1.example.com",
      "zone": "example.com",
      "keyName": "horizon-update",
      "keyAlgorithm": "hmac-sha256",
      "keySecret": "base64-encoded-key"
    }
  }
}
```

Supported DNS-01 provider types: `rfc2136` (dynamic DNS update), `route53`
(AWS), `cloudflare`, `azuredns`, `googledns`.

---

## MDM Integrations (Intune, Jamf)

Use case: Automatic certificate provisioning for managed devices via MDM.

### Microsoft Intune (SCEP)

| Object                | Type               | Purpose                        |
| --------------------- | ------------------ | ------------------------------ |
| Credential            | Client cert/secret | Intune API authentication      |
| Third-Party Connector | `intune`           | Communicates with Intune       |
| PKI Connector         | CA-specific        | Issues certificates            |
| Profile               | `intune`           | Intune SCEP enrollment profile |

### Microsoft Intune (PKCS)

| Object                | Type               | Purpose                        |
| --------------------- | ------------------ | ------------------------------ |
| Credential            | Client cert/secret | Intune API authentication      |
| Third-Party Connector | `intunepkcs`       | Communicates with Intune       |
| PKI Connector         | CA-specific        | Issues certificates            |
| Profile               | `intunepkcs`       | Intune PKCS enrollment profile |

### Jamf

| Object                | Type        | Purpose                     |
| --------------------- | ----------- | --------------------------- |
| Credential            | API token   | Jamf Pro API authentication |
| Third-Party Connector | `jamf`      | Communicates with Jamf Pro  |
| PKI Connector         | CA-specific | Issues certificates         |
| Profile               | `jamf`      | Jamf enrollment profile     |

---

## LDAP / Active Directory Integration

Use case: Enrich certificate requests with user attributes from corporate
directory. Also used for certificate publishing to AD.

### Data Enrichment (Datasource)

| Object           | Type             | Purpose                                 |
| ---------------- | ---------------- | --------------------------------------- |
| Credential       | Bind credentials | LDAP bind DN and password               |
| Proxy (optional) | HTTP proxy       | If LDAP is reached through a proxy      |
| Datasource       | `ldap`           | Query user attributes during enrollment |

### Datasource Configuration

```json
{
  "name": "corp-ldap",
  "type": "ldap",
  "configuration": {
    "url": "ldaps://ldap.corp.example.com:636",
    "baseDn": "DC=corp,DC=example,DC=com",
    "credentials": "ldap-bind-creds",
    "searchFilter": "(sAMAccountName={{username}})",
    "attributes": ["department", "mail", "memberOf", "displayName"]
  }
}
```

### Profile Integration

1. Add the datasource to the profile's `dsFlow`:

   ```json
   {
     "dsFlow": [
       {
         "ds": "corp-ldap",
         "inputs": [{ "key": "username", "value": "{{ principal.name }}" }],
         "stopOnSuccess": true
       }
     ]
   }
   ```

2. Add computation rules to map LDAP attributes to certificate fields:
   ```json
   {
     "computationRules": [
       {
         "source": "{{ ds.1.1.department }}",
         "target": "subject.organizationalUnit"
       },
       { "source": "{{ ds.1.1.mail }}", "target": "subject.email" },
       { "source": "{{ ds.1.1.displayName }}", "target": "subject.commonName" }
     ]
   }
   ```

### Certificate Publishing to AD

| Object                | Type             | Purpose                            |
| --------------------- | ---------------- | ---------------------------------- |
| Credential            | Bind credentials | AD write access                    |
| Third-Party Connector | `msad`           | Publishes certs to AD user objects |
| Trigger               | `thirdparty`     | Fires on enrollment to publish     |

---

## OIDC / OpenID Connect Integration

Use case: Single sign-on via external identity providers (Entra ID, Keycloak,
Okta, etc.) for Horizon web UI and API access.

### Components

| Object            | Type     | Purpose                |
| ----------------- | -------- | ---------------------- |
| Identity Provider | `openid` | OIDC IDP configuration |

### IDP Configuration

```json
{
  "name": "corporate-oidc",
  "type": "openid",
  "configuration": {
    "providerMetadataUrl": "https://login.microsoftonline.com/{tenant}/.well-known/openid-configuration",
    "clientCredentials": {
      "clientId": "...",
      "clientSecret": "..."
    },
    "scope": "openid profile email",
    "identifierClaim": "preferred_username",
    "emailClaim": "email",
    "nameClaim": "name",
    "trustSystemCAs": true
  }
}
```

### Profile IDP Enforcement

Restrict enrollment to OIDC-authenticated users:

```json
{
  "authorizationLevels": {
    "enroll": "authenticated",
    "enrollIdp": ["corporate-oidc"]
  }
}
```

### Claim Mapping

OIDC token claims can be mapped to Horizon principal attributes:

| OIDC Claim           | Horizon Attribute    |
| -------------------- | -------------------- |
| `preferred_username` | `principal.name`     |
| `email`              | `principal.email`    |
| `groups`             | Team membership      |
| Custom claims        | Configurable mapping |

---

## Cloud Key Vault Integrations

Use case: Publish issued certificates to cloud key vaults for application
consumption.

### Azure Key Vault

| Object                | Type              | Purpose                      |
| --------------------- | ----------------- | ---------------------------- |
| Credential            | Service principal | Azure AD app registration    |
| Third-Party Connector | `akv`             | Publishes to Azure Key Vault |
| Trigger               | `thirdparty`      | Fires on enrollment/renewal  |

### AWS Secrets Manager / ACM

| Object                | Type            | Purpose                     |
| --------------------- | --------------- | --------------------------- |
| Credential            | IAM credentials | AWS access key / role       |
| Third-Party Connector | `aws`           | Publishes to AWS            |
| Trigger               | `thirdparty`    | Fires on enrollment/renewal |

### Google Cloud Certificate Manager

| Object                | Type            | Purpose                              |
| --------------------- | --------------- | ------------------------------------ |
| Credential            | Service account | GCP service account JSON key         |
| Third-Party Connector | `gcm`           | Publishes to GCP Certificate Manager |
| Trigger               | `thirdparty`    | Fires on enrollment/renewal          |

---

## Load Balancer Integrations (F5)

Use case: Automatically deploy issued certificates to F5 BIG-IP load
balancers.

### F5 AS3 (Declarative)

| Object                | Type           | Purpose                      |
| --------------------- | -------------- | ---------------------------- |
| Credential            | F5 admin creds | F5 management API access     |
| Third-Party Connector | `f5as3`        | Deploys via AS3 declarations |
| Trigger               | `thirdparty`   | Fires on enrollment/renewal  |

### F5 iControl (REST)

| Object                | Type           | Purpose                       |
| --------------------- | -------------- | ----------------------------- |
| Credential            | F5 admin creds | F5 management API access      |
| Third-Party Connector | `f5client`     | Deploys via iControl REST API |
| Trigger               | `thirdparty`   | Fires on enrollment/renewal   |

---

## LDAP Certificate Publishing

Use case: Publish issued certificates to an LDAP directory so that they
can be discovered by email clients for S/MIME or by other LDAP consumers.

| Object                | Type            | Purpose                            |
| --------------------- | --------------- | ---------------------------------- |
| Credential            | LDAP bind creds | Write access to the directory      |
| Third-Party Connector | `ldappub`       | Publishes cert to LDAP user object |
| Trigger               | `thirdparty`    | Fires on enrollment/renewal        |

---

## End-to-End Example: Internal TLS with ADCS + LDAP + Notifications

Complete setup for automated internal TLS certificate issuance:

1. **Credential** "adcs-creds" -- service account for ADCS
2. **Credential** "ldap-creds" -- LDAP bind credentials
3. **PKI Connector** "adcs-prod" (type: `msadcs` or `evtadcs`) -- references "adcs-creds"
4. **Datasource** "corp-ldap" (type: `ldap`) -- references "ldap-creds"
5. **Profile** "TLS-Internal" (module: `webra`):
   - `pkiConnector: "adcs-prod"`
   - `dsFlow` with "corp-ldap" to enrich requests
   - `computationRules` to map LDAP attributes to subject fields
   - `authorizationMode: "auto-validation"` with validation ruleset
   - `selfPermissions.selfPopRenew: true` for automated renewal
6. **Trigger** "notify-expiry-30d" (type: `email`) -- attach to profile
7. **Trigger** "webhook-enroll" (type: `webhook`) -- notify ITSM on enrollment

---

## End-to-End Workflow Examples

The following examples show the complete MCP tool sequence for common
multi-step operations. Each example lists the tools to call in order,
with realistic parameter shapes. Use these as blueprints when assembling
integration workflows.

### Create a REST Notification Trigger

Notify an external system via webhook whenever a certificate is enrolled.
Look up supporting objects first, then create and attach the trigger.

```
Step 1: list_credentials → find credential for auth
Step 2: create_rest_notification(
  name="notify-on-enroll",
  event="on_enroll",
  sequence=[
    {
      "url": "https://api.example.com/webhook",
      "authenticationType": "bearer",
      "credentials": "my-bearer-cred",
      "method": "POST",
      "headers": [{"name": "Content-Type", "value": "application/json"}],
      "payloadType": "json",
      "payload": "{\"cn\": \"{{certificate.subject.cn.1}}\", \"serial\": \"{{certificate.serial}}\"}",
      "expectedHttpCodes": [200, 201],
      "timeout": "30 seconds"
    }
  ]
)
Step 3: Attach the trigger to a profile via the Horizon admin UI
        or by updating the profile's triggerHooks via the API.
```

### Create an Email Notification Trigger with Attachments

Send a formatted email with the issued certificate attached in PEM and
PKCS#7 formats. No prerequisite lookups are needed.

Email triggers are created via the Horizon admin UI or the trigger API
(`POST /api/v1/triggers`):

```json
{
  "name": "enroll-email",
  "type": "email",
  "events": ["on_enroll"],
  "emailTemplate": {
    "to": [{ "type": "static", "email": "admin@example.com" }],
    "from": "horizon@example.com",
    "title": "Certificate issued: {{certificate.subject.cn.1}}",
    "body": "<p>Certificate <b>{{certificate.subject.cn.1}}</b> has been issued.</p>",
    "isHtml": true
  },
  "attachPemCertificate": true,
  "attachPkcs7Bundle": true
}
```

### Create a Profile with Datasource Flow and Computation Rules

Set up a WebRA profile that auto-populates certificate fields from an LDAP
datasource. The datasource must exist before the profile references it.

```
Step 1: create_datasource(name="ldap-lookup", ...)
Step 2: create_webra_profile(
  name="AutoDN-Profile",
  pki_connector="my-pki",
  certificate_template={
    "subject": [
      {"type": "CN", "computationRule": "{{ ds.1.1.cn }}", "mandatory": true, "editableByRequester": false},
      {"type": "O", "value": "My Org", "mandatory": true, "editableByRequester": false},
      {"type": "OU", "computationRule": "{{ ds.1.1.department }}", "mandatory": false}
    ],
    "sans": [
      {"type": "RFC822", "computationRule": "{{ ds.1.1.email }}", "editableByRequester": false}
    ]
  },
  authorization_levels={
    "search": {"accessLevel": "authenticated"},
    "update": {"accessLevel": "authorized"},
    "requestUpdate": {"accessLevel": "authenticated"},
    "approveUpdate": {"accessLevel": "authorized"},
    "enroll": {"accessLevel": "authenticated"},
    "approveEnroll": {"accessLevel": "authorized"}
  },
  ds_flow=[
    {"ds": "ldap-lookup", "inputs": [{"key": "uid", "value": "${holderid}"}], "stopOnSuccess": true}
  ]
)
```

### Set Up ACME with DNS-01 and Expiry Notification

Create an ACME profile for automated certificate issuance, then add a
trigger that warns certificate contacts 30 days before expiry.

```
Step 1: list_pki_connectors → select the target CA connector
Step 2: create_acme_profile(
  name="acme-dns01",
  pki_connector="my-pki",
  certificate_template={
    "subject": [
      {"type": "CN", "mandatory": true, "editableByRequester": true}
    ],
    "sans": [
      {"type": "DNSNAME", "editableByRequester": true, "min": 1, "max": 10}
    ]
  },
  authorization_levels={
    "search": {"accessLevel": "authenticated"},
    "update": {"accessLevel": "authorized"},
    "requestUpdate": {"accessLevel": "authenticated"},
    "approveUpdate": {"accessLevel": "authorized"},
    "enroll": {"accessLevel": "authenticated"}
  },
  acme_challenge_type="dns-01"
)
Step 3: Create an email notification via the trigger API or Horizon admin UI:
        POST /api/v1/triggers with type="email", events=["on_expire"],
        runPeriod="1 day", runOnRenewed=false
Step 4: Attach the trigger to the profile via the Horizon admin UI
        or by updating the profile's triggerHooks via the API.
```

### Create a Dashboard for Certificate Monitoring

Build a certificate monitoring dashboard with three charts: a donut for
profile distribution, a horizontal bar for upcoming expirations, and a
treemap for grade distribution.

```
Step 1: create_dashboard(
  name="cert-overview",
  dashboard_type="certificate",
  description="Certificate monitoring dashboard"
)
Step 2: add_dashboard_chart(
  dashboard_name="cert-overview",
  chart={
    "title": "Certificates by Profile",
    "type": "donut",
    "fields": ["profile"],
    "localQuery": "status is valid",
    "colors": ["#4A90D9", "#50C878", "#FF6B6B", "#FFD700"],
    "w": 6, "h": 4, "x": 0, "y": 0
  }
)
Step 3: add_dashboard_chart(
  dashboard_name="cert-overview",
  chart={
    "title": "Expiring in 30 Days",
    "type": "bar-horizontal",
    "fields": ["profile"],
    "localQuery": "status is valid and valid.until before 30d",
    "sortOrder": "Desc",
    "w": 6, "h": 4, "x": 6, "y": 0
  }
)
Step 4: add_dashboard_chart(
  dashboard_name="cert-overview",
  chart={
    "title": "Grade Distribution",
    "type": "treemap",
    "fields": ["grade.default"],
    "localQuery": "status is valid",
    "w": 12, "h": 4, "x": 0, "y": 4
  }
)
```

### Set Up Automation Policy with Business Hours

Restrict automated certificate renewal to business hours using an
execution policy, then bind it to an automation policy for a specific
profile.

```
Step 1: create_execution_policy(
  name="business-hours",
  description="Allow automation only during business hours",
  authorized_periods=[{
    "weekDays": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    "timeRange": {"start": "08:00:00", "end": "18:00:00"}
  }]
)
Step 2: create_automation_policy(
  name="auto-renew-est",
  profile="my-est-profile",
  execution_policy="business-hours",
  trust_chains=["root-ca", "intermediate-ca"]
)
```

---

## Key Considerations

1. **Credential management**: Credentials are created via the Horizon UI or
   API and are never exposed through the MCP server. Plan credential creation
   as the first step in any integration setup.

2. **Connectivity testing**: After creating connectors and datasources, use
   the test endpoints (`simulate_datasource`, `simulate_trigger`) to verify
   connectivity before attaching to profiles.

3. **Proxy routing**: If Horizon is in a DMZ or restricted network, create
   HTTP proxy objects for connectors that need to reach external services.

4. **Idempotency**: The MCP server's trigger attach/detach operations are
   idempotent. Re-attaching an already-attached trigger is a no-op.

5. **High availability**: For critical integrations (LDAP datasources),
   configure fallback entries using datasource flow chaining with
   `stopOnSuccess: true` on the primary source.
