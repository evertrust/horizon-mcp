# E2E Test Coverage

## Suite layout (Vitest, tests/e2e/)

36 test files, 330 tests, run with `bun run test:e2e` (source the env file of
the target instance first). Most suites use `HORIZON_E2E_URL` /
`HORIZON_E2E_API_ID` / `HORIZON_E2E_API_KEY`; `service-account.e2e.test.ts`
instead uses `HORIZON_E2E_URL` / `HORIZON_E2E_SVA` with
`HORIZON_E2E_SVA_TOKEN` or the `HORIZON_E2E_OAUTH_*` client settings. Setup
for the API-key suites lives in `setup.ts` (builds a HorizonClient from env and
a `callTool` helper that invokes registered MCP tools directly). Suites for
Horizon 2.11 features read the public `version` from `GET /api/v1/licenses`
and skip on older versions.

| Area                                                                              | Files                         | Tests | Notes                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core domains (lifecycle, search, exports, dashboards, discovery, reports, assist) | `horizon.test.ts`             | 131   | Includes CRUD lifecycles with cleanup                                                                                                                                                                                                                                                                                                                      |
| Config CRUD domains                                                               | `config-*.test.ts` (27 files) | 163   | One file per domain: teams, roles, CAs, profiles, labels, DCV, PKI connectors/queues, storages, triggers, proxies, password policies, execution/automation policies, scheduled tasks, terms of service, WCCE forests, archives, grading, identity providers, service accounts, system configuration, third-party connectors, polymorphic subtypes, binding |
| Horizon 2.11 config types                                                         | `config-211-types.test.ts`    | 13    | FortiGate, FortiManager, PAN-OS firewall and Panorama connectors and triggers, ACME `excludeRootCA`. Live legs skip before 2.11                                                                                                                                                                                                                            |
| Horizon 2.11 DCV provider                                                         | `config-211-dcv.test.ts`      | 1     | sectigo DCV provider create, read and delete. Skips before 2.11                                                                                                                                                                                                                                                                                            |
| DCV lifecycle (Horizon 2.10+)                                                     | `dcv.e2e.test.ts`             | 3     | Policy status list and get, one isolated domain run and policy-run cancel                                                                                                                                                                                                                                                                                  |
| WebRA challenge (Horizon 2.11+)                                                   | `webra-challenge.e2e.test.ts` | 2     | Centralized (PKCS#12) and CSR enrollment with a challenge, reuse rejected, revoke in teardown                                                                                                                                                                                                                                                              |
| ACME and EAB policies (Horizon 2.11+)                                             | `acme.e2e.test.ts`            | 5     | Read tools on ACME accounts (HAQL, HEABQL validation). EAB policy and EAB lifecycle: create, renew, update, delete. The MAC key is never logged                                                                                                                                                                                                            |
| Service-account authentication                                                    | `service-account.e2e.test.ts` | 5     | whoami identity, certificate search, service-account list, token renewal and startup mint against one pinned issuer                                                                                                                                                                                                                                        |
| Documentation tools                                                               | `docs.test.ts`                | 5     | search_docs, search_api_docs, get_doc_page                                                                                                                                                                                                                                                                                                                 |
| System tools                                                                      | `system-tools.test.ts`        | 2     | whoami, license                                                                                                                                                                                                                                                                                                                                            |

Mutating tests follow create -> verify -> delete with teardown; nothing is
left behind on the QA instance.

## LLM evaluation (tests/llm-evaluation/)

| Tier           | File                                      | Description                                                                             |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Tool selection | `tool-selection.test.ts` + `scenarios.ts` | 23 golden scenarios: right tool picked, disallowed tools avoided, required args present |
| MCP loop       | `mcp-loop.test.ts`                        | Full tool execution loops against live Horizon                                          |
| Smoke          | `smoke.test.ts`                           | Basic integration check                                                                 |

Run with `bun run test:llm`; tool selection and smoke make no model call, and
the MCP loop skips without `HORIZON_E2E_*` credentials. `tests/llm-live/`
contains the opt-in live tool-selection runner, invoked with
`bun run test:llm:live`. It defaults to `claude-haiku-4-5`; override it with
`HORIZON_LLM_LIVE_MODEL`.

## Known environment-dependent skips

- `horizon.test.ts` discovery feed lifecycle: soft-skips if the feed campaign
  returns DISC-CAMP-003 right after creation.
- Discovery import workflow: requires a pre-existing discovery campaign named
  by `HORIZON_E2E_DISCOVERY_CAMPAIGN` on the target instance; skips when the
  variable is unset or the campaign is absent.
- `dcv.e2e.test.ts`: the run and cancel test needs an isolated policy named by
  `HORIZON_E2E_DCV_POLICY` and a domain named by `HORIZON_E2E_DCV_DOMAIN`; it
  skips when either is unset.
- `webra-challenge.e2e.test.ts`: uses `HORIZON_E2E_WEBRA_CHALLENGE_PROFILE`,
  or else a WebRA profile in challenge mode that allows the key generation
  mode. Both tests skip before Horizon 2.11, and a mode also skips when no
  profile allows it.
- `service-account.e2e.test.ts`: skips without `HORIZON_E2E_SVA` and a token
  or the OAuth client settings; the renewal and mint tests skip without the
  OAuth client settings.
- `acme.e2e.test.ts`, `config-211-types.test.ts`, `config-211-dcv.test.ts`:
  skip when the instance is older than Horizon 2.11.

## Infrastructure gaps (cannot be fully E2E-tested)

| Gap               | Tools affected                         | Reason                            |
| ----------------- | -------------------------------------- | --------------------------------- |
| Active Directory  | WCCE create/update/delete              | Needs an AD forest                |
| Intune / Jamf     | MDM profile create/update              | Needs Microsoft Intune / Jamf Pro |
| SMTP              | Email triggers                         | No SMTP server in test env        |
| PKI backend       | create_pki_connector (live enrollment) | Needs ADCS/EJBCA/Vault            |
| OIDC provider     | identity provider (openid)             | Needs a real OIDC IdP             |
| Long-running jobs | archive CRUD, run_scheduled_task       | Side effects, timing              |

These are exercised read-only or with validation-level assertions instead.
