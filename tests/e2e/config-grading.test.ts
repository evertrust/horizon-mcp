/**
 * Live-QA E2E test for the Horizon "grading" config objects (READ-ONLY).
 *
 * Grading has NO create/update/delete request body over the REST API: the Play
 * routes + controllers expose only GET list / GET by name (plus explain/run,
 * which do not persist). Grading policies and rulesets are system-bootstrapped
 * defaults (the built-in 'Horizon-Grading-Policy' is provisioned server-side at
 * bootstrap when absent, except for the root tenant). See
 *   docs/audit/certificate_grading_policies.contract.json
 *   docs/audit/certificate_grading_rulesets.contract.json
 *
 * Tools exercised (all read-only):
 *   list_certificate_grading_policies  -> GET /api/v1/certificate/grading/policies
 *   get_certificate_grading_policy     -> GET /api/v1/certificate/grading/policies/{name}
 *   list_certificate_grading_rulesets              -> GET /api/v1/certificate/grading/rulesets
 *
 * Because there is no create flow, this suite asserts only that the read tools
 * succeed and return well-formed envelopes. No objects are created, so there is
 * no cleanup to perform.
 *
 * Bruno reference (read-only object, no mutating .bru exists):
 *   horizon/cicd/Evertrust-Horizon-api-test/62 - Grading/* only enrolls against a
 *   profile that references the built-in "Horizon-Grading-Policy" - confirming
 *   that policy is the canonical bootstrap policy expected to exist on QA.
 *
 * Tolerance: a standard QA tenant is bootstrapped with grading defaults, so the
 * built-in policy round-trip is expected to succeed. If the instance happens to
 * be the root tenant (which bootstrap skips) or lists no policies, the get
 * round-trip is skipped rather than failing - the list/get tools themselves are
 * still asserted to behave correctly.
 */
import { describe, expect, it } from 'vitest';

import { E2E_CONFIGURED, callTool, setupE2EStack } from './setup.js';

// The built-in grading policy provisioned by HorizonBootstrapActor when absent.
const BUILTIN_POLICY = 'Horizon-Grading-Policy';

describe.skipIf(!E2E_CONFIGURED)('grading read-only E2E (live QA)', () => {
  setupE2EStack();

  it('lists certificate grading policies', async () => {
    const r = await callTool('list_certificate_grading_policies', {});
    expect(Array.isArray(r['items'])).toBe(true);
    expect(r['kind']).toBe('certificate_grading_policy');
    expect(typeof r['count']).toBe('number');
    expect(typeof r['total_available']).toBe('number');
  });

  it('lists grading rulesets', async () => {
    const r = await callTool('list_certificate_grading_rulesets', {});
    expect(Array.isArray(r['items'])).toBe(true);
    expect(r['kind']).toBe('certificate_grading_ruleset');
    expect(typeof r['count']).toBe('number');
    expect(typeof r['total_available']).toBe('number');
  });

  it('gets a single grading policy by name (built-in or first listed)', async () => {
    // Prefer the canonical built-in policy; fall back to whatever the instance
    // lists so the test works on any standard QA tenant.
    const list = await callTool('list_certificate_grading_policies', {});
    const items = (list['items'] ?? []) as Array<Record<string, unknown>>;

    const hasBuiltin = items.some((p) => p['name'] === BUILTIN_POLICY);
    const target = hasBuiltin
      ? BUILTIN_POLICY
      : ((items[0]?.['name'] as string | undefined) ?? undefined);

    // Root tenant gets no grading bootstrap and may list zero policies; nothing
    // to round-trip in that case.
    if (target === undefined) return;

    const r = await callTool('get_certificate_grading_policy', {
      name: target,
    });
    expect(r['name']).toBe(target);

    // A grading policy is a weighted set of rulesets; when present, each entry's
    // referenced ruleset must resolve to a name listed by list_certificate_grading_rulesets
    // (the audited GradingRuleset dependency).
    const weighted = r['rulesets'];
    if (Array.isArray(weighted) && weighted.length > 0) {
      const rulesetList = await callTool(
        'list_certificate_grading_rulesets',
        {},
      );
      const rulesetNames = new Set(
        ((rulesetList['items'] ?? []) as Array<Record<string, unknown>>).map(
          (rs) => rs['name'],
        ),
      );
      for (const entry of weighted as Array<Record<string, unknown>>) {
        const refName = entry['ruleset'];
        if (typeof refName === 'string') {
          expect(rulesetNames.has(refName)).toBe(true);
        }
      }
    }
  });
});
