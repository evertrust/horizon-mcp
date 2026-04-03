/**
 * LLM evaluation setup - Claude Code subprocess helper and environment gating.
 *
 * All evaluation tests run via `claude -p` with the MCP server attached.
 * Required: Claude Code CLI (`claude`) on PATH + ANTHROPIC_API_KEY env var
 *           + HORIZON_E2E_* env vars for the live Horizon instance.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Environment gating
// ---------------------------------------------------------------------------

const E2E_URL = process.env['HORIZON_E2E_URL'] ?? '';
const E2E_API_ID = process.env['HORIZON_E2E_API_ID'] ?? '';
const E2E_API_KEY = process.env['HORIZON_E2E_API_KEY'] ?? '';
const HAS_API_KEY = Boolean(process.env['ANTHROPIC_API_KEY']);

export const LLM_EVAL_READY = Boolean(
  HAS_API_KEY && E2E_URL && E2E_API_ID && E2E_API_KEY,
);

export function skipReason(): string {
  if (!HAS_API_KEY) return 'ANTHROPIC_API_KEY not set';
  if (!E2E_URL || !E2E_API_ID || !E2E_API_KEY)
    return 'HORIZON_E2E_* env vars not set';
  return '';
}

// ---------------------------------------------------------------------------
// MCP config file management
// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

/** Path to the built MCP server entry point. */
function serverCommand(): string {
  return join(PROJECT_ROOT, 'dist', 'index.js');
}

let configPath: string | undefined;

/**
 * Create a temporary MCP config JSON pointing to the local horizon-mcp server.
 * Reuses the same file across the test session.
 */
export function getMcpConfigPath(): string {
  if (configPath) return configPath;

  const config = {
    mcpServers: {
      horizon: {
        command: 'node',
        args: [serverCommand()],
        env: {
          HORIZON_URL: E2E_URL,
          HORIZON_API_ID: E2E_API_ID,
          HORIZON_API_KEY: E2E_API_KEY,
        },
      },
    },
  };

  const filename = `horizon-mcp-eval-${randomUUID().slice(0, 8)}.json`;
  configPath = join(tmpdir(), filename);
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return configPath;
}

/** Remove the temporary config file. */
export function cleanupMcpConfig(): void {
  if (configPath && existsSync(configPath)) {
    unlinkSync(configPath);
    configPath = undefined;
  }
}

// ---------------------------------------------------------------------------
// Claude Code subprocess helper
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = process.env['HORIZON_LLM_EVAL_MODEL'] ?? 'sonnet';

export interface ClaudeResponse {
  readonly text: string;
  readonly raw: string;
  readonly exitCode: number;
}

/**
 * Run `claude -p` with the MCP server and return parsed output.
 *
 * @param question  - The prompt to send
 * @param options   - timeout (ms, default 120_000), model (default from env or "sonnet")
 */
export function askClaude(
  question: string,
  options: { timeout?: number; model?: string } = {},
): Promise<ClaudeResponse> {
  const { timeout = 120_000, model = DEFAULT_MODEL } = options;
  const mcpConfig = getMcpConfigPath();

  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      [
        '-p',
        question,
        '--output-format',
        'json',
        '--model',
        model,
        '--mcp-config',
        mcpConfig,
      ],
      { timeout, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, _stderr) => {
        // execFile sets error for non-zero exit codes AND timeouts.
        // For non-zero exits we still want to return the output.
        if (error && !('code' in error)) {
          reject(error);
          return;
        }

        const rawStdout = stdout.trim();
        let text: string;
        try {
          const parsed = JSON.parse(rawStdout) as Record<string, unknown>;
          const result = parsed['result'] ?? parsed['text'] ?? rawStdout;
          text = typeof result === 'string' ? result : String(result);
        } catch {
          text = rawStdout;
        }

        resolve({
          text: text.toLowerCase(),
          raw: text,
          exitCode: child.exitCode ?? (error ? 1 : 0),
        });
      },
    );
  });
}
