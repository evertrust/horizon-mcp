import { getLogger } from '../logging.js';
import type { HorizonSettings } from '../settings.js';
import { ApiKeyAuthProvider } from './apikey.js';
import { AuthProvider } from './base.js';
import { MtlsAuthProvider } from './mtls.js';
import { ServiceAccountAuthProvider } from './service-account.js';

const logger = getLogger('horizon_mcp.auth');

function assertOneCompleteMethod(settings: HorizonSettings): void {
  const pairs = [
    [settings.apiId, settings.apiKey, 'HORIZON_API_ID', 'HORIZON_API_KEY'],
    [
      settings.serviceAccount,
      settings.apiToken,
      'HORIZON_SERVICE_ACCOUNT',
      'HORIZON_API_TOKEN',
    ],
    [
      settings.clientCert,
      settings.clientKey,
      'HORIZON_CLIENT_CERT',
      'HORIZON_CLIENT_KEY',
    ],
    [
      settings.oauthClientId,
      settings.oauthClientSecret,
      'HORIZON_OAUTH_CLIENT_ID',
      'HORIZON_OAUTH_CLIENT_SECRET',
    ],
  ] as const;
  for (const [value, partner, valueName, partnerName] of pairs) {
    if (Boolean(value) !== Boolean(partner)) {
      throw new Error(`${value ? partnerName : valueName} is required.`);
    }
  }
  if (settings.clientCert && settings.clientPfx) {
    throw new Error('Set HORIZON_CLIENT_CERT or HORIZON_CLIENT_PFX, not both.');
  }

  const hasService = Boolean(settings.serviceAccount && settings.apiToken);
  const hasOauthClient = Boolean(
    settings.oauthClientId && settings.oauthClientSecret,
  );
  const hasOauthMetadata = Boolean(
    settings.oauthClientId ||
    settings.oauthClientSecret ||
    settings.oauthScope ||
    settings.oauthAudience,
  );
  if (hasOauthMetadata && !hasService) {
    throw new Error(
      'OAuth renewal settings require HORIZON_SERVICE_ACCOUNT and HORIZON_API_TOKEN.',
    );
  }
  if ((settings.oauthScope || settings.oauthAudience) && !hasOauthClient) {
    throw new Error(
      'HORIZON_OAUTH_SCOPE and HORIZON_OAUTH_AUDIENCE require ' +
        'HORIZON_OAUTH_CLIENT_ID and HORIZON_OAUTH_CLIENT_SECRET.',
    );
  }

  const completeMethods = [
    Boolean(settings.apiId && settings.apiKey),
    hasService,
    Boolean((settings.clientCert && settings.clientKey) || settings.clientPfx),
  ].filter(Boolean).length;
  if (completeMethods !== 1) {
    throw new Error(
      'Exactly one complete stdio authentication method must be configured: ' +
        'HORIZON_API_ID with HORIZON_API_KEY, HORIZON_SERVICE_ACCOUNT with ' +
        'HORIZON_API_TOKEN, or mTLS using HORIZON_CLIENT_CERT with ' +
        'HORIZON_CLIENT_KEY or HORIZON_CLIENT_PFX.',
    );
  }
}

/**
 * Factory: auto-detect auth mode from which env vars are set.
 * OIDC browser (Playwright) login was removed in all transports. Configure
 * exactly one supported credential method instead.
 */
export function createAuthProvider(settings: HorizonSettings): AuthProvider {
  if (settings.authMode) {
    logger.warning(
      'HORIZON_AUTH_MODE is deprecated and ignored. ' +
        'Auth mode is now auto-detected from credentials.',
    );
  }

  assertOneCompleteMethod(settings);

  if (settings.clientCert || settings.clientPfx) {
    if (settings.clientCert && settings.clientPfx) {
      throw new Error(
        'Set HORIZON_CLIENT_CERT or HORIZON_CLIENT_PFX, not both.',
      );
    }
    if (settings.clientCert && !settings.clientKey) {
      throw new Error(
        'HORIZON_CLIENT_KEY is required when HORIZON_CLIENT_CERT is set.',
      );
    }
    logger.info('Auth mode: mTLS (client certificate)');
    return new MtlsAuthProvider({
      certPath: settings.clientCert,
      keyPath: settings.clientKey,
      keyPassword: settings.clientKeyPassword,
      pfxPath: settings.clientPfx,
      pfxPassword: settings.clientPfxPassword,
    });
  }

  if (settings.serviceAccount) {
    logger.info('Auth mode: Service account');
    return new ServiceAccountAuthProvider(
      settings.serviceAccount,
      settings.apiToken,
      settings.oauthClientId && settings.oauthClientSecret
        ? {
            clientId: settings.oauthClientId,
            clientSecret: settings.oauthClientSecret,
            ...(settings.oauthScope ? { scope: settings.oauthScope } : {}),
            ...(settings.oauthAudience
              ? { audience: settings.oauthAudience }
              : {}),
            ...(settings.oauthIssuers !== undefined
              ? { issuers: settings.oauthIssuers }
              : {}),
          }
        : undefined,
    );
  }

  if (settings.apiId) {
    logger.info('Auth mode: API Key');
    return new ApiKeyAuthProvider(settings.apiId, settings.apiKey);
  }

  // No credentials: fail closed. OIDC browser login has been removed.
  throw new Error(
    'No Horizon credentials configured. Set HORIZON_API_ID and ' +
      'HORIZON_API_KEY for API key auth, HORIZON_SERVICE_ACCOUNT and ' +
      'HORIZON_API_TOKEN for service-account auth, or HORIZON_CLIENT_CERT and ' +
      'HORIZON_CLIENT_KEY (or HORIZON_CLIENT_PFX) for mTLS. OIDC browser ' +
      'login is no longer supported.',
  );
}

export { AuthProvider } from './base.js';
export { ApiKeyAuthProvider } from './apikey.js';
export { MtlsAuthProvider } from './mtls.js';
export { ServiceAccountAuthProvider } from './service-account.js';
