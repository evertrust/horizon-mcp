import { describe, expect, it, vi } from 'vitest';

import { ServiceAccountAuthProvider } from '../../src/auth/service-account.js';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ServiceAccountAuthProvider client_credentials renewal', () => {
  it('never contacts a JWT-controlled issuer before Horizon validates the token', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const token = jwt({
      iss: 'https://issuer.example.com',
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const provider = new ServiceAccountAuthProvider('ci', token, {
      clientId: 'client',
      clientSecret: 'secret',
      fetcher,
    });

    await provider.refreshIfNeeded();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await provider.getHeaders()).toEqual({
      'X-API-SVA': 'ci',
      'X-API-TOKEN': token,
    });
  });

  it('discovers the token endpoint and renews a near-expiry JWT', async () => {
    const now = Math.floor(Date.now() / 1000);
    const initial = jwt({
      iss: 'https://issuer.example.com/tenant',
      exp: now + 30,
    });
    const renewed = jwt({
      iss: 'https://issuer.example.com/tenant',
      exp: now + 3600,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          issuer: 'https://issuer.example.com/tenant',
          token_endpoint: 'https://issuer.example.com/oauth/token',
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        }),
      )
      .mockResolvedValueOnce(response(200, { access_token: renewed }));
    const provider = new ServiceAccountAuthProvider('ci', initial, {
      clientId: 'client id',
      clientSecret: 'secret:value',
      scope: 'horizon.read horizon.write',
      audience: 'horizon-api',
      fetcher,
      refreshSkewSeconds: 60,
    });

    provider.markValidated();
    await provider.refreshIfNeeded();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://issuer.example.com/tenant/.well-known/openid-configuration',
    );
    const tokenRequest = fetcher.mock.calls[1];
    expect(tokenRequest?.[0]).toBe('https://issuer.example.com/oauth/token');
    expect(tokenRequest?.[1]?.method).toBe('POST');
    expect(new Headers(tokenRequest?.[1]?.headers).get('Authorization')).toBe(
      `Basic ${Buffer.from('client id:secret:value').toString('base64')}`,
    );
    const body = String(tokenRequest?.[1]?.body);
    expect(new URLSearchParams(body).get('grant_type')).toBe(
      'client_credentials',
    );
    expect(new URLSearchParams(body).get('scope')).toBe(
      'horizon.read horizon.write',
    );
    expect(new URLSearchParams(body).get('audience')).toBe('horizon-api');
    expect((await provider.getHeaders())['X-API-TOKEN']).toBe(renewed);
  });

  it('uses client_secret_post when discovery does not allow Basic auth', async () => {
    const now = Math.floor(Date.now() / 1000);
    const initial = jwt({ iss: 'https://idp.example.com', exp: now + 1 });
    const renewed = jwt({ iss: 'https://idp.example.com', exp: now + 3600 });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          issuer: 'https://idp.example.com',
          token_endpoint: 'https://idp.example.com/token',
          token_endpoint_auth_methods_supported: ['client_secret_post'],
        }),
      )
      .mockResolvedValueOnce(response(200, { access_token: renewed }));
    const provider = new ServiceAccountAuthProvider('ci', initial, {
      clientId: 'client',
      clientSecret: 'secret',
      fetcher,
    });

    provider.markValidated();
    await provider.refreshIfNeeded();

    const tokenRequest = fetcher.mock.calls[1]?.[1];
    expect(new Headers(tokenRequest?.headers).has('Authorization')).toBe(false);
    const body = new URLSearchParams(String(tokenRequest?.body));
    expect(body.get('client_id')).toBe('client');
    expect(body.get('client_secret')).toBe('secret');
  });

  it('forces one shared renewal after Horizon rejects the current token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const initial = jwt({
      iss: 'https://issuer.example.com',
      exp: now + 3600,
    });
    const renewed = jwt({
      iss: 'https://issuer.example.com',
      exp: now + 7200,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          issuer: 'https://issuer.example.com',
          token_endpoint: 'https://issuer.example.com/token',
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        }),
      )
      .mockResolvedValueOnce(response(200, { access_token: renewed }));
    const provider = new ServiceAccountAuthProvider('ci', initial, {
      clientId: 'client',
      clientSecret: 'secret',
      fetcher,
    });
    provider.markValidated();

    await provider.refreshIfNeeded();
    expect(fetcher).not.toHaveBeenCalled();

    await provider.markAuthFailed();
    await Promise.all([
      provider.refreshIfNeeded(),
      provider.refreshIfNeeded(),
      provider.refreshIfNeeded(),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await provider.getHeaders())['X-API-TOKEN']).toBe(renewed);
  });

  it('rejects insecure or cross-origin discovery metadata', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt({ iss: 'https://issuer.example.com', exp: now + 1 });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, {
        issuer: 'https://issuer.example.com',
        token_endpoint: 'https://evil.example.com/token',
      }),
    );
    const provider = new ServiceAccountAuthProvider('ci', token, {
      clientId: 'client',
      clientSecret: 'secret',
      fetcher,
    });
    provider.markValidated();

    await expect(provider.refreshIfNeeded()).rejects.toThrow(/origin|issuer/i);
  });
});
