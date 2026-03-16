# Horizon Query Languages -- HCQL, HRQL, HEQL, HDQL, HPQL

## Overview

Horizon provides five domain-specific query languages for searching different
object types. All share the same operator syntax but have different field
sets tailored to their domain.

| Language | Full Name                       | Searches           | API Endpoint                        |
|----------|---------------------------------|--------------------|-------------------------------------|
| **HCQL** | Horizon Certificate Query Lang  | Certificates       | `/api/v1/certificates/search`       |
| **HRQL** | Horizon Request Query Language  | Requests           | `/api/v1/requests/search`           |
| **HEQL** | Horizon Event Query Language    | Audit events       | `/api/v1/events/search`             |
| **HDQL** | Horizon Discovery Query Lang    | Discovery results  | `/api/v1/discovery/events/search`   |
| **HPQL** | Horizon Principal Query Lang    | Principals (users) | *Reference only -- no search API*   |

---

## Operator Reference

All five languages share these operators:

### Comparison Operators

| Operator              | Syntax                  | Description                              |
|-----------------------|-------------------------|------------------------------------------|
| `equals`              | `field equals "value"`  | Exact match (case-sensitive)             |
| `matches`             | `field matches "regex"` | Regular expression match                 |
| `contains`            | `field contains "sub"`  | Substring match (case-insensitive)       |
| `in`                  | `field in ("a", "b")`   | Value is one of the listed values        |
| `within`              | `field within ["r1", "r2"]` | Match against multiple regex patterns (multi-regex OR) |

**Symbolic aliases**: `=` for `equals`.

### Date Operators

| Operator              | Syntax                          | Description                        |
|-----------------------|---------------------------------|------------------------------------|
| `before`              | `field before "2025-01-01"`     | Date is before the given date      |
| `after`               | `field after "2025-01-01"`      | Date is after the given date       |

**Symbolic aliases**: `<` for `before`, `>` for `after`.

**IMPORTANT**: `within` is NOT a date operator. It is a string multi-regex matcher (see Comparison Operators).

### Grade Operators

These operators work on **grade fields** (`grade`, `grade.*`) with grade values (A, B, C, D, E).
They do NOT work on numeric values.

| Operator                | Syntax                              | Description                        |
|-------------------------|-------------------------------------|------------------------------------|
| `lower than`            | `grade lower than B`                | Grade is at or below (<=)          |
| `greater than`          | `grade greater than C`              | Grade is at or above (>=)          |
| `strictly lower than`   | `grade strictly lower than B`       | Grade is strictly below (<)        |
| `strictly greater than` | `grade strictly greater than C`     | Grade is strictly above (>)        |

**Symbolic aliases**: `<=` for `lower than`, `>=` for `greater than`, `<` for `strictly lower than`, `>` for `strictly greater than`.

### Existence Operator

| Operator  | Syntax            | Description                        |
|-----------|-------------------|------------------------------------|
| `exists`  | `field exists`    | Field has a non-null value         |

---

## Special Conditions (HCQL Only)

These conditions use a different syntax from standard field operators.

### Certificate Status

```
status is valid
status is not revoked
```

Valid statuses: `valid`, `revoked`, `expired`.

### Certificate Type

```
certificatetype is legacy
certificatetype is not pqc
```

Valid types: `hybrid`, `legacy`, `pqc`, `unknown`.

### Certificate Properties

```
certificate is selfsigned
certificate is not selfsigned
certificate is archived
certificate is escrowed
certificate is trusted
certificate is discovered
```

Valid values: `archived`, `escrowed`, `trusted`, `selfsigned`, `discovered`.

**IMPORTANT**: There is NO `certificate is expired`. To check for expired certificates,
use `status is expired` instead.

### Trigger Results

```
trigger.results has success
trigger.results has no failure
trigger.results has warning
```

Valid values: `success`, `failure`, `warning`.

