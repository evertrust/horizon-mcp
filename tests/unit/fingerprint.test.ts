import { describe, expect, it } from 'vitest';

import {
  credentialFingerprint,
  fingerprintsMatch,
  shortFingerprint,
} from '../../src/http/fingerprint.js';

describe('credentialFingerprint', () => {
  it('is deterministic within a process', () => {
    expect(credentialFingerprint('id:key')).toBe(
      credentialFingerprint('id:key'),
    );
  });

  it('differs for different credentials', () => {
    expect(credentialFingerprint('id:key')).not.toBe(
      credentialFingerprint('id:other'),
    );
  });

  it('produces a 64-char hex sha256 digest', () => {
    expect(credentialFingerprint('id:key')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is keyed, not a bare hash of the input', () => {
    // A bare sha256 of "id:key" is a fixed public value; a keyed HMAC under a
    // per-process random key must not equal it.
    const bareSha256 =
      '936a185caaa266bb9cbe981e9e05cb78cd732b0b3280eb944412bb6f8f8f07af';
    expect(credentialFingerprint('hello')).not.toBe(bareSha256);
  });
});

describe('fingerprintsMatch', () => {
  it('matches identical fingerprints', () => {
    const fp = credentialFingerprint('id:key');
    expect(fingerprintsMatch(fp, fp)).toBe(true);
  });

  it('rejects different fingerprints', () => {
    expect(
      fingerprintsMatch(credentialFingerprint('a'), credentialFingerprint('b')),
    ).toBe(false);
  });

  it('returns false (does not throw) on a length mismatch', () => {
    expect(fingerprintsMatch('abcd', credentialFingerprint('a'))).toBe(false);
  });
});

describe('shortFingerprint', () => {
  it('returns a truncated prefix safe for logs', () => {
    const fp = credentialFingerprint('id:key');
    const short = shortFingerprint(fp);
    expect(short.length).toBeLessThan(fp.length);
    expect(fp.startsWith(short)).toBe(true);
  });
});
