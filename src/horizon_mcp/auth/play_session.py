"""Play Session authentication provider — Playwright browser session capture."""

from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
from typing import TYPE_CHECKING
from urllib.parse import unquote_plus

from horizon_mcp.auth.base import AuthProvider

if TYPE_CHECKING:
    from playwright.async_api import BrowserContext, Page

logger = logging.getLogger("horizon_mcp.auth.play_session")

_DEFAULT_LOGIN_TIMEOUT_S = 300
_MAX_OIDC_RETRIES = 3


class _OidcFlowError(Exception):
    """Raised when the OIDC flow fails with a recoverable error (e.g. code verifier expiry)."""


class PlaySessionAuthProvider(AuthProvider):
    """Authenticate by capturing a PLAY_SESSION cookie from browser login.

    Opens a Chromium window pointed at the Horizon URL. The user completes
    login via whatever IdP Horizon is configured with (OIDC, LDAP, etc.).
    Once the PLAY_SESSION cookie appears (or changes from its pre-auth
    value), it's captured and injected into all subsequent API calls
    via the Cookie header.

    For OIDC flows with PKCE, the server stores a code verifier with a short
    TTL. If manual IdP login takes longer than this TTL, the verifier expires.
    This provider handles this by retrying — the first attempt caches IdP SSO
    cookies, and the retry completes near-instantly via SSO before the verifier
    can expire.
    """

    def __init__(
        self,
        horizon_url: str,
        verify_ssl: bool = True,
        login_timeout: int = _DEFAULT_LOGIN_TIMEOUT_S,
    ) -> None:
        self._horizon_url = horizon_url.rstrip("/")
        self._verify_ssl = verify_ssl
        self._login_timeout = login_timeout
        self._session_cookie: str | None = None
        self._csrf_token_value: str | None = None
        self._expired = True  # Start expired so first refresh triggers login

    # -- AuthProvider interface ------------------------------------------------

    async def get_headers(self) -> dict[str, str]:
        if not self._session_cookie:
            raise RuntimeError(
                "No Play session available. Call refresh_if_needed() first."
            )
        # Play Framework double-submit CSRF: the csrf-token cookie must be
        # present alongside the Csrf-Token header for POST/PUT/PATCH/DELETE.
        cookie_parts = [f"PLAY_SESSION={self._session_cookie}"]
        if self._csrf_token_value:
            cookie_parts.append(f"csrf-token={self._csrf_token_value}")
        return {"Cookie": "; ".join(cookie_parts)}

    async def refresh_if_needed(self) -> None:
        if self._expired or not self._session_cookie:
            await self._acquire_session()

    async def mark_auth_failed(self) -> None:
        logger.warning(
            "Session expired — reopening browser for re-authentication."
        )
        self._expired = True

    @property
    def csrf_token(self) -> str | None:
        return self._csrf_token_value

    # -- Browser flow ----------------------------------------------------------

    async def _acquire_session(self) -> None:
        """Open browser, wait for PLAY_SESSION cookie, capture it."""
        self._check_playwright_available()

        from playwright.async_api import async_playwright

        logger.info(
            "Opening browser for Horizon authentication at %s...",
            self._horizon_url,
        )

        # Use a persistent context with a temp profile directory.
        # This is Playwright's recommended approach for auth flows — it gives
        # the browser a real user data dir so cookies, SameSite handling, and
        # OIDC redirect chains work identically to a regular Chrome session.
        # The persistent profile also retains IdP SSO cookies across retries.
        user_data_dir = tempfile.mkdtemp(prefix="horizon-mcp-")

        async with async_playwright() as p:
            try:
                context = await self._launch_persistent_context(
                    p, user_data_dir
                )
            except Exception:
                shutil.rmtree(user_data_dir, ignore_errors=True)
                raise

            try:
                await self._run_auth_flow_with_retry(context)
            finally:
                await context.close()
                shutil.rmtree(user_data_dir, ignore_errors=True)

        self._expired = False
        logger.info("Authentication successful — browser closed.")

    async def _run_auth_flow_with_retry(
        self, context: BrowserContext
    ) -> None:
        """Run auth flow with automatic retry on OIDC code verifier expiry.

        OIDC PKCE flow stores a code verifier server-side with a short TTL.
        When the user manually logs into the IdP (typing credentials, MFA),
        this can take longer than the TTL, causing "code verifier not found".

        On the first attempt, IdP SSO cookies are cached in the persistent
        browser profile. On retry, the IdP recognizes the SSO session and
        redirects back instantly — fast enough that the code verifier is
        still valid.
        """
        last_error: _OidcFlowError | None = None

        for attempt in range(1, _MAX_OIDC_RETRIES + 1):
            page = (
                context.pages[0]
                if context.pages
                else await context.new_page()
            )

            try:
                await page.goto(self._horizon_url)
            except Exception as exc:
                raise ConnectionError(
                    f"Failed to navigate to {self._horizon_url}. "
                    f"Check HORIZON_URL and network connectivity. ({exc})"
                ) from exc

            initial_session = await self._get_cookie_value(
                context, "PLAY_SESSION"
            )
            if initial_session:
                logger.info(
                    "Pre-auth PLAY_SESSION detected — waiting for "
                    "authenticated session (cookie value change)."
                )

            try:
                session_cookie = await self._wait_for_authenticated_session(
                    context, page, initial_session, self._login_timeout
                )
                self._session_cookie = session_cookie
                self._csrf_token_value = await self._get_cookie_value(
                    context, "csrf-token"
                )
                return  # Success
            except _OidcFlowError as exc:
                last_error = exc
                if attempt < _MAX_OIDC_RETRIES:
                    logger.warning(
                        "OIDC code verifier expired (attempt %d/%d). "
                        "Retrying — IdP SSO cookies should make this "
                        "instant...",
                        attempt,
                        _MAX_OIDC_RETRIES,
                    )
                    continue

        raise TimeoutError(
            f"OIDC authentication failed after {_MAX_OIDC_RETRIES} attempts. "
            f"Last error: {last_error}"
        )

    @staticmethod
    def _check_playwright_available() -> None:
        """Verify playwright is importable — fail fast with install instructions."""
        try:
            import playwright  # noqa: F401
        except ImportError:
            raise ImportError(
                "Play session auth requires Playwright. "
                "Install: pip install 'horizon-mcp-server[oidc]' "
                "&& playwright install chromium"
            ) from None

    async def _launch_persistent_context(
        self, p: object, user_data_dir: str
    ) -> object:
        """Launch Chromium with a persistent context for reliable auth flows."""
        try:
            return await p.chromium.launch_persistent_context(  # type: ignore[union-attr]
                user_data_dir,
                headless=False,
                ignore_https_errors=not self._verify_ssl,
            )
        except Exception as exc:
            error_msg = str(exc).lower()
            if "executable doesn't exist" in error_msg or "browsertype.launch" in error_msg:
                raise RuntimeError(
                    "Chromium browser not found. "
                    "Run: playwright install chromium"
                ) from exc
            raise RuntimeError(
                f"Failed to launch browser: {exc}"
            ) from exc

    async def _get_cookie_value(
        self, context: BrowserContext, name: str
    ) -> str | None:
        """Get the current value of a named cookie, or None."""
        for cookie in await context.cookies(urls=[self._horizon_url]):
            if cookie["name"] == name:
                return cookie["value"]
        return None

    async def _wait_for_authenticated_session(
        self,
        context: BrowserContext,
        page: Page,
        initial_value: str | None,
        timeout_s: int,
    ) -> str:
        """Wait for PLAY_SESSION cookie to appear or change from initial value.

        During OIDC initiation, Play Framework may set a PLAY_SESSION cookie
        containing the PKCE code verifier. After successful login, a NEW
        PLAY_SESSION is set with the authenticated session. We must wait for
        the value to differ from the initial pre-auth value.

        Also monitors the page URL for OIDC errors (e.g. code verifier
        expiry) and raises ``_OidcFlowError`` so the caller can retry.
        """
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_s

        try:
            while loop.time() < deadline:
                current = await self._get_cookie_value(context, "PLAY_SESSION")
                if current is not None and current != initial_value:
                    return current

                # Detect OIDC code verifier expiry from the error redirect URL
                self._check_for_oidc_error(page)

                await asyncio.sleep(0.5)
        except _OidcFlowError:
            raise  # Propagate for retry logic
        except Exception as exc:
            error_msg = str(exc).lower()
            if "target closed" in error_msg or "browser has been closed" in error_msg:
                raise RuntimeError(
                    "Browser closed before login completed. "
                    "Please complete the login in the browser window."
                ) from exc
            raise

        raise TimeoutError(
            f"Login timed out after {timeout_s}s. "
            "Complete login in the browser window within the timeout."
        )

    @staticmethod
    def _check_for_oidc_error(page: Page) -> None:
        """Detect OIDC auth errors in the page URL and raise if found.

        After a failed OIDC callback, Horizon redirects to a URL containing
        ``auth_error_detail=...``. We detect the specific code verifier
        expiry error and raise ``_OidcFlowError`` to trigger a retry with
        cached IdP SSO cookies.
        """
        url_decoded = unquote_plus(page.url).lower()
        if "auth_error" in url_decoded and "code verifier" in url_decoded:
            raise _OidcFlowError(
                "OIDC PKCE code verifier expired server-side. "
                "Manual IdP login took longer than the server's "
                "code verifier TTL."
            )
