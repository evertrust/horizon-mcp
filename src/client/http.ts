import { randomUUID } from 'node:crypto';
import {
  Agent,
  FormData as UndiciFormData,
  fetch as undiciFetch,
} from 'undici';
import type { RequestInit as UndiciRequestInit } from 'undici';

import type { AuthProvider } from '../auth/base.js';
import { getLogger } from '../logging.js';
import { HorizonError, parseErrorResponse } from './errors.js';
import { withRetry } from './retry.js';

const logger = getLogger('horizon_mcp.client');

// PUT/DELETE endpoints verified as idempotent - initially empty
const RETRYABLE_ENDPOINTS = new Set<string>();

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
  private _csrfToken: string | undefined;
  private _initialized = false;
  private _initPromise: Promise<void> | null = null;

  // Captured during lazy init
  principalName: string | undefined;
  horizonVersion: string | undefined;

  constructor(
    baseUrl: string,
    auth: AuthProvider,
    options: { timeout: number; exportTimeout: number; verifySsl: boolean },
  ) {
    this._baseUrl = baseUrl.replace(/\/+$/, '');
    this._auth = auth;
    this._timeout = options.timeout * 1000;
    this.exportTimeout = options.exportTimeout * 1000;

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

  async get<T = unknown>(path: string, params?: URLSearchParams): Promise<T> {
    const url = params ? `${path}?${params.toString()}` : path;
    return this._requestJson<T>('GET', url);
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    opts?: { timeout?: number },
  ): Promise<T> {
    return this._requestJson<T>('POST', path, {
      body: body !== undefined ? JSON.stringify(body) : undefined,
      timeoutMs: opts?.timeout ? opts.timeout * 1000 : undefined,
    });
  }

  async put<T = unknown>(path: string, body: unknown): Promise<T> {
    return this._requestJson<T>('PUT', path, {
      body: JSON.stringify(body),
    });
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this._requestJson<T>('PATCH', path, {
      body: JSON.stringify(body),
    });
  }

  async delete(path: string): Promise<unknown | null> {
    const resp = await this._request('DELETE', path);
    if (resp.status === 204) return null;
    return resp.json();
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
    opts?: { timeout?: number },
  ): Promise<string> {
    const resp = await this._request('POST', path, {
      body: body !== undefined ? JSON.stringify(body) : undefined,
      timeoutMs: opts?.timeout ? opts.timeout * 1000 : undefined,
    });
    return resp.text();
  }

  async postMultipart<T = unknown>(
    path: string,
    parts: MultipartPart[],
  ): Promise<T> {
    const formData = new UndiciFormData();
    for (const part of parts) {
      const blob = new Blob([part.data], { type: part.mimeType });
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
    } catch {
      logger.debug('CSRF JSON endpoint unavailable - checking cookies');
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

    // These are read from settings in the Python version but hardcoded for now
    const testedVersions = ['2.8'];
    const warnVersions = ['2.7', '2.9'];

    if (testedVersions.includes(majorMinor)) {
      logger.info(`Horizon version ${version} (tested - full compatibility)`);
    } else if (warnVersions.includes(majorMinor)) {
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
    },
  ): Promise<Response> {
    const requestId = randomUUID().slice(0, 12);
    const start = performance.now();
    const timeoutMs = opts?.timeoutMs ?? this._timeout;

    await this._ensureInitialized();
    const headers = await this._buildHeaders(method);
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
      if (err instanceof TypeError && String(err).includes('fetch')) {
        throw new HorizonError(0, {
          message: `Connection to ${this._baseUrl} failed: ${err}`,
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

    // CSRF 403 -> single retry after token refresh
    if (resp.status === 403 && (await this._isCsrfRejection(resp.clone()))) {
      logger.info('CSRF rejected - refreshing token and retrying', {
        request_id: requestId,
      });
      await this.fetchCsrfToken();
      headers['Csrf-Token'] = this._csrfToken ?? 'nocheck';
      fetchOpts.headers = headers;
      fetchOpts.signal = AbortSignal.timeout(timeoutMs);
      resp = await undiciFetch(fullUrl, fetchOpts);
      if (resp.status >= 400) {
        throw parseErrorResponse(resp.status, await resp.text());
      }
      return resp;
    }

    // Auth failure retry: 401 or 403 -> re-authenticate once
    if (
      (resp.status === 401 || resp.status === 403) &&
      !opts?.reauthAttempted
    ) {
      logger.info(
        `Auth rejected (${resp.status}) - attempting re-authentication`,
        { request_id: requestId },
      );
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

  private async _buildHeaders(method: string): Promise<Record<string, string>> {
    await this._auth.refreshIfNeeded();
    const headers = await this._auth.getHeaders();

    // CSRF handling for mutating methods
    if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
      headers['Csrf-Token'] = this._csrfToken ?? 'nocheck';
    }

    return headers;
  }

  private async _requestJson<T>(
    method: string,
    path: string,
    opts?: { body?: string; timeoutMs?: number },
  ): Promise<T> {
    const resp = await this._request(method, path, opts);
    const text = await resp.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
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
    } catch {
      return false;
    }
  }
}
