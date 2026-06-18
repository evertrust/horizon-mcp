/**
 * Live-QA E2E CRUD test for the Horizon 2.10 config object "terms_of_service".
 *
 * Exercises create/get/update/delete/list_terms_of_service(s) against live
 * Horizon 2.10 QA via the full MCP path. ToS contents are markdown, validated
 * server-side; the test uses valid markdown so the round-trip is real.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('terms_of_service CRUD E2E (live QA)', () => {
  setupE2EStack();

  const name = `${E2E_PREFIX}-tos`;

  afterAll(async () => {
    try {
      await callTool('delete_terms_of_service', { name, expected_name: name });
    } catch {
      /* already deleted or never created */
    }
  });

  it('creates a Terms of Service entry with localized markdown contents', async () => {
    const r = await callTool('create_terms_of_service', {
      name,
      description: 'e2e terms',
      contents: [
        { lang: 'en', value: '# Terms\n\nYou agree to the **terms**.' },
        {
          lang: 'fr',
          value: '# Conditions\n\nVous acceptez les **conditions**.',
        },
      ],
    });
    expect(r['status']).toBe('created');
    expect(r['name']).toBe(name);
  });

  it('gets it back with both languages', async () => {
    const r = await callTool('get_terms_of_service', { name });
    expect(r['name']).toBe(name);
    const contents = (r['contents'] as Array<Record<string, unknown>>) ?? [];
    expect(contents.map((c) => c['lang']).sort()).toEqual(['en', 'fr']);
  });

  it('appears in the list (filtered by name substring)', async () => {
    const r = await callTool('list_terms_of_services', { name_contains: name });
    expect(r['kind']).toBe('terms_of_service');
    const items = (r['items'] as Array<Record<string, unknown>>) ?? [];
    expect(items.some((t) => t['name'] === name)).toBe(true);
  });

  it('updates the contents (GET-merge full-replace) and preserves description', async () => {
    const r = await callTool('update_terms_of_service', {
      name,
      contents: [{ lang: 'en', value: '# Updated Terms' }],
    });
    expect(r['status']).toBe('updated');
    const fetched = await callTool('get_terms_of_service', { name });
    const contents =
      (fetched['contents'] as Array<Record<string, unknown>>) ?? [];
    expect(contents[0]?.['value']).toContain('Updated Terms');
    expect(fetched['description']).toBe('e2e terms');
  });

  it('rejects a delete with a mismatched safety echo', async () => {
    await expect(
      callTool('delete_terms_of_service', { name, expected_name: 'wrong' }),
    ).rejects.toThrow(ToolError);
  });

  it('deletes it and confirms it is gone', async () => {
    const r = await callTool('delete_terms_of_service', {
      name,
      expected_name: name,
    });
    expect(r['deleted']).toBe(true);
    await expect(callTool('get_terms_of_service', { name })).rejects.toThrow(
      ToolError,
    );
  });
});
