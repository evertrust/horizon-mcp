import type { AuthProvider } from '../auth/base.js';
import type { HorizonClient } from '../client/http.js';
import { runWithRequestSignal } from '../client/request-signal.js';
import type { CredentialMaterial } from './credentials.js';

/**
 * One cached, already-validated upstream credential: the Horizon client every
 * tool handler for this caller closes over, plus the auth provider that owns
 * its lifecycle.
 */
export interface CredentialEntry {
  readonly client: HorizonClient;
  readonly auth: AuthProvider;
}

export interface CredentialCacheOptions {
  /** Hard ceiling on reusable entries. Retired leases may outlive eviction. */
  readonly max: number;
  /**
   * Absolute entry lifetime from validation. Cached credentials revalidate
   * against Horizon at least every `ttlMs`, regardless of use frequency.
   */
  readonly ttlMs: number;
  /** Builds and validates a credential. Must reject if validation fails. */
  readonly build: (
    fingerprint: string,
    material: CredentialMaterial,
  ) => Promise<CredentialEntry>;
  readonly onBuildStart?: (
    fingerprint: string,
    material: CredentialMaterial,
    peer: string | undefined,
  ) => void;
  readonly now?: () => number;
  /** Reported when retired entry cleanup throws. Never rethrows. */
  readonly onCleanupError?: (fingerprint: string, err: unknown) => void;
}

interface CacheRecord {
  readonly entry: CredentialEntry;
  expiresAt: number;
  refs: number;
  retired: boolean;
  disposeStarted: boolean;
  retirement?: Promise<void>;
  resolveRetirement?: () => void;
}

interface InflightRecord {
  readonly controller: AbortController;
  readonly promise: Promise<CacheRecord>;
  waiters: number;
  settled: boolean;
}

/**
 * Caches validated Horizon credentials across requests.
 *
 * MCP 2026-07-28 has no sessions, so every HTTP request arrives with its own
 * credential headers. Without this cache `validateAuth()` would be a network
 * round-trip to Horizon on every single request. Entries are keyed by the HMAC
 * credential fingerprint (`credentialFingerprintOf`), so two different
 * credentials never share a `HorizonClient`.
 *
 * Guarantees, all of them load-bearing:
 *  - **Single-flight build**: concurrent misses on one fingerprint build once,
 *    then each caller receives an independent lease.
 *  - **No negative caching**: a failed or partially-initialized build is never
 *    retained, so a revoked credential cannot be cached as valid and a
 *    transient Horizon outage cannot pin a failure.
 *  - **Lease-safe cleanup**: expiry, eviction, invalidation and shutdown remove
 *    records immediately, then dispose exactly once after the last lease ends.
 *  - **Absolute validation TTL**: expiry is fixed when validation completes, so
 *    credentials revalidate against Horizon at least every `ttlMs` regardless
 *    of how often they are used.
 *  - **Bounded reusable set**: LRU by last use, capped at `max`; retired records
 *    can remain alive only while existing leases still reference them.
 */
