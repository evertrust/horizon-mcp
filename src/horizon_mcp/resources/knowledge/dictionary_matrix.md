# Dictionary Entries - Complete Reference

## Overview

Dictionary entries are named values available inside computation rules,
template strings, datasource input mappings, validation rule conditions,
and notification templates. Availability depends on the context (profile
vs notification) and the protocol module.

Two syntaxes for accessing entries:
- Single value: `{{key}}` - e.g., `{{csr.subject.cn.1}}`
- Multi value (list): `[[key]]` - e.g., `[[csr.san.dnsname]]`

**All indexes are 1-based** in computation rules and validation rules.

---

## CONTEXT 1: PROFILE (Certificate Template, Validation Rules, Datasource Flows)

These entries are available during enrollment for computation rules,
validation rule conditions, and datasource flow input mappings.

### Principal Dictionary

Information about the authenticated user making the request.

| Key | Description | Type |
|-----|-------------|------|
| `principal.identifier` | Identifier of the user | Single |
| `principal.team` | Teams of the user | Multi |
| `principal.team.<index>` | Team at a specific index | Single |
| `principal.name` | Name of the user | Single |
| `principal.mail` | Email of the user | Single |
| `principal.provider.name` | Name of the identity provider | Single |
| `principal.certificate.subject` | Subject of the principal's certificate | Subject sub-dict |
| `principal.certificate.san` | SANs of the principal's certificate | Sans sub-dict |
| `principal.certificate.extension` | Extensions of the principal's certificate | Extensions sub-dict |

### CSR Dictionary

Information from the Certificate Signing Request (decentralized enrollment
via horizon-cli, estclient, sscep, or WebRA CSR upload).

| Key | Description | Type |
|-----|-------------|------|
| `csr.subject` | CSR subject fields | Subject sub-dict |
| `csr.san` | CSR SANs | Sans sub-dict |
| `csr.extension` | CSR extensions | Extensions sub-dict |

### HTTP Request Dictionary

Information from the HTTP request that initiated enrollment.

| Key | Description | Type |
|-----|-------------|------|
| `http.request.ip` | IP the request originated from | Single |
| `http.request.method` | HTTP method used | Single |
| `http.request.path` | Path requested | Single |
| `http.request.host` | Host requested | Single |
| `http.request.header.<header name>` | Value of a specific HTTP header | Multi |

### WebRA Protocol Entries

| Key | Description | Type |
|-----|-------------|------|
| `webra.enroll.subject` | Subject from the WebRA enrollment form | Subject sub-dict |
| `webra.enroll.san` | SANs from the WebRA enrollment form | Sans sub-dict |
| `webra.enroll.extension` | Extensions from the WebRA enrollment form | Extensions sub-dict |
| `webra.enroll.label.<label name>` | Value of a specific label | Single |
| `webra.enroll.metadata.<metadata name>` | Value of a specific metadata field | Single |
| `webra.enroll.mail` | Contact email from form | Single |
| `webra.enroll.owner` | Owner from form | Single |
| `webra.enroll.team` | Team from form | Single |

### EST Protocol Entries

| Key | Description | Type |
|-----|-------------|------|
| `est.enroll.subject` | Subject from EST challenge request | Subject sub-dict |
| `est.enroll.san` | SANs from EST challenge request | Sans sub-dict |
| `est.enroll.extension` | Extensions from EST challenge request | Extensions sub-dict |
| `est.enroll.label.<label name>` | Label value | Single |
| `est.enroll.metadata.<metadata name>` | Metadata value | Single |
| `est.enroll.mail` | Contact email | Single |
| `est.enroll.owner` | Owner | Single |
| `est.enroll.team` | Team | Single |

### SCEP Protocol Entries

| Key | Description | Type |
|-----|-------------|------|
| `scep.enroll.subject` | Subject from SCEP challenge request | Subject sub-dict |
| `scep.enroll.san` | SANs from SCEP challenge request | Sans sub-dict |
| `scep.enroll.extension` | Extensions from SCEP challenge request | Extensions sub-dict |
| `scep.enroll.label.<label name>` | Label value | Single |
| `scep.enroll.metadata.<metadata name>` | Metadata value | Single |
| `scep.enroll.mail` | Contact email | Single |
| `scep.enroll.owner` | Owner | Single |
| `scep.enroll.team` | Team | Single |

### ACME Protocol Entries

