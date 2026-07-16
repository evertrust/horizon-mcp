import { describe, expect, it } from 'vitest';

import { ApiKeyAuthProvider } from '../../src/auth/apikey.js';
import { CertForwardAuthProvider } from '../../src/auth/cert-forward.js';
import type { HttpConfig } from '../../src/http/config.js';
import {
  CredentialError,
  buildSessionAuth,
  credentialFingerprintOf,
  decodeForwardedCert,
  extractCredential,
  peerMatchesProxy,
} from '../../src/http/credentials.js';
import { credentialFingerprint } from '../../src/http/fingerprint.js';
import { loadSettings } from '../../src/settings.js';

const PEM =
  '-----BEGIN CERTIFICATE-----\nMIIBdummy==\n-----END CERTIFICATE-----\n';

function cfg(over: Partial<HttpConfig>): HttpConfig {
  return {
    host: '127.0.0.1',
    port: 8080,
    path: '/mcp',
    publicEndpoint: 'http://127.0.0.1:8080/mcp',
    allowedHosts: new Set(['127.0.0.1:8080']),
    allowedOrigins: new Set(),
    authMode: 'service',
    ...over,
  };
}

function req(
  headers: Record<string, string>,
  socket: Record<string, unknown> = {},
) {
  return { headers: { ...headers }, socket } as never;
}

