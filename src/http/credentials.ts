import { ApiKeyAuthProvider } from '../auth/apikey.js';
import type { AuthProvider } from '../auth/base.js';
import { CertForwardAuthProvider } from '../auth/cert-forward.js';
import { createAuthProvider } from '../auth/index.js';
import type { HorizonSettings } from '../settings.js';
import type { HttpConfig } from './config.js';
import { credentialFingerprint } from './fingerprint.js';

/** Raised when a request's credential is missing, wrong-type, or unexpected. */
export class CredentialError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CredentialError';
    this.status = status;
  }
}

export type CredentialMaterial =
  | { kind: 'service' }
  | { kind: 'api-key'; apiId: string; apiKey: string }
  | { kind: 'cert'; pem: string };

/** Minimal shape of the inbound request that credential resolution needs. */
export interface CredentialRequest {
  headers: Record<string, string | string[] | undefined>;
  socket: {
    remoteAddress?: string;
    getPeerCertificate?: (detailed?: boolean) => { raw?: Buffer } | undefined;
  };
}

// Client-supplied credential headers that service mode must reject outright.
const CLIENT_CRED_HEADERS = [
  'x-api-id',
  'x-api-key',
  'authorization',
  'proxy-authorization',
  'cookie',
  'ssl-client-cert',
  'ssl_client_cert',
  'x-forwarded-client-cert',
  'x-forwarded-tls-client-cert',
];

function headerValue(
  headers: CredentialRequest['headers'],
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()] ?? headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function hasPeerCert(req: CredentialRequest): boolean {
  const cert = req.socket.getPeerCertificate?.();
  return Boolean(cert && cert.raw && cert.raw.length > 0);
}

// -- IP / proxy matching ------------------------------------------------------

function normalizeV4(addr: string): string {
  // IPv4-mapped IPv6 (e.g. ::ffff:10.0.0.5) -> 10.0.0.5
  return addr.replace(/^::ffff:/i, '');
}

function ipv4ToInt(addr: string): number | undefined {
  const parts = addr.split('.');
  if (parts.length !== 4) return undefined;
  let acc = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
    acc = (acc << 8) | n;
  }
  return acc >>> 0;
}

/**
 * Whether the direct TCP peer address matches a trusted-proxy spec (an exact
 * IP or an IPv4 CIDR). The caller MUST pass `req.socket.remoteAddress`, never
 * an X-Forwarded-For value.
 */
export function peerMatchesProxy(
  remoteAddress: string | undefined,
  spec: string,
): boolean {
  if (!remoteAddress) return false;
  const addr = normalizeV4(remoteAddress);

  if (spec.includes('/')) {
    const [range, bitsStr] = spec.split('/');
    const bits = Number.parseInt(bitsStr ?? '', 10);
    const a = ipv4ToInt(addr);
    const r = ipv4ToInt(normalizeV4(range ?? ''));
    if (a === undefined || r === undefined || !Number.isFinite(bits)) {
      return addr === normalizeV4(range ?? '');
    }
    if (bits === 0) return true; // /0 = all peers (validated at startup)
    if (bits < 0 || bits > 32) return false;
    const mask = (~0 << (32 - bits)) >>> 0;
    return (a & mask) === (r & mask);
  }

  return addr === normalizeV4(spec);
}

// -- Certificate encoding -----------------------------------------------------

function derToPem(der: Buffer): string {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * Decode a forwarded client certificate header into a PEM string. Accepts
 * URL-encoded PEM (nginx `$ssl_client_escaped_cert`), raw PEM, or base64 DER
 * (HAProxy-style), normalizing all to PEM.
 */
export function decodeForwardedCert(value: string): string {
  let decoded = value;
  if (value.includes('%')) {
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = value;
    }
  }
  if (decoded.includes('BEGIN CERTIFICATE')) {
    return decoded;
  }
  const der = Buffer.from(decoded.replace(/\s+/g, ''), 'base64');
  return derToPem(der);
}

// -- Resolution ---------------------------------------------------------------

/**
 * Resolve the credential material from a request per the fixed auth mode.
 * Throws CredentialError on a missing, wrong-type, or unexpected credential.
 */
export function extractCredential(
  req: CredentialRequest,
  config: HttpConfig,
): CredentialMaterial {
  switch (config.authMode) {
    case 'service': {
      for (const name of CLIENT_CRED_HEADERS) {
        if (headerValue(req.headers, name) !== undefined) {
          throw new CredentialError(
            400,
            `unexpected client credential header "${name}" in service auth mode`,
          );
        }
      }
      if (hasPeerCert(req)) {
        throw new CredentialError(
          400,
          'unexpected client certificate in service auth mode',
        );
      }
      return { kind: 'service' };
    }

    case 'api-key': {
      const apiId = headerValue(req.headers, 'x-api-id');
      const apiKey = headerValue(req.headers, 'x-api-key');
      if (!apiId || !apiKey) {
        throw new CredentialError(
          401,
          'api-key auth mode requires both X-API-ID and X-API-KEY headers',
        );
      }
      return { kind: 'api-key', apiId, apiKey };
    }

    case 'mtls': {
      const mtls = config.mtls;
      if (!mtls) {
        throw new CredentialError(500, 'mtls auth mode is misconfigured');
      }
      if (mtls.inbound) {
        if (
          !peerMatchesProxy(req.socket.remoteAddress, mtls.inbound.trustedProxy)
        ) {
          throw new CredentialError(
            401,
            'client certificate header presented from an untrusted peer',
          );
        }
        const raw = headerValue(req.headers, mtls.inbound.header);
        if (!raw) {
          throw new CredentialError(401, 'missing client certificate header');
        }
        return { kind: 'cert', pem: decodeForwardedCert(raw) };
      }
      const cert = req.socket.getPeerCertificate?.();
      if (!cert || !cert.raw || cert.raw.length === 0) {
        throw new CredentialError(401, 'no client certificate was presented');
      }
      return { kind: 'cert', pem: derToPem(cert.raw) };
    }
  }
}

/**
 * The fingerprint a credential material binds to, or undefined for service mode
 * (no per-caller binding). Used both at session creation and on each later
 * request to re-verify the resent credential matches its session.
 */
export function credentialFingerprintOf(
  material: CredentialMaterial,
): string | undefined {
  switch (material.kind) {
    case 'service':
      return undefined;
    case 'api-key':
      return credentialFingerprint(`${material.apiId}:${material.apiKey}`);
    case 'cert':
      return credentialFingerprint(material.pem);
  }
}

/**
 * Build the per-session AuthProvider and (for per-caller modes) the credential
 * fingerprint used to anti-hijack-bind the session. Service mode forwards the
 * env identity and binds no fingerprint (Mcp-Session-Id behaves as a bearer).
 */
export function buildSessionAuth(
  material: CredentialMaterial,
  config: HttpConfig,
  settings: HorizonSettings,
): { auth: AuthProvider; fingerprint?: string } {
  const fingerprint = credentialFingerprintOf(material);
  switch (material.kind) {
    case 'service':
      return { auth: createAuthProvider(settings) };
    case 'api-key':
      return {
        auth: new ApiKeyAuthProvider(material.apiId, material.apiKey),
        fingerprint,
      };
    case 'cert': {
      const forwardHeader = config.mtls?.forwardHeader ?? 'SSL_CLIENT_CERT';
      return {
        auth: new CertForwardAuthProvider(forwardHeader, material.pem),
        fingerprint,
      };
    }
  }
}
