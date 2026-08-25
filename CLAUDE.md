# horizon-mcp

TypeScript MCP server for Evertrust Horizon - certificate lifecycle management, RBAC, discovery, and configuration.

## Quick Reference

```bash
bun run dev          # Start dev server (tsx)
bun run build        # Production build (tsup)
bun run test         # Unit tests (vitest)
bun run test:e2e     # E2E tests against live Horizon QA
bun run test:llm     # LLM evaluation tests
bun run lint         # ESLint + tsc --noEmit
bun run typecheck    # Type check only
```

**Before running E2E or LLM tests:** `source .env.local` for QA credentials.

## Architecture

```
src/
  index.ts              # Server entrypoint - serveStdio(factory)
  settings.ts           # HORIZON_* env vars -> validated HorizonSettings (Zod)
  logging.ts            # Structured logging
  server-factory.ts     # createSessionServer - builds one McpServer per serving unit
  http/                 # Streamable HTTP transport (stateless; no session layer)
    server.ts           # startHttpServer - Express + createMcpHandler + toNodeHandler
    config.ts           # HTTP-only cross-field validation of HorizonSettings
    credentials.ts      # Per-request credential extraction and fingerprinting
    credential-cache.ts # Single-flight, bounded, TTL cache of validated credentials
    semaphore.ts        # Global and per-credential concurrency caps
    middleware.ts       # Host/Origin validation and CORS
    headers.ts          # Sensitive-header scrubbing (parsed and raw)
    rate-limit.ts       # Per-credential request rate limiting
  auth/                 # Auth providers (API key, mTLS, Playwright OIDC)
    base.ts             # AuthProvider interface
    apikey.ts           # API key auth
    mtls.ts             # Mutual TLS auth
    play-session.ts     # Playwright-based OIDC session (deprecated path)
  client/
    http.ts             # HorizonClient - undici-based HTTP client
    client-helpers.ts   # Shared HorizonClient parsing and compatibility helpers
    errors.ts           # HorizonError hierarchy
    retry.ts            # Retry logic with backoff
  models/
    types.ts            # Shared TypeScript types
    enums.ts            # Horizon enums (modules, key types, etc.)
    payloads.ts         # Request/response payload builders
  resources/
    catalog.ts          # Knowledge resource catalog (17 core topics + 4 curated playbooks, plus generated section URIs)
    index.ts            # Thin registrar that wires the catalog into the MCP server
    knowledge/          # Embedded Horizon domain documentation (20 markdown files)
  tools/
    register.ts         # Shared registerTool helper that injects small-model guidance
    guidance.ts         # Per-tool "use when / do not use when" hints surfaced to the model
    helpers.ts          # Shared tool utilities (search presets, pagination, CSV)
    lifecycle.ts        # Certificate/request/event tools (17 tools)
    profiles.ts         # Profile listing/inspection tools (2 tools)
    dashboards.ts       # Dashboard and saved-query tools (12 tools)
    discovery.ts        # Discovery campaign tools (6 tools)
    discovery-events.ts # Discovery event tools (3 tools)
    discovery-feed.ts   # Discovery feed tools (4 tools)
    datasources.ts      # Datasource tools (8 tools)
    reports.ts          # Report generation tools (3 tools)
    triggers.ts         # Trigger/automation tools (6 tools)
    docs.ts             # Official product/API doc search and page fetch (3 tools)
    assist/
      system.ts         # whoami, license, server info
      query.ts          # translate_to_hql, validate_hql variants, field discovery
      crypto.ts         # decode_x509, decode_csr, decode_crl, etc.
      computation.ts    # Computation rule helpers
      translate.ts      # Field translation utilities
tests/
  unit/                 # Vitest unit tests (80%+ coverage threshold)
  e2e/                  # E2E tests against live Horizon QA instance
  llm-evaluation/       # LLM-in-the-loop eval scenarios
```

## Key Design Patterns

- **Factory registration:** Each tool domain exports `registerXxxTools(server, client)` - no globals
- **Immutable data:** Never mutate objects - always create new copies
- **Zod validation:** All API payloads validated with Zod schemas (v4.3.6)
- **Search presets:** `compact`, `diagnostic`, `compliance` field sets in helpers.ts
- **Knowledge resources:** Markdown docs embedded at build time via tsup `.md` loader

## Tech Stack

- **Runtime:** Node >= 24.10, developed with Bun
- **MCP SDK:** @modelcontextprotocol/{core,server,client,node} 2.0.0, serving protocol revision 2026-07-28 only (`legacy: 'reject'`). The v1 `@modelcontextprotocol/sdk` line is frozen at 1.30.0 and is not used.
- **HTTP:** undici 8.0.1 (custom Agent for mTLS support)
- **Validation:** Zod 4.3.6 (use two-arg `z.record()` - see commit 232924d)
- **Build:** tsup (library) / bun build --compile (standalone binary)
- **Test:** Vitest 4.1.2, Playwright 1.59.1 (optional, for OIDC auth)

## Horizon Domain Rules

These are critical for anyone working with the Horizon API:

1. **Immutable names** - Object names are primary keys, cannot change after creation
2. **Lowercase HQL** - All query field names are lowercase (contactemail, not contactEmail). camelCase causes HQL-001 parse errors. Exception: groupBy/sortedBy are camelCase (API context)
3. **Ownership queries** - Always call whoami first, then query both owner AND team
4. **Certificate lifecycle** - discovered -> monitored -> managed (one-way, module-based)
5. **PKCS#12 retrieval** - Available in the enrollment or recover REQUEST response, never on certificate object
6. **Service discovery** - Search dn, san, discoverydata.hostnames (also discoverydata.sources, discoverydata.ip). Note: discoverydata.paths and discoverydata.usages are NOT HCQL-searchable (HQL-001), they only appear on the get_certificate response object

## MCP Server

The `horizon` MCP server is configured in `.mcp.json`. Key tools:

- `whoami` - Get current user identity and teams (call before ownership queries)
- `search_certificates` / `search_requests` / `search_events` - HCQL/HRQL/HEQL search
- `fetch_exposed_certificate` - Check live TLS certificate on a remote server
- `decode_x509` / `decode_csr` / `decode_crl` - Parse cryptographic objects to structured JSON
- `get_request_template` - Required before `submit_request` to discover required fields

Knowledge resources are available at `horizon://knowledge/*` URIs: 17 core topics, 4 curated playbooks, and auto-generated section URIs for the longest guides (see `src/resources/catalog.ts`).

## Conventions

- No em-dashes in code or docs - use regular dashes
- Files < 800 lines, functions < 50 lines
- Validate inputs at system boundaries with Zod
- Handle errors explicitly - never swallow silently
- Commit messages: one-liner `type: description` format

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **horizon-mcp** (2392 symbols, 5424 relationships, 193 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/horizon-mcp/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/horizon-mcp/context` | Codebase overview, check index freshness |
| `gitnexus://repo/horizon-mcp/clusters` | All functional areas |
| `gitnexus://repo/horizon-mcp/processes` | All execution flows |
| `gitnexus://repo/horizon-mcp/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
