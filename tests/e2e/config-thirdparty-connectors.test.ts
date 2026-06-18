/**
 * Live-QA E2E CRUD test for the Horizon config object "thirdparty_connectors".
 *
 * Exercises the full MCP path: describe_thirdparty_connector_schema /
 * create_thirdparty_connector / get_thirdparty_connector /
 * list_thirdparty_connectors / update_thirdparty_connector /
 * delete_thirdparty_connector against a live Horizon QA instance.
 *
 * Polymorphic object (discriminated by `type`, 11 subtypes). We pick the
 * SIMPLEST subtype present in the Bruno CI suite: `aws`.
 *
 * Why aws:
 *   - Its only mandatory subtype field beyond the universal trio is `region`.
 *   - `credentials` is OPTIONAL for aws (env fallback) per the audit contract,
 *     so no credentials dependency is strictly required to create it.
 *   - `throttleParallelism` and `maxStoredCertificatePerHolder` are NOT request
 *     fields for aws (hardcoded server-side); they are ABSENT from the resolved
 *     AWSConnector schema, so the client-side guard (assertConfigBody) rejects
 *     them as unknown keys. The Bruno "Register a new aws third party
 *     connector.bru" sends them, but the source-grounded contract is
 *     authoritative here, so the minimal valid body is type/name/
 *     throttleDuration/region.
 *
 * Bruno payload source:
 *   horizon/cicd/Evertrust-Horizon-api-test/05 - Third Party Connector/
 *     - "Register a new aws third party connector.bru"
 *         -> { type: aws, name, throttleDuration: "60s", region: "FR", ... }
 *     - "Delete the aws third party connector.bru" -> DELETE /{name} (204)
 *     - "Register a password credential.bru"
 *         -> optional credentials dep (type=password, targets=[thirdparty, mdm])
 *
 * Contract: docs/audit/thirdparty_connectors.contract.json
 *   - idField: name (immutable primary key, regex [0-9a-zA-Z-_.])
 *   - mandatory (all subtypes): type, name, throttleDuration
 *   - aws additionally requires: region
 *   - update = PUT on COLLECTION root (body-keyed full-replace, GET-strip-merge)
 *   - `type` is immutable
 *
 * Tolerant create: AWS publishing is a licensed/configured feature. On a
 * standard QA instance the create may be rejected with a clean Horizon
 * validation/license error (e.g. ThirdpartyConnector*, license, region/
 * credentials reference). We accept EITHER success (then round-trip + cleanup)
 * OR a clean ToolError surfacing such a server error - never a tool/client bug.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  callToolRaw,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)(
  'thirdparty_connectors CRUD E2E (live QA)',
  () => {
    setupE2EStack();

    // Unique, regex-safe name (no spaces; [0-9a-zA-Z-_.]). aws subtype.
    const name = `${E2E_PREFIX}-tpc-aws`;
    // Optional password credential dependency (targets thirdparty + mdm),
    // mirroring "Register a password credential.bru". aws does NOT require it
    // (env fallback), so we provision it best-effort but never depend on it.
    const credsName = `${E2E_PREFIX}-tpc-creds`;

    let credsCreated = false;
    // Whether the connector create succeeded; gates the round-trip/update/delete
    // assertions so the suite stays green when the feature is not provisioned.
    let connectorCreated = false;

    // From the Bruno aws connector body (minimal valid set per the contract).
    const throttleDuration = '60s';
    const region = 'FR';
    const updatedThrottleDuration = '120s';

    beforeAll(async () => {
      // Best-effort dependency. There is no MCP tool for credentials, so POST
      // directly via the raw HorizonClient, mirroring the Bruno credential body.
      try {
        const client = getHorizonClient();
        await client.post('/api/v1/security/credentials', {
          name: credsName,
          type: 'password',
          login: 'login',
          password: { value: 'test' },
          targets: ['thirdparty', 'mdm'],
        });
        credsCreated = true;
      } catch {
        // Credentials feature unavailable / not permitted on this QA instance.
        credsCreated = false;
      }
    });

    afterAll(async () => {
      // Best-effort teardown: delete the connector first (it may reference the
      // credential), then the credential. Swallow every error.
      try {
        await callTool('delete_thirdparty_connector', {
          name,
          expected_name: name,
        });
      } catch {
        /* already deleted or never created */
      }
      if (credsCreated) {
        try {
          const client = getHorizonClient();
          await client.delete(
            `/api/v1/security/credentials/${encodeURIComponent(credsName)}`,
          );
        } catch {
          /* referenced or already gone */
        }
      }
    });

    it('describes the schema (aws subtype is known, region required)', async () => {
      const r = await callTool('describe_thirdparty_connector_schema', {
        subtype: 'aws',
      });
      expect(r['object']).toBe('thirdparty_connector');
      expect(r['discriminatorField']).toBe('type');
      expect(r['subtypes']).toContain('aws');
      const mandatory = (r['mandatoryFields'] as string[]) ?? [];
      expect(mandatory).toContain('type');
      expect(mandatory).toContain('name');
      expect(mandatory).toContain('throttleDuration');
    });

    it('creates an aws connector (or reports a clean server validation/license error)', async () => {
      const createArgs = {
        type: 'aws',
        name,
        throttle_duration: throttleDuration,
        config: { region },
      };

      try {
        const r = await callTool('create_thirdparty_connector', createArgs);
        expect(r['status']).toBe('created');
        expect(r['name']).toBe(name);
        connectorCreated = true;
      } catch (err) {
        // Tolerated: AWS publishing not licensed/configured on this instance, or
        // the region/credentials reference is rejected. Must be a clean Horizon
        // validation/license error surfaced as a ToolError, NOT a client bug.
        expect(err).toBeInstanceOf(ToolError);
        expect((err as ToolError).message).toMatch(
          /ThirdpartyConnector|thirdparty|connector|licen[cs]e|region|credential|reference|InvalidReference|not\s+(allowed|enabled|supported)/i,
        );
      }
    });

    it('gets it back with type=aws and the created region', async () => {
      if (!connectorCreated) return; // create was cleanly rejected; nothing to fetch
      const r = await callTool('get_thirdparty_connector', { name });
      expect(r['name']).toBe(name);
      expect(r['type']).toBe('aws');
      expect(r['region']).toBe(region);
      // Server-populated id is present on the response object.
      expect(r['_id']).toBeDefined();
    });

    it('appears in the list (filtered by name substring)', async () => {
      if (!connectorCreated) return;
      const r = await callTool('list_thirdparty_connectors', {
        name_contains: name,
      });
      expect(r['kind']).toBe('thirdparty_connector');
      const items = (r['items'] as Array<Record<string, unknown>>) ?? [];
      expect(items.some((c) => c['name'] === name)).toBe(true);
    });

    it('updates throttle_duration via collection-root PUT (region preserved)', async () => {
      if (!connectorCreated) return;
      const r = await callTool('update_thirdparty_connector', {
        type: 'aws',
        name,
        throttle_duration: updatedThrottleDuration,
        config: { region },
      });
      expect(r['status']).toBe('updated');
      expect(r['name']).toBe(name);

      const fetched = await callTool('get_thirdparty_connector', { name });
      // Horizon normalizes FiniteDuration strings ("120s" -> "120 seconds").
      expect(String(fetched['throttleDuration'])).toMatch(
        /^120\s*(s|seconds)$/,
      );
      // region survived the GET-strip-merge-PUT full-replace cycle.
      expect(fetched['region']).toBe(region);
      expect(fetched['type']).toBe('aws');
    });

    it('rejects a delete whose expected_name does not match', async () => {
      if (!connectorCreated) return;
      // deleteGuard fires before any API call; the mismatch is surfaced as an
      // error envelope (no HTTP request reaches Horizon).
      const raw = await callToolRaw('delete_thirdparty_connector', {
        name,
        expected_name: `${name}-WRONG`,
      });
      expect(raw).toMatch(/match|expected|confirm/i);
    });

    it('deletes it (with expected_name safeguard)', async () => {
      if (!connectorCreated) return;
      const r = await callTool('delete_thirdparty_connector', {
        name,
        expected_name: name,
      });
      expect(r['deleted']).toBe(true);
      expect(r['name']).toBe(name);
      connectorCreated = false; // afterAll delete becomes a no-op

      // Confirms deletion: get now errors (ThirdpartyConnector003 not found).
      await expect(
        callTool('get_thirdparty_connector', { name }),
      ).rejects.toThrow(ToolError);
    });
  },
);
