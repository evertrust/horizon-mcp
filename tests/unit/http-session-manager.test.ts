import { describe, expect, it } from 'vitest';

import { SessionManager } from '../../src/http/session-manager.js';

function fakeResources() {
  const calls = { server: 0, transport: 0, client: 0, auth: 0 };
  return {
    calls,
    server: {
      close: async () => {
        calls.server++;
      },
    },
    transport: {
      close: async () => {
        calls.transport++;
      },
    },
    client: {
      close: async () => {
        calls.client++;
      },
    },
    auth: {
      cleanup: async () => {
        calls.auth++;
      },
    },
  };
}

function makeManager(
  over: Partial<ConstructorParameters<typeof SessionManager>[0]> = {},
) {
  return new SessionManager({
    maxSessions: 256,
    idleTtlMs: 300_000,
    absTtlMs: 3_600_000,
    maxInflight: 8,
    ...over,
  });
}

function add(mgr: SessionManager, id: string, fp?: string) {
  const r = fakeResources();
  mgr.create({
    sessionId: id,
    server: r.server,
    transport: r.transport,
    client: r.client,
    auth: r.auth,
    credentialFingerprint: fp,
  });
  return r;
}

describe('SessionManager basics', () => {
  it('tracks size and enforces maxSessions', () => {
    const mgr = makeManager({ maxSessions: 2 });
    expect(mgr.canCreate()).toBe(true);
    add(mgr, 's1');
    add(mgr, 's2');
    expect(mgr.size).toBe(2);
    expect(mgr.canCreate()).toBe(false);
  });

  it('reserves admission capacity atomically across pending initializes', () => {
    const mgr = makeManager({ maxSessions: 2 });
    expect(mgr.tryReserve()).toBe(true);
    expect(mgr.tryReserve()).toBe(true);
    // Both slots reserved (no live sessions yet) -> at capacity.
    expect(mgr.tryReserve()).toBe(false);
    expect(mgr.canCreate()).toBe(false);
  });

  it('create() converts a reservation without double counting', () => {
    const mgr = makeManager({ maxSessions: 1 });
    expect(mgr.tryReserve()).toBe(true);
    add(mgr, 's1'); // create() converts the reservation
    expect(mgr.size).toBe(1);
    expect(mgr.canCreate()).toBe(false);
    expect(mgr.tryReserve()).toBe(false);
  });

  it('releaseReservation frees a reservation that never became a session', () => {
    const mgr = makeManager({ maxSessions: 1 });
    expect(mgr.tryReserve()).toBe(true);
    expect(mgr.canCreate()).toBe(false);
    mgr.releaseReservation();
    expect(mgr.canCreate()).toBe(true);
    expect(mgr.tryReserve()).toBe(true);
  });

  it('transitions state to ready on markReady', () => {
    const mgr = makeManager();
    add(mgr, 's1');
    expect(mgr.peek('s1')?.state).toBe('initializing');
    mgr.markReady('s1');
    expect(mgr.peek('s1')?.state).toBe('ready');
  });

  it('reserves and releases inflight up to the max', () => {
    const mgr = makeManager({ maxInflight: 2 });
    add(mgr, 's1');
    expect(mgr.reserveInflight('s1')).toBe(true);
    expect(mgr.reserveInflight('s1')).toBe(true);
    expect(mgr.reserveInflight('s1')).toBe(false);
    mgr.releaseInflight('s1');
    expect(mgr.reserveInflight('s1')).toBe(true);
  });
});

