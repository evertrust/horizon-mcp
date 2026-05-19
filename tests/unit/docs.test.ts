import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { HorizonError } from '../../src/client/errors.js';
import { getLatestIndexedVersion } from '../../src/docs/catalog.js';
import { resolveDocVersion } from '../../src/docs/versioning.js';
import { registerDocsTools } from '../../src/tools/docs.js';

type MockDocsClient = {
  get(path: string): Promise<Record<string, unknown>>;
  horizonVersion?: string;
};

function createMockClient(options?: {
  licenseVersion?: string;
  licenseError?: HorizonError;
  whoamiVersion?: string;
  horizonVersion?: string;
}): MockDocsClient {
  return {
    horizonVersion: options?.horizonVersion,
    async get(path: string): Promise<Record<string, unknown>> {
      if (path === '/api/v1/licenses') {
        if (options?.licenseError) {
          throw options.licenseError;
        }
        return options?.licenseVersion
          ? { version: options.licenseVersion }
          : {};
      }

      if (path === '/api/v1/security/principals/self') {
        return options?.whoamiVersion
          ? { _horizonVersion: options.whoamiVersion }
          : {};
      }

      throw new Error(`Unexpected GET ${path}`);
    },
  };
}

async function createDocsToolClient(
  mockClient: MockDocsClient,
): Promise<Client> {
  const server = new McpServer({ name: 'docs-test', version: '0.0.0' });
  registerDocsTools(
    server,
    mockClient as Parameters<typeof registerDocsTools>[1],
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'docs-test-client', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

async function callJsonTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>).find(
    (item) => item.type === 'text',
  )?.text;
  if (!text) {
    throw new Error(`Tool ${name} returned no text payload`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe('Documentation version resolution', () => {
  it('normalizes the live Horizon version from license info', async () => {
    const resolved = await resolveDocVersion({
      client: createMockClient({
        licenseVersion: '2.8.6.902fc97f',
      }) as Parameters<typeof resolveDocVersion>[0]['client'],
      product: 'horizon-api',
    });

    expect(resolved.version).toBe('2.8');
    expect(resolved.resolution_source).toBe('license_info');
    expect(resolved.confidence).toBe('official');
    expect(resolved.warning).toContain("instance version '2.8.6.902fc97f'");
  });

  it('falls back to an undocumented whoami version when licenses are forbidden', async () => {
    const resolved = await resolveDocVersion({
      client: createMockClient({
        licenseError: new HorizonError(403, { message: 'forbidden' }),
        whoamiVersion: '2.8.6.902fc97f',
      }) as Parameters<typeof resolveDocVersion>[0]['client'],
      product: 'horizon',
    });

    expect(resolved.version).toBe('2.8');
    expect(resolved.resolution_source).toBe('whoami');
    expect(resolved.confidence).toBe('undocumented');
    expect(resolved.warning).toContain('undocumented _horizonVersion field');
  });

  it('falls back to the latest indexed Horizon docs when no version signal is available', async () => {
    const resolved = await resolveDocVersion({
      client: createMockClient({
        licenseError: new HorizonError(403, { message: 'forbidden' }),
      }) as Parameters<typeof resolveDocVersion>[0]['client'],
      product: 'horizon',
    });

    expect(resolved.version).toBe(getLatestIndexedVersion('horizon'));
    expect(resolved.resolution_source).toBe('latest_indexed_fallback');
    expect(resolved.confidence).toBe('fallback');
    expect(resolved.fallback).toBe(true);
    expect(resolved.warning).toContain('cannot read `/api/v1/licenses`');
  });

  it('warns when an explicit non-indexed version is requested', async () => {
    const resolved = await resolveDocVersion({
      client: createMockClient() as Parameters<
        typeof resolveDocVersion
      >[0]['client'],
      product: 'horizon-cli',
      requestedVersion: '9.9',
    });

    expect(resolved.version).toBe(getLatestIndexedVersion('horizon-cli'));
    expect(resolved.resolution_source).toBe('explicit');
    expect(resolved.confidence).toBe('explicit');
    expect(resolved.fallback).toBe(true);
    expect(resolved.warning).toContain(
      "Requested version '9.9' is not indexed",
    );
  });
});

describe('Documentation tools', () => {
  it('search_api_docs returns the exact request retrieval page for the live Horizon line', async () => {
    const client = await createDocsToolClient(
      createMockClient({ licenseVersion: '2.8.6.902fc97f' }),
    );

    const result = await callJsonTool(client, 'search_api_docs', {
      query: 'retrieve request by id',
      max_results: 3,
    });

    expect(result['resolved_version']).toBe('2.8');
    expect(result['resolution_source']).toBe('license_info');
    expect(result['version_confidence']).toBe('official');

    const results = result['results'] as Array<Record<string, unknown>>;
    expect(results[0]?.['page_id']).toBe('horizon-api:2.8:api-ref:request_get');
    expect(results[0]?.['path']).toBe('/api/v1/requests/{id}');
    expect(results[0]?.['method']).toBe('GET');
  });

  it('search_docs ranks the WinHorizon Active Directory page first', async () => {
    const client = await createDocsToolClient(createMockClient());

    const result = await callJsonTool(client, 'search_docs', {
      query: 'winhorizon ad configuration',
      product: 'winhorizon',
      max_results: 3,
    });

    const results = result['results'] as Array<Record<string, unknown>>;
    expect(results[0]?.['page_id']).toBe(
      'winhorizon:2.0:admin-guide:ad_config',
    );
  });

  it('search_docs returns the overview page for Horizon Ansible collection setup queries', async () => {
    const client = await createDocsToolClient(createMockClient());

    const result = await callJsonTool(client, 'search_docs', {
      query: 'ansible install collection',
      product: 'horizon-ansible',
      max_results: 3,
    });

    const results = result['results'] as Array<Record<string, unknown>>;
    expect(results[0]?.['page_id']).toBe('horizon-ansible:1.5.1:index');
    expect(result['hint']).toBe(
      'Call get_doc_page with one of the returned page_id values.',
    );
  });

  it('get_doc_page returns cleaned Terraform content', async () => {
    const client = await createDocsToolClient(createMockClient());
    const terraformVersion = getLatestIndexedVersion(
      'terraform-provider-horizon',
    );

    const result = await callJsonTool(client, 'get_doc_page', {
      page_id: `terraform-provider-horizon:${terraformVersion}:certificate`,
    });

    expect(result['title']).toBe('horizon_certificate Resource');
    expect(result['content']).not.toMatch(/^---/);
    expect(result['content']).not.toMatch(/^# generated by /i);
  });

  it('get_doc_page includes HTTP metadata in API page content', async () => {
    const client = await createDocsToolClient(createMockClient());

    const result = await callJsonTool(client, 'get_doc_page', {
      page_id: 'horizon-api:2.8:api-ref:request_get',
    });

    expect(result['content']).toContain('GET /api/v1/requests/{id}');
    expect(result['content']).toContain('Retrieve a request');
  });
});
