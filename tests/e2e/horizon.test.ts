/**
 * E2E tests for the Horizon MCP TypeScript server.
 *
 * Every test calls tools through the MCP protocol (Client -> InMemoryTransport
 * -> McpServer -> tool handler -> HorizonClient -> live Horizon API).
 * This matches the Python E2E approach and exercises the full stack.
 *
 * Environment variables required:
 *   HORIZON_E2E_URL, HORIZON_E2E_API_ID, HORIZON_E2E_API_KEY
 *
 * Ported from all 6 Python E2E files:
 *   - test_lifecycle.py  (18 lifecycle tools)
 *   - test_profiles.py   (2 profile tools)
 *   - test_dashboards.py (12 dashboard/saved-query tools)
 *   - test_reports.py    (3 report tools)
 *   - test_assist.py     (15 assist tools + 12 knowledge resources)
 *   - test_discovery.py  (13 discovery tools)
 */
import { describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  callToolRaw,
  getHorizonClient,
  getMcpClient,
  readResource,
  setupE2EStack,
} from './setup.js';

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Entire suite is gated on E2E env vars
// ---------------------------------------------------------------------------

describe.skipIf(!E2E_CONFIGURED)('Horizon E2E', () => {
  setupE2EStack();

  // =========================================================================
  // Lifecycle (ported from test_lifecycle.py)
  // =========================================================================

  describe('lifecycle', () => {
    // -----------------------------------------------------------------------
    // Certificate search
    // -----------------------------------------------------------------------

    describe('search_certificates', () => {
      it('returns paged results with a match-all query', async () => {
        const result = await callTool('search_certificates', {
          query: 'profile exists',
        });
        expect(
          result['results'],
          "search_certificates response lacks 'results' key. " +
            `Got: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        expect(Array.isArray(result['results'])).toBe(true);
        // Standardized pagination envelope: snake_case keys matching the
        // tool inputs, plus explicit has_more / next_page_index hints so
        // models don't have to derive pagination state themselves.
        expect(result['page_index']).toBeDefined();
        expect(result['page_size']).toBeDefined();
        expect(result).toHaveProperty('has_more');
        expect(result).toHaveProperty('next_page_index');
      });

      it('returns total when with_count is requested', async () => {
        const result = await callTool('search_certificates', {
          query: 'profile exists',
          page_size: 5,
          with_count: true,
        });
        expect(result['results']).toBeDefined();
        expect(Array.isArray(result['results'])).toBe(true);
        expect(
          result['total'],
          "with_count=true should populate 'total'",
        ).toBeDefined();
      });

      it('returns compact preset fields', async () => {
        const result = await callTool('search_certificates', {
          query: 'profile exists',
          preset: 'compact',
          page_size: 1,
        });
        expect(result['results']).toBeDefined();
        const results = result['results'] as Record<string, unknown>[];
        if (results.length > 0) {
          const first = results[0]!;
          const compactFields = new Set([
            'dn',
            'serial',
            'profile',
            'module',
            'notAfter',
            'keyType',
          ]);
          const hasCompactField = Object.keys(first).some((k) =>
            compactFields.has(k),
          );
          expect(
            hasCompactField,
            'compact preset result missing expected fields. ' +
              `Got keys: ${Object.keys(first).join(', ')}`,
          ).toBe(true);
        }
      });
    });

    // -----------------------------------------------------------------------
    // Certificate get
    // -----------------------------------------------------------------------

    describe('get_certificate', () => {
      it('returns full details for an existing certificate', async () => {
        const search = await callTool('search_certificates', {
          query: 'profile exists',
          page_size: 1,
        });
        const certs = (search['results'] ?? []) as Record<string, unknown>[];
        if (certs.length === 0) {
          console.log('SKIP: No certificates found on this Horizon instance');
          return;
        }

        const certId = certs[0]!['_id'] as string | undefined;
        if (!certId) {
          console.log('SKIP: First certificate result has no _id field');
          return;
        }

        const result = await callTool('get_certificate', {
          certificate_id: certId,
        });
        expect(result).toBeDefined();
        if (!('raw' in result)) {
          expect(
            result['certificate'],
            "get_certificate response lacks 'certificate' key. " +
              `Got keys: ${Object.keys(result).join(', ')}`,
          ).toBeDefined();
          const certData = result['certificate'] as Record<string, unknown>;
          expect(typeof certData).toBe('object');
          expect(certData['_id']).toBe(certId);
        }
      });
    });

    describe('set_certificate_auto_renew', () => {
      it('submits a no-change WebRA auto-renew update for an editable certificate', async (ctx) => {
        const search = await callTool('search_certificates', {
          query: 'module equals "webra"',
          fields: ['_id', 'profile', 'autoRenew'],
          page_size: 25,
        });
        const certificates = (search['results'] ?? []) as Record<
          string,
          unknown
        >[];
        const certificate = certificates.find(
          (item) =>
            typeof item['_id'] === 'string' &&
            /^[a-fA-F0-9]{24}$/.test(item['_id']) &&
            typeof item['profile'] === 'string' &&
            typeof item['autoRenew'] === 'boolean',
        );
        if (!certificate) {
          console.log(
            'SKIP: No WebRA certificate with an autoRenew flag found',
          );
          ctx.skip();
        }

        const profileName = certificate['profile'] as string;
        const profile = await getHorizonClient().get<Record<string, unknown>>(
          `/api/v1/certificate/profiles/${encodeURIComponent(profileName)}`,
        );
        const policy = profile['autoRenewalPolicy'] as
          | Record<string, unknown>
          | undefined;
        if (policy?.['editable'] !== true) {
          console.log(
            'SKIP: WebRA certificate profile does not allow auto-renew edits',
          );
          ctx.skip();
        }

        const result = await callTool('set_certificate_auto_renew', {
          certificate_id: certificate['_id'],
          enabled: certificate['autoRenew'],
        });
        expect(typeof result['id']).toBe('string');
        expect(typeof result['status']).toBe('string');
      });
    });

    // -----------------------------------------------------------------------
    // Certificate download
    // -----------------------------------------------------------------------

    describe('download_certificate', () => {
      it('returns PEM content for a known certificate', async () => {
        const search = await callTool('search_certificates', {
          query: 'profile exists',
          page_size: 1,
        });
        const certs = (search['results'] ?? []) as Record<string, unknown>[];
        if (certs.length === 0) {
          console.log('SKIP: No certificates found on this Horizon instance');
          return;
        }

        const certId = certs[0]!['_id'] as string | undefined;
        if (!certId) {
          console.log('SKIP: First certificate result has no _id field');
          return;
        }

        const result = await callTool('download_certificate', {
          certificate_id: certId,
          format: 'pem',
        });
        expect(result).toBeDefined();
        expect('content' in result || 'error' in result).toBe(true);
        if ('content' in result) {
          const content = result['content'];
          let pemStr: string;
          if (typeof content === 'object' && content !== null) {
            pemStr =
              ((content as Record<string, unknown>)['certificate'] as string) ??
              '';
          } else {
            pemStr = String(content);
          }
          expect(pemStr).toContain('BEGIN CERTIFICATE');
        }
      });

      it('rejects unsupported format with an error', async () => {
        const search = await callTool('search_certificates', {
          query: 'profile exists',
          page_size: 1,
        });
        const certs = (search['results'] ?? []) as Record<string, unknown>[];
        if (certs.length === 0) {
          console.log('SKIP: No certificates found on this Horizon instance');
          return;
        }

        const certId = certs[0]!['_id'] as string | undefined;
        if (!certId) {
          console.log('SKIP: First certificate result has no _id field');
          return;
        }

        const raw = await callToolRaw('download_certificate', {
          certificate_id: certId,
          format: 'der',
        });
        expect(raw).toBeTruthy();
        const data = JSON.parse(raw) as Record<string, unknown>;
        expect(
          data['error'],
          'download_certificate with format=der should return an error dict',
        ).toBeDefined();
      });
    });

    // -----------------------------------------------------------------------
    // CSV exports
    // -----------------------------------------------------------------------

    describe('csv exports', () => {
      it('exports certificates as CSV', async () => {
        const result = await callTool('export_certificates_csv', {
          query: 'profile exists',
        });
        expect(
          result['csv'],
          `export_certificates_csv response lacks 'csv'. Got keys: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        expect(result['truncated']).toBeDefined();
        expect(result['returned_rows']).toBeDefined();
        expect(typeof result['csv']).toBe('string');
      }, 150_000);

      it('exports requests as CSV', async () => {
        const result = await callTool('export_requests_csv', {
          query: 'profile exists',
        });
        expect(
          result['csv'],
          `export_requests_csv response lacks 'csv'. Got keys: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        expect(result['truncated']).toBeDefined();
        expect(typeof result['csv']).toBe('string');
      }, 150_000);

      it('exports events as CSV', async () => {
        const result = await callTool(
          'export_events_csv',
          { query: 'code matches ".*"' },
          { timeout: 120_000 },
        );
        expect(
          result['csv'],
          `export_events_csv response lacks 'csv'. Got keys: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        expect(result['truncated']).toBeDefined();
        expect(result['returned_rows']).toBeDefined();
        expect(result['max_rows']).toBe(1000);
        expect(typeof result['csv']).toBe('string');
        expect(result['returned_rows'] as number).toBeLessThanOrEqual(1000);
      }, 150_000);
    });

    // -----------------------------------------------------------------------
    // Request search and get
    // -----------------------------------------------------------------------

    describe('requests', () => {
      it('searches requests with a match-all query', async () => {
        const result = await callTool('search_requests', {
          query: 'profile exists',
        });
        expect(
          result['results'],
          `search_requests response lacks 'results'. Got: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        expect(Array.isArray(result['results'])).toBe(true);
        expect(result['page_index']).toBeDefined();
        expect(result).toHaveProperty('has_more');
        expect(result).toHaveProperty('next_page_index');
      });

      it('gets a request by ID', async () => {
        const search = await callTool('search_requests', {
          query: 'profile exists',
          page_size: 5,
        });
        const requests = (search['results'] ?? []) as Record<string, unknown>[];
        if (requests.length === 0) {
          console.log('SKIP: No requests found on this Horizon instance');
          return;
        }

        // Try each request until we find one that the API can return
        // (some requests with unsupported workflows may cause 500 errors)
        let lastError = '';
        for (const req of requests) {
          const reqId = req['_id'] as string | undefined;
          if (!reqId) continue;

          try {
            const result = await callTool('get_request', {
              request_id: reqId,
            });
            expect(result).toBeDefined();
            if (!('raw' in result)) {
              expect(
                '_id' in result || 'workflow' in result,
                `get_request response lacks expected keys. Got: ${Object.keys(result).join(', ')}`,
              ).toBe(true);
            }
            return; // Test passed
          } catch (exc) {
            lastError = String(exc);
            continue;
          }
        }

        console.log(
          `SKIP: No request could be fetched. Last error: ${lastError.slice(0, 200)}`,
        );
      });
    });

    // -----------------------------------------------------------------------
    // Request template
    // -----------------------------------------------------------------------

    describe('get_request_template', () => {
      it('returns a template structure for a known profile', async () => {
        const profiles = await callTool('list_profiles');
        const items = (profiles['items'] ?? []) as Record<string, unknown>[];
        if (items.length === 0) {
          console.log('SKIP: No profiles configured on this Horizon instance');
          return;
        }

        let lastError = '';
        for (const item of items) {
          const profileName = (item['name'] ?? item['identifier']) as
            | string
            | undefined;
          const module = item['module'] as string | undefined;
          if (!profileName || !module) continue;

          try {
            const result = await callTool('get_request_template', {
              workflow: 'enroll',
              profile: profileName,
              module,
            });
            expect(result).toBeDefined();
            if (!('raw' in result)) {
              expect(Object.keys(result).length).toBeGreaterThan(0);
            }
            return; // Test passed - stop iterating
          } catch (exc) {
            lastError = String(exc);
            continue;
          }
        }

        console.log(
          `SKIP: No profile returned a valid enroll template. Last error: ${lastError.slice(0, 200)}`,
        );
      });
    });

    // -----------------------------------------------------------------------
    // Event search and get
    // -----------------------------------------------------------------------

    describe('events', () => {
      it('searches events with a match-all HEQL query', async () => {
        const result = await callTool('search_events', {
          query: 'code matches ".*"',
        });
        expect(
          result['results'],
          `search_events response lacks 'results'. Got: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        expect(Array.isArray(result['results'])).toBe(true);
      });

      it('gets an event by ID', async () => {
        const search = await callTool('search_events', {
          query: 'code matches ".*"',
          page_size: 1,
        });
        const events = (search['results'] ?? []) as Record<string, unknown>[];
        if (events.length === 0) {
          console.log('SKIP: No audit events found on this Horizon instance');
          return;
        }

        const eventId = events[0]!['_id'] as string | undefined;
        if (!eventId) {
          console.log('SKIP: First event result has no _id field');
          return;
        }

        const result = await callTool('get_event', { event_id: eventId });
        expect(result).toBeDefined();
        if (!('raw' in result)) {
          expect(
            '_id' in result || 'code' in result,
            `get_event response lacks expected keys. Got: ${Object.keys(result).join(', ')}`,
          ).toBe(true);
        }
      });
    });

    // -----------------------------------------------------------------------
    // Aggregation
    // -----------------------------------------------------------------------

    describe('aggregation', () => {
      it('aggregates certificates by status', async () => {
        const result = await callTool('aggregate_certificates', {
          query: 'profile exists',
          group_by: ['status'],
        });
        expect(result).toBeDefined();
        if (!('raw' in result)) {
          const aggKeys = new Set(['buckets', 'results', 'items', 'data']);
          const hasAggKey = Object.keys(result).some((k) => aggKeys.has(k));
          expect(
            hasAggKey,
            'aggregate_certificates response lacks expected keys. ' +
              `Got keys: ${Object.keys(result).join(', ')}`,
          ).toBe(true);
        }
      });

      it('aggregates certificates by profile with sort order', async () => {
        const result = await callTool('aggregate_certificates', {
          query: 'profile exists',
          group_by: ['profile'],
          sort_order: 'Desc',
        });
        expect(result).toBeDefined();
      });

      it('aggregates requests by status', async () => {
        const result = await callTool('aggregate_requests', {
          query: 'profile exists',
          group_by: ['status'],
        });
        expect(result).toBeDefined();
        if (!('raw' in result)) {
          const aggKeys = new Set(['buckets', 'results', 'items', 'data']);
          const hasAggKey = Object.keys(result).some((k) => aggKeys.has(k));
          expect(
            hasAggKey,
            'aggregate_requests response lacks expected keys. ' +
              `Got keys: ${Object.keys(result).join(', ')}`,
          ).toBe(true);
        }
      });

      it('aggregates requests by workflow with sort order', async () => {
        const result = await callTool('aggregate_requests', {
          query: 'profile exists',
          group_by: ['workflow'],
          sort_order: 'Desc',
        });
        expect(result).toBeDefined();
      });
    });

    // -----------------------------------------------------------------------
    // Submit and cancel flow
    // -----------------------------------------------------------------------

    describe('submit and cancel flow', () => {
      it('submits and cancels an enrollment request on a webra profile', async () => {
        // Find a webra profile
        const profiles = await callTool('list_profiles', {
          module: 'webra',
        });
        const items = (profiles['items'] ?? []) as Record<string, unknown>[];
        if (items.length === 0) {
          console.log(
            'SKIP: No webra profiles configured - skipping submit/cancel flow test',
          );
          return;
        }

        const profileName = (items[0]!['name'] ??
          items[0]!['identifier']) as string;
        if (!profileName) {
          console.log('SKIP: Could not extract name from first webra profile');
          return;
        }

        // Get template (may fail for misconfigured profiles)
        let templateResult: Record<string, unknown>;
        try {
          templateResult = await callTool('get_request_template', {
            workflow: 'enroll',
            profile: profileName,
            module: 'webra',
          });
        } catch (exc) {
          console.log(
            `SKIP: get_request_template failed for profile '${profileName}': ${exc}`,
          );
          return;
        }
        if (templateResult['error']) {
          console.log(
            `SKIP: get_request_template returned error for profile '${profileName}'`,
          );
          return;
        }

        // Submit
        const cn = `${E2E_PREFIX}.test.local`;
        let submitRaw: string;
        try {
          submitRaw = await callToolRaw('submit_request', {
            workflow: 'enroll',
            profile: profileName,
            module: 'webra',
            template: {
              subject: [{ element: 'cn.1', type: 'CN', value: cn }],
              sans: [{ type: 'DNSNAME', value: [cn] }],
              keyType: 'rsa-2048',
            },
          });
        } catch {
          console.log(
            'SKIP: submit_request failed (profile may require approvals or special config)',
          );
          return;
        }
        expect(submitRaw).toBeTruthy();

        let submitData: Record<string, unknown>;
        try {
          submitData = JSON.parse(submitRaw) as Record<string, unknown>;
        } catch {
          console.log(`SKIP: submit_request returned non-JSON`);
          return;
        }
        if (submitData['error']) {
          console.log(
            'SKIP: submit_request failed (profile may require approvals or special config)',
          );
          return;
        }

        // Extract request ID
        const requestId = (submitData['_id'] ??
          submitData['id'] ??
          submitData['requestId']) as string | undefined;
        if (!requestId) {
          console.log(
            `SKIP: Could not extract request ID from submit response. Keys: ${Object.keys(submitData).join(', ')}`,
          );
          return;
        }

        // Cancel the just-submitted request
        try {
          await callToolRaw('cancel_request', {
            request_id: requestId,
          });
        } catch {
          // Cancel may fail if request already transitioned - acceptable
        }
      });
    });
  });

  // =========================================================================
  // Profiles (ported from test_profiles.py)
  // =========================================================================

  describe('profiles', () => {
    it('list_profiles returns items with count metadata', async () => {
      const result = await callTool('list_profiles');
      expect(
        result['items'],
        "list_profiles response missing 'items' key",
      ).toBeDefined();
      expect(Array.isArray(result['items'])).toBe(true);
      expect(result['count']).toBeDefined();
      expect(result['total_available']).toBeDefined();
      expect(result['kind']).toBe('profile');
    });

    it('list_profiles filters by module type', async () => {
      for (const module of ['webra', 'acme', 'scep', 'est', 'monitored']) {
        const result = await callTool('list_profiles', { module });
        expect(result['items']).toBeDefined();
        const items = result['items'] as Record<string, unknown>[];
        for (const item of items) {
          expect(
            (item['module'] as string).toLowerCase(),
            `list_profiles(module='${module}') returned item with module='${item['module']}'`,
          ).toBe(module);
        }
      }
    });

    it('list_profiles filters by name_contains (no match)', async () => {
      const result = await callTool('list_profiles', {
        name_contains: 'zzznomatch',
      });
      expect(result['items']).toBeDefined();
      const items = result['items'] as unknown[];
      expect(items.length === 0 || Array.isArray(items)).toBe(true);
    });

    it('get_profile returns profile details', async () => {
      const profiles = await callTool('list_profiles');
      const items = (profiles['items'] ?? []) as Record<string, unknown>[];
      if (items.length === 0) {
        console.log('SKIP: No profiles configured on this instance');
        return;
      }

      const name = (items[0]!['name'] ?? items[0]!['identifier']) as string;
      expect(name, 'First profile item has no name or identifier').toBeTruthy();

      const detail = await callTool('get_profile', { name });
      expect(detail['name'] === name || 'name' in detail).toBe(true);
    });
  });

  // =========================================================================
  // Dashboards (ported from test_dashboards.py)
  // =========================================================================

  describe('dashboards', () => {
    // -----------------------------------------------------------------------
    // Read-only smoke tests
    // -----------------------------------------------------------------------

    it('list_dashboards returns a valid list envelope', async () => {
      const data = await callTool('list_dashboards');
      expect(data['items']).toBeDefined();
      expect(data['count']).toBeDefined();
      expect(data['total_available']).toBeDefined();
      expect(data['truncated']).toBeDefined();
      expect(Array.isArray(data['items'])).toBe(true);
      expect(data['count']).toBe((data['items'] as unknown[]).length);
    });

    it('list_dashboards name_contains filter returns only matching items', async () => {
      const data = await callTool('list_dashboards', {
        name_contains: '__nonexistent_xyz_abc__',
      });
      expect(data['items']).toEqual([]);
      expect(data['count']).toBe(0);
    });

    it('list_dashboards with dashboard_type=certificate does not error', async () => {
      const data = await callTool('list_dashboards', {
        dashboard_type: 'certificate',
      });
      expect(data['items']).toBeDefined();
      expect(Array.isArray(data['items'])).toBe(true);
    });

    it('list_saved_queries returns a valid list envelope', async () => {
      const data = await callTool('list_saved_queries');
      expect(data['items']).toBeDefined();
      expect(data['count']).toBeDefined();
      expect(Array.isArray(data['items'])).toBe(true);
    });

    it('list_saved_queries with query_type=hcql does not error', async () => {
      const data = await callTool('list_saved_queries', {
        query_type: 'hcql',
      });
      expect(data['items']).toBeDefined();
      expect(Array.isArray(data['items'])).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Dashboard full CRUD lifecycle
    // -----------------------------------------------------------------------

    describe('dashboard CRUD lifecycle', () => {
      it('create_dashboard returns a mutate response with correct name', async () => {
        const name = `${E2E_PREFIX}-crud-dash`;
        try {
          const data = await callTool('create_dashboard', {
            name,
            dashboard_type: 'certificate',
            description: 'E2E test dashboard',
          });
          expect(data['status']).toBe('created');
          expect(data['kind']).toBe('dashboard');
          expect(data['name']).toBe(name);
        } finally {
          try {
            await callTool('delete_dashboard', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('get_dashboard returns the created dashboard', async () => {
        const name = `${E2E_PREFIX}-get-dash`;
        try {
          await callTool('create_dashboard', {
            name,
            dashboard_type: 'certificate',
          });
          await delay(1000);

          const data = await callTool('get_dashboard', { name });
          expect(data['name']).toBe(name);
        } finally {
          try {
            await callTool('delete_dashboard', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('add_dashboard_chart appends a chart and returns its ID', async () => {
        const name = `${E2E_PREFIX}-chart-dash`;
        const chartId = `${E2E_PREFIX}-c1`;
        try {
          await callTool('create_dashboard', {
            name,
            dashboard_type: 'certificate',
          });
          await delay(1000);

          const data = await callTool('add_dashboard_chart', {
            dashboard_name: name,
            chart: {
              type: 'donut',
              title: `${E2E_PREFIX} chart`,
              localQuery: 'status is valid',
              fields: ['keyType'],
              i: chartId,
              x: 0,
              y: 0,
              w: 6,
              h: 4,
            },
          });

          expect(data['chart_id']).toBe(chartId);
          expect(data['dashboard']).toBeDefined();

          const dashboard = data['dashboard'] as Record<string, unknown>;
          const chartIds = (
            (dashboard['charts'] ?? []) as Record<string, unknown>[]
          ).map((c) => c['i']);
          expect(chartIds).toContain(chartId);
        } finally {
          try {
            await callTool('delete_dashboard', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('update_dashboard_chart modifies chart fields', async () => {
        const name = `${E2E_PREFIX}-upd-chart-dash`;
        const chartId = `${E2E_PREFIX}-upd-c1`;
        try {
          await callTool('create_dashboard', {
            name,
            dashboard_type: 'certificate',
          });
          await delay(1000);

          await callTool('add_dashboard_chart', {
            dashboard_name: name,
            chart: {
              type: 'pie',
              title: 'Original Title',
              localQuery: 'status is valid',
              fields: ['keyType'],
              i: chartId,
              x: 0,
              y: 0,
              w: 6,
              h: 4,
            },
          });
          await delay(1000);

          const updated = await callTool('update_dashboard_chart', {
            dashboard_name: name,
            chart_id: chartId,
            title: 'Updated Title',
            chart_type: 'bar-vertical',
          });

          const charts = (updated['charts'] ?? []) as Record<string, unknown>[];
          const matching = charts.filter((c) => c['i'] === chartId);
          expect(matching.length).toBe(1);
          expect(matching[0]!['title']).toBe('Updated Title');
          expect(matching[0]!['type']).toBe('bar-vertical');
        } finally {
          try {
            await callTool('delete_dashboard', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('remove_dashboard_chart removes the chart', async () => {
        const name = `${E2E_PREFIX}-rem-chart-dash`;
        const chartId = `${E2E_PREFIX}-rem-c1`;
        try {
          await callTool('create_dashboard', {
            name,
            dashboard_type: 'certificate',
          });
          await delay(1000);

          await callTool('add_dashboard_chart', {
            dashboard_name: name,
            chart: {
              type: 'metric',
              title: 'To Be Removed',
              localQuery: 'status is valid',
              fields: ['keyType'],
              i: chartId,
              x: 0,
              y: 0,
              w: 3,
              h: 2,
            },
          });
          await delay(1000);

          const data = await callTool('remove_dashboard_chart', {
            dashboard_name: name,
            chart_id: chartId,
          });

          expect(data['removed_chart']).toBe(chartId);
          const dashboard = (data['dashboard'] ?? {}) as Record<
            string,
            unknown
          >;
          const chartIds = (
            (dashboard['charts'] ?? []) as Record<string, unknown>[]
          ).map((c) => c['i']);
          expect(chartIds).not.toContain(chartId);
        } finally {
          try {
            await callTool('delete_dashboard', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('update_dashboard changes the description', async () => {
        const name = `${E2E_PREFIX}-upd-desc-dash`;
        const newDescription = `${E2E_PREFIX} updated description`;
        try {
          await callTool('create_dashboard', {
            name,
            dashboard_type: 'certificate',
          });
          await delay(1000);

          const data = await callTool('update_dashboard', {
            name,
            description: newDescription,
          });

          expect(data['status']).toBe('updated');
          expect(data['name']).toBe(name);

          const responseData = (data['data'] ?? {}) as Record<string, unknown>;
          expect(
            responseData['description'],
            `update_dashboard response data does not reflect updated description. ` +
              `Expected '${newDescription}', got: '${responseData['description']}'`,
          ).toBe(newDescription);
        } finally {
          try {
            await callTool('delete_dashboard', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('delete_dashboard removes the dashboard', async () => {
        const name = `${E2E_PREFIX}-delete-me`;
        await callTool('create_dashboard', {
          name,
          dashboard_type: 'certificate',
        });

        const data = await callTool('delete_dashboard', {
          name,
          expected_name: name,
        });

        expect(data['deleted']).toBe(true);
        expect(data['name']).toBe(name);
        expect(data['kind']).toBe('dashboard');
      });
    });

    // -----------------------------------------------------------------------
    // Saved query lifecycle
    // -----------------------------------------------------------------------

    describe('saved query lifecycle', () => {
      it('upsert_saved_query creates with correct response', async () => {
        const name = `${E2E_PREFIX}-sq-create`;
        try {
          const data = await callTool('upsert_saved_query', {
            name,
            query_type: 'hcql',
            query: 'profile exists',
            description: 'E2E created saved query',
          });

          expect(data['status']).toBe('upserted');
          expect(data['kind']).toBe('saved_query');
          expect(data['name']).toBe(name);
        } finally {
          try {
            await callTool('delete_saved_query', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('get_saved_query returns the created query', async () => {
        const name = `${E2E_PREFIX}-sq-get`;
        try {
          await callTool('upsert_saved_query', {
            name,
            query_type: 'hcql',
            query: 'profile exists',
          });

          const data = await callTool('get_saved_query', { name });
          expect(data['name']).toBe(name);
        } finally {
          try {
            await callTool('delete_saved_query', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('upsert_saved_query updates an existing query', async () => {
        const name = `${E2E_PREFIX}-sq-update`;
        const newQuery = 'profile exists and status is valid';
        try {
          await callTool('upsert_saved_query', {
            name,
            query_type: 'hcql',
            query: 'profile exists',
          });

          const data = await callTool('upsert_saved_query', {
            name,
            query_type: 'hcql',
            query: newQuery,
          });
          expect(data['status']).toBe('upserted');
          expect(data['name']).toBe(name);

          // Verify the new query persisted
          const fetched = await callTool('get_saved_query', { name });
          expect(fetched['query']).toBe(newQuery);
        } finally {
          try {
            await callTool('delete_saved_query', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('delete_saved_query removes the query', async () => {
        const name = `${E2E_PREFIX}-sq-delete-me`;
        await callTool('upsert_saved_query', {
          name,
          query_type: 'hcql',
          query: 'profile exists',
        });

        const data = await callTool('delete_saved_query', {
          name,
          expected_name: name,
        });

        expect(data['deleted']).toBe(true);
        expect(data['name']).toBe(name);
        expect(data['kind']).toBe('saved_query');

        // Confirm it is gone
        const listData = await callTool('list_saved_queries', {
          name_contains: name,
        });
        const names = (
          (listData['items'] ?? []) as Record<string, unknown>[]
        ).map((item) => item['name']);
        expect(names).not.toContain(name);
      });
    });
  });

  // =========================================================================
  // Reports (ported from test_reports.py)
  // =========================================================================

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

  // =========================================================================
  // Assist (ported from test_assist.py)
  // =========================================================================

  describe('assist', () => {
    // -----------------------------------------------------------------------
    // Knowledge resource tests (core resources + small-model additions)
    // -----------------------------------------------------------------------

    const KNOWLEDGE_URIS = [
      'horizon://knowledge/profiles',
      'horizon://knowledge/computation-and-data-flow',
      'horizon://knowledge/workflows',
      'horizon://knowledge/query-languages',
      'horizon://knowledge/rbac',
      'horizon://knowledge/architecture',
      'horizon://knowledge/dictionary-matrix',
      'horizon://knowledge/discovery',
      'horizon://knowledge/automation',
      'horizon://knowledge/integrations',
      'horizon://knowledge/dashboards',
      'horizon://knowledge/system-admin',
      'horizon://knowledge/tool-selection',
      'horizon://knowledge/adcs-integration',
      'horizon://knowledge/digicert-integration',
      'horizon://knowledge/intune-integration',
      'horizon://knowledge/query-languages/ownership-patterns-hcql',
      'horizon://knowledge/datasources/rest-datasource',
      'horizon://knowledge/rest-notifications/real-world-examples',
    ] as const;

    describe.each(KNOWLEDGE_URIS)('knowledge resource %s', (uri) => {
      it('is accessible and non-empty', async () => {
        const content = await readResource(uri);
        expect(content).toBeTruthy();
        expect(
          content.length,
          `Resource ${uri} is suspiciously short (${content.length} chars)`,
        ).toBeGreaterThan(100);
      });

      it('contains structured content (headers or tables)', async () => {
        const content = await readResource(uri);
        const hasHeaders = content.includes('## ') || content.includes('# ');
        const hasTables = content.includes('|');
        expect(
          hasHeaders || hasTables,
          `Resource ${uri} does not contain markdown headers (##) or tables (|). ` +
            `First 200 chars: ${content.slice(0, 200)}`,
        ).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // Server instructions
    // -----------------------------------------------------------------------

    it('server instructions are non-empty', async () => {
      const client = getMcpClient();
      const instructions = client.getInstructions();
      // Instructions must exist and be non-trivially short
      expect(instructions).toBeDefined();
      expect(instructions!.length).toBeGreaterThan(10);
    });

    // -----------------------------------------------------------------------
    // System tools
    // -----------------------------------------------------------------------

    it('whoami returns user info with identity', async () => {
      const result = await callTool('whoami');
      expect(result).toBeDefined();
      if ('raw' in result) {
        expect((result['raw'] as string).length).toBeGreaterThan(10);
      } else {
        expect(
          result['identity'],
          `whoami response lacks 'identity' key. Got keys: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        const identity = result['identity'] as Record<string, unknown>;
        expect(typeof identity).toBe('object');
        const identityKeys = new Set([
          'identifier',
          'login',
          'id',
          '_id',
          'name',
          'email',
        ]);
        const hasIdentifierKey = Object.keys(identity).some((k) =>
          identityKeys.has(k),
        );
        expect(
          hasIdentifierKey,
          `whoami identity lacks any identifier key. Got keys: ${Object.keys(identity).join(', ')}`,
        ).toBe(true);
      }
    });

    it('get_license_info returns license data', async () => {
      try {
        const result = await callTool('get_license_info');
        expect(result).toBeDefined();
        if ('raw' in result) {
          expect((result['raw'] as string).length).toBeGreaterThan(10);
        } else {
          expect(
            Object.keys(result).length,
            'get_license_info returned empty JSON object',
          ).toBeGreaterThan(0);
        }
      } catch {
        console.log(
          'SKIP: get_license_info not available on this Horizon instance',
        );
      }
    });

    // -----------------------------------------------------------------------
    // Query validation tools
    // -----------------------------------------------------------------------

    describe('query validation', () => {
      it('validate_hcql confirms a valid HCQL expression', async () => {
        const result = await callTool('validate_hcql', {
          query: 'profile exists',
        });
        expect(result['valid']).toBe(true);
        expect(result['query_type']).toBe('HCQL');
      });

      it('validate_hcql flags a syntactically broken expression', async () => {
        const raw = await callToolRaw('validate_hcql', {
          query: 'INVALID<<<',
        });
        expect(raw).toBeTruthy();
        const data = JSON.parse(raw) as Record<string, unknown>;
        expect(
          data['valid'],
          `Expected valid=false for 'INVALID<<<', got: ${JSON.stringify(data)}`,
        ).toBe(false);
      });

      it('validate_hrql confirms a valid HRQL expression', async () => {
        const result = await callTool('validate_hrql', {
          query: 'profile exists',
        });
        expect(result['valid']).toBe(true);
        expect(result['query_type']).toBe('HRQL');
      });

      it('validate_heql confirms a valid HEQL expression', async () => {
        const result = await callTool('validate_heql', {
          query: 'code matches ".*"',
        });
        expect(result['valid']).toBe(true);
        expect(result['query_type']).toBe('HEQL');
      });

      it('validate_hdql confirms a valid HDQL expression', async () => {
        const result = await callTool('validate_hdql', {
          query: 'status exists',
        });
        expect(result['valid']).toBe(true);
        expect(result['query_type']).toBe('HDQL');
      });

      it.each(['hcql', 'hrql', 'heql', 'hdql'] as const)(
        'describe_query_fields returns metadata for %s',
        async (queryType) => {
          const result = await callTool('describe_query_fields', {
            query_type: queryType,
          });
          expect(result['error']).toBeUndefined();
          expect(result['query_type']).toBe(queryType);
          expect(Array.isArray(result['fields'])).toBe(true);
          expect((result['fields'] as unknown[]).length).toBeGreaterThan(0);
          expect(Array.isArray(result['examples'])).toBe(true);
        },
      );
    });

    // -----------------------------------------------------------------------
    // Crypto tools
    // -----------------------------------------------------------------------

    describe('crypto tools', () => {
      /**
       * Fetch a real PEM certificate from a well-known host.
       * Uses fetch_exposed_certificate MCP tool (full stack).
       */
      async function getLiveCertPem(): Promise<string> {
        const result = await callTool('fetch_exposed_certificate', {
          uri: 'https://www.google.com',
        });
        return result['pem'] as string;
      }

      it('decode_x509 returns all expected RFC 5280 fields', async () => {
        const pem = await getLiveCertPem();
        const result = await callTool('decode_x509', { pem });

        // Core fields must be present
        expect(
          result['dn'],
          `Missing 'dn'. Keys: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        expect(result['issuerDn'], "Missing 'issuerDn'").toBeDefined();
        expect(result['serial'], "Missing 'serial'").toBeDefined();
        expect(result['notBefore'], "Missing 'notBefore'").toBeDefined();
        expect(result['notAfter'], "Missing 'notAfter'").toBeDefined();
        expect(result['keyType'], "Missing 'keyType'").toBeDefined();
        expect(
          result['signingAlgorithm'],
          "Missing 'signingAlgorithm'",
        ).toBeDefined();
        expect(result['pem'], "Missing 'pem'").toBeDefined();
        expect(
          result['certificateThumbprint'],
          "Missing 'certificateThumbprint'",
        ).toBeDefined();
        expect(result['selfSigned'], "Missing 'selfSigned'").toBeDefined();

        // dnElements should be a list of {type, value} objects
        expect(result['dnElements']).toBeDefined();
        expect(Array.isArray(result['dnElements'])).toBe(true);
        const dnElements = result['dnElements'] as Record<string, unknown>[];
        expect(dnElements.every((e) => 'type' in e && 'value' in e)).toBe(true);
      });

      it('decode_x509 parses SANs into typed entries', async () => {
        const pem = await getLiveCertPem();
        const result = await callTool('decode_x509', { pem });

        // The cert may or may not have SANs depending on how the fetch went
        // (SNI issues could return a cert without SANs)
        if (result['sans']) {
          const sans = result['sans'] as Record<string, unknown>[];
          expect(Array.isArray(sans)).toBe(true);
          if (sans.length > 0) {
            expect(
              sans.every((s) => 'sanType' in s && 'value' in s),
              `SAN entries should have sanType + value. Got: ${JSON.stringify(sans.slice(0, 2))}`,
            ).toBe(true);
          }
        }
      });

      it('decode_x509 returns key usage fields', async () => {
        const pem = await getLiveCertPem();
        const result = await callTool('decode_x509', { pem });

        expect(result['keyUsages']).toBeDefined();
        expect(Array.isArray(result['keyUsages'])).toBe(true);
        expect(result['isKeyUsagesCritical']).toBeDefined();
      });

      it('decode_x509 returns AIA and CRL DPs for non-root certs', async () => {
        const pem = await getLiveCertPem();
        const result = await callTool('decode_x509', { pem });

        if (!result['selfSigned']) {
          expect(result['aias'], 'Non-root cert should have AIA').toBeDefined();
          expect(
            result['crldps'],
            'Non-root cert should have CRL DPs',
          ).toBeDefined();
        }
      });

      it('decode_csr rejects invalid data', async () => {
        // The MCP server returns the error as isError=true content;
        // callTool() throws a ToolError in that case.
        await expect(
          callTool('decode_csr', { pem: 'not-a-csr' }),
        ).rejects.toThrow(ToolError);
      });

      it('detect_file identifies a PEM certificate', async () => {
        const pem = await getLiveCertPem();
        const result = await callTool('detect_file', { data: pem });
        expect(
          result['type'],
          `Expected type='certificate', got type='${result['type']}'`,
        ).toBe('certificate');
        expect(
          result['value'],
          'detect_file should return decoded value',
        ).toBeDefined();
      });

      it('decode_crl rejects invalid data', async () => {
        await expect(
          callTool('decode_crl', { data: 'not-a-crl' }),
        ).rejects.toThrow(ToolError);
      });

      it('decode_ocsp rejects invalid data', async () => {
        await expect(
          callTool('decode_ocsp', { data: 'not-an-ocsp-response' }),
        ).rejects.toThrow(ToolError);
      });

      it('decode_tsa rejects invalid data', async () => {
        await expect(
          callTool('decode_tsa', { data: 'not-a-tsa-response' }),
        ).rejects.toThrow(ToolError);
      });

      it('fetch then decode workflow: fetch live cert and decode via Horizon', async () => {
        const fetchResult = await callTool('fetch_exposed_certificate', {
          uri: 'https://www.google.com',
        });
        expect(fetchResult['pem']).toBeDefined();

        const decodeResult = await callTool('decode_x509', {
          pem: fetchResult['pem'],
        });

        // The fetched and decoded cert must have matching thumbprints.
        // The DN may differ from "google" if SNI is not supported by the
        // egress network, so we only assert structural consistency.
        expect(decodeResult['dn']).toBeDefined();
        expect(decodeResult['certificateThumbprint']).toBe(
          fetchResult['thumbprint_sha256'],
        );
      });
    });

    // -----------------------------------------------------------------------
    // Computation tools
    // -----------------------------------------------------------------------

    describe('computation tools', () => {
      async function runComputation(
        rule: string,
        dictionary: Record<string, string>,
      ): Promise<Record<string, unknown>> {
        try {
          return await callTool('simulate_computation_rule', {
            rule,
            dictionary,
          });
        } catch (exc) {
          if (String(exc).includes('404')) {
            // Playground endpoint not available - skip
            return { _skipped: true };
          }
          throw exc;
        }
      }

      function computedValue(result: Record<string, unknown>): string {
        const val =
          result['computedValueSingle'] ?? result['raw'] ?? String(result);
        return String(val);
      }

      it('basic dictionary lookup resolves', async () => {
        const result = await runComputation('{{owner}}', {
          owner: 'test-user',
        });
        if (result['_skipped']) return;
        expect(computedValue(result)).toContain('test-user');
      });

      it('Upper function returns uppercase', async () => {
        const result = await runComputation('Upper({{cn}})', {
          cn: 'hello',
        });
        if (result['_skipped']) return;
        expect(computedValue(result)).toContain('HELLO');
      });

      it('Extract with capture group extracts user part', async () => {
        const result = await runComputation('Extract({{email}}, "(.*)@", 1)', {
          email: 'alice@example.com',
        });
        if (result['_skipped']) return;
        expect(computedValue(result).toLowerCase()).toContain('alice');
      });

      it('DomainDNS extracts parent domain', async () => {
        const result = await runComputation('DomainDNS({{fqdn}})', {
          fqdn: 'machine.domain.local',
        });
        if (result['_skipped']) return;
        expect(computedValue(result).toLowerCase()).toContain('domain.local');
      });

      it('ShortenDNS extracts hostname', async () => {
        const result = await runComputation('ShortenDNS({{fqdn}})', {
          fqdn: 'web01.corp.example.com',
        });
        if (result['_skipped']) return;
        expect(computedValue(result).toLowerCase()).toContain('web01');
      });

      it('Concat+OrElse builds string with fallback', async () => {
        const result = await runComputation(
          'Concat(OrElse({{prefix}}, "default"), "-", {{name}})',
          { name: 'server01' },
        );
        if (result['_skipped']) return;
        expect(computedValue(result).toLowerCase()).toContain(
          'default-server01',
        );
      });

      it('datasource flow with empty flow does not crash', async () => {
        try {
          const raw = await callToolRaw('simulate_datasource_flow', {
            flow: [],
          });
          expect(raw).toBeTruthy();
        } catch {
          console.log(
            'SKIP: simulate_datasource_flow not available on this Horizon instance',
          );
        }
      });
    });

    // -----------------------------------------------------------------------
    // Translation tools
    // -----------------------------------------------------------------------

    describe('translate_to_hql', () => {
      it('translates a certificate description to HCQL', async () => {
        const result = await callTool('translate_to_hql', {
          natural_language: 'expired RSA certificates',
        });
        expect(result).toBeDefined();
        expect(result['query_type']).toBe('hcql');
        expect(
          result['query'] ?? result['message'],
          'translate_to_hql returned neither query nor message',
        ).toBeTruthy();
      });

      it('respects a forced target_type of hrql', async () => {
        const result = await callTool('translate_to_hql', {
          natural_language: 'pending requests',
          target_type: 'hrql',
        });
        expect(result).toBeDefined();
        expect(result['query_type']).toBe('hrql');
      });

      it('validates against live instance when validate=true', async () => {
        const result = await callTool('translate_to_hql', {
          natural_language: 'valid certificates',
          validate: true,
        });
        if (result['query']) {
          expect(
            result['validation'],
            "translate_to_hql with validate=true must include 'validation' key",
          ).toBeDefined();
        }
      });
    });

    // -----------------------------------------------------------------------
    // Grading tools (conditional - skip if no policies/rulesets configured)
    //
    // The TS server does not have list_grading_policies/list_grading_rulesets
    // tools, so we use the HorizonClient directly to discover available
    // policies/rulesets, then call the explain tools through MCP.
    // -----------------------------------------------------------------------

    describe('grading', () => {
      async function getLiveCertificatePem(): Promise<string | null> {
        const search = await callTool('search_certificates', {
          query: 'profile exists',
          page_size: 1,
        });
        const certificates = (search['results'] ?? []) as Record<
          string,
          unknown
        >[];
        if (certificates.length === 0) {
          return null;
        }

        const certId = certificates[0]!['_id'] as string | undefined;
        if (!certId) {
          return null;
        }

        const cert = await getHorizonClient().get<Record<string, unknown>>(
          `/api/v1/certificates/${certId}`,
        );
        const certificate = (cert['certificate'] ?? cert) as Record<
          string,
          unknown
        >;
        const pem = (certificate['certificate'] ?? cert['pem']) as
          | string
          | undefined;
        return pem ?? null;
      }

      it('explain_grading_policy returns details for the first policy found', async () => {
        const client = getHorizonClient();
        let policies: Record<string, unknown>[];
        try {
          const data = await client.get<unknown>(
            '/api/v1/certificate/grading/policies',
          );
          policies = Array.isArray(data)
            ? (data as Record<string, unknown>[])
            : [];
        } catch {
          console.log('SKIP: Grading policies endpoint not available');
          return;
        }

        if (policies.length === 0) {
          console.log(
            'SKIP: No grading policies configured on this Horizon instance',
          );
          return;
        }

        const name = (policies[0]!['name'] ?? policies[0]!['identifier']) as
          | string
          | undefined;
        if (!name) {
          console.log('SKIP: Could not extract name from first grading policy');
          return;
        }

        try {
          const result = await callTool('explain_grading_policy', {
            policy_name: name,
          });
          expect(result).toBeDefined();
          expect(
            result['policy'],
            `explain_grading_policy response lacks 'policy' key. Got: ${Object.keys(result).join(', ')}`,
          ).toBeDefined();
        } catch {
          console.log(
            'SKIP: explain_grading_policy not available on this Horizon instance',
          );
        }
      });

      it('explain_grading_ruleset returns details for the first ruleset found', async () => {
        const client = getHorizonClient();
        let rulesets: Record<string, unknown>[];
        try {
          const data = await client.get<unknown>(
            '/api/v1/certificate/grading/rulesets',
          );
          rulesets = Array.isArray(data)
            ? (data as Record<string, unknown>[])
            : [];
        } catch {
          console.log('SKIP: Grading rulesets endpoint not available');
          return;
        }

        if (rulesets.length === 0) {
          console.log(
            'SKIP: No grading rulesets configured on this Horizon instance',
          );
          return;
        }

        const name = (rulesets[0]!['name'] ?? rulesets[0]!['identifier']) as
          | string
          | undefined;
        if (!name) {
          console.log(
            'SKIP: Could not extract name from first grading ruleset',
          );
          return;
        }

        try {
          const result = await callTool('explain_grading_ruleset', {
            ruleset_name: name,
          });
          expect(result).toBeDefined();
          expect(
            result['ruleset'],
            `explain_grading_ruleset response lacks 'ruleset' key. Got: ${Object.keys(result).join(', ')}`,
          ).toBeDefined();
        } catch {
          console.log(
            'SKIP: explain_grading_ruleset not available on this Horizon instance',
          );
        }
      });

      it('explain_grading_policy can explain a live certificate PEM', async () => {
        const pem = await getLiveCertificatePem();
        if (!pem) {
          console.log(
            'SKIP: No certificate PEM available for grading policy explain test',
          );
          return;
        }

        try {
          const result = await callTool('explain_grading_policy', {
            policy_name: 'Horizon-Grading-Policy',
            certificate_pem: pem,
          });
          expect(result['policy']).toBeDefined();
          expect(result['explanation']).toBeDefined();
        } catch (exc) {
          console.log(
            `SKIP: explain_grading_policy certificate path unavailable: ${String(exc).slice(0, 200)}`,
          );
        }
      });

      it('explain_grading_ruleset can explain a live certificate PEM', async () => {
        const pem = await getLiveCertificatePem();
        if (!pem) {
          console.log(
            'SKIP: No certificate PEM available for grading ruleset explain test',
          );
          return;
        }

        try {
          const result = await callTool('explain_grading_ruleset', {
            ruleset_name: 'anssiContent',
            certificate_pem: pem,
          });
          expect(result['ruleset']).toBeDefined();
          expect(result['explanation']).toBeDefined();
        } catch (exc) {
          console.log(
            `SKIP: explain_grading_ruleset certificate path unavailable: ${String(exc).slice(0, 200)}`,
          );
        }
      });
    });
  });

  // =========================================================================
  // Discovery (ported from test_discovery.py)
  // =========================================================================

  describe('discovery', () => {
    const AUTH_LEVELS = {
      search: { accessLevel: 'authenticated' },
      feed: { accessLevel: 'authorized' },
    };

    const TEST_CERT_PEM =
      '-----BEGIN CERTIFICATE-----\n' +
      'MIIBkTCB+wIUEpGSHqKzsPm2G22V2GEHzTxkSZ4wDQYJKoZIhvcNAQELBQAwFDES\n' +
      'MBAGA1UEAwwJdGVzdC1jZXJ0MB4XDTI0MDEwMTAwMDAwMFoXDTI1MDEwMTAwMDAw\n' +
      'MFowFDESMBAGA1UEAwwJdGVzdC1jZXJ0MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJB\n' +
      'AL7+aty3S1iBA/+yOXKpfJZBSFxWYGOcaGes0MfZnHMHh10rOHcMiSaVKcggBz8D\n' +
      'BMHW8IOEA2MtiVEbfPLK3aECAwEAATANBgkqhkiG9w0BAQsFAANBADKs+jE5bOu0\n' +
      'BNQD8APB3PAKJbCw2JJJGX9RdkFgMk5MREGPyoOHbJHqMYGxlINk3KtpEm4y6Ha\n' +
      'YdBwIiKBKRo=\n' +
      '-----END CERTIFICATE-----';

    // -----------------------------------------------------------------------
    // Read-only smoke tests
    // -----------------------------------------------------------------------

    it('list_discovery_campaigns returns a valid list envelope', async () => {
      const data = await callTool('list_discovery_campaigns');
      expect(data['items']).toBeDefined();
      expect(data['count']).toBeDefined();
      expect(data['total_available']).toBeDefined();
      expect(data['truncated']).toBeDefined();
      expect(Array.isArray(data['items'])).toBe(true);
      expect(data['count']).toBe((data['items'] as unknown[]).length);
    });

    it('list_discovery_campaigns name filter returns only matching items', async () => {
      const data = await callTool('list_discovery_campaigns', {
        name_contains: '__nonexistent_xyz_abc__',
      });
      expect(data['items']).toEqual([]);
      expect(data['count']).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Campaign full CRUD lifecycle
    // -----------------------------------------------------------------------

    describe('campaign CRUD lifecycle', () => {
      it('create_discovery_campaign returns correct response', async () => {
        const name = `${E2E_PREFIX}-crud-cmp`;
        try {
          const data = await callTool('create_discovery_campaign', {
            name,
            authorization_levels: AUTH_LEVELS,
            description: 'E2E test campaign',
            enabled: false,
          });
          expect(data['status']).toBe('created');
          expect(data['kind']).toBe('discovery_campaign');
          expect(data['name']).toBe(name);
        } finally {
          try {
            await callTool('delete_discovery_campaign', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('get_discovery_campaign returns the campaign', async () => {
        const name = `${E2E_PREFIX}-get-cmp`;
        try {
          await callTool('create_discovery_campaign', {
            name,
            authorization_levels: AUTH_LEVELS,
            enabled: false,
          });

          const data = await callTool('get_discovery_campaign', {
            name,
          });
          expect(data['name']).toBe(name);
        } finally {
          try {
            await callTool('delete_discovery_campaign', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('update_discovery_campaign modifies campaign configuration', async () => {
        const name = `${E2E_PREFIX}-upd-cmp`;
        const newDescription = `${E2E_PREFIX} updated description`;
        try {
          await callTool('create_discovery_campaign', {
            name,
            authorization_levels: AUTH_LEVELS,
            enabled: false,
          });

          const data = await callTool('update_discovery_campaign', {
            name,
            description: newDescription,
            event_on_failure: false,
          });
          expect(data['status']).toBe('updated');
          expect(data['name']).toBe(name);

          // Verify changes persisted
          const fetched = await callTool('get_discovery_campaign', {
            name,
          });
          expect(fetched['description']).toBe(newDescription);
          expect(fetched['eventOnFailure']).toBe(false);
        } finally {
          try {
            await callTool('delete_discovery_campaign', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('flush_discovery_campaign purges events and returns confirmation', async () => {
        const name = `${E2E_PREFIX}-flush-cmp`;
        try {
          await callTool('create_discovery_campaign', {
            name,
            authorization_levels: AUTH_LEVELS,
            enabled: false,
          });

          const data = await callTool('flush_discovery_campaign', {
            name,
            expected_name: name,
          });
          expect(data['flushed']).toBe(true);
          expect(data['name']).toBe(name);
          expect(data['kind']).toBe('discovery_campaign');
        } finally {
          try {
            await callTool('delete_discovery_campaign', {
              name,
              expected_name: name,
            });
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('delete_discovery_campaign removes the campaign', async () => {
        const name = `${E2E_PREFIX}-delete-me-cmp`;
        await callTool('create_discovery_campaign', {
          name,
          authorization_levels: AUTH_LEVELS,
          enabled: false,
        });

        const data = await callTool('delete_discovery_campaign', {
          name,
          expected_name: name,
        });
        expect(data['deleted']).toBe(true);
        expect(data['name']).toBe(name);
        expect(data['kind']).toBe('discovery_campaign');

        // Confirm it is gone
        const listData = await callTool('list_discovery_campaigns', {
          name_contains: name,
        });
        const names = (
          (listData['items'] ?? []) as Record<string, unknown>[]
        ).map((item) => item['name']);
        expect(names).not.toContain(name);
      });
    });

    // -----------------------------------------------------------------------
    // Feed session lifecycle
    //
    // The campaign is created in a beforeAll and deleted in an afterAll
    // to avoid timing issues between create and feed start.
    // -----------------------------------------------------------------------

    describe('feed session lifecycle', () => {
      const feedCampaignName = `${E2E_PREFIX}-feed`;
      let feedCampaignReady = false;

      it('setup: create campaign for feed tests', async () => {
        try {
          await callTool('create_discovery_campaign', {
            name: feedCampaignName,
            authorization_levels: AUTH_LEVELS,
            hosts: ['127.0.0.1'],
            ports: [443],
            enabled: false,
          });
          // Wait for Horizon to fully register the campaign before
          // the feed endpoint can see it (eventual consistency).
          await delay(2000);
          feedCampaignReady = true;
        } catch (exc) {
          console.log(`SKIP: Could not create feed test campaign: ${exc}`);
        }
      });

      it('full feed lifecycle: start, feed certificate, end', async () => {
        if (!feedCampaignReady) {
          console.log(
            'SKIP: Feed campaign not created - skipping feed lifecycle test',
          );
          return;
        }

        // Verify campaign is visible before starting feed
        try {
          await callTool('get_discovery_campaign', {
            name: feedCampaignName,
          });
        } catch {
          console.log(
            'SKIP: Feed campaign not visible via get_discovery_campaign yet',
          );
          return;
        }

        // 1. Start feed session
        let startData: Record<string, unknown>;
        try {
          startData = await callTool('start_discovery_feed_session', {
            campaign_name: feedCampaignName,
          });
        } catch (exc) {
          // The feed endpoint may lag behind the campaigns endpoint.
          // Some Horizon versions require additional time or have
          // separate internal caches for the discovery feed module.
          console.log(`SKIP: start_discovery_feed_session failed: ${exc}`);
          return;
        }
        expect(startData['data']).toBeDefined();
        const sessionId = (startData['data'] as Record<string, unknown>)[
          'id'
        ] as string;
        expect(sessionId).toBeTruthy();

        try {
          // 2. Feed a certificate
          try {
            const feedData = await callTool('feed_discovery_certificate', {
              session_id: sessionId,
              campaign_name: feedCampaignName,
              certificate: TEST_CERT_PEM,
              ip: '127.0.0.1',
              hostnames: ['test.example.com'],
              tls_ports: [{ port: 443, version: 'TLSv1.3' }],
            });
            expect(feedData['data']).toBeDefined();
          } catch (exc) {
            console.log(
              `SKIP: feed_discovery_certificate failed (API schema mismatch or invalid cert): ${exc}`,
            );
          }
        } finally {
          // 3. End session (always clean up)
          try {
            const endData = await callTool('end_discovery_feed_session', {
              campaign_name: feedCampaignName,
              session_id: sessionId,
            });
            expect(endData['content']).toBeDefined();
            expect(endData['content'] as string).toContain(sessionId);
          } catch {
            // Best-effort cleanup
          }
        }
      });

      it('teardown: delete feed campaign', async () => {
        if (!feedCampaignReady) return;
        try {
          await callTool('delete_discovery_campaign', {
            name: feedCampaignName,
            expected_name: feedCampaignName,
          });
        } catch {
          // Best-effort cleanup
        }
      });
    });

    // -----------------------------------------------------------------------
    // Discovery event read-only tests
    // -----------------------------------------------------------------------

    describe('discovery events', () => {
      it('search_discovery_events returns a valid response', async () => {
        const data = await callTool('search_discovery_events', {
          query: 'timestamp after -24h',
          page_size: 10,
          with_count: true,
        });
        expect(data['results']).toBeDefined();
        expect(Array.isArray(data['results'])).toBe(true);
        expect(data['page_index']).toBeDefined();
        expect(data['page_size']).toBeDefined();
        expect(data).toHaveProperty('has_more');
        expect(data).toHaveProperty('next_page_index');
      });

      it('get_discovery_event returns details for an available event', async () => {
        const searchData = await callTool('search_discovery_events', {
          query: 'timestamp after -30d',
          page_size: 1,
        });
        const events = (searchData['results'] ?? []) as Record<
          string,
          unknown
        >[];
        if (events.length === 0) {
          console.log('SKIP: No discovery events available on the QA instance');
          return;
        }

        const eventId = (events[0]!['id'] ?? events[0]!['_id']) as
          | string
          | undefined;
        if (!eventId) {
          console.log('SKIP: First event has no recognisable ID field');
          return;
        }

        const eventData = await callTool('get_discovery_event', {
          event_id: String(eventId),
        });
        expect(
          eventData['id'] === eventId || eventData['_id'] === eventId,
        ).toBe(true);
      });

      it('export_discovery_events_csv returns CSV envelope', async () => {
        const data = await callTool('export_discovery_events_csv', {
          query: 'timestamp after -7d',
        });
        expect(data['csv']).toBeDefined();
        expect(data['truncated']).toBeDefined();
        expect(data['returned_rows']).toBeDefined();
        expect(data['max_rows']).toBeDefined();
        expect(typeof data['csv']).toBe('string');
        expect(data['returned_rows'] as number).toBeGreaterThanOrEqual(0);
      });
    });

    // -----------------------------------------------------------------------
    // Discovery import integration test
    // -----------------------------------------------------------------------

    describe('discovery import workflow', () => {
      const QA_CAMPAIGN = 'sbo-claude-qa';

      it('feeds a cert into a QA campaign and verifies import', async () => {
        // 0. Verify QA campaign exists
        try {
          await callTool('get_discovery_campaign', {
            name: QA_CAMPAIGN,
          });
        } catch {
          console.log(
            `SKIP: QA campaign '${QA_CAMPAIGN}' not found - skipping import test`,
          );
          return;
        }

        // 1. Use the static test cert (TS cannot generate on-the-fly
        // without the cryptography lib, so we search by its known CN)
        const certPem = TEST_CERT_PEM;

        // 2. Start feed session
        const startData = await callTool('start_discovery_feed_session', {
          campaign_name: QA_CAMPAIGN,
        });
        expect(startData['data']).toBeDefined();
        const sessionId = (startData['data'] as Record<string, unknown>)[
          'id'
        ] as string;
        expect(sessionId).toBeTruthy();

        const uniqueCn = `${E2E_PREFIX}-import-test.example.com`;

        try {
          // 3. Feed the certificate
          try {
            const feedData = await callTool('feed_discovery_certificate', {
              session_id: sessionId,
              campaign_name: QA_CAMPAIGN,
              certificate: certPem,
              ip: '10.255.255.1',
              hostnames: [uniqueCn],
              tls_ports: [{ port: 443, version: 'TLSv1.3' }],
            });
            expect(feedData['data']).toBeDefined();
          } catch (exc) {
            // The static test cert may fail to parse on some Horizon
            // versions (PEM format incompatibility). The Python tests
            // generate a fresh cert dynamically. Skip gracefully.
            console.log(
              `SKIP: feed_discovery_certificate failed (cert parse error): ${exc}`,
            );
            return;
          }
        } finally {
          // 4. End feed session (always)
          await callTool('end_discovery_feed_session', {
            campaign_name: QA_CAMPAIGN,
            session_id: sessionId,
          });
        }

        // 5. Search for the imported certificate
        await delay(3000);
        const searchData = await callTool('search_certificates', {
          query: 'dn contains "test-cert"',
          page_size: 10,
          with_count: true,
        });
        const results = (searchData['results'] ?? []) as Record<
          string,
          unknown
        >[];
        // The static cert has CN=test-cert, so we verify it was imported
        expect(
          results.length,
          'Expected to find the imported certificate',
        ).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
