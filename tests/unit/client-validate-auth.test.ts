import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiKeyAuthProvider } from '../../src/auth/apikey.js';
import { HorizonError } from '../../src/client/errors.js';

// Mock undici before importing HorizonClient.
const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
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

function fakeResponse(status: number, body: unknown): Response {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    json: () =>
      Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    text: () => Promise.resolve(bodyText),
    clone() {
      return fakeResponse(status, body);
    },
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Response;
}

function makeClient() {
  return new HorizonClient(
    'https://horizon.test',
    new ApiKeyAuthProvider('id', 'key'),
    {
      timeout: 5,
      exportTimeout: 120,
      verifySsl: false,
    },
  );
}

function initializedFlag(client: unknown): boolean {
  return (client as Record<string, boolean>)['_initialized'];
}

describe('HorizonClient.validateAuth', () => {
  beforeEach(() => mockFetch.mockReset());

  it('captures the principal + version on a 200 whoami and marks the client initialized', async () => {
    const client = makeClient();
    mockFetch
      .mockResolvedValueOnce(fakeResponse(200, { token: 'csrf-1' })) // CSRF
      .mockResolvedValueOnce(
        fakeResponse(200, {
          identity: { identifier: 'alice' },
          _horizonVersion: '2.10.0',
        }),
      ); // whoami

    await client.validateAuth();

    expect(client.principalName).toBe('alice');
    expect(client.horizonVersion).toBe('2.10.0');
    expect(initializedFlag(client)).toBe(true);
  });

  it('does not re-initialize on the first tool call after validateAuth', async () => {
    const client = makeClient();
    mockFetch
      .mockResolvedValueOnce(fakeResponse(200, { token: 'csrf-1' }))
      .mockResolvedValueOnce(
        fakeResponse(200, { identity: { identifier: 'alice' } }),
      );
    await client.validateAuth();

    // A subsequent GET must not trigger a second CSRF/whoami round-trip.
    mockFetch.mockResolvedValueOnce(fakeResponse(200, { ok: true }));
    await client.get('/api/v1/anything');

    expect(mockFetch).toHaveBeenCalledTimes(3); // csrf + whoami + the GET
  });

  it('throws on a non-200 whoami and leaves the client uninitialized', async () => {
    const client = makeClient();
    mockFetch
      .mockResolvedValueOnce(fakeResponse(200, { token: 'csrf-1' }))
      .mockResolvedValueOnce(fakeResponse(401, { error: 'SecAuth001' }));

    await expect(client.validateAuth()).rejects.toBeInstanceOf(HorizonError);
    expect(initializedFlag(client)).toBe(false);
  });

  it('throws when whoami is unreachable and leaves the client uninitialized', async () => {
    const client = makeClient();
    mockFetch
      .mockResolvedValueOnce(fakeResponse(200, { token: 'csrf-1' }))
      .mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      );

    await expect(client.validateAuth()).rejects.toThrow();
    expect(initializedFlag(client)).toBe(false);
  });
});
