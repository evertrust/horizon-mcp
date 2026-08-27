import { describe, expect, it } from 'vitest';

import { E2E_CONFIGURED, callTool, setupE2EStack } from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('Horizon E2E', () => {
  setupE2EStack();

  describe('reports', () => {
    it('list_reports returns a valid list envelope', async () => {
      const result = await callTool('list_reports');
      expect(
        result['items'],
        "list_reports response missing 'items' key",
      ).toBeDefined();
      expect(Array.isArray(result['items'])).toBe(true);
      expect(result['count']).toBeDefined();
      expect(result['total_available']).toBeDefined();
      expect(result['truncated']).toBeDefined();
      expect(result['kind']).toBe('report');
      expect(result['count']).toBe((result['items'] as unknown[]).length);
    });

    it('list_reports with expired flag does not error', async () => {
      const result = await callTool('list_reports', { expired: true });
      expect(result['items']).toBeDefined();
      expect(Array.isArray(result['items'])).toBe(true);
    });

    it('list_reports by non-existent name returns empty', async () => {
      const result = await callTool('list_reports', {
        report_name: 'zzznomatch-e2e-report',
      });
      // When no report matches the name the server may return [] or a 404-style empty
      expect('items' in result || Object.keys(result).length === 0).toBe(true);
    });

    it('download_report returns CSV content when reports exist', async () => {
      const reports = await callTool('list_reports');
      const items = (reports['items'] ?? []) as Record<string, unknown>[];
      if (items.length === 0) {
        console.log('SKIP: No reports available on this instance');
        return;
      }

      let reportUuid: string | undefined;
      for (const item of items) {
        reportUuid = (item['uuid'] ?? item['id'] ?? item['_id']) as
          | string
          | undefined;
        if (reportUuid) break;
      }
      if (!reportUuid) {
        console.log('SKIP: No report UUID found in list_reports items');
        return;
      }

      const result = await callTool('download_report', {
        report_uuid: reportUuid,
      });
      expect(
        result['csv'],
        "download_report response missing 'csv' key",
      ).toBeDefined();
      expect(
        result['rows'],
        "download_report response missing 'rows' key",
      ).toBeDefined();
      expect(result['content']).toBeDefined();
      expect(typeof result['rows']).toBe('number');
      expect(result['rows'] as number).toBeGreaterThanOrEqual(0);
    });
  });
});