**IMPORTANT**: The values are `success`, `failure`, `warning` (singular).
There is no `errors` or `warnings` (plural) value.

---

## Date Formats

Query languages accept multiple date formats:

| Format                | Example                   | Description                   |
|-----------------------|---------------------------|-------------------------------|
| `YYYY`                | `"2025"`                  | Year only                     |
| `YYYY-MM`             | `"2025-06"`               | Year and month                |
| `YYYY-MM-DD`          | `"2025-06-15"`            | Absolute date                 |
| `YYYY-MM-DDTHH`       | `"2025-06-15T14"`         | Date with hour                |
| `YYYY-MM-DDTHH:mm`    | `"2025-06-15T14:30"`      | Date with hour and minutes    |
| `YYYY-MM-DDTHH:mm:ss` | `"2025-06-15T14:30:00"`   | Full ISO datetime             |
| `now`                 | `now`                     | Current timestamp             |
| `today`               | `today`                   | Current date at midnight      |
| Relative              | `30d`                     | 30 days                       |
| Relative              | `24h`                     | 24 hours                      |
| Relative              | `5m`                      | 5 minutes                     |
| Relative              | `60s`                     | 60 seconds                    |
| Relative (negative)   | `-30d`                    | 30 days in the past           |

Supported relative duration units: `d`/`day`/`days`, `h`/`hour`/`hours`,
`m`/`minute`/`minutes`, `s`/`second`/`seconds`.

**IMPORTANT**: Weeks (`w`) and months (`M`) are NOT supported. Use `7d` instead of `1w`.

Relative durations are unquoted. The `-` prefix is supported and means "in the past"
(e.g., `-30d` = 30 days ago). The operator (`before`/`after`) and the sign together
determine the direction.

---

## Combinators

| Combinator       | Syntax              | Description                              |
|------------------|---------------------|------------------------------------------|
| `and` / `&&`     | `expr1 and expr2`   | Both conditions must match               |
| `or` / `||`      | `expr1 or expr2`    | At least one condition must match        |
| `not` / `!`      | `not expr`          | Negates the condition                    |
| Parentheses      | `(expr1 or expr2) and expr3` | Grouping for precedence         |

**Symbolic aliases**: `&` for `and`, `|` for `or`.

**Precedence**: `not` > `and` > `or`. Use parentheses to override.

---

## Symbolic Operator Aliases

For brevity, HQL languages accept symbolic alternatives:

| Symbol | Equivalent                  | Context       |
|--------|-----------------------------|---------------|
| `=`    | `equals`                    | Any field     |
| `<`    | `before` / `strictly lower than` | Date / Grade |
| `>`    | `after` / `strictly greater than` | Date / Grade |
| `<=`   | `lower than`                | Grade         |
| `>=`   | `greater than`              | Grade         |
| `&&`   | `and`                       | Combinator    |
| `&`    | `and`                       | Combinator    |
| `||`   | `or`                        | Combinator    |
| `|`    | `or`                        | Combinator    |
| `!`    | `not`                       | Combinator    |

---

## HCQL Fields (Certificate Query)

**CRITICAL — HCQL query field names are ALL LOWERCASE, never camelCase:**
- **HCQL query fields are lowercase**: `contactemail`, `keytype`, `signingalgorithm`, `valid.until`, `valid.from`
- **API `fields`, `sortedBy`, and response fields are camelCase**: `contactEmail`, `keyType`, `signingAlgorithm`, `notAfter`, `notBefore`
- **Using camelCase in HCQL queries causes HQL-001 errors**

Common HCQL mistakes (WRONG → CORRECT):
- `contactEmail` → `contactemail`
- `keyType` → `keytype`
- `signingAlgorithm` → `signingalgorithm`
- `publicKeyThumbprint` → `publickeythumbprint`
- `holderId` → `holderid`
- `primaryKeyType` → `primarykeytype`
- `certificateType` → `certificatetype`

