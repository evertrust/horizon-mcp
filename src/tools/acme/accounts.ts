/**
 * ACME account tools (Horizon 2.11+): search, get, status change, delete.
 *
 * Routes: POST /api/v1/acme/accounts/search (HAQL),
 * GET|DELETE /api/v1/acme/accounts/{accountId},
 * POST /api/v1/acme/accounts/{accountId}/status.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  SEARCH_RESPONSE_OUTPUT_SCHEMA,
  buildSearchResponse,
  deleteGuard,
  encodePathSegment,
} from '../helpers.js';
import { registerTool } from '../register.js';
import {
  ACME_VERSION_NOTE,
  PAGINATION_NOTE,
  PAGINATION_SHAPE,
  buildPagedBody,
  buildStatusBody,
  compromisedAtSchema,
  compromissionReasonSchema,
  text,
} from './common.js';

/** Account statuses an administrator can set (compromised_pending is server-set). */
const ACCOUNT_STATUSES = [
  'valid',
  'deactivated',
  'suspended',
  'revoked',
  'compromised',
] as const;

const accountIdSchema = z
  .string()
  .min(1)
  .describe('ACME account ID (the _id field of the account).');

const SEARCH_ACME_ACCOUNTS_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} Search ACME accounts with HAQL. Fields: id, contact, ` +
    'eab.name, status, created.at. Example: status equals "valid" and ' +
    'contact contains "example.com". Call describe_query_fields with ' +
    'query_type "haql" for operators. Omit query to list all accounts. ' +
    `${PAGINATION_NOTE}\nSafety tier: read-only`,
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('HAQL query. Omit to match every account.'),
    ...PAGINATION_SHAPE,
  }),
  outputSchema: SEARCH_RESPONSE_OUTPUT_SCHEMA,
};

const GET_ACME_ACCOUNT_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} Get one ACME account by ID: key thumbprint, public ` +
    'JWK, contacts, terms of service agreement, linked EAB, status, and ' +
    'compromise data.\nSafety tier: read-only',
  inputSchema: z.object({ account_id: accountIdSchema }),
};

const UPDATE_ACME_ACCOUNT_STATUS_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} Change the status of an ACME account. ` +
    'valid reactivates the account; deactivated and suspended block it; ' +
    'revoked is permanent. compromised is final and cannot be undone: ' +
    'Horizon revokes the certificates of the account that were issued after ' +
    'compromised_at (all of them when you omit it), with compromission_reason. ' +
    'Confirm the account and the status with the user before you call this tool.' +
    '\nSafety tier: mutating-destructive',
  inputSchema: z.object({
    account_id: accountIdSchema,
    status: z.enum(ACCOUNT_STATUSES).describe('New account status.'),
    compromised_at: compromisedAtSchema,
    compromission_reason: compromissionReasonSchema,
  }),
  annotations: { destructiveHint: true, idempotentHint: false },
};

const DELETE_ACME_ACCOUNT_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} Delete an ACME account and all its orders. ` +
    'Horizon refuses the deletion while an order is not final or a ' +
    'certificate of the account is still valid. Requires account_id ' +
    'confirmation via expected_account_id.\nSafety tier: mutating-destructive',
  inputSchema: z.object({
    account_id: accountIdSchema,
    expected_account_id: z
      .string()
      .describe('Must exactly match account_id as a deletion safeguard.'),
  }),
};

function accountPath(accountId: string): string {
  return `/api/v1/acme/accounts/${encodePathSegment(accountId)}`;
}

function registerAccountReadTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'search_acme_accounts',
    SEARCH_ACME_ACCOUNTS_CONFIG,
    async (args) => {
      const result = await client.post<Record<string, unknown>>(
        '/api/v1/acme/accounts/search',
        buildPagedBody(args),
      );
      const response = buildSearchResponse(
        result,
        args.page_index,
        args.page_size,
        { truncate: false },
      );
      return { ...text(JSON.stringify(response)), structuredContent: response };
    },
  );

  registerTool(
    server,
    'get_acme_account',
    GET_ACME_ACCOUNT_CONFIG,
    async ({ account_id }) =>
      text(JSON.stringify(await client.get(accountPath(account_id)))),
  );
}

function registerAccountMutationTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'update_acme_account_status',
    UPDATE_ACME_ACCOUNT_STATUS_CONFIG,
    async (args) => {
      const result = await client.post(
        `${accountPath(args.account_id)}/status`,
        buildStatusBody(args),
      );
      return text(JSON.stringify(result));
    },
  );

  registerTool(
    server,
    'delete_acme_account',
    DELETE_ACME_ACCOUNT_CONFIG,
    async ({ account_id, expected_account_id }) => {
      deleteGuard(account_id, expected_account_id, 'account_id');
      await client.delete(accountPath(account_id));
      return text(
        JSON.stringify({
          deleted: true,
          account_id,
          kind: 'acme_account',
        }),
      );
    },
  );
}

export function registerAcmeAccountTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerAccountReadTools(server, client);
  registerAccountMutationTools(server, client);
}
