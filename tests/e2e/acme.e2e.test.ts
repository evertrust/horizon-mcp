import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  callTool,
  isHorizonAtLeast,
  setupE2EStack,
} from './setup.js';

type Row = Record<string, unknown>;

function results(page: Row): Row[] {
  return (page['results'] as Row[] | undefined) ?? [];
}

describe.skipIf(!E2E_CONFIGURED)('ACME read tools E2E', () => {
  setupE2EStack();
  let is211 = false;
  let accountId = '';

  beforeAll(async () => {
    is211 = await isHorizonAtLeast(2, 11);
    if (!is211) return;
    const page = await callTool('search_acme_accounts', { page_size: 50 });
    accountId = String(results(page)[0]?.['_id'] ?? '');
  });

  beforeEach((ctx) => {
    if (!is211) ctx.skip();
  });

  it('searches ACME accounts with HAQL', async () => {
    const page = await callTool('search_acme_accounts', {
      query: 'status equals "valid"',
      page_size: 5,
    });
    expect(Array.isArray(page['results'])).toBe(true);
    for (const account of results(page))
      expect(account['status']).toBe('valid');
  });

  it('gets a discovered ACME account', async (ctx) => {
    if (!accountId) ctx.skip();
    const account = await callTool('get_acme_account', {
      account_id: accountId,
    });
    expect(account['_id']).toBe(accountId);
  });

  it('validates HAQL and HEABQL queries', async () => {
    for (const dialect of ['haql', 'heabql']) {
      const result = await callTool('validate_hql', {
        dialect,
        query: 'status equals "valid"',
      });
      expect(result['valid']).toBe(true);
    }
  });
});

describe.skipIf(!E2E_CONFIGURED)('ACME EAB lifecycle E2E', () => {
  setupE2EStack();
  const policyName = `mcp-${E2E_PREFIX}-eab-policy`;
  const eabName = `mcp-${E2E_PREFIX}-eab`;
  let is211 = false;
  let firstMacKey = '';

  beforeAll(async () => {
    is211 = await isHorizonAtLeast(2, 11);
  });

  beforeEach((ctx) => {
    if (!is211) ctx.skip();
  });

  afterAll(async () => {
    if (!is211) return;
    try {
      await callTool('delete_acme_eab', {
        name: eabName,
        expected_name: eabName,
      });
    } catch {
      // The resource may already be deleted by the test below.
    }
    try {
      await callTool('delete_eab_policy', {
        name: policyName,
        expected_name: policyName,
      });
    } catch {
      // The resource may already be deleted by the test below.
    }
  });

  it('creates and updates an EAB policy', async () => {
    const created = await callTool('create_eab_policy', {
      name: policyName,
      identifier_constraint: '.*\\.example\\.com',
      validation_methods: ['http-01'],
    });
    expect(created['status']).toBe('created');
    await callTool('update_eab_policy', {
      name: policyName,
      validation_methods: ['dns-01'],
    });
    const policy = await callTool('get_eab_policy', { name: policyName });
    expect(policy['validationMethods']).toEqual(['dns-01']);
  });

  it('creates, renews, updates and removes an EAB without logging its MAC key', async () => {
    const created = await callTool('create_acme_eab', {
      name: eabName,
      eab_policy: policyName,
      mac_key_algorithm: 'HS256',
    });
    const data = created['data'] as Row;
    firstMacKey = String(data['macKey']);
    expect(created['warning']).toContain('one-time secrets');
    expect(typeof data['macKeyId']).toBe('string');

    const renewed = await callTool('renew_acme_eab', {
      name: eabName,
      mac_key_algorithm: 'HS384',
    });
    expect(String((renewed['data'] as Row)['macKey']) !== firstMacKey).toBe(
      true,
    );
    await callTool('update_acme_eab_status', {
      name: eabName,
      status: 'suspended',
    });
    const deleted = await callTool('delete_acme_eab', {
      name: eabName,
      expected_name: eabName,
    });
    expect(deleted['deleted']).toBe(true);
    const deletedPolicy = await callTool('delete_eab_policy', {
      name: policyName,
      expected_name: policyName,
    });
    expect(deletedPolicy['deleted'] ?? deletedPolicy['status']).toBeTruthy();
  });
});
