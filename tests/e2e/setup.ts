/**
 * Shared E2E test fixture - creates and exports a configured HorizonClient
 * connected to the live QA instance.
 *
 * Environment variables required:
 *   HORIZON_E2E_URL      - Base URL of the Horizon QA instance
 *   HORIZON_E2E_API_ID   - API key identifier
 *   HORIZON_E2E_API_KEY  - API key secret
 */

import { afterAll, beforeAll } from "vitest";
import { HorizonClient } from "../../src/client/http.js";
import { ApiKeyAuthProvider } from "../../src/auth/apikey.js";

// ---------------------------------------------------------------------------
// Environment gating
// ---------------------------------------------------------------------------

export const E2E_URL = process.env["HORIZON_E2E_URL"] ?? "";
export const E2E_API_ID = process.env["HORIZON_E2E_API_ID"] ?? "";
export const E2E_API_KEY = process.env["HORIZON_E2E_API_KEY"] ?? "";

export const E2E_CONFIGURED = Boolean(E2E_URL && E2E_API_ID && E2E_API_KEY);

// ---------------------------------------------------------------------------
// Shared client - lazily created, shared across the test suite
// ---------------------------------------------------------------------------

let sharedClient: HorizonClient | undefined;

export function getE2EClient(): HorizonClient {
  if (!sharedClient) {
    throw new Error(
      "E2E client not initialized - call setupE2EClient() in a beforeAll block",
    );
  }
  return sharedClient;
}

/**
 * Create the shared HorizonClient in a beforeAll/afterAll lifecycle.
 * Call this inside the top-level `describe` block that gates on E2E_CONFIGURED.
 */
export function setupE2EClient(): void {
  beforeAll(() => {
    const auth = new ApiKeyAuthProvider(E2E_API_ID, E2E_API_KEY);
    sharedClient = new HorizonClient(E2E_URL, auth, {
      timeout: 30,
      exportTimeout: 120,
      verifySsl: false,
    });
  });

  afterAll(async () => {
    if (sharedClient) {
      await sharedClient.close();
      sharedClient = undefined;
    }
  });
}