| Field                    | Type   | Description                                  |
|--------------------------|--------|----------------------------------------------|
| `dn`                     | string | Full distinguished name                      |
| `profile`                | string | Profile name                                 |
| `module`                 | string | Module type (webra, acme, scep, est, monitored) |
| `san`                    | string | Subject Alternative Name (any type, no sub-fields) |
| `issuer`                 | string | Issuer distinguished name                    |
| `serial`                 | string | Certificate serial number                    |
| `thumbprint`             | string | Certificate thumbprint                       |
| `publickeythumbprint`    | string | Public key thumbprint                        |
| `keytype`                | string | Key algorithm (RSA, EC, etc.)                |
| `primarykeytype`         | string | Primary key type (hybrid certs)              |
| `alternatekeytype`       | string | Alternate key type (hybrid certs)            |
| `signingalgorithm`       | string | Signature algorithm                          |
| `owner`                  | string | Owning team name                             |
| `team`                   | string | Team name                                    |
| `holderid`               | string | Certificate holder identifier (principal)    |
| `contactemail`           | string | Contact email address                        |
| `valid.from`             | date   | Validity start date                          |
| `valid.until`            | date   | Validity end date                            |
| `revocation.date`        | date   | When the certificate was revoked             |
| `revocation.reason`      | string | Revocation reason                            |
| `purge.date`             | date   | Scheduled purge date                         |
| `id`                     | id     | Certificate internal ID                      |
| `grade`                  | grade  | Security grade (supports lower/greater than) |
| `grade.*`                | grade  | Grade for specific grading policy            |
| `label.*`                | string | Label value (dynamic field name)             |
| `metadata.<key>`         | string | Certificate metadata (restricted keys — see below) |
| `discoverydata.ip`       | string | Host IP where certificate was discovered     |
| `discoverydata.sources`  | string | Discovery type (`localscan`, `netscan`, etc.)|
| `discoverydata.hostnames`| string | Host hostnames (netscan)                     |
| `discoverydata.operatingsystems` | string | Host OS (localscan)                 |
| `discoverydata.paths`    | string | Certificate file path on host (localscan). E.g. `/opt/tomcat/conf/keystore.jks` |
| `discoverydata.usages`   | string | Config file paths used to find the cert (localscan). E.g. `tomcat-*:8443`, `/opt/tomcat/conf` |
| `discoverydata.tls.version` | string | TLS version (netscan)                     |
| `discoverydata.tls.port` | number | HTTPS port where cert is exposed (netscan)   |
| `discoveryinfo.campaign` | string | Discovery campaign name                      |
| `thirdparty.connector`   | string | Third-party connector name                   |
| `thirdparty.id`          | string | Third-party external ID                      |
| `thirdparty.fingerprint` | string | Third-party fingerprint                      |
| `trigger.results`        | special| See trigger.results syntax above             |

### Allowed `metadata.<key>` Values

The `metadata.*` field does NOT accept arbitrary key names. Only the following
keys are recognized by the HCQL parser:

`pki_connector`, `scep_transid`, `certeurope_id`, `digicert_id`,
`digicert_order_id`, `entrust_id`, `fcms_id`, `gsatlas_id`, `gs_order_id`,
`metapki_id`, `eviden_idca_id`, `nameshield_id`, `renewed_certificate_id`,
`previous_certificate_id`, `automation_policy`, `contact_email`

Common usage:
- `metadata.renewed_certificate_id not exists` — certs NOT yet renewed
- `metadata.previous_certificate_id exists` — certs enrolled as renewals

**IMPORTANT**: `san` is a simple string field with no sub-fields.
Use `san matches "^\*\."` to find wildcard certificates — NOT `san.dnsname`.

---

## HRQL Fields (Request Query)

**HRQL query field names are lowercase with dotted notation for dates.**

