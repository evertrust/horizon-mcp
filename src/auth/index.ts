import { getLogger } from '../logging.js';
import { type HorizonSettings, assertStdioAuthSettings } from '../settings.js';
import { ApiKeyAuthProvider } from './apikey.js';
import { AuthProvider } from './base.js';
import { MtlsAuthProvider } from './mtls.js';
import { ServiceAccountAuthProvider } from './service-account.js';

const logger = getLogger('horizon_mcp.auth');

function createServiceAccountProvider(
  settings: HorizonSettings,
): ServiceAccountAuthProvider {
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

  assertStdioAuthSettings(settings);

  if (settings.clientCert || settings.clientPfx) {
    logger.info('Auth mode: mTLS (client certificate)');
    return new MtlsAuthProvider({
      certPath: settings.clientCert,
      keyPath: settings.clientKey,
      keyPassword: settings.clientKeyPassword,
      pfxPath: settings.clientPfx,
      pfxPassword: settings.clientPfxPassword,
    });
  }

  if (settings.serviceAccount) return createServiceAccountProvider(settings);

  logger.info('Auth mode: API Key');
  return new ApiKeyAuthProvider(settings.apiId, settings.apiKey);
}

export { AuthProvider } from './base.js';
export { ApiKeyAuthProvider } from './apikey.js';
export { MtlsAuthProvider } from './mtls.js';
export { ServiceAccountAuthProvider } from './service-account.js';
