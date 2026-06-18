/**
 * Live-QA E2E for the Horizon "wcce_forests" object (WCCE forest mappings).
 * Path: MCP protocol -> tool handler -> HorizonClient -> live Horizon QA,
 * against /api/v1/wcce/forests. idField = `forest`.
 *
 * Create body shape from the Bruno CI suite
 * (horizon/cicd/Evertrust-Horizon-api-test/16 - WCCE Forest Mapping):
 *   { forest: "<name>", templateMappings: [] }
 * mapped onto the MCP tool's snake_case inputs (forest, template_mappings).
 *
 * Full CRUD round-trip, self-cleaning by unique forest name. Tolerant on create
 * in case WCCE is not licensed on the target instance.
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

describe.skipIf(!E2E_CONFIGURED)('wcce_forest CRUD E2E (live QA)', () => {
  setupE2EStack();

  const forest = `${E2E_PREFIX}-wcce.local`;
  let created = false;

  afterAll(async () => {
    if (!created) return;
    try {
      await callTool('delete_wcce_forest', {
        forest,
        expected_forest: forest,
      });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('creates a forest mapping (or reports a clean license/validation error)', async () => {
    try {
      const r = await callTool('create_wcce_forest', {
        forest,
        template_mappings: [],
      });
      expect(r['status']).toBe('created');
      created = true;
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).message).toMatch(
        /wcce|forest|licen[cs]e|not\s+(allowed|enabled|supported)/i,
      );
    }
  });

  it('gets it back by forest name', async () => {
    if (!created) return;
    const r = await callTool('get_wcce_forest', { forest });
    expect(r['forest']).toBe(forest);
  });

  it('appears in the list', async () => {
    if (!created) return;
    const res = (await callTool('list_wcce_forests', {})) as Record<
      string,
      unknown
    >;
    const items = (res['items'] ?? res) as Array<Record<string, unknown>>;
    expect(items.some((f) => f['forest'] === forest)).toBe(true);
  });

  it('updates the forest mapping (full-replace, GET-merge)', async () => {
    if (!created) return;
    const r = await callTool('update_wcce_forest', {
      forest,
      template_mappings: [],
    });
    expect(r['status']).toBe('updated');
  });

  it('refuses a delete whose expected_forest does not match', async () => {
    if (!created) return;
    const raw = await callToolRaw('delete_wcce_forest', {
      forest,
      expected_forest: `${forest}-WRONG`,
    });
    expect(raw).toMatch(/match|expected|confirm/i);
  });

  it('deletes the forest mapping', async () => {
    if (!created) return;
    const r = await callTool('delete_wcce_forest', {
      forest,
      expected_forest: forest,
    });
    expect(r['deleted']).toBe(true);
    created = false;
  });
});
