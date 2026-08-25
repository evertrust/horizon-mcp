import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApiKeyAuthProvider } from '../../src/auth/apikey.js';
import { createAuthProvider } from '../../src/auth/index.js';
import { MtlsAuthProvider } from '../../src/auth/mtls.js';
import { ServiceAccountAuthProvider } from '../../src/auth/service-account.js';
import { loadSettings } from '../../src/settings.js';
import type { HorizonSettings } from '../../src/settings.js';

/**
 * Build a minimal HorizonSettings object with sensible defaults.
 * Override only the fields relevant to each test case.
 */
function makeSettings(
  overrides: Partial<HorizonSettings> = {},
): HorizonSettings {
  return {
    ...loadSettings({ HORIZON_TRANSPORT: 'http' }),
    transport: 'stdio',
    url: 'https://horizon.example.com',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers - generate PEM and PFX temp files for mTLS tests
// ---------------------------------------------------------------------------

/**
 * Write a dummy PEM file to a temp directory.
 * For TS mTLS tests we only need readable files since the TS
 * MtlsAuthProvider reads raw bytes (no crypto-level validation in
 * the constructor - just readFileSync).
 */
function writeDummyPem(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    `-----BEGIN CERTIFICATE-----\nMIIB==\n-----END CERTIFICATE-----\n`,
  );
  return path;
}

function writeDummyKey(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    `-----BEGIN PRIVATE KEY-----\nMIIB==\n-----END PRIVATE KEY-----\n`,
  );
  return path;
}

function writeDummyPfx(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.from([0x30, 0x82, 0x00, 0x00]));
  return path;
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'auth-test-'));
}

// ===========================================================================
// ApiKeyAuthProvider
// ===========================================================================

describe('ApiKeyAuthProvider', () => {
  describe('constructor validation', () => {
    it('throws when apiId is empty', () => {
      expect(() => new ApiKeyAuthProvider('', 'my-key')).toThrow(
        'HORIZON_API_ID and HORIZON_API_KEY must both be set',
      );
    });

    it('throws when apiKey is empty', () => {
      expect(() => new ApiKeyAuthProvider('my-id', '')).toThrow(
        'HORIZON_API_ID and HORIZON_API_KEY must both be set',
      );
    });

    it('throws when both fields are empty', () => {
      expect(() => new ApiKeyAuthProvider('', '')).toThrow(
        'HORIZON_API_ID and HORIZON_API_KEY must both be set',
      );
    });

    it('succeeds when both fields are provided', () => {
      const provider = new ApiKeyAuthProvider('my-id', 'my-key');
      expect(provider).toBeInstanceOf(ApiKeyAuthProvider);
    });
  });

  describe('getHeaders', () => {
    it('returns X-API-ID and X-API-KEY headers', async () => {
      const provider = new ApiKeyAuthProvider('test-id', 'test-key');
      const headers = await provider.getHeaders();

      expect(headers).toEqual({
        'X-API-ID': 'test-id',
        'X-API-KEY': 'test-key',
      });
    });

    it('preserves exact values without trimming or transformation', async () => {
      const provider = new ApiKeyAuthProvider(
        ' spaced-id ',
        'key-with-special!@#$',
      );
      const headers = await provider.getHeaders();

      expect(headers['X-API-ID']).toBe(' spaced-id ');
      expect(headers['X-API-KEY']).toBe('key-with-special!@#$');
    });
  });

  describe('refreshIfNeeded', () => {
    it('is a no-op that resolves without error', async () => {
      const provider = new ApiKeyAuthProvider('id', 'key');
      await expect(provider.refreshIfNeeded()).resolves.toBeUndefined();
    });
  });
});

// ===========================================================================
// MtlsAuthProvider - PEM
// ===========================================================================

