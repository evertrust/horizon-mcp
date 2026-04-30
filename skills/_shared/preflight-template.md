# Phase 0 - Preflight (MANDATORY)

This phase is imported by every setup skill. Do not skip steps. Do not paraphrase the tool calls.

## 0.1 Capture user identity and license

Call the `whoami` tool. From the returned object capture:

- `userId` (string)
- `teams` (string array)
- `licensedModules` (string array; from the `license.modules` field if present, otherwise from `get_license_info`)
- `horizonVersion` (string; from the `instance.version` field if present, otherwise unknown)

If `whoami` returns an error, STOP. Tell the user that the preflight could not authenticate against the Horizon instance configured for the `horizon` MCP server, ask them to verify the `HORIZON_URL`, `HORIZON_API_ID`, `HORIZON_API_KEY` (or mTLS credentials) of the MCP server, then exit. Do not advance to Phase 1.

## 0.2 Verify the licensed modules

Each setup skill lists the Horizon modules it requires (for example, `webra` and `intune` for setup-intune). The skill MUST cross-check these against `licensedModules`. If any required module is missing from the license, STOP. Tell the user the exact module that is missing, point them at their account manager, and exit. Do not advance to Phase 1.

## 0.3 Verify knowledge resource reachability

For every `horizon://knowledge/<name>` URI listed in the skill's "Knowledge resources reused" line, attempt `ReadMcpResourceTool({uri: "horizon://knowledge/<name>"})`. If any URI fails to resolve, STOP. Report the failing URI to the user and ask whether the `horizon` MCP server is healthy. Do not advance to Phase 1.

## 0.4 Record context for later phases

Print a short summary the user can copy/paste:

```
Horizon: <horizonVersion or unknown>
User: <userId>
Teams: <teams joined with ", ">
Licensed modules: <licensedModules joined with ", ">
Knowledge resources OK: <count>/<total>
```

Then advance to Phase 1.

## Notes

- Never call mutating tools in Phase 0.
- Never collect prerequisites in Phase 0; that happens in Phase 2 only.
- Phase 0 is read-only. The fail-closed semantics above are deliberate: if any check fails, Phases 1-6 cannot run safely on this instance.
