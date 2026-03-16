# Dictionary Entries Matrix -- Entries by Protocol and Event Context

## Overview

Dictionary entries are the named values available inside computation rules,
templates, datasource input mappings, and notification templates. Not all
entries are available in every context -- availability depends on the protocol
module and the lifecycle event.

---

## Entry Categories

### CSR Entries (`csr.*`)

Available when a Certificate Signing Request is part of the operation
(enrollment, renewal with new CSR).

| Entry                    | Enrollment | Renewal | Revocation | Recovery | Import |
|--------------------------|:----------:|:-------:|:----------:|:--------:|:------:|
| `csr.subject.cn`         | Yes        | Yes     | --         | --       | --     |
| `csr.subject.o`          | Yes        | Yes     | --         | --       | --     |
| `csr.subject.ou`         | Yes        | Yes     | --         | --       | --     |
| `csr.subject.c`          | Yes        | Yes     | --         | --       | --     |
| `csr.subject.st`         | Yes        | Yes     | --         | --       | --     |
| `csr.subject.l`          | Yes        | Yes     | --         | --       | --     |
| `csr.subject.email`      | Yes        | Yes     | --         | --       | --     |
| `csr.sans.dnsnames`      | Yes        | Yes     | --         | --       | --     |
| `csr.sans.rfc822names`   | Yes        | Yes     | --         | --       | --     |
| `csr.sans.ipaddresses`   | Yes        | Yes     | --         | --       | --     |
| `csr.sans.uris`          | Yes        | Yes     | --         | --       | --     |
| `csr.keyType`            | Yes        | Yes     | --         | --       | --     |
| `csr.keySize`            | Yes        | Yes     | --         | --       | --     |
| `csr.signatureAlgorithm` | Yes        | Yes     | --         | --       | --     |

### Principal Entries (`principal.*`)

Available whenever there is an authenticated user performing the action.

| Entry                    | Enrollment | Renewal | Revocation | Recovery | Import |
|--------------------------|:----------:|:-------:|:----------:|:--------:|:------:|
| `principal.name`         | Yes        | Yes     | Yes        | Yes      | Yes    |
| `principal.email`        | Yes        | Yes     | Yes        | Yes      | Yes    |
| `principal.roles`        | Yes        | Yes     | Yes        | Yes      | Yes    |
| `principal.teams`        | Yes        | Yes     | Yes        | Yes      | Yes    |
| `principal.idp`          | Yes        | Yes     | Yes        | Yes      | Yes    |

### Certificate Entries (`certificate.*`)

Available when an existing certificate is part of the context (renewal,
revocation, update, recovery -- but NOT initial enrollment).

| Entry                        | Enrollment | Renewal | Revocation | Recovery | Update |
|------------------------------|:----------:|:-------:|:----------:|:--------:|:------:|
| `certificate.subject.cn`     | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.subject.o`      | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.subject.ou`     | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.serial`         | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.thumbprint`     | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.thumbprint256`  | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.notBefore`      | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.notAfter`       | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.issuer.cn`      | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.issuer.o`       | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.profile`        | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.module`         | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.owner`          | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.holder`         | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.keyType`        | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.keySize`        | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.sans.dnsnames`  | --         | Yes     | Yes        | Yes      | Yes    |
| `certificate.sans.ipaddresses` | --       | Yes     | Yes        | Yes      | Yes    |
| `certificate.contactEmail`   | --         | Yes     | Yes        | Yes      | Yes    |

### Request Entries (`request.*`)

Available in notification and webhook templates after a request is created.

| Entry                    | Description                               |
|--------------------------|-------------------------------------------|
| `request.id`             | Unique request identifier                 |
| `request.date`           | Request creation date                     |
| `request.status`         | Current request status                    |
| `request.workflow`       | Workflow type (enroll, revoke, etc.)       |
| `request.requester`      | Principal who submitted the request       |
| `request.approver`       | Principal who approved/denied the request |
| `request.comment`        | Optional request comment                  |
| `request.profile`        | Profile name                              |

### HTTP Entries (`http.*`)

Available for WebRA, ACME, SCEP, and EST enrollments -- extracted from the
incoming HTTP request.

| Entry                    | Description                                    |
|--------------------------|------------------------------------------------|
| `http.header.<name>`     | Any HTTP header value (e.g., `http.header.x-custom`) |
| `http.param.<name>`      | URL query parameters                          |
| `http.remoteAddr`        | Client IP address                              |
| `http.method`            | HTTP method (GET, POST)                        |
| `http.path`              | Request URL path                               |

