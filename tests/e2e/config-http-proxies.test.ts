/**
 * Live-QA E2E CRUD test for the Horizon config object "http_proxies".
 *
 * Exercises the full MCP path: create_http_proxy / get_http_proxy /
 * update_http_proxy / delete_http_proxy / list_http_proxies against a live
 * Horizon QA instance.
 *
 * Payloads are derived from the Bruno CI suite:
 *   horizon/cicd/Evertrust-Horizon-api-test/08 - HTTP Proxy/
 *     - "Register a new http proxy.bru"  -> { name, host, port }
 *     - "Update the http proxy.bru"      -> PUT collection, host change
 *     - "Register a password credential.bru" -> proxy Basic-auth credentials dep
 *     - "Add creds to proxy.bru"         -> PUT collection adding credentials
 *
 * Contract: docs/audit/http_proxies.contract.json
 *   - idField: name (immutable primary key, regex [0-9a-zA-Z-_.]+)
 *   - mandatory: name, host, port
 *   - update = PUT on COLLECTION route (body-keyed full-replace)
 *   - optional `credentials` -> existing `password` credentials with PROXY target
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('http_proxies CRUD E2E (live QA)', () => {
  setupE2EStack();

  // Unique, regex-safe names (no spaces; [0-9a-zA-Z-_.]+).
  const name = `${E2E_PREFIX}-httpproxy`;
  const authProxyName = `${E2E_PREFIX}-httpproxy-auth`;
  // Credentials name uses NameIdentifier rules too; prefix keeps it unique.
  const credsName = `${E2E_PREFIX}-proxycreds`;

  // Track whether the credentials dependency was successfully created so we
  // only attempt the credentials-backed assertions / cleanup when present.
  let credsCreated = false;

  // From the Bruno "Register a new http proxy.bru" / "Update the http proxy.bru".
  const host = 'toti.tito.coal';
  const port = 3245;
  const updatedHost = 'tito.toti.gold';

  beforeAll(async () => {
    // Best-effort dependency setup for the optional `credentials` field.
    // There is no MCP tool for credentials, so we POST directly via the raw
    // HorizonClient, mirroring "Register a password credential.bru" exactly:
    //   type=password, login=horizon, password.value=evertrust, targets=[proxy].
    try {
      const client = getHorizonClient();
      await client.post('/api/v1/security/credentials', {
        name: credsName,
        type: 'password',
        login: 'horizon',
        password: { value: 'evertrust' },
        targets: ['proxy'],
      });
      credsCreated = true;
    } catch {
      // Credentials feature unavailable / not permitted on this QA instance.
      // The credentials-backed assertions below tolerate this.
      credsCreated = false;
    }
  });

  afterAll(async () => {
    // Best-effort teardown: delete proxies first (they may reference creds),
    // then the credentials. Swallow every error so cleanup never fails the run.
    for (const n of [name, authProxyName]) {
      try {
        await callTool('delete_http_proxy', {
          name: n,
          expected_name: n,
        });
      } catch {
        /* already deleted or never created */
      }
    }
    if (credsCreated) {
      try {
        const client = getHorizonClient();
        await client.delete(
          `/api/v1/security/credentials/${encodeURIComponent(credsName)}`,
        );
      } catch {
        /* swallow */
      }
    }
  });

  it('creates an HTTP proxy (name, host, port)', async () => {
    const r = await callTool('create_http_proxy', { name, host, port });
    expect(r['status']).toBe('created');
    expect(r['name']).toBe(name);
  });

  it('gets it back with the created host and port', async () => {
    const r = await callTool('get_http_proxy', { name });
    expect(r['name']).toBe(name);
    expect(r['host']).toBe(host);
    expect(r['port']).toBe(port);
    // Server-populated id is present on the response object.
    expect(r['_id']).toBeDefined();
  });

  it('appears in the list (filtered by name substring)', async () => {
    const r = await callTool('list_http_proxies', { name_contains: name });
    expect(r['kind']).toBe('http_proxy');
    const items = (r['items'] as Array<Record<string, unknown>>) ?? [];
    expect(items.some((p) => p['name'] === name)).toBe(true);
  });

  it('updates the host via collection-root PUT', async () => {
    const r = await callTool('update_http_proxy', { name, host: updatedHost });
    expect(r['status']).toBe('updated');
    expect(r['name']).toBe(name);

    const fetched = await callTool('get_http_proxy', { name });
    expect(fetched['host']).toBe(updatedHost);
    // port was preserved through the GET-strip-merge-PUT cycle.
    expect(fetched['port']).toBe(port);
  });

  it('deletes it (with expected_name safeguard)', async () => {
    const r = await callTool('delete_http_proxy', {
      name,
      expected_name: name,
    });
    expect(r['deleted']).toBe(true);
    expect(r['name']).toBe(name);
  });

  it('confirms deletion: get now errors (HTTP-PROXY-003 not found)', async () => {
    await expect(callTool('get_http_proxy', { name })).rejects.toThrow(
      ToolError,
    );
  });

  it('creates and round-trips a credentials-backed proxy (or reports a clean validation error)', async () => {
    // The optional `credentials` field must reference an existing `password`
    // credentials object with the PROXY target. If that dependency could not be
    // provisioned on this QA instance, Horizon rejects the create with a clean
    // HTTP-PROXY-002 (InvalidReferenceException) - which is a legitimate server
    // validation error, NOT a tool/client bug. We tolerate that case.
    const createArgs = {
      name: authProxyName,
      host: 'tinyproxy',
      port: 8888,
      credentials: credsName,
    };

    if (!credsCreated) {
      // Dependency unavailable: assert the server rejects cleanly.
      try {
        const r = await callTool('create_http_proxy', createArgs);
        // If the instance accepted it anyway, treat as success and verify.
        expect(r['status']).toBe('created');
      } catch (err) {
        expect(err).toBeInstanceOf(ToolError);
        // Clean Horizon validation error referencing the bad credentials ref.
        expect((err as ToolError).message).toMatch(
          /HTTP-PROXY-002|credential|reference|InvalidReference/i,
        );
      }
      return;
    }

    // Dependency present: full create -> get -> verify credentials round-trip.
    const created = await callTool('create_http_proxy', createArgs);
    expect(created['status']).toBe('created');
    expect(created['name']).toBe(authProxyName);

    const fetched = await callTool('get_http_proxy', { name: authProxyName });
    expect(fetched['name']).toBe(authProxyName);
    expect(fetched['host']).toBe('tinyproxy');
    expect(fetched['port']).toBe(8888);
    expect(fetched['credentials']).toBe(credsName);
  });
});
