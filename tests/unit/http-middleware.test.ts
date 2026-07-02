import { describe, expect, it } from 'vitest';

import { isHostAllowed, isOriginAllowed } from '../../src/http/middleware.js';

describe('isHostAllowed', () => {
  const allowed = new Set(['mcp.example.com', '127.0.0.1:8080']);

  it('accepts an allowed host', () => {
    expect(isHostAllowed('mcp.example.com', allowed)).toBe(true);
    expect(isHostAllowed('127.0.0.1:8080', allowed)).toBe(true);
  });

  it('is case-insensitive and tolerates a trailing dot', () => {
    expect(isHostAllowed('MCP.Example.com', allowed)).toBe(true);
    expect(isHostAllowed('mcp.example.com.', allowed)).toBe(true);
  });

  it('rejects a host not in the allow-list', () => {
    expect(isHostAllowed('evil.example.com', allowed)).toBe(false);
  });

  it('rejects a missing Host header', () => {
    expect(isHostAllowed(undefined, allowed)).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  const allowed = new Set(['https://app.example.com']);

  it('allows a request with no Origin (non-browser MCP client)', () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });

  it('allows a listed Origin', () => {
    expect(isOriginAllowed('https://app.example.com', allowed)).toBe(true);
  });

  it('is case-insensitive on the Origin value', () => {
    expect(isOriginAllowed('https://APP.example.com', allowed)).toBe(true);
  });

  it('rejects an unlisted Origin', () => {
    expect(isOriginAllowed('https://evil.example.com', allowed)).toBe(false);
  });

  it('rejects any Origin when none are configured', () => {
    expect(isOriginAllowed('https://app.example.com', new Set())).toBe(false);
  });
});
