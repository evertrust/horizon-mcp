import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiKeyAuthProvider } from '../../src/auth/apikey.js';
import { AuthProvider } from '../../src/auth/base.js';
import {
  HorizonError,
  HorizonResponseValidationError,
} from '../../src/client/errors.js';

// ---------------------------------------------------------------------------
// Mock undici - must be before HorizonClient import
// ---------------------------------------------------------------------------

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

// Import after mock is set up
const { HorizonClient } = await import('../../src/client/http.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake Response object. */
function fakeResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers ?? {}),
    json: () =>
      Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    text: () => Promise.resolve(bodyText),
    clone() {
      return fakeResponse(status, body, headers);
    },
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Response;
}

/** Create a HorizonClient with lazy init bypassed. */
function makeClient(auth: AuthProvider): InstanceType<typeof HorizonClient> {
  const client = new HorizonClient('https://horizon.test', auth, {
    timeout: 5,
    exportTimeout: 120,
    verifySsl: false,
  });
  // Skip lazy init - we are testing retry/reauth, not initialization
  (client as unknown as Record<string, boolean>)._initialized = true;
  return client;
}

// ---------------------------------------------------------------------------
// 1. Base auth defaults
// ---------------------------------------------------------------------------

describe('BaseAuthDefaults', () => {
  it('client_kwargs returns empty object by default', () => {
    const auth = new ApiKeyAuthProvider('id', 'key');
    expect(auth.getDispatcherOptions()).toBeUndefined();
  });

  it('markAuthFailed is a no-op by default', async () => {
    const auth = new ApiKeyAuthProvider('id', 'key');
    await expect(auth.markAuthFailed()).resolves.toBeUndefined();
  });

  it('csrfToken is undefined by default', () => {
    const auth = new ApiKeyAuthProvider('id', 'key');
    expect(auth.csrfToken).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Client retry behavior
// ---------------------------------------------------------------------------

describe('ClientRetry', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('GET retries on 503 and succeeds on next attempt', async () => {
    const auth = new ApiKeyAuthProvider('id', 'key');
    const client = makeClient(auth);

    mockFetch
      .mockResolvedValueOnce(fakeResponse(503, { error: 'unavailable' }))
      .mockResolvedValueOnce(fakeResponse(200, [{ name: 'ca1' }]));

    const result = await client.get('/api/v1/cas');
    expect(result).toEqual([{ name: 'ca1' }]);
    // Two fetch calls: first 503 (retried), then 200
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await client.close();
  });

  it('POST does not retry on failure', async () => {
    const auth = new ApiKeyAuthProvider('id', 'key');
    const client = makeClient(auth);

    mockFetch.mockResolvedValueOnce(
      fakeResponse(500, { error: 'X-001', message: 'fail' }),
    );

    await expect(
      client.post('/api/v1/cas', { name: 'test' }),
    ).rejects.toSatisfy((err: HorizonError) => {
      expect(err).toBeInstanceOf(HorizonError);
      expect(err.statusCode).toBe(500);
      return true;
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it('CSRF 403 triggers single retry after token refresh', async () => {
    const auth = new ApiKeyAuthProvider('id', 'key');
    const client = makeClient(auth);

    mockFetch
      // First PUT -> CSRF 403
      .mockResolvedValueOnce(
        fakeResponse(403, { error: 'csrf', message: 'CSRF token invalid' }),
      )
      // CSRF token fetch
      .mockResolvedValueOnce(fakeResponse(200, { token: 'new-csrf-token' }))
      // Retry PUT -> 200
      .mockResolvedValueOnce(fakeResponse(200, { name: 'test' }));

    const result = await client.put('/api/v1/cas/test', { name: 'test' });
    expect(result).toEqual({ name: 'test' });
    // 3 total calls: put(403) + csrf-fetch + put(200)
    expect(mockFetch).toHaveBeenCalledTimes(3);
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// 3. Client re-auth behavior
// ---------------------------------------------------------------------------

/** Auth provider that tracks markAuthFailed and refreshIfNeeded calls. */
class MockReauthProvider extends AuthProvider {
  markAuthFailedCount = 0;
  refreshCount = 0;

  async getHeaders(): Promise<Record<string, string>> {
    return { 'X-API-ID': 'test', 'X-API-KEY': 'test' };
  }

  async refreshIfNeeded(): Promise<void> {
    this.refreshCount += 1;
  }

  async markAuthFailed(): Promise<void> {
    this.markAuthFailedCount += 1;
  }
}

describe('ClientReauth', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('401 triggers reauth retry', async () => {
    const auth = new MockReauthProvider();
    const client = makeClient(auth);

    mockFetch
      .mockResolvedValueOnce(
        fakeResponse(401, {
          error: 'SecAuth001',
          message: 'Unauthorized',
        }),
      )
      .mockResolvedValueOnce(fakeResponse(200, [{ name: 'ca1' }]));

    const result = await client.get('/api/v1/cas');
    expect(result).toEqual([{ name: 'ca1' }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(auth.markAuthFailedCount).toBe(1);
    await client.close();
  });

  it('non-CSRF 403 triggers reauth', async () => {
    const auth = new MockReauthProvider();
    const client = makeClient(auth);

    mockFetch
      .mockResolvedValueOnce(
        fakeResponse(403, {
          error: 'SecPerm001',
          message: 'Forbidden',
        }),
      )
      .mockResolvedValueOnce(fakeResponse(200, [{ name: 'ca1' }]));

    const result = await client.get('/api/v1/cas');
    expect(result).toEqual([{ name: 'ca1' }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(auth.markAuthFailedCount).toBe(1);
    await client.close();
  });

  it('reauth only retries once - second 401 raises', async () => {
    const auth = new MockReauthProvider();
    const client = makeClient(auth);

    mockFetch
      .mockResolvedValueOnce(
        fakeResponse(401, {
          error: 'SecAuth001',
          message: 'Unauthorized',
        }),
      )
      .mockResolvedValueOnce(
        fakeResponse(401, {
          error: 'SecAuth001',
          message: 'Unauthorized',
        }),
      );

    await expect(client.get('/api/v1/cas')).rejects.toSatisfy(
      (err: HorizonError) => {
        expect(err).toBeInstanceOf(HorizonError);
        expect(err.statusCode).toBe(401);
        return true;
      },
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(auth.markAuthFailedCount).toBe(1);
    await client.close();
  });

  it('notifies once when repeated requests end in auth rejection', async () => {
    const auth = new MockReauthProvider();
    const onAuthReject = vi.fn();
    const client = new HorizonClient('https://horizon.test', auth, {
      timeout: 5,
      exportTimeout: 120,
      verifySsl: false,
      onAuthReject,
    });
    (client as unknown as Record<string, boolean>)._initialized = true;
    mockFetch.mockResolvedValue(
      fakeResponse(401, {
        error: 'SecAuth001',
        message: 'Unauthorized',
      }),
    );

    await expect(client.get('/api/v1/cas')).rejects.toBeInstanceOf(
      HorizonError,
    );
    await expect(client.get('/api/v1/cas')).rejects.toBeInstanceOf(
      HorizonError,
    );

    expect(onAuthReject).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it('preserves the HorizonError when the auth rejection hook throws', async () => {
    const auth = new MockReauthProvider();
    const client = new HorizonClient('https://horizon.test', auth, {
      timeout: 5,
      exportTimeout: 120,
      verifySsl: false,
      onAuthReject: () => {
        throw new Error('hook failed');
      },
    });
    (client as unknown as Record<string, boolean>)._initialized = true;
    mockFetch.mockResolvedValue(
      fakeResponse(401, {
        error: 'SecAuth001',
        message: 'Unauthorized',
      }),
    );

    await expect(client.get('/api/v1/cas')).rejects.toSatisfy(
      (err: HorizonError) => {
        expect(err).toBeInstanceOf(HorizonError);
        expect(err.statusCode).toBe(401);
        expect(err.message).toContain('Unauthorized');
        return true;
      },
    );
    await client.close();
  });

  it('CSRF 403 uses CSRF path, not reauth path', async () => {
    const auth = new MockReauthProvider();
    const client = makeClient(auth);

    mockFetch
      // First PUT -> CSRF 403
      .mockResolvedValueOnce(
        fakeResponse(403, {
          error: 'csrf',
          message: 'CSRF token invalid',
        }),
      )
      // CSRF token fetch
      .mockResolvedValueOnce(fakeResponse(200, { token: 'new-csrf' }))
      // Retry PUT -> 200
      .mockResolvedValueOnce(fakeResponse(200, { name: 'test' }));

    const result = await client.put('/api/v1/cas/test', { name: 'test' });
    expect(result).toEqual({ name: 'test' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // CSRF path should NOT trigger markAuthFailed
    expect(auth.markAuthFailedCount).toBe(0);
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// 4. Optional Zod response validation
// ---------------------------------------------------------------------------

describe('ClientSchemaValidation', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('throws HorizonResponseValidationError on mismatched schema', async () => {
    const auth = new ApiKeyAuthProvider('id', 'key');
    const client = makeClient(auth);

    // Server returns { name: <number> }, but schema expects string.
    mockFetch.mockResolvedValueOnce(fakeResponse(200, { name: 42 }));

    const schema = z.object({ name: z.string() });

    await expect(
      client.get('/api/v1/cas/test', undefined, { schema }),
    ).rejects.toBeInstanceOf(HorizonResponseValidationError);
    await client.close();
  });

  it('returns parsed body when schema matches', async () => {
    const auth = new ApiKeyAuthProvider('id', 'key');
    const client = makeClient(auth);

    mockFetch.mockResolvedValueOnce(fakeResponse(200, { name: 'ca1' }));

    const schema = z.object({ name: z.string() });
    const result = await client.get('/api/v1/cas/test', undefined, { schema });
    expect(result).toEqual({ name: 'ca1' });
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// 5. Insecure TLS warning
// ---------------------------------------------------------------------------

describe('ClientTlsWarning', () => {
  it('warns once when verifySsl is false', () => {
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      new HorizonClient(
        'https://horizon.test',
        new ApiKeyAuthProvider('id', 'key'),
        {
          timeout: 5,
          exportTimeout: 120,
          verifySsl: false,
        },
      );
      const warnings = writeSpy.mock.calls.filter((call) =>
        String(call[0]).includes('TLS certificate verification is OFF'),
      );
      expect(warnings).toHaveLength(1);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('does not warn when verifySsl is true', () => {
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      new HorizonClient(
        'https://horizon.test',
        new ApiKeyAuthProvider('id', 'key'),
        {
          timeout: 5,
          exportTimeout: 120,
          verifySsl: true,
        },
      );
      const warnings = writeSpy.mock.calls.filter((call) =>
        String(call[0]).includes('TLS certificate verification is OFF'),
      );
      expect(warnings).toHaveLength(0);
    } finally {
      writeSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Multipart success-path body parsing
// ---------------------------------------------------------------------------

describe('ClientMultipart', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns {} for an empty 2xx body instead of throwing', async () => {
    const auth = new ApiKeyAuthProvider('id', 'key');
    const client = makeClient(auth);

    // Empty (non-JSON) 2xx body - resp.json() would throw SyntaxError.
    mockFetch.mockResolvedValueOnce(fakeResponse(200, ''));

    const result = await client.postMultipart('/api/v1/upload', []);
    expect(result).toEqual({});
    await client.close();
  });
});
