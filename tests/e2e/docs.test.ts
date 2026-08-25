import { describe, expect, it } from 'vitest';

import {
  getAvailableVersions,
  getLatestIndexedVersion,
} from '../../src/docs/catalog.js';
import {
  E2E_CONFIGURED,
  callTool,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

function normalizeVersion(version: string): string {
  const match = version.match(/^(\d+\.\d+)/);
  return match ? match[1] : version;
}

/**
 * Map a raw instance version (e.g. "2.10.0.d6e3bc0e") to the doc version the
 * search_api_docs tool will actually resolve. This mirrors the tool's
 * bestMatchingIndexedVersion logic: an exact (or normalized) indexed match wins,
 * otherwise it falls back to the latest indexed line. When the live instance is
 * a pre-release whose docs are not yet published/indexed (e.g. 2.10 while only
 * <=2.9 is indexed), the tool correctly serves the latest indexed line.
 */
function toIndexedHorizonApiVersion(rawVersion: string): string {
  const available = getAvailableVersions('horizon-api');
  if (available.includes(rawVersion)) return rawVersion;
  const normalized = normalizeVersion(rawVersion);
  const exact = available.find((v) => normalizeVersion(v) === normalized);
  if (exact) return exact;
  return getLatestIndexedVersion('horizon-api') ?? '2.9';
}

async function resolveExpectedHorizonVersion(): Promise<{
  version: string;
  source: 'license_info' | 'whoami' | 'latest_indexed_fallback';
}> {
  const client = getHorizonClient();

  try {
    const license =
      await client.get<Record<string, unknown>>('/api/v1/licenses');
    const version = license['version'];
    if (typeof version === 'string' && version.length > 0) {
      return {
        version: toIndexedHorizonApiVersion(version),
        source: 'license_info',
      };
    }
  } catch {
    // Fall through to the lower-privilege path.
  }

  try {
    const principal = await client.get<Record<string, unknown>>(
      '/api/v1/security/principals/self',
    );
    const version = principal['_horizonVersion'];
    if (typeof version === 'string' && version.length > 0) {
      return {
        version: toIndexedHorizonApiVersion(version),
        source: 'whoami',
      };
    }
  } catch {
    // Fall through to the indexed fallback.
  }

  return {
    version: getLatestIndexedVersion('horizon-api') ?? '2.9',
    source: 'latest_indexed_fallback',
  };
}

describe.skipIf(!E2E_CONFIGURED)('Documentation tools E2E', () => {
  setupE2EStack();

  it('search_api_docs resolves the current Horizon line and finds request retrieval', async () => {
    const expected = await resolveExpectedHorizonVersion();

    const result = await callTool('search_api_docs', {
      query: 'retrieve request by id',
      max_results: 3,
    });

    expect(result['resolved_version']).toBe(expected.version);
    expect(result['resolution_source']).toBe(expected.source);

    const results = result['results'] as Array<Record<string, unknown>>;
    expect(results[0]?.['page_id']).toBe(
      `horizon-api:${expected.version}:api-ref:request_get`,
    );
    expect(results[0]?.['path']).toBe('/api/v1/requests/{id}');
    expect(results[0]?.['method']).toBe('GET');
  });

  it('search_docs finds the ADCS Connector initial configuration page', async () => {
    const result = await callTool('search_docs', {
      query: 'adcs connector initial configuration',
      product: 'adcs-connector',
      max_results: 3,
    });

    expect(result['resolved_product_version']).toBe('1.1');
    const results = result['results'] as Array<Record<string, unknown>>;
    expect(results[0]?.['page_id']).toBe(
      'adcs-connector:1.1:install-guide:initial-config',
    );
  });

  it('search_docs finds the WinHorizon Active Directory configuration page', async () => {
    const result = await callTool('search_docs', {
      query: 'winhorizon ad configuration',
      product: 'winhorizon',
      max_results: 3,
    });

    // winhorizon is a latest-indexed product; derive the version from the
    // catalog so the assertion survives documentation refreshes.
    const winhorizonVersion = getLatestIndexedVersion('winhorizon') ?? '2.1';
    expect(result['resolved_product_version']).toBe(winhorizonVersion);
    const results = result['results'] as Array<Record<string, unknown>>;
    expect(results[0]?.['page_id']).toBe(
      `winhorizon:${winhorizonVersion}:admin-guide:ad_config`,
    );
  });

  it('search_docs returns the Horizon Ansible overview for collection setup queries', async () => {
    const result = await callTool('search_docs', {
      query: 'ansible install collection',
      product: 'horizon-ansible',
      max_results: 3,
    });

    // horizon-ansible is a latest-indexed product; derive the version from the
    // catalog so the assertion survives documentation refreshes.
    const ansibleVersion =
      getLatestIndexedVersion('horizon-ansible') ?? '2.0.0';
    expect(result['resolved_product_version']).toBe(ansibleVersion);
    const results = result['results'] as Array<Record<string, unknown>>;
    expect(results[0]?.['page_id']).toBe(
      `horizon-ansible:${ansibleVersion}:index`,
    );
  });

  it('search_docs and get_doc_page expose cleaned Terraform provider content', async () => {
    const search = await callTool('search_docs', {
      query: 'terraform provider certificate resource',
      product: 'terraform-provider-horizon',
      max_results: 3,
    });

    // terraform-provider-horizon is not a Horizon-versioned product, so the tool
    // resolves to the latest indexed provider release (from the doc catalog).
    const tfVersion =
      getLatestIndexedVersion('terraform-provider-horizon') ?? '0.6.0';
    const tfCertPageId = `terraform-provider-horizon:${tfVersion}:certificate`;

    expect(search['resolved_product_version']).toBe(tfVersion);
    const results = search['results'] as Array<Record<string, unknown>>;
    expect(results[0]?.['page_id']).toBe(tfCertPageId);

    const page = await callTool('get_doc_page', {
      page_id: tfCertPageId,
    });

    expect(page['title']).toBe('horizon_certificate Resource');
    expect(page['content']).toMatch(/resource/i);
    expect(page['content']).not.toMatch(/^---/);
    expect(page['content']).not.toMatch(/^# generated by /i);
  });
});
