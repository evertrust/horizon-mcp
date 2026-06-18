/**
 * Live-QA E2E for the Horizon "certificate_labels" config object.
 *
 * Exercises the full CRUD path through the MCP protocol -> tool handlers ->
 * HorizonClient -> live Horizon QA, for the flat certificate-label tools
 * (create / get / list / update / delete).
 *
 * Payloads mirror the Bruno CI suite
 * (cicd/Evertrust-Horizon-api-test/07 - Certificate Label/*.bru):
 *   create:  { name, displayName: [], description: [] }
 *   update:  resends body keyed on name (full-replace)
 * mapped to the MCP tool's snake_case inputs. The Bruno create body also sends a
 * `regex` field, but that is NOT part of the audited Label request schema
 * (#/components/schemas/Label only exposes name/displayName/description), so the
 * MCP create tool does not surface it and the server ignores it; we omit it.
 *
 * The update tool PUTs the COLLECTION root (body-keyed full-replace; the target
 * is located by the body `name` field, not the URL). The wrapper does
 * GET -> strip _id -> merge -> PUT, so omitted optional fields persist.
 *
 * `name` is the immutable primary key, server-validated against [0-9a-zA-Z-_]+
 * (NO dots). E2E_PREFIX is `e2e-<hex8>` (hyphen only), so the name below is
 * dot-free and regex-safe.
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

describe.skipIf(!E2E_CONFIGURED)('certificate_label CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Unique per-run name; satisfies [0-9a-zA-Z-_]+ (NO dots, no spaces).
  const name = `${E2E_PREFIX}-clabel`;

  afterAll(async () => {
    // Best-effort cleanup; swallow errors so teardown never fails the suite.
    try {
      await callTool('delete_certificate_label', {
        name,
        expected_name: name,
      });
    } catch {
      // already deleted or never created
    }
  });

  it('creates a certificate label', async () => {
    // Bruno body: { name, displayName: [], description: [] }.
    const r = await callTool('create_certificate_label', {
      name,
      display_name: [],
      description: [],
    });
    expect(r.status).toBe('created');
    expect(r.name).toBe(name);
    const data = r.data as Record<string, unknown> | undefined;
    expect(data?.name).toBe(name);
  });

  it('gets it back', async () => {
    const r = await callTool('get_certificate_label', { name });
    expect(r.name).toBe(name);
    // _id is RESPONSE-ONLY and must be present on the fetched object.
    expect(r._id).toBeDefined();
  });

  it('appears in the list', async () => {
    const r = await callTool('list_certificate_labels', {
      name_contains: name,
    });
    const items = r.items as Array<Record<string, unknown>>;
    expect(items.some((l) => l.name === name)).toBe(true);
  });

  it('updates the localized display name', async () => {
    // Beyond the Bruno round-trip (which resends empties), set a real localized
    // display name so the update is observable on the GET round-trip.
    const r = await callTool('update_certificate_label', {
      name,
      display_name: [{ lang: 'en', value: 'Business Unit' }],
    });
    expect(r.status).toBe('updated');
    expect(r.name).toBe(name);

    // Confirm the change round-trips. The wrapper's GET-merge means name (the
    // immutable key) is preserved through the full-replace PUT.
    const got = await callTool('get_certificate_label', { name });
    expect(got.name).toBe(name);
    const display = got.displayName as
      | Array<Record<string, unknown>>
      | undefined;
    expect(
      display?.some((d) => d.lang === 'en' && d.value === 'Business Unit'),
    ).toBe(true);
  });

  it('rejects a delete with a mismatched safety echo', async () => {
    const raw = await callToolRaw('delete_certificate_label', {
      name,
      expected_name: `${name}-wrong`,
    });
    // Client-side safety guard - not a real Horizon call.
    expect(raw).toContain('SAFETY-ECHO');
  });

  it('deletes the certificate label', async () => {
    const r = await callTool('delete_certificate_label', {
      name,
      expected_name: name,
    });
    expect(r.deleted).toBe(true);
    expect(r.name).toBe(name);
  });

  it('is gone after delete', async () => {
    // GET on a deleted label must surface a clean Horizon 404 (CertLabel003),
    // raised as a ToolError - not a tool/client bug.
    let err: unknown;
    try {
      await callTool('get_certificate_label', { name });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ToolError);
  });
});
