# E2E Test Coverage

Last verified: 2026-07-02 against Horizon 2.10 QA (300/301 passing; the one
failure was a CSV export test timeout, fixed by raising the per-test timeout
above the tool's own CSV_TIMEOUT of 120s).

## Suite layout (Vitest, tests/e2e/)

30 test files, ~301 tests, run with `bun run test:e2e` (source `.env.local`
first for `HORIZON_E2E_URL` / `HORIZON_E2E_API_ID` / `HORIZON_E2E_API_KEY`).
Setup lives in `setup.ts` (builds a HorizonClient from env and a `callTool`
helper that invokes registered MCP tools directly).

| Area                                                                              | Files                         | Tests | Notes                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core domains (lifecycle, search, exports, dashboards, discovery, reports, assist) | `horizon.test.ts`             | 91    | Includes CRUD lifecycles with cleanup                                                                                                                                                                                                                                                                                                                      |
| Config CRUD domains                                                               | `config-*.test.ts` (27 files) | ~160  | One file per domain: teams, roles, CAs, profiles, labels, DCV, PKI connectors/queues, storages, triggers, proxies, password policies, execution/automation policies, scheduled tasks, terms of service, WCCE forests, archives, grading, identity providers, service accounts, system configuration, third-party connectors, polymorphic subtypes, binding |
| Documentation tools                                                               | `docs.test.ts`                | 5     | search_docs, search_api_docs, get_doc_page                                                                                                                                                                                                                                                                                                                 |
| System tools                                                                      | `system-tools.test.ts`        | 2     | whoami, license                                                                                                                                                                                                                                                                                                                                            |

Mutating tests follow create -> verify -> delete with teardown; nothing is
left behind on the QA instance.

## LLM evaluation (tests/llm-evaluation/)

| Tier           | File                                      | Description                                                                             |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Tool selection | `tool-selection.test.ts` + `scenarios.ts` | 18 golden scenarios: right tool picked, disallowed tools avoided, required args present |
| MCP loop       | `mcp-loop.test.ts`                        | Full tool execution loops against live Horizon                                          |
| Smoke          | `smoke.test.ts`                           | Basic integration check                                                                 |

Run with `bun run test:llm` (uses `HORIZON_LLM_EVAL_MODEL`, Sonnet by
default). `tests/llm-live/` contains the live tool-selection eval runner.

## Known environment-dependent skips

- `horizon.test.ts` discovery feed lifecycle: soft-skips if the feed campaign
  returns DISC-CAMP-003 right after creation.
- Discovery import workflow: requires a pre-existing `sbo-claude-qa` campaign
  on the target instance; skips when absent.

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
