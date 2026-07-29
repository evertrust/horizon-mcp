import type { HorizonSettings } from '../settings.js';
import {
  HttpAuthMethod,
  type HttpAuthMethodMask,
  assertValidAuthMethodMask,
  hasAuthMethod,
} from './auth-methods.js';

/**
 * Resolved, fail-closed HTTP configuration. Built once at startup (HTTP mode
 * only) by `buildHttpConfig`, which performs every cross-field check the flat
 * settings schema cannot express. Anything malformed throws here so the server
 * refuses to start rather than guessing.
 */
export interface HttpMtlsConfig {
  /** MCP terminates client TLS itself with its own listener cert/key. */
  readonly listener?: { readonly certPath: string; readonly keyPath: string };
  /** A trusted ingress terminates client TLS and forwards the cert header. */
  readonly inbound?: { readonly header: string; readonly trustedProxy: string };
  /** Horizon-facing header the MCP sets with the captured client cert. */
  readonly forwardHeader: string;
}

export interface HttpConfig {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly publicEndpoint: string;
  readonly allowedHosts: ReadonlySet<string>;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly acceptedAuthMethods: HttpAuthMethodMask;
  readonly mtls?: HttpMtlsConfig;
}

// RFC 7230 token: the legal characters for an HTTP header field name.
const HTTP_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Header names a configurable cert/inbound header must never shadow - either
// protocol-critical or already meaningful to Horizon / the MCP. Lowercased.
const FORBIDDEN_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'cookie',
  'authorization',
  'x-api-id',
  'x-api-key',
  'x-api-sva',
  'x-api-token',
  'csrf-token',
]);

function fail(msg: string): never {
  throw new Error(`Invalid HTTP configuration: ${msg}`);
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '::1' || h.startsWith('127.');
}

function isIpv4Octets(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function validateTrustedProxy(value: string): string {
  // A bare IPv6 literal is accepted as an exact-match peer.
  if (value.includes(':') && !value.includes('/')) return value;
  if (value.includes('/')) {
    const [range, bitsStr] = value.split('/');
    const bits = Number(bitsStr);
    if (
      !isIpv4Octets(range ?? '') ||
      !Number.isInteger(bits) ||
      bits < 0 ||
      bits > 32
    ) {
      fail(`HORIZON_TRUSTED_PROXY "${value}" is not a valid IPv4 CIDR`);
    }
    return value;
  }
  if (!isIpv4Octets(value)) {
    fail(`HORIZON_TRUSTED_PROXY "${value}" is not a valid IP or CIDR`);
  }
  return value;
}

function validatePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`HORIZON_PUBLIC_URL "${value}" is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(`HORIZON_PUBLIC_URL "${value}" must use http or https`);
  }
  if (!url.host) {
    fail(`HORIZON_PUBLIC_URL "${value}" must include a host`);
  }
  return url;
}

function validateHeaderName(value: string, envName: string): string {
  if (!HTTP_TOKEN_RE.test(value)) {
    fail(`${envName} "${value}" is not a valid HTTP header token`);
  }
  const lower = value.toLowerCase();
  if (FORBIDDEN_HEADERS.has(lower) || lower.startsWith('mcp-')) {
    fail(`${envName} "${value}" collides with a reserved header name`);
  }
  return value;
}

function normalizePath(path: string): string {
  if (!path.startsWith('/')) {
    fail(`HORIZON_HTTP_PATH "${path}" must be an absolute path (start with /)`);
  }
  if (path.includes('?') || path.includes('#')) {
    fail(`HORIZON_HTTP_PATH "${path}" must not contain a query or fragment`);
  }
  // A trailing slash is normalized away (matched exactly, not a sub-route),
  // except for the bare root path "/".
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function deriveAllowedHosts(
  settings: HorizonSettings,
  publicUrl: URL | undefined,
): ReadonlySet<string> {
  // Explicit trusted hosts always win.
  if (settings.trustedHosts.length > 0) {
    return new Set(settings.trustedHosts.map((h) => h.toLowerCase()));
  }
  // Otherwise derive the allowed Host from the public origin.
  if (publicUrl) {
    return new Set([publicUrl.host.toLowerCase()]);
  }
  // No public URL and no trusted hosts: only safe when bound to loopback.
  if (!isLoopbackHost(settings.httpHost)) {
    fail(
      `bound to non-loopback host "${settings.httpHost}" but neither ` +
        `HORIZON_PUBLIC_URL nor HORIZON_TRUSTED_HOSTS is set; refusing to ` +
        `start (it would otherwise trust all Host values)`,
    );
  }
  const port = settings.httpPort;
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
}

function derivePublicEndpoint(
  settings: HorizonSettings,
  path: string,
  publicUrl: URL | undefined,
  listenerTls: boolean,
): string {
  if (publicUrl) {
    return new URL(path, publicUrl).toString();
  }
  const host = settings.httpHost;
  const hostPart =
    host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const scheme = listenerTls ? 'https' : 'http';
  return `${scheme}://${hostPart}:${settings.httpPort}${path}`;
}

function deriveAllowedOrigins(settings: HorizonSettings): ReadonlySet<string> {
  const out = new Set<string>();
  for (const origin of settings.trustedOrigins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      fail(`HORIZON_TRUSTED_ORIGINS entry "${origin}" is not a valid origin`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      fail(`HORIZON_TRUSTED_ORIGINS entry "${origin}" must use http or https`);
    }
    if (!url.host || url.origin.toLowerCase() === 'null') {
      fail(`HORIZON_TRUSTED_ORIGINS entry "${origin}" has no usable origin`);
    }
    out.add(url.origin.toLowerCase());
  }
  return out;
}

