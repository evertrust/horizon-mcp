/**
 * A counting semaphore with non-blocking acquisition.
 *
 * Serving is per-request under MCP 2026-07-28: every request builds its own
 * MCP server instance, so the number of simultaneous requests is what bounds
 * peak heap. A requests-per-second limiter does not bound concurrency (slow
 * requests accumulate), so this is a separate control.
 */
export class Semaphore {
  private available: number;

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError('semaphore capacity must be a positive integer');
    }
    this.available = capacity;
  }

  get free(): number {
    return this.available;
  }

  get inUse(): number {
    return this.capacity - this.available;
  }

  /**
   * Take one permit if available. Returns a release function, or undefined
   * when at capacity. The release is idempotent, so wiring it to more than one
   * response event is safe.
   */
  tryAcquire(): (() => void) | undefined {
    if (this.available <= 0) return undefined;
    this.available -= 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.available = Math.min(this.capacity, this.available + 1);
    };
  }
}

/**
 * A set of per-key counting semaphores, used to cap concurrent work for one
 * credential without letting a single caller exhaust the global budget.
 * Entries are dropped when idle so the map stays bounded by active callers.
 */
export class KeyedSemaphore {
  private readonly counts = new Map<string, number>();

  constructor(private readonly perKey: number) {
    if (!Number.isSafeInteger(perKey) || perKey <= 0) {
      throw new RangeError('per-key limit must be a positive integer');
    }
  }

  tryAcquire(key: string): (() => void) | undefined {
    const current = this.counts.get(key) ?? 0;
    if (current >= this.perKey) return undefined;
    this.counts.set(key, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.counts.get(key) ?? 1) - 1;
      if (n <= 0) this.counts.delete(key);
      else this.counts.set(key, n);
    };
  }

  /** Active keys. Exposed for tests and diagnostics. */
  get size(): number {
    return this.counts.size;
  }
}
