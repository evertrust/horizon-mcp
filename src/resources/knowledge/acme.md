# ACME Server, External Account Bindings, Accounts, and Orders

ACME profiles exist in every supported Horizon version. The ACME management
objects and APIs in this guide (EAB policies, EABs, ACME account and order
management, HAQL, HEABQL) require **Horizon 2.11 or later**. Check the version
with `get_license_info` before you use them. On an older server, tell the user
the feature is not available; do not call the API.

## Overview

Horizon is an RFC 8555 ACME server. It supports enrollment, renewal (an
enrollment), and revocation. ACME uses four object types plus orders:

| Object       | Role                                                                                       | Managed with                         |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| ACME profile | PKI connector, allowed validation methods, constraints. Certificate profile `module: acme` | certificate profile tools            |
| EAB policy   | Named, reusable constraint set attached to EABs (Horizon 2.11+)                            | `*_eab_policy` tools                 |
| EAB          | MAC key ID + MAC key handed to an ACME client to bind its account (Horizon 2.11+)          | `*_acme_eab*` tools                  |
| ACME account | Registered by an ACME client on a profile; audited and managed (Horizon 2.11+)             | `*_acme_account*` tools              |
| ACME order   | One certificate request by an account, with its authorizations (Horizon 2.11+)             | `list_acme_orders`, `get_acme_order` |

Object chain: EAB policy -> EAB -> ACME account -> order -> certificate.
Accounts are always created by ACME clients, never by the API. Orders are
read-only from the management API.

Validation methods (`authorizationMethods`, EAB `validationMethods`):
`http-01`, `dns-01`, `tls-alpn-01`. For `dns-01`, the ACME client publishes
the TXT record; Horizon only checks it. Identifier types are `dns` and, since
Horizon 2.11, `ip`.

## ACME profile options

ACME profiles are certificate profiles with `module: "acme"`. Create and
update them with `create_certificate_profile` / `update_certificate_profile`
(call `describe_certificate_profile_schema` first). Required fields: `module`,
`name`, `enabled`, `timeout`, `pkiConnector`, `authorizeShortName`,
`authorizeEmptyContact`, `verifyRetryCount`, `verifyRetryDelay`,
`requireTermsOfService`, `authorizationLevels`, `requestsPolicy`,
`selfPermissions`, `cryptoPolicy`.

| Field                    | Since | Meaning                                                                                       |
| ------------------------ | ----- | --------------------------------------------------------------------------------------------- |
| `authorizationMethods`   | all   | Allowed validation methods.                                                                   |
| `http01Port`             | all   | Port for `http-01` (default 80).                                                              |
| `tlsAlpn01Port`          | all   | Port for `tls-alpn-01` (default 443).                                                         |
| `verifyRetryCount`       | all   | Challenge verification attempts (default 3).                                                  |
| `verifyRetryDelay`       | all   | Delay between attempts, finite duration (default 3 seconds).                                  |
| `timeout`                | all   | Wait time for each validation, finite duration.                                               |
| `proxy`                  | all   | HTTP proxy for `http-01` / `tls-alpn-01` validation.                                          |
| `authorizeShortName`     | all   | Allow short names (one verifiable FQDN is required per short name).                           |
| `authorizeEmptyContact`  | all   | Allow account registration without a contact email.                                           |
| `defaultContacts`        | all   | Contacts used when the client gives none.                                                     |
| `requireTermsOfService`  | all   | Client must agree to the terms of service.                                                    |
| `maxDnsName`             | all   | Maximum DNS names per order.                                                                  |
| `constraints`            | all   | Allowed DNS domains and email domains (regex).                                                |
| `meta`                   | all   | Directory metadata: `termsOfService`, `website`, `caaIdentities`.                             |
| `excludeRootCA`          | 2.11+ | Omit the root CA from the chain returned to clients (default false). Intermediates unchanged. |
| `ipIdentifierConstraint` | 2.11+ | Regex every IP identifier of an order must match; empty accepts any IP.                       |

