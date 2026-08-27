/**
 * Audit event tools.
 *
 * 3 MCP tools:
 *   - search_events
 *   - get_event
 *   - export_events_csv
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  CSV_EXPORT_OUTPUT_SCHEMA,
  SEARCH_RESPONSE_OUTPUT_SCHEMA,
  buildSearchPayload,
  buildSearchResponse,
  encodePathSegment,
} from '../helpers.js';
import { registerTool } from '../register.js';
import { exportEventsCsvFromSearch } from './event-csv.js';

const SEARCH_EVENTS_CONFIG = {
  description:
    'Search audit events with HEQL. Lowercase fields only (code, timestamp, ' +
    'detail.*). Operators: equals, before, after, and/or/not. ' +
    'Full reference: horizon://knowledge/query-languages. ' +
    'Sortable: _id, code, module, node, timestamp, removeAt, status. ' +
    'Pagination: page_index is 0-based; use next_page_index from the previous ' +
    'response; stop when has_more is false. Pass sorted_by for stable order.',
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
  outputSchema: SEARCH_RESPONSE_OUTPUT_SCHEMA,
};

const GET_EVENT_CONFIG = {
  description:
    'Get full details of an audit event by ID.\n\n' +
    'Returns the complete event record including actor, action, target\n' +
    'object, timestamp, and any associated metadata.',
  inputSchema: z.object({
    event_id: z.string().describe('Event ID.'),
  }),
};

const EXPORT_EVENTS_CSV_CONFIG = {
  description:
    'Export audit events matching an HEQL query as CSV (max 1000 rows via ' +
    'paged search; use Horizon UI for full raw exports). Default columns: ' +
    '_id, code, module, node, timestamp, status; pass fields for detail.* ' +
    'columns. HEQL query fields are lowercase; the CSV `fields` columns are ' +
    'camelCase (see the fields param). ' +
    'Full reference: horizon://knowledge/query-languages.',
  inputSchema: z.object({
    query: z.string().describe('HEQL query expression.'),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'CSV columns to include, as camelCase API column names (SearchResult ' +
          'columns) - NOT the lowercase HEQL query fields. Examples: code, ' +
          'module, timestamp, status, plus detail.<key> for detail columns ' +
          '(detail.actorId, detail.ip). Invalid names return a Horizon 500 ' +
          'that lists the usable columns.',
      ),
    sorted_by: z
      .string()
      .optional()
      .describe("Sort field, e.g. 'timestamp:Desc'."),
  }),
  outputSchema: CSV_EXPORT_OUTPUT_SCHEMA,
};

export function registerEventTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'search_events',
    SEARCH_EVENTS_CONFIG,
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
        structuredContent: response,
      };
    },
  );

  registerTool(server, 'get_event', GET_EVENT_CONFIG, async ({ event_id }) => {
    const result = await client.get(
      `/api/v1/events/${encodePathSegment(event_id)}`,
    );
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  });

  registerTool(
    server,
    'export_events_csv',
    EXPORT_EVENTS_CSV_CONFIG,
    async ({ query, fields, sorted_by }) => {
      const payloadOut = await exportEventsCsvFromSearch(
        client,
        query,
        fields,
        sorted_by,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payloadOut),
          },
        ],
        structuredContent: payloadOut as unknown as Record<string, unknown>,
      };
    },
  );
}
