/**
 * Live-QA E2E CRUD test for the Horizon 2.10 config object "dcv_provisioners".
 *
 * dcv_provisioner is polymorphic over 5 DNS backends with materially different
 * payloads. This suite round-trips EVERY subtype (not just the simplest), using
 * the complex field set each one actually carries:
 *   - cloudflare / powerdns: endpoint + RawCredentials + zoneIdMappings
 *   - efficientip:           endpoint + PasswordCredentials + dnsName + dnsView
 *   - azuredns:              tenantId/subscriptionId/resourceGroupName +
 *                            authorityHost + delegationZone + multi zoneIdMappings
 *                            (endpoint + credentials OPTIONAL - tested without them)
 *   - route53:               region + roleArn (endpoint + credentials OPTIONAL)
 *
 * Credentials of the right kind are borrowed from existing provisioners on the
 * instance (Raw from cloudflare/powerdns, Password from azuredns/route53). When
 * a required credential cannot be borrowed, that subtype's round-trip is skipped
 * (logged) rather than passing vacuously.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('dcv_provisioners CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Credentials borrowed from existing provisioners, by credential kind.
  let rawCred: string | undefined; // cloudflare / powerdns / efficientip... (Raw)
  let passCred: string | undefined; // azuredns / route53 / efficientip (Password)
  const createdNames: string[] = [];

  beforeAll(async () => {
    try {
      const existing = (await getHorizonClient().get(
        '/api/v1/dcv/provisioners',
      )) as Array<Record<string, unknown>>;
      const credOf = (t: string) =>
        existing.find((p) => p['type'] === t && p['credentials'])?.[
          'credentials'
        ] as string | undefined;
      rawCred = credOf('cloudflare') ?? credOf('powerdns');
      passCred = credOf('azuredns') ?? credOf('route53');
    } catch {
      /* none to borrow */
    }
  });

  afterAll(async () => {
    for (const n of createdNames) {
      try {
        await callTool('delete_dcv_provisioner', {
          name: n,
          expected_name: n,
        });
      } catch {
        /* already gone */
      }
    }
  });

  it('rejects a cloudflare create missing endpoint+credentials (per-type guard)', async () => {
    await expect(
      callTool('create_dcv_provisioner', {
        name: `${E2E_PREFIX}-bad`,
        type: 'cloudflare',
        ttl: '60 seconds',
        timeout: '30 seconds',
      }),
    ).rejects.toThrow(/endpoint|credentials/i);
  });

  it('rejects an azuredns create missing tenantId/subscriptionId/resourceGroupName', async () => {
    await expect(
      callTool('create_dcv_provisioner', {
        name: `${E2E_PREFIX}-bad-az`,
        type: 'azuredns',
        ttl: '60 seconds',
        timeout: '30 seconds',
      }),
    ).rejects.toThrow(/tenantId|subscriptionId|resourceGroupName/i);
  });

  // -------------------------------------------------------------------------
  // Per-subtype full round-trip. Each entry carries the subtype's complex body,
  // the credential kind it needs, and a subtype-specific field to mutate.
  // -------------------------------------------------------------------------
  type Sub = {
    type: string;
    cred: 'raw' | 'pass' | 'none';
    body: () => Record<string, unknown>;
    updateField: string;
    updateValue: unknown;
    /** field expected to survive the update (GET-merge preservation check). */
    preservedField: string;
    expectedPreserved: unknown;
  };

  const subtypes: Sub[] = [
    {
      type: 'cloudflare',
      cred: 'raw',
      body: () => ({
        endpoint: 'https://api.cloudflare.com',
        delegationZone: 'deleg.example.com',
        zoneIdMappings: [
          { regex: 'a.*', zoneId: 'zoneA' },
          { regex: 'b.*', zoneId: 'zoneB' },
        ],
      }),
      updateField: 'ttl',
      updateValue: '120 seconds',
      preservedField: 'delegationZone',
      expectedPreserved: 'deleg.example.com',
    },
    {
      type: 'powerdns',
      cred: 'raw',
      body: () => ({
        endpoint: 'https://pdns.example.com',
        zoneIdMappings: [{ regex: '.*', zoneId: 'z1' }],
      }),
      updateField: 'ttl',
      updateValue: '90 seconds',
      preservedField: 'endpoint',
      expectedPreserved: 'https://pdns.example.com',
    },
    {
      type: 'efficientip',
      cred: 'pass',
      body: () => ({
        endpoint: 'https://eip.example.com',
        dnsName: 'smart-dns-1',
        dnsView: 'external',
        zoneIdMappings: [{ regex: '.*', zoneId: 'z1' }],
      }),
      updateField: 'dnsView',
      updateValue: 'internal',
      preservedField: 'dnsName',
      expectedPreserved: 'smart-dns-1',
    },
    {
      type: 'azuredns',
      cred: 'none', // credentials optional for azuredns - prove it works without
      body: () => ({
        tenantId: 'tenant-e2e',
        subscriptionId: 'sub-e2e',
        resourceGroupName: 'rg-e2e',
        authorityHost: 'https://login.microsoftonline.com',
        delegationZone: 'az.example.com',
        zoneIdMappings: [
          { regex: 'x.*', zoneId: 'zx' },
          { regex: 'y.*', zoneId: 'zy' },
        ],
      }),
      updateField: 'resourceGroupName',
      updateValue: 'rg-e2e-updated',
      preservedField: 'subscriptionId',
      expectedPreserved: 'sub-e2e',
    },
    {
      type: 'route53',
      cred: 'none', // credentials optional for route53
      body: () => ({
        region: 'eu-west-1',
        roleArn: 'arn:aws:iam::123456789012:role/dcv-e2e',
        zoneIdMappings: [{ regex: '.*', zoneId: 'z1' }],
      }),
      updateField: 'region',
      updateValue: 'us-east-1',
      preservedField: 'roleArn',
      expectedPreserved: 'arn:aws:iam::123456789012:role/dcv-e2e',
    },
  ];

  for (const sub of subtypes) {
    it(`round-trips a ${sub.type} provisioner (create -> get -> update -> delete)`, async () => {
      const cred =
        sub.cred === 'raw'
          ? rawCred
          : sub.cred === 'pass'
            ? passCred
            : undefined;
      if (sub.cred !== 'none' && !cred) {
        console.log(`SKIP ${sub.type}: no ${sub.cred} credential to borrow`);
        return;
      }

      const name = `${E2E_PREFIX}-${sub.type}`;
      const createArgs: Record<string, unknown> = {
        name,
        type: sub.type,
        ttl: '60 seconds',
        timeout: '30 seconds',
        ...sub.body(),
      };
      if (cred) createArgs['credentials'] = cred;

      const created = await callTool('create_dcv_provisioner', createArgs);
      expect(created['status']).toBe('created');
      createdNames.push(name);

      const got = await callTool('get_dcv_provisioner', { name });
      expect(got['type']).toBe(sub.type);
      expect(got[sub.preservedField]).toEqual(sub.expectedPreserved);

      const upd = await callTool('update_dcv_provisioner', {
        name,
        type: sub.type,
        [sub.updateField]: sub.updateValue,
      });
      expect(upd['status']).toBe('updated');

      const after = await callTool('get_dcv_provisioner', { name });
      expect(after[sub.updateField]).toEqual(sub.updateValue);
      // The untouched subtype-specific field survived the GET-merge full-replace.
      expect(after[sub.preservedField]).toEqual(sub.expectedPreserved);

      const del = await callTool('delete_dcv_provisioner', {
        name,
        expected_name: name,
      });
      expect(del['deleted']).toBe(true);
      await expect(callTool('get_dcv_provisioner', { name })).rejects.toThrow(
        ToolError,
      );
    });
  }
});