export class CredentialCache {
  // Map iteration order is insertion order, and re-inserting on hit makes the
  // first key the least recently used.
  private readonly entries = new Map<string, CacheRecord>();
  private readonly inflight = new Map<string, InflightRecord>();
  private readonly retirements = new Set<Promise<void>>();
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly opts: CredentialCacheOptions) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Acquire a validated credential lease for `fingerprint`, building it if
   * needed. Concurrent callers share only the build; every successful caller
   * increments the record reference count and must invoke its own idempotent
   * `releaseLease` when the request stops using the entry.
   */
  async get(
    fingerprint: string,
    material: CredentialMaterial,
    peer?: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly entry: CredentialEntry;
    readonly releaseLease: () => void;
  }> {
    while (true) {
      if (this.closed) throw new Error('credential cache is closed');

      const hit = this.entries.get(fingerprint);
      if (hit) {
        const now = this.now();
        if (hit.expiresAt > now) {
          // TTL is fixed at build time; hits update only the LRU position.
          this.entries.delete(fingerprint);
          this.entries.set(fingerprint, hit);
          return this.lease(fingerprint, hit);
        }
        void this.retire(fingerprint, hit);
      }

      let pending = this.inflight.get(fingerprint);
      if (!pending) {
        const controller = new AbortController();
        const promise = runWithRequestSignal(controller.signal, async () => {
          // The fingerprint HMAC makes same-key waiters materially equivalent, so the build may use the winner's instance.
          this.opts.onBuildStart?.(fingerprint, material, peer);
          const entry = await this.opts.build(fingerprint, material);
          const record: CacheRecord = {
            entry,
            expiresAt: this.now() + this.opts.ttlMs,
            refs: 0,
            retired: false,
            disposeStarted: false,
          };
          // Closed caches cannot publish a completed in-flight build.
          if (this.closed) {
            await this.retire(fingerprint, record);
            throw new Error('credential cache is closed');
          }
          this.evictIfNeeded();
          this.entries.set(fingerprint, record);
          return record;
        });
        const inflight: InflightRecord = {
          controller,
          promise,
          waiters: 0,
          settled: false,
        };
        pending = inflight;
        this.inflight.set(fingerprint, inflight);
        const settle = () => {
          inflight.settled = true;
          if (this.inflight.get(fingerprint) === inflight) {
            this.inflight.delete(fingerprint);
          }
        };
        void promise.then(settle, settle);
      }

      const shared = pending;
      shared.waiters += 1;
      let record: CacheRecord;
      let removeAbortListener: (() => void) | undefined;
      try {
        if (!signal) {
          record = await shared.promise;
        } else if (signal.aborted) {
          throw signal.reason;
        } else {
          record = await new Promise<CacheRecord>((resolve, reject) => {
            const onAbort = () => reject(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });
            removeAbortListener = () =>
              signal.removeEventListener('abort', onAbort);
            void shared.promise.then(resolve, reject);
          });
        }
      } finally {
        removeAbortListener?.();
        shared.waiters -= 1;
        if (shared.waiters === 0 && !shared.settled) {
          // No caller remains to observe a cancellation rejection.
          void shared.promise.catch(() => undefined);
          shared.controller.abort();
        }
      }

      if (this.closed) throw new Error('credential cache is closed');
      if (record.retired || this.entries.get(fingerprint) !== record) continue;
      return this.lease(fingerprint, record);
    }
  }

  /**
   * Retire an entry and wait for its last lease and disposal. Called when
   * Horizon rejects a cached credential, forcing the next request to revalidate
   * without disrupting requests that already hold the retired entry.
   */
  async invalidate(fingerprint: string): Promise<void> {
    const record = this.entries.get(fingerprint);
    if (!record) return;
    await this.retire(fingerprint, record);
  }

  /** Retire expired entries and wait for their leases and disposal. */
  async sweep(): Promise<void> {
    const t = this.now();
    const dead: [string, CacheRecord][] = [];
    for (const [key, record] of this.entries) {
      if (record.expiresAt <= t) dead.push([key, record]);
    }
    await Promise.all(dead.map(([key, record]) => this.retire(key, record)));
  }

  /**
   * Refuse further gets, retire every reusable record, and wait for all builds,
   * outstanding leases, and disposal work before resolving. This method has no
   * internal timeout; `HttpServerHandle.close()` supplies the process-level
   * shutdown bound.
   */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const all = [...this.entries.entries()];
    const retirements = all.map(([key, record]) => this.retire(key, record));
    const builds = [...this.inflight.values()].map(({ promise }) => promise);
    this.closePromise = (async () => {
      // In-flight builds retire themselves when they observe the closed cache.
      await Promise.allSettled(builds);
      await Promise.all(retirements);
      await Promise.all([...this.retirements]);
    })();
    return this.closePromise;
  }

  private evictIfNeeded(): void {
    while (this.entries.size >= this.opts.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      const record = this.entries.get(oldest.value)!;
      void this.retire(oldest.value, record);
    }
  }

  private lease(
    fingerprint: string,
    record: CacheRecord,
  ): { entry: CredentialEntry; releaseLease: () => void } {
    record.refs += 1;
    let released = false;
    return {
      entry: record.entry,
      releaseLease: () => {
        if (released) return;
        released = true;
        record.refs -= 1;
        this.disposeIfReady(fingerprint, record);
      },
    };
  }

  private retire(fingerprint: string, record: CacheRecord): Promise<void> {
    if (this.entries.get(fingerprint) === record) {
      this.entries.delete(fingerprint);
    }
    if (!record.retired) {
      record.retired = true;
      record.retirement = new Promise<void>((resolve) => {
        record.resolveRetirement = resolve;
      });
      this.retirements.add(record.retirement);
      void record.retirement.then(() => {
        this.retirements.delete(record.retirement!);
      });
    }
    this.disposeIfReady(fingerprint, record);
    return record.retirement!;
  }

  private disposeIfReady(fingerprint: string, record: CacheRecord): void {
    if (!record.retired || record.refs !== 0 || record.disposeStarted) return;
    record.disposeStarted = true;
    void this.dispose(fingerprint, record.entry).then(
      () => record.resolveRetirement?.(),
      () => record.resolveRetirement?.(),
    );
  }

  private async dispose(
    fingerprint: string,
    entry: CredentialEntry,
  ): Promise<void> {
    // Run both independently: a stuck client close must not prevent credential
    // cleanup from starting.
    const results = await Promise.allSettled([
      Promise.resolve().then(() => entry.client.close()),
      Promise.resolve().then(() => entry.auth.cleanup()),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        this.opts.onCleanupError?.(fingerprint, r.reason);
      }
    }
  }
}
