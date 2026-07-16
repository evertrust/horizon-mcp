import { describe, expect, it } from 'vitest';

import {
  buildHttpConfig,
  serviceExposureWarning,
} from '../../src/http/config.js';
import { loadSettings } from '../../src/settings.js';

/**
 * Build an HttpConfig from a flat env map. Defaults to http transport and
 * api-key auth mode (which needs no env credential), so host/path tests do
 * not have to supply a service credential.
 */
function build(env: Record<string, string | undefined>) {
  const full = {
    HORIZON_TRANSPORT: 'http',
    HORIZON_HTTP_AUTH_MODE: 'api-key',
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

  describe('auth mode: service', () => {
    it('requires an env credential', () => {
      expect(() =>
        buildHttpConfig(
          loadSettings({
            HORIZON_TRANSPORT: 'http',
            HORIZON_HTTP_AUTH_MODE: 'service',
          }),
          {},
        ),
      ).toThrow(/service.*credential|credential.*service/i);
    });

    it('accepts a service mode with an API key env credential', () => {
      const cfg = buildHttpConfig(
        loadSettings({
          HORIZON_TRANSPORT: 'http',
          HORIZON_HTTP_AUTH_MODE: 'service',
          HORIZON_API_ID: 'id',
          HORIZON_API_KEY: 'key',
        }),
        {},
      );
      expect(cfg.authMode).toBe('service');
    });

    it('rejects an incomplete API-key service credential', () => {
      expect(() =>
        buildHttpConfig(
          loadSettings({
            HORIZON_TRANSPORT: 'http',
            HORIZON_HTTP_AUTH_MODE: 'service',
            HORIZON_API_ID: 'id-without-key',
          }),
          {},
        ),
      ).toThrow(/HORIZON_API_ID.*HORIZON_API_KEY|both/i);
    });
  });

  describe('auth mode: mtls', () => {
    function mtls(env: Record<string, string | undefined>) {
      const full = {
        HORIZON_TRANSPORT: 'http',
        HORIZON_HTTP_AUTH_MODE: 'mtls',
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
      expect(cfg.authMode).toBe('api-key');
    });
  });

  describe('service-mode exposure warning', () => {
    function svcSettings(env: Record<string, string | undefined>) {
      const full = {
        HORIZON_TRANSPORT: 'http',
        HORIZON_HTTP_AUTH_MODE: 'service',
        HORIZON_API_ID: 'id',
        HORIZON_API_KEY: 'key',
        HORIZON_TRUSTED_HOSTS: 'mcp.example.com',
        ...env,
      };
      return loadSettings(full);
    }

    it('warns when service mode binds a non-loopback host', () => {
      const warning = serviceExposureWarning(
        svcSettings({
          HORIZON_HTTP_HOST: '0.0.0.0',
        }),
      );
      expect(warning).toMatch(/unauthenticated|proxy/i);
    });

    it('does not warn when service mode binds loopback', () => {
      expect(
        serviceExposureWarning(svcSettings({ HORIZON_HTTP_HOST: '127.0.0.1' })),
      ).toBeUndefined();
    });

    it('does not warn for api-key mode on a non-loopback bind', () => {
      const settings = loadSettings({
        HORIZON_TRANSPORT: 'http',
        HORIZON_HTTP_AUTH_MODE: 'api-key',
        HORIZON_HTTP_HOST: '0.0.0.0',
      });
      expect(serviceExposureWarning(settings)).toBeUndefined();
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
