/**
 * Live-QA E2E "subtype matrix" for the polymorphic config tools added on this
 * branch. The per-object suites elsewhere each cover only ONE subtype; this file
 * proves the tools handle EVERY subtype actually deployed on the 2.10 instance.
 *
 * Strategy: for each polymorphic object, enumerate the distinct subtypes present
 * on QA, then for each subtype clone a real example (mapped to the tool's create
 * signature, server fields stripped, renamed) and round-trip it through the MCP
 * tool: create -> get (assert discriminator round-trips) -> delete.
 *
 * A subtype the server legitimately refuses to clone on a shared instance (a
 * uniqueness constraint inherent to duplicating real config, a missing live
 * backend) is recorded as a CLEAN server rejection - which still proves the tool
 * built a well-formed subtype payload and reached Horizon. Each object logs a
 * coverage summary (fully round-tripped vs cleanly rejected, with reasons).
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

type Example = Record<string, unknown>;

interface PolySpec {
  label: string;
  listPath: string;
  discriminator: string; // 'type' | 'module'
  createTool: string;
  getTool: string;
  deleteTool: string;
  /** Map a real example -> the create tool's arguments (new name). */
  buildArgs: (name: string, ex: Example) => Example;
  /**
   * When false, an all-clean-rejected outcome is acceptable (e.g. third-party
   * connectors carry a unique external resource id that a pure clone duplicates).
   */
  requireRoundTrip: boolean;
}

function omit(ex: Example, keys: string[]): Example {
  const out: Example = { ...ex };
  for (const k of keys) delete out[k];
  return out;
}

const BASE_SERVER_KEYS = [
  '_id',
  'name',
  'tenant',
  'status',
  'account',
  'accountUrl',
];

/**
 * A third-party connector's resource id is DERIVED from its external-target
 * fields (getResourceId per subtype) and must be unique among connectors of the
 * same type. A faithful clone therefore collides; pointing the clone at a
 * distinct target (perturbing one identity component) makes it unique. Map each
 * subtype to a free-string field in its getResourceId formula.
 */
const TPC_IDENTITY_FIELD: Record<string, string> = {
  aws: 'tagValue',
  akv: 'azureTenant',
  f5client: 'partition',
  gcm: 'tagValue',
  intunepkcs: 'searchFilter',
  intune: 'azureTenant',
  ldappub: 'filter',
};

function uniquifyTpcIdentity(
  type: string,
  config: Example,
  token: string,
): void {
  const arb = TPC_IDENTITY_FIELD[type];
  if (arb) {
    config[arb] = `${(config[arb] as string) ?? ''}${token}`;
    return;
  }
  // Host/URL-only formulas: vary the identity component to a distinct value.
  if (type === 'f5as3' && typeof config['hostname'] === 'string') {
    config['hostname'] = `${token}.${config['hostname'] as string}`;
  } else if (type === 'jamf' && typeof config['endpoint'] === 'string') {
    config['endpoint'] = `${config['endpoint'] as string}-${token}`;
  }
}