| Key | Description | Type |
|-----|-------------|------|
| `acme.order.initialip` | Initial IP of the ACME order | Single |
| `acme.order.label.<label name>` | Label value | Single |
| `acme.order.metadata.<metadata name>` | Metadata value | Single |
| `acme.order.mail` | Contact email of the order | Single |
| `acme.order.owner` | Owner of the order | Single |
| `acme.order.team` | Team of the order | Single |
| `acme.account.initialip` | Initial IP of the ACME account | Single |
| `acme.account.contact.<index>` | Contact email at index | Single |

### CRMP Protocol Entries

| Key | Description | Type |
|-----|-------------|------|
| `crmp.enroll.subject` | Subject from CMS interface | Subject sub-dict |
| `crmp.enroll.san` | SANs from CMS interface | Sans sub-dict |
| `crmp.enroll.extension` | Extensions from CMS interface | Extensions sub-dict |
| `crmp.enroll.label.<label name>` | Label value | Single |
| `crmp.enroll.metadata.<metadata name>` | Metadata value | Single |
| `crmp.enroll.mail` | Contact email | Single |
| `crmp.enroll.owner` | Owner | Single |
| `crmp.enroll.team` | Team | Single |

### WCCE Protocol Entries (Caller Identity)

| Key | Description |
|-----|-------------|
| `calleridentity.dn` | DN of the caller identity |
| `calleridentity.subject` | DN in addressable form (Subject sub-dict) |
| `calleridentity.cn` | CN of the caller |
| `calleridentity.msguid` | GUID of the caller |
| `calleridentity.msupn` | UPN of the caller |
| `calleridentity.c` | Country |
| `calleridentity.company` | Company |
| `calleridentity.department` | Department |
| `calleridentity.description` | Description |
| `calleridentity.displayname` | Display name |
| `calleridentity.dnshostname` | DNS host name |
| `calleridentity.employeeid` | Employee ID |
| `calleridentity.employeenumber` | Employee number |
| `calleridentity.mail` | Email |
| `calleridentity.o` | Organization |
| `calleridentity.ou` | OU |
| `calleridentity.samaccountname` | SAM account name |
| `calleridentity.serialnumber` | Serial number |
| `calleridentity.sn` | SN |
| `calleridentity.title` | Title |
| `calleridentity.uid` | UID |
| `calleridentity.sid` | SID |

### URL Passed Parameters (EST, SCEP, horizon-cli)

| Key | Description |
|-----|-------------|
| `url.enroll.label.<label name>` | Label passed in URL |
| `url.enroll.metadata.<metadata name>` | Metadata passed in URL |
| `url.enroll.mail` | Contact email in URL |
| `url.enroll.owner` | Owner in URL |
| `url.enroll.team` | Team in URL |

### Datasource Result Entries

Populated by datasource flow execution at enrollment time.

| Pattern | Description | Type |
|---------|-------------|------|
| `ds.<flowIndex>.<resultIndex>.<key>` | Specific result attribute (1-based indexes) | Varies |
| `ds.<flowIndex>.*.<key>` | Wildcard over all results | Multi |

---

## CONTEXT 2: NOTIFICATIONS

These entries are available in notification templates (email, webhook, REST triggers).

### Certificate Dictionary

Available for: on_enroll, on_revoke, on_update, on_recover, on_migrate, on_expire, on_renew

| Key | Description | In Computation Rule |
|-----|-------------|:-------------------:|
| `certificate.id` | Horizon ID | Yes |
| `certificate.module` | Module | Yes |
| `certificate.not_after` | Expiration date | Yes |
| `certificate.not_before` | Start date | Yes |
| `certificate.serial` | Serial number | Yes |
| `certificate.thumbprint` | Thumbprint | Yes |
| `certificate.public_key_thumbprint` | Public key thumbprint | Yes |
| `certificate.revoked` | Whether revoked | Yes |
| `certificate.key_type` | Key type | Yes |
| `certificate.signing_algorithm` | Signing algorithm | Yes |
| `certificate.holder_id` | Holder ID | Yes |
| `certificate.friendly_name` | Friendly name | Yes |
| `certificate.pem` | PEM-encoded certificate | Yes |
| `certificate.profile` | Profile name | Yes |
| `certificate.revocation_date` | Revocation date | Yes |
| `certificate.revocation_reason` | Revocation reason | Yes |
| `certificate.mail` | Contact email | Yes |
| `certificate.owner` | Owner principal | Yes |
| `certificate.issuer` | Issuer DN | No |
| `certificate.dn` | Distinguished Name | No |
| `certificate.sans` | All SANs (comma-separated) | No |
| `certificate.extensions` | All extensions (comma-separated) | No |
| `certificate.metadata` | All metadata (comma-separated) | No |
| `certificate.labels` | All labels (comma-separated) | No |
| `certificate.metadata.<name>` | Specific metadata value | Yes |
| `certificate.subject` | Subject fields | Subject sub-dict |
| `certificate.san` | SAN fields | Sans sub-dict |
| `certificate.extension` | Extension fields | Extensions sub-dict |
| `certificate.label` | Label fields | Labels sub-dict |
| `certificate.team` | Team fields | Team sub-dict |

