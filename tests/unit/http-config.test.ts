import { describe, expect, it } from 'vitest';

import { HttpAuthMethod } from '../../src/http/auth-methods.js';
import { buildHttpConfig } from '../../src/http/config.js';
import { loadSettings } from '../../src/settings.js';

/**
 * Build an HttpConfig from a flat env map. Defaults to http transport and
 * API-key authentication, so host/path tests do not need mTLS topology.
 */
function build(env: Record<string, string | undefined>) {
  const full = {
    HORIZON_TRANSPORT: 'http',
    HORIZON_HTTP_AUTH_METHODS: 'api-key',
    ...env,
  };
  return buildHttpConfig(loadSettings(full), full);
}

describe('buildHttpConfig', () => {
  describe('host derivation', () => {
    it('derives loopback hosts for the bound port when nothing is set', () => {
      const cfg = build({});
      expect(cfg.allowedHosts).toEqual(
        new Set(['localhost:8080', '127.0.0.1:8080', '[::1]:8080']),
      );
    });

    it('uses the bound port in the derived loopback hosts', () => {
      const cfg = build({ HORIZON_HTTP_PORT: '9443' });
      expect(cfg.allowedHosts).toEqual(
        new Set(['localhost:9443', '127.0.0.1:9443', '[::1]:9443']),
      );
    });

    it('refuses to start on a non-loopback bind with no public URL or trusted hosts', () => {
      expect(() => build({ HORIZON_HTTP_HOST: '0.0.0.0' })).toThrow(
        /non-loopback|HORIZON_PUBLIC_URL|HORIZON_TRUSTED_HOSTS/i,
      );
    });

    it('allows a non-loopback bind when trusted hosts are given', () => {
      // https public URL keeps api-key mode off the cleartext guard.
      const cfg = build({
        HORIZON_HTTP_HOST: '0.0.0.0',
        HORIZON_PUBLIC_URL: 'https://mcp.example.com',
        HORIZON_TRUSTED_HOSTS: 'mcp.example.com',
      });
      expect(cfg.allowedHosts).toEqual(new Set(['mcp.example.com']));
    });

    it('derives the allowed host from the public URL', () => {
      const cfg = build({
        HORIZON_HTTP_HOST: '0.0.0.0',
        HORIZON_PUBLIC_URL: 'https://mcp.example.com',
      });
      expect(cfg.allowedHosts).toEqual(new Set(['mcp.example.com']));
      expect(cfg.publicEndpoint).toBe('https://mcp.example.com/mcp');
    });

    it('keeps the port when the public URL carries one', () => {
      const cfg = build({
        HORIZON_HTTP_HOST: '0.0.0.0',
        HORIZON_PUBLIC_URL: 'https://mcp.example.com:8443',
      });
      expect(cfg.allowedHosts).toEqual(new Set(['mcp.example.com:8443']));
    });

    it('lets trusted hosts override public-URL derivation', () => {
      const cfg = build({
        HORIZON_HTTP_HOST: '0.0.0.0',
        HORIZON_PUBLIC_URL: 'https://mcp.example.com',
        HORIZON_TRUSTED_HOSTS: 'a.internal, b.internal',
      });
      expect(cfg.allowedHosts).toEqual(new Set(['a.internal', 'b.internal']));
    });

    it('rejects a malformed public URL', () => {
      expect(() => build({ HORIZON_PUBLIC_URL: 'not a url' })).toThrow(
        /HORIZON_PUBLIC_URL/i,
      );
    });

    it('rejects a non-http(s) public URL', () => {
      expect(() =>
        build({ HORIZON_PUBLIC_URL: 'ftp://mcp.example.com' }),
      ).toThrow(/HORIZON_PUBLIC_URL/i);
    });
  });

  describe('endpoint path', () => {
    it('keeps a simple absolute path', () => {
      expect(build({}).path).toBe('/mcp');
    });

    it('normalizes a trailing slash', () => {
      expect(build({ HORIZON_HTTP_PATH: '/mcp/' }).path).toBe('/mcp');
    });

    it('keeps the root path as-is', () => {
      expect(build({ HORIZON_HTTP_PATH: '/' }).path).toBe('/');
    });

    it('rejects a path without a leading slash', () => {
      expect(() => build({ HORIZON_HTTP_PATH: 'mcp' })).toThrow(
        /HORIZON_HTTP_PATH/i,
      );
    });

    it('rejects a path with a query string', () => {
      expect(() => build({ HORIZON_HTTP_PATH: '/mcp?x=1' })).toThrow(
        /HORIZON_HTTP_PATH/i,
      );
    });

    it('rejects a path with a fragment', () => {
      expect(() => build({ HORIZON_HTTP_PATH: '/mcp#frag' })).toThrow(
        /HORIZON_HTTP_PATH/i,
      );
    });
  });

  describe('origins', () => {
    it('defaults to no allowed origins', () => {
      expect(build({}).allowedOrigins).toEqual(new Set());
    });

    it('canonicalizes configured origins', () => {
      const cfg = build({
        HORIZON_TRUSTED_ORIGINS:
          'https://app.example.com, https://b.example.com',
      });
      expect(cfg.allowedOrigins).toEqual(
        new Set(['https://app.example.com', 'https://b.example.com']),
      );
    });

    it('rejects a malformed origin', () => {
      expect(() =>
        build({ HORIZON_TRUSTED_ORIGINS: 'http://ok.com, nonsense' }),
      ).toThrow(/origin/i);
    });

    it('rejects a non-http(s) origin scheme', () => {
      expect(() =>
        build({ HORIZON_TRUSTED_ORIGINS: 'ftp://x.example.com' }),
      ).toThrow(/origin|http/i);
    });
  });

  describe('authentication method whitelist', () => {
    it('accepts and preserves multiple caller-supplied methods', () => {
      const full = {
        HORIZON_TRANSPORT: 'http',
        HORIZON_HTTP_AUTH_METHODS: 'api-key,service',
      };
      const cfg = buildHttpConfig(loadSettings(full), full);
      expect(cfg.acceptedAuthMethods).toBe(
        HttpAuthMethod.ApiKey | HttpAuthMethod.Service,
      );
    });

    it('fails clearly when the removed singular setting is still present', () => {
      const full = {
        HORIZON_TRANSPORT: 'http',
        HORIZON_HTTP_AUTH_MODE: 'service',
      };
      expect(() => buildHttpConfig(loadSettings(full), full)).toThrow(
        /HORIZON_HTTP_AUTH_METHODS/i,
      );
    });
  });

  describe('auth mode: mtls', () => {
    function mtls(env: Record<string, string | undefined>) {
      const full = {
        HORIZON_TRANSPORT: 'http',
        HORIZON_HTTP_AUTH_METHODS: 'mtls',
        ...env,
      };
      return buildHttpConfig(loadSettings(full), full);
    }

    it('requires a TLS listener or an inbound cert header', () => {
      expect(() => mtls({})).toThrow(/mtls/i);
    });

    it('accepts the MCP-terminates-TLS topology', () => {
      const cfg = mtls({
        HORIZON_HTTP_TLS_CERT: '/tls/cert.pem',
        HORIZON_HTTP_TLS_KEY: '/tls/key.pem',
      });
      expect(cfg.mtls?.listener).toEqual({
        certPath: '/tls/cert.pem',
        keyPath: '/tls/key.pem',
      });
      expect(cfg.mtls?.forwardHeader).toBe('SSL_CLIENT_CERT');
      expect(cfg.publicEndpoint).toBe('https://127.0.0.1:8080/mcp');
    });

    it('rejects an http public URL for a direct TLS listener', () => {
      expect(() =>
        mtls({
          HORIZON_HTTP_TLS_CERT: '/tls/cert.pem',
          HORIZON_HTTP_TLS_KEY: '/tls/key.pem',
          HORIZON_PUBLIC_URL: 'http://mcp.example.com',
        }),
      ).toThrow(/HORIZON_PUBLIC_URL|https/i);
    });

    it('rejects a TLS listener with only one of cert/key', () => {
      expect(() => mtls({ HORIZON_HTTP_TLS_CERT: '/tls/cert.pem' })).toThrow(
        /HORIZON_HTTP_TLS_KEY|cert.*key/i,
      );
    });

    it('accepts the trusted-ingress topology', () => {
      const cfg = mtls({
        HORIZON_INBOUND_CERT_HEADER: 'x-client-cert',
        HORIZON_TRUSTED_PROXY: '10.0.0.0/8',
      });
      expect(cfg.mtls?.inbound).toEqual({
        header: 'x-client-cert',
        trustedProxy: '10.0.0.0/8',
      });
    });

    it('requires a trusted proxy with an inbound cert header', () => {
      expect(() =>
        mtls({ HORIZON_INBOUND_CERT_HEADER: 'x-client-cert' }),
      ).toThrow(/HORIZON_TRUSTED_PROXY/i);
    });

    it('rejects a malformed trusted proxy', () => {
      expect(() =>
        mtls({
          HORIZON_INBOUND_CERT_HEADER: 'x-client-cert',
          HORIZON_TRUSTED_PROXY: 'not-an-ip',
        }),
      ).toThrow(/HORIZON_TRUSTED_PROXY/i);
    });

    it('rejects configuring both topologies at once', () => {
      expect(() =>
        mtls({
          HORIZON_HTTP_TLS_CERT: '/tls/cert.pem',
          HORIZON_HTTP_TLS_KEY: '/tls/key.pem',
          HORIZON_INBOUND_CERT_HEADER: 'x-client-cert',
          HORIZON_TRUSTED_PROXY: '10.0.0.0/8',
        }),
      ).toThrow(/either|both|not both/i);
    });

    it('rejects a forbidden forward header name', () => {
      expect(() =>
        mtls({
          HORIZON_HTTP_TLS_CERT: '/tls/cert.pem',
          HORIZON_HTTP_TLS_KEY: '/tls/key.pem',
          HORIZON_FORWARD_CERT_HEADER: 'authorization',
        }),
      ).toThrow(/header/i);
    });

    it('rejects an invalid header token', () => {
      expect(() =>
        mtls({
          HORIZON_INBOUND_CERT_HEADER: 'bad header name',
          HORIZON_TRUSTED_PROXY: '10.0.0.0/8',
        }),
      ).toThrow(/header/i);
    });
  });

  describe('api-key cleartext guard', () => {
    it('refuses api-key mode on a non-loopback bind with a cleartext http endpoint', () => {
      expect(() =>
        build({
          HORIZON_HTTP_HOST: '0.0.0.0',
          HORIZON_TRUSTED_HOSTS: 'mcp.example.com',
        }),
      ).toThrow(/cleartext|http|TLS/i);
    });

    it('allows api-key mode on loopback over http', () => {
      expect(() => build({ HORIZON_HTTP_HOST: '127.0.0.1' })).not.toThrow();
    });

    it('allows api-key mode on a non-loopback bind behind an https public URL', () => {
      const cfg = build({
        HORIZON_HTTP_HOST: '0.0.0.0',
        HORIZON_PUBLIC_URL: 'https://mcp.example.com',
      });
      expect(cfg.acceptedAuthMethods).toBe(HttpAuthMethod.ApiKey);
    });

    it('also protects caller-supplied service credentials from cleartext transport', () => {
      expect(() =>
        build({
          HORIZON_HTTP_AUTH_METHODS: 'service',
          HORIZON_HTTP_HOST: '0.0.0.0',
          HORIZON_TRUSTED_HOSTS: 'mcp.example.com',
        }),
      ).toThrow(/cleartext|http|TLS/i);
    });
  });

  describe('fail-closed extras', () => {
    it('rejects HORIZON_ALLOW_PRIVATE_TLS_PROBE=1 in HTTP mode', () => {
      expect(() => build({ HORIZON_ALLOW_PRIVATE_TLS_PROBE: '1' })).toThrow(
        /HORIZON_ALLOW_PRIVATE_TLS_PROBE/i,
      );
    });

    it('allows HORIZON_ALLOW_PRIVATE_TLS_PROBE unset', () => {
      expect(() => build({})).not.toThrow();
    });
  });
});
