/**
 * Read-only datasource tools: list_datasources and get_datasource.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { applyNameFilter, buildListResponse } from '../helpers.js';
import { encodePathSegment } from '../helpers.js';
import { registerTool } from '../register.js';
import {
  DS_BASE,
  MAX_LIST_ITEMS,
  applyTypeFilter,
  normalizeItems,
  validateDsType,
} from './shared.js';

export function registerReadDatasourceTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'list_datasources',
    {
      description:
        'List external datasources with optional filtering.\n\n Ref: horizon://knowledge/datasources.' +
        'Safety tier: read-only\n' +
        'create_rest_datasource, test_datasource.',
      inputSchema: z.object({
        max_items: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(MAX_LIST_ITEMS)
          .describe('Maximum items to return (default 50).'),
        name_contains: z
          .string()
          .optional()
          .describe('Case-insensitive substring filter on datasource name.'),
        ds_type: z
          .string()
          .optional()
          .describe('Filter by datasource type: "dns", "ldap", or "rest".'),
      }),
    },
    async ({ max_items, name_contains, ds_type }) => {
      if (ds_type !== undefined) {
        const err = validateDsType(ds_type);
        if (err !== undefined) {
          return { content: [{ type: 'text' as const, text: err }] };
        }
      }

      const data = await client.get<unknown>(DS_BASE);
      let items = normalizeItems(data);
      items = applyTypeFilter(items, ds_type);
      items = applyNameFilter(items, name_contains);
      return {
        content: [
          {
            type: 'text' as const,
            text: buildListResponse(items, max_items, 'datasource'),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'get_datasource',
    {
      description:
        'Get a single datasource by name.\n\n Ref: horizon://knowledge/datasources.' +
        'Safety tier: read-only\n',
      inputSchema: z.object({
        name: z.string().describe('Exact datasource name.'),
      }),
    },
    async ({ name }) => {
      const result = await client.get(`${DS_BASE}/${encodePathSegment(name)}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
