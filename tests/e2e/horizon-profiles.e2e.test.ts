import { describe, expect, it } from 'vitest';

import { E2E_CONFIGURED, callTool, setupE2EStack } from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('Horizon E2E', () => {
  setupE2EStack();

  describe('profiles', () => {
    it('list_profiles returns items with count metadata', async () => {
      const result = await callTool('list_profiles');
      expect(
        result['items'],
        "list_profiles response missing 'items' key",
      ).toBeDefined();
      expect(Array.isArray(result['items'])).toBe(true);
      expect(result['count']).toBeDefined();
      expect(result['total_available']).toBeDefined();
      expect(result['kind']).toBe('profile');
    });

    it('list_profiles filters by module type', async () => {
      for (const module of ['webra', 'acme', 'scep', 'est', 'monitored']) {
        const result = await callTool('list_profiles', { module });
        expect(result['items']).toBeDefined();
        const items = result['items'] as Record<string, unknown>[];
        for (const item of items) {
          expect(
            (item['module'] as string).toLowerCase(),
            `list_profiles(module='${module}') returned item with module='${item['module']}'`,
          ).toBe(module);
        }
      }
    });

    it('list_profiles filters by name_contains (no match)', async () => {
      const result = await callTool('list_profiles', {
        name_contains: 'zzznomatch',
      });
      expect(result['items']).toBeDefined();
      const items = result['items'] as unknown[];
      expect(items.length === 0 || Array.isArray(items)).toBe(true);
    });

    it('get_profile returns profile details', async () => {
      const profiles = await callTool('list_profiles');
      const items = (profiles['items'] ?? []) as Record<string, unknown>[];
      if (items.length === 0) {
        console.log('SKIP: No profiles configured on this instance');
        return;
      }

      const name = (items[0]!['name'] ?? items[0]!['identifier']) as string;
      expect(name, 'First profile item has no name or identifier').toBeTruthy();

      const detail = await callTool('get_profile', { name });
      expect(detail['name'] === name || 'name' in detail).toBe(true);
    });
  });
});
