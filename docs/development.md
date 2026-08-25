# Development

## Setup

```bash
bun install
```

## Documentation language

Write user-facing technical documentation in [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/). Apply these rules to new and changed text:

- Use American English spelling.
- Use one term for one item or action.
- Use the active voice.
- Give one instruction in each procedural sentence.
- Use no more than 20 words in a procedural sentence.
- Use no more than 25 words in a descriptive sentence.
- Put one topic in each paragraph.
- Use a vertical list for complex information.

Use product names, protocol names, configuration names, and HTTP header names as approved technical terms. Examples include Horizon, MCP, OAuth, JWT, and `HORIZON_URL`.

## CI gates

Every PR runs the checks below (plus commitlint on the commit range - one-liner
`type: description` messages, header under 100 chars). The hosted docs-inventory
step is informational because docs.evertrust.fr publishes independently; all
other listed CI steps are blocking. Run the stricter full sequence locally
before pushing:

```bash
bun run validate:ci
```

| Gate           | Command                  | Notes                                                                                                                                                                 |
| -------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting     | `bun run format:check`   | Prettier over `src/` and `tests/` (includes markdown under `tests/`)                                                                                                  |
| Lint           | `bun run lint`           | ESLint only                                                                                                                                                           |
| Typecheck      | `bun run typecheck`      | `tsc --noEmit` only                                                                                                                                                   |
| Build          | `bun run build`          | tsup production build                                                                                                                                                 |
| API truth      | `bun run verify:truth`   | Checks documented API claims against the recorded truth set                                                                                                           |
| Docs inventory | `bun run docs:diff`      | Blocking in local `validate:ci`, non-blocking in GitHub Actions; fix drift with `bun run docs:refresh` and commit `src/generated/docs/*.json`                         |
| Unit tests     | `bun run test`           | Includes golden snapshots of all tool schemas - adding or changing a tool requires updating `tests/unit/golden.test.ts` (tool count, `EXPECTED_TOOL_NAMES`, snapshot) |
| Scenario suite | `bun run test:scenarios` | Deterministic tool-selection scenarios; `tests/llm-evaluation/smoke.test.ts` asserts the exact total tool count                                                       |

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

# Required only by service-account.e2e.test.ts
export HORIZON_E2E_SVA=your-service-account-name
export HORIZON_E2E_SVA_TOKEN=your-service-account-jwt
bun run test:e2e
```

The service-account suite prints a skip notice when either service-account
variable is unset. Ask the QA operator to provision both values before running
that suite.

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
