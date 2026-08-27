import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceAccountAuthProvider } from '../../src/auth/service-account.js';

const mockHorizonFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => mockHorizonFetch(...args),
  Agent: class MockAgent {
    close() {
      return Promise.resolve();
    }
  },
  FormData: class MockFormData {
    append() {}
  },
}));

const { HorizonClient } = await import('../../src/client/http.js');

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

describe('HorizonClient lazy initialization retry', () => {
  const startedAt = new Date('2026-01-01T00:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    mockHorizonFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a failed initial mint after the renewal cooldown', async () => {
    const issuer = 'https://issuer.example.com';
    const mintedJwt = jwt({
      iss: issuer,
      exp: Math.floor(startedAt.getTime() / 1000) + 3600,
    });
    const tokenFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(500, { error: 'unavailable' }))
      .mockResolvedValueOnce(response(200, { access_token: mintedJwt }));
    const auth = new ServiceAccountAuthProvider('automation', '', {
      clientId: 'client',
      clientSecret: 'secret',
      issuers: {
        [issuer]: {
          tokenUrl: 'https://issuer.example.com/token',
          authMethod: 'client_secret_basic',
        },
      },
      fetcher: tokenFetcher,
    });
    const client = new HorizonClient('https://horizon.test', auth, {
      timeout: 5,
      exportTimeout: 120,
      verifySsl: false,
    });

    await expect(
      client.get('/api/v1/security/principals/self'),
    ).rejects.toThrow('OAuth token request failed with HTTP 500');
    expect(tokenFetcher).toHaveBeenCalledTimes(1);
    expect(mockHorizonFetch).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(startedAt.getTime() + 5_000));
    await expect(
      client.get('/api/v1/security/principals/self'),
    ).rejects.toThrow('service-account token not minted yet');
    expect(tokenFetcher).toHaveBeenCalledTimes(1);
    expect(mockHorizonFetch).not.toHaveBeenCalled();

    mockHorizonFetch
      .mockResolvedValueOnce(response(404, { error: 'not found' }))
      .mockResolvedValueOnce(
        response(200, { identity: { identifier: 'automation' } }),
      )
      .mockResolvedValueOnce(response(200, { ok: true }));
    vi.setSystemTime(new Date(startedAt.getTime() + 31_000));

    await expect(
      client.get('/api/v1/security/principals/self'),
    ).resolves.toEqual({ ok: true });

    expect(tokenFetcher).toHaveBeenCalledTimes(2);
    expect(mockHorizonFetch).toHaveBeenCalledTimes(3);
    const horizonRequest = mockHorizonFetch.mock.calls[2]?.[1] as RequestInit;
    expect(new Headers(horizonRequest.headers).get('X-API-TOKEN')).toBe(
      mintedJwt,
    );
    await client.close();
  });
});
