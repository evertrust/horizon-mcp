/**
 * Central credential-header hygiene for HTTP mode.
 *
 * Two concerns:
 *  - Stripping: after the request credential is captured and fingerprinted,
 *    the secret headers must be removed before the request reaches
 *    `transport.handleRequest`, so they never surface in `requestInfo.headers`
 *    inside tool handlers. The SDK converts the Node request via
 *    `@hono/node-server`, which builds the Web request headers from
 *    `req.rawHeaders` (the raw array), NOT the parsed `req.headers` object - so
 *    BOTH must be scrubbed.
 *  - Redaction: access logs and error paths never print these names' values;
 *    callers log only method/path/status and a credential fingerprint.
 */

// Lowercased header names that must never be logged or forwarded onward.
export const DEFAULT_SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'x-api-id',
  'x-api-key',
  'x-api-sva',
  'x-api-token',
  'x-oauth-client-id',
  'x-oauth-client-secret',
  'x-oauth-scope',
  'x-oauth-audience',
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'csrf-token',
  // Common client-cert forwarding header aliases.
  'ssl-client-cert',
  'ssl_client_cert',
  'x-forwarded-client-cert',
  'x-forwarded-tls-client-cert',
]);

/**
 * The default sensitive set plus any deployment-specific header names (e.g. the
 * configured inbound and forward cert headers), lowercased.
 */
export function buildSensitiveHeaderSet(extra: Iterable<string>): Set<string> {
  const set = new Set(DEFAULT_SENSITIVE_HEADERS);
  for (const name of extra) {
    if (name) set.add(name.toLowerCase());
  }
  return set;
}

interface ScrubbableRequest {
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: string[];
}

/**
 * Remove every sensitive header from BOTH the parsed `headers` object and the
 * `rawHeaders` array, in place. Call after capturing/fingerprinting the
 * credential and BEFORE `transport.handleRequest`.
 */
export function scrubSensitiveHeaders(
  req: ScrubbableRequest,
  sensitive: ReadonlySet<string>,
): void {
  // 1. Parsed headers (Node lowercases these keys, but be defensive).
  for (const name of Object.keys(req.headers)) {
    if (sensitive.has(name.toLowerCase())) {
      delete req.headers[name];
    }
  }

  // 2. Raw headers: [name0, value0, name1, value1, ...]. Drop name/value pairs
  // whose name (even index) is sensitive.
  const raw = req.rawHeaders;
  const cleaned: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i]!;
    if (!sensitive.has(name.toLowerCase())) {
      cleaned.push(name, raw[i + 1]!);
    }
  }
  req.rawHeaders = cleaned;
}
