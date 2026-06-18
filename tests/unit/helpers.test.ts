import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { HorizonError } from '../../src/client/errors.js';
import {
  applyNameFilter,
  buildExportPayload,
  buildListResponse,
  buildSearchPayload,
  buildSearchResponse,
  buildSortedBy,
  csvTruncationMetadata,
  deleteGuard,
  encodePathSegment,
  toApiPageIndex,
  truncateRecord,
} from '../../src/tools/helpers.js';
import { registerCertificateTools } from '../../src/tools/lifecycle/certificates.js';

describe('deleteGuard', () => {
  it('passes silently when names match exactly', () => {
    expect(() => deleteGuard('my-profile', 'my-profile')).not.toThrow();
  });

  it('throws HorizonError with SAFETY-ECHO when names differ', () => {
    expect(() => deleteGuard('wrong-name', 'actual-name')).toThrow(
      HorizonError,
    );
  });

  it('includes expected and actual names in the error message', () => {
    try {
      deleteGuard('wrong', 'correct');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HorizonError);
      const horizonErr = err as HorizonError;
      expect(horizonErr.errorCode).toBe('SAFETY-ECHO');
      expect(horizonErr.message).toContain("expected_name='correct'");
      expect(horizonErr.message).toContain("name='wrong'");
    }
  });

  it('uses custom label in error message', () => {
    try {
      deleteGuard('wrong', 'correct', 'identifier');
      expect.fail('should have thrown');
    } catch (err) {
      const horizonErr = err as HorizonError;
      expect(horizonErr.message).toContain("expected_identifier='correct'");
      expect(horizonErr.message).toContain("identifier='wrong'");
    }
  });

  it('is case-sensitive', () => {
    expect(() => deleteGuard('MyProfile', 'myprofile')).toThrow(HorizonError);
  });
});

describe('applyNameFilter', () => {
  const items = [
    { name: 'Production CA' },
    { name: 'Staging CA' },
    { name: 'dev-internal' },
    { name: 'PRODUCTION-BACKUP' },
  ];

  it('returns all items when nameContains is undefined', () => {
    const result = applyNameFilter(items);
    expect(result).toEqual(items);
  });

  it('filters by case-insensitive substring match', () => {
    const result = applyNameFilter(items, 'production');
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('Production CA');
    expect(result[1]!.name).toBe('PRODUCTION-BACKUP');
  });

  it('handles partial matches', () => {
    const result = applyNameFilter(items, 'CA');
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('Production CA');
    expect(result[1]!.name).toBe('Staging CA');
  });

  it('returns empty array when nothing matches', () => {
    const result = applyNameFilter(items, 'nonexistent');
    expect(result).toHaveLength(0);
  });

  it('skips items where name is not a string', () => {
    const mixed = [
      { name: 'valid' },
      { name: 123 },
      { id: 'no-name' },
    ] as Record<string, unknown>[];
    const result = applyNameFilter(mixed, 'valid');
    expect(result).toHaveLength(1);
  });

  it('is a no-op when nameContains is empty string', () => {
    // empty string is falsy, so should return all
    const result = applyNameFilter(items, '');
    expect(result).toEqual(items);
  });
});

describe('buildListResponse', () => {
  it('returns all items when under maxItems limit', () => {
    const items = [{ name: 'a' }, { name: 'b' }];
    const result = JSON.parse(buildListResponse(items, 10, 'profile'));

    expect(result.items).toHaveLength(2);
    expect(result.count).toBe(2);
    expect(result.total_available).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.kind).toBe('profile');
  });

  it('truncates when items exceed maxItems', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ name: `item-${i}` }));
    const result = JSON.parse(buildListResponse(items, 3, 'certificate'));

    expect(result.items).toHaveLength(3);
    expect(result.count).toBe(3);
    expect(result.total_available).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it('handles empty items array', () => {
    const result = JSON.parse(buildListResponse([], 10, 'trigger'));

    expect(result.items).toHaveLength(0);
    expect(result.count).toBe(0);
    expect(result.total_available).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('sets truncated to false when items equal maxItems', () => {
    const items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    const result = JSON.parse(buildListResponse(items, 3, 'role'));

    expect(result.truncated).toBe(false);
    expect(result.count).toBe(3);
  });
});

