/**
 * Live-QA E2E for the core "assist/system" read tools: whoami and
 * get_license_info.
 *
 * These former tools had no E2E coverage, yet they exercise the full MCP path
 * including output-schema validation. get_license_info in particular regressed
 * on Horizon 2.10 (the license `modules` array became objects `{module, items}`
 * instead of strings, which failed the old `z.array(z.string())` output schema).
 * Running them through the real MCP stack against a live 2.10 instance proves
 * both tools work and that their declared output schemas accept the live shape.
 */
import { describe, expect, it } from 'vitest';

import { E2E_CONFIGURED, callTool, setupE2EStack } from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('system tools E2E (live QA)', () => {
  setupE2EStack();

  it('whoami returns the authenticated principal identity', async () => {
    const me = await callTool('whoami', {});
    // 2.10 nests identity under `identity`; older lines exposed top-level fields.
    const identity = (me['identity'] ?? me) as Record<string, unknown>;
    const identifier = identity['identifier'] ?? me['identifier'];
    expect(typeof identifier).toBe('string');
    expect(String(identifier).length).toBeGreaterThan(0);
  });

  it('get_license_info returns a version and module entitlements (2.10 shape)', async () => {
    // Passing through the full MCP stack means the output schema must accept the
    // live response; a schema mismatch surfaces here as a thrown error.
    const license = await callTool('get_license_info', {});
    expect(typeof license['version']).toBe('string');
    expect(String(license['version']).length).toBeGreaterThan(0);
    // modules may be bare strings (legacy) or { module, items } objects (2.10).
    if (license['modules'] !== undefined) {
      expect(Array.isArray(license['modules'])).toBe(true);
    }
  });
});
