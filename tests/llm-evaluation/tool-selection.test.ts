import { describe, expect, it } from 'vitest';

import { TOOL_SELECTION_SCENARIOS } from './scenarios.js';
import { getToolSchemaParamNames, rankResources, rankTools } from './setup.js';

function topNames(
  ranked: Array<{ item: { name?: string; uri?: string }; score: number }>,
  count = 8,
): string[] {
  return ranked
    .slice(0, count)
    .map(({ item }) => item.name ?? item.uri ?? '<unknown>');
}

describe('Provider-agnostic tool selection', () => {
  it.each(
    TOOL_SELECTION_SCENARIOS.map((scenario) => ({
      ...scenario,
      toString: () => scenario.id,
    })),
  )('ranks the right tools and resources for %s', async (scenario) => {
    const rankedTools = await rankTools(scenario.question);

    for (const toolName of scenario.expectedPrimaryTools) {
      const index = rankedTools.findIndex(({ item }) => item.name === toolName);
      expect(
        index,
        `Expected primary tool '${toolName}' in top ${scenario.primaryMaxRank}. ` +
          `Top candidates: ${topNames(rankedTools).join(', ')}`,
      ).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(scenario.primaryMaxRank);
    }

    for (const toolName of scenario.expectedSupportTools ?? []) {
      const index = rankedTools.findIndex(({ item }) => item.name === toolName);
      expect(
        index,
        `Expected support tool '${toolName}' in top ${scenario.supportMaxRank}. ` +
          `Top candidates: ${topNames(rankedTools, 12).join(', ')}`,
      ).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(scenario.supportMaxRank ?? 10);
    }

    for (const toolName of scenario.disallowedTools ?? []) {
      const index = rankedTools.findIndex(({ item }) => item.name === toolName);
      if (index === -1 || scenario.expectedPrimaryTools.length === 0) continue;

      const firstPrimary = rankedTools.findIndex(
        ({ item }) => item.name === scenario.expectedPrimaryTools[0],
      );
      expect(
        index,
        `Disallowed tool '${toolName}' outranked the intended tool. ` +
          `Top candidates: ${topNames(rankedTools, 12).join(', ')}`,
      ).toBeGreaterThan(firstPrimary);
    }

    for (const [toolName, args] of Object.entries(
      scenario.requiredArgs ?? {},
    )) {
      const params = await getToolSchemaParamNames(toolName);
      for (const arg of args) {
        expect(
          params.has(arg),
          `Tool '${toolName}' should expose arg '${arg}'`,
        ).toBe(true);
      }
    }

    if ((scenario.expectedResourceUris?.length ?? 0) > 0) {
      const rankedResources = await rankResources(scenario.question);
      for (const uri of scenario.expectedResourceUris ?? []) {
        const index = rankedResources.findIndex(({ item }) => item.uri === uri);
        expect(
          index,
          `Expected resource '${uri}' in top ${scenario.resourceMaxRank}. ` +
            `Top resources: ${topNames(rankedResources, 12).join(', ')}`,
        ).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(scenario.resourceMaxRank ?? 10);
      }
    }
  });
});
