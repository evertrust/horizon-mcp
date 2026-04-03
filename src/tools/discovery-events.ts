/**
 * Discovery event tools: search, get, and CSV export.
 *
 * 3 MCP tools for Horizon discovery events (HDQL query language):
 *   - search_discovery_events: paginated search with analytics toggle
 *   - get_discovery_event: single event by ID
 *   - export_discovery_events_csv: bounded CSV export
 *
 * Knowledge resources:
 *   - horizon://knowledge/discovery (concepts, data structures, search patterns)
 *   - horizon://knowledge/discovery-workflows (CLI commands for all scan types)
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../client/http.js';
import {
  CSV_TIMEOUT,
  buildExportPayload,
  buildSearchPayload,
  csvTruncationMetadata,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDiscoveryEventTools(
  server: McpServer,
  client: HorizonClient,
): void {
  // =======================================================================
  // Search discovery events
  // =======================================================================

  server.registerTool(
    'search_discovery_events',
    {
      description:
        'Search discovery events using HDQL query language.\n\n' +
        'Safety tier: read-only\n' +
        'Knowledge: horizon://knowledge/discovery, horizon://knowledge/discovery-workflows\n\n' +
        "HDQL syntax - use 'equals', 'before', 'after', NOT =, <, >.\n" +
        'IMPORTANT: HDQL field names are ALL LOWERCASE\n' +
        '(certificateid, sessionid, timestamp - NOT certificateId, sessionId).\n' +
        'Examples:\n' +
        '  timestamp after -24h\n' +
        '  certificateid equals "abc123"\n' +
        '  error.code equals "TIMEOUT" and client.ip contains "10.0"\n' +
        '  sessionid equals "scan-session-id"\n' +
        'Full reference: horizon://knowledge/query-languages\n\n' +
        'HDQL fields: timestamp, certificateid, sessionid, error.code, client.*\n' +
        "sorted_by format: 'element' or 'element:Desc'.",
      inputSchema: z.object({
        query: z.string().describe('HDQL query string.'),
        page_index: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Zero-based page index (default 0).'),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Results per page, max 100 (default 25).'),
        sorted_by: z
          .string()
          .optional()
          .describe("Sort specification, e.g. 'timestamp:Desc'."),
        with_count: z
          .boolean()
          .default(false)
          .describe('Include total count in response (slower).'),
        enable_analytics: z
          .boolean()
          .default(true)
          .describe('Enable analytics on the search (default true).'),
      }),
    },
    async ({
      query,
      page_index,
      page_size,
      sorted_by,
      with_count,
      enable_analytics,
    }) => {
      const payload = buildSearchPayload(
        query,
        undefined,
        page_index,
        page_size,
        sorted_by,
        with_count,
      );
      const path =
        `/api/v1/discovery/events/search` +
        `?enableAnalytics=${String(enable_analytics).toLowerCase()}`;
      const result = await client.post<Record<string, unknown>>(path, payload);

      const records = (result['results'] ?? result['items'] ?? []) as Record<
        string,
        unknown
      >[];
      const response: Record<string, unknown> = { results: records };
      if ('count' in result) response['count'] = result['count'];
      if ('hasMore' in result) response['hasMore'] = result['hasMore'];
      response['pageIndex'] = page_index;
      response['pageSize'] = Math.min(page_size, 100);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  // =======================================================================
  // Get single discovery event
  // =======================================================================

  server.registerTool(
    'get_discovery_event',
    {
      description:
        'Get full details of a discovery event by ID.\n\n' +
        'Safety tier: read-only\n' +
        'Knowledge: horizon://knowledge/discovery, horizon://knowledge/discovery-workflows\n\n' +
        'Returns the complete discovery event record including certificate ' +
        'data, session info, client details, and any error information.',
      inputSchema: z.object({
        event_id: z.string().describe('The discovery event ID.'),
      }),
    },
    async ({ event_id }) => {
      const result = await client.get(`/api/v1/discovery/events/${event_id}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // =======================================================================
  // Export discovery events as CSV
  // =======================================================================

  server.registerTool(
    'export_discovery_events_csv',
    {
      description:
        'Export discovery events matching an HDQL query as CSV.\n\n' +
        'Safety tier: read-only\n' +
        'Knowledge: horizon://knowledge/discovery, horizon://knowledge/discovery-workflows\n\n' +
        'Returns up to 1000 rows. For full exports use Horizon UI.\n\n' +
        "HDQL syntax - use 'equals', 'before', 'after', NOT =, <, >.\n" +
        'IMPORTANT: HDQL field names are ALL LOWERCASE (certificateid, sessionid - NOT certificateId, sessionId).\n' +
        'Example: timestamp after -7d and error.code equals "TIMEOUT"\n' +
        'Full reference: horizon://knowledge/query-languages',
      inputSchema: z.object({
        query: z.string().describe('HDQL query string.'),
        fields: z
          .array(z.string())
          .optional()
          .describe('Specific fields to include in the CSV columns.'),
        sorted_by: z
          .string()
          .optional()
          .describe("Sort specification, e.g. 'timestamp:Desc'."),
        enable_analytics: z
          .boolean()
          .default(true)
          .describe('Enable analytics on the export (default true).'),
      }),
    },
    async ({ query, fields, sorted_by, enable_analytics }) => {
      const payload = buildExportPayload(query, fields, sorted_by);
      const path =
        `/api/v1/discovery/events/csv` +
        `?enableAnalytics=${String(enable_analytics).toLowerCase()}`;
      const csvText = await client.postText(path, payload, {
        timeout: CSV_TIMEOUT,
      });

      const metadata = csvTruncationMetadata(csvText);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ csv: csvText, ...metadata }),
          },
        ],
      };
    },
  );
}
