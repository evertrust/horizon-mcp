import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { registerComputationTools } from '../../src/tools/assist/computation.js';
import { registerSystemTools } from '../../src/tools/assist/system.js';

function createMockClient() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(null),
    getBytes: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    getText: vi.fn().mockResolvedValue(''),
    postText: vi.fn().mockResolvedValue(''),
    postMultipart: vi.fn().mockResolvedValue({}),
    request: vi.fn().mockResolvedValue(new Response()),
    close: vi.fn().mockResolvedValue(undefined),
    fetchCsrfToken: vi.fn().mockResolvedValue(undefined),
    exportTimeout: 120,
    principalName: undefined,
    horizonVersion: undefined,
  };
}

type MockClient = ReturnType<typeof createMockClient>;

function parseToolResult(result: unknown): Record<string, unknown> {
  const r = result as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

function resetMocks(mc: MockClient): void {
  mc.get.mockReset().mockResolvedValue({});
  mc.post.mockReset().mockResolvedValue({});
  mc.put.mockReset().mockResolvedValue({});
  mc.patch.mockReset().mockResolvedValue({});
  mc.delete.mockReset().mockResolvedValue(null);
  mc.getBytes.mockReset().mockResolvedValue(new ArrayBuffer(0));
  mc.getText.mockReset().mockResolvedValue('');
  mc.postText.mockReset().mockResolvedValue('');
  mc.postMultipart.mockReset().mockResolvedValue({});
  mc.request.mockReset().mockResolvedValue(new Response());
}

async function setupServer(
  registerFn: (server: McpServer, client: MockClient) => void,
): Promise<{ client: Client; mockClient: MockClient }> {
  const server = new McpServer({ name: 'route-regressions', version: '0.0.0' });
  const mockClient = createMockClient();
  registerFn(server, mockClient);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: 'route-regressions-client',
    version: '0.0.0',
  });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, mockClient };
}

describe('System assist route regressions', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServer((server, mc) => {
      registerSystemTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  it('get_license_info uses the licenses endpoint', async () => {
    mockClient.get.mockResolvedValueOnce({ expiresAt: '2026-12-31T00:00:00Z' });

    const result = await client.callTool({
      name: 'get_license_info',
      arguments: {},
    });
    const parsed = parseToolResult(result);

    expect(mockClient.get).toHaveBeenCalledWith('/api/v1/licenses');
    expect(parsed['expiresAt']).toBe('2026-12-31T00:00:00Z');
  });

  it('explain_grading_policy uses source-truth paths and multipart explain', async () => {
    mockClient.get.mockResolvedValueOnce({ name: 'tls-policy' });
    mockClient.postMultipart.mockResolvedValueOnce({ grade: 'A' });

    const result = await client.callTool({
      name: 'explain_grading_policy',
      arguments: {
        policy_name: 'tls-policy',
        certificate_pem:
          '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.get).toHaveBeenCalledWith(
      '/api/v1/certificate/grading/policies/tls-policy',
    );
    expect(mockClient.postMultipart).toHaveBeenCalledWith(
      '/api/v1/certificate/grading/policies/tls-policy/explain',
      [
        {
          fieldName: 'x509',
          filename: 'certificate.pem',
          mimeType: 'application/x-pem-file',
          data: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
        },
      ],
    );
    expect(parsed['policy']).toEqual({ name: 'tls-policy' });
    expect(parsed['explanation']).toEqual({ grade: 'A' });
    expect(parsed['evaluation']).toEqual({ grade: 'A' });
  });

  it('explain_grading_ruleset uses source-truth paths and multipart explain', async () => {
    mockClient.get.mockResolvedValueOnce({ name: 'tls-ruleset' });
    mockClient.postMultipart.mockResolvedValueOnce({ passed: true });

    const result = await client.callTool({
      name: 'explain_grading_ruleset',
      arguments: {
        ruleset_name: 'tls-ruleset',
        certificate_pem:
          '-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----',
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.get).toHaveBeenCalledWith(
      '/api/v1/certificate/grading/rulesets/tls-ruleset',
    );
    expect(mockClient.postMultipart).toHaveBeenCalledWith(
      '/api/v1/certificate/grading/rulesets/tls-ruleset/explain',
      [
        {
          fieldName: 'x509',
          filename: 'certificate.pem',
          mimeType: 'application/x-pem-file',
          data: '-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----',
        },
      ],
    );
    expect(parsed['ruleset']).toEqual({ name: 'tls-ruleset' });
    expect(parsed['explanation']).toEqual({ passed: true });
    expect(parsed['evaluation']).toEqual({ passed: true });
  });

  it('documents rotation-variant service-account identifiers without changing the whoami schema', async () => {
    const tools = (await client.listTools()).tools;
    const whoami = tools.find((tool) => tool.name === 'whoami');

    expect(whoami?.description).toContain('<name>-<sha256(jwt).take(16)>');
    expect(whoami?.description).toContain('<name>-<hash16>-<mapped-value>');
    expect(whoami?.description).toContain(
      'identifierMapping adds claim-derived context and does not create a stable identity',
    );
    expect(whoami?.description).toContain('team-based ownership');
    expect(Object.keys(whoami?.outputSchema?.properties ?? {}).sort()).toEqual([
      '_horizonVersion',
      'identifier',
      'name',
      'permissions',
      'roles',
      'team',
      'teams',
    ]);
  });
});

describe('Computation assist route regressions', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServer((server, mc) => {
      registerComputationTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  it('simulate_datasource_flow translates MCP input to Horizon dsFlow payloads', async () => {
    mockClient.post.mockResolvedValueOnce([{ status: 'success' }]);

    const result = await client.callTool({
      name: 'simulate_datasource_flow',
      arguments: {
        flow: [
          {
            datasource: 'corp-ldap',
            inputs: {
              uid: '{{principal.identifier}}',
              mail: '{{principal.mail}}',
            },
            stopOnSuccess: true,
          },
        ],
        context: {
          principal_identifier: 'alice',
          retry_count: 2,
        },
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.post).toHaveBeenCalledWith('/api/v1/datasource/flows', {
      dsFlow: [
        {
          ds: 'corp-ldap',
          inputs: [
            { key: 'mail', value: '{{principal.mail}}' },
            { key: 'uid', value: '{{principal.identifier}}' },
          ],
          stopOnSuccess: true,
        },
      ],
      context: [
        { key: 'principal_identifier', value: 'alice' },
        { key: 'retry_count', value: '2' },
      ],
    });
    expect(parsed).toEqual([{ status: 'success' }]);
  });

  it('simulate_datasource_flow omits empty optional arrays when possible', async () => {
    mockClient.post.mockResolvedValueOnce([]);

    await client.callTool({
      name: 'simulate_datasource_flow',
      arguments: {
        flow: [{ datasource: 'cmdb', inputs: {}, stopOnSuccess: false }],
      },
    });

    expect(mockClient.post).toHaveBeenCalledWith('/api/v1/datasource/flows', {
      dsFlow: [{ ds: 'cmdb', inputs: undefined, stopOnSuccess: false }],
    });
  });
});
