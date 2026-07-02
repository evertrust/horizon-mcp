export type SessionState = 'initializing' | 'ready' | 'closing';

/** Closable MCP + Horizon resources owned by one session. */
export interface SessionResources {
  server: { close(): Promise<void> };
  transport: { close(): Promise<void> };
  client: { close(): Promise<void> };
  auth: { cleanup(): Promise<void> };
}

export interface SessionRecord extends SessionResources {
  sessionId: string;
  credentialFingerprint?: string;
  state: SessionState;
  createdAt: number;
  lastSeenAt: number;
  closed: boolean;
  inflight: number;
  /** Open standalone SSE streams; a positive count defers the idle sweep. */
  activeStreams: number;
}

export interface SessionManagerOptions {
  maxSessions: number;
  idleTtlMs: number;
  absTtlMs: number;
  maxInflight: number;
  now?: () => number;
  /** Called after a session is torn down (any path), for ancillary cleanup. */
  onTeardown?: (sessionId: string, reason: string) => void;
}

/**
 * Owns the live HTTP sessions: lifecycle state, idle/absolute TTLs, inflight
 * accounting, and the teardown discipline.
 *
 * Teardown closes exactly ONE MCP primitive, never both, because in SDK 1.29.0
 * closing the server cascades to the transport and vice-versa:
 *  - DELETE: the SDK already ran onsessionclosed then transport.close(), so
 *    `handleSessionClosed` only drops the record + closes Horizon resources.
 *  - idle/absolute TTL (and shutdown): no SDK callback fires, so `teardown`
 *    calls `server.close()` (which cascades to the transport) then closes
 *    Horizon resources.
 * A per-session `closed` flag makes any cascaded or stray second call a no-op.
 */
export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  // Capacity reserved by initializes that are validating but not yet registered.
  private pending = 0;

  constructor(private readonly opts: SessionManagerOptions) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  get size(): number {
    return this.sessions.size;
  }

  canCreate(): boolean {
    return this.sessions.size + this.pending < this.opts.maxSessions;
  }

  /**
   * Atomically reserve admission capacity for an initializing session, counting
   * both live and pending sessions so concurrent initializes cannot overshoot
   * maxSessions. Returns false when at capacity. Pair every true result with
   * exactly one create() (which converts the reservation) or
   * releaseReservation() (which drops it).
   */
  tryReserve(): boolean {
    if (this.sessions.size + this.pending >= this.opts.maxSessions) {
      return false;
    }
    this.pending += 1;
    return true;
  }

  /** Drop a reservation that never became a session. */
  releaseReservation(): void {
    this.pending = Math.max(0, this.pending - 1);
  }

  /** Register a freshly initialized session. */
  create(input: {
    sessionId: string;
    credentialFingerprint?: string;
    server: SessionResources['server'];
    transport: SessionResources['transport'];
    client: SessionResources['client'];
    auth: SessionResources['auth'];
  }): SessionRecord {
    // Convert the admission reservation (if this came through tryReserve).
    this.pending = Math.max(0, this.pending - 1);
    const t = this.now();
    const record: SessionRecord = {
      ...input,
      state: 'initializing',
      createdAt: t,
      lastSeenAt: t,
      closed: false,
      inflight: 0,
      activeStreams: 0,
    };
    this.sessions.set(input.sessionId, record);
    return record;
  }

  /** Look up a session and refresh its idle timer. */
  get(sessionId: string): SessionRecord | undefined {
    const record = this.sessions.get(sessionId);
    if (record) record.lastSeenAt = this.now();
    return record;
  }

  /** Look up a session WITHOUT refreshing its idle timer. */
  peek(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /** Refresh a session's idle timer without returning the record. */
  touch(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (record) record.lastSeenAt = this.now();
  }

  /** Mark a standalone SSE stream as attached (defers the idle sweep). */
  addStream(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (record) record.activeStreams += 1;
  }

  /** Detach a standalone SSE stream and restart the idle timer from now. */
  removeStream(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (record) {
      record.activeStreams = Math.max(0, record.activeStreams - 1);
      record.lastSeenAt = this.now();
    }
  }

  markReady(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (record) record.state = 'ready';
  }

  reserveInflight(sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    if (record.inflight >= this.opts.maxInflight) return false;
    record.inflight += 1;
    return true;
  }

  releaseInflight(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (record) record.inflight = Math.max(0, record.inflight - 1);
  }

  /**
   * DELETE path: the SDK already closed the transport (which cascaded to the
   * server), so close Horizon resources ONLY and drop the record.
   */
  async handleSessionClosed(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record || record.closed) return;
    record.closed = true;
    record.state = 'closing';
    this.sessions.delete(sessionId);
    await this.closeHorizon(record);
    this.opts.onTeardown?.(sessionId, 'delete');
  }

  /**
   * TTL / shutdown path: close exactly one MCP primitive (`server.close()`,
   * which cascades to the transport) then Horizon resources. Idempotent.
   */
  async teardown(sessionId: string, reason: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record || record.closed) return;
    record.closed = true;
    record.state = 'closing';
    // Delete before closing so the cascaded onsessionclosed finds nothing.
    this.sessions.delete(sessionId);
    try {
      await record.server.close();
    } catch {
      // best-effort - the closed flag already prevents re-entry
    }
    await this.closeHorizon(record);
    this.opts.onTeardown?.(sessionId, reason);
  }

  private async closeHorizon(record: SessionRecord): Promise<void> {
    try {
      await record.client.close();
    } catch {
      // best-effort
    }
    try {
      await record.auth.cleanup();
    } catch {
      // best-effort
    }
  }

  /** Tear down idle- or absolute-expired sessions. Returns the swept ids. */
  async sweepExpired(): Promise<string[]> {
    const t = this.now();
    const expired: string[] = [];
    for (const [id, record] of this.sessions) {
      if (record.closed) continue;
      const idle = t - record.lastSeenAt;
      const age = t - record.createdAt;
      // An attached SSE stream defers the idle sweep (the stream refreshes
      // lastSeenAt only at open), but the absolute TTL still reaps the session.
      const idleExpired =
        idle >= this.opts.idleTtlMs && record.activeStreams === 0;
      if (idleExpired || age >= this.opts.absTtlMs) {
        expired.push(id);
      }
    }
    for (const id of expired) {
      await this.teardown(id, 'ttl');
    }
    return expired;
  }

  /** Tear down every live session (graceful shutdown). */
  async shutdownAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      await this.teardown(id, 'shutdown');
    }
  }
}
