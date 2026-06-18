/**
 * Live-QA E2E CRUD test for the Horizon 2.10 config object "dcv_providers".
 *
 * Exercises create_dcv_provider / get_dcv_provider / update_dcv_provider /
 * delete_dcv_provider / list_dcv_providers against a live Horizon 2.10 QA
 * instance, via the full MCP path.
 *
 * A DCV provider needs an existing credentials object (DCV target). Rather than
 * provision credentials (excluded from this MCP server), the test discovers a
 * valid credentials + endpoint from an existing provider on the instance and
 * reuses them. If no provider exists to borrow from, the create is TOLERANT:
 * it asserts the tool reaches the server with a clean validation error.
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

describe.skipIf(!E2E_CONFIGURED)('dcv_providers CRUD E2E (live QA)', () => {
  setupE2EStack();

  const name = `${E2E_PREFIX}-dcvprovider`;
  let creds: string | undefined;
  let endpoint = 'https://www.digicert.com';

  beforeAll(async () => {
    // Borrow credentials + endpoint from an existing provider so the create has
    // a valid DCV-target credentials reference.
    try {
      const existing = (await getHorizonClient().get(
        '/api/v1/dcv/providers',
      )) as Array<Record<string, unknown>>;
      const sample = existing?.[0];
      if (sample) {
        creds = sample['credentials'] as string;
        if (typeof sample['endpoint'] === 'string')
          endpoint = sample['endpoint'] as string;
      }
    } catch {
      /* none to borrow */
    }
  });

  afterAll(async () => {
    try {
      await callTool('delete_dcv_provider', { name, expected_name: name });
    } catch {
      /* already deleted or never created */
    }
  });

  it('creates a digicert DCV provider (or reports a clean validation error)', async () => {
    if (!creds) {
      // No credentials to borrow: assert a clean server-side validation error.
      await expect(
        callTool('create_dcv_provider', {
          name,
          type: 'digicert',
          endpoint,
          credentials: 'e2e-nonexistent-creds',
          timeout: '30 seconds',
        }),
      ).rejects.toThrow(ToolError);
      return;
    }
    const r = await callTool('create_dcv_provider', {
      name,
      type: 'digicert',
      endpoint,
      credentials: creds,
      timeout: '30 seconds',
    });
    expect(r['status']).toBe('created');
    expect(r['name']).toBe(name);
  });

  it('gets it back with type=digicert', async () => {
    if (!creds) return;
    const r = await callTool('get_dcv_provider', { name });
    expect(r['name']).toBe(name);
    expect(r['type']).toBe('digicert');
    expect(r['endpoint']).toBe(endpoint);
    expect(r['_id']).toBeDefined();
  });

  it('appears in the list (filtered by name substring)', async () => {
    if (!creds) return;
    const r = await callTool('list_dcv_providers', { name_contains: name });
    expect(r['kind']).toBe('dcv_provider');
    const items = (r['items'] as Array<Record<string, unknown>>) ?? [];
    expect(items.some((p) => p['name'] === name)).toBe(true);
  });

  it('updates the timeout (GET-merge full-replace)', async () => {
    if (!creds) return;
    const r = await callTool('update_dcv_provider', {
      name,
      type: 'digicert',
      timeout: '45 seconds',
    });
    expect(r['status']).toBe('updated');
    const fetched = await callTool('get_dcv_provider', { name });
    expect(fetched['timeout']).toBe('45 seconds');
    // credentials preserved through the merge.
    expect(fetched['credentials']).toBe(creds);
  });

  it('rejects a delete with a mismatched safety echo', async () => {
    await expect(
      callTool('delete_dcv_provider', { name, expected_name: 'wrong' }),
    ).rejects.toThrow(ToolError);
  });

  it('deletes it and confirms it is gone', async () => {
    if (!creds) return;
    const r = await callTool('delete_dcv_provider', {
      name,
      expected_name: name,
    });
    expect(r['deleted']).toBe(true);
    await expect(callTool('get_dcv_provider', { name })).rejects.toThrow(
      ToolError,
    );
  });
});
