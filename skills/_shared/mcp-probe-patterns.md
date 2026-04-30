# MCP / Skill / Knowledge Probe Patterns

Phase 1 of every setup skill probes the live session for complementary capabilities. The skill MUST run the regex matches below against the names of every tool currently exposed in the session and record hits in a `discoveredCapabilities` list.

## Probe regexes (case-insensitive, JavaScript flavor)

| Skill | Regex |
|-------|-------|
| setup-adcs | `^mcp__.*(microsoft\|adcs\|active.?directory\|windows.?server).*` |
| setup-intune | `^mcp__.*(microsoft\|graph\|entra\|azure\|m365\|intune).*` |
| setup-digicert | `^mcp__.*digicert.*` |
| setup-f5 | `^mcp__.*(f5\|icontrol\|bigip\|big.?ip).*` |

## Pseudocode

```ts
function probeCapabilities(skillRegex: RegExp, availableTools: string[]): string[] {
  return availableTools.filter((toolName) => skillRegex.test(toolName));
}
```

`availableTools` is the list provided by the host (Claude Code surfaces this via the system prompt and the deferred-tool index; Codex surfaces it via the agent runtime tool registry).

## Hit / no-hit semantics

- **Hit**: the skill MUST mention each matched tool by name to the user, ask whether to use it for the relevant phase, and only proceed once the user confirms.
- **No hit**: the skill falls back to the embedded knowledge plus UI walkthrough. It MUST NOT pretend a capability exists.

## Skill-level skill probes (optional)

When the skill registry is exposed to the host (Codex `list_skills`, Claude Code skill catalog), the skill MAY probe for adjacent skills with names matching `setup-*` or vendor-specific helpers. Hits are surfaced to the user as suggestions only; the skill MUST NOT delegate execution to a skill it has not been explicitly told to call.

## Knowledge resource probes

In addition to the MCP tool probe, every skill calls `ReadMcpResourceTool` for each `horizon://knowledge/*` URI in its inventory row during Phase 0.4. A failure to resolve a knowledge URI is treated as a hard preflight failure and stops the skill.
