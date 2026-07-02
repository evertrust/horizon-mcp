import { getLogger } from '../logging.js';
import type { HorizonSettings } from '../settings.js';
import { ApiKeyAuthProvider } from './apikey.js';
import { AuthProvider } from './base.js';
import { MtlsAuthProvider } from './mtls.js';

const logger = getLogger('horizon_mcp.auth');

/**
 * Factory: auto-detect auth mode from which env vars are set.
 * Priority: mTLS (client cert) > API Key.
 *
 * OIDC browser (Playwright) login was removed in all transports. Configure
 * an API key or an mTLS client certificate instead.
 */
export function createAuthProvider(settings: HorizonSettings): AuthProvider {
  if (settings.authMode) {
    logger.warning(
      'HORIZON_AUTH_MODE is deprecated and ignored. ' +
        'Auth mode is now auto-detected from credentials.',
    );
  }

  // Priority 1: mTLS (client certificate)
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

  // Priority 2: API Key
  if (settings.apiId) {
    logger.info('Auth mode: API Key');
    return new ApiKeyAuthProvider(settings.apiId, settings.apiKey);
  }

  // No credentials: fail closed. OIDC browser login has been removed.
  throw new Error(
    'No Horizon credentials configured. Set HORIZON_API_ID and ' +
      'HORIZON_API_KEY for API key auth, or HORIZON_CLIENT_CERT and ' +
      'HORIZON_CLIENT_KEY (or HORIZON_CLIENT_PFX) for mTLS. OIDC browser ' +
      'login is no longer supported.',
  );
}

export { AuthProvider } from './base.js';
export { ApiKeyAuthProvider } from './apikey.js';
export { MtlsAuthProvider } from './mtls.js';