Require External Account Binding (Horizon 2.11+): the profile option "Require
External Account Binding (EAB)" (default false) rejects account registrations
without valid EAB credentials and advertises `externalAccountRequired` in the
ACME directory. The public 2.11 profile schema does not name its JSON key:
read an existing profile with `get_certificate_profile` to see it, or set the
option in the Horizon UI. Horizon 2.10 profiles carry
`meta.externalAccountRequired`; the 2.11 public schema no longer lists it.

ACME profiles have no `authorizationMode` and no `validationRuleset`.

## EAB policies

Horizon 2.11+. A named, reusable set of constraints shared by every EAB that
references it. Tools: `list_eab_policies`, `get_eab_policy`,
`create_eab_policy`, `update_eab_policy`, `delete_eab_policy`.

| Field                  | Meaning                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `name`                 | Required, immutable, unique. EABs reference the policy by name.                  |
| `allowedProfiles`      | ACME profiles the attached EABs may use. Empty: no restriction at this level.    |
| `identifierConstraint` | Regex every order identifier must match.                                         |
| `emailConstraint`      | Regex every account contact email must match.                                    |
| `validationMethods`    | Allowed validation methods (`http-01`, `dns-01`, `tls-alpn-01`). Empty: no limit |

Rules: policy constraints apply together with the EAB constraints and the
ACME profile settings. A request must satisfy every level. For
`allowedProfiles`, only profiles in both lists are accepted. A policy change
applies at once to every attached EAB. A policy referenced by an EAB cannot
be deleted (`EAB-POLICY-002`).

## EABs

Horizon 2.11+. An External Account Binding (RFC 8555 section 7.3.4) is a MAC
key ID (public) and a MAC key (shared secret) generated by Horizon. The ACME
client sends the key ID and signs its account registration with the MAC key.
Binding lets Horizon control who creates accounts and add constraints to the
bound accounts.

Create with `create_acme_eab`. Required: `name` (immutable, unique),
`eabPolicy`, `macKeyAlgorithm` (`HS256`, `HS384`, `HS512`). Optional:
`description`, `eabValidityDuration` (finite duration from creation; empty
means no expiry; can only be set at creation or renewal), `allowedProfiles`,
`identifierConstraint`, `emailConstraint`, `validationMethods`.

MAC key handling:

- `create_acme_eab` and `renew_acme_eab` return `macKey` (base64url) and
  `macKeyId` **once**. They cannot be read again. Show them to the user one
  time, tell the user to store them in a secret store, and never repeat them
  in later messages or logs.
- `renew_acme_eab` generates a new MAC key and keeps the same key ID. It can
  set a new `macKeyAlgorithm` and a new `eabValidityDuration` (empty removes
  the expiry). Already bound ACME accounts keep working; only new
  registrations with the old key are rejected. `numberOfKeyRegeneration`
  counts renewals.
- If the MAC key is lost, renew the EAB. If it may be disclosed, renew it or
  set the EAB status to `compromised`.

`update_acme_eab` changes metadata and constraints only (description, policy,
constraints). Change the status with `update_acme_eab_status`.

An EAB is usable only when its status is `valid` and its `expirationDate`, if
any, is not passed. An EAB cannot be deleted while it is linked to an ACME
account in status `valid`, `deactivated`, or `suspended` (`EAB-003`).

## EAB statuses

Statuses: `valid`, `disabled`, `suspended`, `deactivated`, `compromised`. Set
with `update_acme_eab_status` (`status`, optional `compromisedAt` in epoch
milliseconds, optional `compromissionReason` revocation reason).

