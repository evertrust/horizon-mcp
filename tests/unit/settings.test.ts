import { describe, it, expect } from "vitest";
import { loadSettings } from "../../src/settings.js";

describe("loadSettings", () => {
  describe("default values", () => {
    it("returns defaults when no HORIZON_ env vars are set", () => {
      const settings = loadSettings({});

      expect(settings.url).toBe("https://localhost");
      expect(settings.apiId).toBe("");
      expect(settings.apiKey).toBe("");
      expect(settings.verifySsl).toBe(true);
      expect(settings.timeout).toBe(30);
      expect(settings.loginTimeout).toBe(300);
      expect(settings.exportTimeout).toBe(120);
      expect(settings.logLevel).toBe("INFO");
      expect(settings.clientCert).toBe("");
      expect(settings.clientKey).toBe("");
      expect(settings.clientKeyPassword).toBe("");
      expect(settings.clientPfx).toBe("");
      expect(settings.clientPfxPassword).toBe("");
    });

    it("ignores env vars without HORIZON_ prefix", () => {
      const settings = loadSettings({
        API_ID: "should-be-ignored",
        URL: "https://ignored.example.com",
      });

      expect(settings.apiId).toBe("");
      expect(settings.url).toBe("https://localhost");
    });
  });

  describe("SCREAMING_SNAKE_CASE to camelCase conversion", () => {
    it("converts single-word keys", () => {
      const settings = loadSettings({ HORIZON_URL: "https://example.com" });
      expect(settings.url).toBe("https://example.com");
    });

    it("converts multi-word keys like CLIENT_PFX_PASSWORD", () => {
      const settings = loadSettings({
        HORIZON_CLIENT_PFX_PASSWORD: "my-secret",
      });
      expect(settings.clientPfxPassword).toBe("my-secret");
    });

    it("converts CLIENT_KEY_PASSWORD correctly", () => {
      const settings = loadSettings({
        HORIZON_CLIENT_KEY_PASSWORD: "key-pass",
      });
      expect(settings.clientKeyPassword).toBe("key-pass");
    });

    it("converts API_ID and API_KEY", () => {
      const settings = loadSettings({
        HORIZON_API_ID: "my-id",
        HORIZON_API_KEY: "my-key",
      });
      expect(settings.apiId).toBe("my-id");
      expect(settings.apiKey).toBe("my-key");
    });

    it("converts VERIFY_SSL", () => {
      const settings = loadSettings({ HORIZON_VERIFY_SSL: "false" });
      expect(settings.verifySsl).toBe(false);
    });

    it("converts LOG_LEVEL", () => {
      const settings = loadSettings({ HORIZON_LOG_LEVEL: "DEBUG" });
      expect(settings.logLevel).toBe("DEBUG");
    });
  });

  describe("boolean coercion for VERIFY_SSL", () => {
    // Custom transform: "false" and "0" are false, everything else is true.

    it("parses 'true' as true", () => {
      const settings = loadSettings({ HORIZON_VERIFY_SSL: "true" });
      expect(settings.verifySsl).toBe(true);
    });

    it("parses 'false' as false", () => {
      const settings = loadSettings({ HORIZON_VERIFY_SSL: "false" });
      expect(settings.verifySsl).toBe(false);
    });

    it("parses '0' as false", () => {
      const settings = loadSettings({ HORIZON_VERIFY_SSL: "0" });
      expect(settings.verifySsl).toBe(false);
    });

    it("parses 'FALSE' (uppercase) as false", () => {
      const settings = loadSettings({ HORIZON_VERIFY_SSL: "FALSE" });
      expect(settings.verifySsl).toBe(false);
    });

    it("defaults to true when not set", () => {
      const settings = loadSettings({});
      expect(settings.verifySsl).toBe(true);
    });
  });

  describe("number coercion for TIMEOUT", () => {
    it("coerces string to number for TIMEOUT", () => {
      const settings = loadSettings({ HORIZON_TIMEOUT: "60" });
      expect(settings.timeout).toBe(60);
    });

    it("coerces string to number for LOGIN_TIMEOUT", () => {
      const settings = loadSettings({ HORIZON_LOGIN_TIMEOUT: "600" });
      expect(settings.loginTimeout).toBe(600);
    });

    it("coerces string to number for EXPORT_TIMEOUT", () => {
      const settings = loadSettings({ HORIZON_EXPORT_TIMEOUT: "240" });
      expect(settings.exportTimeout).toBe(240);
    });
  });

  describe("URL trailing slash stripping", () => {
    it("strips a single trailing slash", () => {
      const settings = loadSettings({
        HORIZON_URL: "https://horizon.example.com/",
      });
      expect(settings.url).toBe("https://horizon.example.com");
    });

    it("strips multiple trailing slashes", () => {
      const settings = loadSettings({
        HORIZON_URL: "https://horizon.example.com///",
      });
      expect(settings.url).toBe("https://horizon.example.com");
    });

    it("leaves URL without trailing slash unchanged", () => {
      const settings = loadSettings({
        HORIZON_URL: "https://horizon.example.com",
      });
      expect(settings.url).toBe("https://horizon.example.com");
    });

    it("preserves path segments that are not trailing", () => {
      const settings = loadSettings({
        HORIZON_URL: "https://horizon.example.com/api/",
      });
      expect(settings.url).toBe("https://horizon.example.com/api");
    });
  });

  describe("combined settings", () => {
    it("reads multiple HORIZON_ vars at once", () => {
      const settings = loadSettings({
        HORIZON_URL: "https://prod.example.com/",
        HORIZON_API_ID: "admin",
        HORIZON_API_KEY: "secret-key",
        HORIZON_VERIFY_SSL: "false",
        HORIZON_TIMEOUT: "45",
        HORIZON_LOG_LEVEL: "DEBUG",
      });

      expect(settings.url).toBe("https://prod.example.com");
      expect(settings.apiId).toBe("admin");
      expect(settings.apiKey).toBe("secret-key");
      expect(settings.verifySsl).toBe(false);
      expect(settings.timeout).toBe(45);
      expect(settings.logLevel).toBe("DEBUG");
    });

    it("skips undefined values in the env record", () => {
      const settings = loadSettings({
        HORIZON_URL: undefined,
        HORIZON_API_ID: "my-id",
      });

      expect(settings.url).toBe("https://localhost");
      expect(settings.apiId).toBe("my-id");
    });
  });
});
