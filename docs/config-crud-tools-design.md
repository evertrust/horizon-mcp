# Configuration CRUD Tools - Design Spec

**Date:** 2026-06-04
**Branch:** `feat/config-crud-tools`
**Status:** Approved (design), pending implementation via workflow

## Goal

Extend the Horizon MCP server beyond read-only end-user capabilities so an LLM
can create, read, update, and delete Horizon **configuration** objects through
natural language. The mapping is derived from the Horizon Scala source
(`~/Documents/EVERTRUST/horizon`) so that every tool matches exactly what the
application expects. Nothing about an object's structure, mandatory fields,
enums, or immutability is inferred or assumed - it is traced to source and
independently verified before any tool is generated.

## Scope

### In scope (full CRUD tools + full destructive QA round-trip tests)

Certificate & PKI:
- Certificate profile (`/api/v1/certificate/profiles`)
- Certificate authority (`/api/v1/cas`)
- Certificate label (`/api/v1/certificate/labels`)
- Certificate grading policy (`/api/v1/certificate/grading/policies`)
- Certificate grading ruleset (`/api/v1/certificate/grading/rulesets`)
- PKI connector (`/api/v1/pki/connectors`)
- PKI queue (`/api/v1/pki/queues`)

RBAC (kept per user decision):
- Role (`/api/v1/security/roles`)
- Team (`/api/v1/security/teams`)
- Password policy (`/api/v1/security/passwordpolicies`)

Automation & integrations:
- Automation policy (`/api/v1/automation/policies`)
- Execution policy (`/api/v1/automation/executions`)
- Third-party connector (`/api/v1/thirdparty/connectors`)
- HTTP proxy (`/api/v1/proxy/httpproxies`)
- WCCE forest mapping (`/api/v1/wcce/forests`)

System & operations:
- Storage (`/api/v1/system/storages`)
- System configuration (`/api/v1/system/configuration`) - singleton, PUT-only
- Scheduled task (`/api/v1/scheduler/tasks`)
- Archive (`/api/v1/archives`)

Gap-fill:
- Triggers (`/api/v1/triggers`) - today only `create_rest_notification` +
  `delete_trigger` + `simulate_trigger` exist; add generic create/update and any
  missing read coverage as the audit reveals.

The exact route paths, verbs, and controllers above come from a medium-breadth
exploration and are treated as a **draft** to be verified by the audit phase.

### Out of scope (explicitly excluded - "not LLM territory")

Identity & access surface under `/api/v1/security/*`:
- Identity providers, local identities, service accounts, tenants, SCIM
  profiles, principal infos, credentials.

### Already complete (left untouched)

Datasources, dashboards, discovery campaigns, saved queries.

## Existing scaffolding discovered

`src/models/payloads.ts` already defines `STRIP_FIELDS` for many in-scope update
domains (ca, connector, label, proxy, role, team, grading_policy,
grading_ruleset, password_policy, automation_policy, execution_policy,
wcce_forest, scheduled_task) and `DEP_CHECKS` capturing cross-object
dependencies (pkiConnector, gradingPolicies, dsFlow, credentials, etc.). The
GET-strip-merge-PUT update path (`getStripMergePut`) and the delete safety echo
(`deleteGuard`) are reusable as-is. Create payload schemas still must be derived
and verified from source per object.

## Architecture

A single dedicated workflow runs four phases, pipelined per object so each
object flows independently through audit -> build -> test.

### Phase 1 - AUDIT (gitnexus + Scala source)
For each in-scope object, locate the Play controller, route, request body case
class / JSON `Reads`/`Format`, enums, and validation. Emit a structured
**contract**:

```
{ object, routeBase, verbs, createSchema, updateSemantics,
  mandatoryFields[], immutableKeys[], enums{}, dependencies[],
  deleteConstraints, notes }
```

