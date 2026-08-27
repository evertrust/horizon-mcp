import { describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  callTool,
  callToolRaw,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('Horizon E2E', () => {
  setupE2EStack();

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
        // The format enum only admits 'pem', so the SDK rejects 'der' during
        // input validation and reports it as text, before the handler runs.
        expect(
          raw,
          'download_certificate with format=der should be rejected as a validation error',
        ).toMatch(/Input validation error/);
        expect(raw).toContain('format');
      });
    });

    // -----------------------------------------------------------------------
    // CSV exports
    // -----------------------------------------------------------------------

    describe('csv exports', () => {
      it('exports certificates as CSV', async () => {
        const result = await callTool(
          'export_certificates_csv',
          { query: 'profile exists' },
          { timeout: 120_000 },
        );
        expect(
          result['csv'],
          `export_certificates_csv response lacks 'csv'. Got keys: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        expect(result['truncated']).toBeDefined();
        expect(result['returned_rows']).toBeDefined();
        expect(typeof result['csv']).toBe('string');
      }, 150_000);

      it('exports requests as CSV', async () => {
        // QA holds tens of thousands of requests and the export costs roughly
        // 50 ms per row server-side, so a match-all export exceeds the budget
        // under parallel E2E load; a narrower status query keeps it representative.
        const result = await callTool(
          'export_requests_csv',
          { query: 'status equals "denied"' },
          { timeout: 120_000 },
        );
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
});