| Field                    | Type   | Description                                  |
|--------------------------|--------|----------------------------------------------|
| `id`                     | id     | Unique request identifier                    |
| `module`                 | string | Module type                                  |
| `workflow`               | string | Workflow type (enroll, renew, revoke, etc.)   |
| `profile`                | string | Profile name                                 |
| `status`                 | string | Request status                               |
| `requester`              | string | Who submitted the request                    |
| `approver`               | string | Who approved/denied the request              |
| `team`                   | string | Team name                                    |
| `owner`                  | string | Owner name                                   |
| `contact`                | string | Contact information                          |
| `dn`                     | string | Requested or associated distinguished name   |
| `holderid`               | string | Request holder identifier                    |
| `comment.requester`      | string | Requester comment                            |
| `comment.approver`       | string | Approver comment                             |
| `registration.date`      | date   | When the request was created                 |
| `modification.date`      | date   | When the request was last modified           |
| `expiration.date`        | date   | When the request expires                     |
| `label.*`                | string | Label value (dynamic field name)             |

**Special condition:** `request is [not] valid|expired`

---

## HEQL Fields (Event Query)

**HEQL field names are lowercase. Use `detail.<key>` for dynamic event detail fields.**

| Field                    | Type   | Description                                  |
|--------------------------|--------|----------------------------------------------|
| `id`                     | id     | Unique event identifier                      |
| `code`                   | string | Event code/type                              |
| `node`                   | string | Horizon node that generated the event        |
| `module`                 | string | Module type                                  |
| `status`                 | string | Event status                                 |
| `timestamp`              | date   | Event timestamp                              |
| `purge.date`             | date   | Scheduled purge date                         |
| `detail.*`               | string | Dynamic event detail field (see catalog below) |

### `detail.*` Key Catalog

**Certificate:** `certificateId`, `certificateDn`, `certificateSerial`,
`certificateProfile`, `certificateOwner`, `certificateTeam`, `certificateIssuer`,
`certificateSubjectDn`, `certificateNotBefore`, `certificateNotAfter`

**Request:** `requestId`, `requestWorkflow`, `requestStatus`, `requester`,
`approver`, `requesterComment`, `approverComment`

**Actor/auth:** `actorId`, `actorType`, `ip`, `httpVerb`, `httpPath`

**Trigger:** `triggerName`, `triggerType`, `triggerStatus`

**PKI/CA:** `ca`, `pkiConnector`, `thirdPartyConnector`, `revocationReason`

**ACME:** `acmeAccountId`, `acmeOrderId`, `acmeAuthorizationId`,
`acmeChallengeType`, `acmeFinalize`

**EST:** `estAuthorizationMode`, `estProfile`

**SCEP:** `scepRA`, `scepTransactionId`, `scepMessageType`

**WCCE:** `wcceForest`, `wcceMSTemplate`, `wcceCA`

**CRL:** `crlIssuer`, `crlNextUpdate`, `crlSize`

**Config/admin:** `message`, `profileName`, `connectorName`, `roleName`,
`teamName`, `idpName`, `labelName`, `datasourceName`,
`scheduledTaskName`, `scheduledTaskType`

**Discovery:** `campaign`, `hostname`, `port`, `source`

This is a representative catalog. Horizon may define additional `detail.*` keys
for specific event types.

---

## HDQL Fields (Discovery Query)

**HDQL field names are lowercase with dotted notation.**

| Field                    | Type    | Description                                 |
|--------------------------|---------|---------------------------------------------|
| `id`                     | id      | Unique discovery event identifier           |
| `code`                   | string  | Discovery event code                        |
| `status`                 | string  | Discovery event status                      |
| `campaign`               | string  | Discovery campaign name                     |
| `hostname`               | string  | Discovered hostname                         |
| `ip`                     | string  | Discovered IP address                       |
| `port`                   | number  | Discovered port                             |
| `source`                 | string  | Discovery source                            |
| `actorid`                | string  | Actor who triggered the scan                |
| `certificateid`          | id      | Associated certificate ID                   |
| `sessionid`              | id      | Discovery session ID                        |
| `error.code`             | string  | Error code (if scan failed)                 |
| `error.message`          | string  | Error message (if scan failed)              |
| `client.version`         | string  | Discovery client version                    |
| `client.ip`              | string  | Discovery client IP                         |
| `client.id`              | string  | Discovery client identifier                 |
| `timestamp`              | date    | When the scan occurred                      |

