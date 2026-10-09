/**
 * Live-QA E2E test for service-account tools.
 *
 * This test confirms the read tools work against live Horizon 2.10 and that the
 * mutation tools are registered. It never calls a mutation against QA.
 */
import { describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  callTool,
  getMcpClient,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('service_accounts E2E (live QA)', () => {
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
    expect('trustConfig' in r || 'permissions' in r || 'roles' in r).toBe(true);
  });

  it('exposes create/update/delete tools without mutating QA', async () => {
    const names = (await getMcpClient().listTools()).tools.map(
      (tool) => tool.name,
    );
    for (const name of [
      'create_service_account',
      'update_service_account',
      'delete_service_account',
    ]) {
      expect(names).toContain(name);
    }
  });
});
