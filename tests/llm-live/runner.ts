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
  readonly toolCalls: readonly string[];
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
 * runaway loop cannot drain a subscription credit.
 */
export async function runScenarioWithClaude(
  prompt: string,
  options: RunScenarioOptions = {},
): Promise<ScenarioRunResult> {
  const toolCalls: string[] = [];
  const toolInputs = new Map<string, Record<string, unknown>>();
  const assistantTextChunks: string[] = [];
  const errors: string[] = [];
  let turns = 0;
  let totalCostUsd = 0;
  let stopReason: string | null = null;

  const sdkOptions: Options = {
    model: options.model ?? 'claude-haiku-4-5',
    maxTurns: options.maxTurns ?? 2,
    maxBudgetUsd: options.maxBudgetUsd ?? 0.05,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
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
            toolCalls.push(stripMcpPrefix(block.name));
            toolInputs.set(
              stripMcpPrefix(block.name),
              (block.input ?? {}) as Record<string, unknown>,
            );
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
    toolInputs,
    turns,
    totalCostUsd,
    stopReason,
    assistantText: assistantTextChunks.join('\n'),
    errors,
  };
}
