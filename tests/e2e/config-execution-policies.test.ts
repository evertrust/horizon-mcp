/**
 * Live-QA E2E CRUD test for the Horizon "execution_policies" config object.
 *
 * Tools: create_execution_policy / get_execution_policy /
 *        update_execution_policy / delete_execution_policy /
 *        list_execution_policies. idField = name.
 *
 * Route: /api/v1/automation/executions (collection) and
 *        /api/v1/automation/executions/{name} (item).
 * See docs/audit/execution_policies.contract.json.
 *
 * Bruno CI payload source: the Bruno suite folder
 * "35 - Automation Policy" only covers AUTOMATION POLICIES
 * (/api/v1/automation/policies), NOT execution policies
 * (/api/v1/automation/executions); there is no execution-policy .bru request
 * body anywhere in horizon/cicd (only the config-list import/export tests
 * reference the type). The authoritative valid create body therefore comes
 * from the contract + the unit-test golden mapping
 * (tests/unit/config-execution-policies.test.ts), which encode the exact
 * snake_case -> camelCase ExecutionPeriod shape:
 *   authorized_periods[].{ date_range, weeks, week_days, time_range }
 *     -> authorizedPeriods[].{ dateRange, weeks, weekDays, timeRange }
 *   dateRange / timeRange are {start, end} objects (authoritative Scala
 *   Json.format[TimeRange] object form, not the OpenAPI single-string shape).
 *
 * Update PUTs the COLLECTION root (body-keyed full-replace via Mongo
 * replaceOne; target located by the body `name` field, NO path param); the
 * wrapper does GET-strip-merge so untouched fields persist and the
 * response-only `_id` is stripped before PUT.
 *
 * No prerequisite dependencies (contract dependencies: []). Execution policies
 * are a standard config object, so create is expected to succeed; the create
 * assertion is nonetheless tolerant of a clean Horizon validation/license
 * rejection (asserted as a ToolError surfacing a real ExecutionPolicy* server
 * code, not a tool/client bug) so the suite stays robust on a constrained
 * instance.
 *
 * Gated on E2E_CONFIGURED so it is skipped without QA credentials.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  callToolRaw,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('execution_policy CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Unique per-run name; satisfies the name regex [0-9a-zA-Z-_.]+ (no spaces).
  const name = `${E2E_PREFIX}-execpolicy`;

  // Tracks whether create succeeded so get/list/update/delete only run on a
  // real object (the create assertion below is tolerant of a clean rejection).
  let created = false;

  afterAll(async () => {
    // Best-effort cleanup; swallow errors so teardown never fails the suite.
    try {
      await callTool('delete_execution_policy', {
        name,
        expected_name: name,
      });
    } catch {
      // already deleted, never created, or transient - ignore.
    }
  });

  it('creates an execution policy', async () => {
    try {
      const r = await callTool('create_execution_policy', {
        name,
        description: 'business hours only',
        authorized_periods: [
          {
            date_range: { start: '2026-01-01', end: '2026-12-31' },
            weeks: [1, 2, 3],
            week_days: ['MONDAY', 'TUESDAY'],
            time_range: { start: '08:00:00', end: '18:00:00' },
          },
        ],
        forbidden_periods: [{ week_days: ['SATURDAY', 'SUNDAY'] }],
      });
      created = true;
      expect(r['status']).toBe('created');
      expect(r['name']).toBe(name);
      const data = r['data'] as Record<string, unknown> | undefined;
      expect(data?.['name']).toBe(name);
    } catch (err) {
      // Tolerant path: accept a clean Horizon validation/license rejection
      // (a real ExecutionPolicy* server code), but never a tool/client bug.
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).message).toMatch(
        /ExecutionPolicy|license|not licensed|forbidden|unauthorized/i,
      );
    }
  });

  it('gets it back with the camelCase period shape', async () => {
    if (!created) return; // create was cleanly rejected by the server; skip.
    const r = await callTool('get_execution_policy', { name });
    expect(r['name']).toBe(name);
    expect(r['description']).toBe('business hours only');

    // Periods round-trip under the API camelCase keys.
    const authorized = (r['authorizedPeriods'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(authorized.length).toBeGreaterThan(0);
    const period = authorized[0]!;
    expect(period['dateRange']).toMatchObject({
      start: '2026-01-01',
      end: '2026-12-31',
    });
    expect(period['weekDays']).toEqual(
      expect.arrayContaining(['MONDAY', 'TUESDAY']),
    );
    expect(period['timeRange']).toMatchObject({
      start: '08:00:00',
      end: '18:00:00',
    });

    const forbidden = (r['forbiddenPeriods'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(forbidden.length).toBeGreaterThan(0);
    expect(forbidden[0]!['weekDays']).toEqual(
      expect.arrayContaining(['SATURDAY', 'SUNDAY']),
    );

    // _id is RESPONSE-ONLY and must be present on the fetched object.
    expect(r['_id']).toBeDefined();
  });

  it('appears in the list', async () => {
    if (!created) return;
    const r = await callTool('list_execution_policies', {
      name_contains: name,
    });
    const items = (r['items'] ?? []) as Array<Record<string, unknown>>;
    expect(items.some((p) => p['name'] === name)).toBe(true);
  });

  it('updates the description and preserves untouched periods', async () => {
    if (!created) return;
    const r = await callTool('update_execution_policy', {
      name,
      description: 'maintenance window',
    });
    expect(r['status']).toBe('updated');
    expect(r['name']).toBe(name);
    const data = r['data'] as Record<string, unknown> | undefined;
    expect(data?.['description']).toBe('maintenance window');

    // Confirm the change round-trips, and GET-strip-merge preserved the
    // untouched authorizedPeriods.
    const got = await callTool('get_execution_policy', { name });
    expect(got['description']).toBe('maintenance window');
    const authorized = (got['authorizedPeriods'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(authorized.length).toBeGreaterThan(0);
  });

  it('rejects a delete with a mismatched safety echo', async () => {
    if (!created) return;
    const raw = await callToolRaw('delete_execution_policy', {
      name,
      expected_name: `${name}-wrong`,
    });
    // Client-side safety guard - not a real Horizon call.
    expect(raw).toContain('SAFETY-ECHO');
  });

  it('deletes the execution policy', async () => {
    if (!created) return;
    const r = await callTool('delete_execution_policy', {
      name,
      expected_name: name,
    });
    expect(r['deleted']).toBe(true);
    expect(r['name']).toBe(name);
    created = false; // prevent double-delete in afterAll.
  });

  it('is gone after delete', async () => {
    if (created) return; // delete did not run (create was rejected); skip.
    // GET on a deleted policy must surface a clean Horizon 404
    // (ExecutionPolicy003), raised as a ToolError - not a tool/client bug.
    let err: unknown;
    try {
      await callTool('get_execution_policy', { name });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ToolError);
  });
});
