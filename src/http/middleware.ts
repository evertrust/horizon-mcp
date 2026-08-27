import { HttpAuthMethod, hasAuthMethod } from './auth-methods.js';
import type { HttpConfig } from './config.js';

/**
 * Host-header validation (DNS-rebinding defense). The Host must exactly match
 * one of the allowed values (case-insensitive, trailing dot tolerated). A
 * missing Host is rejected - every HTTP/1.1 request carries one.
 */
export function isHostAllowed(
  hostHeader: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase().replace(/\.$/, '');
  return allowed.has(host);
}

/**
 * Origin validation. A request with no Origin is allowed (non-browser MCP
 * clients send none). A present Origin must be in the allow-list; when no
 * origins are configured, any present Origin is rejected.
 */
export function isOriginAllowed(
  originHeader: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (originHeader === undefined) return true;
  return allowed.has(originHeader.toLowerCase());
}

/** Request headers the browser CORS preflight is allowed to send. */
export function allowedRequestHeaders(config: HttpConfig): string[] {
  // MCP 2026-07-28 removed sessions and SSE resumability, so Mcp-Session-Id
  // and Last-Event-ID are gone. Mcp-Method and Mcp-Name are new and required:
  // the server validates them against the request body.
  const base = [
    'Content-Type',
    'Accept',
    'MCP-Protocol-Version',
    'Mcp-Method',
    'Mcp-Name',
  ];
  if (hasAuthMethod(config.acceptedAuthMethods, HttpAuthMethod.ApiKey)) {
    base.push('X-API-ID', 'X-API-KEY');
  }
  if (hasAuthMethod(config.acceptedAuthMethods, HttpAuthMethod.Service)) {
    base.push(
      'X-API-SVA',
      'X-API-TOKEN',
      'X-OAUTH-CLIENT-ID',
      'X-OAUTH-CLIENT-SECRET',
      'X-OAUTH-SCOPE',
      'X-OAUTH-AUDIENCE',
    );
  }
  return base;
}

/**
 * CORS response headers for an allowed Origin. No wildcard-with-credentials:
 * the server never relies on cookies, so credentials are not enabled, and the
 * echoed Origin is only ever one already validated by `isOriginAllowed`.
 */
export function corsHeaders(
  origin: string | undefined,
  config: HttpConfig,
): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin !== undefined && config.allowedOrigins.has(origin.toLowerCase())) {
    headers['Access-Control-Allow-Origin'] = origin;
    // POST only: GET and DELETE were the 2025 session operations and are now
    // answered with 405.
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] =
      allowedRequestHeaders(config).join(', ');
  }
  return headers;
}
