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
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../client/http.js';
import {
  CSV_EXPORT_OUTPUT_SCHEMA,
  CSV_TIMEOUT,
  SEARCH_RESPONSE_OUTPUT_SCHEMA,
  buildExportPayload,
  buildSearchPayload,
  buildSearchResponse,
  csvTruncationMetadata,
  encodePathSegment,
} from './helpers.js';
import { registerTool } from './register.js';

const SEARCH_DISCOVERY_EVENTS_CONFIG = {
  description:
    'Search discovery events with HDQL. Lowercase fields (certificateid, ' +
    'sessionid, timestamp, error.code, client.*). Operators: equals, before, ' +
    'after, contains, and/or/not. ' +
    'Full reference: horizon://knowledge/query-languages. ' +
    'Pagination: page_index is 0-based; use next_page_index from the previous ' +
    'response; stop when has_more is false. Pass sorted_by for stable order.',
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
  outputSchema: SEARCH_RESPONSE_OUTPUT_SCHEMA,
};

const GET_DISCOVERY_EVENT_CONFIG = {
  description:
    'Get full details of a discovery event by ID.\n\n' +
    'Returns the complete discovery event record including certificate ' +
    'data, session info, client details, and any error information.',
  inputSchema: z.object({
    event_id: z.string().describe('The discovery event ID.'),
  }),
};

const EXPORT_DISCOVERY_EVENTS_CSV_CONFIG = {
  description:
    'Export discovery events matching an HDQL query as CSV (max 1000 rows; ' +
    'use Horizon UI for full exports). Lowercase fields only. ' +
    'Full reference: horizon://knowledge/query-languages.',
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
  outputSchema: CSV_EXPORT_OUTPUT_SCHEMA,
};

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
    SEARCH_DISCOVERY_EVENTS_CONFIG,
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
        structuredContent: response,
      };
    },
  );

  // =======================================================================
  // Get single discovery event
  // =======================================================================

  registerTool(
    server,
    'get_discovery_event',
    GET_DISCOVERY_EVENT_CONFIG,
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
    EXPORT_DISCOVERY_EVENTS_CSV_CONFIG,
    async ({ query, fields, sorted_by, enable_analytics }) => {
      const payload = buildExportPayload(query, fields, sorted_by);
      const path =
        `/api/v1/discovery/events/csv` +
        `?enableAnalytics=${String(enable_analytics).toLowerCase()}`;
      const csvText = await client.postText(path, payload, {
        timeout: CSV_TIMEOUT,
      });

      const metadata = csvTruncationMetadata(csvText);
      const payloadOut = { csv: csvText, ...metadata };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payloadOut),
          },
        ],
        structuredContent: payloadOut,
      };
    },
  );
}
