import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Per-process random HMAC key. Fingerprints are only ever compared within the
// lifetime of one process (to bind a session to its credential), so a fresh
// random key per process is exactly right: it makes the fingerprint useless to
// anyone who later sees it, and ties it to nothing persistent.
const FINGERPRINT_KEY = randomBytes(32);

const SHORT_LEN = 12;

/**
 * Keyed fingerprint of a credential's canonical bytes (HMAC-SHA-256). The
 * caller supplies the canonical form: `apiId + ':' + apiKey` for API keys, the
 * certificate's canonical PEM/DER for mTLS. Returns a 64-char hex digest. The
 * raw credential is never recoverable from the fingerprint.
 */
export function credentialFingerprint(canonical: string): string {
  return createHmac('sha256', FINGERPRINT_KEY).update(canonical).digest('hex');
}

/**
 * Timing-safe comparison of two hex fingerprints. Returns false (never throws)
 * when the lengths differ, so it is safe to call on attacker-controlled input.
 */
export function fingerprintsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/** A truncated fingerprint prefix, safe to put in logs. */
export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, SHORT_LEN);
}
