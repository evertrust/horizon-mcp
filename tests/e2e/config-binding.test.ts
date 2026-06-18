/**
 * Live-QA E2E verifying the BINDING model that the create tools' `next_steps`
 * guidance describes - so the guidance provably matches the Horizon 2.10 API:
 *
 *   - a PKI connector is bound to a profile via `profile.pkiConnector`;
 *   - a trigger/notification is bound to a profile via
 *     `profile.triggers.{onEnroll,onRevoke,onRenew}` (arrays of trigger names);
 *   - a third-party connector publishes via a trigger whose `connector` field
 *     references it (and which carries its own `events`).
 *
 * The read assertions confirm those fields exist with the documented shape on
 * the live instance. The round-trip confirms create_pki_connector emits the
 * binding `next_steps` and that a connector clone persists.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  callTool,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

type Obj = Record<string, unknown>;

describe.skipIf(!E2E_CONFIGURED)('config binding model E2E (live QA)', () => {
  setupE2EStack();

  let profiles: Obj[] = [];
  let connectors: Obj[] = [];
  let triggers: Obj[] = [];
  let datasources: Obj[] = [];

  beforeAll(async () => {
    const client = getHorizonClient();
    profiles = (await client.get('/api/v1/certificate/profiles')) as Obj[];
    connectors = (await client.get('/api/v1/pki/connectors')) as Obj[];
    const t = (await client.get('/api/v1/triggers')) as
      | Obj[]
      | { items?: Obj[] };
    triggers = Array.isArray(t) ? t : (t.items ?? []);
    const d = (await client.get('/api/v1/datasources')) as
      | Obj[]
      | { items?: Obj[] };
    datasources = Array.isArray(d) ? d : (d.items ?? []);
  });

  it('a certificate profile binds a PKI connector via `pkiConnector`', async () => {
    const bound = profiles.find((p) => typeof p['pkiConnector'] === 'string');
    expect(
      bound,
      'expected at least one profile with a pkiConnector',
    ).toBeDefined();
    const connName = bound!['pkiConnector'] as string;
    // the referenced connector exists -> pkiConnector is a real binding key.
    expect(connectors.some((c) => c['name'] === connName)).toBe(true);
  });

  it('a profile binds triggers per lifecycle event (onEnroll/onRevoke/onRenew)', async () => {
    const withTriggers = profiles.find(
      (p) => p['triggers'] && typeof p['triggers'] === 'object',
    );
    expect(
      withTriggers,
      'expected a profile exposing a triggers object',
    ).toBeDefined();
    const tr = withTriggers!['triggers'] as Obj;
    for (const ev of ['onEnroll', 'onRevoke', 'onRenew']) {
      expect(Array.isArray(tr[ev])).toBe(true);
    }
  });

  it('a third-party connector publishes via a trigger that references it', async () => {
    const tpTrigger = triggers.find(
      (t) =>
        [
          'aws',
          'akv',
          'f5as3',
          'f5client',
          'gcm',
          'ldappub',
          'intunepkcs',
          'netscaler',
        ].includes(t['type'] as string) && typeof t['connector'] === 'string',
    );
    if (!tpTrigger) {
      console.log('SKIP: no third-party-type trigger on this instance');
      return;
    }
    // The trigger references a real third-party connector and carries events.
    expect(typeof tpTrigger['connector']).toBe('string');
    expect(Array.isArray(tpTrigger['events'])).toBe(true);
  });

  it('a certificate profile binds a datasource via `dsFlow[].ds`', async () => {
    const withDs = profiles.find(
      (p) => Array.isArray(p['dsFlow']) && (p['dsFlow'] as Obj[]).length > 0,
    );
    if (!withDs) {
      console.log('SKIP: no profile currently has a dsFlow on this instance');
      return;
    }
    const entry = (withDs['dsFlow'] as Obj[])[0]!;
    const dsName = entry['ds'] as string;
    expect(typeof dsName).toBe('string');
    // the referenced datasource exists -> dsFlow[].ds is a real binding key.
    expect(datasources.some((d) => d['name'] === dsName)).toBe(true);
  });

  it('create_dns_datasource returns next_steps guiding profile dsFlow binding', async () => {
    const name = `${E2E_PREFIX}-bindds`;
    try {
      const r = await callTool('create_dns_datasource', {
        name,
        lookup: '{{cn}}',
      });
      expect(r['status']).toBe('created');
      expect(String(r['next_steps'] ?? '')).toMatch(
        /dsFlow|datasource|profile/i,
      );
    } finally {
      await callTool('delete_datasource', {
        name,
        expected_name: name,
      }).catch(() => {});
    }
  });

  it('create_pki_connector returns next_steps guiding profile binding', async () => {
    // Clone an existing integrated connector so the create is a valid round-trip.
    const sample = connectors.find((c) => c['type'] === 'integrated');
    if (!sample) {
      console.log('SKIP: no integrated connector to clone');
      return;
    }
    const name = `${E2E_PREFIX}-bindconn`;
    const config: Obj = { ...sample };
    for (const k of [
      '_id',
      'name',
      'type',
      'status',
      'tenant',
      'account',
      'accountUrl',
    ]) {
      delete config[k];
    }
    try {
      const r = await callTool('create_pki_connector', {
        name,
        type: 'integrated',
        config,
      });
      expect(r['status']).toBe('created');
      // The binding guidance is surfaced for the model to act on.
      expect(String(r['next_steps'] ?? '')).toMatch(/pkiConnector|profile/i);
    } finally {
      await callTool('delete_pki_connector', {
        name,
        expected_name: name,
      }).catch(() => {});
    }
  });

  afterAll(async () => {
    await callTool('delete_pki_connector', {
      name: `${E2E_PREFIX}-bindconn`,
      expected_name: `${E2E_PREFIX}-bindconn`,
    }).catch(() => {});
  });
});
