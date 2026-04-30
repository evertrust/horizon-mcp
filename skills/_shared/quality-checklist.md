# Production-Grade Quality Checklist

Every setup skill is verified against EVERY item below before being considered complete. This checklist also gates future setup skills added to this directory.

1. SKILL.md frontmatter contains exactly these six keys: `name`, `description`, `when_to_use`, `version`, `requires_mcp`, `tags`. All values are populated. No additional keys.
2. SKILL.md is under 800 lines.
3. SKILL.md links to `references/recipe.md`, `references/prerequisites.yaml`, `references/troubleshooting.md`. Each file exists at the canonical path.
4. `agents/openai.yaml` exists, valid YAML, schema = `openai-skill-agent/v1`. References `./SKILL.md`, `./references/recipe.md`, `./references/prerequisites.yaml`, `./references/troubleshooting.md`. The `model` field is hard-set, never deferred.
5. `references/recipe.md` exists, contains all 8 sections in this exact order: top heading, `## Architecture summary`, `## External system prerequisites`, `## Horizon prerequisites`, `## External system setup steps`, `## Horizon setup steps`, `## Verification`, `## Common failure points`. No private Outline URLs.
6. `references/prerequisites.yaml` exists and validates against `_shared/prerequisites-schema.md`. Every entry has `key`, `description`, `required`, `sensitive`. Optional entries also have `default`. `validator` is provided wherever applicable.
7. `references/troubleshooting.md` exists, three-column table: `Problem | Possible Cause | Solution`.
8. Phase 0 calls `whoami`, `get_license_info`, and `ReadMcpResourceTool` for every `horizon://knowledge/*` URI listed in the skill's row of the inventory table.
9. Phase 1 contains the regex probes from `_shared/mcp-probe-patterns.md` and records `discoveredCapabilities`.
10. Phase 2 asks every `required: true` prerequisite via `AskUserQuestion` (or the host equivalent). The skill body explicitly refuses to advance until every required value is captured.
11. Phase 4 verifies every Horizon write action with the corresponding existing read tool (`list_credentials`, `list_profiles`, `get_profile`, `list_triggers`, `list_datasources`, `list_dashboards`, `search_certificates`, `search_events`, `search_discovery_events`).
12. Every variant choice (for example `evtadcs` vs `msadcs`, `intune` vs `intunepkcs`, `f5client` vs `f5as3`, `US` vs `EU`) is gated by an explicit `AskUserQuestion`.
13. Every immutable name prerequisite collects both `<NAME>` and `<DISPLAY_NAME>`, per the Horizon API rule that names are primary keys.
14. Connector type, trigger type, third-party connector type, and module strings used in the skill match `src/models/enums.ts` byte-for-byte. No fabrication.
15. The skill ends with a "Missing MCP Tools" section that is a strict subset of `_shared/tool-gap-signaling.md`.
16. No em-dashes anywhere in the skill files. Use a regular hyphen or rephrase the sentence.
17. Every HCQL/HRQL/HEQL/HDQL/HPQL example uses lowercase field names. The skill explicitly mentions the lowercase rule near its first query example.
18. Idempotent: every write step first runs the matching `list_*` or `get_*` to detect existing objects and offers `reuse / rename / abort`.
19. Every mutating MCP tool call (annotated `Safety tier: mutating` in its source description; `simulate_trigger` is read-only and exempt) is preceded by a printed confirmation showing tool name, arguments, and `Proceed? (yes/no)`.
20. The skill makes NO references to "as you saw earlier" or other inter-step memory. Each phase is independently re-readable by a small model.
21. The skill's `description` field includes the `setup:<short>` colon-form trigger phrase even though the folder cannot.
22. The skill content has no remote URLs except: (a) `horizon://knowledge/*`, (b) public vendor docs (Microsoft Learn, DigiCert dev docs glossary, F5 iControl REST docs).
23. The skill never references `evertrust.getoutline.com`.
24. `manifest.json` includes the skill with the exact `id`, `description`, `tags`, `requires_mcp`, `version` from the inventory table.
25. The skill is added to the `skills/README.md` index. Sensitive prerequisites (`sensitive: true`) are not echoed in any skill output, summary, or transcript.