| Status        | Effect                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `valid`       | Active. New accounts can bind to it.                                                            |
| `disabled`    | Temporary. Not usable for new account registrations.                                            |
| `suspended`   | Temporary, for a suspected compromise. Not usable for new account registrations.                |
| `deactivated` | Deactivates every linked ACME account. Afterwards only `compromised` is possible.               |
| `compromised` | Irreversible. Compromises every linked ACME account and revokes the certificates they enrolled. |

Compromise: certificates issued after `compromisedAt` are revoked; omit it to
revoke all certificates linked to the EAB. `compromissionReason` applies to
every revoked certificate. This is destructive and cannot be undone: confirm
the EAB name, the date, and the reason with the user first.

## ACME accounts

Horizon 2.11+. An account is created by an ACME client when it registers on an
ACME profile (RFC 8555 section 7.3). Tools: `search_acme_accounts`,
`get_acme_account`, `update_acme_account_status`, `delete_acme_account`.

Fields: `_id` (account ID used by the tools), `keyThumbprint` (the Key ID shown
in the UI: SHA-256 thumbprint of the account key), `jwk` (public account key),
`contact`, `termsOfServiceAgreed`, `eabName` (bound EAB), `createdAt`,
`initialIp`, `status`, `compromisedAt`, `compromissionReason`.

The client identifies its account with the account URL (JWS `kid`), not with
the thumbprint. Anyone who holds the account key can act as the account and
reuse its valid authorizations. If the key may be disclosed, compromise the
account.

Delete: `delete_acme_account` also deletes the account's orders. It is
refused when an order is not in a final status (`valid` or `invalid`)
(`ORDER-002`) or when a certificate enrolled by the account is still valid
(`ACME-005`).

## ACME account statuses and compromise

Statuses: `valid`, `deactivated`, `suspended`, `revoked`, `compromised`,
`compromised_pending`. Set with `update_acme_account_status` (`status`,
optional `compromisedAt` epoch milliseconds, optional
`compromissionReason`).

| Status                | Effect                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `valid`               | Can request certificates and manage its orders and authorizations.                         |
| `deactivated`         | Blocks certificate requests and access to orders and authorizations. Can go back to valid. |
| `suspended`           | Same as deactivated, for a suspected compromise. Can go back to valid.                     |
| `revoked`             | Final block. Afterwards only `compromised` is possible.                                    |
| `compromised`         | Irreversible. Revokes the certificates issued to the account.                              |
| `compromised_pending` | Set by Horizon while a compromise revokes certificates; then becomes `compromised`.        |

ACME clients see only RFC 8555 statuses: `suspended` shows as deactivated,
`revoked` and `compromised` show as revoked.

Compromise revokes the certificates issued after `compromisedAt` (omit it to
revoke all) with `compromissionReason`. Destructive and irreversible: confirm
the account, the date, and the reason with the user before the call.

## Orders

Horizon 2.11+. Read-only. `list_acme_orders` lists the orders of one account
(paginated: zero-based page index, page size 20 by default, optional total
count and sort). `get_acme_order` reads one order by ID. Orders have no query
language.

Order statuses: `pending`, `ready`, `processing`, `valid`, `invalid`. Final
statuses are `valid` and `invalid`. Order fields include `profile`,
`accountId`, `status`, `expires`, `notBefore`, `notAfter`, `certificate`
(certificate ID, when enrolled), `thumbprint`, `initialIp`, `owner`, `team`,
`contactEmail`, `label`, `metadata`, and `authorizations`.

Authorization statuses: `pending`, `valid`, `invalid`, `deactivated`,
`revoked`. Challenge statuses: `pending`, `processing`, `valid`, `invalid`.

## Searching (HAQL and HEABQL)

Horizon 2.11+. `search_acme_accounts` takes HAQL (Horizon ACME Query
Language); `search_acme_eabs` takes HEABQL (Horizon External Account Binding
Query Language). Validate with `validate_hql` and `query_type` `haql` or
`heabql`. Syntax: `<element> <condition> "<value>"`, combined with `and` /
`or`. Field names are lowercase.

