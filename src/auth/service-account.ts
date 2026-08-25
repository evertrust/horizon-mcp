import type { OAuthIssuerMap } from '../settings.js';
import { AuthProvider } from './base.js';

export interface ServiceAccountOAuthOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scope?: string;
  readonly audience?: string;
  readonly issuers?: OAuthIssuerMap;
  readonly refreshSkewSeconds?: number;
  readonly requestTimeoutMs?: number;
  readonly fetcher?: typeof fetch;
}

interface JwtClaims {
  readonly iss: string;
  readonly exp: number;
}

interface DiscoveryDocument {
  readonly issuer?: unknown;
  readonly token_endpoint?: unknown;
  readonly token_endpoint_auth_methods_supported?: unknown;
}

const MAX_OAUTH_RESPONSE_BYTES = 1024 * 1024;
const RENEWAL_FAILURE_COOLDOWN_MS = 30_000;

function decodeClaims(jwt: string): JwtClaims {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new Error('service-account token is not a JWT');
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('service-account JWT payload is not valid JSON');
  }
  if (!value || typeof value !== 'object') {
    throw new Error('service-account JWT payload must be an object');
  }
  const claims = value as Record<string, unknown>;
  if (typeof claims['iss'] !== 'string' || !claims['iss']) {
    throw new Error('service-account JWT is missing the iss claim');
  }
  if (typeof claims['exp'] !== 'number' || !Number.isFinite(claims['exp'])) {
    throw new Error('service-account JWT is missing a numeric exp claim');
  }
  return { iss: claims['iss'], exp: claims['exp'] };
}

function secureUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${label} must not contain credentials or a fragment`);
  }
  return url;
}

async function readJsonBounded(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_OAUTH_RESPONSE_BYTES) {
    throw new Error('OAuth response exceeds the maximum supported size');
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_OAUTH_RESPONSE_BYTES) {
    throw new Error('OAuth response exceeds the maximum supported size');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('OAuth endpoint returned invalid JSON');
  }
}

/** Forward a caller-supplied Horizon JWKS service-account identity. */
export class ServiceAccountAuthProvider extends AuthProvider {
  private readonly _serviceAccount: string;
  private readonly _oauth: ServiceAccountOAuthOptions | undefined;
  private readonly _fetcher: typeof fetch;
  private readonly _refreshSkewSeconds: number;
  private readonly _requestTimeoutMs: number;
  private _jwt: string;
  private _validated = false;
  private _forceRefresh = false;
  private _discovery: {
    issuer: string;
    tokenEndpoint: string;
    authMethod: 'client_secret_basic' | 'client_secret_post';
    exactIssuerMatch: boolean;
  } | null = null;
  private _refreshPromise: Promise<void> | null = null;
  private _renewalRetryAfter = 0;

  constructor(
    serviceAccount: string,
    jwt: string,
    oauth?: ServiceAccountOAuthOptions,
  ) {
    super();
    if (!serviceAccount || !jwt) {
      throw new Error(
        'service-account authentication requires X-API-SVA and X-API-TOKEN',
      );
    }
    this._serviceAccount = serviceAccount;
    this._jwt = jwt;
    this._oauth = oauth;
    this._fetcher = oauth?.fetcher ?? fetch;
    this._refreshSkewSeconds = oauth?.refreshSkewSeconds ?? 60;
    this._requestTimeoutMs = oauth?.requestTimeoutMs ?? 15_000;
    if (oauth && (!oauth.clientId || !oauth.clientSecret)) {
      throw new Error('OAuth renewal requires a client ID and client secret');
    }
  }

  async getHeaders(): Promise<Record<string, string>> {
    return {
      'X-API-SVA': this._serviceAccount,
      'X-API-TOKEN': this._jwt,
    };
  }

  async refreshIfNeeded(): Promise<void> {
    if (!this._oauth) return;
    const pinned = this._oauth.issuers !== undefined;
    // Unpinned discovery remains gated on Horizon validation. Pinned mode may
    // read claims early because the network target comes only from operator
    // configuration and _discover requires an exact own-property issuer match.
    if ((!this._validated && !pinned) || Date.now() < this._renewalRetryAfter) {
      return;
    }

    const { exp } = decodeClaims(this._jwt);
    const nearExpiry = exp - Date.now() / 1000 <= this._refreshSkewSeconds;
    if (!nearExpiry && !this._forceRefresh) return;

    if (!this._refreshPromise) {
      this._refreshPromise = this._renew()
        .then(() => {
          this._renewalRetryAfter = 0;
        })
        .catch((err: unknown) => {
          this._renewalRetryAfter = Date.now() + RENEWAL_FAILURE_COOLDOWN_MS;
          throw err;
        })
        .finally(() => {
          this._refreshPromise = null;
        });
    }
    await this._refreshPromise;
  }

  override markValidated(): void {
    this._validated = true;
  }

  override async markAuthFailed(): Promise<void> {
    if (this._oauth && (this._validated || this._oauth.issuers !== undefined)) {
      this._forceRefresh = true;
    }
  }

  private async _discover(): Promise<NonNullable<typeof this._discovery>> {
    if (this._discovery) return this._discovery;

    const claims = decodeClaims(this._jwt);
    const configuredIssuers = this._oauth?.issuers;
    if (configuredIssuers) {
      const configured = Object.hasOwn(configuredIssuers, claims.iss)
        ? configuredIssuers[claims.iss]
        : undefined;
      if (!configured) {
        const names = Object.keys(configuredIssuers).sort().join(', ');
        throw new Error(
          `OAuth renewal refused: JWT issuer "${claims.iss}" is not listed in ` +
            `HORIZON_OAUTH_ISSUERS. Configured issuers: ${names || '(none)'}`,
        );
      }
      this._discovery = {
        issuer: claims.iss,
        tokenEndpoint: configured.tokenUrl,
        authMethod: configured.authMethod,
        exactIssuerMatch: true,
      };
      return this._discovery;
    }

    const issuer = secureUrl(claims.iss, 'JWT issuer');
    const issuerValue = issuer.toString().replace(/\/$/, '');
    const discoveryUrl = `${issuerValue}/.well-known/openid-configuration`;
    const response = await this._fetcher(discoveryUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(this._requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`OIDC discovery failed with HTTP ${response.status}`);
    }
    const raw = (await readJsonBounded(response)) as DiscoveryDocument;
    if (raw.issuer !== issuerValue) {
      throw new Error('OIDC discovery issuer does not match the JWT issuer');
    }
    if (typeof raw.token_endpoint !== 'string') {
      throw new Error('OIDC discovery is missing token_endpoint');
    }
    const endpoint = secureUrl(raw.token_endpoint, 'OAuth token endpoint');
    if (endpoint.origin !== issuer.origin) {
      throw new Error('OAuth token endpoint origin differs from JWT issuer');
    }

    const advertised = Array.isArray(raw.token_endpoint_auth_methods_supported)
      ? raw.token_endpoint_auth_methods_supported.filter(
          (value): value is string => typeof value === 'string',
        )
      : ['client_secret_basic'];
    const authMethod = advertised.includes('client_secret_basic')
      ? 'client_secret_basic'
      : advertised.includes('client_secret_post')
        ? 'client_secret_post'
        : undefined;
    if (!authMethod) {
      throw new Error(
        'OAuth provider does not support client_secret_basic or client_secret_post',
      );
    }

    this._discovery = {
      issuer: issuerValue,
      tokenEndpoint: endpoint.toString(),
      authMethod,
      exactIssuerMatch: false,
    };
    return this._discovery;
  }

  private async _renew(): Promise<void> {
    const oauth = this._oauth;
    if (!oauth) return;
    const discovery = await this._discover();
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (oauth.scope) body.set('scope', oauth.scope);
    if (oauth.audience) body.set('audience', oauth.audience);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (discovery.authMethod === 'client_secret_basic') {
      headers['Authorization'] =
        `Basic ${Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString('base64')}`;
    } else {
      body.set('client_id', oauth.clientId);
      body.set('client_secret', oauth.clientSecret);
    }

    const response = await this._fetcher(discovery.tokenEndpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(this._requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `OAuth token request failed with HTTP ${response.status}`,
      );
    }
    const raw = await readJsonBounded(response);
    const accessToken =
      raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)['access_token']
        : undefined;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new Error('OAuth token response is missing access_token');
    }
    const renewed = decodeClaims(accessToken);
    const renewedIssuer = discovery.exactIssuerMatch
      ? renewed.iss
      : renewed.iss.replace(/\/$/, '');
    if (renewedIssuer !== discovery.issuer) {
      throw new Error('renewed JWT issuer differs from the original issuer');
    }
    this._jwt = accessToken;
    this._forceRefresh = false;
  }
}
