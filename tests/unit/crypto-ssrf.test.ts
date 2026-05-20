import * as dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAndCheckHost } from '../../src/tools/assist/crypto.js';

describe('resolveAndCheckHost', () => {
  const originalEnv = process.env['HORIZON_ALLOW_PRIVATE_TLS_PROBE'];

  beforeEach(() => {
    delete process.env['HORIZON_ALLOW_PRIVATE_TLS_PROBE'];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['HORIZON_ALLOW_PRIVATE_TLS_PROBE'];
    } else {
      process.env['HORIZON_ALLOW_PRIVATE_TLS_PROBE'] = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it('rejects RFC1918 IPv4 (192.168.0.0/16) resolved from a hostname', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
      address: '192.168.1.1',
      family: 4,
    } as unknown as Awaited<ReturnType<typeof dns.promises.lookup>>);

    await expect(resolveAndCheckHost('evil.example.com')).rejects.toThrow(
      /Private\/link-local IP 192\.168\.1\.1 .*blocked/,
    );
  });

  it('rejects loopback IPv4 (127.0.0.1)', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
      address: '127.0.0.1',
      family: 4,
    } as unknown as Awaited<ReturnType<typeof dns.promises.lookup>>);

    await expect(resolveAndCheckHost('localhost')).rejects.toThrow(/127\.0\.0\.1/);
  });

  it('rejects link-local IPv4 (169.254.0.0/16)', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
      address: '169.254.169.254',
      family: 4,
    } as unknown as Awaited<ReturnType<typeof dns.promises.lookup>>);

    await expect(
      resolveAndCheckHost('metadata.example.com'),
    ).rejects.toThrow(/169\.254\.169\.254/);
  });

  it('rejects CGNAT range (100.64.0.0/10)', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
      address: '100.64.1.1',
      family: 4,
    } as unknown as Awaited<ReturnType<typeof dns.promises.lookup>>);

    await expect(resolveAndCheckHost('cgnat.example.com')).rejects.toThrow(
      /100\.64\.1\.1/,
    );
  });

  it('rejects IPv6 loopback (::1) passed directly without DNS', async () => {
    const lookupSpy = vi.spyOn(dns.promises, 'lookup');

    await expect(resolveAndCheckHost('::1')).rejects.toThrow(/::1/);
    // Direct IP literals must not trigger a DNS lookup.
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped IPv6 of a private v4 (::ffff:192.168.1.1)', async () => {
    await expect(resolveAndCheckHost('::ffff:192.168.1.1')).rejects.toThrow(
      /Private\/link-local IP/,
    );
  });

  it('allows public IPv4 (8.8.8.8) resolved from a hostname', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
      address: '8.8.8.8',
      family: 4,
    } as unknown as Awaited<ReturnType<typeof dns.promises.lookup>>);

    await expect(resolveAndCheckHost('public.example.com')).resolves.toEqual({
      ip: '8.8.8.8',
    });
  });

  it('bypasses the block when HORIZON_ALLOW_PRIVATE_TLS_PROBE=1', async () => {
    process.env['HORIZON_ALLOW_PRIVATE_TLS_PROBE'] = '1';
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
      address: '10.0.0.5',
      family: 4,
    } as unknown as Awaited<ReturnType<typeof dns.promises.lookup>>);

    await expect(resolveAndCheckHost('internal.corp.local')).resolves.toEqual({
      ip: '10.0.0.5',
    });
  });
});
