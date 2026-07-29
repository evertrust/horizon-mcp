import type { Agent } from 'undici';

/**
 * Abstract base class for Horizon authentication providers.
 * Provides sensible defaults to reduce boilerplate in concrete providers.
 */
export abstract class AuthProvider {
  /** Return authentication headers for an API request. */
  abstract getHeaders(): Promise<Record<string, string>>;

  /** Refresh credentials if expired. No-op for static auth. */
  abstract refreshIfNeeded(): Promise<void>;

  /** Signal that authentication was rejected by the server. */
  async markAuthFailed(): Promise<void> {
    // No-op default - override in providers supporting re-auth (Play Session)
  }

  /** Signal that the initial credential was accepted by Horizon. */
  markValidated(): void {
    // No-op default; dynamic providers may use this as a network trust gate.
  }

  /** Release resources (e.g., temp files). Called during server shutdown. */
  async cleanup(): Promise<void> {
    // No-op default
  }

  /** Return a pre-captured CSRF token, or undefined. */
  get csrfToken(): string | undefined {
    return undefined;
  }

  /** Return TLS connect options for undici.Agent, or undefined. */
  getDispatcherOptions(): Agent.Options['connect'] | undefined {
    return undefined;
  }
}