---

## HPQL Fields (Principal Query -- Reference Only)

**Note**: HPQL is used in the Horizon UI for filtering principals. There is
no corresponding search API endpoint -- it is listed here for reference only.

| Field                    | Type   | Description                          |
|--------------------------|--------|--------------------------------------|
| `identifier`             | string | Principal identifier (username)      |
| `name`                   | string | Display name                         |
| `email`                  | string | Email address                        |
| `role`                   | string | Assigned role name                   |
| `team`                   | string | Assigned team name                   |
| `idp`                    | string | Identity provider name               |
| `lastLogin`              | date   | Last login timestamp                 |

---

## Sortable Elements

The `sortedBy` parameter accepts an array of objects: `[{"element": "notAfter", "order": "Asc"}]`.
Order values: `Asc`, `Desc`.

**IMPORTANT**: sortable element names use API response field names (`notAfter`, `notBefore`),
NOT HCQL query field names (`valid.until`, `valid.from`).

### Certificate Search Sortable Elements

`_id`, `module`, `profile`, `owner`, `team`, `discoveredTrusted`, `thumbprint`,
`selfSigned`, `publicKeyThumbprint`, `dn`, `serial`, `issuer`, `notBefore`,
`notAfter`, `revocationDate`, `revocationReason`, `keyType`, `signingAlgorithm`,
`holderId`, `contactEmail`, `grades`, `escrowed`, `removeAt`

### Request Search Sortable Elements

`_id`, `module`, `workflow`, `status`, `profile`, `requester`, `approver`,
`team`, `owner`, `contact`, `requesterComment`, `approverComment`,
`certificateId`, `certificate`, `dn`, `registrationDate`,
`lastModificationDate`, `expirationDate`, `holderId`, `labels`, `metadata`,
`releaseAt`

### Event Search Sortable Elements

`_id`, `code`, `module`, `node`, `timestamp`, `removeAt`, `status`

---

## Aggregate Queries (HCQL and HRQL)

HCQL and HRQL support aggregate queries for dashboarding and reporting:

```json
{
  "query": "profile equals \"TLS-Internal\" and status is valid",
  "groupBy": ["keyType"],
  "having": {
    "operator": "gt",
    "value": 10
  },
  "sortOrder": "Desc"
}
```

**API endpoints:**
- HCQL: `POST /api/v1/certificates/aggregate`
- HRQL: `POST /api/v1/requests/aggregate`

### GroupBy

The `groupBy` field accepts a list of field names. Results are grouped by
the unique combinations of those fields and a count is returned per group.

Common groupBy fields: `profile`, `module`, `keyType`, `owner`, `team`,
`signatureAlgorithm`, `grade`.

### Having Operators

The `having` object filters groups by their count:

| Operator | Description              |
|----------|--------------------------|
| `gt`     | Count greater than       |
| `gte`    | Count greater or equal   |
| `lt`     | Count less than          |
| `lte`    | Count less or equal      |
| `eq`     | Count equals             |
| `ne`     | Count not equals         |

### Sort Order

| Value      | Description                            |
|------------|----------------------------------------|
| `Asc`      | Ascending by count                     |
| `Desc`     | Descending by count                    |
| `KeyAsc`   | Ascending by group key (alphabetical)  |
| `KeyDesc`  | Descending by group key                |

---

## Query Examples

### HCQL -- Find expiring certificates

```
profile equals "TLS-Internal" and valid.until before 30d and status is valid
```

### HCQL -- Certificates with a specific key type

```
keytype equals "rsa-2048" and status is valid
```

