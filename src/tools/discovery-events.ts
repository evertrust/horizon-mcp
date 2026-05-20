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
  buildSearchResponse,
  csvTruncationMetadata,
  encodePathSegment,
} from './helpers.js';
import { registerTool } from './register.js';

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

  registerTool(
    server,
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
        "sorted_by format: 'element' or 'element:Desc'.\n\n" +
        'Pagination protocol (READ CAREFULLY):\n' +
        '  - page_index is 0-based. First page is page_index=0.\n' +
        '  - Response always includes has_more and next_page_index.\n' +
        '  - To fetch the next page: call again with page_index = next_page_index.\n' +
        '  - Stop when has_more=false or next_page_index=null.\n' +
        '  - Pass sorted_by (e.g. timestamp:Desc) for deterministic ordering.\n' +
        '  - with_count=true (default) surfaces total for up-front sizing.',
      inputSchema: z.object({
        query: z.string().describe('HDQL query string.'),
        page_index: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe(
            'Page index (0-based). Use next_page_index from the previous response to paginate.',
          ),
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
          .describe(
            "Sort specification, e.g. 'timestamp:Desc'. Strongly recommended when paginating.",
          ),
        with_count: z
          .boolean()
          .default(true)
          .describe(
            'Include total matching count in response so has_more/next_page_index are reliable. Default true.',
          ),
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

      // truncate: false -- same reasoning as search_events. The shared
      // truncation hint names get_certificate; the correct recovery tool
      // for discovery events is get_discovery_event.
      const response = buildSearchResponse(result, page_index, page_size, {
        truncate: false,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  // =======================================================================
  // Get single discovery event
  // =======================================================================

  registerTool(
    server,
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
      const result = await client.get(
        `/api/v1/discovery/events/${encodePathSegment(event_id)}`,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // =======================================================================
  // Export discovery events as CSV
  // =======================================================================

  registerTool(
    server,
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
