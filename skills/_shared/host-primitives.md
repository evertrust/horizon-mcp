# Host Primitives Mapping

Setup skills are authored to be host-neutral. This mapping documents how each generic primitive used in `SKILL.md` is realized in Claude Code and in Codex.

| Generic primitive | Claude Code realization | Codex realization |
|-------------------|--------------------------|-------------------|
| Question primitive | `AskUserQuestion` tool | `prompt_user` agent function (declared in `agents/openai.yaml`) |
| Tool call primitive | direct call to the registered MCP tool by name | call to the same MCP tool via the OpenAI tool-call interface |
| Confirmation prompt for mutating tools | print plain text `Proceed? (yes/no)` and read the next user message | print plain text `Proceed? (yes/no)` and read the next user message |
| File read primitive | `Read` tool | OpenAI agent file-read function |
| Resource read primitive | `ReadMcpResourceTool` | OpenAI agent MCP resource-read function |

## Confirmation pattern (verbatim)

When a mutating MCP tool is about to be called, the skill MUST print:

```
About to call mutating tool `<tool_name>` with arguments:

```json
<pretty-printed args>
```

Proceed? (yes/no)
```

If the user replies anything other than `yes` (case-insensitive, leading/trailing whitespace ignored), the skill MUST skip the call and ask whether to retry, edit the arguments, or abort.

## Sensitive value handling (verbatim)

Sensitive prerequisites (those marked `sensitive: true` in `prerequisites.yaml`) MUST never appear in skill-produced output. Use the placeholder `<KEY_NAME>` in any printed argument summary or transcript. Example:

```
About to call mutating tool `create_rest_notification` with arguments:

```json
{
  "name": "<F5_TRIGGER_NAME>",
  "credential": "<F5_CREDENTIAL_NAME>",
  "headers": {"Authorization": "Bearer <F5_API_TOKEN>"}
}
```
```

Even if the actual call uses the resolved value, the printed summary always uses the placeholder.
