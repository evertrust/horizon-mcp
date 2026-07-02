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

  describe('per-key limit overrides', () => {
    it('gives an overridden key a higher ceiling than the base limit', () => {
      const clock = fakeClock();
      // per-peer base limit 1, global key ceiling 4.
      const rl = new RateLimiter(1, clock.now, { __global__: 4 });
      // Distinct peers each get 1, while the global key absorbs up to 4.
      expect(rl.tryAcquireAll(['__global__', 'a'])).toBe(true);
      expect(rl.tryAcquireAll(['__global__', 'b'])).toBe(true);
      expect(rl.tryAcquireAll(['__global__', 'c'])).toBe(true);
      expect(rl.tryAcquireAll(['__global__', 'd'])).toBe(true);
      // Global key is now full at 4 -> a fresh peer is still denied.
      expect(rl.tryAcquireAll(['__global__', 'e'])).toBe(false);
    });

    it('still caps a single peer at the base limit even below the global ceiling', () => {
      const clock = fakeClock();
      const rl = new RateLimiter(1, clock.now, { __global__: 4 });
      expect(rl.tryAcquireAll(['__global__', 'a'])).toBe(true);
      // 'a' is full at the per-peer limit of 1 while global still has room.
      expect(rl.tryAcquireAll(['__global__', 'a'])).toBe(false);
    });

    it('disables everything when the base limit is 0 regardless of overrides', () => {
      const rl = new RateLimiter(0, undefined, { __global__: 4 });
      for (let i = 0; i < 10; i++) {
        expect(rl.tryAcquireAll(['__global__', 'a'])).toBe(true);
      }
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
