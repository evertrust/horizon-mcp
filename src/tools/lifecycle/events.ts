/**
 * Audit event tools.
 *
 * 3 MCP tools:
 *   - search_events
 *   - get_event
 *   - export_events_csv
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  buildSearchPayload,
  buildSearchResponse,
  encodePathSegment,
} from '../helpers.js';
import { registerTool } from '../register.js';
import { exportEventsCsvFromSearch } from './event-csv.js';

export function registerEventTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'search_events',
    {
      description:
        'Search audit events using HEQL query language.\n\n' +
        'Safety tier: read-only\n\n' +
        "HEQL syntax - use 'equals', 'before', 'after', NOT =, <, >.\n" +
        'IMPORTANT: HEQL field names are ALL LOWERCASE (code, timestamp, detail.* - NOT eventType, eventDate).\n' +
        'Examples:\n' +
        '  code equals "LIFECYCLE-ENROLL" and status equals "failure" and timestamp after -24h\n' +
        '  module equals "ACME" and detail.actorId equals "admin@example.com"\n' +
        'Full reference: horizon://knowledge/query-languages\n\n' +
        "sorted_by format: 'element' or 'element:Desc'.\n" +
        'Sortable elements: _id, code, module, node, timestamp, removeAt, status\n\n' +
        'Results are paginated. Events capture all certificate lifecycle actions\n' +
        'including enrollments, revocations, approvals, and configuration changes.\n\n' +
        'Pagination protocol (READ CAREFULLY):\n' +
        '  - page_index is 0-based. First page is page_index=0.\n' +
        '  - Response always includes has_more and next_page_index.\n' +
        '  - To fetch the next page: call again with page_index = next_page_index.\n' +
        '  - Stop when has_more=false or next_page_index=null.\n' +
        '  - Pass sorted_by (e.g. timestamp:Desc) for deterministic ordering across pages.\n' +
        '  - with_count=true (default) surfaces total so you know the full span.',
      inputSchema: z.object({
        query: z.string().describe('HEQL query expression.'),
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
          .describe('Results per page (max 100).'),
        sorted_by: z
          .string()
          .optional()
          .describe(
            "Sort field, e.g. 'timestamp:Desc'. Strongly recommended when paginating.",
          ),
        with_count: z
          .boolean()
          .default(true)
          .describe(
            'Include total matching count in response so has_more/next_page_index are reliable. Default true.',
          ),
      }),
    },
    async ({ query, page_index, page_size, sorted_by, with_count }) => {
      const payload = buildSearchPayload(
        query,
        undefined,
        page_index,
        page_size,
        sorted_by,
        with_count,
      );

      const result = await client.post<Record<string, unknown>>(
        '/api/v1/events/search',
        payload,
      );

      // truncate: false -- event records (details.*, client.*) must stay
      // intact, and the shared truncateRecord message names get_certificate
      // as the recovery tool, which is wrong here. Recovery path is
      // get_event.
      const response = buildSearchResponse(result, page_index, page_size, {
        truncate: false,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  registerTool(
    server,
    'get_event',
    {
      description:
        'Get full details of an audit event by ID.\n\n' +
        'Safety tier: read-only\n\n' +
        'Returns the complete event record including actor, action, target\n' +
        'object, timestamp, and any associated metadata.',
      inputSchema: z.object({
        event_id: z.string().describe('Event ID.'),
      }),
    },
    async ({ event_id }) => {
      const result = await client.get(
        `/api/v1/events/${encodePathSegment(event_id)}`,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  registerTool(
    server,
    'export_events_csv',
    {
      description:
        'Export audit events matching an HEQL query as CSV (bounded export helper).\n\n' +
        'Safety tier: read-only\n\n' +
        'Returns up to 1000 rows using paged event search so it stays reliable on busy Horizon instances. For full raw exports use the Horizon UI.\n' +
        'Default columns are _id, code, module, node, timestamp, and status. Pass fields to include specific detail.* columns.\n' +
        "HEQL syntax - use 'equals', 'before', 'after', NOT =, <, >.\n" +
        'IMPORTANT: HEQL field names are ALL LOWERCASE (code, timestamp - NOT eventType, eventDate).\n' +
        'Full reference: horizon://knowledge/query-languages',
      inputSchema: z.object({
        query: z.string().describe('HEQL query expression.'),
        fields: z
          .array(z.string())
          .optional()
          .describe('Fields to include in the CSV export.'),
        sorted_by: z
          .string()
          .optional()
          .describe("Sort field, e.g. 'timestamp:Desc'."),
      }),
    },
    async ({ query, fields, sorted_by }) => {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              await exportEventsCsvFromSearch(client, query, fields, sorted_by),
            ),
          },
        ],
      };
    },
  );
}
