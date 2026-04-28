import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GitHub workflows', () => {
  it('does not reference secrets directly in if expressions', () => {
    const workflows = [
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
    ];

    for (const workflow of workflows) {
      const content = readFileSync(workflow, 'utf8');

      expect(content).not.toMatch(/if:\s*\$\{\{[^}\n]*secrets\./);
    }
  });
});
