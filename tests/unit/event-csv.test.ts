import { describe, expect, it, vi } from 'vitest';

import type { HorizonClient } from '../../src/client/http.js';
import { exportEventsCsvFromSearch } from '../../src/tools/lifecycle/event-csv.js';

const PAGE_SIZE = 100;
const MAX_ROWS = 1000;

function makeEvent(index: number): Record<string, unknown> {
  return {
    _id: `evt-${index}`,
    code: 'SEC-AUTHENTICATION',
    module: 'security',
    node: 'node-1',
    timestamp: '2026-04-14T12:00:00.000Z',
    status: 'success',
  };
}

function makeClient(post: ReturnType<typeof vi.fn>): HorizonClient {
  return { post } as unknown as HorizonClient;
}

describe('exportEventsCsvFromSearch accumulation', () => {
  it('accumulates rows across pages in fetch order', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        results: [makeEvent(1), makeEvent(2)],
        count: 4,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        results: [makeEvent(3), makeEvent(4)],
        hasMore: false,
      });

    const result = await exportEventsCsvFromSearch(
      makeClient(post),
      'code matches ".*"',
    );

    expect(result.returned_rows).toBe(4);
    const lines = result.csv.split('\n');
    // header + 4 rows, preserved in page-then-batch order
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('evt-1');
    expect(lines[2]).toContain('evt-2');
    expect(lines[3]).toContain('evt-3');
    expect(lines[4]).toContain('evt-4');
  });

  it('caps accumulation at max_rows and slices the final page', async () => {
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) => makeEvent(i));
    const post = vi.fn().mockResolvedValue({
      results: fullPage,
      count: MAX_ROWS + PAGE_SIZE,
      hasMore: true,
    });

    const result = await exportEventsCsvFromSearch(
      makeClient(post),
      'code matches ".*"',
    );

    expect(result.returned_rows).toBe(MAX_ROWS);
    expect(result.max_rows).toBe(MAX_ROWS);
    expect(result.truncated).toBe(true);
    // header + MAX_ROWS data rows
    expect(result.csv.split('\n')).toHaveLength(MAX_ROWS + 1);
  });
});