HAQL elements (ACME accounts):

| Element      | Meaning               | Conditions                                                                 |
| ------------ | --------------------- | -------------------------------------------------------------------------- |
| `id`         | Account ID            | equals, not equals                                                         |
| `contact`    | Account contact       | equals, not equals, contains, not contains, in, not in, exists, not exists |
| `eab.name`   | Name of the bound EAB | equals, not equals, contains, not contains, in, not in, exists, not exists |
| `status`     | Account status        | equals, not equals, in, not in                                             |
| `created.at` | Account creation date | equals, not equals, before, after, not before, not after                   |

HEABQL elements (EABs):

| Element              | Meaning                | Conditions                                                       |
| -------------------- | ---------------------- | ---------------------------------------------------------------- |
| `id`                 | EAB ID                 | equals, not equals, contains, not contains, in, not in           |
| `name`               | EAB name               | equals, not equals, contains, not contains, in, not in           |
| `status`             | EAB status             | equals, not equals, contains, not contains, in, not in           |
| `mackey.algorithm`   | MAC key algorithm      | equals, not equals, contains, not contains, in, not in           |
| `expiration.date`    | EAB expiration date    | equals, before, after, not before, not after, exists, not exists |
| `created.at`         | EAB creation date      | equals, before, after, not before, not after                     |
| `eab.policy`         | EAB policy name        | equals, not equals, contains, not contains, in, not in           |
| `validation.methods` | EAB validation methods | exists, not exists, contains, not contains, in, not in           |

Examples:

```
status equals "valid" and eab.name equals "team-web"
status in ["suspended", "deactivated"]
eab.policy equals "internal-web" and validation.methods contains "dns-01"
```

Search responses are paginated (`pageIndex`, `pageSize`, `count` with
`withCount`, `hasMore`). EAB search can fail with `EAB-004` (wait time
exceeded): narrow the query and retry.

## Error codes

| Code             | Meaning                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `ACME-001`       | Unexpected error                                                           |
| `ACME-002`       | Invalid request                                                            |
| `ACME-003`       | Invalid status                                                             |
| `ACME-004`       | Account does not exist                                                     |
| `ACME-005`       | Certificate valid (account still has a valid certificate; delete refused)  |
| `EAB-001`        | EAB already exists                                                         |
| `EAB-002`        | EAB does not exist                                                         |
| `EAB-003`        | Cannot delete the EAB; also returned by the EAB status endpoint            |
| `EAB-004`        | EAB search wait time exceeded                                              |
| `EAB-POLICY-001` | EAB policy does not exist                                                  |
| `EAB-POLICY-002` | EAB policy is referenced by an EAB (delete refused)                        |
| `ORDER-001`      | Order does not exist                                                       |
| `ORDER-002`      | Orders not finished or a valid certificate exists (account delete refused) |

## Which tool to use

| Goal                                  | Tool                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| Configure the ACME server for clients | `create_certificate_profile` with `module: "acme"`          |
| Shared EAB constraints                | `create_eab_policy` / `update_eab_policy`                   |
| Give an ACME client EAB credentials   | `create_acme_eab` (MAC key shown once)                      |
| Lost or leaked MAC key                | `renew_acme_eab`, or `update_acme_eab_status` `compromised` |
| Find EABs                             | `search_acme_eabs` (HEABQL), `get_acme_eab`                 |
| Find accounts of an EAB or a contact  | `search_acme_accounts` (HAQL), `get_acme_account`           |
| Orders of an account                  | `list_acme_orders`, then `get_acme_order`                   |
| Block an account                      | `update_acme_account_status` (`suspended`, `deactivated`)   |
| Leaked account key                    | `update_acme_account_status` `compromised` (confirm first)  |
| Certificates enrolled over ACME       | `search_certificates` with `module equals "acme"`           |

Always ask the user for `name` before `create_eab_policy` or
`create_acme_eab`: names are immutable.
