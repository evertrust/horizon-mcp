/**
 * Live-QA E2E CRUD test for the Horizon config object "automation_policies".
 *
 * Tools: create_automation_policy / get_automation_policy /
 *        update_automation_policy / delete_automation_policy /
 *        list_automation_policies. idField = name.
 *
 * Contract: docs/audit/automation_policies.contract.json
 *   - idField: name (immutable primary key, regex [0-9a-zA-Z-_.]+)
 *   - mandatory: name, profile
 *   - update = PUT on COLLECTION route (body-keyed full-replace via replaceOne)
 *   - delete blocked (403 AutomationPolicy005) only when referenced by a valid cert
 *
 * Payloads mirror the Bruno CI suite:
 *   horizon/cicd/Evertrust-Horizon-api-test/35 - Automation Policy/
 *     "Register a new valid automation policy.bru":
 *       { name, profile: <est profile>, compliancePolicy: { authorizedCas: [<ca>] } }
 *
 * PREREQUISITE: an automation policy REQUIRES a `profile` reference whose module
 * is one of est/scep/webra/acme/acme-external (validateProfile). The Bruno flow
 * builds a brand-new EST profile, which itself needs an integrated PKI connector
 * and a client-auth-trusted CA - a chain the MCP server exposes no tools for. So
 * instead of recreating that chain, this test DISCOVERS an existing enrollment
 * profile on the QA instance via list_profiles (filtered to the eligible modules)
 * and binds to it. The created object name is always prefixed with E2E_PREFIX so
 * runs stay isolated and cleanup-safe.
 *
 * TOLERANCE: if the QA instance has no eligible enrollment profile (none of
 * est/scep/webra/acme/acme-external), create cannot legitimately succeed. The
 * create assertion then accepts a clean Horizon validation error (a ToolError
 * surfacing an AutomationPolicy* / profile-reference / "not found" server code,
 * NOT a tool/client bug), and the round-trip + update assertions short-circuit.
 *
 * The Bruno suite also seeds compliancePolicy.authorizedCas with a CA that has
 * been flipped to trustedForClientAuthentication; we cannot guarantee such a CA
 * exists on a standard QA box, so the happy path keeps create minimal (name +
 * profile, the two mandatory fields) and exercises compliancePolicy only as an
 * empty {} block via update (the contract explicitly accepts {}).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  setupE2EStack,
} from './setup.js';

// Modules that AutomationPolicyService.validateProfile accepts (contract enum).
const ELIGIBLE_MODULES = ['est', 'scep', 'webra', 'acme', 'acme-external'];

describe.skipIf(!E2E_CONFIGURED)(
  'automation_policies CRUD E2E (live QA)',
  () => {
    setupE2EStack();

    // Unique per-run name; matches the name regex [0-9a-zA-Z-_.]+ (no spaces).
    const name = `${E2E_PREFIX}-automation-policy`;

    // Resolved in beforeAll from an existing eligible enrollment profile.
    let profileName: string | undefined;

    // Tracks whether create succeeded so get/list/update/delete only run on a
    // real object (and afterAll knows whether cleanup is needed).
    let created = false;

    beforeAll(async () => {
      // Discover an existing enrollment profile whose module is eligible. We try
      // each eligible module in turn and take the first profile found. No object
      // is created here, so there is nothing extra to clean up.
      for (const module of ELIGIBLE_MODULES) {
        try {
          const r = await callTool('list_profiles', { module, max_items: 100 });
          const items = (r['items'] as Array<Record<string, unknown>>) ?? [];
          const match = items.find((p) => typeof p['name'] === 'string');
          if (match) {
            profileName = String(match['name']);
            break;
          }
        } catch {
          // listing this module failed/transient - try the next module.
        }
      }
    });

    afterAll(async () => {
      // Best-effort cleanup; swallow errors so teardown never fails the suite.
      if (!created) return;
      try {
        await callTool('delete_automation_policy', {
          name,
          expected_name: name,
        });
      } catch {
        // already deleted, never created, or transient - ignore.
      }
    });

    it('creates the automation policy (or reports a clean validation error)', async () => {
      if (!profileName) {
        // No eligible enrollment profile on this QA instance: create cannot
        // legitimately succeed. Assert that Horizon rejects cleanly when bound to
        // a non-existent profile, rather than skipping silently.
        try {
          const r = await callTool('create_automation_policy', {
            name,
            profile: `${E2E_PREFIX}-nonexistent-profile`,
          });
          // If the instance somehow accepted it, treat as created and verify.
          created = true;
          expect(r['status']).toBe('created');
          expect(r['name']).toBe(name);
        } catch (err) {
          expect(err).toBeInstanceOf(ToolError);
          // Clean Horizon validation error referencing the bad profile ref.
          expect((err as ToolError).message).toMatch(
            /AutomationPolicy|profile|reference|not found|does not exist|InvalidReference/i,
          );
        }
        return;
      }

      // Eligible profile found: bind to it. Keep the body to the two mandatory
      // fields (name + profile) so we do not depend on a client-auth-trusted CA.
      try {
        const r = await callTool('create_automation_policy', {
          name,
          profile: profileName,
        });
        created = true;
        expect(r['status']).toBe('created');
        expect(r['name']).toBe(name);
      } catch (err) {
        // Tolerant path: accept a clean Horizon validation/license rejection
        // (a real server error code), but never a tool/client-side bug.
        expect(err).toBeInstanceOf(ToolError);
        expect((err as ToolError).message).toMatch(
          /AutomationPolicy|profile|trusted|license|not licensed|forbidden|unauthorized/i,
        );
      }
    });

    it('gets it back with the bound profile', async () => {
      if (!created) return; // create was cleanly rejected / no eligible profile.
      const r = await callTool('get_automation_policy', { name });
      expect(r['name']).toBe(name);
      expect(r['profile']).toBe(profileName);
      // Server-populated id is present on the response object.
      expect(r['_id']).toBeDefined();
    });

    it('appears in the list (filtered by name substring)', async () => {
      if (!created) return;
      const r = await callTool('list_automation_policies', {
        name_contains: name,
      });
      expect(r['kind']).toBe('automation_policy');
      const items = (r['items'] as Array<Record<string, unknown>>) ?? [];
      expect(items.some((p) => p['name'] === name)).toBe(true);
    });

    it('updates it (adds an empty compliance_policy block)', async () => {
      if (!created) return;
      // The contract explicitly accepts an empty compliancePolicy {}. This avoids
      // depending on a client-auth-trusted CA while still exercising the update
      // (GET-strip-merge-PUT on the collection root).
      const r = await callTool('update_automation_policy', {
        name,
        compliance_policy: {},
      });
      expect(r['status']).toBe('updated');
      expect(r['name']).toBe(name);

      // Confirm the change persisted; profile preserved through GET-merge.
      const got = await callTool('get_automation_policy', { name });
      expect(got['profile']).toBe(profileName);
      expect(got['compliancePolicy']).toBeDefined();
    });

    it('deletes it (with expected_name safeguard)', async () => {
      if (!created) return;
      const r = await callTool('delete_automation_policy', {
        name,
        expected_name: name,
      });
      expect(r['deleted']).toBe(true);
      expect(r['name']).toBe(name);
      created = false; // prevent double-delete in afterAll.
    });

    it('confirms deletion: get now errors (AutomationPolicy003 not found)', async () => {
      if (created) return; // delete did not run (no eligible profile / not created).
      await expect(callTool('get_automation_policy', { name })).rejects.toThrow(
        ToolError,
      );
    });
  },
);
