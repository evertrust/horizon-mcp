/**
 * Live-QA E2E for authentication with a Horizon JWKS service account.
 *
 * Required in .env.local:
 *   HORIZON_E2E_URL       - Base URL of the Horizon QA instance
 *   HORIZON_E2E_SVA       - Service-account name
 * plus either a ready-made token:
 *   HORIZON_E2E_SVA_TOKEN - Service-account JWT
 * or the OAuth client-credentials tuple of the Entra ID app registration the
 * account trusts (the token is then minted at suite start and the renewal
 * path is exercised against the real issuer):
 *   HORIZON_E2E_OAUTH_TENANT        - Directory (tenant) id
 *   HORIZON_E2E_OAUTH_CLIENT_ID     - Application (client) id
 *   HORIZON_E2E_OAUTH_CLIENT_SECRET - Client secret
 *   HORIZON_E2E_OAUTH_SCOPE         - Optional, default <client id>/.default
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ServiceAccountAuthProvider } from '../../src/auth/service-account.js';
import { HorizonClient } from '../../src/client/http.js';
import type { OAuthIssuerMap } from '../../src/settings.js';
import { registerSystemTools } from '../../src/tools/assist/system.js';
import { registerConfigTools } from '../../src/tools/config/index.js';
import { registerLifecycleTools } from '../../src/tools/lifecycle.js';

const E2E_URL = process.env['HORIZON_E2E_URL'] ?? '';
const E2E_SVA = process.env['HORIZON_E2E_SVA'] ?? '';
const E2E_SVA_TOKEN = process.env['HORIZON_E2E_SVA_TOKEN'] ?? '';
const OAUTH_TENANT = process.env['HORIZON_E2E_OAUTH_TENANT'] ?? '';
const OAUTH_CLIENT_ID = process.env['HORIZON_E2E_OAUTH_CLIENT_ID'] ?? '';
const OAUTH_CLIENT_SECRET =
  process.env['HORIZON_E2E_OAUTH_CLIENT_SECRET'] ?? '';
// The GUID form of the app's own resource works without an Application ID URI.
const OAUTH_SCOPE =
  process.env['HORIZON_E2E_OAUTH_SCOPE'] ||
  (OAUTH_CLIENT_ID ? `${OAUTH_CLIENT_ID}/.default` : '');

const OAUTH_CONFIGURED = Boolean(
  OAUTH_TENANT && OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET,
);
const E2E_SVA_CONFIGURED = Boolean(
  E2E_URL && E2E_SVA && (E2E_SVA_TOKEN || OAUTH_CONFIGURED),
);

const ENTRA_TOKEN_URL = `https://login.microsoftonline.com/${OAUTH_TENANT}/oauth2/v2.0/token`;

if (!E2E_SVA_CONFIGURED) {
  const missing = [
    ['HORIZON_E2E_URL', E2E_URL],
    ['HORIZON_E2E_SVA', E2E_SVA],
    ['HORIZON_E2E_SVA_TOKEN or the HORIZON_E2E_OAUTH_* tuple', E2E_SVA_TOKEN],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)
    .join(', ');
  console.warn(
    `SKIP: service-account E2E is not configured (${missing} unset). ` +
      'Provision HORIZON_E2E_SVA plus either HORIZON_E2E_SVA_TOKEN or the ' +
      'HORIZON_E2E_OAUTH_* tuple in .env.local.',
  );
}

function decodeClaims(jwt: string): Record<string, unknown> {
  const payload = jwt.split('.')[1] ?? '';
  return JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

/** Mint an access token with the client-credentials grant (client_secret_post). */
async function mintEntraToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    scope: OAUTH_SCOPE,
  });
  const response = await fetch(ENTRA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(
      `Entra token request failed (${response.status}): ${json.error ?? ''} ${json.error_description ?? ''}`.trim(),
    );
  }
  return json.access_token;
}