### HCQL -- Wildcard certificates in a profile

```
profile equals "ACME-Public" and san matches "^\*\."
```

### HCQL -- Self-signed certificates

```
certificate is selfsigned and status is valid
```

### HCQL -- Certificates by label

```
label.environment equals "production" and status is valid
```

### HCQL -- Discovered certificates on a specific subnet

```
discoverydata.ip matches "^10\.0\.1\." and certificate is discovered
```

### HCQL -- Expiring certificates that have NOT been renewed yet

```
status is valid and valid.until before 30d and metadata.renewed_certificate_id not exists
```

### HCQL -- Certificates enrolled as renewals (not direct enrollment)

```
status is valid and metadata.previous_certificate_id exists
```

### HCQL -- Match SAN against multiple patterns

```
san within [".*example\\.com", ".*test\\.org"]
```

### HRQL -- Pending enrollment requests older than 7 days

```
workflow equals "enroll" and status equals "pending" and registration.date before 7d
```

### HRQL -- All denied requests this month

```
status equals "denied" and modification.date after 30d
```

### HEQL -- Failed enrollments today

```
code equals "LIFECYCLE-ENROLL" and status equals "failure" and timestamp after today
```

### HEQL -- All revocation events by a specific user

```
code equals "LIFECYCLE-REVOKE" and detail.actorId equals "admin@example.com"
```

### HDQL -- Discovery events on port 443

```
port equals 443 and timestamp after 7d
```

### HDQL -- Discovery events in a specific campaign

```
campaign equals "weekly-scan" and timestamp after 7d
```

### HCQL -- Aggregate: certificates by key type

```json
{
  "query": "status is valid",
  "groupBy": ["keyType"],
  "sortOrder": "Desc"
}
```

### HCQL -- Aggregate: expiring certs by profile with threshold

```json
{
  "query": "valid.until before 30d and status is valid",
  "groupBy": ["profile"],
  "having": { "operator": "gt", "value": 5 },
  "sortOrder": "Desc"
}
```

---

## Ownership Patterns (HCQL)

Certificate ownership in Horizon has **two dimensions**:

1. **Direct ownership** — the `owner` field matches the principal's identifier
2. **Indirect ownership via teams** — the `team` field matches any team the
   principal is a member of

When a user asks for "my certificates", "certificates I own", or similar,
**always** search both dimensions. Searching only `owner` misses certificates
owned by the user's teams.

### Workflow

1. Call **whoami** to get the current principal's identifier and team list
2. Extract the identifier (e.g. `sbo@evertrust.fr`) and team names (e.g.
   `["DevOps", "Network", "Active_Directory"]`)
3. Build the combined HCQL query:

```
owner equals "sbo@evertrust.fr" or team in ("DevOps", "Network", "Active_Directory")
```

### With additional filters

Ownership queries combine naturally with other conditions:

```
(owner equals "sbo@evertrust.fr" or team in ("DevOps", "Network", "Active_Directory"))
  and status is valid
  and valid.until before 30d
```

This finds all certificates the user owns (directly or via teams) that are
valid and expiring within 30 days.

### holderid vs owner

- `owner` — the team or principal that **administers** the certificate
- `holderid` — the principal the certificate was **issued to** (the subject)
- `team` — the team the certificate belongs to

When users say "my certificates", they typically mean ownership (`owner` +
`team`), not holder. If they say "certificates issued to me", use `holderid`.

---

## Service Discovery Patterns (HCQL)

When searching for certificates related to a specific service or application,
**always** search across discovery data fields in addition to DN and SAN. The
Evertrust Horizon Client discovers certificates on hosts and records where
they were found (file path, service binding, hostnames). These fields are
often the most reliable way to identify which service uses a certificate.

### Discovery fields to search

