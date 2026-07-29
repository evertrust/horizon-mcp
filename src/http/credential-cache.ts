import type { AuthProvider } from '../auth/base.js';
import type { HorizonClient } from '../client/http.js';

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
  /** Hard ceiling on live entries. Oldest-used is evicted first. */
  readonly max: number;
  /** Entry lifetime in milliseconds. */
  readonly ttlMs: number;
  /** Builds and validates a credential. Must reject if validation fails. */
  readonly build: (fingerprint: string) => Promise<CredentialEntry>;
  readonly now?: () => number;
  /** Reported when closing an evicted entry throws. Never rethrows. */
  readonly onCleanupError?: (fingerprint: string, err: unknown) => void;
}

interface CacheRecord {
  readonly entry: CredentialEntry;
  expiresAt: number;
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
 *  - **Single-flight**: concurrent misses on one fingerprint build exactly once.
 *  - **No negative caching**: a failed or partially-initialized build is never
 *    retained, so a revoked credential cannot be cached as valid and a
 *    transient Horizon outage cannot pin a failure.
 *  - **Cleanup on every exit path**: expiry, eviction, replacement and shutdown
 *    all close the client and clean up the auth provider.
 *  - **Bounded**: LRU by last use, capped at `max`.
 */
export class CredentialCache {
  // Map iteration order is insertion order, and re-inserting on hit makes the
  // first key the least recently used.
  private readonly entries = new Map<string, CacheRecord>();
  private readonly inflight = new Map<string, Promise<CredentialEntry>>();
  private closed = false;

  constructor(private readonly opts: CredentialCacheOptions) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Return a validated credential for `fingerprint`, building it if needed.
   * Concurrent callers with the same fingerprint share one build.
   */
  async get(fingerprint: string): Promise<CredentialEntry> {
    if (this.closed) throw new Error('credential cache is closed');

    const hit = this.entries.get(fingerprint);
    if (hit) {
      if (hit.expiresAt > this.now()) {
        // Refresh LRU position and extend the idle window.
        this.entries.delete(fingerprint);
        hit.expiresAt = this.now() + this.opts.ttlMs;
        this.entries.set(fingerprint, hit);
        return hit.entry;
      }
      this.entries.delete(fingerprint);
      void this.dispose(fingerprint, hit.entry);
    }

    const pending = this.inflight.get(fingerprint);
    if (pending) return pending;

    const build = (async () => {
      const entry = await this.opts.build(fingerprint);
      // A close() that landed mid-build must not leave a live client behind,
      // and the entry must not be published into a closed cache.
      if (this.closed) {
        await this.dispose(fingerprint, entry);
        throw new Error('credential cache is closed');
      }
      this.evictIfNeeded();
      this.entries.set(fingerprint, {
        entry,
        expiresAt: this.now() + this.opts.ttlMs,
      });
      return entry;
    })();

    this.inflight.set(fingerprint, build);
    try {
      return await build;
    } finally {
      // Always drop the in-flight marker, including on rejection, so a failure
      // is never cached and the next request retries.
      this.inflight.delete(fingerprint);
    }
  }

  /**
   * Drop an entry and close it. Called when Horizon rejects a cached credential
   * (for example it was revoked upstream before its TTL expired), forcing the
   * next request to revalidate.
   */
  async invalidate(fingerprint: string): Promise<void> {
    const record = this.entries.get(fingerprint);
    if (!record) return;
    this.entries.delete(fingerprint);
    await this.dispose(fingerprint, record.entry);
  }

  /** Drop and close every expired entry. */
  async sweep(): Promise<void> {
    const t = this.now();
    const dead: [string, CredentialEntry][] = [];
    for (const [key, record] of this.entries) {
      if (record.expiresAt <= t) dead.push([key, record.entry]);
    }
    for (const [key] of dead) this.entries.delete(key);
    await Promise.all(dead.map(([key, entry]) => this.dispose(key, entry)));
  }

  /** Close every entry. The cache refuses further gets afterwards. */
  async close(): Promise<void> {
    this.closed = true;
    const all = [...this.entries.entries()];
    this.entries.clear();
    // Let in-flight builds settle so their clients get disposed rather than
    // leaked; each one disposes itself on seeing `closed`.
    await Promise.allSettled([...this.inflight.values()]);
    await Promise.all(all.map(([key, r]) => this.dispose(key, r.entry)));
  }

  private evictIfNeeded(): void {
    while (this.entries.size >= this.opts.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      const record = this.entries.get(oldest.value)!;
      this.entries.delete(oldest.value);
      void this.dispose(oldest.value, record.entry);
    }
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
