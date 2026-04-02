import { describe, it, expect } from "vitest";
import { ApiKeyAuthProvider } from "../../src/auth/apikey.js";
import { createAuthProvider } from "../../src/auth/index.js";
import type { HorizonSettings } from "../../src/settings.js";
import { MtlsAuthProvider } from "../../src/auth/mtls.js";
import { PlaySessionAuthProvider } from "../../src/auth/play-session.js";

/**
 * Build a minimal HorizonSettings object with sensible defaults.
 * Override only the fields relevant to each test case.
 */
function makeSettings(
  overrides: Partial<HorizonSettings> = {},
): HorizonSettings {
  return {
    url: "https://horizon.example.com",
    apiId: "",
    apiKey: "",
    authMode: "",
    clientCert: "",
    clientKey: "",
    clientKeyPassword: "",
    clientPfx: "",
    clientPfxPassword: "",
    verifySsl: true,
    loginTimeout: 300,
    timeout: 30,
    exportTimeout: 120,
    logLevel: "INFO",
    testedVersions: ["2.8"],
    warnVersions: ["2.7", "2.9"],
    ...overrides,
  };
}

describe("ApiKeyAuthProvider", () => {
  describe("constructor validation", () => {
    it("throws when apiId is empty", () => {
      expect(() => new ApiKeyAuthProvider("", "my-key")).toThrow(
        "HORIZON_API_ID and HORIZON_API_KEY must both be set",
      );
    });

    it("throws when apiKey is empty", () => {
      expect(() => new ApiKeyAuthProvider("my-id", "")).toThrow(
        "HORIZON_API_ID and HORIZON_API_KEY must both be set",
      );
    });

    it("throws when both fields are empty", () => {
      expect(() => new ApiKeyAuthProvider("", "")).toThrow(
        "HORIZON_API_ID and HORIZON_API_KEY must both be set",
      );
    });

    it("succeeds when both fields are provided", () => {
      const provider = new ApiKeyAuthProvider("my-id", "my-key");
      expect(provider).toBeInstanceOf(ApiKeyAuthProvider);
    });
  });

  describe("getHeaders", () => {
    it("returns X-API-ID and X-API-KEY headers", async () => {
      const provider = new ApiKeyAuthProvider("test-id", "test-key");
      const headers = await provider.getHeaders();

      expect(headers).toEqual({
        "X-API-ID": "test-id",
        "X-API-KEY": "test-key",
      });
    });

    it("preserves exact values without trimming or transformation", async () => {
      const provider = new ApiKeyAuthProvider(
        " spaced-id ",
        "key-with-special!@#$",
      );
      const headers = await provider.getHeaders();

      expect(headers["X-API-ID"]).toBe(" spaced-id ");
      expect(headers["X-API-KEY"]).toBe("key-with-special!@#$");
    });
  });

  describe("refreshIfNeeded", () => {
    it("is a no-op that resolves without error", async () => {
      const provider = new ApiKeyAuthProvider("id", "key");
      await expect(provider.refreshIfNeeded()).resolves.toBeUndefined();
    });
  });
});

describe("createAuthProvider (factory)", () => {
  describe("mTLS detection", () => {
    it("detects mTLS when clientCert is present (with clientKey)", () => {
      const settings = makeSettings({
        clientCert: "/path/to/cert.pem",
        clientKey: "/path/to/key.pem",
      });

      // MtlsAuthProvider constructor will throw because files don't exist,
      // but the factory correctly selected the mTLS path.
      expect(() => createAuthProvider(settings)).toThrow(
        "HORIZON_CLIENT_CERT file not found",
      );
    });

    it("detects mTLS when clientPfx is present", () => {
      const settings = makeSettings({
        clientPfx: "/path/to/bundle.pfx",
      });

      expect(() => createAuthProvider(settings)).toThrow(
        "HORIZON_CLIENT_PFX file not found",
      );
    });
  });

  describe("API key detection", () => {
    it("selects ApiKeyAuthProvider when apiId is set", () => {
      const settings = makeSettings({
        apiId: "my-api-id",
        apiKey: "my-api-key",
      });

      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(ApiKeyAuthProvider);
    });
  });

  describe("Play Session fallback", () => {
    it("falls back to PlaySessionAuthProvider when no certs or API key", () => {
      const settings = makeSettings();
      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(PlaySessionAuthProvider);
    });
  });

  describe("factory validation", () => {
    it("throws when both clientCert and clientPfx are set", () => {
      const settings = makeSettings({
        clientCert: "/path/to/cert.pem",
        clientKey: "/path/to/key.pem",
        clientPfx: "/path/to/bundle.pfx",
      });

      expect(() => createAuthProvider(settings)).toThrow(
        "Set HORIZON_CLIENT_CERT or HORIZON_CLIENT_PFX, not both",
      );
    });

    it("throws when clientCert is set without clientKey", () => {
      const settings = makeSettings({
        clientCert: "/path/to/cert.pem",
        clientKey: "",
      });

      expect(() => createAuthProvider(settings)).toThrow(
        "HORIZON_CLIENT_KEY is required when HORIZON_CLIENT_CERT is set",
      );
    });
  });

  describe("priority ordering", () => {
    it("prefers mTLS over API key when both are configured", () => {
      const settings = makeSettings({
        clientPfx: "/path/to/bundle.pfx",
        apiId: "my-id",
        apiKey: "my-key",
      });

      // Should attempt mTLS (and fail on file read), not API key
      expect(() => createAuthProvider(settings)).toThrow(
        "HORIZON_CLIENT_PFX file not found",
      );
    });

    it("prefers API key over Play Session when apiId is set", () => {
      const settings = makeSettings({
        apiId: "my-id",
        apiKey: "my-key",
      });

      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(ApiKeyAuthProvider);
    });
  });
});
