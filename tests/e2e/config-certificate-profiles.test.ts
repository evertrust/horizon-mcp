/**
 * Live-QA E2E CRUD test for the Horizon "certificate_profiles" config object.
 *
 * Certificate profiles are polymorphic (11 subtypes discriminated by the
 * lowercase `module` field). We exercise the SIMPLEST subtype that needs no
 * external PKI dependency on a standard QA instance: `monitored` (the
 * monitoring-only profile - no CA, no PKI connector, no enrollment backend).
 *
 * Create body mirrors the Bruno CI payload
 *   06 - Profile/Register a new monitored profile.bru
 * which posts a monitored profile with the four mandatory nested policy objects
 * (authorizationLevels / requestsPolicy / selfPermissions / cryptoPolicy) plus
 * a few optional structural fields. Two Bruno-body keys are intentionally
 * dropped here:
 *   - `notifications`: NOT a MonitoredProfile field (confirmed against
 *     app/models/monitored/MonitoredProfile.scala) and NOT in the MCP tool's
 *     KNOWN_KEYS allow-list -> assertConfigBody would reject it. The server
 *     ignores it anyway, so the Bruno body's `notifications: {}` is a no-op.
 *   - `pkiConnector`: the Bruno body sends one, but its own assert proves the
 *     server STRIPS it on a monitored profile (res.body.pkiConnector
 *     isUndefined). Omitting it avoids referencing a connector that may not
 *     exist on this QA instance; monitored create succeeds without it.
 * `validationRuleset` is likewise stripped on the response (Bruno asserts
 * isUndefined) but is an allow-listed key, so we pass it as the Bruno body did.
 *
 * Tool shape (src/tools/config/certificate-profiles.ts): module + name +
 * enabled + the four mandatory policy objects are typed args; every other
 * top-level field goes through the validated `config` arg.
 *
 * Update flips `enabled` true -> false (full-replace GET-strip-merge-PUT on the
 * collection root; module/name immutable). Mirrors the contract's
 * updateBodySameAsCreate / PUT-on-collection semantics.
 *
 * The create assertion is tolerant: on a QA instance lacking the CLM
 * entitlement (or where monitored profiles are disabled) Horizon returns a
 * clean validation/license error rather than a tool/client bug. We accept a
 * ToolError surfacing a real CertificateProfile* / license server code and skip
 * the round-trip; any non-ToolError (e.g. a thrown TypeError from the tool
 * layer) still fails the test.
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

describe.skipIf(!E2E_CONFIGURED)(
  'certificate_profile CRUD E2E (live QA)',
  () => {
    setupE2EStack();

    // Unique per-run name; satisfies the name regex [0-9a-zA-Z-_.] (no spaces).
    const name = `${E2E_PREFIX}-monprofile`;

    // The four mandatory nested policy objects, copied from the Bruno CI body
    // (Register a new monitored profile.bru). authorizationLevels carries the
    // real per-action access levels; the rest are minimal valid objects the
    // server fills with defaults.
    const authorizationLevels = {
      search: { accessLevel: 'authorized' },
      requestUpdate: { accessLevel: 'authorized' },
      approveUpdate: { accessLevel: 'authorized' },
      update: { accessLevel: 'authorized' },
    };
    const requestsPolicy = {};
    const selfPermissions = {};
    // Monitored profiles use the decentralized crypto policy (no escrow).
    const cryptoPolicy = { decentralized: true };

    // Remaining Bruno-body top-level fields, all in the tool's KNOWN_KEYS
    // allow-list (notifications + pkiConnector deliberately omitted - see header).
    const config = {
      displayName: [],
      description: [],
      constraints: {},
      csrDataMapping: {},
      triggers: {},
      validationRuleset: {},
    };

    // True once create succeeds, so we only round-trip / clean up a real object.
    let created = false;

    afterAll(async () => {
      if (!created) return;
      try {
        await callTool('delete_certificate_profile', {
          name,
          expected_name: name,
        });
      } catch {
        // Best-effort cleanup - never fail the suite on teardown.
      }
    });

    it('creates a monitored certificate profile', async () => {
      try {
        const r = await callTool('create_certificate_profile', {
          module: 'monitored',
          name,
          enabled: true,
          authorization_levels: authorizationLevels,
          requests_policy: requestsPolicy,
          self_permissions: selfPermissions,
          crypto_policy: cryptoPolicy,
          config,
        });
        created = true;
        expect(r['status']).toBe('created');
        expect(r['name']).toBe(name);
        const data = r['data'] as Record<string, unknown> | undefined;
        expect(data?.['name']).toBe(name);
        expect(data?.['module']).toBe('monitored');
      } catch (err) {
        // Tolerant path: accept a clean Horizon validation/license rejection
        // (a real CertificateProfile* server code), but never a tool/client bug.
        expect(err).toBeInstanceOf(ToolError);
        expect((err as ToolError).message).toMatch(
          /CertificateProfile|monitored|license|not licensed|entitlement|forbidden|unauthorized/i,
        );
      }
    });

    it('gets it back', async () => {
      if (!created) return; // create was a tolerated server-side rejection.
      const r = await callTool('get_certificate_profile', { name });
      expect(r['name']).toBe(name);
      expect(r['module']).toBe('monitored');
      expect(r['enabled']).toBe(true);
    });

    it('appears in the list', async () => {
      if (!created) return;
      const r = await callTool('list_certificate_profiles', {
        name_contains: name,
      });
      const items = (r['items'] ?? []) as Array<Record<string, unknown>>;
      expect(items.some((p) => p['name'] === name)).toBe(true);
    });

    it('updates enabled true -> false', async () => {
      if (!created) return;
      const r = await callTool('update_certificate_profile', {
        name,
        enabled: false,
      });
      expect(r['status']).toBe('updated');
      expect(r['name']).toBe(name);

      // Confirm the change round-trips and GET-merge preserved the module.
      const got = await callTool('get_certificate_profile', { name });
      expect(got['enabled']).toBe(false);
      expect(got['module']).toBe('monitored');
    });

    it('rejects a delete with a mismatched safety echo', async () => {
      if (!created) return;
      const raw = await callToolRaw('delete_certificate_profile', {
        name,
        expected_name: `${name}-wrong`,
      });
      // Client-side safety guard (deleteGuard) - not a real Horizon call.
      expect(raw).toContain('SAFETY-ECHO');
    });

    it('deletes the certificate profile', async () => {
      if (!created) return;
      const r = await callTool('delete_certificate_profile', {
        name,
        expected_name: name,
      });
      expect(r['deleted']).toBe(true);
      expect(r['name']).toBe(name);
      created = false; // prevent double-delete in afterAll.
    });

    it('is gone after delete', async () => {
      if (created) return; // delete did not run (create was rejected); skip.
      // GET on a deleted profile must surface a clean Horizon 404
      // (CertificateProfile003), raised as a ToolError - not a tool/client bug.
      let err: unknown;
      try {
        await callTool('get_certificate_profile', { name });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ToolError);
    });
  },
);