describe('buildSortedBy', () => {
  it('returns undefined when sortedBy is undefined', () => {
    expect(buildSortedBy(undefined)).toBeUndefined();
  });

  it('returns undefined when sortedBy is empty string', () => {
    expect(buildSortedBy('')).toBeUndefined();
  });

  it('parses bare field name with default Asc order', () => {
    const result = buildSortedBy('notAfter');
    expect(result).toEqual([{ element: 'notAfter', order: 'Asc' }]);
  });

  it('parses field:Asc explicitly', () => {
    const result = buildSortedBy('dn:Asc');
    expect(result).toEqual([{ element: 'dn', order: 'Asc' }]);
  });

  it('parses field:Desc', () => {
    const result = buildSortedBy('notAfter:Desc');
    expect(result).toEqual([{ element: 'notAfter', order: 'Desc' }]);
  });

  it('capitalizes lowercase order', () => {
    const result = buildSortedBy('serial:desc');
    expect(result).toEqual([{ element: 'serial', order: 'Desc' }]);
  });

  it('falls back to Asc for invalid order values', () => {
    const result = buildSortedBy('field:InvalidOrder');
    expect(result).toEqual([{ element: 'field', order: 'Asc' }]);
  });

  it('trims whitespace from element and order', () => {
    const result = buildSortedBy(' dn : Desc ');
    expect(result).toEqual([{ element: 'dn', order: 'Desc' }]);
  });
});

describe('buildSearchPayload', () => {
  it('builds basic payload with query and pagination', () => {
    const payload = buildSearchPayload('*', undefined, 0, 50);

    expect(payload.query).toBe('*');
    expect(payload.pageIndex).toBe(1);
    expect(payload.pageSize).toBe(50);
    expect(payload).not.toHaveProperty('fields');
    expect(payload).not.toHaveProperty('sortedBy');
    expect(payload).not.toHaveProperty('withCount');
  });

  it('translates the MCP page index from zero-based to Horizon one-based', () => {
    const payload = buildSearchPayload('*', undefined, 2, 25);

    expect(payload.pageIndex).toBe(3);
  });

  it('caps pageSize at 100', () => {
    const payload = buildSearchPayload('*', undefined, 0, 200);
    expect(payload.pageSize).toBe(100);
  });

  it('leaves pageSize unchanged when under 100', () => {
    const payload = buildSearchPayload('*', undefined, 0, 50);
    expect(payload.pageSize).toBe(50);
  });

  it('allows pageSize of exactly 100', () => {
    const payload = buildSearchPayload('*', undefined, 0, 100);
    expect(payload.pageSize).toBe(100);
  });

  it('includes fields when provided', () => {
    const fields = ['dn', 'serial', 'profile'];
    const payload = buildSearchPayload('*', fields, 0, 50);
    expect(payload.fields).toEqual(fields);
  });

  it('omits fields when array is empty', () => {
    const payload = buildSearchPayload('*', [], 0, 50);
    expect(payload).not.toHaveProperty('fields');
  });

  it('includes sortedBy when provided', () => {
    const payload = buildSearchPayload('*', undefined, 0, 50, 'notAfter:Desc');
    expect(payload.sortedBy).toEqual([{ element: 'notAfter', order: 'Desc' }]);
  });

  it('includes withCount when true', () => {
    const payload = buildSearchPayload('*', undefined, 0, 50, undefined, true);
    expect(payload.withCount).toBe(true);
  });

  it('omits withCount when false (default)', () => {
    const payload = buildSearchPayload('*', undefined, 0, 50);
    expect(payload).not.toHaveProperty('withCount');
  });
});

describe('toApiPageIndex', () => {
  it('converts 0-based MCP index to 1-based API index', () => {
    expect(toApiPageIndex(0)).toBe(1);
    expect(toApiPageIndex(1)).toBe(2);
    expect(toApiPageIndex(42)).toBe(43);
  });

  // Previously this function used Math.max(1, pageIndex+1) which silently
  // clamped bad input. Silent clamping masked real caller bugs and
  // contributed to hard-to-debug "same page" reports. Validate explicitly.
  it('rejects negative indices with PAGINATION-BAD-INDEX', () => {
    try {
      toApiPageIndex(-1);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HorizonError);
      expect((err as HorizonError).errorCode).toBe('PAGINATION-BAD-INDEX');
    }
  });

  it('rejects non-integer indices', () => {
    expect(() => toApiPageIndex(1.5)).toThrow(HorizonError);
    expect(() => toApiPageIndex(Number.NaN)).toThrow(HorizonError);
  });
});

