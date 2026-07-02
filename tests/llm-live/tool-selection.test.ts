/**
 * Live LLM tool-selection tests. Drives the real Claude Agent SDK against the
 * local Horizon MCP server.
 *
 * COSTS MONEY: headless `claude -p` / Agent SDK runs are billed as Anthropic
 * API usage now, even with a Pro/Max subscription session. This suite is
 * opt-in and paid - run it deliberately, never in CI or by default. Config
 * scenarios here are read-only (list/describe); mutating-tool selection is
 * covered for free in tests/llm-evaluation/.
 *
 * Skipped automatically when:
 *   - `claude` binary is not on PATH
 *   - ANTHROPIC_API_KEY is set (refuses an explicit API key)
 *   - HORIZON_E2E_* env vars are missing
 *
 * Run manually with: `source .env.local && bun run test:llm:live`
 */
import { describe, expect, it } from 'vitest';

import { liveSuiteEnabled, liveSuiteSkipReason } from './auth.js';
import { runScenarioWithClaude } from './runner.js';
import { LIVE_SCENARIOS } from './scenarios.js';

const HAS_E2E_CREDS =
  Boolean(process.env['HORIZON_E2E_URL']) &&
  Boolean(process.env['HORIZON_E2E_API_ID']) &&
  Boolean(process.env['HORIZON_E2E_API_KEY']);

const SKIP = !liveSuiteEnabled() || !HAS_E2E_CREDS;
const SKIP_REASON = !liveSuiteEnabled()
  ? liveSuiteSkipReason()
  : 'HORIZON_E2E_* env vars are not set (source .env.local first)';

describe.skipIf(SKIP)(
  `Live LLM tool selection (model = ${process.env['HORIZON_LLM_LIVE_MODEL'] ?? 'claude-haiku-4-5'})`,
  () => {
    if (SKIP) {
      it(`is skipped: ${SKIP_REASON}`, () => {
        expect(true).toBe(true);
      });
      return;
    }

    it.each(
      LIVE_SCENARIOS.map((scenario) => ({
        ...scenario,
        toString: () => scenario.id,
      })),
    )(
      'Claude selects the right tool for %s',
      async (scenario) => {
        const result = await runScenarioWithClaude(scenario.question, {
          model: process.env['HORIZON_LLM_LIVE_MODEL'] ?? 'claude-haiku-4-5',
          maxBudgetUsd: scenario.maxBudgetUsd,
          // Stop as soon as the expected tool is selected: the assertion only
          // inspects the first acceptable primary tool and its preceders, so
          // running the full multi-turn answer just adds latency (and cost)
          // and makes long scenarios flaky under the suite's parallel load.
          stopWhenToolCalled: scenario.acceptablePrimaryTools,
        });

        expect(
          result.errors,
          `SDK reported errors: ${result.errors.join(', ')}`,
        ).toEqual([]);

        expect(
          result.toolCalls.length,
          `Claude called no Horizon MCP tool (full sequence: ` +
            `${result.allToolCalls.join(' -> ') || 'none'}). ` +
            `Assistant said: ${result.assistantText.slice(0, 300)}`,
        ).toBeGreaterThan(0);

        // The expected primary tool must be REACHED. Only benign read-only
        // discovery tools (list/get/search/describe/validate/whoami/aggregate)
        // may precede it - Claude must not flail into an unrelated mutating or
        // off-topic action first. (Claude Code built-ins are already excluded.)
        const isDiscovery = (n: string): boolean =>
          /^(list_|get_|search_|describe_|validate_)/.test(n) ||
          n === 'whoami' ||
          n === 'aggregate_certificates' ||
          n === 'aggregate_requests';

        const primaryIndex = result.toolCalls.findIndex((name) =>
          scenario.acceptablePrimaryTools.includes(name),
        );
        expect(
          primaryIndex,
          `None of ${JSON.stringify(scenario.acceptablePrimaryTools)} was called. ` +
            `Full call sequence (incl. built-ins): ${result.allToolCalls.join(' -> ')}`,
        ).toBeGreaterThanOrEqual(0);

        const precedingNonDiscovery = result.toolCalls
          .slice(0, primaryIndex)
          .filter((n) => !isDiscovery(n));
        expect(
          precedingNonDiscovery,
          `Non-discovery tool(s) called before the primary. ` +
            `Sequence: ${result.allToolCalls.join(' -> ')}`,
        ).toEqual([]);

        const primaryTool = result.toolCalls[primaryIndex]!;
        for (const forbidden of scenario.forbiddenTools ?? []) {
          const forbiddenIndex = result.toolCalls.indexOf(forbidden);
          if (forbiddenIndex !== -1 && forbiddenIndex < primaryIndex) {
            expect.fail(
              `Forbidden tool '${forbidden}' called before the primary. ` +
                `Sequence: ${result.allToolCalls.join(' -> ')}`,
            );
          }
        }

        if (scenario.requiredArgs && scenario.requiredArgs.length > 0) {
          const args = result.toolInputs.get(primaryTool) ?? {};
          for (const arg of scenario.requiredArgs) {
            expect(
              Object.prototype.hasOwnProperty.call(args, arg),
              `Primary tool '${primaryTool}' was missing required arg '${arg}'. ` +
                `Args provided: ${JSON.stringify(args)}`,
            ).toBe(true);
          }
        }

        console.log(
          `[${scenario.id}] cost=$${result.totalCostUsd.toFixed(4)} ` +
            `turns=${result.turns} mcp=[${result.toolCalls.join(', ')}] ` +
            `all=[${result.allToolCalls.join(' -> ')}]`,
        );
      },
      // Wall-clock cap. Doc-heavy scenarios (api-docs-flow) read large pages and
      // can run past two minutes once given a higher per-scenario budget.
      240_000,
    );
  },
);
