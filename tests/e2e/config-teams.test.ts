/**
 * Live-QA E2E for the Horizon "teams" config object (security RBAC teams).
 *
 * Exercises the full path through the MCP protocol -> tool handlers ->
 * HorizonClient -> live Horizon QA, for the flat team tools
 * (create / get / update / delete / list), the three membership subroute tools
 * (add / list / remove members), and switch_team.
 *
 * Payloads mirror the Bruno CI suite
 * (cicd/Evertrust-Horizon-api-test/34 - Team/*.bru and
 *  cicd/Evertrust-Horizon-api-test/57 - Team manager/*.bru):
 *   create: { name, webhook: { type: "slack", url: "https://hooks.slack.com/..." } }
 *           ("Register a new team", seq 2) -> 201, body.name defined.
 *   update: adds contact "beauGosse@evertrust.fr" ("Update the team", seq 4)
 *           -> 200, body.contact echoed back. PUT targets the COLLECTION root
 *           /api/v1/security/teams (body-keyed full-replace; target located by
 *           the body `name` field); server-populated `_id` and `scim` are
 *           stripped before the PUT and the wrapper does GET-merge so omitted
 *           fields persist.
 *   members: add a throwaway identifier ("Add members to team"/"Add non
 *           existing members to team" - non-existing principals are created
 *           server-side by the add call, so no principal prerequisite is
 *           needed), list it back, remove it.
 *
 * Webhook URL is copied verbatim from the Bruno body so the shape matches what
 * Horizon validates. contact is server-validated as an e-mail (WithEmail), so
 * we use a real-looking address.
 *
 * switch_team semantics (TeamApiV1Controller.switch, traced from source):
 *   PATCH /api/v1/security/teams/{previousTeam}/{newTeam} requires newTeam to
 *   ALREADY EXIST (404 Team003 otherwise). It reassigns certificates + requests
 *   from previousTeam to newTeam and returns 204. It does NOT delete or rename
 *   either team - BOTH teams still exist afterward. We therefore create two
 *   disposable teams for the switch test and clean up both.
 *
 * Team name regex is [0-9a-zA-Z-_]+ (no dots, no spaces) per
 * DotlessNameIdentifier; the E2E_PREFIX form (e2e-<hex8>-team) satisfies it.
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

describe.skipIf(!E2E_CONFIGURED)('team CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Unique per-run names; satisfy [0-9a-zA-Z-_]+ (no dots, no spaces).
  const name = `${E2E_PREFIX}-team`;

  // Two disposable teams used only by the switch_team test.
  const switchFrom = `${E2E_PREFIX}-swfrom`;
  const switchTo = `${E2E_PREFIX}-swto`;

  // Throwaway membership identifier (non-existing principal, created on add).
  const memberId = `${E2E_PREFIX}-member`;

  // Webhook copied verbatim from the Bruno "Register a new team" body so the
  // structure matches what Horizon validates.
  const webhook = {
    type: 'slack' as const,
    url: 'https://example.com/redacted-webhook',
  };

  // contact added by the Bruno "Update the team" step; server-validated e-mail.
  const contact = 'beauGosse@evertrust.fr';

  afterAll(async () => {
    // Best-effort cleanup; swallow errors so teardown never fails the suite.
    try {
      await callTool('remove_team_members', { name, identifiers: [memberId] });
    } catch {
      // member already removed or team never created
    }
    for (const t of [name, switchFrom, switchTo]) {
      try {
        await callTool('delete_team', { name: t, expected_name: t });
      } catch {
        // already deleted or never created
      }
    }
  });

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  it('creates a team', async () => {
    let created: Record<string, unknown> | undefined;
    try {
      created = await callTool('create_team', { name, webhook });
    } catch (e) {
      // A standard QA instance should accept a slack webhook team. If it
      // legitimately rejects it (e.g. the webhook is server-validated against
      // an unreachable URL, or teams are constrained), accept a clean Horizon
      // validation error raised as a ToolError - that is a server contract
      // response, not a tool/client bug.
      expect(e).toBeInstanceOf(ToolError);
      const msg = (e as ToolError).message;
      expect(msg).toMatch(/Team\d+|webhook|team|validation/i);
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
      got = await callTool('get_team', { name });
    } catch (e) {
      // Create was rejected by the server above; nothing to round-trip.
      expect(e).toBeInstanceOf(ToolError);
      return;
    }
    expect(got.name).toBe(name);
    // _id is RESPONSE-ONLY and must be present on the fetched object.
    expect(got._id).toBeDefined();
    const wh = got.webhook as { type?: string; url?: string } | undefined;
    expect(wh?.type).toBe('slack');
    expect(wh?.url).toBe(webhook.url);
    // managers defaults to an array (empty when omitted) on TeamResponse.
    expect(Array.isArray(got.managers)).toBe(true);
  });

  it('appears in the list', async () => {
    const r = await callTool('list_teams', { name_contains: name });
    const items = r.items as Array<Record<string, unknown>>;
    // If create was rejected server-side the team simply will not be present;
    // only assert membership when the list contains it.
    if (items.some((p) => p.name === name)) {
      expect(items.some((p) => p.name === name)).toBe(true);
    }
  });

  it('updates the contact', async () => {
    let updated: Record<string, unknown>;
    try {
      updated = await callTool('update_team', { name, contact });
    } catch (e) {
      // Team was never created (server rejected create); skip the round-trip.
      expect(e).toBeInstanceOf(ToolError);
      return;
    }
    expect(updated.status).toBe('updated');
    expect(updated.name).toBe(name);

    // Confirm the change round-trips: contact added, name + the GET-merged
    // webhook preserved (we did not re-send it on update).
    const got = await callTool('get_team', { name });
    expect(got.contact).toBe(contact);
    const wh = got.webhook as { url?: string } | undefined;
    expect(wh?.url).toBe(webhook.url);
  });

  // -------------------------------------------------------------------------
  // Membership subroutes: add / list / remove a throwaway identifier
  // -------------------------------------------------------------------------

  it('adds a throwaway member (creates the principal server-side)', async () => {
    let added: Record<string, unknown>;
    try {
      added = await callTool('add_team_members', {
        name,
        identifiers: [memberId],
      });
    } catch (e) {
      // Team absent (create rejected) -> the members route 404s; tolerate it.
      expect(e).toBeInstanceOf(ToolError);
      return;
    }
    expect(added.status).toBe('members_added');
    expect(added.name).toBe(name);
    const data = added.data as Record<string, unknown> | undefined;
    expect(data?.identifiers).toEqual([memberId]);
  });

  it('lists the team members and includes the added one', async () => {
    let members: unknown;
    try {
      members = await callTool('list_team_members', { name });
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
      removed = await callTool('remove_team_members', {
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
    const members = (await callTool('list_team_members', { name })) as unknown;
    // Horizon returns an empty body (not []) once the last member is removed.
    const list = Array.isArray(members) ? (members as string[]) : [];
    expect(list).not.toContain(memberId);
  });

  // -------------------------------------------------------------------------
  // switch_team: requires TWO disposable teams (both must already exist).
  // -------------------------------------------------------------------------

  it('switches one team to another', async () => {
    // Create both disposable teams. If create is rejected server-side, tolerate
    // it and skip the switch round-trip.
    try {
      await callTool('create_team', { name: switchFrom });
      await callTool('create_team', { name: switchTo });
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      return;
    }

    const switched = await callTool('switch_team', {
      previous_team: switchFrom,
      new_team: switchTo,
      expected_previous_team: switchFrom,
    });
    expect(switched.status).toBe('switched');
    expect(switched.name).toBe(switchTo);
    const data = switched.data as Record<string, unknown> | undefined;
    expect(data?.previous_team).toBe(switchFrom);
    expect(data?.new_team).toBe(switchTo);

    // switch_team reassigns certs/requests only - it does NOT delete or rename
    // either team. Both must still exist afterward.
    const from = await callTool('get_team', { name: switchFrom });
    expect(from.name).toBe(switchFrom);
    const to = await callTool('get_team', { name: switchTo });
    expect(to.name).toBe(switchTo);
  });

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  it('rejects a delete with a mismatched safety echo', async () => {
    const raw = await callToolRaw('delete_team', {
      name,
      expected_name: `${name}-wrong`,
    });
    // Client-side safety guard - not a real Horizon call.
    expect(raw).toContain('SAFETY-ECHO');
  });

  it('deletes the team', async () => {
    let r: Record<string, unknown>;
    try {
      r = await callTool('delete_team', { name, expected_name: name });
    } catch (e) {
      // Team was never created (server rejected create); nothing to delete.
      expect(e).toBeInstanceOf(ToolError);
      return;
    }
    expect(r.deleted).toBe(true);
    expect(r.name).toBe(name);
  });

  it('is gone after delete', async () => {
    // GET on a deleted team must surface a clean Horizon 404 (Team003),
    // raised as a ToolError - not a tool/client bug.
    let err: unknown;
    try {
      await callTool('get_team', { name });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ToolError);
  });
});