describe('buildSearchResponse', () => {
  it('returns the canonical envelope shape', () => {
    const envelope = buildSearchResponse(
      { results: [{ _id: 'a' }], count: 100 },
      0,
      25,
    );

    expect(envelope).toHaveProperty('results');
    expect(envelope).toHaveProperty('page_index', 0);
    expect(envelope).toHaveProperty('page_size', 25);
    expect(envelope).toHaveProperty('total', 100);
    expect(envelope).toHaveProperty('has_more');
    expect(envelope).toHaveProperty('next_page_index');
    // Legacy camelCase names must not leak through -- mixing them with the
    // snake_case tool inputs is what confused models in the bug report.
    expect(envelope).not.toHaveProperty('pageIndex');
    expect(envelope).not.toHaveProperty('pageSize');
    expect(envelope).not.toHaveProperty('hasMore');
    expect(envelope).not.toHaveProperty('count');
  });

  it('computes has_more from total when count is present', () => {
    // 2 pages of 100 in a 187-total set -> page 0 has more, page 1 does not.
    const first = buildSearchResponse(
      { results: new Array(100).fill({ _id: 'x' }), count: 187 },
      0,
      100,
    );
    const second = buildSearchResponse(
      { results: new Array(87).fill({ _id: 'x' }), count: 187 },
      1,
      100,
    );

    expect(first['has_more']).toBe(true);
    expect(first['next_page_index']).toBe(1);
    expect(second['has_more']).toBe(false);
    expect(second['next_page_index']).toBeNull();
  });

  it('honours the API hasMore signal when provided', () => {
    const env = buildSearchResponse(
      { results: [{ _id: 'x' }], hasMore: true },
      0,
      25,
    );
    expect(env['has_more']).toBe(true);
    expect(env['next_page_index']).toBe(1);
  });

  it('falls back to page fullness heuristic when no count / hasMore', () => {
    // A full page -> probably more rows; a partial page -> definitely last.
    const full = buildSearchResponse(
      { results: new Array(25).fill({ _id: 'x' }) },
      0,
      25,
    );
    const partial = buildSearchResponse(
      { results: new Array(7).fill({ _id: 'x' }) },
      0,
      25,
    );

    expect(full['has_more']).toBe(true);
    expect(partial['has_more']).toBe(false);
    expect(partial['next_page_index']).toBeNull();
  });

  it('sets total to null when the API omitted count', () => {
    const env = buildSearchResponse({ results: [] }, 0, 25);
    expect(env['total']).toBeNull();
  });

  it('caps page_size reported in envelope at MAX_PAGE_SIZE', () => {
    const env = buildSearchResponse({ results: [] }, 0, 500);
    expect(env['page_size']).toBe(100);
  });

  it('accepts both results and items as the record array', () => {
    const viaItems = buildSearchResponse(
      { items: [{ _id: 'a' }], count: 1 },
      0,
      25,
    );
    expect((viaItems['results'] as unknown[]).length).toBe(1);
  });

  // Regression guard for the event-search truncation bug surfaced in code
  // review: buildSearchResponse used to unconditionally apply the
  // cert-specific truncateRecord hints ("use get_certificate") to every
  // caller. Event tools must be able to opt out so their large detail
  // blobs are preserved and no misleading recovery tool is suggested.
  it('truncate:false preserves large string fields untouched', () => {
    const bigString = 'x'.repeat(2000); // well above MAX_STRING_LEN
    const env = buildSearchResponse(
      { results: [{ detail: bigString }], count: 1 },
      0,
      25,
      { truncate: false },
    );
    const first = (env['results'] as Record<string, unknown>[])[0]!;
    expect(first['detail']).toBe(bigString);
    expect(String(first['detail'])).not.toContain('get_certificate');
  });

  it('truncate:true (default) still applies record-level truncation', () => {
    const bigString = 'x'.repeat(2000);
    const env = buildSearchResponse(
      { results: [{ detail: bigString }], count: 1 },
      0,
      25,
    );
    const first = (env['results'] as Record<string, unknown>[])[0]!;
    expect(first['detail']).not.toBe(bigString);
    expect(String(first['detail']).length).toBeLessThan(bigString.length);
  });

  // Regression guard: two consecutive page_index values MUST produce
  // envelopes that advertise different next_page_index values. This is the
  // direct assertion against the reported "pagination returned the same
  // page" failure mode.
  it('advances next_page_index monotonically across sequential pages', () => {
    const p0 = buildSearchResponse(
      { results: new Array(10).fill({}), count: 50 },
      0,
      10,
    );
    const p1 = buildSearchResponse(
      { results: new Array(10).fill({}), count: 50 },
      1,
      10,
    );
    const p2 = buildSearchResponse(
      { results: new Array(10).fill({}), count: 50 },
      2,
      10,
    );

    expect(p0['next_page_index']).toBe(1);
    expect(p1['next_page_index']).toBe(2);
    expect(p2['next_page_index']).toBe(3);
    // The three pages must be distinguishable by their page_index echoes.
    expect(
      new Set([p0['page_index'], p1['page_index'], p2['page_index']]).size,
    ).toBe(3);
  });
});

