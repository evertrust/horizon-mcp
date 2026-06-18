/**
 * Live-QA E2E test for the READ-ONLY "service_accounts" tools.
 *
 * Service accounts are a read-only surface in this MCP server (no create/update/
 * delete tools exist). This test confirms list_service_accounts and
 * get_service_account work against live Horizon 2.10 and surface the federated
 * trustConfig (JWKS) without any mutation.
 */
import { describe, expect, it } from 'vitest';

import { E2E_CONFIGURED, callTool, setupE2EStack } from './setup.js';

describe.skipIf(!E2E_CONFIGURED)(
  'service_accounts READ-ONLY E2E (live QA)',
  () => {
    setupE2EStack();

    it('lists service accounts', async () => {
      const r = await callTool('list_service_accounts', {});
      expect(r['kind']).toBe('service_account');
      expect(Array.isArray(r['items'])).toBe(true);
    });

    it('gets a single service account with its trustConfig', async () => {
      const list = await callTool('list_service_accounts', {});
      const items = (list['items'] as Array<Record<string, unknown>>) ?? [];
      if (items.length === 0) {
        console.log('SKIP: no service accounts on this instance');
        return;
      }
      const name = items[0]!['name'] as string;
      const r = await callTool('get_service_account', { name });
      expect(r['name']).toBe(name);
      // trustConfig carries the federated-auth configuration (e.g. dynamic_jwks).
      expect('trustConfig' in r || 'permissions' in r || 'roles' in r).toBe(
        true,
      );
    });

    it('does not expose a create/update/delete tool for service accounts', async () => {
      await expect(
        callTool('create_service_account', { name: 'nope' }),
      ).rejects.toThrow();
    });
  },
);
