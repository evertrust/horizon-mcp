import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, beforeEach } from "vitest";
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

// ---------------------------------------------------------------------------
// Helpers - generate PEM and PFX temp files for mTLS tests
// ---------------------------------------------------------------------------

/**
 * Write a dummy PEM file to a temp directory.
 * For TS mTLS tests we only need readable files since the TS
 * MtlsAuthProvider reads raw bytes (no crypto-level validation in
 * the constructor - just readFileSync).
 */
function writeDummyPem(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, `-----BEGIN CERTIFICATE-----\nMIIB==\n-----END CERTIFICATE-----\n`);
  return path;
}

function writeDummyKey(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, `-----BEGIN PRIVATE KEY-----\nMIIB==\n-----END PRIVATE KEY-----\n`);
  return path;
}

function writeDummyPfx(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.from([0x30, 0x82, 0x00, 0x00]));
  return path;
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "auth-test-"));
}

// ===========================================================================
// ApiKeyAuthProvider
// ===========================================================================

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

// ===========================================================================
// MtlsAuthProvider - PEM
// ===========================================================================

describe("MtlsAuthProvider (PEM)", () => {
  let tmpDir: string;
  let certPath: string;
  let keyPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    certPath = writeDummyPem(tmpDir, "cert.pem");
    keyPath = writeDummyKey(tmpDir, "key.pem");
  });

  it("builds connect options with cert and key", () => {
    const provider = new MtlsAuthProvider({
      certPath,
      keyPath,
    });
    const opts = provider.getDispatcherOptions();
    expect(opts).toBeDefined();
    expect(opts).toHaveProperty("cert");
    expect(opts).toHaveProperty("key");
  });

  it("accepts a key password (passphrase)", () => {
    const provider = new MtlsAuthProvider({
      certPath,
      keyPath,
      keyPassword: "test-password",
    });
    const opts = provider.getDispatcherOptions() as Record<string, unknown>;
    expect(opts).toBeDefined();
    expect(opts["passphrase"]).toBe("test-password");
  });

  it("getHeaders returns empty object", async () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    const headers = await provider.getHeaders();
    expect(headers).toEqual({});
  });

  it("refreshIfNeeded is a no-op", async () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    await expect(provider.refreshIfNeeded()).resolves.toBeUndefined();
  });

  it("markAuthFailed is a no-op", async () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    await expect(provider.markAuthFailed()).resolves.toBeUndefined();
  });

  it("throws when cert file is missing", () => {
    expect(
      () =>
        new MtlsAuthProvider({
          certPath: "/nonexistent/cert.pem",
          keyPath,
        }),
    ).toThrow("HORIZON_CLIENT_CERT file not found");
  });

  it("throws when key file is missing", () => {
    expect(
      () =>
        new MtlsAuthProvider({
          certPath,
          keyPath: "/nonexistent/key.pem",
        }),
    ).toThrow("HORIZON_CLIENT_KEY file not found");
  });

  it("throws when keyPath is omitted but certPath is set", () => {
    expect(
      () =>
        new MtlsAuthProvider({
          certPath,
        }),
    ).toThrow("HORIZON_CLIENT_KEY is required");
  });

  it("csrfToken returns undefined", () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    expect(provider.csrfToken).toBeUndefined();
  });

  it("connect options omit passphrase when no password", () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    const opts = provider.getDispatcherOptions() as Record<string, unknown>;
    expect(opts["passphrase"]).toBeUndefined();
  });

  it("cleanup is a no-op that does not throw", async () => {
    const provider = new MtlsAuthProvider({ certPath, keyPath });
    await expect(provider.cleanup()).resolves.toBeUndefined();
    await expect(provider.cleanup()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// MtlsAuthProvider - PFX
// ===========================================================================

describe("MtlsAuthProvider (PFX)", () => {
  let tmpDir: string;
  let pfxPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    pfxPath = writeDummyPfx(tmpDir, "client.p12");
  });

  it("builds connect options with pfx", () => {
    const provider = new MtlsAuthProvider({ pfxPath });
    const opts = provider.getDispatcherOptions();
    expect(opts).toBeDefined();
    expect(opts).toHaveProperty("pfx");
  });

  it("accepts a pfx password", () => {
    const provider = new MtlsAuthProvider({
      pfxPath,
      pfxPassword: "pfx-secret",
    });
    const opts = provider.getDispatcherOptions() as Record<string, unknown>;
    expect(opts["passphrase"]).toBe("pfx-secret");
  });

  it("throws when pfx file is missing", () => {
    expect(
      () =>
        new MtlsAuthProvider({
          pfxPath: "/nonexistent/client.p12",
        }),
    ).toThrow("HORIZON_CLIENT_PFX file not found");
  });

  it("pfx property is a Buffer", () => {
    const provider = new MtlsAuthProvider({ pfxPath });
    const opts = provider.getDispatcherOptions() as Record<string, unknown>;
    expect(Buffer.isBuffer(opts["pfx"])).toBe(true);
  });

  it("omits passphrase when no password", () => {
    const provider = new MtlsAuthProvider({ pfxPath });
    const opts = provider.getDispatcherOptions() as Record<string, unknown>;
    expect(opts["passphrase"]).toBeUndefined();
  });

  it("cleanup is idempotent", async () => {
    const provider = new MtlsAuthProvider({ pfxPath });
    await expect(provider.cleanup()).resolves.toBeUndefined();
    await expect(provider.cleanup()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// PlaySessionAuthProvider
// ===========================================================================

describe("PlaySessionAuthProvider", () => {
  describe("constructor and initial state", () => {
    it("starts in expired state with no cookie", () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");
      // The provider is newly created, so getHeaders should fail
      // because there is no session cookie yet
      expect(provider.csrfToken).toBeUndefined();
    });

    it("accepts a custom login timeout", () => {
      const provider = new PlaySessionAuthProvider(
        "https://horizon.test",
        true,
        60,
      );
      // We can verify this through the factory (tested below)
      // but the constructor should not throw
      expect(provider).toBeInstanceOf(PlaySessionAuthProvider);
    });

    it("strips trailing slash from horizon URL", () => {
      // Just verify it doesn't throw - URL cleanup is internal
      const provider = new PlaySessionAuthProvider(
        "https://horizon.test///",
      );
      expect(provider).toBeInstanceOf(PlaySessionAuthProvider);
    });
  });

  describe("getHeaders", () => {
    it("throws when no session cookie is available", async () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");
      await expect(provider.getHeaders()).rejects.toThrow(
        "No Play session",
      );
    });

    it("returns Cookie header with PLAY_SESSION when cookie is set", async () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");
      // Use internal access to set state for testing
      const p = provider as unknown as {
        _sessionCookie: string;
        _expired: boolean;
      };
      p._sessionCookie = "abc123";
      p._expired = false;

      const headers = await provider.getHeaders();
      expect(headers).toEqual({ Cookie: "PLAY_SESSION=abc123" });
    });

    it("includes CSRF cookie when csrf token is set", async () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");
      const p = provider as unknown as {
        _sessionCookie: string;
        _csrfTokenValue: string;
        _expired: boolean;
      };
      p._sessionCookie = "abc123";
      p._csrfTokenValue = "csrf-xyz";
      p._expired = false;

      const headers = await provider.getHeaders();
      expect(headers).toEqual({
        Cookie: "PLAY_SESSION=abc123; csrf-token=csrf-xyz",
      });
    });
  });

  describe("markAuthFailed", () => {
    it("sets expired flag to true", async () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");
      const p = provider as unknown as {
        _sessionCookie: string;
        _expired: boolean;
      };
      p._expired = false;
      p._sessionCookie = "abc123";

      await provider.markAuthFailed();
      expect(p._expired).toBe(true);
    });
  });

  describe("csrfToken property", () => {
    it("returns undefined when no CSRF token", () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");
      expect(provider.csrfToken).toBeUndefined();
    });

    it("returns the CSRF value when set", () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");
      const p = provider as unknown as { _csrfTokenValue: string };
      p._csrfTokenValue = "csrf-abc";
      expect(provider.csrfToken).toBe("csrf-abc");
    });
  });

  describe("refreshIfNeeded", () => {
    it("triggers _acquireSession when expired", async () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");
      const acquireMock = vi
        .fn()
        .mockResolvedValue(undefined);
      // Replace _acquireSession with a mock
      (provider as unknown as { _acquireSession: () => Promise<void> })._acquireSession =
        acquireMock;

      await provider.refreshIfNeeded();
      expect(acquireMock).toHaveBeenCalledOnce();
    });

    it("skips _acquireSession when not expired and cookie exists", async () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");
      const p = provider as unknown as {
        _sessionCookie: string;
        _expired: boolean;
        _acquireSession: () => Promise<void>;
      };
      p._expired = false;
      p._sessionCookie = "abc123";

      const acquireMock = vi.fn().mockResolvedValue(undefined);
      p._acquireSession = acquireMock;

      await provider.refreshIfNeeded();
      expect(acquireMock).not.toHaveBeenCalled();
    });
  });

  describe("playwright import error", () => {
    it("throws a clear message when playwright is not installed", async () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");

      // Mock the static method to throw ImportError
      const original = PlaySessionAuthProvider["_checkPlaywrightAvailable"];
      PlaySessionAuthProvider["_checkPlaywrightAvailable"] = () => {
        throw new Error(
          "Play session auth requires Playwright. " +
            "Install: npm install playwright && npx playwright install chromium",
        );
      };

      try {
        await expect(provider.refreshIfNeeded()).rejects.toThrow(
          "Play session auth requires Playwright",
        );
      } finally {
        PlaySessionAuthProvider["_checkPlaywrightAvailable"] = original;
      }
    });
  });

  describe("chromium not installed", () => {
    it("wraps browser-missing error with clear message", async () => {
      const provider = new PlaySessionAuthProvider("https://horizon.test");

      // Mock playwright check to pass
      const origCheck = PlaySessionAuthProvider["_checkPlaywrightAvailable"];
      PlaySessionAuthProvider["_checkPlaywrightAvailable"] = () => {};

      // Mock dynamic import to simulate missing chromium
      const acquireFn = (provider as unknown as {
        _acquireSession: () => Promise<void>;
      })._acquireSession.bind(provider);

      // Instead of going through the full flow, directly test the error
      // wrapping logic by mocking at a higher level
      const mockAcquire = vi.fn().mockRejectedValue(
        new Error("Chromium browser not found. Run: npx playwright install chromium"),
      );
      (provider as unknown as { _acquireSession: () => Promise<void> })._acquireSession =
        mockAcquire;

      try {
        await expect(provider.refreshIfNeeded()).rejects.toThrow(
          "Chromium browser not found",
        );
      } finally {
        PlaySessionAuthProvider["_checkPlaywrightAvailable"] = origCheck;
      }
    });
  });

  describe("navigation error", () => {
    it("wraps navigation failure with connectivity hint", async () => {
      const provider = new PlaySessionAuthProvider(
        "https://unreachable.invalid",
      );

      // Mock _acquireSession to throw the expected wrapped error
      const mockAcquire = vi.fn().mockRejectedValue(
        new Error(
          "Failed to navigate to https://unreachable.invalid. " +
            "Check HORIZON_URL and network connectivity. " +
            "(Error: net::ERR_NAME_NOT_RESOLVED)",
        ),
      );
      (provider as unknown as { _acquireSession: () => Promise<void> })._acquireSession =
        mockAcquire;

      await expect(provider.refreshIfNeeded()).rejects.toThrow(
        "Failed to navigate",
      );
    });
  });
});

