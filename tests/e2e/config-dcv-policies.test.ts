/**
 * Live-QA E2E CRUD test for the Horizon 2.10 config object "dcv_policies".
 *
 * Exercises create/get/update/delete/list_dcv_policy(ies) against live Horizon
 * 2.10 QA via the full MCP path.
 *
 * A DCV policy references an existing DCV provider + provisioner (server
 * validated). The test discovers an existing provider and provisioner from the
 * instance and binds them. If none exist, the create is TOLERANT (asserts a
 * clean InvalidReference validation error).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('dcv_policies CRUD E2E (live QA)', () => {
  setupE2EStack();

  const name = `${E2E_PREFIX}-dcvpolicy`;
  const complexName = `${E2E_PREFIX}-dcvpolicy-complex`;
  let provider: string | undefined;
  let provisioner: string | undefined;

  // A trigger may only bind to the policy event it is scoped for (DCV-POLICY-002
  // otherwise). Map each DCV policy trigger field to a trigger whose `events`
  // includes the matching event code.
  const EVENT_TO_FIELD: Record<string, string> = {
    on_dcv_policy_start: 'onDcvPolicyStart',
    on_dcv_policy_end: 'onDcvPolicyEnd',
    on_dcv_validation_success: 'onDcvValidationSuccess',
    on_dcv_validation_failure: 'onDcvValidationFailure',
    on_dcv_validation_retry: 'onDcvValidationRetry',
  };
  const triggerByField: Record<string, string> = {};

  beforeAll(async () => {
    try {
      const client = getHorizonClient();
      const providers = (await client.get('/api/v1/dcv/providers')) as Array<
        Record<string, unknown>
      >;
      const provisioners = (await client.get(
        '/api/v1/dcv/provisioners',
      )) as Array<Record<string, unknown>>;
      provider = providers?.[0]?.['name'] as string | undefined;
      provisioner = provisioners?.[0]?.['name'] as string | undefined;
      const triggers = (await client.get('/api/v1/triggers')) as
        | Array<Record<string, unknown>>
        | { items?: Array<Record<string, unknown>> };
      const tlist = Array.isArray(triggers) ? triggers : (triggers.items ?? []);
      for (const t of tlist) {
        const events = (t['events'] as string[]) ?? [];
        for (const ev of events) {
          const field = EVENT_TO_FIELD[ev];
          if (field && !triggerByField[field]) {
            triggerByField[field] = t['name'] as string;
          }
        }
      }
    } catch {
      /* none to bind */
    }
  });

  afterAll(async () => {
    for (const n of [name, complexName]) {
      try {
        await callTool('delete_dcv_policy', { name: n, expected_name: n });
      } catch {
        /* already deleted or never created */
      }
    }
  });

  it('creates a DCV policy bound to an existing provider+provisioner (or reports a clean validation error)', async () => {
    const args = {
      name,
      provider: provider ?? 'e2e-nonexistent-provider',
      provisioner: provisioner ?? 'e2e-nonexistent-provisioner',
      executionTimeout: '1 hour',
      retryDelay: '1 hour',
      enabled: false,
    };
    if (!provider || !provisioner) {
      await expect(callTool('create_dcv_policy', args)).rejects.toThrow(
        ToolError,
      );
      return;
    }
    const r = await callTool('create_dcv_policy', args);
    expect(r['status']).toBe('created');
    expect(r['name']).toBe(name);
  });

  it('gets it back with the bound provider+provisioner', async () => {
    if (!provider || !provisioner) return;
    const r = await callTool('get_dcv_policy', { name });
    expect(r['name']).toBe(name);
    expect(r['provider']).toBe(provider);
    expect(r['provisioner']).toBe(provisioner);
    expect(r['enabled']).toBe(false);
  });

  it('appears in the list', async () => {
    if (!provider || !provisioner) return;
    const r = await callTool('list_dcv_policies', { name_contains: name });
    expect(r['kind']).toBe('dcv_policy');
    const items = (r['items'] as Array<Record<string, unknown>>) ?? [];
    expect(items.some((p) => p['name'] === name)).toBe(true);
  });

  it('updates the renewalPolicy and execution timeout', async () => {
    if (!provider || !provisioner) return;
    const r = await callTool('update_dcv_policy', {
      name,
      executionTimeout: '2 hours',
      renewalPolicy: { cron: '0 0 0 1 1 ? 2099', renewalPeriod: '7 days' },
    });
    expect(r['status']).toBe('updated');
    const fetched = await callTool('get_dcv_policy', { name });
    expect(fetched['executionTimeout']).toBe('2 hours');
    expect(
      (fetched['renewalPolicy'] as Record<string, unknown>)?.['renewalPeriod'],
    ).toBe('7 days');
    // provisioner preserved through the merge.
    expect(fetched['provisioner']).toBe(provisioner);
  });

  it('creates a COMPLEX policy with filter + renewalPolicy + event-matched triggers', async () => {
    if (!provider || !provisioner) return;
    // Bind every event field for which a correctly-scoped trigger exists. Using
    // event-matched triggers exercises the real trigger-binding path (an
    // unscoped trigger is rejected with DCV-POLICY-002).
    const triggers: Record<string, string[]> = {};
    for (const [field, name_] of Object.entries(triggerByField)) {
      triggers[field] = [name_];
    }
    const boundFields = Object.keys(triggers);
    const created = await callTool('create_dcv_policy', {
      name: complexName,
      provider,
      provisioner,
      executionTimeout: '30 minutes',
      retryDelay: '15 minutes',
      enabled: false,
      filter: '.*\\.example\\.com',
      renewalPolicy: { cron: '0 0 3 ? * MON', renewalPeriod: '14 days' },
      ...(boundFields.length > 0 ? { triggers } : {}),
    });
    expect(created['status']).toBe('created');

    const got = await callTool('get_dcv_policy', { name: complexName });
    expect(got['filter']).toBe('.*\\.example\\.com');
    expect(
      (got['renewalPolicy'] as Record<string, unknown>)?.['renewalPeriod'],
    ).toBe('14 days');
    if (boundFields.length > 0) {
      const t = got['triggers'] as Record<string, unknown> | undefined;
      for (const field of boundFields) {
        expect((t?.[field] as string[]) ?? []).toContain(triggers[field]![0]);
      }
    }

    // Update one nested block and confirm the others survive the GET-merge.
    const upd = await callTool('update_dcv_policy', {
      name: complexName,
      renewalPolicy: { cron: '0 0 4 ? * MON', renewalPeriod: '21 days' },
    });
    expect(upd['status']).toBe('updated');
    const after = await callTool('get_dcv_policy', { name: complexName });
    expect(
      (after['renewalPolicy'] as Record<string, unknown>)?.['renewalPeriod'],
    ).toBe('21 days');
    expect(after['filter']).toBe('.*\\.example\\.com'); // preserved

    const del = await callTool('delete_dcv_policy', {
      name: complexName,
      expected_name: complexName,
    });
    expect(del['deleted']).toBe(true);
  });

  it('rejects a delete with a mismatched safety echo', async () => {
    await expect(
      callTool('delete_dcv_policy', { name, expected_name: 'wrong' }),
    ).rejects.toThrow(ToolError);
  });

  it('deletes it and confirms it is gone', async () => {
    if (!provider || !provisioner) return;
    const r = await callTool('delete_dcv_policy', {
      name,
      expected_name: name,
    });
    expect(r['deleted']).toBe(true);
    await expect(callTool('get_dcv_policy', { name })).rejects.toThrow(
      ToolError,
    );
  });
});
