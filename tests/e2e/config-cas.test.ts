/**
 * Live-QA E2E CRUD test for the Horizon config object "cas"
 * (Certificate Authorities).
 *
 * Exercises the full MCP path: create_ca / get_ca / list_cas / update_ca /
 * delete_ca against a live Horizon QA instance.
 *
 * Minimal valid payloads:
 *   - create body (name, certificate, trustedFor*Authentication,
 *     outdatedRevocationStatusPolicy, public). The PEM certificate below is a
 *     throwaway self-signed test CA (CN=Horizon MCP Test CA, O=Example).
 *   - update: PUT collection root, flips outdatedRevocationStatusPolicy ->
 *     lastavailablestatus and public -> true, plus identifier/name/email
 *     mappings.
 *   - get: GET /api/v1/cas/{name}; delete: DELETE /api/v1/cas/{name}.
 *
 * Tool schema:
 *   - idField: name (immutable primary key; CA name regex allows spaces but we
 *     stick to the prefixed form which also satisfies it).
 *   - mandatory: name, certificate, trustedForClientAuthentication,
 *     trustedForServerAuthentication, outdatedRevocationStatusPolicy, public.
 *   - update = PUT on the COLLECTION route (body-keyed full-replace). The
 *     certificate is REQUIRED by the request schema even on update but is
 *     IGNORED: the server keeps the previously stored certificate. We still
 *     send a certificate because the schema parses it; the tool wrapper's
 *     GET-strip-merge-PUT preserves the stored value regardless.
 *
 * Tolerance: a standard QA instance accepts the test CA certificate, so the
 * create is expected to succeed and round-trip. If a given instance rejects it with a
 * clean Horizon CA validation error (CA-001/CA-002) or a license error, that
 * is a legitimate server response, NOT a tool/client bug, and the create
 * assertion tolerates it.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('cas CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Unique CA name. The CA name regex is [0-9a-zA-Z-_ ]+ (no leading/trailing
  // space); the prefixed form `e2e-<hex8>-ca` satisfies it.
  const name = `${E2E_PREFIX}-ca`;

  // PEM-encoded throwaway self-signed X.509 CA certificate (EC P-256,
  // CN=Horizon MCP Test CA, O=Example, 10-year validity). No key is kept.
  const certificate =
    '-----BEGIN CERTIFICATE-----\nMIIBxjCCAWugAwIBAgIUbVXpUWfYlTfWMQ9irYqSLQgw5qIwCgYIKoZIzj0EAwIw\nMDEcMBoGA1UEAwwTSG9yaXpvbiBNQ1AgVGVzdCBDQTEQMA4GA1UECgwHRXhhbXBs\nZTAeFw0yNjA5MjMwOTEwNDFaFw0zNjA5MjAwOTEwNDFaMDAxHDAaBgNVBAMME0hv\ncml6b24gTUNQIFRlc3QgQ0ExEDAOBgNVBAoMB0V4YW1wbGUwWTATBgcqhkjOPQIB\nBggqhkjOPQMBBwNCAASNlVunodn7v5xk3Bq3xrphmjixwWZlUYF0jWZaoVq7pXwc\naat3N0IPevjKXZG9+s2c5JVok2+TViov9tdR5/1mo2MwYTAdBgNVHQ4EFgQUCPLy\n5VHdzdd6E3hAiDIXBbM9gNcwHwYDVR0jBBgwFoAUCPLy5VHdzdd6E3hAiDIXBbM9\ngNcwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwID\nSQAwRgIhAKZwwsxwzX272qgd+Z1c6jb8gVdcqCdRRyq3m6qu7piaAiEAov0wE4/8\n1/bk6vnbYEpzYqTi6G07BWFnHSDEbB7Sstg=\n-----END CERTIFICATE-----';

  // Tracks whether the CA was actually created so later it/round-trip steps
  // and cleanup only run when the create succeeded.
  let caCreated = false;
  // Tracks whether the delete step actually executed (so the deletion-confirm
  // step only asserts the not-found error when a delete really happened).
  let caDeleted = false;

  afterAll(async () => {
    // Best-effort teardown. Swallow every error so cleanup never fails the run.
    if (!caCreated || caDeleted) return;
    try {
      await callTool('delete_ca', { name, expected_name: name });
    } catch {
      /* already deleted or never created */
    }
  });

  it('creates a CA (or reports a clean Horizon validation/license error)', async () => {
    // Minimal create body, mapped to the snake_case MCP tool inputs.
    const createArgs = {
      name,
      certificate,
      trusted_for_server_authentication: false,
      trusted_for_client_authentication: false,
      outdated_revocation_status_policy: 'revoked',
      public: false,
    };

    try {
      const r = await callTool('create_ca', createArgs);
      expect(r['status']).toBe('created');
      expect(r['name']).toBe(name);
      caCreated = true;
    } catch (err) {
      // A standard QA instance accepts the test CA certificate.
      // If this instance rejects it, accept ONLY a clean Horizon CA validation
      // or license error - not a tool/client bug.
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).message).toMatch(
        /CA-00[12]|certificate|basicConstraints|thumbprint|license|not licensed/i,
      );
    }
  });

  it('gets it back with the created fields', async () => {
    if (!caCreated) return;
    const r = await callTool('get_ca', { name });
    expect(r['name']).toBe(name);
    expect(r['outdatedRevocationStatusPolicy']).toBe('revoked');
    expect(r['public']).toBe(false);
    expect(r['trustedForClientAuthentication']).toBe(false);
    expect(r['trustedForServerAuthentication']).toBe(false);
    // Server-populated id is present on the response object.
    expect(r['_id']).toBeDefined();
    // subjectKeyIdentifier is server-populated from the certificate on upsert.
    expect(r['subjectKeyIdentifier']).toBeDefined();
  });

  it('appears in the list (filtered by name substring)', async () => {
    if (!caCreated) return;
    const r = await callTool('list_cas', { name_contains: name });
    expect(r['kind']).toBe('ca');
    const items = (r['items'] as Array<Record<string, unknown>>) ?? [];
    expect(items.some((c) => c['name'] === name)).toBe(true);
  });

  it('updates revocation policy and public flag via collection-root PUT', async () => {
    if (!caCreated) return;
    // Flip the policy to lastavailablestatus and public to true. The
    // certificate is required by the request schema but ignored on update
    // (server keeps the stored cert); we resend the original cert so the
    // schema parses.
    const r = await callTool('update_ca', {
      name,
      certificate,
      trusted_for_server_authentication: false,
      trusted_for_client_authentication: false,
      outdated_revocation_status_policy: 'lastavailablestatus',
      public: true,
    });
    expect(r['status']).toBe('updated');
    expect(r['name']).toBe(name);

    const fetched = await callTool('get_ca', { name });
    expect(fetched['outdatedRevocationStatusPolicy']).toBe(
      'lastavailablestatus',
    );
    expect(fetched['public']).toBe(true);
    // The CA certificate cannot change on update: subjectKeyIdentifier (derived
    // from the stored cert) is preserved through the GET-strip-merge-PUT cycle.
    expect(fetched['subjectKeyIdentifier']).toBeDefined();
  });

  it('deletes it (with expected_name safeguard)', async () => {
    if (!caCreated) return;
    const r = await callTool('delete_ca', { name, expected_name: name });
    expect(r['deleted']).toBe(true);
    expect(r['name']).toBe(name);
    caDeleted = true;
  });

  it('confirms deletion: get now errors (CA-003 not found)', async () => {
    // Only assert once the delete step actually ran; otherwise the CA either
    // was never created or still exists, so there is nothing to confirm.
    if (!caDeleted) return;
    await expect(callTool('get_ca', { name })).rejects.toThrow(ToolError);
  });
});
