/**
 * Live-QA E2E test for the Horizon "system_configuration" object.
 * Path: MCP protocol -> tool handler -> HorizonClient -> live Horizon QA,
 * against /api/v1/system/configuration.
 *
 * Tool surface: describe_system_config_schema / list_system_configs /
 * get_system_config / update_system_config. idField = `type`. There is NO
 * create (POST /api/v1/system/configuration returns 404 - confirmed against
 * live QA; the 4 entries are server-bootstrapped) and NO delete.
 *
 * This object is a TENANT-WIDE singleton keyed by `type`, NOT isolatable per
 * run. To stay non-destructive we only READ, and exercise the real PUT-upsert
 * path IDEMPOTENTLY: GET the existing `interface_customization` entry, then
 * update_system_config with no field changes (GET-strip-merge-PUT re-persists
 * the same values), and assert the entry is unchanged. We never touch the
 * `license` or `storage` subtypes.
 */
import { describe, expect, it } from 'vitest';

import { E2E_CONFIGURED, callTool, setupE2EStack } from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('system_configuration E2E (live QA)', () => {
  setupE2EStack();

  const type = 'interface_customization';

  it('lists the bootstrapped system configuration entries', async () => {
    const res = (await callTool('list_system_configs', {})) as Record<
      string,
      unknown
    >;
    const items = (res['items'] ?? res) as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((e) => e['type'] === type)).toBe(true);
  });

  it('gets the interface_customization entry by type', async () => {
    const entry = (await callTool('get_system_config', { type })) as Record<
      string,
      unknown
    >;
    expect(entry['type']).toBe(type);
  });

  it('describe_system_config_schema returns the 4 subtypes + schema', async () => {
    const out = (await callTool('describe_system_config_schema', {})) as Record<
      string,
      unknown
    >;
    expect(out['discriminatorField']).toBe('type');
    expect(out['subtypes']).toEqual([
      'license',
      'internal_monitor',
      'interface_customization',
      'storage',
    ]);
    expect(out['jsonSchema']).toBeDefined();
  });

  it('idempotently upserts interface_customization (PUT path, no net change)', async () => {
    const before = (await callTool('get_system_config', { type })) as Record<
      string,
      unknown
    >;
    // update with no field overrides -> GET-strip-merge-PUT re-persists the
    // current values verbatim. Exercises the real upsert without changing data.
    const res = (await callTool('update_system_config', { type })) as Record<
      string,
      unknown
    >;
    expect(res['status']).toBe('updated');

    const after = (await callTool('get_system_config', { type })) as Record<
      string,
      unknown
    >;
    expect(after['type']).toBe(type);
    // The logo (if the tenant has one) survives the idempotent round-trip.
    expect(after['logo']).toStrictEqual(before['logo']);
  });
});
