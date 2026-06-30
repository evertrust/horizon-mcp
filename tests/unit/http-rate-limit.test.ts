import { describe, expect, it } from 'vitest';

import { RateLimiter } from '../../src/http/rate-limit.js';

function fakeClock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('RateLimiter', () => {
  it('allows everything when the limit is 0 (disabled)', () => {
    const rl = new RateLimiter(0);
    for (let i = 0; i < 100; i++) expect(rl.tryAcquire('k')).toBe(true);
  });

  it('allows up to the limit then denies within a window', () => {
    const clock = fakeClock();
    const rl = new RateLimiter(3, clock.now);
    expect(rl.tryAcquire('k')).toBe(true);
    expect(rl.tryAcquire('k')).toBe(true);
    expect(rl.tryAcquire('k')).toBe(true);
    expect(rl.tryAcquire('k')).toBe(false);
  });

  it('resets after the 1s window elapses', () => {
    const clock = fakeClock();
    const rl = new RateLimiter(1, clock.now);
    expect(rl.tryAcquire('k')).toBe(true);
    expect(rl.tryAcquire('k')).toBe(false);
    clock.advance(1000);
    expect(rl.tryAcquire('k')).toBe(true);
  });

  it('counts a batch as its message count (cost)', () => {
    const clock = fakeClock();
    const rl = new RateLimiter(5, clock.now);
    expect(rl.tryAcquire('k', 5)).toBe(true);
    expect(rl.tryAcquire('k', 1)).toBe(false);
  });

  it('isolates counts per key', () => {
    const clock = fakeClock();
    const rl = new RateLimiter(1, clock.now);
    expect(rl.tryAcquire('a')).toBe(true);
    expect(rl.tryAcquire('b')).toBe(true);
    expect(rl.tryAcquire('a')).toBe(false);
  });

  describe('tryAcquireAll (atomic over multiple keys)', () => {
    it('denies and consumes nothing if any key is full', () => {
      const clock = fakeClock();
      const rl = new RateLimiter(1, clock.now);
      // Fill the global key.
      expect(rl.tryAcquire('global')).toBe(true);
      // Atomic check across global + a fresh per-address key fails on global...
      expect(rl.tryAcquireAll(['global', '10.0.0.1'])).toBe(false);
      // ...and must not have consumed the per-address budget.
      expect(rl.tryAcquire('10.0.0.1')).toBe(true);
    });

    it('allows and consumes when all keys have capacity', () => {
      const clock = fakeClock();
      const rl = new RateLimiter(2, clock.now);
      expect(rl.tryAcquireAll(['global', 'addr'])).toBe(true);
      expect(rl.tryAcquireAll(['global', 'addr'])).toBe(true);
      expect(rl.tryAcquireAll(['global', 'addr'])).toBe(false);
    });
  });

  describe('prune', () => {
    it('evicts windows whose period has elapsed (bounds the key map)', () => {
      const clock = fakeClock();
      const rl = new RateLimiter(5, clock.now);
      rl.tryAcquire('peer-1');
      rl.tryAcquire('peer-2');
      const windows = (rl as unknown as { windows: Map<string, unknown> })
        .windows;
      expect(windows.size).toBe(2);
      rl.prune(); // still within the window -> nothing evicted
      expect(windows.size).toBe(2);
      clock.advance(1000);
      rl.prune(); // window elapsed -> both evicted
      expect(windows.size).toBe(0);
    });
  });
});