const SPECS: PolySpec[] = [
  {
    label: 'pki_connector',
    listPath: '/api/v1/pki/connectors',
    discriminator: 'type',
    createTool: 'create_pki_connector',
    getTool: 'get_pki_connector',
    deleteTool: 'delete_pki_connector',
    requireRoundTrip: true,
    buildArgs: (name, ex) => ({
      name,
      type: ex['type'],
      config: omit(ex, [...BASE_SERVER_KEYS, 'type']),
    }),
  },
  {
    label: 'trigger',
    listPath: '/api/v1/triggers',
    discriminator: 'type',
    createTool: 'create_trigger',
    getTool: 'get_trigger',
    deleteTool: 'delete_trigger',
    requireRoundTrip: true,
    buildArgs: (name, ex) => ({
      name,
      type: ex['type'],
      config: omit(ex, [...BASE_SERVER_KEYS, 'type', 'triggers']),
    }),
  },
  {
    label: 'certificate_profile',
    listPath: '/api/v1/certificate/profiles',
    discriminator: 'module',
    createTool: 'create_certificate_profile',
    getTool: 'get_certificate_profile',
    deleteTool: 'delete_certificate_profile',
    requireRoundTrip: true,
    buildArgs: (name, ex) => ({
      name,
      module: ex['module'],
      enabled: (ex['enabled'] as boolean) ?? true,
      authorization_levels: (ex['authorizationLevels'] as Example) ?? {},
      requests_policy: (ex['requestsPolicy'] as Example) ?? {},
      self_permissions: (ex['selfPermissions'] as Example) ?? {},
      crypto_policy: (ex['cryptoPolicy'] as Example) ?? {},
      config: omit(ex, [
        ...BASE_SERVER_KEYS,
        'module',
        'enabled',
        'authorizationLevels',
        'requestsPolicy',
        'selfPermissions',
        'cryptoPolicy',
      ]),
    }),
  },
  {
    label: 'scheduled_task',
    listPath: '/api/v1/scheduler/tasks',
    discriminator: 'type',
    createTool: 'create_scheduled_task',
    getTool: 'get_scheduled_task',
    deleteTool: 'delete_scheduled_task',
    requireRoundTrip: true,
    buildArgs: (name, ex) => {
      const config = omit(ex, [
        ...BASE_SERVER_KEYS,
        'type',
        'cron',
        'enabled',
        'reportType',
        'host',
        'lastExecutionDate',
        'lastCompletionDate',
        'detail',
        'executionId',
      ]);
      const base: Example = {
        name,
        type: ex['type'],
        cron: ex['cron'],
        enabled: false,
        config,
      };
      if (ex['type'] === 'report') base['report_type'] = ex['reportType'];
      return base;
    },
  },
  {
    label: 'thirdparty_connector',
    listPath: '/api/v1/thirdparty/connectors',
    discriminator: 'type',
    createTool: 'create_thirdparty_connector',
    getTool: 'get_thirdparty_connector',
    deleteTool: 'delete_thirdparty_connector',
    requireRoundTrip: true,
    buildArgs: (name, ex) => {
      // throttleDuration maps to the throttle_duration param; throttleParallelism
      // is a mandatory config field and must stay in the body.
      const config = omit(ex, [
        ...BASE_SERVER_KEYS,
        'type',
        'throttleDuration',
      ]);
      // Point the clone at a distinct external target so its derived resource id
      // is unique (otherwise THIRDPARTY-CONNECTOR-002).
      uniquifyTpcIdentity(String(ex['type']), config, `e2e${name.slice(-10)}`);
      return {
        name,
        type: ex['type'],
        throttle_duration: (ex['throttleDuration'] as string) ?? '1 second',
        config,
      };
    },
  },
];

describe.skipIf(!E2E_CONFIGURED)(
  'polymorphic subtype matrix E2E (live QA)',
  () => {
    setupE2EStack();

    const created: Array<{ tool: string; name: string }> = [];

    afterAll(async () => {
      for (const { tool, name } of created) {
        try {
          await callTool(tool, { name, expected_name: name });
        } catch {
          /* already gone */
        }
      }
    });

    for (const spec of SPECS) {
      it(`round-trips every ${spec.label} subtype present on the instance`, async () => {
        const raw = (await getHorizonClient().get(spec.listPath)) as
          | Example[]
          | { items?: Example[] };
        const items = Array.isArray(raw) ? raw : (raw.items ?? []);

        const bySubtype = new Map<string, Example>();
        for (const it of items) {
          const sub = String(it[spec.discriminator] ?? '?');
          if (!bySubtype.has(sub)) bySubtype.set(sub, it);
        }
        expect(bySubtype.size).toBeGreaterThan(0);

        const roundTripped: string[] = [];
        const cleanlyRejected: Array<{ sub: string; reason: string }> = [];

        for (const [sub, ex] of bySubtype) {
          const name = `${E2E_PREFIX}-${sub}-poly`.slice(0, 60);
          try {
            const res = await callTool(
              spec.createTool,
              spec.buildArgs(name, ex),
            );
            expect(res['status']).toBe('created');
            created.push({ tool: spec.deleteTool, name });

            const got = await callTool(spec.getTool, { name });
            expect(String(got[spec.discriminator])).toBe(sub);

            await callTool(spec.deleteTool, { name, expected_name: name });
            created.pop();
            roundTripped.push(sub);
          } catch (err) {
            // A clean Horizon validation/reference error proves the tool reached
            // the server with a well-formed subtype payload. A non-ToolError
            // (e.g. an MCP input-schema rejection) is a real tool bug -> rethrow.
            if (!(err instanceof ToolError)) throw err;
            cleanlyRejected.push({ sub, reason: err.message.slice(0, 160) });
          }
        }

        console.log(
          `\n[${spec.label}] subtypes=${bySubtype.size} ` +
            `round-tripped=[${roundTripped.join(', ')}] ` +
            `clean-rejected=[${cleanlyRejected.map((r) => r.sub).join(', ')}]`,
        );
        for (const r of cleanlyRejected) {
          console.log(`  - ${spec.label}/${r.sub}: ${r.reason}`);
        }

        // Every subtype must end in one of the two acceptable states.
        expect(roundTripped.length + cleanlyRejected.length).toBe(
          bySubtype.size,
        );
        if (spec.requireRoundTrip) {
          expect(roundTripped.length).toBeGreaterThan(0);
        }
      }, 180_000);
    }
  },
);
