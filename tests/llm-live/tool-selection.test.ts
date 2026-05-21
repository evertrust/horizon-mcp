/**
 * Live LLM tool-selection tests. Drives the real Claude Agent SDK against the
 * local Horizon MCP server using the user's Claude subscription credit.
 *
 * Skipped automatically when:
 *   - `claude` binary is not on PATH
 *   - ANTHROPIC_API_KEY is set (we refuse to run against API billing here)
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
        });

        expect(
          result.errors,
          `SDK reported errors: ${result.errors.join(', ')}`,
        ).toEqual([]);

        expect(
          result.toolCalls.length,
          `Claude did not call any tool. Assistant said: ${result.assistantText.slice(0, 300)}`,
        ).toBeGreaterThan(0);

        const firstTool = result.toolCalls[0]!;
        expect(
          scenario.acceptablePrimaryTools,
          `First tool '${firstTool}' is not in ${JSON.stringify(scenario.acceptablePrimaryTools)}. ` +
            `Full call sequence: ${result.toolCalls.join(' -> ')}`,
        ).toContain(firstTool);

        for (const forbidden of scenario.forbiddenTools ?? []) {
          const forbiddenIndex = result.toolCalls.indexOf(forbidden);
          const firstPrimaryIndex = result.toolCalls.findIndex((name) =>
            scenario.acceptablePrimaryTools.includes(name),
          );
          if (forbiddenIndex !== -1 && forbiddenIndex < firstPrimaryIndex) {
            expect.fail(
              `Forbidden tool '${forbidden}' called before any acceptable primary. ` +
                `Sequence: ${result.toolCalls.join(' -> ')}`,
            );
          }
        }

        if (scenario.requiredArgs && scenario.requiredArgs.length > 0) {
          const args = result.toolInputs.get(firstTool) ?? {};
          for (const arg of scenario.requiredArgs) {
            expect(
              Object.prototype.hasOwnProperty.call(args, arg),
              `First tool '${firstTool}' was missing required arg '${arg}'. ` +
                `Args provided: ${JSON.stringify(args)}`,
            ).toBe(true);
          }
        }

        console.log(
          `[${scenario.id}] cost=$${result.totalCostUsd.toFixed(4)} ` +
            `turns=${result.turns} tools=[${result.toolCalls.join(', ')}]`,
        );
      },
      120_000,
    );
  },
);
