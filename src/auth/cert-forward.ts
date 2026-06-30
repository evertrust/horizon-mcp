import { AuthProvider } from './base.js';

/**
 * Per-caller mTLS "terminate-and-forward" auth.
 *
 * The MCP terminated the caller's TLS (or a trusted ingress did) and captured
 * the client certificate. This provider relays that certificate to Horizon's
 * Play backend in the configured header, exactly as Horizon's own nginx
 * ingress does for its native mTLS path. The MCP proves possession at TLS
 * termination; Horizon validates the chain, revocation, and identity.
 *
 * The value is a URL-encoded PEM, mirroring nginx's `$ssl_client_escaped_cert`
 * - one of the encodings Horizon's `WithX509Authentication.getCertificate`
 * accepts. No client certificate is presented on the MCP->Horizon hop itself
 * (the cert travels as a header), so `getDispatcherOptions` stays undefined.
 */
export class CertForwardAuthProvider extends AuthProvider {
  private readonly _headerName: string;
  private readonly _encodedCert: string;

  constructor(forwardHeader: string, certPem: string) {
    super();
    if (!certPem.includes('BEGIN CERTIFICATE')) {
      throw new Error(
        'CertForwardAuthProvider requires a PEM certificate (got a value ' +
          'without a BEGIN CERTIFICATE marker).',
      );
    }
    this._headerName = forwardHeader;
    this._encodedCert = encodeURIComponent(certPem);
  }

  async getHeaders(): Promise<Record<string, string>> {
    return { [this._headerName]: this._encodedCert };
  }

  async refreshIfNeeded(): Promise<void> {
    // The certificate is captured once at session initialize - nothing to
    // refresh for the session's lifetime.
  }
}
