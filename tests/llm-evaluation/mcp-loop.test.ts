import { describe, expect, it } from 'vitest';

import {
  SCENARIO_E2E_READY,
  callTool,
  readResource,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!SCENARIO_E2E_READY)(
  'Provider-agnostic grounded MCP flows',
  () => {
    setupE2EStack();

    it('search_docs then get_doc_page grounds ADCS connector setup', async () => {
      const search = await callTool('search_docs', {
        query: 'adcs connector initial configuration',
        product: 'adcs-connector',
        max_results: 3,
      });

      const results = search['results'] as Array<Record<string, unknown>>;
      expect(results[0]?.['page_id']).toBe(
        'adcs-connector:1.1:install-guide:initial-config',
      );

      const page = await callTool('get_doc_page', {
        page_id: results[0]?.['page_id'],
      });

      expect(page['url']).toBe(
        'https://docs.evertrust.fr/adcs-connector/1.1/install-guide/initial-config.html',
      );
      expect(page['content']).toContain('CertHash');
      expect(page['content']).toContain('4443');
      expect(page['content']).toContain('Issue and Manage Certificates');
    });

    it('search_api_docs then get_doc_page grounds the request retrieval endpoint', async () => {
      const search = await callTool('search_api_docs', {
        query: 'retrieve request by id',
        max_results: 3,
      });

      const results = search['results'] as Array<Record<string, unknown>>;
      expect(results[0]?.['path']).toBe('/api/v1/requests/{id}');
      expect(results[0]?.['method']).toBe('GET');

      const page = await callTool('get_doc_page', {
        page_id: results[0]?.['page_id'],
      });

      expect(page['content']).toContain('/api/v1/requests/{id}');
      expect(page['content']).toContain('GET');
      expect(page['content']).toContain('Request');
    });

    it('export_events_csv returns bounded output on live QA', async () => {
      const result = await callTool(
        'export_events_csv',
        { query: 'code matches ".*"' },
        { timeout: 120_000 },
      );

      expect(typeof result['csv']).toBe('string');
      expect(result['max_rows']).toBe(1000);
      expect(result['returned_rows'] as number).toBeLessThanOrEqual(1000);
      expect(result['csv']).toMatch(/\n/);
    }, 120_000);

    it('small-model recipe resources are grounded and readable at runtime', async () => {
      const toolSelection = await readResource(
        'horizon://knowledge/tool-selection',
      );
      const intuneRecipe = await readResource(
        'horizon://knowledge/intune-integration',
      );

      expect(toolSelection).toContain('search_docs');
      expect(toolSelection).toContain('get_request_template');
      expect(intuneRecipe).toContain('azureTenant');
      expect(intuneRecipe).toContain('intunepkcs');
    });
  },
);
