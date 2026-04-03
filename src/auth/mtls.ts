import { readFileSync } from 'node:fs';
import type { Agent } from 'undici';

import { getLogger } from '../logging.js';
import { AuthProvider } from './base.js';

const logger = getLogger('horizon_mcp.auth.mtls');

/**
 * Authenticate via mutual TLS client certificate.
 *
 * Supports two input formats:
 * - PEM: separate certificate and private key files
 * - PKCS#12/PFX: bundle file passed directly to undici's connect options
 *
 * No auth headers are needed - the certificate IS the credential.
 */
export class MtlsAuthProvider extends AuthProvider {
  private readonly _connectOptions: Agent.Options['connect'];

  constructor(opts: {
    certPath?: string;
    keyPath?: string;
    keyPassword?: string;
    pfxPath?: string;
    pfxPassword?: string;
  }) {
    super();
    this._validate(opts);
    this._connectOptions = this._buildConnectOptions(opts);
  }

  async getHeaders(): Promise<Record<string, string>> {
    return {};
  }

  async refreshIfNeeded(): Promise<void> {
    // Client certs are static files
  }

  getDispatcherOptions(): Agent.Options['connect'] {
    return this._connectOptions;
  }

  private _validate(opts: {
    certPath?: string;
    keyPath?: string;
    pfxPath?: string;
  }): void {
    if (opts.certPath) {
      try {
        readFileSync(opts.certPath);
      } catch {
        throw new Error(`HORIZON_CLIENT_CERT file not found: ${opts.certPath}`);
      }
      if (!opts.keyPath) {
        throw new Error(
          'HORIZON_CLIENT_KEY is required when HORIZON_CLIENT_CERT is set.',
        );
      }
      try {
        readFileSync(opts.keyPath);
      } catch {
        throw new Error(`HORIZON_CLIENT_KEY file not found: ${opts.keyPath}`);
      }
    } else if (opts.pfxPath) {
      try {
        readFileSync(opts.pfxPath);
      } catch {
        throw new Error(`HORIZON_CLIENT_PFX file not found: ${opts.pfxPath}`);
      }
    }
  }

  private _buildConnectOptions(opts: {
    certPath?: string;
    keyPath?: string;
    keyPassword?: string;
    pfxPath?: string;
    pfxPassword?: string;
  }): Agent.Options['connect'] {
    if (opts.certPath && opts.keyPath) {
      logger.info(`mTLS: loaded PEM cert=${opts.certPath} key=${opts.keyPath}`);
      const connect: Agent.Options['connect'] = {
        cert: readFileSync(opts.certPath, 'utf-8'),
        key: opts.keyPassword
          ? readFileSync(opts.keyPath, 'utf-8')
          : readFileSync(opts.keyPath, 'utf-8'),
        passphrase: opts.keyPassword || undefined,
      };
      return connect;
    }

    // PFX path
    logger.info(`mTLS: loaded PFX bundle=${opts.pfxPath}`);
    return {
      pfx: readFileSync(opts.pfxPath!),
      passphrase: opts.pfxPassword || undefined,
    };
  }
}