Each contract is then **cross-verified by an independent agent** that re-reads
the same source to confirm fields, mandatory-ness, and immutability match
exactly. A completeness critic checks that no object, verb, or mandatory field
was dropped. Contracts that fail verification are re-audited.

### Phase 2 - BUILD
One agent per object writes `src/tools/config/<object>.ts` (its own file, so
parallel writes never conflict) plus a unit test file, consuming **only** the
verified contract. Shared CRUD wiring lives in `src/tools/config/_scaffold.ts`.

The audit classifies each object **flat** vs **complex/polymorphic**:

- **Flat** (labels, http proxies, storage, scheduled tasks, archives, roles,
  teams, password policies, automation/execution policies, grading
  policies/rulesets, third-party connectors, WCCE forests, PKI queues): fully
  typed Zod create/update/delete - every field from the audited contract typed
  explicitly.
- **Complex/polymorphic** (certificate profiles across all protocol types -
  managed, monitored, EST, SCEP, ACME, Intune, Jamf, CRMP, WebRA - and PKI
  connectors across all subtypes): a `describe_<object>_schema` tool surfaces
  the audited structure (subtypes, fields, required, enums) so the model never
  guesses; create/update enforce mandatory fields and validate the supplied body
  against the audited schema; plus delete. Same trust model as the existing
  `get_request_template` -> `submit_request` pattern.

Profile coverage spans **all** profile/enrollment-config CRUD endpoints the
audit enumerates from `openapi/paths`, not just managed/monitored.

### Phase 3 - REVIEW + PIPELINE
`code-reviewer` per file (bugs, security, maintainability). Then a single serial
wiring step registers every family in `src/index.ts` and
`tests/e2e/setup.ts:registerAllTools`. Then `lint` + `typecheck` + unit tests to
green.

### Phase 4 - QA (live instance)
E2E tests per object run against live QA with `.env.local` sourced. Full
create -> read-back/assert -> update -> assert -> delete -> assert-gone, with
guaranteed teardown. Per user decision, this is destructive for all object types
including CAs, storage, and system configuration. Singletons (system
configuration) use GET -> PUT-identical -> GET. All test objects are named
`e2e-<hex>-<obj>` (matching existing `E2E_PREFIX`) and deleted in teardown.

## Tool contract - "never assume" guarantees

1. Tools are generated only from contracts traced to Scala source and
   independently re-verified. No field, enum, or default is invented.
2. **Mandatory fields are required Zod parameters.** When a mandatory value is
   missing, the tool description explicitly instructs the model: "Do NOT infer
   or default this; ask the user." Create tools repeat the standard immutable
   primary-key warning (ask the user for `name` and `display_name`).
3. Source-defined enums and validation constraints are encoded as Zod
   refinements where they exist.
4. Update tools reuse `getStripMergePut` with the correct per-domain strip set.
5. Delete tools reuse `deleteGuard(name, expected_name)` safety echo.
6. Responses use the existing `buildMutateResponse` envelope.

## Code organization & maintainability

- New directory `src/tools/config/` with one focused file per object family and
  a `_scaffold.ts` for shared create/update/delete wiring + description
  templating. Barrel `src/tools/config/index.ts` exports a single
  `registerConfigTools(server, client)`.
- Files < 800 lines, functions < 50 lines, immutable payload building, `.js`
  import extensions, two-arg `z.record()`.
- Reuse existing helpers; do not duplicate `getStripMergePut`, `deleteGuard`,
  `buildMutateResponse`, `encodePathSegment`.

## Process around the workflow

- Work on branch `feat/config-crud-tools` (master untouched).
- Codex peer-reviews this plan before launch; findings reconciled.
- No auto-commit. After the workflow, the full diff is reviewed,
  `gitnexus_impact` is run on shared files touched (`index.ts`,
  `payloads.ts`, helpers), and final verification (lint, typecheck, unit, e2e)
  is run and reported with real output before any commit.

## Deliverables

