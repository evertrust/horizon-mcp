import { AuthProvider } from './base.js';

/**
 * Authenticate via static API ID and API Key headers.
 * Injects X-API-ID and X-API-KEY custom Horizon headers.
 */
export class ApiKeyAuthProvider extends AuthProvider {
  private readonly _apiId: string;
  private readonly _apiKey: string;

  constructor(apiId: string, apiKey: string) {
    super();
    if (!apiId || !apiKey) {
      throw new Error(
        'HORIZON_API_ID and HORIZON_API_KEY must both be set. ' +
          'See .env.example for configuration.',
      );
    }
    this._apiId = apiId;
    this._apiKey = apiKey;
  }

  async getHeaders(): Promise<Record<string, string>> {
    return { 'X-API-ID': this._apiId, 'X-API-KEY': this._apiKey };
  }

  async refreshIfNeeded(): Promise<void> {
    // Static credentials - nothing to refresh
  }
}
