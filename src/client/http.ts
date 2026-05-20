import { randomUUID } from 'node:crypto';
import {
  Agent,
  FormData as UndiciFormData,
  fetch as undiciFetch,
} from 'undici';
import type { RequestInit as UndiciRequestInit } from 'undici';
import type { ZodType } from 'zod';

import type { AuthProvider } from '../auth/base.js';
import { getLogger } from '../logging.js';
import {
  HorizonCsrfError,
  HorizonError,
  HorizonResponseValidationError,
  parseErrorResponse,
} from './errors.js';
import { withRetry } from './retry.js';

const logger = getLogger('horizon_mcp.client');

// PUT/DELETE endpoints verified as idempotent - initially empty
const RETRYABLE_ENDPOINTS = new Set<string>();

// Defense-in-depth cap on response bodies the client will parse.
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

// Rate-limit boundaries for the auto re-auth path on 401/403.
const REAUTH_MIN_INTERVAL_MS = 5 * 60 * 1000;
const REAUTH_MAX_INTERVAL_MS = 30 * 60 * 1000;

// Connection-error cause codes we know how to classify.
const CONNECTION_CAUSE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Read the `cause.code` chain commonly produced by undici/Node fetch
 * connection errors (the actual TCP/DNS failure is nested as `err.cause`).
 */
function getCauseCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'cause' in err) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object' && 'code' in cause) {
      return (cause as { code?: string }).code;
    }
  }
  return undefined;
}

/**
 * Bound JSON.parse to MAX_RESPONSE_BYTES. Throws HorizonError(0) if the
 * Content-Length header (or the buffered text) exceeds the limit.
 */
async function readJsonBounded<T>(
  resp: Response,
  path: string,
): Promise<T | Record<string, never>> {
  const contentLength = resp.headers.get('content-length');
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new HorizonError(0, {
        message: `Response from ${path} exceeds ${MAX_RESPONSE_BYTES} bytes (Content-Length: ${declared})`,
        remediation:
          'Use a paginated endpoint or narrow the query to reduce payload size.',
      });
    }
  }

  const text = await resp.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new HorizonError(0, {
      message: `Response from ${path} exceeds ${MAX_RESPONSE_BYTES} bytes (received: ${text.length})`,
      remediation:
        'Use a paginated endpoint or narrow the query to reduce payload size.',
    });
  }
  if (!text) return {} as Record<string, never>;
  return JSON.parse(text) as T;
}

/**
 * Common per-request options accepted by the public verb helpers.
 * `schema` enables opt-in Zod validation of the parsed body.
 * `allowCsrfNoCheck` is a per-request escape hatch for endpoints that
 * historically tolerate the literal `Csrf-Token: nocheck`.
 */
export interface RequestOptions<T = unknown> {
  timeout?: number;
  schema?: ZodType<T>;
  allowCsrfNoCheck?: boolean;
}

export interface MultipartPart {
  fieldName: string;
  filename: string;
  mimeType: string;
  data: Buffer | string;
}

export class HorizonClient {
  private readonly _baseUrl: string;
  private readonly _auth: AuthProvider;
  private readonly _timeout: number;
  readonly exportTimeout: number;
  private readonly _agent: Agent;
  private readonly _testedVersions: readonly string[];
  private readonly _warnVersions: readonly string[];
  private _csrfToken: string | undefined;
  private _initialized = false;
  private _initPromise: Promise<void> | null = null;

  // Rate-limit state for the 401 -> re-auth path.
  private _lastReauthAt: number | null = null;
  private _reauthBackoffMs: number = REAUTH_MIN_INTERVAL_MS;

  // Captured during lazy init
  principalName: string | undefined;
  horizonVersion: string | undefined;

  constructor(
    baseUrl: string,
    auth: AuthProvider,
    options: {
      timeout: number;
      exportTimeout: number;
      verifySsl: boolean;
      testedVersions?: readonly string[];
      warnVersions?: readonly string[];
    },
  ) {
    this._baseUrl = baseUrl.replace(/\/+$/, '');
    this._auth = auth;
    this._timeout = options.timeout * 1000;
    this.exportTimeout = options.exportTimeout * 1000;
    this._testedVersions = options.testedVersions ?? [];
    this._warnVersions = options.warnVersions ?? [];

    // Build undici Agent with TLS connect options
    const authConnect = auth.getDispatcherOptions();
    const connectOptions: Agent.Options['connect'] = {
      ...((typeof authConnect === 'object' ? authConnect : {}) as Record<
        string,
        unknown
      >),
      rejectUnauthorized: options.verifySsl,
    };
    this._agent = new Agent({ connect: connectOptions });
  }