- `src/tools/config/*.ts` (+ `_scaffold.ts`, barrel)
- registration in `src/index.ts` and `tests/e2e/setup.ts`
- unit tests under `tests/unit/`
- e2e tests under `tests/e2e/`
- this spec doc

## Risks & open notes

- Certificate profiles have heavy cross-dependencies (CA, PKI connector,
  datasources, grading policies). Their E2E may need to reference existing QA
  objects or create a minimal dependency chain; the audit must capture creation
  order.
- Destructive QA tests on a shared instance can briefly affect other users;
  mitigated by unique naming + guaranteed teardown.
- Some objects may be read-only or singleton (grading ruleset, system
  configuration); the audit determines actual verb support and the build adapts
  (no create/delete tool where the API has none).

## Codex peer-review reconciliation (2026-06-04)

The plan and the audit workflow were peer-reviewed by Codex. Accepted changes:

Audit phase (applied to the audit workflow):
- Use a single bundled, self-contained OpenAPI JSON (`redocly bundle`, internal
  `#/components` refs, 142 paths / ~759 schemas) as the primary deterministic
  source instead of hand-navigating 1050 files.
- `sourceRefs` (openapi + scala) is now required on every contract; a contract
  with no Scala evidence must be confidence `low` with an open question.
- Capture create/update body divergence (`updateBodySameAsCreate`,
  `updateFields`, `updateMandatoryFields`) and explicit `updateSemantics`.
- `idField`/`routeItem` optional with singleton documentation; a post-run check
  flags non-singleton objects that have update/delete but no item route.
- Dropped pipeline items are reported (`failed`) rather than silently filtered.
- Completeness critic is exhaustive: reads every contract, returns a count,
  scans item-only and singleton mutation routes, scrutinizes corrected ones.
- Scala tracing expanded to the full chain (route -> controller -> service ->
  domain/case class -> Reads/Format -> validators), not just the controller.
- horizon-cli is corroboration only and never overrides OpenAPI + Scala.
- Classification is shape-based (polymorphic/deeply-nested), not field count.
- Each object emits a self-contained resolved request JSON Schema
  (`docs/audit/<obj>.schema.json`) for the build to embed.

Build phase (to apply in phase 2):
- Complex objects expose the subtype discriminator + known mandatory fields as
  REQUIRED typed params and validate the body via discriminated `oneOf`, not a
  free-form body param (so the model still cannot guess mandatory fields).
- Embed the fully-resolved schema as a build-time constant plus an OpenAPI
  version hash; the standalone binary must not read `docs/audit` or source at
  runtime.
- `getStripMergePut` is not assumed to fit every endpoint; update semantics are
  per-contract and unit tests assert no unintended field removal.
- Generated unit tests compare built schemas against OpenAPI-derived fixtures
  (a contract can be wrong even if its tests pass), plus negative cases for
  missing mandatory fields.

QA phase (to apply in phase 4 - re-confirm before running):
- Codex flagged as CRITICAL that destructive create/update/delete on a SHARED
  QA instance is unsafe for singleton/global objects (CAs, storage, system
  configuration, password policies, scheduled tasks, triggers) because unique
  naming cannot isolate global side effects, and "guaranteed teardown" is not a
  guarantee across crashes/dependency-locked deletes. Even idempotent PUT on a
  singleton can trigger audit events, cache reloads, or restarts.
- Mitigations to present and confirm at phase 4: isolated tenant/instance or an
  explicit allowlist; snapshot/export before writes; serialize tests; pre/post
  inventory diff with hard-fail on leftover objects; out-of-band TTL cleanup;
  least-privilege test account. The user previously chose "full destructive on
  all"; this specific risk will be re-surfaced before any destructive QA runs.
- Add a NON-DESTRUCTIVE live contract-validation step first: attempt a create
  with a deliberately missing mandatory field against a disposable name and
  assert the API rejects it naming that field - confirms mandatory fields
  against live behavior without persisting anything.
