import { describe, expect, it } from 'vitest';

import { assertRuntimeSupportsTls, detectRuntime } from '../../src/runtime.js';
import { loadSettings } from '../../src/settings.js';

function settings(env: Record<string, string | undefined>) {
  return loadSettings({
    HORIZON_URL: 'https://127.0.0.1:9',
    HORIZON_API_ID: '',
    HORIZON_API_KEY: '',
    ...env,
  });
}

describe('assertRuntimeSupportsTls', () => {
  it.each([
    {
      name: 'PEM mTLS',
      env: {
        HORIZON_CLIENT_CERT: '/throwaway/path/client.pem',
        HORIZON_CLIENT_KEY: '/throwaway/path/client.key',
      },
      setting: 'HORIZON_CLIENT_CERT',
    },
    {
      name: 'PFX mTLS',
      env: { HORIZON_CLIENT_PFX: '/throwaway/path/client.pfx' },
      setting: 'HORIZON_CLIENT_PFX',
    },
    {
      name: 'disabled TLS verification',
      env: {
        HORIZON_API_ID: 'runtime-test-id',
        HORIZON_API_KEY: 'runtime-test-key',
        HORIZON_VERIFY_SSL: 'false',
      },
      setting: 'HORIZON_VERIFY_SSL=false',
    },
  ])('rejects $name under Bun without exposing paths', ({ env, setting }) => {
    const configured = settings(env);

    expect(() => assertRuntimeSupportsTls(configured, { isBun: true })).toThrow(
      setting,
    );
    expect(() => assertRuntimeSupportsTls(configured, { isBun: true })).toThrow(
      'Node',
    );
    expect(() =>
      assertRuntimeSupportsTls(configured, { isBun: true }),
    ).not.toThrow('/throwaway/path');
  });

  it.each([
    {
      name: 'API-key trusted TLS',
      env: {
        HORIZON_API_ID: 'runtime-test-id',
        HORIZON_API_KEY: 'runtime-test-key',
      },
    },
    {
      name: 'service-account trusted TLS',
      env: {
        HORIZON_SERVICE_ACCOUNT: 'runtime-test-service',
        HORIZON_API_TOKEN: 'runtime-test-token',
      },
    },
  ])('allows $name under Bun', ({ env }) => {
    expect(() =>
      assertRuntimeSupportsTls(settings(env), { isBun: true }),
    ).not.toThrow();
  });

  it.each([
    {
      name: 'API-key trusted TLS',
      env: {
        HORIZON_API_ID: 'runtime-test-id',
        HORIZON_API_KEY: 'runtime-test-key',
      },
    },
    {
      name: 'service-account trusted TLS',
      env: {
        HORIZON_SERVICE_ACCOUNT: 'runtime-test-service',
        HORIZON_API_TOKEN: 'runtime-test-token',
      },
    },
    {
      name: 'PEM mTLS',
      env: {
        HORIZON_CLIENT_CERT: '/throwaway/path/client.pem',
        HORIZON_CLIENT_KEY: '/throwaway/path/client.key',
      },
    },
    {
      name: 'PFX mTLS',
      env: { HORIZON_CLIENT_PFX: '/throwaway/path/client.pfx' },
    },
    {
      name: 'disabled TLS verification',
      env: {
        HORIZON_API_ID: 'runtime-test-id',
        HORIZON_API_KEY: 'runtime-test-key',
        HORIZON_VERIFY_SSL: 'false',
      },
    },
  ])('allows $name under Node', ({ env }) => {
    expect(() =>
      assertRuntimeSupportsTls(settings(env), { isBun: false }),
    ).not.toThrow();
  });
});

describe('detectRuntime', () => {
  it('recognizes a simulated Bun runtime', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'bun');

    try {
      Object.defineProperty(process.versions, 'bun', {
        configurable: true,
        value: 'test-runtime',
      });

      expect(detectRuntime().isBun).toBe(true);
    } finally {
      if (descriptor) {
        Object.defineProperty(process.versions, 'bun', descriptor);
      } else {
        delete (process.versions as { bun?: string }).bun;
      }
    }
  });
});
