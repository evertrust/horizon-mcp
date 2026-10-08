/**
 * E2E coverage for the ACME tools and EAB policy config tools
 * (Horizon 2.11+).
 *
 * The read leg discovers ACME accounts and orders on the instance and never
 * changes them. The write leg creates its own EAB policy and EAB, renews the
 * EAB, suspends it and sets it valid again, then deletes both. It never uses
 * the compromised or deactivated statuses. afterAll removes anything that is
 * left.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  callTool,
  setupE2EStack,
} from './setup.js';

type Row = Record<string, unknown>;

function results(page: Row): Row[] {
  return (page['results'] as Row[] | undefined) ?? [];
}

describe.skipIf(!E2E_CONFIGURED)('ACME read tools E2E', () => {
  setupE2EStack();

  let accountId = '';
  let accountWithOrders = '';

  beforeAll(async () => {
    const page = await callTool('search_acme_accounts', { page_size: 50 });
    const accounts = results(page);
    accountId = String(accounts[0]?.['_id'] ?? '');
    for (const account of accounts) {
      const id = String(account['_id']);
      const orders = await callTool('list_acme_orders', {
        account_id: id,
        page_size: 1,
      });
      if (results(orders).length > 0 && orders['has_more'] === true) {
        accountWithOrders = id;
        break;
      }
    }
  });

  it('searches ACME accounts with HAQL', async () => {
    const page = await callTool('search_acme_accounts', {
      query: 'status equals "valid"',
      page_size: 5,
    });
    expect(Array.isArray(page['results'])).toBe(true);
    for (const account of results(page)) {
      expect(account['status']).toBe('valid');
    }
  });

  it('gets an ACME account', async (ctx) => {
    if (!accountId) ctx.skip();
    const account = await callTool('get_acme_account', {
      account_id: accountId,
    });
    expect(account['_id']).toBe(accountId);
    expect(account['status']).toBeDefined();
  });

  it('pages through the orders of an ACME account', async (ctx) => {
    if (!accountWithOrders) ctx.skip();
    const first = await callTool('list_acme_orders', {
      account_id: accountWithOrders,
      page_size: 1,
      page_index: 0,
    });
    const second = await callTool('list_acme_orders', {
      account_id: accountWithOrders,
      page_size: 1,
      page_index: 1,
    });
    const firstId = results(first)[0]?.['_id'];
    const secondId = results(second)[0]?.['_id'];
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(secondId).not.toBe(firstId);

    const order = await callTool('get_acme_order', {
      order_id: String(firstId),
    });
    expect(order['_id']).toBe(firstId);
  });

  it('searches ACME EABs with HEABQL', async () => {
    const page = await callTool('search_acme_eabs', {
      query: 'mackey.algorithm in ["HS256", "HS384", "HS512"]',
      page_size: 5,
    });
    expect(Array.isArray(page['results'])).toBe(true);
  });

  it('validates HAQL and HEABQL queries', async () => {
    const haql = await callTool('validate_hql', {
      dialect: 'haql',
      query: 'status equals "valid"',
    });
    expect(haql['valid']).toBe(true);
    const heabql = await callTool('validate_hql', {
      dialect: 'heabql',
      query: 'status equals "valid"',
    });
    expect(heabql['valid']).toBe(true);
  });
});

describe.skipIf(!E2E_CONFIGURED)('ACME EAB lifecycle E2E', () => {
  setupE2EStack();

  const policyName = `mcp-${E2E_PREFIX}-eab-policy`;
  const eabName = `mcp-${E2E_PREFIX}-eab`;
  let firstMacKey = '';

  afterAll(async () => {
    try {
      await callTool('delete_acme_eab', {
        name: eabName,
        expected_name: eabName,
      });
    } catch {
      /* already deleted or never created */
    }
    try {
      await callTool('delete_eab_policy', {
        name: policyName,
        expected_name: policyName,
      });
    } catch {
      /* already deleted or never created */
    }
  });

  it('creates an EAB policy', async () => {
    const created = await callTool('create_eab_policy', {
      name: policyName,
      identifier_constraint: '.*\\.example\\.com',
      validation_methods: ['http-01', 'dns-01'],
    });
    expect(created['status']).toBe('created');
  });

  it('gets, lists and updates the EAB policy', async () => {
    const policy = await callTool('get_eab_policy', { name: policyName });
    expect(policy['name']).toBe(policyName);

    const list = await callTool('list_eab_policies');
    const names = (list['items'] as Row[]).map((p) => p['name']);
    expect(names).toContain(policyName);

    await callTool('update_eab_policy', {
      name: policyName,
      validation_methods: ['dns-01'],
    });
    const updated = await callTool('get_eab_policy', { name: policyName });
    expect(updated['validationMethods']).toEqual(['dns-01']);
    expect(updated['identifierConstraint']).toBe('.*\\.example\\.com');

    await callTool('update_eab_policy', {
      name: policyName,
      clear_fields: ['identifierConstraint'],
    });
    const cleared = await callTool('get_eab_policy', { name: policyName });
    expect(cleared['identifierConstraint'] ?? '').toBe('');
    expect(cleared['validationMethods']).toEqual(['dns-01']);
  });

  it('creates an EAB and returns its one-time MAC key', async () => {
    const created = await callTool('create_acme_eab', {
      name: eabName,
      eab_policy: policyName,
      mac_key_algorithm: 'HS256',
      description: 'MCP E2E test EAB',
    });
    expect(created['status']).toBe('created');
    expect(String(created['warning'])).toContain('one-time secrets');
    const data = created['data'] as Row;
    expect(typeof data['macKey']).toBe('string');
    expect(typeof data['macKeyId']).toBe('string');
    firstMacKey = String(data['macKey']);
  });

  it('gets and searches the EAB without its MAC key', async () => {
    const eab = await callTool('get_acme_eab', { name: eabName });
    expect(eab['name']).toBe(eabName);
    expect(eab['eabPolicy']).toBe(policyName);
    expect(eab['macKey']).toBeUndefined();

    const page = await callTool('search_acme_eabs', {
      query: `name equals "${eabName}"`,
    });
    expect(results(page).map((e) => e['name'])).toEqual([eabName]);
  });

  it('renews the EAB and returns a new MAC key', async () => {
    const renewed = await callTool('renew_acme_eab', {
      name: eabName,
      mac_key_algorithm: 'HS384',
    });
    expect(renewed['status']).toBe('renewed');
    const data = renewed['data'] as Row;
    expect(typeof data['macKey']).toBe('string');
    // Compare without printing the secret in a failure message.
    expect(data['macKey'] !== firstMacKey).toBe(true);
  });

  it('updates and clears the EAB description', async () => {
    await callTool('update_acme_eab', {
      name: eabName,
      description: 'MCP E2E test EAB (updated)',
    });
    const eab = await callTool('get_acme_eab', { name: eabName });
    expect(eab['description']).toBe('MCP E2E test EAB (updated)');
    expect(eab['eabPolicy']).toBe(policyName);

    await callTool('update_acme_eab', {
      name: eabName,
      clear_fields: ['description'],
    });
    const cleared = await callTool('get_acme_eab', { name: eabName });
    expect(cleared['description'] ?? '').toBe('');
    expect(cleared['eabPolicy']).toBe(policyName);
  });

  it('suspends the EAB and sets it valid again', async () => {
    const suspended = await callTool('update_acme_eab_status', {
      name: eabName,
      status: 'suspended',
    });
    expect(suspended['status']).toBe('suspended');
    const valid = await callTool('update_acme_eab_status', {
      name: eabName,
      status: 'valid',
    });
    expect(valid['status']).toBe('valid');
  });

  it('deletes the EAB, then the EAB policy', async () => {
    const eab = await callTool('delete_acme_eab', {
      name: eabName,
      expected_name: eabName,
    });
    expect(eab['deleted']).toBe(true);
    const policy = await callTool('delete_eab_policy', {
      name: policyName,
      expected_name: policyName,
    });
    expect(policy['deleted'] ?? policy['status']).toBeTruthy();
  });
});
