/**
 * Shared schemas and helpers for the ACME management tools (Horizon 2.11+).
 * Shapes follow the public Horizon 2.11 OpenAPI.
 */
import { z } from 'zod';

import { buildSortedBy, toApiPageIndex } from '../helpers.js';

export const ACME_VERSION_NOTE = 'Horizon 2.11+.';

/** Public RevocationReason values. */
export const REVOCATION_REASONS = [
  'unspecified',
  'keycompromise',
  'cacompromise',
  'affiliationchange',
  'superseded',
  'cessationofoperation',
] as const;

/** Public AcmeAuthorizationType values. */
export const VALIDATION_METHODS = ['http-01', 'dns-01', 'tls-alpn-01'] as const;

/** Public ExternalAccountBindingAlgorithm values. */
export const MAC_KEY_ALGORITHMS = ['HS256', 'HS384', 'HS512'] as const;

/** Public FiniteDuration pattern. */
const FINITE_DURATION_RE =
  /^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$/;

export const finiteDurationSchema = z
  .string()
  .regex(FINITE_DURATION_RE, 'Use a duration such as "90 days" or "12h".');

export const ONE_TIME_SECRET_WARNING =
  'macKey and macKeyId are one-time secrets. Give them to the user now and ' +
  'tell them to store them in a safe place. Horizon will not show them again. ' +
  'If they are lost, renew the EAB to get a new MAC key.';

export const compromisedAtSchema = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe(
    'Only for status "compromised". Unix epoch time in milliseconds. ' +
      'Certificates issued after this date are revoked.',
  );

export const compromissionReasonSchema = z
  .enum(REVOCATION_REASONS)
  .optional()
  .describe(
    'Only for status "compromised". Revocation reason applied to the revoked certificates.',
  );

export function buildStatusBody(args: {
  status: string;
  compromised_at?: number;
  compromission_reason?: string;
}): Record<string, unknown> {
  return {
    status: args.status,
    ...(args.compromised_at !== undefined && {
      compromisedAt: args.compromised_at,
    }),
    ...(args.compromission_reason !== undefined && {
      compromissionReason: args.compromission_reason,
    }),
  };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const PAGINATION_SHAPE = {
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
    .describe("Sort specification 'field:Asc' or 'field:Desc'."),
  with_count: z
    .boolean()
    .default(true)
    .describe(
      'Include the total matching count so has_more and next_page_index are reliable. Default true.',
    ),
};

export const PAGINATION_NOTE =
  'Pagination: page_index is 0-based; use next_page_index from the previous ' +
  'response; stop when has_more is false.';

export function buildPagedBody(args: {
  query?: string;
  page_index: number;
  page_size: number;
  sorted_by?: string;
  with_count: boolean;
}): Record<string, unknown> {
  const sortedBy = buildSortedBy(args.sorted_by);
  return {
    ...(args.query ? { query: args.query } : {}),
    pageIndex: toApiPageIndex(args.page_index),
    pageSize: args.page_size,
    ...(sortedBy !== undefined && { sortedBy }),
    ...(args.with_count && { withCount: true }),
  };
}

export const text = (s: string) => ({
  content: [{ type: 'text' as const, text: s }],
});