### Request Dictionary

Available for: on_submit_*, on_cancel_*, on_approve_*, on_deny_*, on_pending_* (all workflow types)

| Key | Description | In Computation Rule |
|-----|-------------|:-------------------:|
| `request.id` | Request ID | Yes |
| `request.workflow` | Workflow type | Yes |
| `request.module` | Module | Yes |
| `request.status` | Status | Yes |
| `request.profile` | Profile | Yes |
| `request.requester` | Requester | Yes |
| `request.approver` | Approver | Yes |
| `request.requester_comment` | Requester comment | Yes |
| `request.approver_comment` | Approver comment | Yes |
| `request.registration_date` | Registration date | Yes |
| `request.last_modification_date` | Last modification date | Yes |
| `request.password` | PKCS#12 password or challenge | Yes |
| `request.mail` | Contact email | Yes |
| `request.owner` | Owner | Yes |
| `request.my.url` | Link for 'My Requests' drawer | No |
| `request.manage.url` | Link for 'Manage Requests' drawer | No |
| `request.dn` | Distinguished Name | No |
| `request.sans` | All SANs (comma-separated) | No |
| `request.extensions` | All extensions (comma-separated) | No |
| `request.metadata` | All metadata (comma-separated) | No |
| `request.labels` | All labels (comma-separated) | No |
| `request.subject` | Subject fields | Subject sub-dict |
| `request.san` | SAN fields | Sans sub-dict |
| `request.extension` | Extension fields | Extensions sub-dict |
| `request.label` | Label fields | Labels sub-dict |
| `request.metadata.<name>` | Specific metadata | Yes |
| `request.certificate` | Certificate in request | Certificate sub-dict |
| `request.team` | Team | Team sub-dict |

### Previous Certificate Dictionary

Available for: on_renew only

| Key | Description |
|-----|-------------|
| `previous.certificate` | Certificate being renewed (Certificate sub-dict) |

### Credentials Dictionary

Available for: on_credentials_expiration

| Key | Description |
|-----|-------------|
| `credentials.name` | Name |
| `credentials.description` | Description |
| `credentials.type` | Type |
| `credentials.expiration_date` | Expiration date |

### Profile Dictionary

| Key | Description | In Computation Rule |
|-----|-------------|:-------------------:|
| `profile.name` | Technical name | Yes |
| `profile.module` | Module | Yes |
| `profile.displaynames` | Display names (comma-separated) | No |
| `profile.descriptions` | Descriptions (comma-separated) | No |
| `profile.<name>.displayname.<lang>` | Display name in language | No |
| `profile.<name>.description.<lang>` | Description in language | No |

### License Dictionary

Available for: on_license_expiration, on_license_usage

| Key | Description |
|-----|-------------|
| `license.expiration_date` | Expiration date |
| `license.used` | Number of holders (on_license_usage only) |
| `license.percent_used` | Percent used (on_license_usage only) |

### Failed Trigger Dictionary

Available for: on_trigger_error

| Key | Description |
|-----|-------------|
| `trigger.name` | Trigger name |
| `trigger.event` | Event |
| `trigger.lastExecutionDate` | Last execution date |
| `trigger.status` | Status |
| `trigger.retryable` | Whether retryable |
| `trigger.type` | Type |
| `trigger.retries` | Remaining retries |
| `trigger.nextExecutionDate` | Next execution date |
| `trigger.nextDelay` | Delay to next retry |
| `trigger.detail` | Failure details |

---

## SUB-DICTIONARIES

These complete a parent dictionary. Example: `principal.certificate.subject.cn.1`

### Subject Sub-dictionary

| Key | Description | Type |
|-----|-------------|------|
| `subject.<field type>` | All values of a DN field type | Multi |
| `subject.<field type>.<index>` | Specific indexed value (1-based) | Single |

