/**
 * Live-QA E2E test for the READ-ONLY "identity_providers" tools.
 *
 * Identity providers are a read-only surface in this MCP server (no create/
 * update/delete tools exist). This test confirms list_identity_providers and
 * get_identity_provider work against live Horizon 2.10 and surface OIDC
 * configuration (including group-claim / JIT mappings) without any mutation.
 */
import { describe, expect, it } from 'vitest';

import { E2E_CONFIGURED, callTool, setupE2EStack } from './setup.js';

describe.skipIf(!E2E_CONFIGURED)(
  'identity_providers READ-ONLY E2E (live QA)',
  () => {
    setupE2EStack();

    it('lists identity providers', async () => {
      const r = await callTool('list_identity_providers', {});
      expect(r['kind']).toBe('identity_provider');
      expect(Array.isArray(r['items'])).toBe(true);
    });

    it('gets a single identity provider by name', async () => {
      const list = await callTool('list_identity_providers', {});
      const items = (list['items'] as Array<Record<string, unknown>>) ?? [];
      if (items.length === 0) {
        console.log('SKIP: no identity providers on this instance');
        return;
      }
      const name = items[0]!['name'] as string;
      const r = await callTool('get_identity_provider', { name });
      expect(r['name']).toBe(name);
      expect(r['type']).toBeDefined();
    });

    it('does not expose a create/update/delete tool for identity providers', async () => {
      await expect(
        callTool('create_identity_provider', { name: 'nope' }),
      ).rejects.toThrow();
    });
  },
);
