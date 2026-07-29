import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SENSITIVE_HEADERS,
  buildSensitiveHeaderSet,
  scrubSensitiveHeaders,
} from '../../src/http/headers.js';

interface FakeReq {
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: string[];
}

function fakeReq(
  headers: Record<string, string>,
  rawHeaders: string[],
): FakeReq {
  return { headers: { ...headers }, rawHeaders: [...rawHeaders] };
}

describe('DEFAULT_SENSITIVE_HEADERS', () => {
  it('covers the standard credential + cert headers', () => {
    for (const name of [
      'x-api-id',
      'x-api-key',
      'x-api-sva',
      'x-api-token',
      'x-oauth-client-id',
      'x-oauth-client-secret',
      'x-oauth-scope',
      'x-oauth-audience',
      'authorization',
      'proxy-authorization',
      'cookie',
      'set-cookie',
      'csrf-token',
      'ssl-client-cert',
      'ssl_client_cert',
      'x-forwarded-client-cert',
      'x-forwarded-tls-client-cert',
    ]) {
      expect(DEFAULT_SENSITIVE_HEADERS.has(name)).toBe(true);
    }
  });
});

describe('buildSensitiveHeaderSet', () => {
  it('adds configured headers, lowercased', () => {
    const set = buildSensitiveHeaderSet(['X-Client-Cert', 'SSL_CLIENT_CERT']);
    expect(set.has('x-client-cert')).toBe(true);
    expect(set.has('ssl_client_cert')).toBe(true);
    // Still includes the defaults.
    expect(set.has('authorization')).toBe(true);
  });
});

describe('scrubSensitiveHeaders', () => {
  it('removes sensitive headers from req.headers (case-insensitive)', () => {
    const req = fakeReq(
      {
        'x-api-id': 'id',
        'x-api-key': 'secret',
        'content-type': 'application/json',
      },
      [
        'X-API-ID',
        'id',
        'X-API-KEY',
        'secret',
        'Content-Type',
        'application/json',
      ],
    );
    scrubSensitiveHeaders(req, DEFAULT_SENSITIVE_HEADERS);
    expect(req.headers['x-api-id']).toBeUndefined();
    expect(req.headers['x-api-key']).toBeUndefined();
    expect(req.headers['content-type']).toBe('application/json');
  });

  it('also removes them from rawHeaders (what @hono/node-server reads)', () => {
    const req = fakeReq(
      { authorization: 'Bearer x', accept: 'text/event-stream' },
      ['Authorization', 'Bearer x', 'Accept', 'text/event-stream'],
    );
    scrubSensitiveHeaders(req, DEFAULT_SENSITIVE_HEADERS);
    expect(req.rawHeaders).toEqual(['Accept', 'text/event-stream']);
  });

  it('scrubs a configured cert header from both views', () => {
    const set = buildSensitiveHeaderSet(['X-Client-Cert']);
    const req = fakeReq({ 'x-client-cert': 'PEM', host: 'mcp:8080' }, [
      'X-Client-Cert',
      'PEM',
      'Host',
      'mcp:8080',
    ]);
    scrubSensitiveHeaders(req, set);
    expect(req.headers['x-client-cert']).toBeUndefined();
    expect(req.rawHeaders).toEqual(['Host', 'mcp:8080']);
  });

  it('leaves protocol headers like Mcp-Session-Id intact', () => {
    const req = fakeReq(
      { 'mcp-session-id': 'abc', accept: 'text/event-stream' },
      ['Mcp-Session-Id', 'abc', 'Accept', 'text/event-stream'],
    );
    scrubSensitiveHeaders(req, DEFAULT_SENSITIVE_HEADERS);
    expect(req.headers['mcp-session-id']).toBe('abc');
    expect(req.rawHeaders).toEqual([
      'Mcp-Session-Id',
      'abc',
      'Accept',
      'text/event-stream',
    ]);
  });
});
