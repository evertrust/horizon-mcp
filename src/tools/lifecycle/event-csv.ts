/**
 * Helpers for the export_events_csv tool: paged search fallback that
 * builds CSV from event search results, including detail.* columns.
 */
import type { HorizonClient } from '../../client/http.js';
import { CSV_TIMEOUT, buildSearchPayload } from '../helpers.js';

const EVENT_CSV_DELIMITER = ';';
const EVENT_CSV_BASE_FIELDS = [
  '_id',
  'code',
  'module',
  'node',
  'timestamp',
  'status',
] as const;
const EVENT_CSV_PAGE_SIZE = 100;
const EVENT_CSV_MAX_ROWS = 1000;

function stringifyCsvValue(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : String(value);

  if (
    text.includes(EVENT_CSV_DELIMITER) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r')
  ) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function isDetailEntry(
  value: unknown,
): value is { key?: unknown; value?: unknown } {
  return typeof value === 'object' && value !== null;
}

function getEventDetailMap(
  record: Record<string, unknown>,
): Map<string, string> {
  const detailMap = new Map<string, string>();
  const details = record['details'];
  if (!Array.isArray(details)) {
    return detailMap;
  }

  for (const detail of details) {
    if (!isDetailEntry(detail) || typeof detail.key !== 'string') {
      continue;
    }
    detailMap.set(
      detail.key,
      typeof detail.value === 'string' ? detail.value : '',
    );
  }

  return detailMap;
}

function discoverEventCsvFields(
  records: readonly Record<string, unknown>[],
  requestedFields?: string[],
): string[] {
  if (requestedFields && requestedFields.length > 0) {
    return requestedFields;
  }

  const detailFields = new Set<string>();
  for (const record of records) {
    for (const key of getEventDetailMap(record).keys()) {
      detailFields.add(`detail.${key}`);
    }
  }

  return [...EVENT_CSV_BASE_FIELDS, ...[...detailFields].sort()];
}

function getEventCsvCell(
  record: Record<string, unknown>,
  field: string,
): string {
  if (field === 'details') {
    return stringifyCsvValue(
      [...getEventDetailMap(record).entries()]
        .map(([key, value]) => `${key}:'${value}'`)
        .join(','),
    );
  }

  if (field.startsWith('detail.')) {
    return stringifyCsvValue(
      getEventDetailMap(record).get(field.slice('detail.'.length)) ?? '',
    );
  }

  const value = record[field];
  if (value instanceof Date) {
    return value.toISOString();
  }

  return stringifyCsvValue(value);
}

function buildEventSearchCsv(
  records: readonly Record<string, unknown>[],
  requestedFields?: string[],
): string {
  const fields = discoverEventCsvFields(records, requestedFields);
  const header = fields.join(EVENT_CSV_DELIMITER);
  const rows = records.map((record) =>
    fields
      .map((field) => getEventCsvCell(record, field))
      .join(EVENT_CSV_DELIMITER),
  );
  return [header, ...rows].join('\n');
}

interface EventSearchPage {
  readonly batch: readonly Record<string, unknown>[];
  readonly totalAvailable: number | undefined;
  readonly hasMore: boolean;
}

async function fetchEventPage(
  client: HorizonClient,
  query: string,
  sortedBy: string | undefined,
  pageIndex: number,
): Promise<EventSearchPage> {
  const payload = buildSearchPayload(
    query,
    undefined,
    pageIndex,
    EVENT_CSV_PAGE_SIZE,
    sortedBy,
    pageIndex === 0,
  );
  const result = await client.post<Record<string, unknown>>(
    '/api/v1/events/search',
    payload,
    { timeout: CSV_TIMEOUT },
  );
  const batch = (result['results'] ?? result['items'] ?? []) as Record<
    string,
    unknown
  >[];
  const totalAvailable =
    typeof result['count'] === 'number'
      ? (result['count'] as number)
      : undefined;
  return {
    batch,
    totalAvailable,
    hasMore: Boolean(result['hasMore']),
  };
}

export async function exportEventsCsvFromSearch(
  client: HorizonClient,
  query: string,
  fields?: string[],
  sortedBy?: string,
): Promise<{
  csv: string;
  truncated: boolean;
  returned_rows: number;
  max_rows: number;
  source: 'search_fallback';
}> {
  const records: Record<string, unknown>[] = [];
  let totalAvailable: number | undefined;
  let hasMore = false;
  const maxPages = Math.ceil(EVENT_CSV_MAX_ROWS / EVENT_CSV_PAGE_SIZE);

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await fetchEventPage(client, query, sortedBy, pageIndex);
    if (pageIndex === 0 && page.totalAvailable !== undefined) {
      totalAvailable = page.totalAvailable;
    }
    if (page.batch.length === 0) {
      hasMore = false;
      break;
    }
    const remaining = EVENT_CSV_MAX_ROWS - records.length;
    records.push(...page.batch.slice(0, remaining));
    hasMore =
      page.hasMore || records.length < (totalAvailable ?? records.length);
    if (!hasMore || records.length >= EVENT_CSV_MAX_ROWS) break;
  }

  return {
    csv: buildEventSearchCsv(records, fields),
    truncated:
      records.length >= EVENT_CSV_MAX_ROWS &&
      (hasMore || (totalAvailable ?? 0) > EVENT_CSV_MAX_ROWS),
    returned_rows: records.length,
    max_rows: EVENT_CSV_MAX_ROWS,
    source: 'search_fallback',
  };
}
