import { describe, expect, it, vi } from 'vitest';

import {
  CredentialCache,
  type CredentialEntry,
} from '../../src/http/credential-cache.js';

interface Fake extends CredentialEntry {
  closed: () => number;
  cleaned: () => number;
}

function fakeEntry(): Fake {
  let closed = 0;
  let cleaned = 0;
  return {
    client: {
      close: async () => {
        closed += 1;
      },
    } as unknown as CredentialEntry['client'],
    auth: {
      cleanup: async () => {
        cleaned += 1;
      },
    } as unknown as CredentialEntry['auth'],
    closed: () => closed,
    cleaned: () => cleaned,
  };
}

function makeCache(
  overrides: Partial<{
    max: number;
    ttlMs: number;
    now: () => number;
    build: (fp: string) => Promise<CredentialEntry>;
  }> = {},
) {
  const built = new Map<string, Fake>();
  const cache = new CredentialCache({
    max: overrides.max ?? 8,
    ttlMs: overrides.ttlMs ?? 1000,
    now: overrides.now,
    build:
      overrides.build ??
      (async (fp: string) => {
        const e = fakeEntry();
        built.set(fp, e);
        return e;
      }),
  });
  return { cache, built };
}

describe('CredentialCache', () => {
  it('builds once and reuses the entry', async () => {
    const build = vi.fn(async () => fakeEntry() as CredentialEntry);
    const { cache } = makeCache({ build });

    const a = await cache.get('fp1');
    const b = await cache.get('fp1');

    expect(a.entry).toBe(b.entry);
    expect(build).toHaveBeenCalledTimes(1);
    a.releaseLease();
    b.releaseLease();
  });

  it('single-flights concurrent misses on the same fingerprint', async () => {
    let calls = 0;
    const build = vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return fakeEntry() as CredentialEntry;
    });
    const { cache } = makeCache({ build });

    const [a, b, c] = await Promise.all([
      cache.get('fp1'),
      cache.get('fp1'),
      cache.get('fp1'),
    ]);

    expect(calls).toBe(1);
    expect(a.entry).toBe(b.entry);
    expect(b.entry).toBe(c.entry);
    a.releaseLease();
    b.releaseLease();
    c.releaseLease();
  });

  it('never caches a failed build and retries next time', async () => {
    let attempt = 0;
    const build = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('horizon rejected the credential');
      return fakeEntry() as CredentialEntry;
    });
    const { cache } = makeCache({ build });

    await expect(cache.get('fp1')).rejects.toThrow('horizon rejected');
    // The failure must not be retained: the next call retries and succeeds.
    await expect(cache.get('fp1')).resolves.toBeDefined();
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('never lets two fingerprints share a client', async () => {
    const { cache } = makeCache();
    const a = await cache.get('fp1');
    const b = await cache.get('fp2');
    expect(a.entry.client).not.toBe(b.entry.client);
    a.releaseLease();
    b.releaseLease();
  });

  it('closes client and auth when an entry expires', async () => {
    let clock = 0;
    const { cache, built } = makeCache({ ttlMs: 100, now: () => clock });

    const firstLease = await cache.get('fp1');
    const first = built.get('fp1')!;
    firstLease.releaseLease();

    clock = 500;
    const secondLease = await cache.get('fp1');

    expect(first.closed()).toBe(1);
    expect(first.cleaned()).toBe(1);
    secondLease.releaseLease();
  });

  it('evicts the least recently used entry when full', async () => {
    const { cache, built } = makeCache({ max: 2 });

    const firstA = await cache.get('a');
    const b = await cache.get('b');
    const secondA = await cache.get('a'); // refreshes 'a', making 'b' the LRU
    b.releaseLease();
    const c = await cache.get('c');

    expect(built.get('b')!.closed()).toBe(1);
    expect(built.get('b')!.cleaned()).toBe(1);
    expect(built.get('a')!.closed()).toBe(0);
    firstA.releaseLease();
    secondA.releaseLease();
    c.releaseLease();
  });

  it('invalidate drops and closes an entry, forcing revalidation', async () => {
    const build = vi.fn(async () => fakeEntry() as CredentialEntry);
    const { cache } = makeCache({ build });

    const first = await cache.get('fp1');
    first.releaseLease();
    await cache.invalidate('fp1');
    const second = await cache.get('fp1');

    expect(build).toHaveBeenCalledTimes(2);
    second.releaseLease();
  });

  it('sweep closes only expired entries', async () => {
    let clock = 0;
    const { cache, built } = makeCache({ ttlMs: 100, now: () => clock });

    const old = await cache.get('old');
    clock = 60;
    const fresh = await cache.get('fresh');
    clock = 120; // 'old' expired at 100, 'fresh' expires at 160
    old.releaseLease();
    fresh.releaseLease();

    await cache.sweep();

    expect(built.get('old')!.closed()).toBe(1);
    expect(built.get('fresh')!.closed()).toBe(0);
    expect(cache.size).toBe(1);
  });

  it('close tears down every entry and refuses further gets', async () => {
    const { cache, built } = makeCache();
    const a = await cache.get('a');
    const b = await cache.get('b');
    a.releaseLease();
    b.releaseLease();

    await cache.close();

    expect(built.get('a')!.closed()).toBe(1);
    expect(built.get('b')!.cleaned()).toBe(1);
    await expect(cache.get('c')).rejects.toThrow('closed');
  });

  it('disposes a build that completes after close rather than leaking it', async () => {
    let entry: Fake | undefined;
    const { cache } = makeCache({
      build: async () => {
        await new Promise((r) => setTimeout(r, 30));
        entry = fakeEntry();
        return entry;
      },
    });

    const pending = cache.get('fp1');
    await new Promise((r) => setTimeout(r, 5));
    await cache.close();
    await expect(pending).rejects.toThrow('closed');

    expect(entry?.closed()).toBe(1);
    expect(entry?.cleaned()).toBe(1);
  });

  it('reports cleanup failures without throwing', async () => {
    const onCleanupError = vi.fn();
    const cache = new CredentialCache({
      max: 4,
      ttlMs: 1000,
      onCleanupError,
      build: async () => ({
        client: {
          close: async () => {
            throw new Error('stuck socket');
          },
        },
        auth: { cleanup: async () => undefined },
      }),
    } as never);

    const lease = await cache.get('fp1');
    lease.releaseLease();
    await expect(cache.close()).resolves.toBeUndefined();
    expect(onCleanupError).toHaveBeenCalledWith('fp1', expect.any(Error));
  });

  it('defers eviction disposal until the last lease is released', async () => {
    const { cache, built } = makeCache({ max: 1 });

    const { releaseLease } = await cache.get('leased');
    const next = await cache.get('next');

    expect(built.get('leased')!.closed()).toBe(0);

    releaseLease();
    await vi.waitFor(() => expect(built.get('leased')!.closed()).toBe(1));

    releaseLease();
    await Promise.resolve();
    expect(built.get('leased')!.closed()).toBe(1);
    next.releaseLease();
  });

  it('gives single-flight callers independent idempotent leases', async () => {
    const entry = fakeEntry();
    const build = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return entry;
    });
    const { cache } = makeCache({ build });

    const [first, second] = await Promise.all([
      cache.get('shared'),
      cache.get('shared'),
    ]);

    expect(build).toHaveBeenCalledTimes(1);
    expect(first.entry).toBe(second.entry);
    expect(first.releaseLease).not.toBe(second.releaseLease);

    const retired = cache.invalidate('shared');
    await Promise.resolve();
    first.releaseLease();
    await Promise.resolve();
    expect(entry.closed()).toBe(0);

    second.releaseLease();
    await retired;
    expect(entry.closed()).toBe(1);

    first.releaseLease();
    second.releaseLease();
    await Promise.resolve();
    expect(entry.closed()).toBe(1);
  });

  it('keeps close pending until an outstanding lease is released', async () => {
    const { cache } = makeCache();
    const { releaseLease } = await cache.get('leased');

    const closing = cache.close();
    const result = await Promise.race([
      closing.then(() => 'closed' as const),
      new Promise<'pending'>((resolve) =>
        setTimeout(() => resolve('pending'), 100),
      ),
    ]);

    expect(result).toBe('pending');
    releaseLease();
    await expect(closing).resolves.toBeUndefined();
  });
});
