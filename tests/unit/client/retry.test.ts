import { describe, expect, it, vi } from 'vitest';

import { runWithRequestSignal } from '../../../src/client/request-signal.js';
import { withRetry } from '../../../src/client/retry.js';

/**
 * Build a minimal fake Response with a configurable Retry-After header.
 */
function fakeResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    text: () => Promise.resolve(''),
    json: () => Promise.resolve({}),
    clone() {
      return fakeResponse(status, headers);
    },
  } as unknown as Response;
}

describe('withRetry Retry-After clamping', () => {
  it('clamps an astronomically large Retry-After to maxDelayMs', async () => {
    // Capture setTimeout delay actually used by withRetry.
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(
        (cb: (...args: unknown[]) => void, _delay?: number) => {
          // Run callback immediately to keep the test fast.
          cb();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        },
      );

    try {
      const responses = [
        fakeResponse(429, { 'Retry-After': '999999999' }),
        fakeResponse(200),
      ];
      let idx = 0;
      const fn = () => Promise.resolve(responses[idx++]!);

      const maxDelayMs = 10_000;
      const result = await withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs,
      });
      expect(result.status).toBe(200);

      // setTimeout should have been called once for the retry pause.
      // The delay must be clamped to maxDelayMs.
      const delaysUsed = setTimeoutSpy.mock.calls.map(
        (call) => call[1] as number,
      );
      expect(delaysUsed).toContain(maxDelayMs);
      for (const delay of delaysUsed) {
        expect(delay).toBeLessThanOrEqual(maxDelayMs);
      }
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('clamps negative Retry-After to 0', async () => {
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(
        (cb: (...args: unknown[]) => void, _delay?: number) => {
          cb();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        },
      );

    try {
      const responses = [
        fakeResponse(429, { 'Retry-After': '-5' }),
        fakeResponse(200),
      ];
      let idx = 0;
      const fn = () => Promise.resolve(responses[idx++]!);

      await withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10_000,
      });

      const delaysUsed = setTimeoutSpy.mock.calls.map(
        (call) => call[1] as number,
      );
      expect(delaysUsed).toContain(0);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('falls back to exponential delay on invalid Retry-After', async () => {
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(
        (cb: (...args: unknown[]) => void, _delay?: number) => {
          cb();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        },
      );

    try {
      const responses = [
        fakeResponse(429, { 'Retry-After': 'not-a-number' }),
        fakeResponse(200),
      ];
      let idx = 0;
      const fn = () => Promise.resolve(responses[idx++]!);

      await withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10_000,
      });

      const delaysUsed = setTimeoutSpy.mock.calls.map(
        (call) => call[1] as number,
      );
      // First attempt exponential delay: baseDelayMs * 2^0 = 1000ms
      expect(delaysUsed).toContain(1000);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});

describe('withRetry cancellation', () => {
  it('does not retry an aborted fetch', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('cancelled', 'AbortError');
    const fn = vi.fn(async () => {
      controller.abort(abortError);
      throw abortError;
    });
    const startedAt = performance.now();

    await expect(
      runWithRequestSignal(controller.signal, () =>
        withRetry(fn, { baseDelayMs: 1000 }),
      ),
    ).rejects.toBe(abortError);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(performance.now() - startedAt).toBeLessThan(50);
  });

  it('ends backoff promptly when the request is aborted', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('cancelled', 'AbortError');
    const fn = vi.fn(() => Promise.resolve(fakeResponse(503)));
    const startedAt = performance.now();
    const result = runWithRequestSignal(controller.signal, () =>
      withRetry(fn, { baseDelayMs: 10_000 }),
    );

    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    controller.abort(abortError);

    await expect(result).rejects.toBe(abortError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