describe('buildExportPayload', () => {
  it('builds bounded export payload with row cap and count request', () => {
    const payload = buildExportPayload('*');

    expect(payload.query).toBe('*');
    expect(payload.pageIndex).toBe(1);
    expect(payload.pageSize).toBe(1000);
    expect(payload.withCount).toBe(true);
    expect(payload).not.toHaveProperty('fields');
    expect(payload).not.toHaveProperty('sortedBy');
  });

  it('includes fields when provided', () => {
    const fields = ['dn', 'serial'];
    const payload = buildExportPayload('*', fields);

    expect(payload.fields).toEqual(fields);
  });

  it('includes sortedBy when provided', () => {
    const payload = buildExportPayload('*', undefined, 'timestamp:Desc');

    expect(payload.sortedBy).toEqual([{ element: 'timestamp', order: 'Desc' }]);
  });
});

describe('truncateRecord', () => {
  it('passes through short strings unchanged', () => {
    const record = { name: 'short value', serial: 'ABC123' };
    const result = truncateRecord(record);
    expect(result).toEqual(record);
  });

  it('truncates strings exceeding 500 characters', () => {
    const longString = 'a'.repeat(600);
    const result = truncateRecord({ field: longString });
    const truncated = result.field as string;

    expect(truncated).toContain('a'.repeat(500));
    expect(truncated).toContain('<truncated');
    expect(truncated.length).toBeLessThan(600);
  });

  it('preserves strings at exactly 500 characters', () => {
    const exact = 'b'.repeat(500);
    const result = truncateRecord({ field: exact });
    expect(result.field).toBe(exact);
  });

  it('truncates arrays exceeding 20 elements', () => {
    const bigArray = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const result = truncateRecord({ list: bigArray });
    const truncated = result.list as string[];

    // 20 items + 1 truncation message
    expect(truncated).toHaveLength(21);
    expect(truncated[20]).toContain('<truncated: 30 total');
  });

  it('preserves arrays at exactly 20 elements', () => {
    const exactArray = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const result = truncateRecord({ list: exactArray });
    expect(result.list).toEqual(exactArray);
  });

  it('replaces oversized nested objects with placeholder', () => {
    // Create an object that serializes to more than 2048 bytes
    const nested: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      nested[`key${i}`] = 'x'.repeat(30);
    }
    const result = truncateRecord({ data: nested });
    expect(result.data).toBe('<oversized: use get_certificate>');
  });

  it('passes through small nested objects with recursive truncation', () => {
    const nested = { inner: 'short', count: 42 };
    const result = truncateRecord({ data: nested });
    expect(result.data).toEqual({ inner: 'short', count: 42 });
  });

  it('passes through numbers and booleans unchanged', () => {
    const result = truncateRecord({ count: 42, active: true });
    expect(result).toEqual({ count: 42, active: true });
  });

  it('passes through null values unchanged', () => {
    const result = truncateRecord({ field: null });
    expect(result).toEqual({ field: null });
  });

  it('recursively truncates strings inside arrays', () => {
    const longString = 'z'.repeat(600);
    const result = truncateRecord({ list: [longString] });
    const arr = result.list as string[];
    expect(arr[0]).toContain('<truncated');
  });
});

