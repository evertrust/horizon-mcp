import type { Logger } from '../logging.js';
import type { AuthProvider } from './base.js';
import { ServiceAccountAuthProvider } from './service-account.js';

export async function mintInitialTokenAtStartup(
  auth: AuthProvider,
  logger: Logger,
): Promise<void> {
  if (
    !(auth instanceof ServiceAccountAuthProvider) ||
    !auth.needsInitialToken()
  ) {
    return;
  }

  try {
    await auth.refreshIfNeeded();
    if (auth.needsInitialToken()) {
      await auth.getHeaders();
    }
    const info = auth.getInitialTokenMintInfo();
    if (!info) {
      throw new Error('initial token mint completed without token metadata');
    }
    logger.info(
      `minted the initial service-account token from ${info.tokenUrl} ` +
        `(expires in ${info.expiresInSeconds} s)`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown renewal error';
    logger.error(`failed to mint the initial service-account token: ${reason}`);
  }
}