Valid DN field types: `cn`, `uid`, `serialnumber`, `surname`, `givenname`,
`unstructuredaddress`, `unstructuredname`, `e`, `ou`, `organizationidentifier`,
`uniqueidentifier`, `street`, `st`, `l`, `o`, `c`, `description`, `dc`

### Sans Sub-dictionary

| Key | Description | Type |
|-----|-------------|------|
| `san.<field type>` | All values of a SAN type | Multi |
| `san.<field type>.<index>` | Specific indexed value (1-based) | Single |

Valid SAN field types: `rfc822name`, `dnsname`, `uri`, `ipaddress`,
`othername_upn`, `othername_guid`, `registered_id`

### Extensions Sub-dictionary

| Key | Description | Type |
|-----|-------------|------|
| `extension.<extension type>` | Extension value | Single |

Valid extension types: `ms_sid`, `ms_template`, `ms_template_v2`

### Labels Sub-dictionary

| Key | Description | In Computation Rule |
|-----|-------------|:-------------------:|
| `label.<name>` | Label value | Yes |
| `label.<name>.displaynames` | Display names (comma-separated) | No |
| `label.<name>.descriptions` | Descriptions (comma-separated) | No |
| `label.<name>.displayname.<lang>` | Display name in language | No |
| `label.<name>.description.<lang>` | Description in language | No |

### Team Sub-dictionary

| Key | Description | In Computation Rule |
|-----|-------------|:-------------------:|
| `team` | Team value | Yes |
| `team.displaynames` | Display names | No |
| `team.descriptions` | Descriptions | No |
| `team.displayname.<lang>` | Display name in language | No |
| `team.<name>.description.<lang>` | Description in language | No |

---

## Availability Matrix by Module

| Entry family | WebRA | ACME | SCEP | EST | WCCE | CRMP | Monitored | Notifications |
|-------------|:-----:|:----:|:----:|:---:|:----:|:----:|:---------:|:-------------:|
| `principal.*` | Yes | -- | -- | -- | -- | -- | -- | -- |
| `csr.*` | Yes | Yes | Yes | Yes | Yes | -- | -- | -- |
| `http.request.*` | Yes | Yes | Yes | Yes | -- | -- | -- | -- |
| `webra.enroll.*` | Yes | -- | -- | -- | -- | -- | -- | -- |
| `est.enroll.*` | -- | -- | -- | Yes | -- | -- | -- | -- |
| `scep.enroll.*` | -- | -- | Yes | -- | -- | -- | -- | -- |
| `acme.order.*` | -- | Yes | -- | -- | -- | -- | -- | -- |
| `acme.account.*` | -- | Yes | -- | -- | -- | -- | -- | -- |
| `crmp.enroll.*` | -- | -- | -- | -- | -- | Yes | -- | -- |
| `calleridentity.*` | -- | -- | -- | -- | Yes | -- | -- | -- |
| `url.enroll.*` | -- | -- | Yes | Yes | -- | -- | -- | -- |
| `datasource.*` | Yes | Yes | Yes | Yes | -- | -- | -- | -- |
| `certificate.*` | -- | -- | -- | -- | -- | -- | -- | Yes |
| `request.*` | -- | -- | -- | -- | -- | -- | -- | Yes |
| `profile.*` | -- | -- | -- | -- | -- | -- | -- | Yes |
| `license.*` | -- | -- | -- | -- | -- | -- | -- | Yes |
| `credentials.*` | -- | -- | -- | -- | -- | -- | -- | Yes |
| `trigger.*` | -- | -- | -- | -- | -- | -- | -- | Yes |

---

## Key Considerations

1. **Indexes are 1-based**: `subject.cn.1` is the first CN, not `subject.cn.0`.
2. **Case sensitivity**: Entry names ARE case sensitive. `csr.subject.cn` works; `csr.Subject.CN` does not.
3. **Function names are NOT case sensitive**: `Upper()`, `upper()`, `UPPER()` all work.
4. **Null handling**: Missing entries resolve to null. Use `OrElse()` for fallbacks.
5. **Multi-value access**: `[[key]]` for lists, `{{key}}` for single values. Using `{{}}` on a multi-valued field returns the first value.
6. **Evaluation timing**: Entries resolve at enrollment time, not submission time. For queued requests, values may differ between submission and approval.

---

## Related Resources

- horizon://knowledge/computation-and-data-flow - computation rule syntax and functions
- horizon://knowledge/validation-rules - validation rule condition syntax
- horizon://knowledge/datasources - datasource configuration and flow integration
- horizon://knowledge/profiles - profile configuration