describe('csvTruncationMetadata', () => {
  it('counts data rows excluding header', () => {
    const csv = 'col1,col2\nval1,val2\nval3,val4\n';
    const meta = csvTruncationMetadata(csv);

    expect(meta.returned_rows).toBe(2);
    expect(meta.truncated).toBe(false);
    expect(meta.max_rows).toBe(1000);
  });

  it('marks truncated as true when row count reaches 1000', () => {
    const header = 'col1,col2';
    const rows = Array.from({ length: 1000 }, (_, i) => `val${i},data${i}`);
    const csv = [header, ...rows].join('\n');
    const meta = csvTruncationMetadata(csv);

    expect(meta.returned_rows).toBe(1000);
    expect(meta.truncated).toBe(true);
  });

  it('marks truncated as false when rows are below 1000', () => {
    const header = 'col1,col2';
    const rows = Array.from({ length: 999 }, (_, i) => `val${i},data${i}`);
    const csv = [header, ...rows].join('\n');
    const meta = csvTruncationMetadata(csv);

    expect(meta.returned_rows).toBe(999);
    expect(meta.truncated).toBe(false);
  });

  it('returns 0 rows for header-only CSV', () => {
    const csv = 'col1,col2\n';
    const meta = csvTruncationMetadata(csv);

    expect(meta.returned_rows).toBe(0);
  });

  it('returns 0 rows for empty string', () => {
    const meta = csvTruncationMetadata('');

    expect(meta.returned_rows).toBe(0);
    expect(meta.truncated).toBe(false);
  });
});

describe('encodePathSegment', () => {
  it('encodes forward slashes so they cannot break out of the segment', () => {
    expect(encodePathSegment('foo/bar')).toBe('foo%2Fbar');
  });

  it('encodes question marks so they cannot start a query string', () => {
    expect(encodePathSegment('what?')).toBe('what%3F');
  });

  it('encodes path traversal dots verbatim (the SDK will reject ..)', () => {
    // encodeURIComponent does not encode the dot character itself, but it
    // does encode the slash, so '../etc/passwd' becomes '..%2Fetc%2Fpasswd'
    // which the server will treat as a single opaque segment.
    expect(encodePathSegment('../etc/passwd')).toBe('..%2Fetc%2Fpasswd');
  });

  it('encodes spaces', () => {
    expect(encodePathSegment('hello world')).toBe('hello%20world');
  });

  it('encodes unicode characters', () => {
    expect(encodePathSegment('café')).toBe('caf%C3%A9');
    expect(encodePathSegment('日本')).toBe('%E6%97%A5%E6%9C%AC');
  });

  it('passes safe identifier characters through unchanged', () => {
    expect(encodePathSegment('abc-123_XYZ.ext')).toBe('abc-123_XYZ.ext');
  });
});

describe('download_certificate failure branches surface isError', () => {
  let client: Client;
  const mockGet = vi.fn();

  beforeAll(async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const mockClient = { get: mockGet } as unknown as Parameters<
      typeof registerCertificateTools
    >[1];
    registerCertificateTools(server, mockClient);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  it('flags an unsupported format as an error result', async () => {
    const result = (await client.callTool({
      name: 'download_certificate',
      arguments: { certificate_id: 'abc-123', format: 'der' },
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text) as Record<
      string,
      unknown
    >;
    expect(String(parsed['error'])).toContain('Only PEM');
  });

  it('flags a missing PEM as an error result', async () => {
    mockGet.mockResolvedValueOnce({ certificate: { dn: 'CN=test' } });

    const result = (await client.callTool({
      name: 'download_certificate',
      arguments: { certificate_id: 'abc-123', format: 'pem' },
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text) as Record<
      string,
      unknown
    >;
    expect(String(parsed['error'])).toContain('PEM not found');
  });
});
