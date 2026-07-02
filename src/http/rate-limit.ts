interface Window {
  start: number;
  count: number;
}

/**
 * Fixed-window rate limiter keyed by an arbitrary string (session id, remote
 * address, or a constant for a global cap). A limit of 0 disables it entirely.
 * The window is one second.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
    // Per-key ceilings that override the base limit (e.g. a global key that
    // caps aggregate traffic above the per-peer limit). A base limit of 0
    // still disables the limiter entirely, overrides included.
    private readonly overrides: Readonly<Record<string, number>> = {},
  ) {}

  private limitFor(key: string): number {
    return this.overrides[key] ?? this.limit;
  }

  private windowFor(key: string, t: number): Window {
    let w = this.windows.get(key);
    if (!w || t - w.start >= 1000) {
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    return w;
  }

  /** Try to consume `cost` from one key's budget. */
  tryAcquire(key: string, cost = 1): boolean {
    if (this.limit <= 0) return true;
    const w = this.windowFor(key, this.now());
    if (w.count + cost > this.limitFor(key)) return false;
    w.count += cost;
    return true;
  }

  /**
   * Atomic across multiple keys: consume `cost` from every key only if all have
   * capacity, otherwise consume nothing and return false. Used for the init
   * limit (a global cap AND a per-remote-address cap).
   */
  tryAcquireAll(keys: readonly string[], cost = 1): boolean {
    if (this.limit <= 0) return true;
    const t = this.now();
    const targets = keys.map((k) => ({ key: k, w: this.windowFor(k, t) }));
    if (targets.some(({ key, w }) => w.count + cost > this.limitFor(key))) {
      return false;
    }
    for (const { w } of targets) w.count += cost;
    return true;
  }

  /** Drop a key's window (e.g. on session teardown). */
  forget(key: string): void {
    this.windows.delete(key);
  }

  /**
   * Delete windows whose period has fully elapsed. Bounds the key map for
   * limiters keyed by unbounded values (e.g. the per-remote-address init
   * limiter). Safe to call periodically.
   */
  prune(): void {
    const t = this.now();
    for (const [key, w] of this.windows) {
      if (t - w.start >= 1000) this.windows.delete(key);
    }
  }
}
