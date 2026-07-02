const SENSITIVE_FIELDS = new Set([
  'apiKey',
  'apiSecret',
  'password',
  'secret',
  'privateKey',
  'clientSecret',
  'token',
  'csrfToken',
  'passphrase',
  'credential',
  // Secret material that config-object create/update responses might echo.
  // These hold KEY MATERIAL, not reference names (those stay visible).
  'caKey',
  'accountKey',
  'eab',
  'secretKey',
  'accessKey',
  'hmacKey',
  'pkcs12',
  'keystore',
]);

// Specific error codes -> remediation hints
const SPECIFIC_REMEDIATION: Record<string, string> = {
  'HQL-001':
    'Invalid query syntax. Use validate_hcql/hrql/heql to check your query.',
  SecAuth001:
    'Authentication failed. Check credentials - ' +
    'HORIZON_API_ID/HORIZON_API_KEY for API key auth, ' +
    'or the client certificate configuration for mTLS.',
  SecPerm001:
    'Insufficient permissions. Check role assignments for the authenticated principal.',
};

// Error code suffix -> remediation hint
const SUFFIX_REMEDIATION: Record<string, string> = {
  '003': 'Not found. Use the corresponding list_* tool to see available items.',
  '004': 'Already exists. Use the corresponding update_* tool instead.',
  '005': 'Referenced by other objects. Remove references first, then retry.',
  '002':
    'Validation failed. Check the error details for specific field issues.',
};

export class HorizonError extends Error {
  readonly statusCode: number;
  readonly errorCode: string | undefined;
  readonly detail: string | undefined;
  readonly remediation: string | undefined;

  constructor(
    statusCode: number,
    opts: {
      errorCode?: string;
      message?: string;
      detail?: string;
      remediation?: string;
    } = {},
  ) {
    const formatted = HorizonError._format(
      statusCode,
      opts.errorCode,
      opts.message,
      opts.detail,
      opts.remediation,
    );
    super(formatted);
    this.name = 'HorizonError';
    this.statusCode = statusCode;
    this.errorCode = opts.errorCode;
    this.detail = opts.detail;
    this.remediation = opts.remediation;
  }

  toToolResult(): string {
    return this.message;
  }

  private static _format(
    statusCode: number,
    errorCode?: string,
    message?: string,
    detail?: string,
    remediation?: string,
  ): string {
    const parts: string[] = [];
    let header = `Horizon API error ${statusCode}`;
    if (errorCode) header += ` [${errorCode}]`;
    parts.push(header);
    if (message) parts.push(message);
    if (detail) parts.push(`Detail: ${detail}`);
    if (remediation) parts.push(`Hint: ${remediation}`);
    return parts.join('. ');
  }
}

export function redactSensitive(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return data.map(redactSensitive);
  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      result[k] = SENSITIVE_FIELDS.has(k) ? '<redacted>' : redactSensitive(v);
    }
    return result;
  }
  return data;
}

// Anything matching these patterns inside an error message is a leak risk.
const PEM_PRIVATE_KEY_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const LONG_BASE64_RE = /[A-Za-z0-9+/=_-]{40,}/g;

const MAX_ERROR_FIELD_LENGTH = 200;

/**
 * Scrub PEM private keys, JWT tokens, and long base64-ish blobs from a
 * free-form string, then truncate to MAX_ERROR_FIELD_LENGTH chars.
 */
export function redactValue(s: string): string {
  if (!s) return s;
  let scrubbed = s
    .replace(PEM_PRIVATE_KEY_RE, '<redacted-private-key>')
    .replace(JWT_RE, '<redacted-jwt>')
    .replace(LONG_BASE64_RE, '<redacted-blob>');
  if (scrubbed.length > MAX_ERROR_FIELD_LENGTH) {
    scrubbed = scrubbed.slice(0, MAX_ERROR_FIELD_LENGTH) + '... [truncated]';
  }
  return scrubbed;
}

function resolveRemediation(errorCode: string | undefined): string | undefined {
  if (!errorCode) return undefined;
  if (errorCode in SPECIFIC_REMEDIATION) return SPECIFIC_REMEDIATION[errorCode];
  const suffix = errorCode.includes('-') ? errorCode.split('-').pop()! : '';
  return SUFFIX_REMEDIATION[suffix];
}

export function parseErrorResponse(
  statusCode: number,
  body: string,
): HorizonError {
  let raw: Record<string, unknown>;
  try {
    raw = body ? (JSON.parse(body) as Record<string, unknown>) : {};
  } catch {
    return new HorizonError(statusCode, {
      message: body ? redactValue(body) : `HTTP ${statusCode}`,
    });
  }

  raw = redactSensitive(raw) as Record<string, unknown>;

  let errorCode: string | undefined;
  let message: string | undefined;
  let detail: string | undefined;

  const rawError = raw['error'];
  if (typeof rawError === 'object' && rawError !== null) {
    const errObj = rawError as Record<string, unknown>;
    errorCode =
      (errObj['code'] as string | undefined) ??
      (errObj['error'] as string | undefined);
    message =
      (errObj['message'] as string | undefined) ??
      (raw['message'] as string | undefined) ??
      (raw['title'] as string | undefined) ??
      '';
    detail =
      (errObj['detail'] as string | undefined) ??
      (raw['detail'] as string | undefined);
  } else {
    errorCode =
      (rawError as string | undefined) ?? (raw['code'] as string | undefined);
    message =
      (raw['message'] as string | undefined) ??
      (raw['title'] as string | undefined) ??
      '';
    detail = raw['detail'] as string | undefined;
  }

  if (errorCode !== undefined && typeof errorCode !== 'string') {
    errorCode = String(errorCode);
  }

  const remediation = resolveRemediation(errorCode);

  return new HorizonError(statusCode, {
    errorCode,
    message: message ? redactValue(message) : message,
    detail: detail ? redactValue(detail) : detail,
    remediation,
  });
}

/**
 * Raised when CSRF token acquisition fails so the caller cannot silently
 * proceed by sending `Csrf-Token: nocheck`.
 */
export class HorizonCsrfError extends HorizonError {
  constructor(message: string, opts: { detail?: string } = {}) {
    super(0, {
      errorCode: 'CSRF_REFRESH_FAILED',
      message,
      detail: opts.detail,
      remediation:
        'Re-authenticate (refresh the API key, browser session, or mTLS ' +
        'credentials) and retry. If the problem persists, the CSRF endpoint ' +
        'may be unreachable or blocked.',
    });
    this.name = 'HorizonCsrfError';
  }
}

/**
 * Raised when an HTTP response body does not match a caller-provided Zod
 * schema. The diff is truncated to keep error messages bounded.
 */
export class HorizonResponseValidationError extends HorizonError {
  readonly issues: string;

  constructor(opts: { path: string; statusCode: number; issues: string }) {
    const truncatedIssues =
      opts.issues.length > 500
        ? opts.issues.slice(0, 500) + '... [truncated]'
        : opts.issues;
    super(opts.statusCode, {
      errorCode: 'RESPONSE_VALIDATION_FAILED',
      message: `Response from ${opts.path} did not match expected schema`,
      detail: truncatedIssues,
      remediation:
        'Check the Horizon version compatibility or update the response ' +
        'schema used by this tool.',
    });
    this.name = 'HorizonResponseValidationError';
    this.issues = truncatedIssues;
  }
}
