import { describe, expect, it } from 'vitest';

import { HttpAuthMethod } from '../../src/http/auth-methods.js';
import { loadSettings as parseSettings } from '../../src/settings.js';

const TEST_API_ENV = {
  HORIZON_API_ID: 'settings-test',
  HORIZON_API_KEY: 'settings-secret',
};

function loadSettings(env: Record<string, string | undefined>) {
  return parseSettings({ ...TEST_API_ENV, ...env });
}

describe('loadSettings', () => {
  describe('OAuth issuer allowlist validation', () => {
    it('parses a valid issuer map', () => {
      const oauthIssuers = {
        'https://issuer.example.com/tenant': {
          tokenUrl: 'https://oauth.example.com/token',
          authMethod: 'client_secret_basic',
        },
        'https://login.example.com': {
          tokenUrl: 'https://login.example.com/oauth/token',
          authMethod: 'client_secret_post',
        },
      };

      expect(
        loadSettings({ HORIZON_OAUTH_ISSUERS: JSON.stringify(oauthIssuers) })
          .oauthIssuers,
      ).toEqual(oauthIssuers);
    });

    it.each([
      {
        name: 'issuer key',
        offendingKey: 'http://issuer.example.com',
        value: {
          'http://issuer.example.com': {
            tokenUrl: 'https://issuer.example.com/token',
            authMethod: 'client_secret_basic',
          },
        },
      },
      {
        name: 'token URL',
        offendingKey: 'https://issuer.example.com',
        value: {
          'https://issuer.example.com': {
            tokenUrl: 'http://issuer.example.com/token',
            authMethod: 'client_secret_basic',
          },
        },
      },
    ])(
      'rejects a non-HTTPS $name and names the offending key',
      ({ offendingKey, value }) => {
        expect(() =>
          loadSettings({ HORIZON_OAUTH_ISSUERS: JSON.stringify(value) }),
        ).toThrow(offendingKey);
      },
    );

    it('rejects an unknown auth method and names the offending key', () => {
      const issuer = 'https://issuer.example.com';
      expect(() =>
        loadSettings({
          HORIZON_OAUTH_ISSUERS: JSON.stringify({
            [issuer]: {
              tokenUrl: 'https://issuer.example.com/token',
              authMethod: 'private_key_jwt',
            },
          }),
        }),
      ).toThrow(issuer);
    });

    it('rejects malformed JSON with the environment variable named', () => {
      expect(() =>
        loadSettings({ HORIZON_OAUTH_ISSUERS: '{not-json' }),
      ).toThrow('HORIZON_OAUTH_ISSUERS');
    });

    it('bounds the issuer map environment value', () => {
      expect(() =>
        loadSettings({ HORIZON_OAUTH_ISSUERS: 'x'.repeat(65_537) }),
      ).toThrow('HORIZON_OAUTH_ISSUERS');
    });
  });

  describe('stdio authentication validation', () => {
    const partialCases = [
      {
        name: 'API identifier without API key',
        env: { HORIZON_API_ID: 'operator' },
        missing: 'HORIZON_API_KEY',
      },
      {
        name: 'API key without API identifier',
        env: { HORIZON_API_KEY: 'secret' },
        missing: 'HORIZON_API_ID',
      },
      {
        name: 'service account without API token',
        env: { HORIZON_SERVICE_ACCOUNT: 'automation' },
        missing: 'HORIZON_API_TOKEN',
      },
      {
        name: 'API token without service account',
        env: { HORIZON_API_TOKEN: 'jwt' },
        missing: 'HORIZON_SERVICE_ACCOUNT',
      },
      {
        name: 'client certificate without private key',
        env: { HORIZON_CLIENT_CERT: '/cert.pem' },
        missing: 'HORIZON_CLIENT_KEY',
      },
      {
        name: 'private key without client certificate',
        env: { HORIZON_CLIENT_KEY: '/key.pem' },
        missing: 'HORIZON_CLIENT_CERT',
      },
      {
        name: 'OAuth client identifier without secret',
        env: {
          HORIZON_SERVICE_ACCOUNT: 'automation',
          HORIZON_API_TOKEN: 'jwt',
          HORIZON_OAUTH_CLIENT_ID: 'client',
        },
        missing: 'HORIZON_OAUTH_CLIENT_SECRET',
      },
      {
        name: 'OAuth client secret without identifier',
        env: {
          HORIZON_SERVICE_ACCOUNT: 'automation',
          HORIZON_API_TOKEN: 'jwt',
          HORIZON_OAUTH_CLIENT_SECRET: 'secret',
        },
        missing: 'HORIZON_OAUTH_CLIENT_ID',
      },
      {
        name: 'OAuth scope without client credentials',
        env: {
          HORIZON_SERVICE_ACCOUNT: 'automation',
          HORIZON_API_TOKEN: 'jwt',
          HORIZON_OAUTH_SCOPE: 'horizon.read',
        },
        missing: 'HORIZON_OAUTH_CLIENT_ID and HORIZON_OAUTH_CLIENT_SECRET',
      },
      {
        name: 'OAuth audience without client credentials',
        env: {
          HORIZON_SERVICE_ACCOUNT: 'automation',
          HORIZON_API_TOKEN: 'jwt',
          HORIZON_OAUTH_AUDIENCE: 'horizon-api',
        },
        missing: 'HORIZON_OAUTH_CLIENT_ID and HORIZON_OAUTH_CLIENT_SECRET',
      },
      {
        name: 'PEM key password without PEM material',
        env: { HORIZON_CLIENT_KEY_PASSWORD: 'secret' },
        missing: 'HORIZON_CLIENT_CERT and HORIZON_CLIENT_KEY',
      },
      {
        name: 'PFX password without PFX material',
        env: { HORIZON_CLIENT_PFX_PASSWORD: 'secret' },
        missing: 'HORIZON_CLIENT_PFX',
      },
    ] as const;

    it.each(partialCases)(
      'rejects $name and names $missing',
      ({ env, missing }) => {
        expect(() => parseSettings(env)).toThrow(missing);
      },
    );

    it('rejects OAuth renewal metadata without service-account credentials', () => {
      expect(() =>
        parseSettings({
          HORIZON_OAUTH_CLIENT_ID: 'client',
          HORIZON_OAUTH_CLIENT_SECRET: 'secret',
        }),
      ).toThrow('HORIZON_SERVICE_ACCOUNT and HORIZON_API_TOKEN');
    });

    it('rejects no configured authentication method', () => {
      expect(() => parseSettings({})).toThrow(
        'Exactly one complete stdio authentication method must be configured',
      );
    });

    it.each([
      {
        name: 'API key and service account',
        env: {
          HORIZON_API_ID: 'operator',
          HORIZON_API_KEY: 'secret',
          HORIZON_SERVICE_ACCOUNT: 'automation',
          HORIZON_API_TOKEN: 'jwt',
        },
      },
      {
        name: 'API key and PEM mTLS',
        env: {
          HORIZON_API_ID: 'operator',
          HORIZON_API_KEY: 'secret',
          HORIZON_CLIENT_CERT: '/cert.pem',
          HORIZON_CLIENT_KEY: '/key.pem',
        },
      },
      {
        name: 'API key and PFX mTLS',
        env: {
          HORIZON_API_ID: 'operator',
          HORIZON_API_KEY: 'secret',
          HORIZON_CLIENT_PFX: '/client.p12',
        },
      },
      {
        name: 'service account and PEM mTLS',
        env: {
          HORIZON_SERVICE_ACCOUNT: 'automation',
          HORIZON_API_TOKEN: 'jwt',
          HORIZON_CLIENT_CERT: '/cert.pem',
          HORIZON_CLIENT_KEY: '/key.pem',
        },
      },
      {
        name: 'service account and PFX mTLS',
        env: {
          HORIZON_SERVICE_ACCOUNT: 'automation',
          HORIZON_API_TOKEN: 'jwt',
          HORIZON_CLIENT_PFX: '/client.p12',
        },
      },
    ])('rejects multiple complete methods: $name', ({ env }) => {
      expect(() => parseSettings(env)).toThrow(
        'Exactly one complete stdio authentication method must be configured',
      );
    });

    it('rejects PEM and PFX mTLS material together', () => {
      expect(() =>
        parseSettings({
          HORIZON_CLIENT_CERT: '/cert.pem',
          HORIZON_CLIENT_KEY: '/key.pem',
          HORIZON_CLIENT_PFX: '/client.p12',
        }),
      ).toThrow('HORIZON_CLIENT_CERT or HORIZON_CLIENT_PFX, not both');
    });

    it.each([
      {
        name: 'API key',
        env: { HORIZON_API_ID: 'operator', HORIZON_API_KEY: 'secret' },
      },
      {
        name: 'service account',
        env: {
          HORIZON_SERVICE_ACCOUNT: 'automation',
          HORIZON_API_TOKEN: 'jwt',
        },
      },
      {
        name: 'service account with renewal',
        env: {
          HORIZON_SERVICE_ACCOUNT: 'automation',
          HORIZON_API_TOKEN: 'jwt',
          HORIZON_OAUTH_CLIENT_ID: 'client',
          HORIZON_OAUTH_CLIENT_SECRET: 'secret',
          HORIZON_OAUTH_SCOPE: 'horizon.read',
          HORIZON_OAUTH_AUDIENCE: 'horizon-api',
        },
      },
      {
        name: 'PEM mTLS',
        env: {
          HORIZON_CLIENT_CERT: '/cert.pem',
          HORIZON_CLIENT_KEY: '/key.pem',
          HORIZON_CLIENT_KEY_PASSWORD: 'secret',
        },
      },
      {
        name: 'PFX mTLS',
        env: {
          HORIZON_CLIENT_PFX: '/client.p12',
          HORIZON_CLIENT_PFX_PASSWORD: 'secret',
        },
      },
    ])('accepts one complete method: $name', ({ env }) => {
      expect(() => parseSettings(env)).not.toThrow();
    });

    it('does not require stdio credentials in HTTP transport', () => {
      expect(() => parseSettings({ HORIZON_TRANSPORT: 'http' })).not.toThrow();
    });

    it.each([
      ['HORIZON_SERVICE_ACCOUNT', 256],
      ['HORIZON_API_TOKEN', 16_385],
      ['HORIZON_OAUTH_CLIENT_ID', 513],
      ['HORIZON_OAUTH_CLIENT_SECRET', 4097],
      ['HORIZON_OAUTH_SCOPE', 2049],
      ['HORIZON_OAUTH_AUDIENCE', 2049],
    ])('bounds %s', (name, length) => {
      expect(() =>
        parseSettings({
          HORIZON_TRANSPORT: 'http',
          [name]: 'x'.repeat(length),
        }),
      ).toThrow();
    });
  });

  describe('default values', () => {
    it('returns defaults when no HORIZON_ env vars are set', () => {
      const settings = loadSettings({});

      expect(settings.url).toBe('https://localhost');
      expect(settings.apiId).toBe('settings-test');
      expect(settings.apiKey).toBe('settings-secret');
      expect(settings.verifySsl).toBe(true);
      expect(settings.timeout).toBe(30);
      expect(settings.exportTimeout).toBe(120);
      expect(settings.logLevel).toBe('INFO');
      expect(settings.clientCert).toBe('');
      expect(settings.clientKey).toBe('');
      expect(settings.clientKeyPassword).toBe('');
      expect(settings.clientPfx).toBe('');
      expect(settings.clientPfxPassword).toBe('');
    });

    it('ignores env vars without HORIZON_ prefix', () => {
      const settings = loadSettings({
        API_ID: 'should-be-ignored',
        URL: 'https://ignored.example.com',
      });

      expect(settings.apiId).toBe('settings-test');
      expect(settings.url).toBe('https://localhost');
    });
  });

  describe('SCREAMING_SNAKE_CASE to camelCase conversion', () => {
    it('converts single-word keys', () => {
      const settings = loadSettings({ HORIZON_URL: 'https://example.com' });
      expect(settings.url).toBe('https://example.com');
    });

    it('converts multi-word keys like CLIENT_PFX_PASSWORD', () => {
      const settings = loadSettings({
        HORIZON_TRANSPORT: 'http',
        HORIZON_CLIENT_PFX_PASSWORD: 'my-secret',
      });
      expect(settings.clientPfxPassword).toBe('my-secret');
    });

    it('converts CLIENT_KEY_PASSWORD correctly', () => {
      const settings = loadSettings({
        HORIZON_TRANSPORT: 'http',
        HORIZON_CLIENT_KEY_PASSWORD: 'key-pass',
      });
      expect(settings.clientKeyPassword).toBe('key-pass');
    });

    it('converts API_ID and API_KEY', () => {
      const settings = loadSettings({
        HORIZON_API_ID: 'my-id',
        HORIZON_API_KEY: 'my-key',
      });
      expect(settings.apiId).toBe('my-id');
      expect(settings.apiKey).toBe('my-key');
    });

    it('converts VERIFY_SSL', () => {
      const settings = loadSettings({ HORIZON_VERIFY_SSL: 'false' });
      expect(settings.verifySsl).toBe(false);
    });

    it('converts LOG_LEVEL', () => {
      const settings = loadSettings({ HORIZON_LOG_LEVEL: 'DEBUG' });
      expect(settings.logLevel).toBe('DEBUG');
    });
  });

  describe('boolean coercion for VERIFY_SSL', () => {
    // Custom transform: "false" and "0" are false, everything else is true.

    it("parses 'true' as true", () => {
      const settings = loadSettings({ HORIZON_VERIFY_SSL: 'true' });
      expect(settings.verifySsl).toBe(true);
    });

    it("parses 'false' as false", () => {
      const settings = loadSettings({ HORIZON_VERIFY_SSL: 'false' });
      expect(settings.verifySsl).toBe(false);
    });

    it("parses '0' as false", () => {
      const settings = loadSettings({ HORIZON_VERIFY_SSL: '0' });
      expect(settings.verifySsl).toBe(false);
    });

    it("parses 'FALSE' (uppercase) as false", () => {
      const settings = loadSettings({ HORIZON_VERIFY_SSL: 'FALSE' });
      expect(settings.verifySsl).toBe(false);
    });

    it('defaults to true when not set', () => {
      const settings = loadSettings({});
      expect(settings.verifySsl).toBe(true);
    });
  });

  describe('number coercion for TIMEOUT', () => {
    it('coerces string to number for TIMEOUT', () => {
      const settings = loadSettings({ HORIZON_TIMEOUT: '60' });
      expect(settings.timeout).toBe(60);
    });

    it('coerces string to number for EXPORT_TIMEOUT', () => {
      const settings = loadSettings({ HORIZON_EXPORT_TIMEOUT: '240' });
      expect(settings.exportTimeout).toBe(240);
    });
  });

  describe('URL trailing slash stripping', () => {
    it('strips a single trailing slash', () => {
      const settings = loadSettings({
        HORIZON_URL: 'https://horizon.example.com/',
      });
      expect(settings.url).toBe('https://horizon.example.com');
    });

    it('strips multiple trailing slashes', () => {
      const settings = loadSettings({
        HORIZON_URL: 'https://horizon.example.com///',
      });
      expect(settings.url).toBe('https://horizon.example.com');
    });

    it('leaves URL without trailing slash unchanged', () => {
      const settings = loadSettings({
        HORIZON_URL: 'https://horizon.example.com',
      });
      expect(settings.url).toBe('https://horizon.example.com');
    });

    it('preserves path segments that are not trailing', () => {
      const settings = loadSettings({
        HORIZON_URL: 'https://horizon.example.com/api/',
      });
      expect(settings.url).toBe('https://horizon.example.com/api');
    });
  });

  describe('combined settings', () => {
    it('reads multiple HORIZON_ vars at once', () => {
      const settings = loadSettings({
        HORIZON_URL: 'https://prod.example.com/',
        HORIZON_API_ID: 'admin',
        HORIZON_API_KEY: 'secret-key',
        HORIZON_VERIFY_SSL: 'false',
        HORIZON_TIMEOUT: '45',
        HORIZON_LOG_LEVEL: 'DEBUG',
      });

      expect(settings.url).toBe('https://prod.example.com');
      expect(settings.apiId).toBe('admin');
      expect(settings.apiKey).toBe('secret-key');
      expect(settings.verifySsl).toBe(false);
      expect(settings.timeout).toBe(45);
      expect(settings.logLevel).toBe('DEBUG');
    });

    it('skips undefined values in the env record', () => {
      const settings = loadSettings({
        HORIZON_URL: undefined,
        HORIZON_API_ID: 'my-id',
      });

      expect(settings.url).toBe('https://localhost');
      expect(settings.apiId).toBe('my-id');
    });
  });

  describe('toolset gating settings', () => {
    it('defaults enabledToolsets to undefined and readOnly to false', () => {
      const s = loadSettings({});
      expect(s.enabledToolsets).toBeUndefined();
      expect(s.readOnly).toBe(false);
    });

    it('parses HORIZON_ENABLED_TOOLSETS as a trimmed comma list', () => {
      const s = loadSettings({
        HORIZON_ENABLED_TOOLSETS: 'lifecycle, docs , assist',
      });
      expect(s.enabledToolsets).toEqual(['lifecycle', 'docs', 'assist']);
    });

    it('collapses an empty toolset list to undefined (no filter)', () => {
      const s = loadSettings({ HORIZON_ENABLED_TOOLSETS: '  , ,' });
      expect(s.enabledToolsets).toBeUndefined();
    });

    it("parses HORIZON_READ_ONLY 'true' and '1' as true", () => {
      expect(loadSettings({ HORIZON_READ_ONLY: 'true' }).readOnly).toBe(true);
      expect(loadSettings({ HORIZON_READ_ONLY: 'TRUE' }).readOnly).toBe(true);
      expect(loadSettings({ HORIZON_READ_ONLY: '1' }).readOnly).toBe(true);
    });

    it('parses other HORIZON_READ_ONLY values as false', () => {
      expect(loadSettings({ HORIZON_READ_ONLY: 'false' }).readOnly).toBe(false);
      expect(loadSettings({ HORIZON_READ_ONLY: '0' }).readOnly).toBe(false);
      expect(loadSettings({ HORIZON_READ_ONLY: 'yes' }).readOnly).toBe(false);
    });
  });

  describe('HTTP transport settings', () => {
    it('defaults to stdio transport with safe HTTP defaults', () => {
      const s = loadSettings({});
      expect(s.transport).toBe('stdio');
      expect(s.httpHost).toBe('127.0.0.1');
      expect(s.httpPort).toBe(8080);
      expect(s.httpPath).toBe('/mcp');
      expect(s.publicUrl).toBe('');
      expect(s.trustedHosts).toEqual([]);
      expect(s.trustedOrigins).toEqual([]);
      expect(s.httpAuthMethods).toBe(HttpAuthMethod.ApiKey);
      expect(s.httpAuthMode).toBe('');
      expect(s.maxConcurrentRequests).toBe(32);
      expect(s.maxListenStreamsGlobal).toBe(8);
      expect(s.credentialCacheMax).toBe(64);
      expect(s.credentialCacheTtl).toBe(300);
      expect(s.validationRateLimit).toBe(5);
      expect(s.maxInflightToolcalls).toBe(8);
      expect(s.maxListenStreams).toBe(2);
      expect(s.maxBodyBytes).toBe(1048576);
      expect(s.sseMaxDuration).toBe(3600);
      expect(s.sseKeepAlive).toBe(15);
      expect(s.rateLimitRps).toBe(20);
      expect(s.ipRateLimit).toBe(600);
      expect(s.httpTlsCert).toBe('');
      expect(s.httpTlsKey).toBe('');
      expect(s.inboundCertHeader).toBe('');
      expect(s.trustedProxy).toBe('');
      expect(s.forwardCertHeader).toBe('SSL_CLIENT_CERT');
    });

    it('reads HORIZON_TRANSPORT=http', () => {
      expect(loadSettings({ HORIZON_TRANSPORT: 'http' }).transport).toBe(
        'http',
      );
    });

    it('lowercases the transport value', () => {
      expect(loadSettings({ HORIZON_TRANSPORT: 'HTTP' }).transport).toBe(
        'http',
      );
    });

    it('rejects an invalid transport', () => {
      expect(() => loadSettings({ HORIZON_TRANSPORT: 'grpc' })).toThrow();
    });

    it('reads and combines the HTTP authentication method whitelist', () => {
      expect(
        loadSettings({ HORIZON_HTTP_AUTH_METHODS: 'MTLS | SERVICE' })
          .httpAuthMethods,
      ).toBe(HttpAuthMethod.Mtls | HttpAuthMethod.Service);
    });

    it('rejects an invalid HTTP authentication method', () => {
      expect(() =>
        loadSettings({ HORIZON_HTTP_AUTH_METHODS: 'api-key,oidc' }),
      ).toThrow();
    });

    it('parses trusted hosts and origins as trimmed comma lists', () => {
      const s = loadSettings({
        HORIZON_TRUSTED_HOSTS: 'mcp.example.com, mcp.example.com:8443 ',
        HORIZON_TRUSTED_ORIGINS: 'https://app.example.com',
      });
      expect(s.trustedHosts).toEqual([
        'mcp.example.com',
        'mcp.example.com:8443',
      ]);
      expect(s.trustedOrigins).toEqual(['https://app.example.com']);
    });

    it('drops empty entries from comma lists', () => {
      const s = loadSettings({ HORIZON_TRUSTED_HOSTS: 'a.com,,  ,b.com,' });
      expect(s.trustedHosts).toEqual(['a.com', 'b.com']);
    });

    it('coerces numeric HTTP settings', () => {
      const s = loadSettings({
        HORIZON_HTTP_PORT: '9443',
        HORIZON_MAX_CONCURRENT_REQUESTS: '16',
        HORIZON_MAX_BODY_BYTES: '2097152',
      });
      expect(s.httpPort).toBe(9443);
      expect(s.maxConcurrentRequests).toBe(16);
      expect(s.maxBodyBytes).toBe(2097152);
    });

    it('rejects a concurrency limit above the supported memory ceiling', () => {
      expect(() =>
        loadSettings({ HORIZON_MAX_CONCURRENT_REQUESTS: '257' }),
      ).toThrow();
    });

    it('bounds the global listen stream concurrency limit', () => {
      expect(
        loadSettings({ HORIZON_MAX_LISTEN_STREAMS_GLOBAL: '1' })
          .maxListenStreamsGlobal,
      ).toBe(1);
      expect(
        loadSettings({ HORIZON_MAX_LISTEN_STREAMS_GLOBAL: '64' })
          .maxListenStreamsGlobal,
      ).toBe(64);
      expect(() =>
        loadSettings({ HORIZON_MAX_LISTEN_STREAMS_GLOBAL: '0' }),
      ).toThrow();
      expect(() =>
        loadSettings({ HORIZON_MAX_LISTEN_STREAMS_GLOBAL: '65' }),
      ).toThrow();
    });

    it('bounds the per-credential listen stream concurrency limit', () => {
      expect(
        loadSettings({ HORIZON_MAX_LISTEN_STREAMS: '1' }).maxListenStreams,
      ).toBe(1);
      expect(
        loadSettings({ HORIZON_MAX_LISTEN_STREAMS: '16' }).maxListenStreams,
      ).toBe(16);
      expect(() => loadSettings({ HORIZON_MAX_LISTEN_STREAMS: '0' })).toThrow();
      expect(() =>
        loadSettings({ HORIZON_MAX_LISTEN_STREAMS: '17' }),
      ).toThrow();
    });

    it('rejects an SSE duration that exceeds the supported timer ceiling', () => {
      expect(() =>
        loadSettings({ HORIZON_SSE_MAX_DURATION: '2147484' }),
      ).toThrow();
    });

    it('bounds the SSE keep-alive interval', () => {
      expect(loadSettings({ HORIZON_SSE_KEEP_ALIVE: '1' }).sseKeepAlive).toBe(
        1,
      );
      expect(loadSettings({ HORIZON_SSE_KEEP_ALIVE: '60' }).sseKeepAlive).toBe(
        60,
      );
      expect(() => loadSettings({ HORIZON_SSE_KEEP_ALIVE: '0' })).toThrow();
      expect(() => loadSettings({ HORIZON_SSE_KEEP_ALIVE: '61' })).toThrow();
    });

    it('bounds the credential cache size and TTL', () => {
      expect(() =>
        loadSettings({ HORIZON_CREDENTIAL_CACHE_MAX: '513' }),
      ).toThrow();
      expect(() =>
        loadSettings({ HORIZON_CREDENTIAL_CACHE_TTL: '29' }),
      ).toThrow();
      expect(() =>
        loadSettings({ HORIZON_CREDENTIAL_CACHE_TTL: '3601' }),
      ).toThrow();
    });

    it('bounds the credential validation rate limit', () => {
      expect(
        loadSettings({ HORIZON_VALIDATION_RATE_LIMIT: '0' })
          .validationRateLimit,
      ).toBe(0);
      expect(
        loadSettings({ HORIZON_VALIDATION_RATE_LIMIT: '100' })
          .validationRateLimit,
      ).toBe(100);
      expect(() =>
        loadSettings({ HORIZON_VALIDATION_RATE_LIMIT: '-1' }),
      ).toThrow();
      expect(() =>
        loadSettings({ HORIZON_VALIDATION_RATE_LIMIT: '101' }),
      ).toThrow();
    });

    it('allows 0 to disable the rate limits', () => {
      const s = loadSettings({
        HORIZON_RATE_LIMIT_RPS: '0',
        HORIZON_IP_RATE_LIMIT: '0',
        HORIZON_VALIDATION_RATE_LIMIT: '0',
      });
      expect(s.rateLimitRps).toBe(0);
      expect(s.ipRateLimit).toBe(0);
      expect(s.validationRateLimit).toBe(0);
    });

    it('rejects a non-numeric port', () => {
      expect(() => loadSettings({ HORIZON_HTTP_PORT: 'abc' })).toThrow();
    });

    it('reads the inbound/forward mTLS header settings', () => {
      const s = loadSettings({
        HORIZON_HTTP_TLS_CERT: '/tls/cert.pem',
        HORIZON_HTTP_TLS_KEY: '/tls/key.pem',
        HORIZON_INBOUND_CERT_HEADER: 'x-client-cert',
        HORIZON_TRUSTED_PROXY: '10.0.0.0/8',
        HORIZON_FORWARD_CERT_HEADER: 'SSL_CLIENT_CERT',
      });
      expect(s.httpTlsCert).toBe('/tls/cert.pem');
      expect(s.httpTlsKey).toBe('/tls/key.pem');
      expect(s.inboundCertHeader).toBe('x-client-cert');
      expect(s.trustedProxy).toBe('10.0.0.0/8');
      expect(s.forwardCertHeader).toBe('SSL_CLIENT_CERT');
    });
  });
});