describe.skipIf(!E2E_SVA_CONFIGURED)(
  'service-account authentication E2E (live QA)',
  () => {
    let client: Client;
    let horizonClient: HorizonClient;
    let svaToken = E2E_SVA_TOKEN;

    beforeAll(async () => {
      if (!svaToken) svaToken = await mintEntraToken();

      const auth = new ServiceAccountAuthProvider(E2E_SVA, svaToken);
      horizonClient = new HorizonClient(E2E_URL, auth, {
        timeout: 30,
        exportTimeout: 120,
        verifySsl: false,
      });

      const server = new McpServer({
        name: 'service-account-e2e',
        version: '0.0.0',
      });
      registerSystemTools(server, horizonClient);
      registerLifecycleTools(server, horizonClient);
      registerConfigTools(server, horizonClient);

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      client = new Client({
        name: 'service-account-e2e-client',
        version: '0.0.0',
      });
      await Promise.all([
        client.connect(clientTransport),
        server.connect(serverTransport),
      ]);
      // Real hosts list tools before calling them, which arms the SDK client's structuredContent validation against each tool's output schema.
      await client.listTools();
    });

    afterAll(async () => {
      await client?.close();
      await horizonClient?.close();
    });

    async function callTool(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find((item) => item.type === 'text')?.text;
      if (result.isError || !text) {
        throw new Error(text ?? `Tool '${name}' returned no text content`);
      }
      return JSON.parse(text) as Record<string, unknown>;
    }

    it('whoami returns the token-derived service-account identifier', async () => {
      const me = await callTool('whoami');
      const identity = (me['identity'] ?? me) as Record<string, unknown>;
      const identifier = String(identity['identifier'] ?? me['identifier']);
      const hash16 = createHash('sha256')
        .update(svaToken)
        .digest('hex')
        .slice(0, 16);
      const expectedBase = `${E2E_SVA}-${hash16}`;

      expect(
        identifier === expectedBase ||
          identifier.startsWith(`${expectedBase}-`),
      ).toBe(true);
    });

    it('searches certificates with the service-account identity', async () => {
      const result = await callTool('search_certificates', {
        query: 'profile exists',
        page_size: 1,
      });

      expect(Array.isArray(result['results'])).toBe(true);
    });

    it('lists service accounts through the management tool', async () => {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain(
        'list_service_accounts',
      );

      const result = await callTool('list_service_accounts');
      expect(result['kind']).toBe('service_account');
      expect(Array.isArray(result['items'])).toBe(true);
    });

    it.skipIf(!OAUTH_CONFIGURED)(
      'renews the token against the pinned issuer and Horizon accepts the renewed token',
      async () => {
        // Pin whichever issuer the app registration emits (v1 tokens carry
        // sts.windows.net, v2 tokens login.microsoftonline.com/<tenant>/v2.0).
        const issuer = String(decodeClaims(svaToken)['iss']);
        const pinnedIssuers: OAuthIssuerMap = {
          [issuer]: {
            tokenUrl: ENTRA_TOKEN_URL,
            authMethod: 'client_secret_post',
          },
        };
        const auth = new ServiceAccountAuthProvider(E2E_SVA, svaToken, {
          clientId: OAUTH_CLIENT_ID,
          clientSecret: OAUTH_CLIENT_SECRET,
          scope: OAUTH_SCOPE,
          issuers: pinnedIssuers,
        });
        const renewingClient = new HorizonClient(E2E_URL, auth, {
          timeout: 30,
          exportTimeout: 120,
          verifySsl: false,
        });
        try {
          // Pinned mode may renew before Horizon validated the presented token.
          await auth.markAuthFailed();
          await auth.refreshIfNeeded();
          const renewed = (await auth.getHeaders())['X-API-TOKEN'] ?? '';
          const claims = decodeClaims(renewed);
          expect(claims['iss']).toBe(issuer);
          expect(claims['azp'] ?? claims['appid']).toBe(OAUTH_CLIENT_ID);

          // Horizon must accept the renewed token as this service account.
          const me = await renewingClient.get<Record<string, unknown>>(
            '/api/v1/security/principals/self',
          );
          expect(Array.isArray(me['roles'])).toBe(true);
        } finally {
          await renewingClient.close();
        }
      },
    );

    it.skipIf(!OAUTH_CONFIGURED)(
      'mints the first token from one pinned issuer and Horizon accepts it',
      async () => {
        const issuer = String(decodeClaims(svaToken)['iss']);
        const auth = new ServiceAccountAuthProvider(E2E_SVA, '', {
          clientId: OAUTH_CLIENT_ID,
          clientSecret: OAUTH_CLIENT_SECRET,
          scope: OAUTH_SCOPE,
          issuers: {
            [issuer]: {
              tokenUrl: ENTRA_TOKEN_URL,
              authMethod: 'client_secret_post',
            },
          },
        });
        const mintingClient = new HorizonClient(E2E_URL, auth, {
          timeout: 30,
          exportTimeout: 120,
          verifySsl: false,
        });
        try {
          await auth.refreshIfNeeded();
          expect(auth.needsInitialToken()).toBe(false);

          const me = await mintingClient.get<Record<string, unknown>>(
            '/api/v1/security/principals/self',
          );
          expect(Array.isArray(me['roles'])).toBe(true);
        } finally {
          await mintingClient.close();
        }
      },
    );
  },
);
