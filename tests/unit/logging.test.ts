import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureLogging, getLogger } from '../../src/logging.js';

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
  return { lines, restore: () => spy.mockRestore() };
}

afterEach(() => {
  configureLogging('info');
});

describe('logging', () => {
  it('writes structured JSON to stderr', () => {
    const { lines, restore } = captureStderr();
    try {
      getLogger('test').info('hello');
    } finally {
      restore();
    }

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry['level']).toBe('INFO');
    expect(entry['logger']).toBe('test');
    expect(entry['msg']).toBe('hello');
    expect(typeof entry['ts']).toBe('string');
  });

  it('merges extra fields into the entry', () => {
    const { lines, restore } = captureStderr();
    try {
      getLogger('test').info('with extra', { request_id: 'r1', status: 200 });
    } finally {
      restore();
    }

    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry['request_id']).toBe('r1');
    expect(entry['status']).toBe(200);
  });

  it('drops entries below the configured level', () => {
    configureLogging('error');
    const { lines, restore } = captureStderr();
    try {
      const log = getLogger('test');
      log.info('suppressed');
      log.error('kept');
    } finally {
      restore();
    }

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)['msg']).toBe('kept');
  });

  // MCP 2026-07-28 deprecates the Logging capability (SEP-2577) and forbids
  // emitting `notifications/message` for a request that did not opt in. The
  // server no longer declares the capability, so logging must have no MCP-facing
  // side channel at all - stderr is the only destination.
  it('exposes no MCP logging sink', async () => {
    const mod: Record<string, unknown> = await import('../../src/logging.js');
    expect(mod['setMcpLoggingSink']).toBeUndefined();
    expect(mod['runWithLoggingSink']).toBeUndefined();
  });
});
