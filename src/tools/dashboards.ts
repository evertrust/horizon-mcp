/**
 * Dashboard and saved query tools for Horizon MCP Server.
 *
 * 12 tools covering:
 *   - Dashboards (5): list, get, create, update, delete
 *   - Chart-level operations (3): add, update, remove
 *   - Saved queries (4): list, get, upsert, delete
 *
 * Dashboards are personal/principal-scoped, embedded in PrincipalInfo.
 * No _id field, no STRIP_FIELDS needed - the full object round-trips as-is.
 * HTTP 204 from Horizon means "empty collection", not an error.
 *
 * Knowledge resources:
 *     - horizon://knowledge/dashboards
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { HorizonError } from '../client/errors.js';
import type { HorizonClient } from '../client/http.js';
import {
  applyNameFilter,
  buildListResponse,
  buildMutateResponse,
  deleteGuard,
  encodePathSegment,
} from './helpers.js';
import { registerTool } from './register.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DASHBOARD_BASE = '/api/v1/security/principals/dashboards';
const QUERY_BASE = '/api/v1/security/principals/queries';

const DASHBOARD_TYPES = ['certificate', 'request'] as const;
const QUERY_TYPES = ['hcql', 'hrql', 'heql', 'hdql', 'hpql'] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emptyListResponse(kind: string): string {
  return JSON.stringify({
    items: [],
    count: 0,
    total_available: 0,
    truncated: false,
    kind,
  });
}

function findChartIndex(
  charts: Record<string, unknown>[],
  chartId: string,
): number {
  return charts.findIndex((chart) => chart['i'] === chartId);
}

async function fetchDashboardByName(
  client: HorizonClient,
  name: string,
): Promise<Record<string, unknown>> {
  const principal = await client.get<Record<string, unknown>>(
    '/api/v1/security/principals/self',
  );

  const dashboards = (principal['customDashboards'] ?? []) as Record<
    string,
    unknown
  >[];

  if (dashboards.length === 0) {
    throw new HorizonError(404, {
      message: `Dashboard '${name}' not found (no dashboards exist).`,
      remediation: 'Use create_dashboard to create one.',
    });
  }

  const match = dashboards.find((d) => d['name'] === name);
  if (match) return match;

  const available = dashboards.map((d) =>
    typeof d['name'] === 'string' ? d['name'] : '?',
  );
  throw new HorizonError(404, {
    message: `Dashboard '${name}' not found.`,
    detail: `Available dashboards: ${JSON.stringify(available)}`,
    remediation: 'Use list_dashboards to see available dashboards.',
  });
}

// ---------------------------------------------------------------------------
// Tool result helper
// ---------------------------------------------------------------------------

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDashboardTools(
  server: McpServer,
  client: HorizonClient,
): void {
  // =======================================================================
  // Dashboard CRUD (5 tools)
  // =======================================================================

  registerTool(
    server,
    'list_dashboards',
    {
      description:
        'List personal dashboards with optional filtering.\n\n' +
        'Safety tier: read-only\n' +
        'Knowledge: horizon://knowledge/dashboards\n\n' +
        'Returns JSON with items, count, total_available, and truncated flag.',
      inputSchema: z.object({
        max_items: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(50)
          .describe('Maximum items to return (default 50).'),
        name_contains: z
          .string()
          .optional()
          .describe('Case-insensitive substring filter on dashboard name.'),
        dashboard_type: z
          .enum(DASHBOARD_TYPES)
          .optional()
          .describe('Filter by type - "certificate" or "request".'),
      }),
    },
    async ({ max_items, name_contains, dashboard_type }) => {
      const principal = await client.get<Record<string, unknown>>(
        '/api/v1/security/principals/self',
      );
      const data = (principal['customDashboards'] ?? []) as Record<
        string,
        unknown
      >[];

      if (data.length === 0) {
        return textResult(emptyListResponse('dashboard'));
      }

      let items = data;
      if (dashboard_type) {
        items = items.filter((d) => d['type'] === dashboard_type);
      }
      items = applyNameFilter(items, name_contains);
      return textResult(buildListResponse(items, max_items, 'dashboard'));
    },
  );

  registerTool(
    server,
    'get_dashboard',
    {
      description:
        'Get a single dashboard by name.\n\n' +
        'Safety tier: read-only\n' +
        'Knowledge: horizon://knowledge/dashboards\n\n' +
        'Returns JSON representation of the dashboard including its charts.',
      inputSchema: z.object({
        name: z.string().describe('Exact dashboard name.'),
      }),
    },
    async ({ name }) => {
      const result = await fetchDashboardByName(client, name);
      return textResult(JSON.stringify(result));
    },
  );

  registerTool(
    server,
    'create_dashboard',
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit ' +
        'confirmation before calling this tool. Do not proceed without a clear ' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Create a new personal dashboard.\n\n' +
        'Safety tier: mutating-safe\n' +
        'Knowledge: horizon://knowledge/dashboards\n\n' +
        'IMPORTANT - The dashboard name is IMMUTABLE: it CANNOT be changed ' +
        'after creation. You MUST ask the user for the name (and optionally ' +
        'a description) before calling this tool. Never invent a name on the ' +
        "user's behalf.\n\n" +
        'Dashboard Creation Workflow (recommended):\n' +
        '1) Ask the user for the dashboard name and optional description\n' +
        '2) Create a blank dashboard with charts=[]\n' +
        '3) Use add_dashboard_chart to add charts one at a time, ' +
        "prompting the user for each chart's configuration.\n\n" +
        'See also: add_dashboard_chart (add charts one by one after creation), ' +
        'upsert_saved_query (save queries for reuse in charts).',
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            'Unique dashboard name (IMMUTABLE - cannot be renamed later).',
          ),
        dashboard_type: z
          .enum(DASHBOARD_TYPES)
          .describe('Dashboard scope - "certificate" or "request".'),
        charts: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'List of chart objects (default: empty list for blank dashboard). ' +
              'Each chart: {"type": "donut", "title": "My Chart", ' +
              '"localQuery": "status is valid", "fields": ["keyType"], ' +
              '"i": "1", "x": 0, "y": 0, "w": 6, "h": 4}. ' +
              'Recommended: start with charts=[] and use add_dashboard_chart interactively.',
          ),
        description: z
          .string()
          .optional()
          .describe('Optional human-readable description.'),
      }),
    },
    async ({ name, dashboard_type, charts, description }) => {
      const payload: Record<string, unknown> = {
        name,
        type: dashboard_type,
        charts: charts ?? [],
      };
      if (description !== undefined) {
        payload['description'] = description;
      }

      const result = await client.post<Record<string, unknown>>(
        DASHBOARD_BASE,
        payload,
      );
      return textResult(
        buildMutateResponse({
          action: 'created',
          kind: 'dashboard',
          name,
          data: result,
        }),
      );
    },
  );

  registerTool(
    server,
    'update_dashboard',
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit ' +
        'confirmation before calling this tool. Do not proceed without a clear ' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Update an existing dashboard (GET -> merge -> PUT).\n\n' +
        'Safety tier: mutating-safe\n' +
        'Knowledge: horizon://knowledge/dashboards\n\n' +
        'Fetches the current dashboard, merges provided overrides, and ' +
        'PUTs the full object back. No field stripping needed - dashboards ' +
        'are principal-scoped with no server-injected metadata.',
      inputSchema: z.object({
        name: z.string().describe('Dashboard name to update.'),
        charts: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe('New charts list (replaces existing).'),
        description: z.string().optional().describe('New description.'),
        clear_fields: z
          .array(z.string())
          .optional()
          .describe('Top-level field names to explicitly set to null.'),
      }),
    },
    async ({ name, charts, description, clear_fields }) => {
      const existing = await fetchDashboardByName(client, name);

      // Build an immutable merged payload
      const merged: Record<string, unknown> = { ...existing };
      if (charts !== undefined) {
        merged['charts'] = charts;
      }
      if (description !== undefined) {
        merged['description'] = description;
      }
      for (const field of clear_fields ?? []) {
        merged[field] = null;
      }

      const result = await client.put<Record<string, unknown>>(
        DASHBOARD_BASE,
        merged,
      );
      return textResult(
        buildMutateResponse({
          action: 'updated',
          kind: 'dashboard',
          name,
          data: result,
        }),
      );
    },
  );

  registerTool(
    server,
    'delete_dashboard',
    {
      description:
        'STOP - This tool performs an IRREVERSIBLE destructive operation. You MUST ' +
        'ask the user for explicit confirmation before calling this tool. Do not ' +
        'proceed without a clear "yes" from the user. Present what will be ' +
        'permanently destroyed and wait.\n\n' +
        'Delete a dashboard. Requires name confirmation.\n\n' +
        'Safety tier: mutating-destructive\n' +
        'Knowledge: horizon://knowledge/dashboards',
      inputSchema: z.object({
        name: z.string().describe('Dashboard name to delete.'),
        expected_name: z
          .string()
          .describe('Must exactly match name as a deletion safeguard.'),
      }),
    },
    async ({ name, expected_name }) => {
      deleteGuard(name, expected_name);
      await client.delete(`${DASHBOARD_BASE}/${encodePathSegment(name)}`);
      return textResult(
        JSON.stringify({ deleted: true, name, kind: 'dashboard' }),
      );
    },
  );

  // =======================================================================
  // Chart-level operations (3 tools)
  // =======================================================================

  registerTool(
    server,
    'add_dashboard_chart',
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit ' +
        'confirmation before calling this tool. Do not proceed without a clear ' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Add a chart to an existing dashboard.\n\n' +
        'Safety tier: mutating-safe\n' +
        'Knowledge: horizon://knowledge/dashboards\n\n' +
        'Prerequisites: Dashboard must exist (use create_dashboard first).\n\n' +
        'Fetches the dashboard, appends the chart to its charts list, ' +
        'and PUTs the updated dashboard back. Auto-generates a unique ' +
        'chart identifier if the chart does not already include one.',
      inputSchema: z.object({
        dashboard_name: z.string().describe('Name of the dashboard to modify.'),
        chart: z
          .record(z.string(), z.unknown())
          .describe(
            'Chart configuration object. Required fields: ' +
              '{"type": "donut", "title": "My Chart", ' +
              '"localQuery": "status is valid", "fields": ["keyType"]}. ' +
              'Valid chart types: area, donut, heatmap, bar-horizontal, ' +
              'line, metric, pie, polar, pyramid, radar, table, treemap, ' +
              'bar-vertical. ' +
              'Optional layout: "x", "y", "w", "h", "i" (grid position/size/id). ' +
              'Optional: "limit" (max buckets), "sortOrder" ("Asc"|"Desc"|"KeyAsc"|"KeyDesc"), ' +
              '"direction" ("asc"|"desc"), "colors" (["#A6ADF7", "#4D54A2", ...]), ' +
              '"log" (boolean - logarithmic scale), "description" (string).',
          ),
      }),
    },
    async ({ dashboard_name, chart }) => {
      // Auto-generate chart ID if not provided
      const chartWithId: Record<string, unknown> = { ...chart };
      chartWithId['i'] ??= `chart-${randomUUID().slice(0, 8)}`;
      const chartId = chartWithId['i'] as string;

      const existing = await fetchDashboardByName(client, dashboard_name);
      const charts = [
        ...((existing['charts'] ?? []) as Record<string, unknown>[]),
        chartWithId,
      ];
      const merged: Record<string, unknown> = { ...existing, charts };

      const result = await client.put<Record<string, unknown>>(
        DASHBOARD_BASE,
        merged,
      );
      return textResult(
        JSON.stringify({ chart_id: chartId, dashboard: result }),
      );
    },
  );

  registerTool(
    server,
    'update_dashboard_chart',
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit ' +
        'confirmation before calling this tool. Do not proceed without a clear ' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Update a single chart within a dashboard.\n\n' +
        'Safety tier: mutating-safe\n' +
        'Knowledge: horizon://knowledge/dashboards\n\n' +
        'Fetches the dashboard, locates the chart by its identifier, ' +
        'merges only the provided fields, and PUTs the dashboard back.',
      inputSchema: z.object({
        dashboard_name: z
          .string()
          .describe('Name of the dashboard containing the chart.'),
        chart_id: z
          .string()
          .describe('Unique chart identifier (the "i" field).'),
        title: z.string().optional().describe('New chart title.'),
        chart_type: z
          .string()
          .optional()
          .describe(
            'Chart type - area, donut, heatmap, bar-horizontal, ' +
              'line, metric, pie, polar, pyramid, radar, table, treemap, ' +
              'or bar-vertical.',
          ),
        local_query: z
          .string()
          .optional()
          .describe('New HQL query string for chart data.'),
        fields: z
          .array(z.string())
          .optional()
          .describe('New list of aggregation/group-by fields.'),
        limit: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Max buckets returned (>= 0).'),
        having: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Post-aggregation filter, e.g. {"operator": "gte", "value": 10}.',
          ),
        sort_order: z
          .string()
          .optional()
          .describe('Data sort - "Asc", "Desc", "KeyAsc", or "KeyDesc".'),
        direction: z
          .string()
          .optional()
          .describe('Visual rendering direction - "asc" or "desc".'),
        colors: z
          .array(z.string())
          .optional()
          .describe('List of hex color codes, e.g. ["#A6ADF7", "#4D54A2"].'),
        description: z.string().optional().describe('New chart description.'),
        x: z
          .number()
          .int()
          .min(0)
          .max(11)
          .optional()
          .describe('Grid x position (0-11).'),
        y: z.number().int().min(0).optional().describe('Grid y position.'),
        w: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe('Grid column span (1-12).'),
        h: z.number().int().min(1).optional().describe('Grid row span.'),
        logarithmic: z
          .boolean()
          .optional()
          .describe(
            'Enable logarithmic scale on value axis (API field: "log").',
          ),
        clear_fields: z
          .array(z.string())
          .optional()
          .describe('Chart field names to explicitly set to null.'),
      }),
    },
    async ({
      dashboard_name,
      chart_id,
      title,
      chart_type,
      local_query,
      fields,
      limit,
      having,
      sort_order,
      direction,
      colors,
      description,
      x,
      y,
      w,
      h,
      logarithmic,
      clear_fields,
    }) => {
      const existing = await fetchDashboardByName(client, dashboard_name);
      const charts = [
        ...((existing['charts'] ?? []) as Record<string, unknown>[]),
      ];
      const idx = findChartIndex(charts, chart_id);

      if (idx === -1) {
        return textResult(
          JSON.stringify({
            error: `Chart '${chart_id}' not found in dashboard '${dashboard_name}'.`,
            hint: 'Use get_dashboard to see available chart identifiers.',
          }),
        );
      }

      // Merge provided overrides into an immutable copy of the chart
      // Maps parameter names to API field names
      const fieldMap: Record<string, string> = {
        title: 'title',
        chart_type: 'type',
        local_query: 'localQuery',
        fields: 'fields',
        limit: 'limit',
        having: 'having',
        sort_order: 'sortOrder',
        direction: 'direction',
        colors: 'colors',
        description: 'description',
        x: 'x',
        y: 'y',
        w: 'w',
        h: 'h',
        logarithmic: 'log',
      };

      const paramValues: Record<string, unknown> = {
        title,
        chart_type,
        local_query,
        fields,
        limit,
        having,
        sort_order,
        direction,
        colors,
        description,
        x,
        y,
        w,
        h,
        logarithmic,
      };

      const updatedChart: Record<string, unknown> = { ...charts[idx] };
      for (const [paramName, apiKey] of Object.entries(fieldMap)) {
        const value = paramValues[paramName];
        if (value !== undefined) {
          updatedChart[apiKey] = value;
        }
      }
      for (const field of clear_fields ?? []) {
        updatedChart[field] = null;
      }

      charts[idx] = updatedChart;
      const merged: Record<string, unknown> = { ...existing, charts };

      const result = await client.put<Record<string, unknown>>(
        DASHBOARD_BASE,
        merged,
      );
      return textResult(JSON.stringify(result));
    },
  );

  registerTool(
    server,
    'remove_dashboard_chart',
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit ' +
        'confirmation before calling this tool. Do not proceed without a clear ' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Remove a chart from a dashboard.\n\n' +
        'Safety tier: mutating-safe\n' +
        'Knowledge: horizon://knowledge/dashboards\n\n' +
        'Fetches the dashboard, removes the chart matching the given ' +
        'identifier, and PUTs the updated dashboard back.',
      inputSchema: z.object({
        dashboard_name: z
          .string()
          .describe('Name of the dashboard containing the chart.'),
        chart_id: z
          .string()
          .describe('Unique chart identifier (the "i" field) to remove.'),
      }),
    },
    async ({ dashboard_name, chart_id }) => {
      const existing = await fetchDashboardByName(client, dashboard_name);
      const charts = [
        ...((existing['charts'] ?? []) as Record<string, unknown>[]),
      ];
      const idx = findChartIndex(charts, chart_id);

      if (idx === -1) {
        return textResult(
          JSON.stringify({
            error: `Chart '${chart_id}' not found in dashboard '${dashboard_name}'.`,
            hint: 'Use get_dashboard to see available chart identifiers.',
          }),
        );
      }

      const removed = charts[idx] as Record<string, unknown>;
      const filteredCharts = charts.filter((_, i) => i !== idx);
      const merged: Record<string, unknown> = {
        ...existing,
        charts: filteredCharts,
      };

      const result = await client.put<Record<string, unknown>>(
        DASHBOARD_BASE,
        merged,
      );
      return textResult(
        JSON.stringify({
          removed_chart: removed['i'],
          dashboard: result,
        }),
      );
    },
  );

  // =======================================================================
  // Saved Queries (4 tools)
  // =======================================================================

  registerTool(
    server,
    'list_saved_queries',
    {
      description:
        'List saved HQL queries with optional filtering.\n\n' +
        'Safety tier: read-only\n' +
        'Knowledge: horizon://knowledge/dashboards\n\n' +
        'Returns JSON with items, count, total_available, and truncated flag.',
      inputSchema: z.object({
        max_items: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(50)
          .describe('Maximum items to return (default 50).'),
        name_contains: z
          .string()
          .optional()
          .describe('Case-insensitive substring filter on query name.'),
        query_type: z
          .enum(QUERY_TYPES)
          .optional()
          .describe(
            'Filter by HQL language - "hcql", "hrql", "heql", "hdql", or "hpql".',
          ),
      }),
    },
    async ({ max_items, name_contains, query_type }) => {
      const params = query_type
        ? new URLSearchParams({ type: query_type })
        : undefined;

      const data = await client.get<unknown>(QUERY_BASE, params);

      if (data === null || data === undefined) {
        return textResult(emptyListResponse('saved_query'));
      }

      let items: Record<string, unknown>[] = Array.isArray(data)
        ? data
        : [data as Record<string, unknown>];
      items = applyNameFilter(items, name_contains);
      return textResult(buildListResponse(items, max_items, 'saved_query'));
    },
  );

  registerTool(
    server,
    'get_saved_query',
    {
      description:
        'Get a single saved query by name.\n\n' +
        'Safety tier: read-only\n' +
        'Knowledge: horizon://knowledge/dashboards\n\n' +
        'Returns JSON representation of the saved query.',
      inputSchema: z.object({
        name: z.string().describe('Exact saved query name.'),
      }),
    },
    async ({ name }) => {
      const result = await client.get(
        `${QUERY_BASE}/${encodePathSegment(name)}`,
      );
      return textResult(JSON.stringify(result));
    },
  );

  registerTool(
    server,
    'upsert_saved_query',
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit ' +
        'confirmation before calling this tool. Do not proceed without a clear ' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Create or update a saved HQL query.\n\n' +
        'Safety tier: mutating-safe\n' +
        'Knowledge: horizon://knowledge/dashboards\n\n' +
        'Uses upsert semantics - if a query with the given name exists it ' +
        'is updated, otherwise a new one is created. The server validates ' +
        'the HQL syntax for the specified query type.',
      inputSchema: z.object({
        name: z
          .string()
          .describe('Unique query name (acts as the upsert key).'),
        query_type: z
          .enum(QUERY_TYPES)
          .describe(
            'HQL language - "hcql", "hrql", "heql", "hdql", or "hpql".',
          ),
        query: z.string().describe('The HQL query string.'),
        description: z
          .string()
          .optional()
          .describe('Optional human-readable description.'),
      }),
    },
    async ({ name, query_type, query, description }) => {
      const payload: Record<string, unknown> = {
        name,
        type: query_type,
        query,
      };
      if (description !== undefined) {
        payload['description'] = description;
      }

      const result = await client.post<Record<string, unknown>>(
        QUERY_BASE,
        payload,
      );
      return textResult(
        buildMutateResponse({
          action: 'upserted',
          kind: 'saved_query',
          name,
          data: result,
        }),
      );
    },
  );

  registerTool(
    server,
    'delete_saved_query',
    {
      description:
        'STOP - This tool performs an IRREVERSIBLE destructive operation. You MUST ' +
        'ask the user for explicit confirmation before calling this tool. Do not ' +
        'proceed without a clear "yes" from the user. Present what will be ' +
        'permanently destroyed and wait.\n\n' +
        'Delete a saved query. Requires name confirmation.\n\n' +
        'Safety tier: mutating-destructive\n' +
        'Knowledge: horizon://knowledge/dashboards',
      inputSchema: z.object({
        name: z.string().describe('Saved query name to delete.'),
        expected_name: z
          .string()
          .describe('Must exactly match name as a deletion safeguard.'),
      }),
    },
    async ({ name, expected_name }) => {
      deleteGuard(name, expected_name);
      await client.delete(`${QUERY_BASE}/${encodePathSegment(name)}`);
      return textResult(
        JSON.stringify({ deleted: true, name, kind: 'saved_query' }),
      );
    },
  );
}
