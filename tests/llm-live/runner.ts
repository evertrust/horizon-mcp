/**
 * Drive the Claude Agent SDK against a real, in-process Horizon MCP server
 * to observe which tools Claude selects for a given natural-language prompt.
 *
 * The SDK spawns the bundled `claude` binary as a subprocess, attaches the
 * MCP server over stdio, and streams assistant messages back. We inspect the
 * first `tool_use` blocks to assert tool selection without executing a full
 * agent loop.
 */
import {
  type Options,
  type SDKMessage,
  query,
} from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HORIZON_MCP_ENTRY = path.join(REPO_ROOT, 'src', 'index.ts');
const MCP_TOOL_PREFIX = 'mcp__horizon__';

export interface ScenarioRunResult {
  /** Horizon MCP tool calls only (Claude Code built-ins are excluded). */
  readonly toolCalls: readonly string[];
  /** Every tool call incl. Claude Code built-ins (ToolSearch/Bash/Skill/...). */
  readonly allToolCalls: readonly string[];
  readonly toolInputs: ReadonlyMap<string, Record<string, unknown>>;
  readonly turns: number;
  readonly totalCostUsd: number;
  readonly stopReason: string | null;
  readonly assistantText: string;
  readonly errors: readonly string[];
}

export interface RunScenarioOptions {
  readonly model?: string;
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
}

function buildMcpEnv(): Record<string, string> {
  const required = [
    'HORIZON_E2E_URL',
    'HORIZON_E2E_API_ID',
    'HORIZON_E2E_API_KEY',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Live LLM suite requires QA credentials in the environment: ${missing.join(', ')}. ` +
        'Source .env.local first.',
    );
  }
  return {
    HORIZON_URL: process.env['HORIZON_E2E_URL']!,
    HORIZON_API_ID: process.env['HORIZON_E2E_API_ID']!,
    HORIZON_API_KEY: process.env['HORIZON_E2E_API_KEY']!,
    HORIZON_LOG_LEVEL: process.env['HORIZON_LOG_LEVEL'] ?? 'warn',
  };
}

function stripMcpPrefix(toolName: string): string {
  return toolName.startsWith(MCP_TOOL_PREFIX)
    ? toolName.slice(MCP_TOOL_PREFIX.length)
    : toolName;
}

/**
 * Send a single natural-language prompt through the Claude Agent SDK and
 * collect the tool calls Claude attempted. Caps turns and USD budget so a
 * runaway loop cannot run up an unbounded Anthropic API bill (headless
 * `claude -p` runs are metered as API usage, even with a subscription).
 */
export async function runScenarioWithClaude(
  prompt: string,
  options: RunScenarioOptions = {},
): Promise<ScenarioRunResult> {
  const toolCalls: string[] = [];
  const allToolCalls: string[] = [];
  const toolInputs = new Map<string, Record<string, unknown>>();
  const assistantTextChunks: string[] = [];
  const errors: string[] = [];
  let turns = 0;
  let totalCostUsd = 0;
  let stopReason: string | null = null;

  const sdkOptions: Options = {
    model: options.model ?? 'claude-haiku-4-5',
    // Higher than the original (2 turns / $0.05): the server now exposes 200+
    // tools that Claude Code defers behind ToolSearch, so it spends a turn (and
    // tokens) discovering MCP tools before it can call one.
    maxTurns: options.maxTurns ?? 10,
    // Large list/doc-page responses (e.g. list_cas, search_api_docs ->
    // get_doc_page) push a single read-only scenario past $0.30.
    maxBudgetUsd: options.maxBudgetUsd ?? 0.5,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // SDK isolation mode: do NOT load the developer's filesystem settings
    // (~/.claude and project .claude). Otherwise the spawned `claude`
    // subprocess inherits the host's SessionStart hooks, skills, and CLAUDE.md
    // - we observed it emit "# Session Resumed - I've loaded the context from
    // your previous session" and skip the task entirely, and leak host builtins
    // like Monitor/ScheduleWakeup. The MCP server is wired via `mcpServers`
    // below, independent of this, so tool discovery is unaffected.
    settingSources: [],
    // Measure genuine MCP tool selection. A real MCP client (Claude Desktop,
    // an IDE, etc.) gives the model NO shell/filesystem/web/subagent escape
    // hatch - so to exercise a Horizon tool it must call that tool. Without
    // this denylist the SDK exposes Claude Code's builtins and (especially on
    // Haiku) the model answers "show me the PKI connector schema" by grepping
    // this repo's source, or "export events as CSV" by asking the user, never
    // touching the tool under test. ToolSearch stays enabled: the Horizon MCP
    // tools are deferred behind it and must remain discoverable.
    disallowedTools: [
      'Bash',
      'BashOutput',
      'KillShell',
      'Read',
      'Edit',
      'Write',
      'NotebookEdit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'Task',
      'Agent',
      'AskUserQuestion',
      'Skill',
      // Scheduler/orchestration builtins that must never substitute for a
      // Horizon tool call (observed leaking even under isolation).
      'TodoWrite',
      'Monitor',
      'ScheduleWakeup',
      'TaskCreate',
      'TaskGet',
      'TaskList',
      'TaskOutput',
      'TaskStop',
      'TaskUpdate',
      'CronCreate',
      'CronDelete',
      'CronList',
    ],
    mcpServers: {
      horizon: {
        command: 'bun',
        args: ['run', HORIZON_MCP_ENTRY],
        env: buildMcpEnv(),
      },
    },
  };

  const q = query({ prompt, options: sdkOptions });

  try {
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (msg.type === 'assistant' && msg.message?.content) {
        if (msg.error) errors.push(`assistant_error:${msg.error}`);
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            const isMcp = block.name.startsWith(MCP_TOOL_PREFIX);
            const display = stripMcpPrefix(block.name);
            allToolCalls.push(isMcp ? display : `<builtin:${display}>`);
            // Only Horizon MCP tools count for tool-selection assertions; the
            // SDK's own ToolSearch/Bash/Skill scaffolding is recorded for debug.
            if (isMcp) {
              toolCalls.push(display);
              toolInputs.set(
                display,
                (block.input ?? {}) as Record<string, unknown>,
              );
            }
          } else if (block.type === 'text') {
            assistantTextChunks.push(block.text);
          }
        }
      } else if (msg.type === 'result') {
        turns = msg.num_turns;
        totalCostUsd = msg.total_cost_usd;
        stopReason = msg.stop_reason;
        if (msg.subtype === 'error_max_budget_usd') {
          errors.push('budget_exceeded');
        }
        break;
      }
    }
  } finally {
    q.close();
  }

  return {
    toolCalls,
    allToolCalls,
    toolInputs,
    turns,
    totalCostUsd,
    stopReason,
    assistantText: assistantTextChunks.join('\n'),
    errors,
  };
}
