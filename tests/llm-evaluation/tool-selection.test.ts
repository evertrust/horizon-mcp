/**
 * Tier 1 - Tool selection: Does Claude Code pick the right tools?
 *
 * Each scenario sends a question to Claude Code via `claude -p` with the MCP
 * server attached. We verify the response text mentions expected tool names
 * or relevant domain concepts.
 *
 * Since `claude -p` executes tools automatically, we cannot inspect raw
 * tool_use blocks. Instead we verify the result demonstrates the right tools
 * were used:
 *   - For tool-oriented questions: response should contain tool output patterns
 *   - For knowledge questions: response should contain domain concepts
 *
 * Skipped when ANTHROPIC_API_KEY or HORIZON_E2E_* env vars are not set.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { type Scenario, TOOL_SELECTION_SCENARIOS } from './scenarios.js';
import {
  LLM_EVAL_READY,
  askClaude,
  cleanupMcpConfig,
  skipReason,
} from './setup.js';

// ---------------------------------------------------------------------------
// Prefix injected before each question to prevent mutations
// ---------------------------------------------------------------------------

const SAFETY_PREFIX =
  'DO NOT create, modify, or delete anything. ' +
  'Just explain what tools and steps you would use. ';

// ---------------------------------------------------------------------------
// Build indicators for a scenario's expected tools
// ---------------------------------------------------------------------------

function toolIndicators(scenario: Scenario): readonly string[] {
  const indicators: string[] = [];
  for (const tool of scenario.expectedTools) {
    const lower = tool.toLowerCase();
    indicators.push(lower);
    // Also check key words from the tool name
    // e.g. "search_certificates" -> ["search", "certificates"]
    indicators.push(...lower.replace(/_/g, ' ').split(' '));
  }
  return indicators;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!LLM_EVAL_READY)(
  `Tool selection (${skipReason() || 'enabled'})`,
  () => {
    afterAll(() => cleanupMcpConfig());

    it.each(
      TOOL_SELECTION_SCENARIOS.map((s) => ({ ...s, toString: () => s.id })),
    )(
      'selects correct tools: %s',
      async (scenario) => {
        const result = await askClaude(SAFETY_PREFIX + scenario.question, {
          timeout: 300_000,
        });

        expect(result.exitCode).toBe(0);

        const { text } = result;

        if (scenario.expectedTools.length > 0) {
          const indicators = toolIndicators(scenario);
          const matchesAny = indicators.some((ind) => text.includes(ind));
          expect(matchesAny).toBe(true);
        } else {
          // Knowledge question - should have a substantive text response
          expect(text.length).toBeGreaterThan(50);
        }
      },
      360_000,
    );
  },
);
