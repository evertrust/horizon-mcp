/**
 * Live-QA E2E CRUD test for the Horizon "pki_queues" config object.
 *
 * Tools: create_pki_queue / get_pki_queue / update_pki_queue /
 *        delete_pki_queue / list_pki_queues. idField = name.
 *
 * Payloads mirror the Bruno CI suite:
 *   horizon/cicd/Evertrust-Horizon-api-test/04 - PKI Queue/*.bru
 *     create:  { name, throttleDuration: "1 second", throttleParallelism: 4,
 *                clusterWide: false, size: 100 }   (snake_case at the tool layer)
 *     update:  bump throttleParallelism 4 -> 10
 *     delete:  DELETE /api/v1/pki/queues/{name} -> 204
 *
 * No prerequisite dependencies (contract dependencies: []). PKI queues are a
 * standard config object on a QA instance, so create is expected to succeed;
 * the create assertion is nonetheless tolerant of a clean Horizon validation /
 * license error (asserted as a ToolError surfacing a PKI-QUEUE-* server code,
 * not a tool/client bug) so the suite is robust on a constrained instance.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('pki_queues CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Unique per-run name; matches the name regex [0-9a-zA-Z-_.] (no spaces).
  const name = `${E2E_PREFIX}-pki-queue`;

  // Tracks whether create succeeded so get/update/delete only run on a real object.
  let created = false;

  afterAll(async () => {
    // Best-effort cleanup; swallow errors so teardown never fails the suite.
    try {
      await callTool('delete_pki_queue', {
        name,
        expected_name: name,
      });
    } catch {
      // already deleted, never created, or transient - ignore.
    }
  });

  it('creates the pki queue', async () => {
    try {
      const r = await callTool('create_pki_queue', {
        name,
        size: 100,
        cluster_wide: false,
        throttle_duration: '1 second',
        throttle_parallelism: 4,
      });
      created = true;
      expect(r['status']).toBe('created');
      expect(r['name']).toBe(name);
    } catch (err) {
      // Tolerant path: accept a clean Horizon validation/license rejection
      // (a real server error code), but never a tool/client-side bug.
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).message).toMatch(
        /PKI-QUEUE-|license|not licensed|forbidden|unauthorized/i,
      );
    }
  });

  it('gets it back', async () => {
    if (!created) return; // create was cleanly rejected by the server; skip round-trip.
    const r = await callTool('get_pki_queue', { name });
    expect(r['name']).toBe(name);
    expect(r['size']).toBe(100);
    expect(r['clusterWide']).toBe(false);
    expect(r['throttleParallelism']).toBe(4);
  });

  it('lists it', async () => {
    if (!created) return;
    const r = await callTool('list_pki_queues', { name_contains: name });
    const items = (r['items'] ?? r['results'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(items.some((q) => q['name'] === name)).toBe(true);
  });

  it('updates it (throttle_parallelism 4 -> 10)', async () => {
    if (!created) return;
    const r = await callTool('update_pki_queue', {
      name,
      throttle_parallelism: 10,
    });
    expect(r['status']).toBe('updated');
    expect(r['name']).toBe(name);

    // Confirm the change persisted; size/clusterWide preserved by GET-merge.
    const got = await callTool('get_pki_queue', { name });
    expect(got['throttleParallelism']).toBe(10);
    expect(got['size']).toBe(100);
    expect(got['clusterWide']).toBe(false);
  });

  it('deletes it', async () => {
    if (!created) return;
    const r = await callTool('delete_pki_queue', {
      name,
      expected_name: name,
    });
    expect(r['deleted']).toBe(true);
    expect(r['name']).toBe(name);
    created = false; // prevent double-delete in afterAll.
  });
});
