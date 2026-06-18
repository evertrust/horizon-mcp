# Development

## Setup

```bash
bun install
```

## Unit tests

```bash
bun test
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
