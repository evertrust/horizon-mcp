import { describe, expect, it, vi } from 'vitest';

import { currentRequestSignal } from '../../src/client/request-signal.js';
import {
  CredentialCache,
  type CredentialEntry,
} from '../../src/http/credential-cache.js';
import type { CredentialMaterial } from '../../src/http/credentials.js';

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

function apiKeyMaterial(): CredentialMaterial {
  return { kind: 'api-key', apiId: 'id', apiKey: 'secret' };
}

function makeCache(
  overrides: Partial<{
    max: number;
    ttlMs: number;
    now: () => number;
    build: (
      fp: string,
      material: CredentialMaterial,
    ) => Promise<CredentialEntry>;
  }> = {},
) {
  const built = new Map<string, Fake>();
  const cache = new CredentialCache({
    max: overrides.max ?? 8,
    ttlMs: overrides.ttlMs ?? 1000,
    now: overrides.now,
    build:
      overrides.build ??
      (async (fp: string, _material: CredentialMaterial) => {
        const e = fakeEntry();
        built.set(fp, e);
        return e;
      }),
  });
  return { cache, built };
}

describe('CredentialCache', () => {
  it('passes the supplied material to the build winner', async () => {
    const material = apiKeyMaterial();
    const build = vi.fn(async () => fakeEntry() as CredentialEntry);
    const { cache } = makeCache({ build });

    const lease = await cache.get('fp1', material);

    expect(build).toHaveBeenCalledWith('fp1', material);
    lease.releaseLease();
  });

  it('builds once and reuses the entry', async () => {
    const build = vi.fn(async () => fakeEntry() as CredentialEntry);
    const { cache } = makeCache({ build });

    const a = await cache.get('fp1', apiKeyMaterial());
    const b = await cache.get('fp1', apiKeyMaterial());

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
      cache.get('fp1', apiKeyMaterial()),
      cache.get('fp1', apiKeyMaterial()),
      cache.get('fp1', apiKeyMaterial()),
    ]);

    expect(calls).toBe(1);
    expect(a.entry).toBe(b.entry);
    expect(b.entry).toBe(c.entry);
    a.releaseLease();
    b.releaseLease();
    c.releaseLease();
  });

  it('aborts a shared build only after every waiter cancels', async () => {
    let buildSignal: AbortSignal | undefined;
    let markBuildStarted = () => {};
    const buildStarted = new Promise<void>((resolve) => {
      markBuildStarted = resolve;
    });
    let releaseBuild = () => {};
    const buildRelease = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    const { cache } = makeCache({
      build: async () => {
        buildSignal = currentRequestSignal();
        markBuildStarted();
        await buildRelease;
        if (buildSignal?.aborted) throw buildSignal.reason;
        return fakeEntry();
      },
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstReason = new Error('first waiter disconnected');
    const secondReason = new Error('second waiter disconnected');
    const first = cache.get(
      'shared',
      apiKeyMaterial(),
      undefined,
      firstController.signal,
    );
    const second = cache.get(
      'shared',
      apiKeyMaterial(),
      undefined,
      secondController.signal,
    );

    try {
      await buildStarted;
      expect(buildSignal).toBeDefined();

      firstController.abort(firstReason);
      await expect(first).rejects.toBe(firstReason);
      expect(buildSignal!.aborted).toBe(false);

      secondController.abort(secondReason);
      await expect(second).rejects.toBe(secondReason);
      expect(buildSignal!.aborted).toBe(true);
    } finally {
      releaseBuild();
      const results = await Promise.allSettled([first, second]);
      for (const result of results) {
        if (result.status === 'fulfilled') result.value.releaseLease();
      }
      await cache.close();
    }
  });

  it('starts a fresh build for a caller arriving after the last waiter cancels', async () => {
    let calls = 0;
    let markFirstBuildStarted = () => {};
    const firstBuildStarted = new Promise<void>((resolve) => {
      markFirstBuildStarted = resolve;
    });
    let releaseFirstBuild = () => {};
    const firstBuildRelease = new Promise<void>((resolve) => {
      releaseFirstBuild = resolve;
    });
    let markSecondBuildStarted = () => {};
    const secondBuildStarted = new Promise<void>((resolve) => {
      markSecondBuildStarted = resolve;
    });
    let releaseSecondBuild = () => {};
    const secondBuildRelease = new Promise<void>((resolve) => {
      releaseSecondBuild = resolve;
    });
    const build = vi.fn(async () => {
      calls += 1;
      const buildSignal = currentRequestSignal();
      if (calls === 1) {
        markFirstBuildStarted();
        await firstBuildRelease;
      } else {
        markSecondBuildStarted();
        await secondBuildRelease;
      }
      if (buildSignal?.aborted) throw buildSignal.reason;
      return fakeEntry() as CredentialEntry;
    });
    const { cache } = makeCache({ build });
    const controller = new AbortController();
    const reason = new Error('caller disconnected');
    const releases: (() => void)[] = [];
    const first = cache.get(
      'shared',
      apiKeyMaterial(),
      undefined,
      controller.signal,
    );
    let second: ReturnType<typeof cache.get> | undefined;

    try {
      await firstBuildStarted;
      controller.abort(reason);
      await expect(first).rejects.toBe(reason);

      second = cache.get('shared', apiKeyMaterial());
      await Promise.resolve();
      await Promise.resolve();
      expect(build).toHaveBeenCalledTimes(2);
      await secondBuildStarted;

      releaseSecondBuild();
      const lease = await second;
      releases.push(lease.releaseLease);
      expect(lease.entry).toBeDefined();
      lease.releaseLease();

      releaseFirstBuild();
    } finally {
      releaseFirstBuild();
      releaseSecondBuild();
      const results = await Promise.allSettled([
        first,
        ...(second ? [second] : []),
      ]);
      for (const result of results) {
        if (result.status === 'fulfilled') result.value.releaseLease();
      }
      for (const release of releases) release();
      await cache.close();
    }
  });

  it('keeps close pending until an orphaned build settles', async () => {
    let markBuildStarted = () => {};
    const buildStarted = new Promise<void>((resolve) => {
      markBuildStarted = resolve;
    });
    let releaseBuild = () => {};
    const buildRelease = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    const { cache } = makeCache({
      build: async () => {
        const buildSignal = currentRequestSignal();
        markBuildStarted();
        await buildRelease;
        if (buildSignal?.aborted) throw buildSignal.reason;
        return fakeEntry();
      },
    });
    const controller = new AbortController();
    const reason = new Error('caller disconnected');
    const pending = cache.get(
      'shared',
      apiKeyMaterial(),
      undefined,
      controller.signal,
    );
    let closing: Promise<void> | undefined;

    try {
      await buildStarted;
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);

      closing = cache.close();
      let closed = false;
      void closing.then(() => {
        closed = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(closed).toBe(false);

      releaseBuild();
      await expect(closing).resolves.toBeUndefined();
    } finally {
      releaseBuild();
      const result = await Promise.allSettled([pending]);
      if (result[0]?.status === 'fulfilled') result[0].value.releaseLease();
      await (closing ?? cache.close());
    }
  });

  it('invokes onBuildStart once for concurrent misses on one fingerprint', async () => {
    const material = apiKeyMaterial();
    const onBuildStart = vi.fn();
    const build = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return fakeEntry() as CredentialEntry;
    });
    const cache = new CredentialCache({
      max: 8,
      ttlMs: 1000,
      onBuildStart,
      build,
    });
    const releases: (() => void)[] = [];

    try {
      const leases = await Promise.all(
        Array.from({ length: 6 }, () =>
          cache.get('shared', material, '127.0.0.1'),
        ),
      );
      for (const lease of leases) releases.push(lease.releaseLease);

      expect(onBuildStart).toHaveBeenCalledTimes(1);
      expect(onBuildStart).toHaveBeenCalledWith(
        'shared',
        material,
        '127.0.0.1',
      );
      expect(build).toHaveBeenCalledTimes(1);
    } finally {
      for (const release of releases) release();
      await cache.close();
    }
  });

  it('shares onBuildStart rejection and permits a fresh build afterward', async () => {
    const hookError = new Error('validation budget exhausted');
    const onBuildStart = vi.fn(() => {
      if (onBuildStart.mock.calls.length === 1) throw hookError;
    });
    const build = vi.fn(async () => fakeEntry() as CredentialEntry);
    const cache = new CredentialCache({
      max: 8,
      ttlMs: 1000,
      onBuildStart,
      build,
    });
    const releases: (() => void)[] = [];

    try {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          cache.get('shared', apiKeyMaterial(), '127.0.0.1'),
        ),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          releases.push(result.value.releaseLease);
        }
      }
      for (const result of results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.reason).toBe(hookError);
      }
      expect(onBuildStart).toHaveBeenCalledTimes(1);
      expect(build).not.toHaveBeenCalled();
      expect(cache.size).toBe(0);

      const retry = await cache.get('shared', apiKeyMaterial(), '127.0.0.1');
      releases.push(retry.releaseLease);
      expect(onBuildStart).toHaveBeenCalledTimes(2);
      expect(build).toHaveBeenCalledTimes(1);
    } finally {
      for (const release of releases) release();
      await cache.close();
    }
  });

  it('never caches a failed build and retries next time', async () => {
    let attempt = 0;
    const build = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('horizon rejected the credential');
      return fakeEntry() as CredentialEntry;
    });
    const { cache } = makeCache({ build });

    await expect(cache.get('fp1', apiKeyMaterial())).rejects.toThrow(
      'horizon rejected',
    );
    // The failure must not be retained: the next call retries and succeeds.
    const retry = cache.get('fp1', apiKeyMaterial());
    await expect(retry).resolves.toBeDefined();
    expect(build).toHaveBeenCalledTimes(2);
    const { releaseLease } = await retry;
    releaseLease();
  });

  it('never lets two fingerprints share a client', async () => {
    const { cache } = makeCache();
    const a = await cache.get('fp1', apiKeyMaterial());
    const b = await cache.get('fp2', apiKeyMaterial());
    expect(a.entry.client).not.toBe(b.entry.client);
    a.releaseLease();
    b.releaseLease();
  });

  it('closes client and auth when an entry expires', async () => {
    let clock = 0;
    const { cache, built } = makeCache({ ttlMs: 100, now: () => clock });

    const firstLease = await cache.get('fp1', apiKeyMaterial());
    const first = built.get('fp1')!;
    firstLease.releaseLease();

    clock = 500;
    const secondLease = await cache.get('fp1', apiKeyMaterial());

    expect(first.closed()).toBe(1);
    expect(first.cleaned()).toBe(1);
    secondLease.releaseLease();
  });

  it('revalidates after the absolute TTL despite intervening hits', async () => {
    let clock = 0;
    const entries: Fake[] = [];
    const build = vi.fn(async () => {
      const entry = fakeEntry();
      entries.push(entry);
      return entry;
    });
    const { cache } = makeCache({
      ttlMs: 300_000,
      now: () => clock,
      build,
    });
    const releases: (() => void)[] = [];

    try {
      const initial = await cache.get('fp1', apiKeyMaterial());
      releases.push(initial.releaseLease);
      initial.releaseLease();

      clock = 200_000;
      const hit = await cache.get('fp1', apiKeyMaterial());
      releases.push(hit.releaseLease);
      expect(hit.entry).toBe(initial.entry);
      expect(build).toHaveBeenCalledTimes(1);
      hit.releaseLease();

      clock = 400_000;
      const rebuilt = await cache.get('fp1', apiKeyMaterial());
      releases.push(rebuilt.releaseLease);
      expect(build).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(entries[0]!.closed()).toBe(1));
      expect(entries[0]!.cleaned()).toBe(1);
    } finally {
      for (const release of releases) release();
      await cache.close();
    }
  });

  it('evicts the least recently used entry when full', async () => {
    const { cache, built } = makeCache({ max: 2 });

    const firstA = await cache.get('a', apiKeyMaterial());
    const b = await cache.get('b', apiKeyMaterial());
    const secondA = await cache.get('a', apiKeyMaterial()); // refreshes 'a', making 'b' the LRU
    b.releaseLease();
    const c = await cache.get('c', apiKeyMaterial());

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

    const first = await cache.get('fp1', apiKeyMaterial());
    first.releaseLease();
    await cache.invalidate('fp1');
    const second = await cache.get('fp1', apiKeyMaterial());

    expect(build).toHaveBeenCalledTimes(2);
    second.releaseLease();
  });

  it('sweep closes only expired entries', async () => {
    let clock = 0;
    const { cache, built } = makeCache({ ttlMs: 100, now: () => clock });

    const old = await cache.get('old', apiKeyMaterial());
    clock = 60;
    const fresh = await cache.get('fresh', apiKeyMaterial());
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
    const a = await cache.get('a', apiKeyMaterial());
    const b = await cache.get('b', apiKeyMaterial());
    a.releaseLease();
    b.releaseLease();

    await cache.close();

    expect(built.get('a')!.closed()).toBe(1);
    expect(built.get('b')!.cleaned()).toBe(1);
    await expect(cache.get('c', apiKeyMaterial())).rejects.toThrow('closed');
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

    const pending = cache.get('fp1', apiKeyMaterial());
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

    const lease = await cache.get('fp1', apiKeyMaterial());
    lease.releaseLease();
    await expect(cache.close()).resolves.toBeUndefined();
    expect(onCleanupError).toHaveBeenCalledWith('fp1', expect.any(Error));
  });

  it('defers eviction disposal until the last lease is released', async () => {
    const { cache, built } = makeCache({ max: 1 });
    const releases: (() => void)[] = [];

    try {
      const { releaseLease } = await cache.get('leased', apiKeyMaterial());
      releases.push(releaseLease);
      const next = await cache.get('next', apiKeyMaterial());
      releases.push(next.releaseLease);

      expect(built.get('leased')!.closed()).toBe(0);

      releaseLease();
      await vi.waitFor(() => expect(built.get('leased')!.closed()).toBe(1));

      releaseLease();
      await Promise.resolve();
      expect(built.get('leased')!.closed()).toBe(1);
    } finally {
      for (const release of releases) release();
      await cache.close();
    }
  });

  it('gives single-flight callers independent idempotent leases', async () => {
    const entry = fakeEntry();
    const build = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return entry;
    });
    const { cache } = makeCache({ build });
    const releases: (() => void)[] = [];

    try {
      const [first, second] = await Promise.all([
        cache.get('shared', apiKeyMaterial()),
        cache.get('shared', apiKeyMaterial()),
      ]);
      releases.push(first.releaseLease, second.releaseLease);

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
    } finally {
      for (const release of releases) release();
      await cache.close();
    }
  });

  it('keeps close pending until an outstanding lease is released', async () => {
    const { cache } = makeCache();
    const releases: (() => void)[] = [];
    let closing: Promise<void> | undefined;

    try {
      const { releaseLease } = await cache.get('leased', apiKeyMaterial());
      releases.push(releaseLease);
      closing = cache.close();
      const result = await Promise.race([
        closing.then(() => 'closed' as const),
        new Promise<'pending'>((resolve) =>
          setTimeout(() => resolve('pending'), 100),
        ),
      ]);

      expect(result).toBe('pending');
    } finally {
      for (const release of releases) release();
      const settled = await Promise.race([
        (closing ?? cache.close()).then(() => 'closed' as const),
        new Promise<'timed out'>((resolve) =>
          setTimeout(() => resolve('timed out'), 500),
        ),
      ]);
      expect(settled).toBe('closed');
    }
  });
});
