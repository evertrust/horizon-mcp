# E2E Test Coverage

Last full run: 2026-07-02 against a Horizon 2.10 QA snapshot. 300 of 301 tests
completed successfully. The remaining CSV export test timed out; its test
timeout was subsequently raised above the tool's 120-second CSV timeout, but a
post-fix 301/301 full run is not recorded here. This is a point-in-time QA result,
not a blanket support guarantee for every Horizon 2.10 deployment.

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
| MCP loop       | `mcp-loop.test.ts`                        | Deterministic MCP tool execution against local fixtures                                 |
| Smoke          | `smoke.test.ts`                           | Basic integration check                                                                 |

Run the deterministic suite with `bun run test:llm`; it makes no model call.
`tests/llm-live/` contains the opt-in Claude tool-selection runner, invoked with
`bun run test:llm:live`. It defaults to `claude-haiku-4-5`; override it with
`HORIZON_LLM_LIVE_MODEL`. Live scenarios also require `HORIZON_E2E_*`
credentials and are skipped when those credentials or Claude authentication are
unavailable.

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
