# Domain Control Validation (DCV)

DCV verifies that a certificate applicant controls each requested domain. In
Horizon, configuration defines the provider, DNS provisioner, and policy; the
lifecycle tools consume that configuration by showing status, running checks,
stopping runs, and reading the event history.

## Providers

A DCV provider is the public CA integration that obtains and validates domain
challenges. It is not a PKI connector. A DigiCert DCV provider manages domain
validation, while a DigiCert PKI connector issues certificates. Do not select a
PKI connector when configuring a DCV policy provider.

Horizon supports these DCV provider types:

- `digicert`: DigiCert DCV API integration. It needs an endpoint, DCV-target
  credentials, timeout, and optionally an HTTP proxy.
- `gs_mssl` (Horizon 2.11+): GlobalSign Managed SSL DCV integration, used
  with the GlobalSign MSSL PKI connector. It needs an endpoint, password
  credentials, timeout, profile, defaultEmail, defaultPhone, and optionally
  an HTTP proxy.
- `sectigo` (Horizon 2.11+): Sectigo Certificate Manager DCV integration,
  used with the Sectigo PKI connector (which still issues the certificates).
  Fields: `endpoint` (SCM API base URL), `oauthTokenEndpoint` (defaults to
  Sectigo SSO), `credentials` (login = API client ID, password = client
  secret), `dcvMethod` (`cname` or `txt`), `timeout`; optional `organizationId`
  and proxy. `dcvMethod` applies only to domains never
  validated (or validated with a method Horizon cannot drive, such as
  email); a validated domain is re-validated with its own method. An order
  already in progress on Sectigo is reused. Sectigo checks pending
  validations every 5 minutes, so set the policy execution timeout
  accordingly. Without `organizationId`, every never-validated domain of the
  account is in scope: use the policy domain filter to limit validation and
  license use.

Credentials must be existing Horizon credentials with the DCV target. Provider
names are immutable primary keys.

## DNS provisioners

A provisioner publishes DNS challenge records. Horizon supports five types:

- `cloudflare`
- `powerdns`
- `efficientip`
- `azuredns`
- `route53`

Provisioners are not certificate publishing connectors. For example, an
`azuredns` provisioner writes validation records and is distinct from an Azure
Key Vault (`akv`) PKI connector.

## Policies and scheduling

A DCV policy connects one provider to one provisioner and limits the domains it
manages with its filter. Its `renewalPolicy` uses a cron schedule to run the
policy. The API starts manual runs, and lifecycle hooks send notifications
during runs. `executionTimeout` bounds a run, while `retryDelay` controls the
delay before a retry after a recoverable validation failure.

Use `list_dcv_policy_status` to find eligible policies, then
`get_dcv_policy_status` to inspect a policy's schedule, current status, and
each domain. A policy is runnable only when the caller has access and the
configuration permits a run.

## Lifecycle actions and statuses

`run_dcv_policy` queues a run for every eligible domain in a policy.
`run_dcv_domain` queues one named domain. Both actions mutate live validation
state. `cancel_dcv_run` stops the entire current policy run, including every
domain it contains. Confirm the intended policy before cancelling.

Policy lifecycle statuses are `scheduled`, `disabled`, `running`, `queued`, and
`enabled`. Domain execution statuses can be `initialized`, `succeeded`,
`left_over`, `error`, `get_challenge_error`,
`challenge_publication_error`, or `dcv_validation_error`.

## Event stream

Use `list_dcv_events` to review one policy's lifecycle events, or add a domain
to narrow the result. Event statuses are `started`, `success`, `failure`,
`retrying`, and `blocked`. Events include their timestamp, policy, domain,
attempt, lastError, and message when available.

`removeAt` is the retention deadline. Treat it as the time after which Horizon
may remove the event, not as a scheduled validation time. Event pagination uses
zero-based `page_index`; request `with_count` when a total is needed.

## License entitlement

DCV lifecycle APIs require the Horizon DCV license entitlement. If a policy,
provider, or event request returns a license error, check the instance license
before changing configuration. A lack of DCV entitlement cannot be fixed by
re-running a policy or changing its DNS provisioner.
