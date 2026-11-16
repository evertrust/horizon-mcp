/**
 * Live-QA E2E CRUD test for the Horizon "pki_connectors" config object.
 *
 * PKI connectors are polymorphic (24 subtypes discriminated by the lowercase
 * `type` field). We exercise the SIMPLEST subtype that has no external
 * dependency on a standard QA instance: `integrated` (the Evertrust built-in
 * Integrated CA backend). Unlike `stream` (needs a reachable endPoint + a real
 * CA + credentials), `integrated` only needs the mandatory `cryptoType` field.
 *
 * Minimal valid payload: {name, type:"integrated", certType:"client", signAlg:"SHA256",
 * worker:5, cryptoType:"legacy"}. The `worker` field is NOT a known top-level
 * key in the MCP tool's allow-list (assertConfigBody would reject it), so it is
 * dropped - it is an optional async-worker tuning field, not required for create.
 *
 * Subtype-specific fields are passed via the `config` arg per the polymorphic
 * tool shape (src/tools/config/pki-connectors.ts). Update flips signAlg
 * SHA256 -> SHA512.
 *
 * No prerequisite deps are created: `integrated` references no CA, queue,
 * proxy, or credentials object, so the suite is fully self-contained.
 *
 * On Horizon 2.12 or later, a second block creates, reads and deletes a
 * `digicert_one` connector. It creates the raw credentials the connector
 * references and deletes them afterwards. On older versions it skips.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  callToolRaw,
  getHorizonClient,
  isHorizonAtLeast,
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
        /PKI-CONNECTOR-|license|entitlement|integrated|crypto/i,
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

  describe('Horizon 2.12 digicert_one connector', () => {
    const connector = `${E2E_PREFIX}-digicert-one`;
    const credentials = `${E2E_PREFIX}-digicert-one-creds`;
    let is212 = false;

    beforeAll(async () => {
      is212 = await isHorizonAtLeast(2, 12);
      if (!is212) return;
      await getHorizonClient().post('/api/v1/security/credentials', {
        name: credentials,
        type: 'raw',
        secret: { value: 'example-api-key' },
        targets: ['pkiconnector'],
      });
    });

    beforeEach((ctx) => {
      if (!is212) ctx.skip();
    });

    afterAll(async () => {
      if (!is212) return;
      try {
        await callTool('delete_pki_connector', {
          name: connector,
          expected_name: connector,
        });
      } catch {
        // Already deleted by the test, or never created.
      }
      try {
        await getHorizonClient().delete(
          `/api/v1/security/credentials/${encodeURIComponent(credentials)}`,
        );
      } catch {
        // Never created.
      }
    });

    it('creates, reads and deletes a digicert_one connector', async () => {
      const seat = { type: 'static', id: 'server-seat' };
      const created = await callTool('create_pki_connector', {
        name: connector,
        type: 'digicert_one',
        config: {
          baseUrl: 'https://digicert-one.example.com/',
          apiCredentials: credentials,
          profileId: '36f011b7-5fa1-4c6d-83f3-ee59c4d54bb0',
          seat,
          retryInterval: '5 seconds',
        },
      });
      expect(created.status).toBe('created');

      const read = await callTool('get_pki_connector', { name: connector });
      expect(read.type).toBe('digicert_one');
      expect(read.apiCredentials).toBe(credentials);
      expect(read.seat).toEqual(seat);

      const deleted = await callTool('delete_pki_connector', {
        name: connector,
        expected_name: connector,
      });
      expect(deleted.deleted).toBe(true);
    });
  });
});
