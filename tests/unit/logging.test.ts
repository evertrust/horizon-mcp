import { afterEach, describe, expect, it } from 'vitest';

import {
  getLogger,
  runWithLoggingSink,
  setMcpLoggingSink,
} from '../../src/logging.js';

afterEach(() => {
  // Never leak a global sink between tests.
  setMcpLoggingSink(undefined);
});

describe('logging sink routing', () => {
  it('routes logs to the active session sink', () => {
    const sessionLogs: string[] = [];
    const log = getLogger('test');
    runWithLoggingSink(
      (_level, p) => sessionLogs.push(p.msg),
      () => log.info('hello'),
    );
    expect(sessionLogs).toEqual(['hello']);
  });

  it('does not leak a session sink outside its scope', () => {
    const sessionLogs: string[] = [];
    const log = getLogger('test');
    runWithLoggingSink(
      (_level, p) => sessionLogs.push(p.msg),
      () => log.info('inside'),
    );
    log.info('outside');
    expect(sessionLogs).toEqual(['inside']);
  });

  it('keeps two concurrent session sinks isolated across awaits', async () => {
    const a: string[] = [];
    const b: string[] = [];
    const log = getLogger('iso');

    async function sessionA(): Promise<void> {
      log.info('a1');
      await new Promise((r) => setTimeout(r, 5));
      log.info('a2');
    }
    async function sessionB(): Promise<void> {
      log.info('b1');
      await new Promise((r) => setTimeout(r, 5));
      log.info('b2');
    }

    await Promise.all([
      runWithLoggingSink((_level, p) => a.push(p.msg), sessionA),
      runWithLoggingSink((_level, p) => b.push(p.msg), sessionB),
    ]);

    expect(a).toEqual(['a1', 'a2']);
    expect(b).toEqual(['b1', 'b2']);
  });

  it('prefers the session sink over a global sink', () => {
    const globalLogs: string[] = [];
    const sessionLogs: string[] = [];
    setMcpLoggingSink((_level, p) => globalLogs.push(p.msg));
    const log = getLogger('test');
    runWithLoggingSink(
      (_level, p) => sessionLogs.push(p.msg),
      () => log.info('scoped'),
    );
    expect(sessionLogs).toEqual(['scoped']);
    expect(globalLogs).toEqual([]);
  });

  it('falls back to the global sink outside a session scope', () => {
    const globalLogs: string[] = [];
    setMcpLoggingSink((_level, p) => globalLogs.push(p.msg));
    getLogger('test').info('global');
    expect(globalLogs).toContain('global');
  });

  it('swallows session sink errors', () => {
    const log = getLogger('test');
    expect(() =>
      runWithLoggingSink(
        () => {
          throw new Error('boom');
        },
        () => log.info('x'),
      ),
    ).not.toThrow();
  });
});
