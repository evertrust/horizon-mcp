/**
 * Live-QA E2E coverage for DCV lifecycle consumption tools.
 *
 * The mutation leg is deliberately opt-in. cancel_dcv_run cancels the entire
 * policy run, so HORIZON_E2E_DCV_POLICY must identify an isolated QA policy.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { E2E_CONFIGURED, callTool, setupE2EStack } from './setup.js';

const dcvPolicy = process.env['HORIZON_E2E_DCV_POLICY'] ?? '';
const dcvDomain = process.env['HORIZON_E2E_DCV_DOMAIN'] ?? '';
const mutationConfigured = Boolean(dcvPolicy && dcvDomain);

if (E2E_CONFIGURED && !mutationConfigured) {
  console.warn(
    '[dcv.e2e] Skipping DCV mutations: set HORIZON_E2E_DCV_POLICY and HORIZON_E2E_DCV_DOMAIN for an isolated QA policy.',
  );
}

describe.skipIf(!E2E_CONFIGURED)('DCV lifecycle E2E (live QA)', () => {
  setupE2EStack();

  let policyName = '';

  beforeAll(async () => {
    const policies = (await callTool(
      'list_dcv_policy_status',
    )) as unknown as Array<Record<string, unknown>>;
    policyName = dcvPolicy || String(policies[0]?.['name'] ?? '');
  });

  it('lists DCV policy status', async () => {
    const policies = (await callTool(
      'list_dcv_policy_status',
    )) as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(policies)).toBe(true);
  });

  it('gets DCV policy status', async () => {
    expect(
      policyName,
      'QA must have a DCV policy for get coverage',
    ).toBeTruthy();
    const policy = await callTool('get_dcv_policy_status', {
      name: policyName,
    });
    expect(policy['name']).toBe(policyName);
    expect(policy['domainsStatus']).toBeDefined();
  });

  it.skipIf(!mutationConfigured)(
    'runs one isolated DCV domain and cancels its policy run',
    async () => {
      await callTool('run_dcv_domain', { name: dcvPolicy, domain: dcvDomain });
      await callTool('cancel_dcv_run', { name: dcvPolicy });
    },
  );
});
