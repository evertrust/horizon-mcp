import { createHmac, randomBytes } from 'node:crypto';

// Per-process random HMAC key. Fingerprints are only ever compared within the
// lifetime of one process (to bind a session to its credential), so a fresh
// random key per process is exactly right: it makes the fingerprint useless to
// anyone who later sees it, and ties it to nothing persistent.
const FINGERPRINT_KEY = randomBytes(32);

const SHORT_LEN = 12;

/**
 * Keyed fingerprint of a kind-tagged JSON credential tuple (HMAC-SHA-256).
 * Returns a 64-char hex digest. The raw credential is never recoverable from
 * the fingerprint.
 */
export function credentialFingerprint(canonical: string): string {
  return createHmac('sha256', FINGERPRINT_KEY).update(canonical).digest('hex');
}

/** A truncated fingerprint prefix, safe to put in logs. */
export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, SHORT_LEN);
}
