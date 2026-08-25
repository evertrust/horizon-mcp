/**
 * Live-QA E2E for authentication with a Horizon JWKS service account.
 *
 * Required in .env.local:
 *   HORIZON_E2E_URL       - Base URL of the Horizon QA instance
 *   HORIZON_E2E_SVA       - Service-account name
 *   HORIZON_E2E_SVA_TOKEN - Service-account JWT
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ServiceAccountAuthProvider } from '../../src/auth/service-account.js';
import { HorizonClient } from '../../src/client/http.js';
import { registerSystemTools } from '../../src/tools/assist/system.js';
import { registerConfigTools } from '../../src/tools/config/index.js';
import { registerLifecycleTools } from '../../src/tools/lifecycle.js';

const E2E_URL = process.env['HORIZON_E2E_URL'] ?? '';
const E2E_SVA = process.env['HORIZON_E2E_SVA'] ?? '';
const E2E_SVA_TOKEN = process.env['HORIZON_E2E_SVA_TOKEN'] ?? '';
const E2E_SVA_CONFIGURED = Boolean(E2E_URL && E2E_SVA && E2E_SVA_TOKEN);

if (!E2E_SVA_CONFIGURED) {
  const missing = [
    ['HORIZON_E2E_URL', E2E_URL],
    ['HORIZON_E2E_SVA', E2E_SVA],
    ['HORIZON_E2E_SVA_TOKEN', E2E_SVA_TOKEN],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)
    .join(', ');
  console.warn(
    `SKIP: service-account E2E is not configured (${missing} unset). ` +
      'Please provision HORIZON_E2E_SVA and HORIZON_E2E_SVA_TOKEN in .env.local.',
  );
}

describe.skipIf(!E2E_SVA_CONFIGURED)(
  'service-account authentication E2E (live QA)',
  () => {
    let client: Client;
    let horizonClient: HorizonClient;

    beforeAll(async () => {
      const auth = new ServiceAccountAuthProvider(E2E_SVA, E2E_SVA_TOKEN);
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
        .update(E2E_SVA_TOKEN)
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

    it('lists service accounts when the management tool is present', async () => {
      const tools = await client.listTools();
      const hasListTool = tools.tools.some(
        (tool) => tool.name === 'list_service_accounts',
      );
      if (!hasListTool) {
        console.log(
          'SKIP: list_service_accounts is not registered on this branch',
        );
        return;
      }

      const result = await callTool('list_service_accounts');
      expect(result['kind']).toBe('service_account');
      expect(Array.isArray(result['items'])).toBe(true);
    });
  },
);
