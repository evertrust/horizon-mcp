import { describe, expect, it } from 'vitest';

import { loadScenarioMetadata, rankTools } from './setup.js';

describe('Provider-agnostic scenario smoke tests', () => {
  it('loads tool and resource metadata without external model dependencies', async () => {
    const metadata = await loadScenarioMetadata();

    // 241 total tools: 107 base tools + 134 configuration CRUD tools.
    expect(metadata.tools.length).toBe(241);
    // 111 total resources: 18 core guides, 4 curated playbooks, 89 sections.
    expect(metadata.resources.length).toBe(111);
  });

  it('ranks documentation search above raw page fetch for configuration prompts', async () => {
    const ranked = await rankTools(
      'How do I configure the ADCS connector in Horizon?',
    );

    const searchIndex = ranked.findIndex(
      ({ item }) => item.name === 'search_docs',
    );
    const pageIndex = ranked.findIndex(
      ({ item }) => item.name === 'get_doc_page',
    );

    expect(searchIndex).toBeGreaterThanOrEqual(0);
    expect(pageIndex).toBeGreaterThanOrEqual(0);
    expect(searchIndex).toBeLessThan(pageIndex);
  });
});