describe('peerMatchesProxy', () => {
  it('matches an exact IPv4 address', () => {
    expect(peerMatchesProxy('10.0.0.5', '10.0.0.5')).toBe(true);
    expect(peerMatchesProxy('10.0.0.6', '10.0.0.5')).toBe(false);
  });

  it('matches an IPv4 CIDR range', () => {
    expect(peerMatchesProxy('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(peerMatchesProxy('11.0.0.1', '10.0.0.0/8')).toBe(false);
  });

  it('normalizes IPv4-mapped IPv6 peers', () => {
    expect(peerMatchesProxy('::ffff:10.0.0.5', '10.0.0.0/8')).toBe(true);
  });

  it('returns false for a missing remote address', () => {
    expect(peerMatchesProxy(undefined, '10.0.0.0/8')).toBe(false);
  });

  it('returns false for an out-of-range CIDR prefix', () => {
    expect(peerMatchesProxy('10.0.0.1', '10.0.0.0/40')).toBe(false);
  });
});

describe('decodeForwardedCert', () => {
  it('decodes a URL-encoded PEM (nginx $ssl_client_escaped_cert)', () => {
    expect(decodeForwardedCert(encodeURIComponent(PEM))).toContain(
      'BEGIN CERTIFICATE',
    );
  });

  it('accepts a raw PEM', () => {
    expect(decodeForwardedCert(PEM)).toContain('BEGIN CERTIFICATE');
  });

  it('wraps a base64 DER value into PEM', () => {
    const b64 = Buffer.from('dummy-der-bytes').toString('base64');
    expect(decodeForwardedCert(b64)).toContain('BEGIN CERTIFICATE');
  });
});

describe('extractCredential', () => {
  describe('service mode', () => {
    it('accepts a request with no client credential', () => {
      const m = extractCredential(req({}), cfg({ authMode: 'service' }));
      expect(m.kind).toBe('service');
    });

    it('rejects a client-supplied API key', () => {
      expect(() =>
        extractCredential(
          req({ 'x-api-id': 'id', 'x-api-key': 'k' }),
          cfg({ authMode: 'service' }),
        ),
      ).toThrow(CredentialError);
    });

    it('rejects a client-supplied cert header', () => {
      expect(() =>
        extractCredential(
          req({ 'x-forwarded-client-cert': PEM }),
          cfg({ authMode: 'service' }),
        ),
      ).toThrow(CredentialError);
    });

    it('rejects a client-supplied Authorization header', () => {
      expect(() =>
        extractCredential(
          req({ authorization: 'Bearer x' }),
          cfg({ authMode: 'service' }),
        ),
      ).toThrow(CredentialError);
    });

    it('rejects a client-supplied Cookie header', () => {
      expect(() =>
        extractCredential(
          req({ cookie: 'session=x' }),
          cfg({ authMode: 'service' }),
        ),
      ).toThrow(CredentialError);
    });
  });

  describe('api-key mode', () => {
    it('extracts the API key headers', () => {
      const m = extractCredential(
        req({ 'x-api-id': 'id', 'x-api-key': 'secret' }),
        cfg({ authMode: 'api-key' }),
      );
      expect(m).toEqual({ kind: 'api-key', apiId: 'id', apiKey: 'secret' });
    });

    it('rejects a missing API key', () => {
      expect(() =>
        extractCredential(
          req({ 'x-api-id': 'id' }),
          cfg({ authMode: 'api-key' }),
        ),
      ).toThrow(CredentialError);
    });
  });

  describe('mtls mode (inbound header topology)', () => {
    const inboundCfg = cfg({
      authMode: 'mtls',
      mtls: {
        forwardHeader: 'SSL_CLIENT_CERT',
        inbound: { header: 'x-client-cert', trustedProxy: '10.0.0.0/8' },
      },
    });

    it('extracts the cert when the peer is the trusted proxy', () => {
      const m = extractCredential(
        req(
          { 'x-client-cert': encodeURIComponent(PEM) },
          { remoteAddress: '10.0.0.9' },
        ),
        inboundCfg,
      );
      expect(m.kind).toBe('cert');
    });

    it('rejects the inbound cert from an untrusted peer', () => {
      expect(() =>
        extractCredential(
          req(
            { 'x-client-cert': encodeURIComponent(PEM) },
            { remoteAddress: '192.168.1.1' },
          ),
          inboundCfg,
        ),
      ).toThrow(CredentialError);
    });

    it('rejects a missing cert header', () => {
      expect(() =>
        extractCredential(req({}, { remoteAddress: '10.0.0.9' }), inboundCfg),
      ).toThrow(CredentialError);
    });
  });

  describe('mtls mode (TLS listener topology)', () => {
    const listenerCfg = cfg({
      authMode: 'mtls',
      mtls: {
        forwardHeader: 'SSL_CLIENT_CERT',
        listener: { certPath: '/c', keyPath: '/k' },
      },
    });

    it('extracts the presented peer certificate', () => {
      const m = extractCredential(
        req({}, { getPeerCertificate: () => ({ raw: Buffer.from('der') }) }),
        listenerCfg,
      );
      expect(m.kind).toBe('cert');
    });

    it('rejects when no client certificate was presented', () => {
      expect(() =>
        extractCredential(
          req({}, { getPeerCertificate: () => ({}) }),
          listenerCfg,
        ),
      ).toThrow(CredentialError);
    });
  });
});

describe('buildSessionAuth', () => {
  it('service mode uses the env credential and binds no fingerprint', () => {
    const settings = loadSettings({
      HORIZON_API_ID: 'env',
      HORIZON_API_KEY: 'k',
    });
    const { auth, fingerprint } = buildSessionAuth(
      { kind: 'service' },
      cfg({ authMode: 'service' }),
      settings,
    );
    expect(auth).toBeInstanceOf(ApiKeyAuthProvider);
    expect(fingerprint).toBeUndefined();
  });

  it('api-key mode builds an ApiKeyAuthProvider with a credential fingerprint', () => {
    const settings = loadSettings({});
    const { auth, fingerprint } = buildSessionAuth(
      { kind: 'api-key', apiId: 'id', apiKey: 'secret' },
      cfg({ authMode: 'api-key' }),
      settings,
    );
    expect(auth).toBeInstanceOf(ApiKeyAuthProvider);
    expect(fingerprint).toBe(
      credentialFingerprint(JSON.stringify(['id', 'secret'])),
    );
  });

  it('mtls mode builds a CertForwardAuthProvider with a cert fingerprint', () => {
    const settings = loadSettings({});
    const { auth, fingerprint } = buildSessionAuth(
      { kind: 'cert', pem: PEM },
      cfg({
        authMode: 'mtls',
        mtls: {
          forwardHeader: 'SSL_CLIENT_CERT',
          listener: { certPath: '/c', keyPath: '/k' },
        },
      }),
      settings,
    );
    expect(auth).toBeInstanceOf(CertForwardAuthProvider);
    expect(fingerprint).toBe(credentialFingerprint(PEM));
  });
});

describe('credentialFingerprintOf', () => {
  it('cannot collide when API id/key boundaries contain colons', () => {
    const left = credentialFingerprintOf({
      kind: 'api-key',
      apiId: 'tenant:a',
      apiKey: 'secret',
    });
    const right = credentialFingerprintOf({
      kind: 'api-key',
      apiId: 'tenant',
      apiKey: 'a:secret',
    });
    expect(left).not.toBe(right);
  });
});
