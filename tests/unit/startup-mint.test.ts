import { describe, expect, it, vi } from 'vitest';

import { ServiceAccountAuthProvider } from '../../src/auth/service-account.js';
import { mintInitialTokenAtStartup } from '../../src/auth/startup-mint.js';
import type { Logger } from '../../src/logging.js';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`;
}

function logger(): Logger & {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}

describe('mintInitialTokenAtStartup', () => {
  it('logs safe mint details after a successful initial mint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const now = Math.floor(Date.now() / 1000);
    const token = jwt({ iss: 'https://issuer.example.com', exp: now + 3600 });
    const auth = new ServiceAccountAuthProvider('ci', '', {
      clientId: 'client',
      clientSecret: 'secret',
      issuers: {
        'https://issuer.example.com': {
          tokenUrl:
            'https://oauth.example.com/token?client_secret=never-log-this-url-secret',
          authMethod: 'client_secret_post',
        },
      },
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ access_token: token }), {
          status: 200,
        }),
      ),
    });
    const log = logger();

    try {
      await expect(
        mintInitialTokenAtStartup(auth, log),
      ).resolves.toBeUndefined();
      expect(log.info).toHaveBeenCalledWith(
        'minted the initial service-account token from https://oauth.example.com/token (expires in 3600 s)',
      );
      expect(JSON.stringify(log.info.mock.calls)).not.toContain(token);
      expect(JSON.stringify(log.info.mock.calls)).not.toContain(
        'never-log-this-url-secret',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a safe failure reason and continues serving', async () => {
    const responseSecret = 'never-log-this-response-secret';
    const auth = new ServiceAccountAuthProvider('ci', '', {
      clientId: 'client',
      clientSecret: 'secret',
      issuers: {
        'https://issuer.example.com': {
          tokenUrl: 'https://oauth.example.com/token',
          authMethod: 'client_secret_basic',
        },
      },
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: responseSecret }), {
          status: 503,
        }),
      ),
    });
    const log = logger();

    await expect(mintInitialTokenAtStartup(auth, log)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      'failed to mint the initial service-account token: OAuth token request failed with HTTP 503',
    );
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(responseSecret);
  });
});