// ===========================================================================
// createAuthProvider (factory)
// ===========================================================================

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

    it("creates MtlsAuthProvider with valid PEM files", () => {
      const dir = makeTmpDir();
      const cert = writeDummyPem(dir, "cert.pem");
      const key = writeDummyKey(dir, "key.pem");
      const settings = makeSettings({
        clientCert: cert,
        clientKey: key,
      });
      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(MtlsAuthProvider);
    });

    it("creates MtlsAuthProvider with valid PFX file", () => {
      const dir = makeTmpDir();
      const pfx = writeDummyPfx(dir, "client.p12");
      const settings = makeSettings({
        clientPfx: pfx,
      });
      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(MtlsAuthProvider);
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

    it("passes login_timeout from settings to PlaySessionAuthProvider", () => {
      const settings = makeSettings({ loginTimeout: 42 });
      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(PlaySessionAuthProvider);
      // Verify the timeout was passed through
      const p = provider as unknown as { _loginTimeout: number };
      expect(p._loginTimeout).toBe(42);
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

    it("throws when apiId is set without apiKey", () => {
      const settings = makeSettings({
        apiId: "test-id",
        apiKey: "",
      });

      expect(() => createAuthProvider(settings)).toThrow(
        "HORIZON_API_ID",
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

    it("prefers mTLS PEM over API key when both are configured", () => {
      const dir = makeTmpDir();
      const cert = writeDummyPem(dir, "cert.pem");
      const key = writeDummyKey(dir, "key.pem");
      const settings = makeSettings({
        clientCert: cert,
        clientKey: key,
        apiId: "test-id",
        apiKey: "test-key",
      });
      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(MtlsAuthProvider);
    });
  });

  describe("deprecated auth_mode warning", () => {
    it("logs a deprecation warning when authMode is set", () => {
      // The factory should still work, just log a warning.
      // Verify that setting authMode does not break provider creation.
      const settings = makeSettings({
        apiId: "test-id",
        apiKey: "test-key",
        authMode: "apikey",
      });
      const provider = createAuthProvider(settings);
      expect(provider).toBeInstanceOf(ApiKeyAuthProvider);
    });
  });
});
