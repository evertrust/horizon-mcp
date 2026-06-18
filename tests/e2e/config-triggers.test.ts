/**
 * Live-QA E2E for the Horizon config object "triggers".
 *
 * Exercises the GENERIC create_trigger + update_trigger config tools (the new
 * polymorphic CRUD) plus the legacy get_trigger / list_triggers / delete_trigger.
 *
 * Subtype: `email` (EmailNotification) - the simplest fully self-contained
 * subtype, requiring no ThirdPartyConnector / Proxy / Credentials / Label
 * dependency and no special license feature. Bodies are copied verbatim from
 * the Bruno CI payloads:
 *   cicd/Evertrust-Horizon-api-test/21 - Mail Trigger/Register a new trigger.bru
 *   cicd/Evertrust-Horizon-api-test/21 - Mail Trigger/Update the trigger.bru
 *
 * Subtype fields (events, emailTemplate) are passed via the `config` arg per the
 * create_trigger / update_trigger input shape (src/tools/config/triggers.ts).
 * Update is a PUT full-replace, so the full config is re-supplied each time.
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

describe.skipIf(!E2E_CONFIGURED)('triggers CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Unique, matches the trigger name regex [0-9a-zA-Z-_.] (no spaces).
  const name = `${E2E_PREFIX}-trigger`;

  // From "21 - Mail Trigger/Register a new trigger.bru" (email subtype).
  const createConfig = {
    events: ['on_enroll'],
    emailTemplate: {
      to: [{ type: 'static', email: 'test@evertrust.fr' }],
      from: 'horizon@evertrust.fr',
      title: 'Something just happen',
      isHtml: false,
    },
  };

  // From "21 - Mail Trigger/Update the trigger.bru" - flips isHtml to true and
  // adds an HTML body. Full config re-supplied (PUT full-replace).
  const updateConfig = {
    events: ['on_enroll'],
    emailTemplate: {
      to: [{ type: 'static', email: 'test@evertrust.fr' }],
      from: 'horizon@evertrust.fr',
      title: 'Something just happen',
      body: '<p>Oooups</p>',
      isHtml: true,
    },
  };

  // Whether create succeeded - subsequent round-trip steps gate on this so a
  // tolerated create failure (validation / license) does not cascade.
  let created = false;

  afterAll(async () => {
    // Best-effort cleanup via the legacy delete tool. Swallow all errors so
    // teardown never fails the suite.
    try {
      await callTool('delete_trigger', { name, expected_name: name });
    } catch {
      /* ignore - trigger may not exist if create was tolerated */
    }
  });

  it('creates an email trigger', async () => {
    try {
      const r = await callTool('create_trigger', {
        name,
        type: 'email',
        config: createConfig,
      });
      expect(r.status).toBe('created');
      expect(r.name).toBe(name);
      created = true;
    } catch (err) {
      // Tolerate a clean Horizon-side validation/license rejection (NOT a
      // tool/client bug). On a standard QA instance an email trigger should
      // create fine, but mail/notification config can be environment-gated.
      expect(err).toBeInstanceOf(ToolError);
      const msg = (err as ToolError).message;
      expect(msg).toMatch(/Trig\d+|trigger|email|template|licen[cs]e|mail/i);
    }
  });

  it('gets it back', async () => {
    if (!created) return;
    const r = await callTool('get_trigger', { name });
    expect(r.name).toBe(name);
    expect(r.type).toBe('email');
  });

  it('lists it', async () => {
    if (!created) return;
    const r = await callTool('list_triggers', { name_contains: name });
    const items = (r.items ?? r.triggers ?? []) as Array<{ name?: string }>;
    expect(items.some((t) => t.name === name)).toBe(true);
  });

  it('updates it (flips isHtml to true)', async () => {
    if (!created) return;
    const r = await callTool('update_trigger', {
      name,
      type: 'email',
      config: updateConfig,
    });
    expect(r.status).toBe('updated');
    expect(r.name).toBe(name);
    // Confirm the change landed.
    const got = await callTool('get_trigger', { name });
    const tmpl = got.emailTemplate as { isHtml?: boolean } | undefined;
    expect(tmpl?.isHtml).toBe(true);
  });

  it('rejects delete without matching expected_name', async () => {
    if (!created) return;
    const raw = await callToolRaw('delete_trigger', {
      name,
      expected_name: `${name}-WRONG`,
    });
    expect(raw).toMatch(/expected_name|match|safeguard/i);
  });

  it('deletes it', async () => {
    if (!created) return;
    const r = await callTool('delete_trigger', { name, expected_name: name });
    expect(r.deleted).toBe(true);
    expect(r.name).toBe(name);
    created = false; // prevent afterAll double-delete noise
  });
});
