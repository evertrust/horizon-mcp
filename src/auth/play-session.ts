import { AuthProvider } from "./base.js";
import { getLogger } from "../logging.js";

const logger = getLogger("horizon_mcp.auth.play_session");

const DEFAULT_LOGIN_TIMEOUT_S = 300;
const MAX_OIDC_RETRIES = 3;

class OidcFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcFlowError";
  }
}

/**
 * Authenticate by capturing a PLAY_SESSION cookie from browser login.
 *
 * Opens a Chromium window pointed at the Horizon URL. The user completes
 * login via whatever IdP Horizon is configured with (OIDC, LDAP, etc.).
 * Once the PLAY_SESSION cookie appears (or changes from its pre-auth
 * value), it's captured and injected into all subsequent API calls.
 *
 * For OIDC flows with PKCE, handles code verifier expiry by retrying -
 * the first attempt caches IdP SSO cookies, and the retry completes
 * near-instantly via SSO.
 */
export class PlaySessionAuthProvider extends AuthProvider {
  private readonly _horizonUrl: string;
  private readonly _verifySsl: boolean;
  private readonly _loginTimeout: number;
  private _sessionCookie: string | undefined;
  private _csrfTokenValue: string | undefined;
  private _expired = true;

  constructor(
    horizonUrl: string,
    verifySsl = true,
    loginTimeout = DEFAULT_LOGIN_TIMEOUT_S,
  ) {
    super();
    this._horizonUrl = horizonUrl.replace(/\/+$/, "");
    this._verifySsl = verifySsl;
    this._loginTimeout = loginTimeout;
  }

  async getHeaders(): Promise<Record<string, string>> {
    if (!this._sessionCookie) {
      throw new Error(
        "No Play session available. Call refreshIfNeeded() first.",
      );
    }
    const cookieParts = [`PLAY_SESSION=${this._sessionCookie}`];
    if (this._csrfTokenValue) {
      cookieParts.push(`csrf-token=${this._csrfTokenValue}`);
    }
    return { Cookie: cookieParts.join("; ") };
  }

  async refreshIfNeeded(): Promise<void> {
    if (this._expired || !this._sessionCookie) {
      await this._acquireSession();
    }
  }

  async markAuthFailed(): Promise<void> {
    logger.warning(
      "Session expired - reopening browser for re-authentication.",
    );
    this._expired = true;
  }

  get csrfToken(): string | undefined {
    return this._csrfTokenValue;
  }

  private async _acquireSession(): Promise<void> {
    await PlaySessionAuthProvider._checkPlaywrightAvailable();

    // Dynamic import - playwright is optional
    const { chromium } = await import("playwright");

    logger.info(
      `Opening browser for Horizon authentication at ${this._horizonUrl}...`,
    );

    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const userDataDir = mkdtempSync(join(tmpdir(), "horizon-mcp-"));

    let context;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        ignoreHTTPSErrors: !this._verifySsl,
      });
    } catch (err) {
      rmSync(userDataDir, { recursive: true, force: true });
      const msg = String(err).toLowerCase();
      if (
        msg.includes("executable doesn't exist") ||
        msg.includes("browsertype.launch")
      ) {
        throw new Error(
          "Chromium browser not found. Run: npx playwright install chromium",
        );
      }
      throw new Error(`Failed to launch browser: ${err}`);
    }

    try {
      await this._runAuthFlowWithRetry(context);
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }

    this._expired = false;
    logger.info("Authentication successful - browser closed.");
  }

  private async _runAuthFlowWithRetry(context: unknown): Promise<void> {
    // Type the context at runtime since playwright is optional
    const ctx = context as import("playwright").BrowserContext;
    let lastError: OidcFlowError | undefined;

    for (let attempt = 1; attempt <= MAX_OIDC_RETRIES; attempt++) {
      const page =
        ctx.pages().length > 0 ? ctx.pages()[0]! : await ctx.newPage();

      try {
        await page.goto(this._horizonUrl);
      } catch (err) {
        throw new Error(
          `Failed to navigate to ${this._horizonUrl}. ` +
            `Check HORIZON_URL and network connectivity. (${err})`,
        );
      }

      const initialSession = await this._getCookieValue(
        ctx,
        "PLAY_SESSION",
      );
      if (initialSession) {
        logger.info(
          "Pre-auth PLAY_SESSION detected - waiting for " +
            "authenticated session (cookie value change).",
        );
      }

      try {
        const sessionCookie = await this._waitForAuthenticatedSession(
          ctx,
          page,
          initialSession,
          this._loginTimeout,
        );
        this._sessionCookie = sessionCookie;
        this._csrfTokenValue = await this._getCookieValue(
          ctx,
          "csrf-token",
        );
        return;
      } catch (err) {
        if (err instanceof OidcFlowError) {
          lastError = err;
          if (attempt < MAX_OIDC_RETRIES) {
            logger.warning(
              `OIDC code verifier expired (attempt ${attempt}/${MAX_OIDC_RETRIES}). ` +
                "Retrying - IdP SSO cookies should make this instant...",
            );
            continue;
          }
        } else {
          throw err;
        }
      }
    }

    throw new Error(
      `OIDC authentication failed after ${MAX_OIDC_RETRIES} attempts. ` +
        `Last error: ${lastError}`,
    );
  }

  private static async _checkPlaywrightAvailable(): Promise<void> {
    try {
      await import("playwright");
    } catch {
      throw new Error(
        "Play session auth requires Playwright. " +
          "Install: npm install playwright && npx playwright install chromium",
      );
    }
  }

  private async _getCookieValue(
    context: import("playwright").BrowserContext,
    name: string,
  ): Promise<string | undefined> {
    const cookies = await context.cookies(this._horizonUrl);
    const cookie = cookies.find((c) => c.name === name);
    return cookie?.value;
  }

  private async _waitForAuthenticatedSession(
    context: import("playwright").BrowserContext,
    page: import("playwright").Page,
    initialValue: string | undefined,
    timeoutS: number,
  ): Promise<string> {
    const deadline = Date.now() + timeoutS * 1000;

    while (Date.now() < deadline) {
      const current = await this._getCookieValue(context, "PLAY_SESSION");
      if (current !== undefined && current !== initialValue) {
        return current;
      }

      PlaySessionAuthProvider._checkForOidcError(page);

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(
      `Login timed out after ${timeoutS}s. ` +
        "Complete login in the browser window within the timeout.",
    );
  }

  private static _checkForOidcError(
    page: import("playwright").Page,
  ): void {
    const urlDecoded = decodeURIComponent(page.url()).toLowerCase();
    if (
      urlDecoded.includes("auth_error") &&
      urlDecoded.includes("code verifier")
    ) {
      throw new OidcFlowError(
        "OIDC PKCE code verifier expired server-side. " +
          "Manual IdP login took longer than the server's " +
          "code verifier TTL.",
      );
    }
  }
}
