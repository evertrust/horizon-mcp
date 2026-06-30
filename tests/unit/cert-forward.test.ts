import { describe, expect, it } from 'vitest';

import { CertForwardAuthProvider } from '../../src/auth/cert-forward.js';

const PEM =
  '-----BEGIN CERTIFICATE-----\nMIIBdummycertbody==\n-----END CERTIFICATE-----\n';

describe('CertForwardAuthProvider', () => {
  it('forwards the cert as a URL-encoded PEM in the configured header', async () => {
    const provider = new CertForwardAuthProvider('SSL_CLIENT_CERT', PEM);
    const headers = await provider.getHeaders();
    expect(headers).toEqual({ SSL_CLIENT_CERT: encodeURIComponent(PEM) });
  });

  it('preserves a custom forward header name', async () => {
    const provider = new CertForwardAuthProvider(
      'X-Forwarded-Client-Cert',
      PEM,
    );
    const headers = await provider.getHeaders();
    expect(Object.keys(headers)).toEqual(['X-Forwarded-Client-Cert']);
  });

  it('rejects input that is not a PEM certificate', () => {
    expect(
      () => new CertForwardAuthProvider('SSL_CLIENT_CERT', 'nonsense'),
    ).toThrow(/PEM certificate/i);
  });

  it('returns a fresh headers object on each call (no shared mutation)', async () => {
    const provider = new CertForwardAuthProvider('SSL_CLIENT_CERT', PEM);
    const a = await provider.getHeaders();
    const b = await provider.getHeaders();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('does not present a client cert on the MCP->Horizon hop (header only)', () => {
    const provider = new CertForwardAuthProvider('SSL_CLIENT_CERT', PEM);
    expect(provider.getDispatcherOptions()).toBeUndefined();
  });

  it('refreshIfNeeded is a no-op', async () => {
    const provider = new CertForwardAuthProvider('SSL_CLIENT_CERT', PEM);
    await expect(provider.refreshIfNeeded()).resolves.toBeUndefined();
  });
});
