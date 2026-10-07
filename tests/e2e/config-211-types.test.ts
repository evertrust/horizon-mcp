/**
 * Live-QA E2E coverage for the configuration types added in Horizon 2.11:
 *   - Third-party connectors and triggers: fortigate, fortimanager,
 *     panos_firewall, panos_panorama.
 *   - DCV provider: sectigo.
 *   - ACME profile field: excludeRootCA.
 *
 * The describe_* checks are local and run on every version. The live
 * create -> get -> delete legs run only when the instance reports Horizon
 * 2.11 or later; on older versions they skip.
 *
 * The test creates the credentials it needs (raw credentials for FortiGate,
 * password credentials for the other types) and borrows the PKI connector of
 * an existing ACME profile. Nothing is left behind.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  callTool,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

const NETWORK_TYPES = [
  'fortigate',
  'fortimanager',
  'panos_firewall',
  'panos_panorama',
] as const;
type NetworkType = (typeof NETWORK_TYPES)[number];

const RETRY = {
  attempts: 3,
  minBackoff: '10 seconds',
  maxBackoff: '60 seconds',
  randomFactor: 0.1,
};

const RAW_CREDS = `${E2E_PREFIX}-raw-creds`;
const PASSWORD_CREDS = `${E2E_PREFIX}-pwd-creds`;

function connectorConfig(type: NetworkType): Record<string, unknown> {
  const base = {
    throttleParallelism: 1,
    timeout: '30 seconds',
    hostname: 'fw.example.com',
    // FortiGate takes an API key (raw credentials); the others take a login
    // and a password.
    credentials: type === 'fortigate' ? RAW_CREDS : PASSWORD_CREDS,
    prefix: 'e2e-',
  };
  switch (type) {
    case 'fortigate':
      return { ...base, vdom: 'root' };
    case 'fortimanager':
      return {
        ...base,
        target: 'device',
        managedDevice: { adom: 'root', device: 'fgt-01', vdom: 'root' },
        jobRetryParameters: RETRY,
      };
    case 'panos_firewall':
      return { ...base, vsys: 'vsys1', jobRetryParameters: RETRY };
    case 'panos_panorama':
      return {
        ...base,
        templateStack: 'stack-a',
        template: 'tpl-a',
        jobRetryParameters: RETRY,
      };
  }
}

/** Required keys of the $defs entry whose `type` is the given subtype. */
function subtypeRequired(
  described: Record<string, unknown>,
  subtype: string,
): string[] {
  const defs = (described['jsonSchema'] as Record<string, unknown>)[
    '$defs'
  ] as Record<
    string,
    { required?: string[]; properties?: { type?: { const?: string } } }
  >;
  const def = Object.values(defs).find(
    (d) => d.properties?.type?.const === subtype,
  );
  return def?.required ?? [];
}

/** True when the instance reports Horizon 2.11 or later. */
async function isHorizon211OrLater(): Promise<boolean> {
  const client = getHorizonClient();
  let version: unknown;
  try {
    version = (await client.get<Record<string, unknown>>('/api/v1/licenses'))[
      'version'
    ];
  } catch {
    version = (
      await client.get<Record<string, unknown>>(
        '/api/v1/security/principals/self',
      )
    )['_horizonVersion'];
  }
  const match = /^(\d+)\.(\d+)/.exec(String(version ?? ''));
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 2 || (major === 2 && minor >= 11);
}

async function deleteQuietly(tool: string, name: string): Promise<void> {
  try {
    await callTool(tool, { name, expected_name: name });
  } catch {
    /* already deleted or never created */
  }
}