function resolveMtls(settings: HorizonSettings): HttpMtlsConfig {
  const hasCert = Boolean(settings.httpTlsCert);
  const hasKey = Boolean(settings.httpTlsKey);
  if ((hasCert || hasKey) && !(hasCert && hasKey)) {
    fail(
      `the mtls TLS listener needs both HORIZON_HTTP_TLS_CERT and ` +
        `HORIZON_HTTP_TLS_KEY`,
    );
  }
  const haveListener = hasCert && hasKey;
  const haveInbound = Boolean(settings.inboundCertHeader);
  if (haveInbound && !settings.trustedProxy) {
    fail(`HORIZON_INBOUND_CERT_HEADER requires HORIZON_TRUSTED_PROXY`);
  }
  if (!haveListener && !haveInbound) {
    fail(
      `mtls auth mode requires either a TLS listener (HORIZON_HTTP_TLS_CERT + ` +
        `HORIZON_HTTP_TLS_KEY) or a trusted ingress (HORIZON_INBOUND_CERT_` +
        `HEADER + HORIZON_TRUSTED_PROXY)`,
    );
  }
  if (haveListener && haveInbound) {
    fail(
      `configure either the TLS listener or the inbound cert header, not both`,
    );
  }

  const forwardHeader = validateHeaderName(
    settings.forwardCertHeader,
    'HORIZON_FORWARD_CERT_HEADER',
  );
  return {
    forwardHeader,
    ...(haveListener
      ? {
          listener: {
            certPath: settings.httpTlsCert,
            keyPath: settings.httpTlsKey,
          },
        }
      : {}),
    ...(haveInbound
      ? {
          inbound: {
            header: validateHeaderName(
              settings.inboundCertHeader,
              'HORIZON_INBOUND_CERT_HEADER',
            ),
            trustedProxy: validateTrustedProxy(settings.trustedProxy),
          },
        }
      : {}),
  };
}

function resolveMtlsForMethods(
  settings: HorizonSettings,
): HttpMtlsConfig | undefined {
  if (hasAuthMethod(settings.httpAuthMethods, HttpAuthMethod.Mtls)) {
    return resolveMtls(settings);
  }

  if (
    settings.httpTlsCert ||
    settings.httpTlsKey ||
    settings.inboundCertHeader ||
    settings.trustedProxy
  ) {
    fail(
      `inbound mTLS settings are configured but mtls is not listed in ` +
        `HORIZON_HTTP_AUTH_METHODS`,
    );
  }
  return undefined;
}

/**
 * Validate and resolve every HTTP-mode setting into an HttpConfig, or throw.
 * Call only when `settings.transport === 'http'`. `env` is consulted solely
 * for the HORIZON_ALLOW_PRIVATE_TLS_PROBE fail-closed gate.
 */
export function buildHttpConfig(
  settings: HorizonSettings,
  env: Record<string, string | undefined> = process.env,
): HttpConfig {
  if (settings.httpAuthMode) {
    fail(
      `HORIZON_HTTP_AUTH_MODE was replaced by HORIZON_HTTP_AUTH_METHODS; ` +
        `set a comma- or pipe-separated whitelist such as "api-key,service"`,
    );
  }
  const acceptedAuthMethods = assertValidAuthMethodMask(
    settings.httpAuthMethods,
  );
  if (env['HORIZON_ALLOW_PRIVATE_TLS_PROBE'] === '1') {
    fail(
      `HORIZON_ALLOW_PRIVATE_TLS_PROBE=1 is not allowed in HTTP mode: it would ` +
        `turn fetch_exposed_certificate into an internal-network probe ` +
        `reachable by any caller`,
    );
  }

  const path = normalizePath(settings.httpPath);
  const publicUrl = settings.publicUrl
    ? validatePublicUrl(settings.publicUrl)
    : undefined;
  const allowedHosts = deriveAllowedHosts(settings, publicUrl);
  const allowedOrigins = deriveAllowedOrigins(settings);
  const mtls = resolveMtlsForMethods(settings);
  const listenerTls = Boolean(mtls?.listener);
  if (listenerTls && publicUrl?.protocol === 'http:') {
    fail(
      `HORIZON_PUBLIC_URL must use https when the MCP TLS listener is enabled`,
    );
  }
  const publicEndpoint = derivePublicEndpoint(
    settings,
    path,
    publicUrl,
    listenerTls,
  );

  // Fail closed: API-key and JWKS service-account methods carry per-caller
  // credentials in headers, so cleartext HTTP on a non-loopback bind leaks
  // them on the wire. An HTTPS public URL denotes a TLS-terminating edge.
  const carriesHeaderCredentials =
    hasAuthMethod(acceptedAuthMethods, HttpAuthMethod.ApiKey) ||
    hasAuthMethod(acceptedAuthMethods, HttpAuthMethod.Service);
  if (
    carriesHeaderCredentials &&
    !isLoopbackHost(settings.httpHost) &&
    (publicUrl ? publicUrl.protocol !== 'https:' : true)
  ) {
    fail(
      `header-based authentication on non-loopback host "${settings.httpHost}" would ` +
        `expose per-caller credentials over cleartext http. Terminate TLS ` +
        `(set HORIZON_PUBLIC_URL to an https origin behind a TLS-terminating ` +
        `proxy) or bind to loopback.`,
    );
  }

  return {
    host: settings.httpHost,
    port: settings.httpPort,
    path,
    publicEndpoint,
    allowedHosts,
    allowedOrigins,
    acceptedAuthMethods,
    ...(mtls ? { mtls } : {}),
  };
}
