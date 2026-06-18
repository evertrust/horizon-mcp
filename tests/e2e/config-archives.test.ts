/**
 * Live-QA E2E test for the Horizon "archives" config object. Exercises the full
 * path: MCP protocol -> tool handler -> HorizonClient -> live Horizon QA,
 * against /api/v1/archives.
 *
 * Request body is copied from the Bruno CICD suite:
 *   horizon/cicd/Evertrust-Horizon-api-test/60 - Archives/
 *     02 - Action status check/Create an empty certificate archive.bru
 * mapped onto the MCP tool's snake_case inputs (see src/tools/config/archives.ts).
 *
 * Tool surface: create_archive / get_archive / delete_archive / list_archives.
 * idField = name. There is NO update verb: an archive is a one-shot
 * create-and-delete job (POST /api/v1/archives both creates the document AND
 * immediately starts the archiving job; the item route exposes only GET +
 * DELETE).
 *
 * Why the "empty certificate archive" body:
 *   - type=certificate with archiveKeys=false and an HCQL filter that matches
 *     zero certificates ("profile equals \"idontexist\""). The job therefore
 *     completes instantly with count 0, archives no real certificate data, and
 *     escrows no private keys, so the suite stays self-contained and harmless on
 *     a standard QA instance.
 *   - Subtype-specific fields (archiveKeys, filter) are passed via `config`;
 *     the typed mandatory params are name, type, filename.
 *   - filename is prefixed with E2E_PREFIX because it must be unique across
 *     archives and must not already exist on the configured storage backend.
 *
 * Tolerant create: CertificateArchive requires a CLM or PKI license AND a
 * configured archive storage backend. On a QA instance lacking either, create
 * legitimately fails. We accept a clean Horizon-side validation/license error
 * (a ToolError carrying the server message) but NOT a tool/client bug; the
 * round-trip + cleanup then run only when create actually succeeds.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('archives CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Archive name regex is [0-9a-zA-Z-_.]; E2E_PREFIX (e2e-<hex8>) satisfies it.
  const name = `${E2E_PREFIX}-cert-archive`;
  // filename must be unique across archives and must not pre-exist on storage.
  const filename = `${E2E_PREFIX}-archive.parquet`;
  // Matches zero certificates -> instant completion, count 0, no key escrow.
  const filter = 'profile equals "idontexist"';

  // Set to true once create succeeds, so round-trip/cleanup only run for real.
  let created = false;

  afterAll(async () => {
    if (!created) return;
    try {
      await callTool('delete_archive', { name, expected_name: name });
    } catch {
      // best-effort cleanup; never fail the suite on teardown
    }
  });

  it('creates the certificate archive (or surfaces a clean Horizon validation/license error)', async () => {
    // Body mirrors "Create an empty certificate archive.bru":
    //   { type: "certificate", name, filename, archiveKeys: false,
    //     filter: 'profile equals "idontexist"' }
    const createArgs = {
      name,
      type: 'certificate',
      filename,
      config: {
        archiveKeys: false,
        filter,
      },
    };

    let result: Record<string, unknown>;
    try {
      result = await callTool('create_archive', createArgs);
    } catch (err) {
      // Archives require a CLM/PKI license and a configured archive storage
      // backend. Either may be absent on a given QA instance. Accept a clean
      // Horizon-side validation/license error (a ToolError carrying the server
      // message), but NOT a tool/client bug.
      expect(err).toBeInstanceOf(ToolError);
      const message = (err as ToolError).message.toLowerCase();
      expect(message).toMatch(
        /archive|license|not licensed|entitle|forbidden|unauthorized|storage|backend|invalid|disabled|not enabled|feature/,
      );
      return;
    }

    created = true;
    expect(result['status']).toBe('created');
    expect(result['kind']).toBe('archive');
    expect(result['name']).toBe(name);

    const data = result['data'] as Record<string, unknown> | undefined;
    if (data) {
      expect(data['name']).toBe(name);
      expect(data['type']).toBe('certificate');
      expect(data['filename']).toBe(filename);
      expect(data['archiveKeys']).toBe(false);
      expect(data['filter']).toBe(filter);
    }
  });

  it('gets it back', async () => {
    if (!created) return; // create was not possible on this instance
    const result = await callTool('get_archive', { name });
    expect(result['name'] ?? result['_id']).toBe(name);
    expect(result['type']).toBe('certificate');
    expect(result['filename']).toBe(filename);
    expect(result['archiveKeys']).toBe(false);
    expect(result['filter']).toBe(filter);
  });

  it('appears in the archive list', async () => {
    if (!created) return;
    const result = await callTool('list_archives', { name_contains: name });
    const items = result['items'] as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((i) => i['name'] === name)).toBe(true);
  });

  it('rejects deletion when the safety echo does not match', async () => {
    if (!created) return;
    await expect(
      callTool('delete_archive', { name, expected_name: 'wrong-name' }),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it('deletes the archive', async () => {
    if (!created) return;
    const result = await callTool('delete_archive', {
      name,
      expected_name: name,
    });
    expect(result['deleted']).toBe(true);
    expect(result['name']).toBe(name);
    expect(result['kind']).toBe('archive');

    // After deletion the object is gone -> get must fail with a 404 ToolError.
    await expect(callTool('get_archive', { name })).rejects.toBeInstanceOf(
      ToolError,
    );

    created = false; // already deleted; skip afterAll teardown
  });
});
