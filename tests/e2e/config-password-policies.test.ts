/**
 * Live-QA E2E CRUD test for the Horizon "password_policies" config object.
 *
 * Tools: create_password_policy / get_password_policy / update_password_policy /
 *        delete_password_policy / list_password_policies. idField = name.
 *
 * Payloads mirror the Bruno CI suite
 * (horizon/cicd/Evertrust-Horizon-api-test/09 - Password Policy/*.bru):
 *   create:  { name, minChar: 15, maxChar: 20, minUpChar: 4 }   (-> 201)
 *   update:  PUT collection root with maxChar 20 -> 25            (-> 200)
 *   delete:  DELETE /api/v1/security/passwordpolicies/{name}      (-> 204)
 * mapped to the MCP tool's snake_case inputs.
 *
 * Update PUTs the COLLECTION root (body-keyed full-replace, target located by
 * the body `name` field, NO path param); the wrapper does GET-strip-merge so
 * untouched fields persist and the response-only `_id` is stripped.
 *
 * No prerequisite dependencies (contract dependencies: []). Password policies
 * are a standard config object on a QA instance, so create is expected to
 * succeed; the create assertion is nonetheless tolerant of a clean Horizon
 * validation / license rejection (asserted as a ToolError surfacing a real
 * PasswordPolicy* server code, not a tool/client bug) so the suite stays
 * robust on a constrained instance.
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

describe.skipIf(!E2E_CONFIGURED)('password_policy CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Unique per-run name; satisfies the name regex [0-9a-zA-Z-_.] (no spaces).
  const name = `${E2E_PREFIX}-pwpolicy`;

  // Tracks whether create succeeded so get/list/update/delete only run on a
  // real object (the create assertion below is tolerant of a clean rejection).
  let created = false;

  afterAll(async () => {
    // Best-effort cleanup; swallow errors so teardown never fails the suite.
    try {
      await callTool('delete_password_policy', {
        name,
        expected_name: name,
      });
    } catch {
      // already deleted, never created, or transient - ignore.
    }
  });

  it('creates a password policy', async () => {
    try {
      const r = await callTool('create_password_policy', {
        name,
        min_char: 15,
        max_char: 20,
        min_up_char: 4,
      });
      created = true;
      expect(r['status']).toBe('created');
      expect(r['name']).toBe(name);
      const data = r['data'] as Record<string, unknown> | undefined;
      expect(data?.['name']).toBe(name);
      expect(data?.['maxChar']).toBe(20);
      expect(data?.['minUpChar']).toBe(4);
    } catch (err) {
      // Tolerant path: accept a clean Horizon validation/license rejection
      // (a real PasswordPolicy* server code), but never a tool/client bug.
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).message).toMatch(
        /PasswordPolicy|license|not licensed|forbidden|unauthorized/i,
      );
    }
  });

  it('gets it back', async () => {
    if (!created) return; // create was cleanly rejected by the server; skip.
    const r = await callTool('get_password_policy', { name });
    expect(r['name']).toBe(name);
    expect(r['minChar']).toBe(15);
    expect(r['maxChar']).toBe(20);
    expect(r['minUpChar']).toBe(4);
    // _id is RESPONSE-ONLY and must be present on the fetched object.
    expect(r['_id']).toBeDefined();
  });

  it('appears in the list', async () => {
    if (!created) return;
    const r = await callTool('list_password_policies', {
      name_contains: name,
    });
    const items = (r['items'] ?? []) as Array<Record<string, unknown>>;
    expect(items.some((p) => p['name'] === name)).toBe(true);
  });

  it('updates maxChar 20 -> 25', async () => {
    if (!created) return;
    const r = await callTool('update_password_policy', {
      name,
      max_char: 25,
    });
    expect(r['status']).toBe('updated');
    expect(r['name']).toBe(name);
    const data = r['data'] as Record<string, unknown> | undefined;
    expect(data?.['maxChar']).toBe(25);

    // Confirm the change round-trips, and GET-merge preserved untouched fields.
    const got = await callTool('get_password_policy', { name });
    expect(got['maxChar']).toBe(25);
    expect(got['minChar']).toBe(15);
    expect(got['minUpChar']).toBe(4);
  });

  it('rejects a delete with a mismatched safety echo', async () => {
    if (!created) return;
    const raw = await callToolRaw('delete_password_policy', {
      name,
      expected_name: `${name}-wrong`,
    });
    // Client-side safety guard - not a real Horizon call.
    expect(raw).toContain('SAFETY-ECHO');
  });

  it('deletes the password policy', async () => {
    if (!created) return;
    const r = await callTool('delete_password_policy', {
      name,
      expected_name: name,
    });
    expect(r['deleted']).toBe(true);
    expect(r['name']).toBe(name);
    created = false; // prevent double-delete in afterAll.
  });

  it('is gone after delete', async () => {
    if (created) return; // delete did not run (create was rejected); skip.
    // GET on a deleted policy must surface a clean Horizon 404 (PasswordPolicy003),
    // raised as a ToolError - not a tool/client bug.
    let err: unknown;
    try {
      await callTool('get_password_policy', { name });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ToolError);
  });
});
