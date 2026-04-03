import { describe, expect, it, vi } from 'vitest';

import { HorizonError } from '../../src/client/errors.js';
import type { HorizonClient } from '../../src/client/http.js';
import {
  BASELINE_STRIP,
  DEP_CHECKS,
  MAX_PREFLIGHT_CALLS,
  STRIP_FIELDS,
  checkOne,
  extractCredential,
  extractDatasourceFlow,
  extractGradingPolicies,
  extractIdentityProvider,
  extractPkiConnector,
  extractTriggersFromHooks,
  preflightDeps,
  toUpdatePayload,
} from '../../src/models/payloads.js';

// ---------------------------------------------------------------------------
// Helper: build a mock HorizonClient with configurable per-path responses
// ---------------------------------------------------------------------------

function makeClient(
  sideEffects?: Record<string, unknown>,
): HorizonClient & { get: ReturnType<typeof vi.fn> } {
  const getFn = vi.fn(async (path: string) => {
    if (!sideEffects) return {};
    if (path in sideEffects) {
      const val = sideEffects[path];
      if (val instanceof Error) throw val;
      return val;
    }
    return {};
  });

  return { get: getFn } as unknown as HorizonClient & {
    get: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// 1. Extractor helpers (unit tests)
// ---------------------------------------------------------------------------

describe('extractors', () => {
  // -- extractCredential ----------------------------------------------------

  describe('extractCredential', () => {
    it('extracts a single string credential', () => {
      expect(extractCredential('my-cred')).toEqual([
        ['my-cred', '/api/v1/security/credentials/my-cred'],
      ]);
    });

    it('extracts a list of credentials', () => {
      const result = extractCredential(['cred-a', 'cred-b']);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual([
        'cred-a',
        '/api/v1/security/credentials/cred-a',
      ]);
      expect(result[1]).toEqual([
        'cred-b',
        '/api/v1/security/credentials/cred-b',
      ]);
    });

    it('returns empty for empty string', () => {
      expect(extractCredential('')).toEqual([]);
    });

    it('returns empty for null', () => {
      expect(extractCredential(null)).toEqual([]);
    });

    it('filters empty strings from list', () => {
      const result = extractCredential(['', 'valid', '']);
      expect(result).toHaveLength(1);
      expect(result[0]![0]).toBe('valid');
    });
  });

  // -- extractPkiConnector --------------------------------------------------

  describe('extractPkiConnector', () => {
    it('extracts a string connector', () => {
      expect(extractPkiConnector('conn-1')).toEqual([
        ['conn-1', '/api/v1/pki/connectors/conn-1'],
      ]);
    });

    it('returns empty for empty string', () => {
      expect(extractPkiConnector('')).toEqual([]);
    });

    it('returns empty for non-string value', () => {
      expect(extractPkiConnector(123)).toEqual([]);
    });
  });

  // -- extractTriggersFromHooks ---------------------------------------------

  describe('extractTriggersFromHooks', () => {
    it('extracts sync trigger names from hooks', () => {
      const hooks = { onEnroll: ['trig-a', 'trig-b'] };
      const result = extractTriggersFromHooks(hooks);
      const names = new Set(result.map(([name]) => name));
      expect(names).toEqual(new Set(['trig-a', 'trig-b']));
    });

    it('extracts async trigger objects from hooks', () => {
      const hooks = { onRenew: [{ name: 'async-trig' }] };
      const result = extractTriggersFromHooks(hooks);
      expect(result).toEqual([['async-trig', '/api/v1/triggers/async-trig']]);
    });

    it('extracts mixed sync and async triggers', () => {
      const hooks = {
        onEnroll: ['sync-trig'],
        onRevoke: [{ name: 'async-trig' }, 'sync-trig'],
      };
      const result = extractTriggersFromHooks(hooks);
      const names = new Set(result.map(([name]) => name));
      expect(names).toEqual(new Set(['sync-trig', 'async-trig']));
    });

    it('returns empty for non-dict input', () => {
      expect(extractTriggersFromHooks('not-a-dict')).toEqual([]);
      expect(extractTriggersFromHooks(null)).toEqual([]);
    });

    it('deduplicates trigger names', () => {
      const hooks = { a: ['dup', 'dup'], b: ['dup'] };
      const result = extractTriggersFromHooks(hooks);
      expect(result).toHaveLength(1);
    });

    it('skips non-list hook values', () => {
      const hooks = { a: 'not-a-list', b: ['valid'] };
      const result = extractTriggersFromHooks(hooks);
      expect(result).toHaveLength(1);
    });
  });

  // -- extractGradingPolicies -----------------------------------------------

  describe('extractGradingPolicies', () => {
    it('extracts a single string policy', () => {
      const result = extractGradingPolicies('policy-1');
      expect(result).toEqual([
        ['policy-1', '/api/v1/certificate/grading/policies/policy-1'],
      ]);
    });

    it('extracts a list of policies', () => {
      const result = extractGradingPolicies(['p1', 'p2']);
      expect(result).toHaveLength(2);
    });
  });

  // -- extractDatasourceFlow ------------------------------------------------

  describe('extractDatasourceFlow', () => {
    it('extracts datasource names from flow list', () => {
      const flow = [{ datasource: 'ds-a' }, { datasource: 'ds-b' }];
      const result = extractDatasourceFlow(flow);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(['ds-a', '/api/v1/datasources/ds-a']);
    });

    it('returns empty for non-list input', () => {
      expect(extractDatasourceFlow('not-a-list')).toEqual([]);
    });

    it('returns empty when entries lack datasource key', () => {
      expect(extractDatasourceFlow([{ other: 'val' }])).toEqual([]);
    });
  });

  // -- extractIdentityProvider ----------------------------------------------

  describe('extractIdentityProvider', () => {
    it('extracts a single string IDP', () => {
      const result = extractIdentityProvider('my-idp');
      expect(result).toEqual([
        ['my-idp', '/api/v1/security/identity/providers/my-idp'],
      ]);
    });

    it('extracts a list of IDPs', () => {
      const result = extractIdentityProvider(['idp-1', 'idp-2']);
      expect(result).toHaveLength(2);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. checkOne - single dependency check
// ---------------------------------------------------------------------------

describe('checkOne', () => {
  it('returns null when dependency exists', async () => {
    const client = makeClient();
    const result = await checkOne(
      client,
      'my-dep',
      '/api/v1/things/my-dep',
      'hint',
    );
    expect(result).toBeNull();
    expect(client.get).toHaveBeenCalledWith('/api/v1/things/my-dep');
  });

  it('throws PREFLIGHT-DEP error when dependency returns 404', async () => {
    const client = makeClient({
      '/api/v1/things/missing': new HorizonError(404, {
        message: 'Not found',
      }),
    });
    await expect(
      checkOne(client, 'missing', '/api/v1/things/missing', 'Create it first.'),
    ).rejects.toSatisfy((err: HorizonError) => {
      expect(err).toBeInstanceOf(HorizonError);
      expect(err.statusCode).toBe(422);
      expect(err.errorCode).toBe('PREFLIGHT-DEP');
      expect(err.message).toContain('missing');
      expect(err.remediation).toBe('Create it first.');
      return true;
    });
  });

  it('returns warning string for non-404 API error', async () => {
    const client = makeClient({
      '/api/v1/things/flaky': new HorizonError(500, {
        message: 'Internal error',
      }),
    });
    const result = await checkOne(
      client,
      'flaky',
      '/api/v1/things/flaky',
      'hint',
    );
    expect(typeof result).toBe('string');
    expect(result).toContain('flaky');
    expect(result).toContain('500');
  });

  it('returns warning string for generic exception', async () => {
    const client = makeClient({
      '/path': new Error('boom'),
    });
    const result = await checkOne(client, 'broken', '/path', 'hint');
    expect(typeof result).toBe('string');
    expect(result).toContain('broken');
    expect(result).toContain('boom');
  });
});

// ---------------------------------------------------------------------------
// 3. preflightDeps - dependency validation orchestrator
// ---------------------------------------------------------------------------

describe('preflightDeps', () => {
  // -- Empty payload: no checks ---------------------------------------------

  it('returns no warnings for empty payload', async () => {
    const client = makeClient();
    const warnings = await preflightDeps(client, {}, 'profile');
    expect(warnings).toEqual([]);
    expect(client.get).not.toHaveBeenCalled();
  });

  it('returns no warnings for payload without dep keys', async () => {
    const client = makeClient();
    const warnings = await preflightDeps(
      client,
      { name: 'test', keySize: 2048 },
      'profile',
    );
    expect(warnings).toEqual([]);
    expect(client.get).not.toHaveBeenCalled();
  });

  // -- Existing dependency: success -----------------------------------------

  it('returns no warnings for existing credential', async () => {
    const client = makeClient({
      '/api/v1/security/credentials/cred-1': {},
    });
    const warnings = await preflightDeps(
      client,
      { credential: 'cred-1' },
      'profile',
    );
    expect(warnings).toEqual([]);
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/security/credentials/cred-1',
    );
  });

  // -- Missing dependency: hard error ---------------------------------------

  it('throws on missing credential (404)', async () => {
    const client = makeClient({
      '/api/v1/security/credentials/missing': new HorizonError(404, {
        message: 'Not found',
      }),
    });
    await expect(
      preflightDeps(client, { credential: 'missing' }, 'profile'),
    ).rejects.toSatisfy((err: HorizonError) => {
      expect(err.statusCode).toBe(422);
      expect(err.errorCode).toBe('PREFLIGHT-DEP');
      expect(err.message).toContain('missing');
      return true;
    });
  });

  it('throws on missing pki connector (404)', async () => {
    const client = makeClient({
      '/api/v1/pki/connectors/bad-conn': new HorizonError(404, {
        message: 'Not found',
      }),
    });
    await expect(
      preflightDeps(client, { pkiConnector: 'bad-conn' }, 'profile'),
    ).rejects.toThrow(HorizonError);
  });

  it('throws on missing trigger (404)', async () => {
    const client = makeClient({
      '/api/v1/triggers/bad-trig': new HorizonError(404, {
        message: 'Not found',
      }),
    });
    await expect(
      preflightDeps(
        client,
        { triggerHooks: { onEnroll: ['bad-trig'] } },
        'profile',
      ),
    ).rejects.toThrow(HorizonError);
  });

  it('throws on missing identity provider (404)', async () => {
    const client = makeClient({
      '/api/v1/security/identity/providers/bad-idp': new HorizonError(404, {
        message: 'Not found',
      }),
    });
    await expect(
      preflightDeps(client, { identityProvider: 'bad-idp' }, 'profile'),
    ).rejects.toThrow(HorizonError);
  });

  it('throws on missing datasource (404)', async () => {
    const client = makeClient({
      '/api/v1/datasources/ds-bad': new HorizonError(404, {
        message: 'Not found',
      }),
    });
    await expect(
      preflightDeps(client, { dsFlow: [{ datasource: 'ds-bad' }] }, 'profile'),
    ).rejects.toThrow(HorizonError);
  });

  // -- Non-blocking warnings (non-404 errors) -------------------------------

  it('returns warning for 500 error (not 404)', async () => {
    const client = makeClient({
      '/api/v1/security/credentials/flaky': new HorizonError(500, {
        message: 'Internal server error',
      }),
    });
    const warnings = await preflightDeps(
      client,
      { credential: 'flaky' },
      'profile',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('flaky');
  });

  // -- Max preflight calls cap at 5 ----------------------------------------

  it('makes at most MAX_PREFLIGHT_CALLS API calls', async () => {
    expect(MAX_PREFLIGHT_CALLS).toBe(5);

    const creds = Array.from({ length: 8 }, (_, i) => `cred-${i}`);
    const client = makeClient();
    const warnings = await preflightDeps(
      client,
      { credential: creds },
      'profile',
    );
    expect(warnings).toEqual([]);
    expect(client.get.mock.calls.length).toBeLessThanOrEqual(
      MAX_PREFLIGHT_CALLS,
    );
  });

  it('caps calls across multiple dependency types', async () => {
    const payload = {
      credential: ['c1', 'c2', 'c3'],
      pkiConnector: 'conn-1',
      triggerHooks: { onEnroll: ['t1', 't2'] },
      identityProvider: 'idp-1',
    };
    // Total would be 3 + 1 + 2 + 1 = 7, but cap is 5
    const client = makeClient();
    await preflightDeps(client, payload, 'profile');
    expect(client.get.mock.calls.length).toBe(MAX_PREFLIGHT_CALLS);
  });

  // -- Priority order: credentials first ------------------------------------

  it('checks credentials and connectors (priority order)', async () => {
    const callOrder: string[] = [];
    const client = {
      get: vi.fn(async (path: string) => {
        callOrder.push(path);
        return {};
      }),
    } as unknown as HorizonClient & { get: ReturnType<typeof vi.fn> };

    await preflightDeps(
      client,
      { pkiConnector: 'conn-1', credential: 'cred-1' },
      'profile',
    );

    const pathsCalled = new Set(callOrder);
    expect(pathsCalled).toContain('/api/v1/security/credentials/cred-1');
    expect(pathsCalled).toContain('/api/v1/pki/connectors/conn-1');
  });

  it('DEP_CHECKS follows documented priority order', () => {
    const keys = DEP_CHECKS.map((c) => c.key);
    const credIdx = Math.min(
      ...keys.flatMap((k, i) =>
        k === 'credential' || k === 'credentials' ? [i] : [],
      ),
    );
    const connIdx = Math.min(
      ...keys.flatMap((k, i) => (k === 'pkiConnector' ? [i] : [])),
    );
    const trigIdx = Math.min(
      ...keys.flatMap((k, i) => (k === 'triggerHooks' ? [i] : [])),
    );
    const dsIdx = Math.min(
      ...keys.flatMap((k, i) => (k === 'dsFlow' ? [i] : [])),
    );
    const idpIdx = Math.min(
      ...keys.flatMap((k, i) =>
        k === 'identityProvider' || k === 'identityProviders' ? [i] : [],
      ),
    );

    expect(credIdx).toBeLessThan(connIdx);
    expect(connIdx).toBeLessThan(trigIdx);
    expect(trigIdx).toBeLessThan(dsIdx);
    expect(dsIdx).toBeLessThan(idpIdx);
  });

  // -- Concurrent checks ----------------------------------------------------

  it('dispatches multiple checks concurrently', async () => {
    const client = makeClient();
    await preflightDeps(client, { credential: ['c1', 'c2', 'c3'] }, 'profile');
    expect(client.get.mock.calls.length).toBe(3);
  });

  // -- Mixed results: one warning, rest ok ----------------------------------

  it('returns warnings alongside successes', async () => {
    const client = makeClient({
      '/api/v1/security/credentials/ok-cred': {},
      '/api/v1/pki/connectors/flaky-conn': new HorizonError(503, {
        message: 'Unavailable',
      }),
    });
    const warnings = await preflightDeps(
      client,
      { credential: 'ok-cred', pkiConnector: 'flaky-conn' },
      'profile',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('flaky-conn');
  });

  // -- Gather propagates first hard error -----------------------------------

  it('raises first hard error when gather returns 404 exception', async () => {
    const client = makeClient({
      '/api/v1/security/credentials/c1': {},
      '/api/v1/security/credentials/c2': new HorizonError(404, {
        message: 'Not found',
      }),
    });
    await expect(
      preflightDeps(client, { credential: ['c1', 'c2'] }, 'profile'),
    ).rejects.toSatisfy((err: HorizonError) => {
      expect(err.statusCode).toBe(422);
      return true;
    });
  });

  // -- Generic exception becomes warning ------------------------------------

  it('converts unexpected exception to warning', async () => {
    const client = {
      get: vi.fn(async () => {
        throw new Error('unexpected crash');
      }),
    } as unknown as HorizonClient & { get: ReturnType<typeof vi.fn> };

    const warnings = await preflightDeps(
      client,
      { credential: 'c1' },
      'profile',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unexpectedly|crash/);
  });

  // -- Null-valued dep keys are skipped -------------------------------------

  it('skips null-valued dependency keys', async () => {
    const client = makeClient();
    const warnings = await preflightDeps(
      client,
      { credential: null, pkiConnector: null },
      'profile',
    );
    expect(warnings).toEqual([]);
    expect(client.get).not.toHaveBeenCalled();
  });

  // -- Plural keys ----------------------------------------------------------

  it("handles plural 'credentials' key", async () => {
    const client = makeClient({
      '/api/v1/security/credentials/c1': {},
    });
    const warnings = await preflightDeps(
      client,
      { credentials: 'c1' },
      'profile',
    );
    expect(warnings).toEqual([]);
    expect(client.get).toHaveBeenCalledOnce();
  });

  it("handles plural 'identityProviders' key", async () => {
    const client = makeClient({
      '/api/v1/security/identity/providers/idp-1': {},
    });
    const warnings = await preflightDeps(
      client,
      { identityProviders: ['idp-1'] },
      'profile',
    );
    expect(warnings).toEqual([]);
  });

  it("handles singular 'gradingPolicy' key", async () => {
    const client = makeClient({
      '/api/v1/certificate/grading/policies/gp1': {},
    });
    const warnings = await preflightDeps(
      client,
      { gradingPolicy: 'gp1' },
      'profile',
    );
    expect(warnings).toEqual([]);
  });

  it("handles plural 'gradingPolicies' key", async () => {
    const client = makeClient({
      '/api/v1/certificate/grading/policies/gp1': {},
      '/api/v1/certificate/grading/policies/gp2': {},
    });
    const warnings = await preflightDeps(
      client,
      { gradingPolicies: ['gp1', 'gp2'] },
      'profile',
    );
    expect(warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. STRIP_FIELDS exhaustive domain validation
// ---------------------------------------------------------------------------

describe('STRIP_FIELDS', () => {
  const V1_DOMAINS = [
    'profile',
    'ca',
    'connector',
    'trigger',
    'label',
    'proxy',
    'datasource',
    'role',
    'team',
    'idp',
    'grading_policy',
    'grading_ruleset',
    'password_policy',
    'principal',
  ] as const;

  const V11_ID_ONLY_DOMAINS = [
    'discovery_campaign',
    'automation_policy',
    'execution_policy',
    'wcce_forest',
    'scheduled_task',
  ] as const;

  const ALL_DOMAINS = [
    ...V1_DOMAINS,
    ...V11_ID_ONLY_DOMAINS,
    'local_identity',
  ] as const;

  it('contains exactly 20 domains', () => {
    expect(Object.keys(STRIP_FIELDS)).toHaveLength(20);
  });

  it('contains all expected domain keys', () => {
    const expected = new Set<string>(ALL_DOMAINS);
    expect(new Set(Object.keys(STRIP_FIELDS))).toEqual(expected);
  });

  it('BASELINE_STRIP contains the 4 core fields', () => {
    expect(BASELINE_STRIP).toEqual(
      new Set(['_id', 'id', 'createdAt', 'updatedAt']),
    );
  });

  it.each(V1_DOMAINS)(
    "v1 domain '%s' includes all baseline fields",
    (domain) => {
      const fields = STRIP_FIELDS[domain]!;
      for (const base of BASELINE_STRIP) {
        expect(fields.has(base)).toBe(true);
      }
    },
  );

  it.each(V11_ID_ONLY_DOMAINS)("v1.1 domain '%s' strips _id", (domain) => {
    expect(STRIP_FIELDS[domain]!.has('_id')).toBe(true);
  });

  it('local_identity has extra security fields', () => {
    const extras = ['hash', 'resetUUID', 'resetExpiration'];
    for (const field of extras) {
      expect(STRIP_FIELDS['local_identity']!.has(field)).toBe(true);
    }
  });

  it('profile has domain-specific extra fields', () => {
    const extras = [
      'lastModifiedBy',
      'statistics',
      'status',
      'certificateCount',
    ];
    for (const field of extras) {
      expect(STRIP_FIELDS['profile']!.has(field)).toBe(true);
    }
  });

  it('ca has domain-specific extra fields', () => {
    const extras = ['certificate', 'crlCache', 'statistics'];
    for (const field of extras) {
      expect(STRIP_FIELDS['ca']!.has(field)).toBe(true);
    }
  });

  it('connector has domain-specific extra fields', () => {
    const extras = ['status', 'lastSync'];
    for (const field of extras) {
      expect(STRIP_FIELDS['connector']!.has(field)).toBe(true);
    }
  });

  it('trigger has domain-specific extra fields', () => {
    const extras = ['lastRun', 'statistics'];
    for (const field of extras) {
      expect(STRIP_FIELDS['trigger']!.has(field)).toBe(true);
    }
  });

  it('team has domain-specific extra fields', () => {
    const extras = ['statistics', 'memberCount'];
    for (const field of extras) {
      expect(STRIP_FIELDS['team']!.has(field)).toBe(true);
    }
  });

  it('datasource has domain-specific extra fields', () => {
    expect(STRIP_FIELDS['datasource']!.has('lastTest')).toBe(true);
  });

  it('principal has domain-specific extra fields', () => {
    expect(STRIP_FIELDS['principal']!.has('lastLogin')).toBe(true);
  });

  it('minimal domains have only baseline fields', () => {
    const minimal = [
      'label',
      'proxy',
      'role',
      'idp',
      'grading_policy',
      'grading_ruleset',
      'password_policy',
    ];
    for (const domain of minimal) {
      expect(STRIP_FIELDS[domain]).toEqual(BASELINE_STRIP);
    }
  });

  it.each(ALL_DOMAINS)("domain '%s' fields are a ReadonlySet", (domain) => {
    const fields = STRIP_FIELDS[domain];
    expect(fields).toBeDefined();
    expect(fields).toBeInstanceOf(Set);
  });

  // toUpdatePayload strips all domain fields correctly
  it.each(ALL_DOMAINS)(
    "toUpdatePayload strips all fields for domain '%s'",
    (domain) => {
      const fakeResponse: Record<string, unknown> = { userField: 'keep' };
      for (const field of STRIP_FIELDS[domain]!) {
        fakeResponse[field] = 'should-be-stripped';
      }
      const result = toUpdatePayload(fakeResponse, { domain });
      expect(result['userField']).toBe('keep');
      for (const field of STRIP_FIELDS[domain]!) {
        expect(result).not.toHaveProperty(field);
      }
    },
  );
});
