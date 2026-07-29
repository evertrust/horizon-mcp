import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../client/http.js';
import { normalizeItems } from './datasources/shared.js';
import {
  applyNameFilter,
  buildListResponse,
  encodePathSegment,
} from './helpers.js';
import { registerTool } from './register.js';

const PROFILE_BASE = '/api/v1/certificate/profiles';

const LIST_PROFILES_CONFIG = {
  description:
    'List certificate profiles with optional filtering.\n\n Ref: horizon://knowledge/profiles.' +
    'Client-side filtering is applied after fetching all profiles. ' +
    'Use name_contains for substring search and module for exact module type matching.',
  inputSchema: z.object({
    max_items: z
      .number()
      .int()
      .positive()
      .max(100)
      .default(50)
      .describe('Maximum number of profiles to return (default 50).'),
    name_contains: z
      .string()
      .optional()
      .describe('Case-insensitive substring filter on profile name.'),
    module: z
      .string()
      .optional()
      .describe('Filter by module type (webra, acme, scep, est, monitored).'),
  }),
};

const GET_PROFILE_CONFIG = {
  description:
    'Get full details of a single certificate profile by name.\n\n Ref: horizon://knowledge/profiles.',
  inputSchema: z.object({
    name: z.string().describe('Exact profile name.'),
  }),
};

function applyModuleFilter(
  items: Record<string, unknown>[],
  module?: string,
): Record<string, unknown>[] {
  if (!module) return items;
  const needle = module.toLowerCase();
  return items.filter((item) => {
    const m = item['module'];
    return typeof m === 'string' && m.toLowerCase() === needle;
  });
}

export function registerProfileTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'list_profiles',
    LIST_PROFILES_CONFIG,
    async ({ max_items, name_contains, module }) => {
      const data = await client.get<unknown>(PROFILE_BASE);
      let items = normalizeItems(data);
      items = applyNameFilter(items, name_contains);
      items = applyModuleFilter(items, module);
      return {
        content: [
          {
            type: 'text' as const,
            text: buildListResponse(items, max_items, 'profile'),
          },
        ],
      };
    },
  );

  registerTool(server, 'get_profile', GET_PROFILE_CONFIG, async ({ name }) => {
    const result = await client.get(
      `${PROFILE_BASE}/${encodePathSegment(name)}`,
    );
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  });
}
