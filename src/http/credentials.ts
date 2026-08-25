import { ApiKeyAuthProvider } from '../auth/apikey.js';
import type { AuthProvider } from '../auth/base.js';
import { CertForwardAuthProvider } from '../auth/cert-forward.js';
import { ServiceAccountAuthProvider } from '../auth/service-account.js';
import type { HorizonSettings } from '../settings.js';
import { HttpAuthMethod, hasAuthMethod } from './auth-methods.js';
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
  | { kind: 'api-key'; apiId: string; apiKey: string }
  | {
      kind: 'service';
      serviceAccount: string;
      jwt: string;
      oauth?: {
        clientId: string;
        clientSecret: string;
        scope?: string;
        audience?: string;
      };
    }
  | { kind: 'cert'; pem: string };

/** Minimal shape of the inbound request that credential resolution needs. */
export interface CredentialRequest {
  headers: Record<string, string | string[] | undefined>;
  socket: {
    remoteAddress?: string;
    getPeerCertificate?: (detailed?: boolean) => { raw?: Buffer } | undefined;
  };
}

const UNSUPPORTED_CRED_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
];

const CERT_FORWARD_HEADER_ALIASES = [
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
 * Resolve one credential from the request and enforce the configured whitelist.
 * Throws CredentialError on a missing, wrong-type, or unexpected credential.
 */
export function extractCredential(
  req: CredentialRequest,
  config: HttpConfig,
): CredentialMaterial {
  for (const name of UNSUPPORTED_CRED_HEADERS) {
    if (headerValue(req.headers, name) !== undefined) {
      // A conformant MCP client that tried OAuth would otherwise get a bare
      // 400 with no way to tell what this endpoint does accept. See
      // docs/adr/0001-mcp-authorization.md for why OAuth is not supported yet.
      throw new CredentialError(
        400,
        `unsupported client credential header "${name}": this server does not ` +
          `support MCP OAuth authorization. Use one of the methods enabled by ` +
          `HORIZON_HTTP_AUTH_METHODS (api-key, mtls, service).`,
      );
    }
  }

  const configuredInbound = config.mtls?.inbound?.header.toLowerCase();
  for (const name of CERT_FORWARD_HEADER_ALIASES) {
    if (
      name !== configuredInbound &&
      headerValue(req.headers, name) !== undefined
    ) {
      throw new CredentialError(
        400,
        `unexpected client certificate header "${name}"`,
      );
    }
  }

  const apiId = headerValue(req.headers, 'x-api-id');
  const apiKey = headerValue(req.headers, 'x-api-key');
  if (Boolean(apiId) !== Boolean(apiKey)) {
    throw new CredentialError(
      401,
      'API-key authentication requires both X-API-ID and X-API-KEY headers',
    );
  }

  const serviceAccount = headerValue(req.headers, 'x-api-sva');
  const jwt = headerValue(req.headers, 'x-api-token');
  if (Boolean(serviceAccount) !== Boolean(jwt)) {
    throw new CredentialError(
      401,
      'service authentication requires both X-API-SVA and X-API-TOKEN headers',
    );
  }

  const oauthClientId = headerValue(req.headers, 'x-oauth-client-id');
  const oauthClientSecret = headerValue(req.headers, 'x-oauth-client-secret');
  const oauthScope = headerValue(req.headers, 'x-oauth-scope');
  const oauthAudience = headerValue(req.headers, 'x-oauth-audience');
  const hasOauthMetadata = Boolean(
    oauthClientId || oauthClientSecret || oauthScope || oauthAudience,
  );
  if (hasOauthMetadata && (!serviceAccount || !jwt)) {
    throw new CredentialError(
      400,
      'OAuth renewal headers require a service-account credential',
    );
  }
  if (Boolean(oauthClientId) !== Boolean(oauthClientSecret)) {
    throw new CredentialError(
      401,
      'OAuth renewal requires both X-OAUTH-CLIENT-ID and X-OAUTH-CLIENT-SECRET',
    );
  }

  const candidates: CredentialMaterial[] = [];
  if (apiId && apiKey) candidates.push({ kind: 'api-key', apiId, apiKey });
  if (serviceAccount && jwt) {
    candidates.push({
      kind: 'service',
      serviceAccount,
      jwt,
      ...(oauthClientId && oauthClientSecret
        ? {
            oauth: {
              clientId: oauthClientId,
              clientSecret: oauthClientSecret,
              ...(oauthScope ? { scope: oauthScope } : {}),
              ...(oauthAudience ? { audience: oauthAudience } : {}),
            },
          }
        : {}),
    });
  }

  const mtls = config.mtls;
  if (mtls?.inbound) {
    const raw = headerValue(req.headers, mtls.inbound.header);
    if (raw) {
      if (
        !peerMatchesProxy(req.socket.remoteAddress, mtls.inbound.trustedProxy)
      ) {
        throw new CredentialError(
          401,
          'client certificate header presented from an untrusted peer',
        );
      }
      candidates.push({ kind: 'cert', pem: decodeForwardedCert(raw) });
    }
  } else if (mtls?.listener && hasPeerCert(req)) {
    const cert = req.socket.getPeerCertificate?.();
    if (cert?.raw) candidates.push({ kind: 'cert', pem: derToPem(cert.raw) });
  }

  if (candidates.length === 0) {
    throw new CredentialError(
      401,
      'no accepted client credential was supplied',
    );
  }
  if (candidates.length > 1) {
    throw new CredentialError(
      400,
      'multiple client authentication methods were supplied',
    );
  }

  const material = candidates[0]!;
  const method =
    material.kind === 'api-key'
      ? HttpAuthMethod.ApiKey
      : material.kind === 'service'
        ? HttpAuthMethod.Service
        : HttpAuthMethod.Mtls;
  if (!hasAuthMethod(config.acceptedAuthMethods, method)) {
    throw new CredentialError(
      401,
      `${material.kind} authentication is not accepted by this server`,
    );
  }
  return material;
}

/**
 * The fingerprint a credential material binds to. Used both at session
 * creation and on each later request to re-verify the resent credential
 * matches its session.
 */
export function credentialFingerprintOf(
  material: CredentialMaterial,
): string | undefined {
  switch (material.kind) {
    case 'api-key':
      // A structured tuple preserves the id/key boundary even when either
      // value contains a colon (unlike `${id}:${key}`).
      return credentialFingerprint(
        JSON.stringify([material.kind, material.apiId, material.apiKey]),
      );
    case 'service':
      return credentialFingerprint(
        JSON.stringify(
          material.oauth
            ? [
                material.kind,
                material.serviceAccount,
                material.jwt,
                material.oauth.clientId,
                material.oauth.clientSecret,
                material.oauth.scope,
                material.oauth.audience,
              ]
            : [material.kind, material.serviceAccount, material.jwt],
        ),
      );
    case 'cert':
      return credentialFingerprint(
        JSON.stringify([material.kind, material.pem]),
      );
  }
}

/** Build the per-session AuthProvider. */
export function buildSessionAuth(
  material: CredentialMaterial,
  config: HttpConfig,
  settings: HorizonSettings,
): { auth: AuthProvider } {
  switch (material.kind) {
    case 'api-key':
      return {
        auth: new ApiKeyAuthProvider(material.apiId, material.apiKey),
      };
    case 'service':
      return {
        auth: new ServiceAccountAuthProvider(
          material.serviceAccount,
          material.jwt,
          material.oauth
            ? {
                ...material.oauth,
                ...(settings.oauthIssuers !== undefined
                  ? { issuers: settings.oauthIssuers }
                  : {}),
              }
            : undefined,
        ),
      };
    case 'cert': {
      const forwardHeader = config.mtls?.forwardHeader ?? 'SSL_CLIENT_CERT';
      return {
        auth: new CertForwardAuthProvider(forwardHeader, material.pem),
      };
    }
  }
}
