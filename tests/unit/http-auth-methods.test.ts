import { describe, expect, it } from 'vitest';

import {
  HttpAuthMethod,
  hasAuthMethod,
  parseHttpAuthMethods,
} from '../../src/http/auth-methods.js';
import type { HttpConfig } from '../../src/http/config.js';
import {
  CredentialError,
  extractCredential,
} from '../../src/http/credentials.js';

function config(acceptedAuthMethods: number): HttpConfig {
  return {
    host: '127.0.0.1',
    port: 8080,
    path: '/mcp',
    publicEndpoint: 'http://127.0.0.1:8080/mcp',
    allowedHosts: new Set(['127.0.0.1:8080']),
    allowedOrigins: new Set(),
    acceptedAuthMethods,
  };
}

function request(headers: Record<string, string>) {
  return { headers, socket: {} } as never;
}

describe('HTTP authentication method whitelist', () => {
  it('combines named methods into a bit mask', () => {
    const mask = parseHttpAuthMethods('api-key | service');
    expect(mask).toBe(HttpAuthMethod.ApiKey | HttpAuthMethod.Service);
    expect(hasAuthMethod(mask, HttpAuthMethod.ApiKey)).toBe(true);
    expect(hasAuthMethod(mask, HttpAuthMethod.Mtls)).toBe(false);
    expect(hasAuthMethod(mask, HttpAuthMethod.Service)).toBe(true);
  });

  it('rejects empty, duplicate, and unknown method lists', () => {
    expect(() => parseHttpAuthMethods('')).toThrow();
    expect(() => parseHttpAuthMethods('api-key,api-key')).toThrow();
    expect(() => parseHttpAuthMethods('api-key,oidc')).toThrow();
  });

  it('accepts either API-key or service-account credentials when both are enabled', () => {
    const cfg = config(HttpAuthMethod.ApiKey | HttpAuthMethod.Service);

    expect(
      extractCredential(
        request({ 'x-api-id': 'alice', 'x-api-key': 'secret' }),
        cfg,
      ),
    ).toEqual({ kind: 'api-key', apiId: 'alice', apiKey: 'secret' });
    expect(
      extractCredential(
        request({ 'x-api-sva': 'ci', 'x-api-token': 'jwt' }),
        cfg,
      ),
    ).toEqual({ kind: 'service', serviceAccount: 'ci', jwt: 'jwt' });
  });

  it('rejects a credential method outside the whitelist', () => {
    expect(() =>
      extractCredential(
        request({ 'x-api-sva': 'ci', 'x-api-token': 'jwt' }),
        config(HttpAuthMethod.ApiKey),
      ),
    ).toThrow(CredentialError);
  });

  it('rejects partial and ambiguous credential sets without fallback', () => {
    const cfg = config(HttpAuthMethod.ApiKey | HttpAuthMethod.Service);
    expect(() =>
      extractCredential(request({ 'x-api-sva': 'ci' }), cfg),
    ).toThrow(CredentialError);
    expect(() =>
      extractCredential(
        request({
          'x-api-id': 'alice',
          'x-api-key': 'secret',
          'x-api-sva': 'ci',
          'x-api-token': 'jwt',
        }),
        cfg,
      ),
    ).toThrow(CredentialError);
  });
});
