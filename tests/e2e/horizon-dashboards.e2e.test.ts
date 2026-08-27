import { describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  callTool,
  delay,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('Horizon E2E', () => {
  setupE2EStack();

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
});
