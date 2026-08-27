import type { HorizonSettings } from './settings.js';

export interface RuntimeInfo {
  readonly isBun: boolean;
}

export function detectRuntime(): RuntimeInfo {
  return { isBun: typeof process.versions.bun === 'string' };
}

export function assertRuntimeSupportsTls(
  settings: HorizonSettings,
  runtime: RuntimeInfo = detectRuntime(),
): void {
  if (!runtime.isBun) return;

  if (settings.clientCert || settings.clientKey) {
    throw new Error(
      "HORIZON_CLIENT_CERT (mTLS to Horizon) is not supported under Bun: Bun's built-in fetch ignores the undici Agent that carries the client certificate. Run the server with Node (node dist/index.js).",
    );
  }
  if (settings.clientPfx) {
    throw new Error(
      "HORIZON_CLIENT_PFX (mTLS to Horizon) is not supported under Bun: Bun's built-in fetch ignores the undici Agent that carries the client certificate. Run the server with Node (node dist/index.js).",
    );
  }
  if (!settings.verifySsl) {
    throw new Error(
      "HORIZON_VERIFY_SSL=false is not supported under Bun: Bun's built-in fetch ignores the undici Agent that disables verification. Run the server with Node (node dist/index.js).",
    );
  }
}