  // -- Public API -----------------------------------------------------------

  async get<T = unknown>(
    path: string,
    params?: URLSearchParams,
    opts?: RequestOptions<T>,
  ): Promise<T> {
    const url = params ? `${path}?${params.toString()}` : path;
    return this._requestJson<T>('GET', url, undefined, opts);
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    opts?: RequestOptions<T>,
  ): Promise<T> {
    return this._requestJson<T>(
      'POST',
      path,
      {
        body: body !== undefined ? JSON.stringify(body) : undefined,
        timeoutMs: opts?.timeout ? opts.timeout * 1000 : undefined,
        allowCsrfNoCheck: opts?.allowCsrfNoCheck,
      },
      opts,
    );
  }

  async put<T = unknown>(
    path: string,
    body: unknown,
    opts?: RequestOptions<T>,
  ): Promise<T> {
    return this._requestJson<T>(
      'PUT',
      path,
      {
        body: JSON.stringify(body),
        allowCsrfNoCheck: opts?.allowCsrfNoCheck,
      },
      opts,
    );
  }

  async patch<T = unknown>(
    path: string,
    body: unknown,
    opts?: RequestOptions<T>,
  ): Promise<T> {
    return this._requestJson<T>(
      'PATCH',
      path,
      {
        body: JSON.stringify(body),
        allowCsrfNoCheck: opts?.allowCsrfNoCheck,
      },
      opts,
    );
  }

  async delete(
    path: string,
    opts?: RequestOptions<unknown>,
  ): Promise<unknown | null> {
    const resp = await this._request('DELETE', path, {
      allowCsrfNoCheck: opts?.allowCsrfNoCheck,
    });
    if (resp.status === 204) return null;
    const parsed = await readJsonBounded<unknown>(resp, path);
    if (opts?.schema) {
      return this._validateOrThrow(opts.schema, parsed, path, resp.status);
    }
    return parsed;
  }

  async getBytes(path: string): Promise<ArrayBuffer> {
    const resp = await this._request('GET', path);
    return resp.arrayBuffer();
  }

  async getText(path: string): Promise<string> {
    const resp = await this._request('GET', path);
    return resp.text();
  }

  async postText(
    path: string,
    body?: unknown,
    opts?: RequestOptions<string>,
  ): Promise<string> {
    const resp = await this._request('POST', path, {
      body: body !== undefined ? JSON.stringify(body) : undefined,
      timeoutMs: opts?.timeout ? opts.timeout * 1000 : undefined,
      allowCsrfNoCheck: opts?.allowCsrfNoCheck,
    });
    return resp.text();
  }

