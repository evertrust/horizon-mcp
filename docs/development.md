# Development

## Setup

```bash
bun install
```

## CI gates

Every PR runs the checks below (plus commitlint on the commit range - one-liner
`type: description` messages, header under 100 chars). The hosted docs-inventory
step is informational because docs.evertrust.fr publishes independently; all
other listed CI steps are blocking. Run the stricter full sequence locally
before pushing:

```bash
bun run validate:ci
```

| Gate | Command | Notes |
| ---- | ------- | ----- |
| Formatting | `bun run format:check` | Prettier over `src/` and `tests/` (includes markdown under `tests/`) |
| Lint | `bun run lint` | ESLint only |
| Typecheck | `bun run typecheck` | `tsc --noEmit` only |
| Build | `bun run build` | tsup production build |
| API truth | `bun run verify:truth` | Checks documented API claims against the recorded truth set |
| Docs inventory | `bun run docs:diff` | Blocking in local `validate:ci`, non-blocking in GitHub Actions; fix drift with `bun run docs:refresh` and commit `src/generated/docs/*.json` |
| Unit tests | `bun run test` | Includes golden snapshots of all tool schemas - adding or changing a tool requires updating `tests/unit/golden.test.ts` (tool count, `EXPECTED_TOOL_NAMES`, snapshot) |
| Scenario suite | `bun run test:scenarios` | Deterministic tool-selection scenarios; `tests/llm-evaluation/smoke.test.ts` asserts the exact total tool count |

## Unit tests

```bash
bun run test
```

Runs [vitest](https://vitest.dev/) on the full test suite (excluding E2E and LLM evaluation tests).

## E2E tests

Run against a live Horizon instance:

```bash
export HORIZON_E2E_URL=https://your-qa-instance.evertrust.io
export HORIZON_E2E_API_ID=your-api-id
export HORIZON_E2E_API_KEY=your-api-key
bun run test:e2e
```

## Linting and type checking

```bash
bun run lint        # eslint only
bun run typecheck   # tsc --noEmit only
```

## Build

```bash
bun run build              # tsup -> dist/index.js
bun run build:binary       # tsup + bun compile -> dist/horizon-mcp
```