| Field                     | What it reveals                                      |
|---------------------------|------------------------------------------------------|
| `dn`                      | Subject DN — may contain the service hostname        |
| `san`                     | SANs — DNS names, IPs bound to the certificate       |
| `discoverydata.paths`      | On-disk file path (keystore, PEM, PFX location)      |
| `discoverydata.usages` | Service binding: port + config path used by the service |
| `discoverydata.hostnames` | Hostnames of the machine where the cert was found    |
| `discoverydata.sources`   | How it was found (localscan, netscan, etc.)          |

### Natively integrated services

These services are natively integrated with the Evertrust Horizon Client.
Their certificates are discovered with rich metadata in `paths`, `usages`,
and `hostnames`. When a user asks about any of these services, build a
comprehensive query that searches **all** relevant fields:

#### Tomcat

```
dn contains "tomcat" or san contains "tomcat"
  or discoverydata.paths contains "tomcat"
  or discoverydata.usages contains "tomcat"
  or discoverydata.hostnames contains "tomcat"
```

Typical discovery data: paths `["/opt/tomcat/conf/tomcat-keystore.jks"]`,
usages `["tomcat-*:8443", "/opt/tomcat/conf"]`.

#### Apache (httpd)

```
dn contains "apache" or san contains "apache"
  or discoverydata.paths contains "apache"
  or discoverydata.usages contains "apache"
  or discoverydata.hostnames contains "apache"
```

Also search for `httpd` as an alternative name:

```
(dn contains "apache" or dn contains "httpd")
  or (san contains "apache" or san contains "httpd")
  or (discoverydata.paths contains "apache" or discoverydata.paths contains "httpd")
  or (discoverydata.usages contains "apache" or discoverydata.usages contains "httpd")
  or (discoverydata.hostnames contains "apache" or discoverydata.hostnames contains "httpd")
```

Typical discovery data: paths `["/etc/apache2/ssl/server.crt"]` or `["/etc/httpd/conf.d/ssl.conf"]`.

#### Nginx

```
dn contains "nginx" or san contains "nginx"
  or discoverydata.paths contains "nginx"
  or discoverydata.usages contains "nginx"
  or discoverydata.hostnames contains "nginx"
```

Typical discovery data: paths `["/etc/nginx/ssl/cert.pem"]`,
usages `["nginx:443", "/etc/nginx/conf.d"]`.

#### WildFly / JBoss

```
(dn contains "wildfly" or dn contains "jboss")
  or (san contains "wildfly" or san contains "jboss")
  or (discoverydata.paths contains "wildfly" or discoverydata.paths contains "jboss")
  or (discoverydata.usages contains "wildfly" or discoverydata.usages contains "jboss")
  or (discoverydata.hostnames contains "wildfly" or discoverydata.hostnames contains "jboss")
```

Typical discovery data: paths `["/opt/wildfly/standalone/configuration/keystore.jks"]`.

#### HAProxy

```
dn contains "haproxy" or san contains "haproxy"
  or discoverydata.paths contains "haproxy"
  or discoverydata.usages contains "haproxy"
  or discoverydata.hostnames contains "haproxy"
```

Typical discovery data: paths `["/etc/haproxy/certs/frontend.pem"]`.

#### IIS

```
dn contains "iis" or san contains "iis"
  or discoverydata.paths contains "iis"
  or discoverydata.usages contains "iis"
  or discoverydata.hostnames contains "iis"
```

Typical discovery data: paths in Windows certificate store,
usages `["IIS:443", "Default Web Site"]`.

### Generic service search pattern

For any service NOT in the natively-integrated list above, search at minimum
the certificate path and discovery hostnames alongside DN and SAN:

```
dn contains "<service>" or san contains "<service>"
  or discoverydata.paths contains "<service>"
  or discoverydata.hostnames contains "<service>"
```

### Combining with status or profile filters

Service discovery queries can be combined with other filters:

```
(discoverydata.paths contains "tomcat" or discoverydata.usages contains "tomcat")
  and status is valid
  and valid.until before 30d
```

This finds valid Tomcat certificates expiring within 30 days.
