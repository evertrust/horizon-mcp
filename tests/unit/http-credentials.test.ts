import { describe, expect, it } from 'vitest';

import { ApiKeyAuthProvider } from '../../src/auth/apikey.js';
import { CertForwardAuthProvider } from '../../src/auth/cert-forward.js';
import { ServiceAccountAuthProvider } from '../../src/auth/service-account.js';
import { HttpAuthMethod } from '../../src/http/auth-methods.js';
import type { HttpConfig } from '../../src/http/config.js';
import {
  CredentialError,
  buildSessionAuth,
  credentialFingerprintOf,
  decodeForwardedCert,
  extractCredential,
  peerMatchesProxy,
} from '../../src/http/credentials.js';
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
    acceptedAuthMethods: HttpAuthMethod.ApiKey,
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
  describe('api-key credentials', () => {
    it('extracts the API key headers', () => {
      const m = extractCredential(
        req({ 'x-api-id': 'id', 'x-api-key': 'secret' }),
        cfg({ acceptedAuthMethods: HttpAuthMethod.ApiKey }),
      );
      expect(m).toEqual({ kind: 'api-key', apiId: 'id', apiKey: 'secret' });
    });

    it('rejects a missing API key', () => {
      expect(() =>
        extractCredential(
          req({ 'x-api-id': 'id' }),
          cfg({ acceptedAuthMethods: HttpAuthMethod.ApiKey }),
        ),
      ).toThrow(CredentialError);
    });
  });

  describe('service-account credentials', () => {
    it('extracts the service-account name and JWT', () => {
      expect(
        extractCredential(
          req({ 'x-api-sva': 'ci', 'x-api-token': 'jwt' }),
          cfg({ acceptedAuthMethods: HttpAuthMethod.Service }),
        ),
      ).toEqual({ kind: 'service', serviceAccount: 'ci', jwt: 'jwt' });
    });

    it('rejects a partial service-account credential', () => {
      expect(() =>
        extractCredential(
          req({ 'x-api-sva': 'ci' }),
          cfg({ acceptedAuthMethods: HttpAuthMethod.Service }),
        ),
      ).toThrow(CredentialError);
    });

    it('captures OAuth client credentials for automatic renewal', () => {
      expect(
        extractCredential(
          req({
            'x-api-sva': 'ci',
            'x-api-token': 'jwt',
            'x-oauth-client-id': 'client',
            'x-oauth-client-secret': 'secret',
            'x-oauth-scope': 'api.read',
          }),
          cfg({ acceptedAuthMethods: HttpAuthMethod.Service }),
        ),
      ).toEqual({
        kind: 'service',
        serviceAccount: 'ci',
        jwt: 'jwt',
        oauth: {
          clientId: 'client',
          clientSecret: 'secret',
          scope: 'api.read',
        },
      });
    });

    it('rejects a partial OAuth client credential', () => {
      expect(() =>
        extractCredential(
          req({
            'x-api-sva': 'ci',
            'x-api-token': 'jwt',
            'x-oauth-client-id': 'client',
          }),
          cfg({ acceptedAuthMethods: HttpAuthMethod.Service }),
        ),
      ).toThrow(CredentialError);
    });
  });

  it('rejects unsupported browser/session credentials', () => {
    for (const headers of [
      { authorization: 'Bearer x' },
      { cookie: 'session=x' },
      { 'x-forwarded-client-cert': PEM },
    ]) {
      expect(() => extractCredential(req(headers), cfg({}))).toThrow(
        CredentialError,
      );
    }
  });

  describe('mtls mode (inbound header topology)', () => {
    const inboundCfg = cfg({
      acceptedAuthMethods: HttpAuthMethod.Mtls,
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
      acceptedAuthMethods: HttpAuthMethod.Mtls,
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
  it('service credentials build a forwarding provider', () => {
    const settings = loadSettings({ HORIZON_TRANSPORT: 'http' });
    const { auth } = buildSessionAuth(
      { kind: 'service', serviceAccount: 'ci', jwt: 'jwt' },
      cfg({ acceptedAuthMethods: HttpAuthMethod.Service }),
      settings,
    );
    expect(auth).toBeInstanceOf(ServiceAccountAuthProvider);
  });

  it('passes the operator issuer allowlist to HTTP renewal providers', () => {
    const oauthIssuers = {
      'https://issuer.example.com': {
        tokenUrl: 'https://issuer.example.com/token',
        authMethod: 'client_secret_post' as const,
      },
    };
    const settings = {
      ...loadSettings({ HORIZON_TRANSPORT: 'http' }),
      oauthIssuers,
    };
    const { auth } = buildSessionAuth(
      {
        kind: 'service',
        serviceAccount: 'ci',
        jwt: 'jwt',
        oauth: { clientId: 'client', clientSecret: 'secret' },
      },
      cfg({ acceptedAuthMethods: HttpAuthMethod.Service }),
      settings,
    );

    expect(
      (auth as unknown as { _oauth: { issuers: unknown } })._oauth.issuers,
    ).toBe(oauthIssuers);
  });

  it('api-key mode builds an ApiKeyAuthProvider', () => {
    const settings = loadSettings({ HORIZON_TRANSPORT: 'http' });
    const { auth } = buildSessionAuth(
      { kind: 'api-key', apiId: 'id', apiKey: 'secret' },
      cfg({ acceptedAuthMethods: HttpAuthMethod.ApiKey }),
      settings,
    );
    expect(auth).toBeInstanceOf(ApiKeyAuthProvider);
  });

  it('mtls mode builds a CertForwardAuthProvider', () => {
    const settings = loadSettings({ HORIZON_TRANSPORT: 'http' });
    const { auth } = buildSessionAuth(
      { kind: 'cert', pem: PEM },
      cfg({
        acceptedAuthMethods: HttpAuthMethod.Mtls,
        mtls: {
          forwardHeader: 'SSL_CLIENT_CERT',
          listener: { certPath: '/c', keyPath: '/k' },
        },
      }),
      settings,
    );
    expect(auth).toBeInstanceOf(CertForwardAuthProvider);
  });
});

describe('credentialFingerprintOf', () => {
  it('distinguishes credential kinds with the same values', () => {
    const apiKey = credentialFingerprintOf({
      kind: 'api-key',
      apiId: 'a',
      apiKey: 'b',
    });
    const service = credentialFingerprintOf({
      kind: 'service',
      serviceAccount: 'a',
      jwt: 'b',
    });
    expect(apiKey).not.toBe(service);
  });

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
