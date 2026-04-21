/**
 * Shared helpers extracted from proven tool patterns.
 * Direct ports of Python's _helpers.py + inline helpers from lifecycle.py.
 */
import { HorizonError } from '../client/errors.js';
import type { HorizonClient } from '../client/http.js';
import { toUpdatePayload } from '../models/payloads.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PAGE_SIZE = 100;
const MAX_CSV_ROWS = 1000;
const CSV_TIMEOUT = 120;

// Field-level truncation limits (search results only)
const MAX_STRING_LEN = 500;
const MAX_ARRAY_ELEMENTS = 20;
const MAX_NESTED_BYTES = 2048;

// ---------------------------------------------------------------------------
// Search presets - default field sets
// ---------------------------------------------------------------------------

export const CERT_PRESETS: Record<string, string[]> = {
  compact: [
    'dn',
    'serial',
    'profile',
    'module',
    'notAfter',
    'keyType',
    'owner',
    'team',
  ],
  diagnostic: [
    'dn',
    'serial',
    'profile',
    'module',
    'notAfter',
    'keyType',
    'owner',
    'team',
    'revocationReason',
    'triggerResults',
    'discoverydata.source',
    'discoverydata.ip',
    'discoverydata.lastSeen',
    'contactemail',
  ],
  compliance: [
    'dn',
    'serial',
    'profile',
    'module',
    'notAfter',
    'keyType',
    'owner',
    'team',
    'grade',
    'grade.details',
    'grade.score',
    'signingalgorithm',
    'keytype',
    'notBefore',
    'notAfter',
  ],
};

export const REQUEST_PRESETS: Record<string, string[]> = {
  compact: [
    'workflow',
    'status',
    'profile',
    'module',
    'requester',
    'approver',
    'registrationDate',
    'lastModificationDate',
  ],
  diagnostic: [
    'workflow',
    'status',
    'profile',
    'module',
    'requester',
    'approver',
    'registrationDate',
    'lastModificationDate',
    'certificate',
    'dn',
    'requesterComment',
    'approverComment',
  ],
  compliance: [
    'workflow',
    'status',
    'profile',
    'module',
    'requester',
    'approver',
    'registrationDate',
    'lastModificationDate',
    'dn',
    'certificateId',
  ],
};

// ---------------------------------------------------------------------------
// Safety guard
// ---------------------------------------------------------------------------

export function deleteGuard(
  name: string,
  expected: string,
  label = 'name',
): void {
  if (name !== expected) {
    throw new HorizonError(422, {
      errorCode: 'SAFETY-ECHO',
      message:
        `Safety check failed: expected_${label}='${expected}' ` +
        `does not match ${label}='${name}'.`,
      remediation: `Pass expected_${label} equal to ${label} to confirm deletion.`,
    });
  }
}

// ---------------------------------------------------------------------------
// List filtering and response building
// ---------------------------------------------------------------------------

export function applyNameFilter(
  items: Record<string, unknown>[],
  nameContains?: string,
): Record<string, unknown>[] {
  if (!nameContains) return items;
  const needle = nameContains.toLowerCase();
  return items.filter((item) => {
    const name = item['name'];
    return typeof name === 'string' && name.toLowerCase().includes(needle);
  });
}

export function buildListResponse(
  items: Record<string, unknown>[],
  maxItems: number,
  kind: string,
): string {
  const total = items.length;
  const truncated = total > maxItems;
  const sliced = items.slice(0, maxItems);
  return JSON.stringify({
    items: sliced,
    count: sliced.length,
    total_available: total,
    truncated,
    kind,
  });
}

export function buildMutateResponse(opts: {
  action: string;
  kind: string;
  name: string;
  data?: Record<string, unknown>;
  warnings?: string[];
}): string {
  const response: Record<string, unknown> = {
    status: opts.action,
    kind: opts.kind,
    name: opts.name,
  };
  if (opts.data !== undefined) response['data'] = opts.data;
  if (opts.warnings && opts.warnings.length > 0) {
    response['warnings'] = opts.warnings;
  }
  return JSON.stringify(response);
}

// ---------------------------------------------------------------------------
// GET-strip-merge-PUT cycle
// ---------------------------------------------------------------------------

export async function getStripMergePut(
  client: HorizonClient,
  getPath: string,
  putPath: string,
  domain: string,
  overrides: Record<string, unknown>,
  clearFields?: string[],
): Promise<Record<string, unknown>> {
  const current = await client.get<Record<string, unknown>>(getPath);
  const payload = toUpdatePayload(current, {
    overrides,
    clearFields,
    domain,
  });
  return client.put<Record<string, unknown>>(putPath, payload);
}

