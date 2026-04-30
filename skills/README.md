# Horizon Setup Skills

Production-grade setup recipes that walk a user end-to-end through integrating Evertrust Horizon CLM with a third-party system. Each skill is a deterministic, plug-and-play walkthrough designed to be safe for less capable models (Claude Sonnet/Haiku, GPT mini/nano).

These skills ship from this repository and are designed to be packaged later as a plugin for both Claude Code and Codex.

## What lives here

- `skills/setup-adcs/` - Microsoft ADCS connector setup (`evtadcs` and `msadcs` variants).
- `skills/setup-intune/` - Microsoft Intune integration (`intune` SCEP and `intunepkcs` variants).
- `skills/setup-digicert/` - DigiCert CertCentral connector setup (US and EU regions).
- `skills/setup-f5/` - F5 BIG-IP technical user provisioning, lifecycle automation, and discovery.

Every skill is a five-file bundle:

```
skills/<id>/
  SKILL.md                       # main entrypoint with frontmatter and 7 phases
  agents/openai.yaml             # Codex agent file (Claude Code ignores this)
  references/recipe.md           # full recipe content for offline reading
  references/prerequisites.yaml  # machine-readable prerequisites (drives Phase 2)
  references/troubleshooting.md  # symptom / cause / fix table
```

Shared scaffolding lives under `skills/_shared/` and is imported by reference from every skill:

- `preflight-template.md` - Phase 0 boilerplate.
- `quality-checklist.md` - 25 items that every skill is verified against.
- `tool-gap-signaling.md` - master union list of missing MCP tools.
- `host-primitives.md` - Claude vs Codex primitive mapping.
- `mcp-probe-patterns.md` - probe regexes for complementary MCPs.
- `prerequisites-schema.md` - YAML schema for `references/prerequisites.yaml`.

## How to invoke

### Claude Code

Type the slash form of any trigger phrase, for example `/setup-adcs`, `/setup-intune`, `/setup-digicert`, `/setup-f5`. The skill is invoked via the `Skill` tool. Frontmatter `description` and `tags` carry the trigger phrase synonyms.

### Codex

Use the colon form, for example `setup:adcs`, `setup:intune`, `setup:digicert`, `setup:f5`. The agent definition lives in `<id>/agents/openai.yaml` and points at `SKILL.md` as the system prompt.

### Generic instruction

If your host does not understand either form, ask the model to "set up <target>" or "configure <target> on Horizon" and the skill description matches that natural language too.

## Relationship to `.claude/skills/`

The pre-existing `.claude/skills/*` tree (for example `add-tool.md`, `gitnexus/*`) holds Claude-Code-only authoring helpers used by repository contributors. It is intentionally kept separate from `skills/` because:

- `.claude/skills/` targets developers editing this repo.
- `skills/` targets end users running an integration walkthrough against their Horizon instance.

Both trees are kept; do not merge them.

## Running the verification suite

```bash
bun run verify:skills   # frontmatter, YAML schema, recipe headings, manifest, allowlist
bun run lint:skills     # YAML and Markdown lint
```

`bun run validate:ci` runs both alongside the existing CI checks.

## Production-grade quality checklist

Every skill is verified against `_shared/quality-checklist.md` before being merged. New skills MUST tick every box.

## Plugin packaging

`manifest.json` enumerates every skill with the metadata required by the future Claude / Codex plugin packagers. To override the OpenAI agent model used by Codex at install time, the packager reads the `--model=<id>` flag and rewrites every `agents/openai.yaml` in place.

## Authoring a new setup skill

1. Add a folder `skills/setup-<name>/` with the canonical five-file layout.
2. Append a corresponding `tags` row in `_shared/mcp-probe-patterns.md`.
3. Append a manifest entry in `manifest.json`.
4. Append a row in this README's "What lives here" list.
5. Tick every item in `_shared/quality-checklist.md` before opening the PR.
6. Run `bun run verify:skills && bun run lint:skills`.