  async postMultipart<T = unknown>(
    path: string,
    parts: MultipartPart[],
  ): Promise<T> {
    const formData = new UndiciFormData();
    for (const part of parts) {
      const blobPart =
        typeof part.data === 'string'
          ? part.data
          : Uint8Array.from(part.data).buffer;
      const blob = new Blob([blobPart], { type: part.mimeType });
      formData.append(part.fieldName, blob, part.filename);
    }

    await this._ensureInitialized();
    const headers = await this._buildHeaders('POST');
    // Remove content-type - let fetch set it with boundary
    delete headers['Content-Type'];

    const requestId = randomUUID().slice(0, 12);
    headers['X-Request-Id'] = requestId;

    const start = performance.now();
    const resp = await undiciFetch(`${this._baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: formData,
      dispatcher: this._agent,
      signal: AbortSignal.timeout(this._timeout),
    } as UndiciRequestInit);

    const durationMs = Math.round(performance.now() - start);
    logger.info(`HTTP POST ${path} -> ${resp.status} (${durationMs}ms)`, {
      request_id: requestId,
      method: 'POST',
      path,
      status: resp.status,
      duration_ms: durationMs,
    });

    if (resp.status >= 400) {
      throw parseErrorResponse(resp.status, await resp.text());
    }

    return (await resp.json()) as T;
  }

  async request(
    method: string,
    path: string,
    opts?: { timeout?: number },
  ): Promise<Response> {
    return this._request(method, path, {
      timeoutMs: opts?.timeout ? opts.timeout * 1000 : undefined,
    });
  }

  async close(): Promise<void> {
    await this._agent.close();
  }

  // -- CSRF -----------------------------------------------------------------

  async fetchCsrfToken(): Promise<string | undefined> {
    // Step 1: Check auth provider (pre-refresh)
    let providerToken = this._auth.csrfToken;
    if (providerToken) {
      this._csrfToken = providerToken;
      return this._csrfToken;
    }

    // Step 2: Trigger auth refresh
    await this._auth.refreshIfNeeded();

    // Step 3: Re-check after refresh (OIDC captures csrf-token during browser flow)
    providerToken = this._auth.csrfToken;
    if (providerToken) {
      this._csrfToken = providerToken;
      return this._csrfToken;
    }

    // Step 4: Try JSON API endpoint
    try {
      const headers = await this._auth.getHeaders();
      const resp = await undiciFetch(`${this._baseUrl}/api/v1/security/csrf`, {
        method: 'GET',
        headers,
        dispatcher: this._agent,
        signal: AbortSignal.timeout(this._timeout),
      });
      if (resp.status === 200) {
        const data = (await resp.json()) as Record<string, unknown>;
        const token =
          (data['token'] as string | undefined) ??
          (data['csrfToken'] as string | undefined);
        if (token) {
          this._csrfToken = token;
          return this._csrfToken;
        }
      }
    } catch (err) {
      logger.debug(`CSRF JSON endpoint unavailable - checking cookies: ${err}`);
    }

    // Step 5: Fallback to csrf-token cookie from response headers
    // Note: undici.fetch doesn't auto-store cookies like httpx. The cookie
    // would have been captured by the Play Session auth provider instead.

    // Step 6: No CSRF source - will send "nocheck"
    return undefined;
  }

  // -- Lazy initialization --------------------------------------------------

  private async _ensureInitialized(): Promise<void> {
    if (this._initialized) return;
    if (!this._initPromise) {
      this._initPromise = this._doLazyInit();
    }
    await this._initPromise;
  }

  private async _doLazyInit(): Promise<void> {
    // 1. Trigger auth (browser login for Play Session, no-op for others)
    await this._auth.refreshIfNeeded();

    // 2. Fetch CSRF token
    await this.fetchCsrfToken();

    // 3. Whoami - capture principal name + Horizon version
    try {
      const headers = await this._auth.getHeaders();
      if (this._csrfToken) {
        headers['Csrf-Token'] = this._csrfToken;
      }

      const resp = await undiciFetch(
        `${this._baseUrl}/api/v1/security/principals/self`,
        {
          method: 'GET',
          headers,
          dispatcher: this._agent,
          signal: AbortSignal.timeout(this._timeout),
        },
      );

      if (resp.status === 200) {
        const principal = (await resp.json()) as Record<string, unknown>;
        const identity = (principal['identity'] ?? {}) as Record<
          string,
          unknown
        >;
        this.principalName =
          (identity['identifier'] as string | undefined) ??
          (principal['identifier'] as string | undefined) ??
          (principal['name'] as string | undefined) ??
          'unknown';

        this.horizonVersion = principal['_horizonVersion'] as
          | string
          | undefined;

        logger.info(
          `Authenticated as: ${this.principalName} (Horizon ${this.horizonVersion ?? 'unknown'})`,
        );

        // 4. Log version compatibility
        if (this.horizonVersion) {
          this._logVersionCompatibility(this.horizonVersion);
        }
      } else {
        logger.warning(
          `Whoami returned ${resp.status} - continuing without principal info`,
        );
      }
    } catch (err) {
      logger.warning(`Whoami failed: ${err} - continuing`);
    }

    this._initialized = true;
  }

  private _logVersionCompatibility(version: string): void {
    // Extract major.minor from version string
    const match = version.match(/^(\d+\.\d+)/);
    if (!match) return;
    const majorMinor = match[1]!;

    if (this._testedVersions.includes(majorMinor)) {
      logger.info(`Horizon version ${version} (tested - full compatibility)`);
    } else if (this._warnVersions.includes(majorMinor)) {
      logger.warning(
        `Horizon version ${version} - partially tested, some features may not work as expected`,
      );
    } else {
      logger.warning(
        `Horizon version ${version} - untested, proceed with caution`,
      );
    }
  }

  // -- Internal request pipeline --------------------------------------------

  private async _request(
    method: string,
    path: string,
    opts?: {
      body?: string;
      timeoutMs?: number;
      reauthAttempted?: boolean;
      allowCsrfNoCheck?: boolean;
    },
  ): Promise<Response> {
    const requestId = randomUUID().slice(0, 12);
    const start = performance.now();
    const timeoutMs = opts?.timeoutMs ?? this._timeout;

    await this._ensureInitialized();
    const headers = await this._buildHeaders(method, opts?.allowCsrfNoCheck);
    headers['X-Request-Id'] = requestId;

    const fetchOpts: UndiciRequestInit & { dispatcher: Agent } = {
      method,
      headers,
      dispatcher: this._agent,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (opts?.body) {
      fetchOpts.body = opts.body;
      headers['Content-Type'] = 'application/json';
    }

    const fullUrl = `${this._baseUrl}${path}`;
    let resp: Response;

    try {
      resp = await this._doRequest(method, fullUrl, fetchOpts, path);
    } catch (err) {
      const causeCode = getCauseCode(err);
      const isConnectionError =
        (causeCode !== undefined && CONNECTION_CAUSE_CODES.has(causeCode)) ||
        // Fallback when cause.code is unavailable (older runtimes / test mocks).
        (causeCode === undefined &&
          err instanceof TypeError &&
          String(err).includes('fetch'));
      if (isConnectionError) {
        throw new HorizonError(0, {
          message: `Connection to ${this._baseUrl} failed${
            causeCode ? ` (${causeCode})` : ''
          }: ${err}`,
          remediation: 'Check HORIZON_URL and network connectivity.',
        });
      }
      throw err;
    }

    const durationMs = Math.round(performance.now() - start);
    logger.info(`HTTP ${method} ${path} -> ${resp.status} (${durationMs}ms)`, {
      request_id: requestId,
      method,
      path,
      status: resp.status,
      duration_ms: durationMs,
    });

    // CSRF 403 -> single retry after token refresh.
    // Fail closed: if we cannot acquire a new token, throw HorizonCsrfError
    // rather than silently sending Csrf-Token: nocheck.
    if (resp.status === 403 && (await this._isCsrfRejection(resp.clone()))) {
      logger.info('CSRF rejected - refreshing token and retrying', {
        request_id: requestId,
      });
      await this.fetchCsrfToken();
      if (!this._csrfToken) {
        if (opts?.allowCsrfNoCheck) {
          headers['Csrf-Token'] = 'nocheck';
        } else {
          throw new HorizonCsrfError(
            'Failed to acquire CSRF token after refresh',
            {
              detail: `${method} ${path}`,
            },
          );
        }
      } else {
        headers['Csrf-Token'] = this._csrfToken;
      }
      fetchOpts.headers = headers;
      fetchOpts.signal = AbortSignal.timeout(timeoutMs);
      resp = await undiciFetch(fullUrl, fetchOpts);
      if (resp.status >= 400) {
        throw parseErrorResponse(resp.status, await resp.text());
      }
      return resp;
    }

    // Auth failure retry: 401 or 403 -> re-authenticate once, but rate-limit
    // the attempt so a wedged auth provider cannot hammer the IdP.
    if (
      (resp.status === 401 || resp.status === 403) &&
      !opts?.reauthAttempted
    ) {
      const now = Date.now();
      const elapsed =
        this._lastReauthAt === null ? Infinity : now - this._lastReauthAt;

      if (elapsed < this._reauthBackoffMs) {
        logger.warning(
          `Auth rejected (${resp.status}) - skipping re-auth (last attempt ${Math.round(
            elapsed / 1000,
          )}s ago, floor ${Math.round(this._reauthBackoffMs / 1000)}s)`,
          { request_id: requestId },
        );
        // Return the 401/403 to the caller for normal error handling.
        if (resp.status >= 400) {
          throw parseErrorResponse(resp.status, await resp.text());
        }
        return resp;
      }

      logger.info(
        `Auth rejected (${resp.status}) - attempting re-authentication`,
        { request_id: requestId },
      );
      // Exponential backoff: if we re-authed recently (within the previous
      // window), the next floor doubles - capped at REAUTH_MAX_INTERVAL_MS.
      if (this._lastReauthAt !== null && elapsed < REAUTH_MAX_INTERVAL_MS * 2) {
        this._reauthBackoffMs = Math.min(
          this._reauthBackoffMs * 2,
          REAUTH_MAX_INTERVAL_MS,
        );
      } else {
        this._reauthBackoffMs = REAUTH_MIN_INTERVAL_MS;
      }
      this._lastReauthAt = now;

      await this._auth.markAuthFailed();
      await this._auth.refreshIfNeeded();
      return this._request(method, path, {
        ...opts,
        reauthAttempted: true,
      });
    }

    if (resp.status >= 400) {
      throw parseErrorResponse(resp.status, await resp.text());
    }

    return resp;
  }

  private async _doRequest(
    method: string,
    url: string,
    fetchOpts: UndiciRequestInit & { dispatcher: Agent },
    path: string,
  ): Promise<Response> {
    const upper = method.toUpperCase();

    // Safe methods: auto-retry
    if (upper === 'GET' || upper === 'HEAD') {
      return withRetry(() =>
        undiciFetch(url, {
          ...fetchOpts,
          signal: AbortSignal.timeout(this._timeout),
        }),
      );
    }

    // PUT/DELETE: retry only if on the verified allowlist
    if (
      (upper === 'PUT' || upper === 'DELETE') &&
      RETRYABLE_ENDPOINTS.has(`${upper}:${path}`)
    ) {
      return withRetry(() =>
        undiciFetch(url, {
          ...fetchOpts,
          signal: AbortSignal.timeout(this._timeout),
        }),
      );
    }

    // POST/PATCH and non-allowlisted: no retry
    return undiciFetch(url, fetchOpts);
  }

  private async _buildHeaders(
    method: string,
    allowCsrfNoCheck?: boolean,
  ): Promise<Record<string, string>> {
    await this._auth.refreshIfNeeded();
    const headers = await this._auth.getHeaders();

    // CSRF handling for mutating methods.
    // If no token is available we only fall back to the legacy
    // `nocheck` literal when the caller explicitly opted in.
    if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
      if (this._csrfToken) {
        headers['Csrf-Token'] = this._csrfToken;
      } else if (allowCsrfNoCheck) {
        headers['Csrf-Token'] = 'nocheck';
      }
      // Otherwise: omit the header and let the server decide.
    }

    return headers;
  }

  private async _requestJson<T>(
    method: string,
    path: string,
    opts?: {
      body?: string;
      timeoutMs?: number;
      allowCsrfNoCheck?: boolean;
    },
    reqOpts?: RequestOptions<T>,
  ): Promise<T> {
    const resp = await this._request(method, path, opts);
    const parsed = await readJsonBounded<T>(resp, path);
    if (reqOpts?.schema) {
      return this._validateOrThrow(
        reqOpts.schema,
        parsed,
        path,
        resp.status,
      ) as T;
    }
    return parsed as T;
  }

  private _validateOrThrow<T>(
    schema: ZodType<T>,
    value: unknown,
    path: string,
    statusCode: number,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new HorizonResponseValidationError({
        path,
        statusCode,
        issues,
      });
    }
    return result.data;
  }

  private async _isCsrfRejection(resp: Response): Promise<boolean> {
    try {
      const body = (await resp.json()) as Record<string, unknown>;
      const rawError = body['error'] ?? '';
      const errorStr =
        typeof rawError === 'string' ? rawError : String(rawError);
      const message = body['message'] ?? '';
      const messageStr =
        typeof message === 'string' ? message : String(message);
      return (
        errorStr.toLowerCase().includes('csrf') ||
        messageStr.toLowerCase().includes('csrf')
      );
    } catch (err) {
      logger.debug(`CSRF rejection check failed to parse body: ${err}`);
      return false;
    }
  }
}