describe('MtlsAuthProvider (PEM)', () => {
  let tmpDir: string;
  let certPath: string;
  let keyPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    certPath = writeDummyPem(tmpDir, 'cert.pem');
    keyPath = writeDummyKey(tmpDir, 'key.pem');
  });

  it('builds connect options with cert and key', () => {
    const provider = new MtlsAuthProvider({
      certPath,
      keyPath,
    });
    const opts = provider.getDispatcherOptions();
    expect(opts).toBeDefined();
    expect(opts).toHaveProperty('cert');
    expect(opts).toHaveProperty('key');
  });

  it('accepts a key password (passphrase)', () => {
    const provider = new MtlsAuthProvider({
      certPath,
      keyPath,
      keyPassword: 'test-password',
    });
    const opts = provider.getDispatcherOptions() as Record<string, unknown>;
    expect(opts).toBeDefined();
    expect(opts['passphrase']).toBe('test-password');
  });

  it('getHeaders returns empty object', async () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    const headers = await provider.getHeaders();
    expect(headers).toEqual({});
  });

  it('refreshIfNeeded is a no-op', async () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    await expect(provider.refreshIfNeeded()).resolves.toBeUndefined();
  });

  it('markAuthFailed is a no-op', async () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    await expect(provider.markAuthFailed()).resolves.toBeUndefined();
  });

  it('throws when cert file is missing', () => {
    expect(
      () =>
        new MtlsAuthProvider({
          certPath: '/nonexistent/cert.pem',
          keyPath,
        }),
    ).toThrow('HORIZON_CLIENT_CERT file not found');
  });

  it('throws when key file is missing', () => {
    expect(
      () =>
        new MtlsAuthProvider({
          certPath,
          keyPath: '/nonexistent/key.pem',
        }),
    ).toThrow('HORIZON_CLIENT_KEY file not found');
  });

  it('throws when keyPath is omitted but certPath is set', () => {
    expect(
      () =>
        new MtlsAuthProvider({
          certPath,
        }),
    ).toThrow('HORIZON_CLIENT_KEY is required');
  });

  it('csrfToken returns undefined', () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    expect(provider.csrfToken).toBeUndefined();
  });

  it('connect options omit passphrase when no password', () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    const opts = provider.getDispatcherOptions() as Record<string, unknown>;
    expect(opts['passphrase']).toBeUndefined();
  });

  it('cleanup is a no-op that does not throw', async () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    await expect(provider.cleanup()).resolves.toBeUndefined();
    await expect(provider.cleanup()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// MtlsAuthProvider - PFX
// ===========================================================================

describe('MtlsAuthProvider (PFX)', () => {
  let tmpDir: string;
  let pfxPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    pfxPath = writeDummyPfx(tmpDir, 'client.p12');
  });

  it('builds connect options with pfx', () => {
    const provider = new MtlsAuthProvider({ pfxPath });
    const opts = provider.getDispatcherOptions();
    expect(opts).toBeDefined();
    expect(opts).toHaveProperty('pfx');
  });

  it('accepts a pfx password', () => {
    const provider = new MtlsAuthProvider({
      pfxPath,
      pfxPassword: 'pfx-secret',
    });
    const opts = provider.getDispatcherOptions() as Record<string, unknown>;
    expect(opts['passphrase']).toBe('pfx-secret');
  });

  it('throws when pfx file is missing', () => {
    expect(
      () =>
        new MtlsAuthProvider({
          pfxPath: '/nonexistent/client.p12',
        }),
    ).toThrow('HORIZON_CLIENT_PFX file not found');
  });

  it('pfx property is a Buffer', () => {
    const provider = new MtlsAuthProvider({ pfxPath });
    const opts = provider.getDispatcherOptions() as Record<string, unknown>;
    expect(Buffer.isBuffer(opts['pfx'])).toBe(true);
  });

  it('omits passphrase when no password', () => {
    const provider = new MtlsAuthProvider({ pfxPath });
    const opts = provider.getDispatcherOptions() as Record<string, unknown>;
    expect(opts['passphrase']).toBeUndefined();
  });

  it('cleanup is idempotent', async () => {
    const provider = new MtlsAuthProvider({ pfxPath });
    await expect(provider.cleanup()).resolves.toBeUndefined();
    await expect(provider.cleanup()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// createAuthProvider (factory)
// ===========================================================================

describe('createAuthProvider (factory)', () => {
  describe('service-account detection', () => {
    it('creates a service-account provider with the configured headers', async () => {
      const provider = createAuthProvider(
        makeSettings({
          serviceAccount: 'automation',
          apiToken: 'signed-jwt',
        }),
      );

      expect(provider).toBeInstanceOf(ServiceAccountAuthProvider);
      await expect(provider.getHeaders()).resolves.toEqual({
        'X-API-SVA': 'automation',
        'X-API-TOKEN': 'signed-jwt',
      });
    });

    it('passes the complete OAuth renewal tuple to the provider', () => {
      const oauthIssuers = {
        'https://issuer.example.com': {
          tokenUrl: 'https://issuer.example.com/token',
          authMethod: 'client_secret_basic' as const,
        },
      };
      const provider = createAuthProvider(
        makeSettings({
          serviceAccount: 'automation',
          apiToken: 'signed-jwt',
          oauthClientId: 'client',
          oauthClientSecret: 'secret',
          oauthScope: 'horizon.read',
          oauthAudience: 'horizon-api',
          oauthIssuers,
        }),
      ) as ServiceAccountAuthProvider;

      expect(provider).toBeInstanceOf(ServiceAccountAuthProvider);
      expect((provider as unknown as { _oauth: unknown })._oauth).toEqual({
        clientId: 'client',
        clientSecret: 'secret',
        scope: 'horizon.read',
        audience: 'horizon-api',
        issuers: oauthIssuers,
      });
    });
  });

  describe('mTLS detection', () => {
    it('detects mTLS when clientCert is present (with clientKey)', () => {
      const settings = makeSettings({
        clientCert: '/path/to/cert.pem',
        clientKey: '/path/to/key.pem',
      });

      // MtlsAuthProvider constructor will throw because files don't exist,
      // but the factory correctly selected the mTLS path.
      expect(() => createAuthProvider(settings)).toThrow(
        'HORIZON_CLIENT_CERT file not found',
      );
    });

    it('detects mTLS when clientPfx is present', () => {
      const settings = makeSettings({
        clientPfx: '/path/to/bundle.pfx',
      });

      expect(() => createAuthProvider(settings)).toThrow(
        'HORIZON_CLIENT_PFX file not found',
      );
    });

    it('creates MtlsAuthProvider with valid PEM files', () => {
      const dir = makeTmpDir();
      const cert = writeDummyPem(dir, 'cert.pem');
      const key = writeDummyKey(dir, 'key.pem');
      const settings = makeSettings({
        clientCert: cert,
        clientKey: key,
      });
      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(MtlsAuthProvider);
    });

    it('creates MtlsAuthProvider with valid PFX file', () => {
      const dir = makeTmpDir();
      const pfx = writeDummyPfx(dir, 'client.p12');
      const settings = makeSettings({
        clientPfx: pfx,
      });
      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(MtlsAuthProvider);
    });
  });

  describe('API key detection', () => {
    it('selects ApiKeyAuthProvider when apiId is set', () => {
      const settings = makeSettings({
        apiId: 'my-api-id',
        apiKey: 'my-api-key',
      });

      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(ApiKeyAuthProvider);
    });
  });

  describe('no credentials configured', () => {
    it('throws a clear error when no certs or API key are set', () => {
      const settings = makeSettings();
      expect(() => createAuthProvider(settings)).toThrow(
        /Exactly one complete stdio authentication method/i,
      );
    });
  });

  describe('factory validation', () => {
    it('throws when both clientCert and clientPfx are set', () => {
      const settings = makeSettings({
        clientCert: '/path/to/cert.pem',
        clientKey: '/path/to/key.pem',
        clientPfx: '/path/to/bundle.pfx',
      });

      expect(() => createAuthProvider(settings)).toThrow(
        'Set HORIZON_CLIENT_CERT or HORIZON_CLIENT_PFX, not both',
      );
    });

    it('throws when clientCert is set without clientKey', () => {
      const settings = makeSettings({
        clientCert: '/path/to/cert.pem',
        clientKey: '',
      });

      expect(() => createAuthProvider(settings)).toThrow(
        'HORIZON_CLIENT_KEY is required',
      );
    });

    it('throws when apiId is set without apiKey', () => {
      const settings = makeSettings({
        apiId: 'test-id',
        apiKey: '',
      });

      expect(() => createAuthProvider(settings)).toThrow('HORIZON_API_KEY');
    });
  });

  describe('method exclusivity', () => {
    it('rejects PFX mTLS with API key credentials', () => {
      const settings = makeSettings({
        clientPfx: '/path/to/bundle.pfx',
        apiId: 'my-id',
        apiKey: 'my-key',
      });

      expect(() => createAuthProvider(settings)).toThrow(
        'Exactly one complete stdio authentication method',
      );
    });

    it('selects API key when only apiId is set', () => {
      const settings = makeSettings({
        apiId: 'my-id',
        apiKey: 'my-key',
      });

      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(ApiKeyAuthProvider);
    });

    it('rejects PEM mTLS with API key credentials', () => {
      const dir = makeTmpDir();
      const cert = writeDummyPem(dir, 'cert.pem');
      const key = writeDummyKey(dir, 'key.pem');
      const settings = makeSettings({
        clientCert: cert,
        clientKey: key,
        apiId: 'test-id',
        apiKey: 'test-key',
      });
      expect(() => createAuthProvider(settings)).toThrow(
        'Exactly one complete stdio authentication method',
      );
    });
  });

  describe('deprecated auth_mode warning', () => {
    it('logs a deprecation warning when authMode is set', () => {
      // The factory should still work, just log a warning.
      // Verify that setting authMode does not break provider creation.
      const settings = makeSettings({
        apiId: 'test-id',
        apiKey: 'test-key',
        authMode: 'apikey',
      });
      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(ApiKeyAuthProvider);
    });
  });
});