describe('teardown discipline', () => {
  it('DELETE path closes Horizon resources only, never an MCP primitive', async () => {
    const mgr = makeManager();
    const r = add(mgr, 's1');
    await mgr.handleSessionClosed('s1');
    expect(r.calls.client).toBe(1);
    expect(r.calls.auth).toBe(1);
    expect(r.calls.server).toBe(0); // SDK already closed the transport+server
    expect(r.calls.transport).toBe(0);
    expect(mgr.size).toBe(0);
  });

  it('DELETE path is idempotent', async () => {
    const mgr = makeManager();
    const r = add(mgr, 's1');
    await mgr.handleSessionClosed('s1');
    await mgr.handleSessionClosed('s1');
    expect(r.calls.client).toBe(1);
    expect(r.calls.auth).toBe(1);
  });

  it('TTL path closes exactly one MCP primitive (server) then Horizon', async () => {
    const mgr = makeManager();
    const r = add(mgr, 's1');
    await mgr.teardown('s1', 'ttl');
    expect(r.calls.server).toBe(1); // cascades to transport in the SDK
    expect(r.calls.transport).toBe(0); // we never close both
    expect(r.calls.client).toBe(1);
    expect(r.calls.auth).toBe(1);
    expect(mgr.size).toBe(0);
  });

  it('TTL path is idempotent (guarded by the closed flag)', async () => {
    const mgr = makeManager();
    const r = add(mgr, 's1');
    await mgr.teardown('s1', 'ttl');
    await mgr.teardown('s1', 'ttl');
    expect(r.calls.server).toBe(1);
    expect(r.calls.client).toBe(1);
  });

  it('a cascaded onsessionclosed after teardown does not double-clean', async () => {
    const mgr = makeManager();
    const r = add(mgr, 's1');
    await mgr.teardown('s1', 'ttl');
    await mgr.handleSessionClosed('s1'); // the cascade
    expect(r.calls.client).toBe(1);
    expect(r.calls.auth).toBe(1);
    expect(r.calls.server).toBe(1);
  });
});

describe('sweepExpired', () => {
  it('tears down idle-expired sessions', async () => {
    let t = 1000;
    const mgr = makeManager({ idleTtlMs: 100, absTtlMs: 10_000, now: () => t });
    const r = add(mgr, 's1');
    t = 1050;
    expect(await mgr.sweepExpired()).toEqual([]); // idle 50 < 100
    t = 1200;
    expect(await mgr.sweepExpired()).toEqual(['s1']); // idle 200 >= 100
    expect(r.calls.server).toBe(1);
    expect(mgr.size).toBe(0);
  });

  it('tears down absolute-expired sessions even when recently active', async () => {
    let t = 1000;
    const mgr = makeManager({
      idleTtlMs: 10_000,
      absTtlMs: 1000,
      now: () => t,
    });
    add(mgr, 's1');
    t = 1500;
    mgr.get('s1'); // refresh lastSeenAt -> idle stays low
    t = 2001;
    expect(await mgr.sweepExpired()).toEqual(['s1']); // age 1001 >= 1000
  });
});

describe('active stream keeps a session alive past idle TTL', () => {
  it('skips idle sweep while a stream is attached but still honors absolute TTL', async () => {
    let t = 1000;
    const mgr = makeManager({
      idleTtlMs: 100,
      absTtlMs: 10_000,
      now: () => t,
    });
    add(mgr, 's1');
    mgr.addStream('s1');
    t = 1500; // idle 500 >= 100, but a stream is attached -> not swept
    expect(await mgr.sweepExpired()).toEqual([]);
  });

  it('reaps a streaming session once the absolute TTL is reached', async () => {
    let t = 1000;
    const mgr = makeManager({ idleTtlMs: 100, absTtlMs: 500, now: () => t });
    const r = add(mgr, 's1');
    mgr.addStream('s1');
    t = 1600; // age 600 >= 500 absolute TTL fires despite the open stream
    expect(await mgr.sweepExpired()).toEqual(['s1']);
    expect(r.calls.server).toBe(1);
  });

  it('sweeps normally after the stream closes', async () => {
    let t = 1000;
    const mgr = makeManager({
      idleTtlMs: 100,
      absTtlMs: 10_000,
      now: () => t,
    });
    add(mgr, 's1');
    mgr.addStream('s1');
    t = 5000;
    expect(await mgr.sweepExpired()).toEqual([]); // survives while streaming
    mgr.removeStream('s1'); // refreshes lastSeenAt at t=5000
    t = 5050;
    expect(await mgr.sweepExpired()).toEqual([]); // idle 50 < 100
    t = 5200;
    expect(await mgr.sweepExpired()).toEqual(['s1']); // idle 200 >= 100
  });
});

describe('shutdownAll', () => {
  it('tears down every live session', async () => {
    const mgr = makeManager();
    const r1 = add(mgr, 's1');
    const r2 = add(mgr, 's2');
    await mgr.shutdownAll();
    expect(mgr.size).toBe(0);
    expect(r1.calls.server).toBe(1);
    expect(r2.calls.server).toBe(1);
    expect(r1.calls.client).toBe(1);
    expect(r2.calls.client).toBe(1);
  });
});
