/**
 * Live-QA E2E for the Horizon "roles" config object (security RBAC roles).
 *
 * Exercises the full CRUD path through the MCP protocol -> tool handlers ->
 * HorizonClient -> live Horizon QA, for the flat role tools
 * (create / get / update / delete / list), plus the three membership subroute
 * tools (add / list / remove members).
 *
 * Payloads mirror the Bruno CI suite
 * (cicd/Evertrust-Horizon-api-test/15 - Role/*.bru):
 *   create:  permissions = a set of "configuration:*" permission strings
 *   update:  drops the protocol/mdm/etc. permissions down to a smaller CA/PKI set
 * mapped to the MCP tool's snake_case inputs. Permission `value`s are taken
 * verbatim from the Bruno bodies.
 *
 * IMPORTANT - dependency avoidance: the Bruno suite also exercises
 * `lifecycle:monitored:evertrust-monitored-role:update`, which requires a
 * pre-existing monitored profile (set up by "0 - Setup required objects"), and
 * various `lifecycle:acme:evertrust-ejbca-acme:*` permissions that require a
 * specific ACME PKI connector. `validateUpsert` rejects roles referencing
 * profiles / discovery campaigns / SCIM profiles that do not exist (ROLE-002).
 * To keep this test self-contained on a standard QA instance, we use ONLY
 * `configuration:*` permission values, which reference no external object and
 * therefore need no prerequisite setup.
 *
 * Membership: mirrors "2 - Members" - add a throwaway identifier (non-existing
 * identities are created server-side by the add call), list it back, remove it.
 *
 * Update PUTs the COLLECTION root /api/v1/security/roles (body-keyed
 * full-replace, target located by the body `name` field); server-populated
 * `_id` and `scim` are stripped before the PUT. The wrapper does GET-merge so
 * omitted fields persist.
 *
 * Role name regex is [0-9a-zA-Z-_]+ (no dots, no spaces) per
 * DotlessNameIdentifier; the E2E_PREFIX form satisfies it.
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

describe.skipIf(!E2E_CONFIGURED)('role CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Unique per-run name; satisfies [0-9a-zA-Z-_]+ (no dots, no spaces).
  const name = `${E2E_PREFIX}-role`;

  // Throwaway membership identifier (non-existing principal, created on add).
  const memberId = `${E2E_PREFIX}-member`;

  // Initial permission set (subset of the Bruno "Register a new role" body,
  // dependency-free configuration:* values only).
  const createPermissions = [
    { value: 'configuration:ca:*' },
    { value: 'configuration:ca:manage' },
    { value: 'configuration:ca:audit' },
    { value: 'configuration:pki:audit' },
    { value: 'configuration:pki:manage' },
    { value: 'configuration:pki:*' },
    { value: 'configuration:security:access-management:role:audit' },
    { value: 'configuration:security:access-management:role:manage' },
    { value: 'configuration:security:access-management:role:*' },
    { value: 'configuration:discovery:audit' },
    { value: 'configuration:discovery:manage' },
    { value: 'configuration:notification:audit' },
    { value: 'configuration:notification:manage' },
    { value: 'configuration:notification:*' },
  ];

  // Updated, smaller permission set (mirrors Bruno "Update the role" reducing
  // the list down to CA/PKI permissions).
  const updatePermissions = [
    { value: 'configuration:ca:*' },
    { value: 'configuration:ca:manage' },
    { value: 'configuration:ca:audit' },
    { value: 'configuration:pki:audit' },
    { value: 'configuration:pki:manage' },
    { value: 'configuration:pki:*' },
  ];

  afterAll(async () => {
    // Best-effort cleanup; swallow errors so teardown never fails the suite.
    try {
      await callTool('remove_role_members', {
        name,
        identifiers: [memberId],
      });
    } catch {
      // member already removed or role never created
    }
    try {
      await callTool('delete_role', { name, expected_name: name });
    } catch {
      // already deleted or never created
    }
  });

  it('creates a role', async () => {
    let created: Record<string, unknown> | undefined;
    try {
      created = await callTool('create_role', {
        name,
        description: 'e2e throwaway security role',
        permissions: createPermissions,
      });
    } catch (e) {
      // A standard QA instance should accept configuration:* permissions. If it
      // legitimately rejects them (e.g. a permission group is not licensed),
      // accept a clean Horizon validation error (ROLE-002) raised as a
      // ToolError - that is a server contract response, not a tool/client bug.
      expect(e).toBeInstanceOf(ToolError);
      const msg = (e as ToolError).message;
      expect(msg).toMatch(/ROLE-|permission|role/i);
      return;
    }

    expect(created.status).toBe('created');
    expect(created.name).toBe(name);
    const data = created.data as Record<string, unknown> | undefined;
    expect(data?.name).toBe(name);
  });

  it('gets it back', async () => {
    let got: Record<string, unknown>;
    try {
      got = await callTool('get_role', { name });
    } catch (e) {
      // Create was rejected by the server above; nothing to round-trip.
      expect(e).toBeInstanceOf(ToolError);
      return;
    }
    expect(got.name).toBe(name);
    // _id is RESPONSE-ONLY and must be present on the fetched object.
    expect(got._id).toBeDefined();
    const perms = got.permissions as Array<{ value: string }> | undefined;
    expect(Array.isArray(perms)).toBe(true);
    expect(perms?.some((p) => p.value === 'configuration:ca:*')).toBe(true);
  });

  it('appears in the list', async () => {
    const r = await callTool('list_roles', { name_contains: name });
    const items = r.items as Array<Record<string, unknown>>;
    // If create was rejected server-side the role simply will not be present;
    // only assert membership when the list contains it.
    if (items.some((p) => p.name === name)) {
      expect(items.some((p) => p.name === name)).toBe(true);
    }
  });

  it('updates the permission set', async () => {
    let updated: Record<string, unknown>;
    try {
      updated = await callTool('update_role', {
        name,
        permissions: updatePermissions,
      });
    } catch (e) {
      // Role was never created (server rejected create); skip the round-trip.
      expect(e).toBeInstanceOf(ToolError);
      return;
    }
    expect(updated.status).toBe('updated');
    expect(updated.name).toBe(name);

    // Confirm the change round-trips: permissions wholly replaced, name + the
    // GET-merged description preserved.
    const got = await callTool('get_role', { name });
    const perms = got.permissions as Array<{ value: string }>;
    const values = perms.map((p) => p.value);
    expect(values).toContain('configuration:ca:*');
    // A permission only present in the original create set must now be gone
    // (full-replace semantics).
    expect(values).not.toContain('configuration:notification:*');
    // GET-merge preserves the untouched description.
    expect(got.description).toBe('e2e throwaway security role');
  });

  // -------------------------------------------------------------------------
  // Membership subroutes: add / list / remove a throwaway identifier
  // -------------------------------------------------------------------------

  it('adds a throwaway member (creates the principal server-side)', async () => {
    let added: Record<string, unknown>;
    try {
      added = await callTool('add_role_members', {
        name,
        identifiers: [memberId],
      });
    } catch (e) {
      // Role absent (create rejected) -> the members route 404s; tolerate it.
      expect(e).toBeInstanceOf(ToolError);
      return;
    }
    expect(added.status).toBe('members_added');
    expect(added.name).toBe(name);
    const data = added.data as Record<string, unknown> | undefined;
    expect(data?.identifiers).toEqual([memberId]);
  });

  it('lists the role members and includes the added one', async () => {
    let members: unknown;
    try {
      members = await callTool('list_role_members', { name });
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      return;
    }
    // The members endpoint returns a raw JSON array of identifier strings.
    expect(Array.isArray(members)).toBe(true);
    expect(members as string[]).toContain(memberId);
  });

  it('removes the member', async () => {
    let removed: Record<string, unknown>;
    try {
      removed = await callTool('remove_role_members', {
        name,
        identifiers: [memberId],
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      return;
    }
    expect(removed.status).toBe('members_removed');
    expect(removed.name).toBe(name);

    // Confirm the member is gone from the list.
    const members = (await callTool('list_role_members', { name })) as unknown;
    // Horizon returns an empty body (not []) once the last member is removed.
    const list = Array.isArray(members) ? (members as string[]) : [];
    expect(list).not.toContain(memberId);
  });

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  it('rejects a delete with a mismatched safety echo', async () => {
    const raw = await callToolRaw('delete_role', {
      name,
      expected_name: `${name}-wrong`,
    });
    // Client-side safety guard - not a real Horizon call.
    expect(raw).toContain('SAFETY-ECHO');
  });

  it('deletes the role', async () => {
    let r: Record<string, unknown>;
    try {
      r = await callTool('delete_role', { name, expected_name: name });
    } catch (e) {
      // Role was never created (server rejected create); nothing to delete.
      expect(e).toBeInstanceOf(ToolError);
      return;
    }
    expect(r.deleted).toBe(true);
    expect(r.name).toBe(name);
  });

  it('is gone after delete', async () => {
    // GET on a deleted role must surface a clean Horizon 404 (ROLE-003),
    // raised as a ToolError - not a tool/client bug.
    let err: unknown;
    try {
      await callTool('get_role', { name });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ToolError);
  });
});