### Protocol-Specific Entries

#### ACME (`acme.*`)

| Entry                      | Description                              |
|----------------------------|------------------------------------------|
| `acme.account.contact`     | ACME account contact email list          |
| `acme.account.id`          | ACME account identifier                  |
| `acme.identifiers`         | Requested identifiers (domains/IPs)      |
| `acme.eab.keyId`           | External Account Binding key ID          |
| `acme.order.id`            | ACME order identifier                    |

#### SCEP (`scep.*`)

| Entry                      | Description                              |
|----------------------------|------------------------------------------|
| `scep.challenge`           | Challenge password from SCEP request     |
| `scep.transactionId`       | SCEP transaction ID                      |
| `scep.senderNonce`         | SCEP sender nonce                        |
| `scep.messageType`         | SCEP message type                        |

#### EST (`est.*`)

| Entry                      | Description                              |
|----------------------------|------------------------------------------|
| `est.tlsClientCert`        | Full TLS client certificate (PEM)        |
| `est.tlsClientCert.cn`     | CN from TLS client certificate           |
| `est.tlsClientCert.serial` | Serial from TLS client certificate       |
| `est.tlsClientCert.issuer` | Issuer from TLS client certificate       |

### Datasource Result Entries (`datasource.*`)

Populated by datasource flow execution. The exact entries depend on the
datasource type and configuration.

| Entry Pattern                   | Description                                 |
|---------------------------------|---------------------------------------------|
| `datasource.{name}.{attribute}` | Single attribute from datasource response  |
| `datasource.{name}.{list}`      | Multi-valued attribute as a list           |

Example: An LDAP datasource named "corp-ldap" querying a user's department:
```
datasource.corp-ldap.department  ->  "Engineering"
datasource.corp-ldap.memberOf    ->  ["CN=DevOps,...", "CN=Platform,..."]
```

---

## Availability Matrix by Module

| Entry Category    | WebRA | ACME | SCEP | EST | Monitored | Import |
|-------------------|:-----:|:----:|:----:|:---:|:---------:|:------:|
| `csr.*`           | Yes   | Yes  | Yes  | Yes | --        | --     |
| `principal.*`     | Yes   | --   | --   | --  | --        | Yes    |
| `certificate.*`   | Renew | --   | --   | Re  | Yes       | Yes    |
| `http.*`          | Yes   | Yes  | Yes  | Yes | --        | --     |
| `acme.*`          | --    | Yes  | --   | --  | --        | --     |
| `scep.*`          | --    | --   | Yes  | --  | --        | --     |
| `est.*`           | --    | --   | --   | Yes | --        | --     |
| `datasource.*`    | Yes   | Yes  | Yes  | Yes | --        | --     |
| `request.*`       | After | After| After| After| --       | After  |

**Legend**: "Re" = re-enrollment only; "After" = available in notifications
after request creation, not during computation rules.

---

## Usage in Templates

### Computation Rules

```json
{
  "source": "{{ Upper(csr.subject.cn) }}",
  "target": "subject.commonName"
}
```

### Email Notification Templates

```
Subject: Certificate {{ certificate.serial }} expiring soon
Body: The certificate for {{ certificate.subject.cn }} expires on {{ certificate.notAfter }}.
```

### Webhook Payloads

```json
{
  "url": "https://hooks.example.com/horizon",
  "body": "{\"cn\": \"{{ EscapeJson(certificate.subject.cn) }}\", \"serial\": \"{{ certificate.serial }}\"}"
}
```

---

## Key Considerations

1. **Evaluation timing**: Entries are resolved at the moment of evaluation,
   not at request submission time. For queued requests, values may have
   changed between submission and approval.

2. **Null handling**: If an entry is not available in the current context,
   it resolves to null. Use `OrElse()` to provide fallback values.

3. **Multi-value vs single-value**: SAN lists (`csr.sans.dnsnames`) are
   multi-valued -- use `[[ ]]` template syntax and list functions (`Join`,
   `Filter`, `Sort`, `Unique`).

4. **HTTP entries are protocol-dependent**: `http.*` entries are only
   available for HTTP-based protocols (WebRA, ACME, SCEP, EST). They are
   not available for imported or discovered certificates.

5. **Case sensitivity**: Entry names are case-sensitive. `csr.subject.cn`
   is correct; `csr.Subject.CN` will not resolve.
