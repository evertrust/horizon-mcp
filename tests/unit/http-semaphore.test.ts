import { describe, expect, it } from 'vitest';

import { KeyedSemaphore, Semaphore } from '../../src/http/semaphore.js';

describe('Semaphore', () => {
  it('admits up to capacity and refuses beyond it', () => {
    const s = new Semaphore(2);
    expect(s.tryAcquire()).toBeTypeOf('function');
    expect(s.tryAcquire()).toBeTypeOf('function');
    expect(s.tryAcquire()).toBeUndefined();
    expect(s.inUse).toBe(2);
  });

  it('readmits after release', () => {
    const s = new Semaphore(1);
    const release = s.tryAcquire()!;
    expect(s.tryAcquire()).toBeUndefined();
    release();
    expect(s.free).toBe(1);
    expect(s.tryAcquire()).toBeTypeOf('function');
  });

  it('ignores a repeated release so capacity cannot inflate', () => {
    // The release is wired to both 'close' and 'finish' on the response, so it
    // is expected to fire twice.
    const s = new Semaphore(1);
    const release = s.tryAcquire()!;
    release();
    release();
    release();
    expect(s.free).toBe(1);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
    expect(() => new Semaphore(-1)).toThrow(RangeError);
  });
});

describe('KeyedSemaphore', () => {
  it('caps each key independently', () => {
    const s = new KeyedSemaphore(2);
    expect(s.tryAcquire('a')).toBeTypeOf('function');
    expect(s.tryAcquire('a')).toBeTypeOf('function');
    expect(s.tryAcquire('a')).toBeUndefined();
    // A different credential is unaffected by the first one's saturation.
    expect(s.tryAcquire('b')).toBeTypeOf('function');
  });

  it('drops idle keys so the map stays bounded by active callers', () => {
    const s = new KeyedSemaphore(1);
    const release = s.tryAcquire('a')!;
    expect(s.size).toBe(1);
    release();
    expect(s.size).toBe(0);
  });

  it('ignores a repeated release', () => {
    const s = new KeyedSemaphore(1);
    const release = s.tryAcquire('a')!;
    release();
    release();
    expect(s.size).toBe(0);
    expect(s.tryAcquire('a')).toBeTypeOf('function');
  });
});
