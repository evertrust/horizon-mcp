/** ACME order tools (Horizon 2.11+): list the orders of an account, get one order. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { buildSearchResponse, encodePathSegment } from '../helpers.js';
import { registerTool } from '../register.js';
import {
  ACME_VERSION_NOTE,
  PAGINATION_NOTE,
  PAGINATION_SHAPE,
  buildPagedBody,
  text,
} from './common.js';

const LIST_ACME_ORDERS_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} List the orders of one ACME account: profile, ` +
    'status (pending, ready, processing, valid, invalid), identifiers, ' +
    'authorizations, challenges, and the issued certificate ID. Use ' +
    `search_acme_accounts first to find the account ID. ${PAGINATION_NOTE}` +
    '\nSafety tier: read-only',
  inputSchema: z.object({
    account_id: z
      .string()
      .min(1)
      .describe('ACME account ID (the _id field of the account).'),
    ...PAGINATION_SHAPE,
  }),
};

const GET_ACME_ORDER_CONFIG = {
  description: `${ACME_VERSION_NOTE} Get one ACME order by ID.\nSafety tier: read-only`,
  inputSchema: z.object({
    order_id: z.string().min(1).describe('ACME order ID.'),
  }),
};

export function registerAcmeOrderTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'list_acme_orders',
    LIST_ACME_ORDERS_CONFIG,
    async ({ account_id, ...paging }) => {
      const result = await client.post<Record<string, unknown>>(
        `/api/v1/acme/orders/account/${encodePathSegment(account_id)}`,
        buildPagedBody(paging),
      );
      return text(
        JSON.stringify(
          buildSearchResponse(result, paging.page_index, paging.page_size, {
            truncate: false,
          }),
        ),
      );
    },
  );

  registerTool(
    server,
    'get_acme_order',
    GET_ACME_ORDER_CONFIG,
    async ({ order_id }) =>
      text(
        JSON.stringify(
          await client.get(
            `/api/v1/acme/orders/${encodePathSegment(order_id)}`,
          ),
        ),
      ),
  );
}