// ---------------------------------------------------------------------------
// Request action preflight
// ---------------------------------------------------------------------------

export async function preflightRequestAction(
  client: HorizonClient,
  action: string,
  requestId: string,
  permissionKey: string,
): Promise<Record<string, unknown>> {
  let request: Record<string, unknown>;
  try {
    request = await client.get<Record<string, unknown>>(
      `/api/v1/requests/${requestId}`,
    );
  } catch (err) {
    if (err instanceof HorizonError) {
      return { error: err.toToolResult() };
    }
    return { error: String(err) };
  }

  const permissions = (request['permissions'] ?? {}) as Record<string, boolean>;
  if (!permissions[permissionKey]) {
    return {
      error:
        `Permission denied: you do not have '${action}' ` +
        'permission on this request. Do NOT retry - use a ' +
        'principal with the appropriate role, or check the ' +
        "profile's authorization levels.",
      request_id: requestId,
      request_status: request['status'],
      request_workflow: request['workflow'],
      request_profile: request['profile'],
      your_permissions: permissions,
    };
  }

  const status = String(request['status'] ?? '').toLowerCase();
  if (status !== 'pending') {
    return {
      error:
        `Request is not pending (current status: '${status}'). ` +
        `Only pending requests can be ${action}d.`,
      request_id: requestId,
      request_status: status,
    };
  }

  return request;
}

// ---------------------------------------------------------------------------
// Sort/search payload builders
// ---------------------------------------------------------------------------

export function buildSortedBy(
  sortedBy?: string,
): Array<{ element: string; order: string }> | undefined {
  if (!sortedBy) return undefined;
  const parts = sortedBy.split(':', 2);
  const element = parts[0]!.trim();
  let order = parts.length > 1 ? parts[1]!.trim() : 'Asc';
  // Capitalize first letter
  order = order.charAt(0).toUpperCase() + order.slice(1);
  if (order !== 'Asc' && order !== 'Desc') order = 'Asc';
  return [{ element, order }];
}

export function toApiPageIndex(pageIndex: number): number {
  return Math.max(1, pageIndex + 1);
}

export function buildSearchPayload(
  query: string,
  fields: string[] | undefined,
  pageIndex: number,
  pageSize: number,
  sortedBy?: string,
  withCount = false,
): Record<string, unknown> {
  const cappedPageSize = Math.min(pageSize, MAX_PAGE_SIZE);
  const payload: Record<string, unknown> = {
    query,
    pageIndex: toApiPageIndex(pageIndex),
    pageSize: cappedPageSize,
  };
  if (fields && fields.length > 0) payload['fields'] = fields;
  const sorted = buildSortedBy(sortedBy);
  if (sorted) payload['sortedBy'] = sorted;
  if (withCount) payload['withCount'] = true;
  return payload;
}

export function buildExportPayload(
  query: string,
  fields?: string[],
  sortedBy?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    query,
    pageIndex: toApiPageIndex(0),
    pageSize: MAX_CSV_ROWS,
    withCount: true,
  };
  if (fields && fields.length > 0) payload['fields'] = fields;
  const sorted = buildSortedBy(sortedBy);
  if (sorted) payload['sortedBy'] = sorted;
  return payload;
}

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

export { CSV_TIMEOUT };

export function csvTruncationMetadata(csvText: string): {
  truncated: boolean;
  returned_rows: number;
  max_rows: number;
} {
  const lines = csvText.trim().split('\n');
  const rowCount = lines.length > 0 ? Math.max(0, lines.length - 1) : 0;
  return {
    truncated: rowCount >= MAX_CSV_ROWS,
    returned_rows: rowCount,
    max_rows: MAX_CSV_ROWS,
  };
}

// ---------------------------------------------------------------------------
// Field-level truncation (search results only)
// ---------------------------------------------------------------------------

function truncateValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_STRING_LEN) {
    return `${value.slice(0, MAX_STRING_LEN)}... <truncated: use get_certificate for full value>`;
  }

  if (Array.isArray(value)) {
    const total = value.length;
    const truncated = value
      .slice(0, MAX_ARRAY_ELEMENTS)
      .map((item) => truncateValue(item));
    if (total > MAX_ARRAY_ELEMENTS) {
      truncated.push(
        `<truncated: ${total} total, showing first ${MAX_ARRAY_ELEMENTS}>`,
      );
    }
    return truncated;
  }

  if (typeof value === 'object' && value !== null) {
    const serialized = JSON.stringify(value);
    if (new TextEncoder().encode(serialized).length > MAX_NESTED_BYTES) {
      return '<oversized: use get_certificate>';
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = truncateValue(v);
    }
    return result;
  }

  return value;
}

export function truncateRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = truncateValue(value);
  }
  return result;
}