describe.skipIf(!E2E_CONFIGURED)(
  'Horizon 2.11 config types E2E (live QA)',
  () => {
    setupE2EStack();

    let is211 = false;
    const createdCreds: string[] = [];

    beforeAll(async () => {
      is211 = await isHorizon211OrLater();
      if (!is211) {
        console.warn(
          '[config-211-types] Skipping live legs: the instance is older than Horizon 2.11.',
        );
        return;
      }
      const client = getHorizonClient();
      await client.post('/api/v1/security/credentials', {
        name: RAW_CREDS,
        type: 'raw',
        secret: { value: 'example-api-key' },
        targets: ['thirdparty'],
      });
      createdCreds.push(RAW_CREDS);
      await client.post('/api/v1/security/credentials', {
        name: PASSWORD_CREDS,
        type: 'password',
        login: 'example-login',
        password: { value: 'example-password' },
        // The sectigo DCV provider also uses these credentials.
        targets: ['thirdparty', 'dcv'],
      });
      createdCreds.push(PASSWORD_CREDS);
    });

    afterAll(async () => {
      for (const type of NETWORK_TYPES) {
        await deleteQuietly('delete_trigger', `${E2E_PREFIX}-trg-${type}`);
        await deleteQuietly(
          'delete_thirdparty_connector',
          `${E2E_PREFIX}-tpc-${type}`,
        );
      }
      await deleteQuietly('delete_dcv_provider', `${E2E_PREFIX}-dcv-sectigo`);
      await deleteQuietly(
        'delete_certificate_profile',
        `${E2E_PREFIX}-acme-211`,
      );
      for (const name of createdCreds) {
        try {
          await getHorizonClient().delete(
            `/api/v1/security/credentials/${encodeURIComponent(name)}`,
          );
        } catch {
          /* already gone */
        }
      }
    });

    describe('describe schemas', () => {
      it.each(NETWORK_TYPES)(
        'describes the %s third-party connector subtype',
        async (subtype) => {
          const r = await callTool('describe_thirdparty_connector_schema', {
            subtype,
          });
          expect(r['subtypes']).toContain(subtype);
          expect(subtypeRequired(r, subtype)).toEqual(
            expect.arrayContaining(['hostname', 'credentials', 'prefix']),
          );
        },
      );

      it.each(NETWORK_TYPES)(
        'describes the %s trigger subtype',
        async (subtype) => {
          const r = await callTool('describe_trigger_schema', { subtype });
          expect(r['subtypes']).toContain(subtype);
          expect(subtypeRequired(r, subtype)).toEqual(
            expect.arrayContaining(['name', 'type', 'connector']),
          );
        },
      );
    });

    it.for(NETWORK_TYPES)(
      'creates, reads and deletes a %s connector and trigger',
      async (type, ctx) => {
        if (!is211) ctx.skip();
        const connector = `${E2E_PREFIX}-tpc-${type}`;
        const trigger = `${E2E_PREFIX}-trg-${type}`;

        const created = await callTool('create_thirdparty_connector', {
          type,
          name: connector,
          throttle_duration: '5 seconds',
          config: connectorConfig(type),
        });
        expect(created['status']).toBe('created');
        const got = await callTool('get_thirdparty_connector', {
          name: connector,
        });
        expect(got['type']).toBe(type);

        const createdTrigger = await callTool('create_trigger', {
          name: trigger,
          type,
          config: { connector, retries: 1 },
        });
        expect(createdTrigger['status']).toBe('created');
        const gotTrigger = await callTool('get_trigger', { name: trigger });
        expect(gotTrigger['type']).toBe(type);
        expect(gotTrigger['connector']).toBe(connector);

        await callTool('delete_trigger', {
          name: trigger,
          expected_name: trigger,
        });
        await callTool('delete_thirdparty_connector', {
          name: connector,
          expected_name: connector,
        });
      },
    );

    it('creates, reads and deletes a sectigo DCV provider', async (ctx) => {
      if (!is211) ctx.skip();
      const name = `${E2E_PREFIX}-dcv-sectigo`;
      const created = await callTool('create_dcv_provider', {
        name,
        type: 'sectigo',
        endpoint: 'https://sectigo.example.com',
        credentials: PASSWORD_CREDS,
        timeout: '30 seconds',
        dcvMethod: 'cname',
      });
      expect(created['status']).toBe('created');
      const got = await callTool('get_dcv_provider', { name });
      expect(got['type']).toBe('sectigo');
      expect(got['dcvMethod']).toBe('cname');
      await callTool('delete_dcv_provider', { name, expected_name: name });
    });

    it('creates an ACME profile with excludeRootCA and deletes it', async (ctx) => {
      if (!is211) ctx.skip();
      const profiles = await getHorizonClient().get<
        Array<Record<string, unknown>>
      >('/api/v1/certificate/profiles');
      const source = profiles.find(
        (p) => p['module'] === 'acme' && typeof p['pkiConnector'] === 'string',
      );
      if (!source) ctx.skip();

      const described = await callTool('describe_certificate_profile_schema', {
        subtype: 'acme',
      });
      const acmeKeys = Object.keys(
        (
          (described['jsonSchema'] as Record<string, unknown>)[
            '$defs'
          ] as Record<string, { properties: Record<string, unknown> }>
        )['AcmeProfile']!.properties,
      );
      const typed = new Set([
        'module',
        'name',
        'enabled',
        'authorizationLevels',
        'requestsPolicy',
        'selfPermissions',
        'cryptoPolicy',
      ]);
      const config = Object.fromEntries(
        Object.entries(source!).filter(
          ([key]) => acmeKeys.includes(key) && !typed.has(key),
        ),
      );

      const name = `${E2E_PREFIX}-acme-211`;
      const created = await callTool('create_certificate_profile', {
        module: 'acme',
        name,
        enabled: false,
        authorization_levels: source!['authorizationLevels'],
        requests_policy: source!['requestsPolicy'],
        self_permissions: source!['selfPermissions'],
        crypto_policy: source!['cryptoPolicy'],
        config: { ...config, excludeRootCA: true },
      });
      expect(created['status']).toBe('created');
      const got = await callTool('get_certificate_profile', { name });
      expect(got['excludeRootCA']).toBe(true);
      await callTool('delete_certificate_profile', {
        name,
        expected_name: name,
      });
    });
  },
);
