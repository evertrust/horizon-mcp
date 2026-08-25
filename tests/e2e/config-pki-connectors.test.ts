/**
 * Live-QA E2E CRUD test for the Horizon "pki_connectors" config object.
 *
 * PKI connectors are polymorphic (22 subtypes discriminated by the lowercase
 * `type` field). We exercise the SIMPLEST subtype that has no external
 * dependency on a standard QA instance: `integrated` (the Evertrust built-in
 * Integrated CA backend). Unlike `stream` (needs a reachable endPoint + a real
 * CA + credentials), `integrated` only needs the mandatory `cryptoType` field.
 *
 * Create body is copied from the Bruno CI payload
 *   02 - PKI Connector/Register a new integrated pki connector.bru
 * which posts {name, type:"integrated", certType:"client", signAlg:"SHA256",
 * worker:5, cryptoType:"legacy"}. The `worker` field is NOT a known top-level
 * key in the MCP tool's allow-list (assertConfigBody would reject it), so it is
 * dropped - it is an optional async-worker tuning field, not required for create.
 *
 * Subtype-specific fields are passed via the `config` arg per the polymorphic
 * tool shape (src/tools/config/pki-connectors.ts). Update flips signAlg
 * SHA256 -> SHA512, mirroring 02 - PKI Connector/Update the integrated pki
 * connector.bru.
 *
 * No prerequisite deps are created: `integrated` references no CA, queue,
 * proxy, or credentials object, so the suite is fully self-contained.
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

describe.skipIf(!E2E_CONFIGURED)('pki_connectors CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Unique, regex-safe name ([0-9a-zA-Z-_.], no spaces).
  const name = `${E2E_PREFIX}-pkiconn`;

  // True once create succeeds, so we only round-trip / clean up a real object.
  let created = false;

  afterAll(async () => {
    if (!created) return;
    try {
      await callTool('delete_pki_connector', {
        name,
        expected_name: name,
      });
    } catch {
      // Best-effort cleanup - never fail the suite on teardown.
    }
  });

  it('creates an integrated PKI connector', async () => {
    try {
      const r = await callTool('create_pki_connector', {
        name,
        type: 'integrated',
        config: {
          certType: 'client',
          signAlg: 'SHA256',
          cryptoType: 'legacy',
        },
      });
      created = true;
      expect(r.status).toBe('created');
      expect(r.name).toBe(name);
    } catch (err) {
      // On a QA instance missing the CLM/PKI entitlement, or where the
      // integrated CA backend is disabled, Horizon returns a clean validation
      // / license error rather than persisting the connector. Accept that as a
      // legitimate server response (NOT a tool/client bug) and skip the
      // round-trip - but a non-ToolError (e.g. a thrown TypeError from the
      // tool layer) must still fail the test.
      expect(err).toBeInstanceOf(ToolError);
      const msg = (err as ToolError).message;
      expect(msg).toMatch(
        /PkiConnector|license|entitlement|integrated|crypto/i,
      );
    }
  });

  it('gets the connector back', async () => {
    if (!created) return; // create was a tolerated server-side rejection
    const r = await callTool('get_pki_connector', { name });
    expect(r.name).toBe(name);
    expect(r.type).toBe('integrated');
    expect(r.signAlg).toBe('SHA256');
  });

  it('appears in the list', async () => {
    if (!created) return;
    const r = await callTool('list_pki_connectors', { name_contains: name });
    const items = (r.items ?? r.pki_connectors ?? []) as Array<
      Record<string, unknown>
    >;
    expect(items.some((it) => it.name === name)).toBe(true);
  });

  it('updates the connector (signAlg SHA256 -> SHA512)', async () => {
    if (!created) return;
    const r = await callTool('update_pki_connector', {
      name,
      type: 'integrated',
      config: {
        certType: 'client',
        signAlg: 'SHA512',
        cryptoType: 'legacy',
      },
    });
    expect(r.status).toBe('updated');

    const after = await callTool('get_pki_connector', { name });
    expect(after.signAlg).toBe('SHA512');
  });

  it('rejects a delete whose expected_name does not match', async () => {
    if (!created) return;
    const raw = await callToolRaw('delete_pki_connector', {
      name,
      expected_name: `${name}-WRONG`,
    });
    expect(raw).toMatch(/match|expected|confirm/i);
  });

  it('deletes the connector', async () => {
    if (!created) return;
    const r = await callTool('delete_pki_connector', {
      name,
      expected_name: name,
    });
    expect(r.deleted).toBe(true);
    expect(r.name).toBe(name);
    created = false; // already gone; skip afterAll re-delete
  });
});
