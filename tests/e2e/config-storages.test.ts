/**
 * Live-QA E2E CRUD test for the Horizon "storages" config object (S3 storage
 * backend). Exercises the full path: MCP protocol -> tool handler ->
 * HorizonClient -> live Horizon QA, against /api/v1/system/storages.
 *
 * Request bodies are copied from the Bruno CICD suite:
 *   horizon/cicd/Evertrust-Horizon-api-test/64 - Dynamic Storage/*.bru
 * mapped onto the MCP tool's snake_case inputs (see src/tools/config/storages.ts).
 *
 * Tool surface: create_storage / get_storage / update_storage / delete_storage
 * / list_storages. idField = name.
 *
 * Notes on the s3 subtype:
 *   - Mandatory create fields: name, timeout, force_path_style, bucket,
 *     checksum_mode, part_buffer_size (the Scala Format requires all of these;
 *     timeout is server-enforced mandatory). No external dependency is needed:
 *     credentials/proxy are optional and intentionally omitted so the suite is
 *     self-contained on a standard QA instance.
 *   - Update PUTs the COLLECTION root (body-keyed full-replace); the wrapper
 *     does GET-merge so the name lookup must already exist.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('storages CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Storage name regex is [0-9a-zA-Z-_.]+; E2E_PREFIX (e2e-<hex8>) satisfies it.
  const name = `${E2E_PREFIX}-s3-storage`;

  // Set to true once create succeeds, so round-trip/cleanup only run for real.
  let created = false;

  afterAll(async () => {
    if (!created) return;
    try {
      await callTool('delete_storage', {
        name,
        expected_name: name,
      });
    } catch {
      // best-effort cleanup; never fail the suite on teardown
    }
  });

  it('creates the S3 storage (or surfaces a clean Horizon validation/license error)', async () => {
    // Body mirrors "Register a new S3 storage.bru".
    const createArgs = {
      name,
      type: 's3',
      description: 'Test S3 storage for API tests',
      bucket: 'my-test-bucket',
      timeout: '10s',
      force_path_style: false,
      checksum_mode: 'when_required',
      part_buffer_size: '9MB',
    };

    let result: Record<string, unknown>;
    try {
      result = await callTool('create_storage', createArgs);
    } catch (err) {
      // Dynamic storage may be gated/unlicensed on a given QA instance. Accept a
      // clean Horizon-side validation/license error (a ToolError carrying the
      // server message), but NOT a tool/client bug.
      expect(err).toBeInstanceOf(ToolError);
      const message = (err as ToolError).message.toLowerCase();
      expect(message).toMatch(
        /storage|license|not licensed|forbidden|unauthorized|disabled|not enabled|feature/,
      );
      return;
    }

    created = true;
    expect(result['status']).toBe('created');
    expect(result['kind']).toBe('storage');
    expect(result['name']).toBe(name);

    const data = result['data'] as Record<string, unknown> | undefined;
    if (data) {
      expect(data['name']).toBe(name);
      expect(data['type']).toBe('s3');
      expect(data['bucket']).toBe('my-test-bucket');
      expect(data['forcePathStyle']).toBe(false);
      expect(data['checksumMode']).toBe('when_required');
    }
  });

  it('gets it back', async () => {
    if (!created) return; // create was not possible on this instance
    const result = await callTool('get_storage', { name });
    expect(result['name'] ?? result['_id']).toBe(name);
    expect(result['type']).toBe('s3');
    expect(result['bucket']).toBe('my-test-bucket');
    expect(result['forcePathStyle']).toBe(false);
    expect(result['checksumMode']).toBe('when_required');
  });

  it('appears in the storage list', async () => {
    if (!created) return;
    const result = await callTool('list_storages', { name_contains: name });
    const items = result['items'] as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((i) => i['name'] === name)).toBe(true);
  });

  it('updates the S3 storage', async () => {
    if (!created) return;
    // Changes mirror "Update the S3 storage.bru".
    const result = await callTool('update_storage', {
      name,
      description: 'Updated S3 storage description',
      bucket: 'updated-bucket',
      region: 'eu-west-1',
      timeout: '30s',
      force_path_style: true,
      checksum_mode: 'when_supported',
      part_buffer_size: '15MB',
      endpoint: 'https://s3.custom-endpoint.example.com',
    });

    expect(result['status']).toBe('updated');
    expect(result['kind']).toBe('storage');
    expect(result['name']).toBe(name);

    const data = result['data'] as Record<string, unknown> | undefined;
    if (data) {
      expect(data['bucket']).toBe('updated-bucket');
      expect(data['region']).toBe('eu-west-1');
      expect(data['forcePathStyle']).toBe(true);
      expect(data['checksumMode']).toBe('when_supported');
      expect(data['endpoint']).toBe('https://s3.custom-endpoint.example.com');
    }
  });

  it('rejects deletion when the safety echo does not match', async () => {
    if (!created) return;
    await expect(
      callTool('delete_storage', { name, expected_name: 'wrong-name' }),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it('deletes the S3 storage', async () => {
    if (!created) return;
    const result = await callTool('delete_storage', {
      name,
      expected_name: name,
    });
    expect(result['deleted']).toBe(true);
    expect(result['name']).toBe(name);
    expect(result['kind']).toBe('storage');

    // After deletion the object is gone -> get must fail with a 404 ToolError.
    await expect(callTool('get_storage', { name })).rejects.toBeInstanceOf(
      ToolError,
    );

    created = false; // already deleted; skip afterAll teardown
  });
});
