"""Async HTTP client for Horizon API with CSRF, auth injection, and safe retries."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from horizon_mcp.auth.base import AuthProvider
from horizon_mcp.client.errors import HorizonError, parse_error_response
from horizon_mcp.settings import HorizonSettings

logger = logging.getLogger("horizon_mcp.client")

# PUT/DELETE endpoints verified as idempotent  -  initially empty, populated incrementally
RETRYABLE_ENDPOINTS: set[tuple[str, str]] = set()

# Status codes that warrant retry on safe methods
_RETRYABLE_STATUS = frozenset({429, 502, 503, 504})


class HorizonClient:
    """Async HTTP client for Horizon API.

    Features:
    - Auth header injection via AuthProvider
    - CSRF token handling (fetch + refresh on 403)
    - Auto-retry for GET/HEAD only (3x exponential backoff, 429/5xx/connection)
    - No retry for POST/PATCH by default
    - PUT/DELETE retry only for endpoints in RETRYABLE_ENDPOINTS allowlist
    - CSRF 403 single retry on any method (no mutation occurred)
    - Request correlation via request_id (UUID4)
    """

    def __init__(self, settings: HorizonSettings, auth: AuthProvider) -> None:
        self._settings = settings
        self._auth = auth
        self._csrf_token: str | None = None
        self._initialized = False
        self._init_lock = asyncio.Lock()
        client_kw = auth.client_kwargs()
        self._http = httpx.AsyncClient(
            base_url=settings.base_url,
            verify=client_kw.pop("verify", settings.verify_ssl),
            timeout=httpx.Timeout(settings.timeout, read=settings.timeout),
            follow_redirects=True,
            **client_kw,
        )

    # -- Public API ---------------------------------------------------------

    async def get(
        self, path: str, params: dict[str, Any] | None = None, **kwargs: Any
    ) -> dict[str, Any]:
        return await self._request_json("GET", path, params=params, **kwargs)

    async def post(
        self, path: str, json: Any = None, **kwargs: Any
    ) -> dict[str, Any]:
        return await self._request_json("POST", path, json=json, **kwargs)

    async def put(
        self, path: str, json: Any = None, **kwargs: Any
    ) -> dict[str, Any]:
        return await self._request_json("PUT", path, json=json, **kwargs)

    async def patch(
        self, path: str, json: Any = None, **kwargs: Any
    ) -> dict[str, Any]:
        return await self._request_json("PATCH", path, json=json, **kwargs)

    async def delete(self, path: str, **kwargs: Any) -> dict[str, Any] | None:
        resp = await self._request("DELETE", path, **kwargs)
        if resp.status_code == 204:
            return None
        return resp.json()

    async def get_bytes(
        self, path: str, params: dict[str, Any] | None = None, **kwargs: Any
    ) -> bytes:
        resp = await self._request("GET", path, params=params, **kwargs)
        return resp.content

    async def get_text(
        self, path: str, params: dict[str, Any] | None = None, **kwargs: Any
    ) -> str:
        resp = await self._request("GET", path, params=params, **kwargs)
        return resp.text

    async def close(self) -> None:
        await self._http.aclose()

    # -- CSRF ---------------------------------------------------------------

    async def fetch_csrf_token(self) -> str | None:
        """Fetch CSRF token from Horizon.

        Checks the auth provider first (OIDC captures csrf-token during
        browser login), then tries the JSON API endpoint, then falls back
        to reading the ``csrf-token`` cookie set by Play Framework.
        Returns None if no source provides a token  -  in that case the
        client will send ``Csrf-Token: nocheck`` on mutating requests.
        """
        # Auth provider may have captured csrf-token (e.g., OIDC browser flow)
        provider_token = self._auth.csrf_token
        if provider_token:
            self._csrf_token = provider_token
            return self._csrf_token

        # Ensure auth session is ready before making HTTP calls
        await self._auth.refresh_if_needed()

        # Re-check after refresh  -  OIDC captures csrf-token during browser flow
        provider_token = self._auth.csrf_token
        if provider_token:
            self._csrf_token = provider_token
            return self._csrf_token

        try:
            resp = await self._http.get(
                "/api/v1/security/csrf",
                headers=await self._auth.get_headers(),
            )
            if resp.status_code == 200:
                data = resp.json()
                self._csrf_token = data.get("token") or data.get("csrfToken")
                if self._csrf_token:
                    return self._csrf_token
        except Exception:
            logger.debug("CSRF JSON endpoint unavailable  -  checking cookies")

        # Fallback: Play Framework sets a csrf-token cookie
        cookie_token = self._http.cookies.get("csrf-token")
        if cookie_token:
            self._csrf_token = cookie_token
            return self._csrf_token

        return None

    # -- Lazy initialization ------------------------------------------------

    async def _ensure_initialized(self) -> None:
        """Lazy init: auth + CSRF + whoami on first request."""
        if self._initialized:
            return
        async with self._init_lock:
            if self._initialized:
                return  # Another coroutine already initialized
            await self._do_lazy_init()
            self._initialized = True

    async def _do_lazy_init(self) -> None:
        """Trigger auth, fetch CSRF token, and run whoami."""
        from horizon_mcp.client.state import set_horizon_version, set_principal_name

        # Trigger auth (browser login for Play Session, no-op for API key/mTLS)
        await self._auth.refresh_if_needed()

        # CSRF token
        await self.fetch_csrf_token()

        # Whoami  -  use raw httpx to avoid recursion through _request
        try:
            headers = await self._auth.get_headers()
            resp = await self._http.get(
                "/api/v1/security/principals/self", headers=headers
            )
            if resp.status_code == 200:
                principal = resp.json()
                identity = principal.get("identity") or {}
                name = (
                    identity.get("identifier")
                    or principal.get("identifier")
                    or principal.get("name")
                    or "unknown"
                )
                set_principal_name(name)

                version = principal.get("_horizonVersion")
                set_horizon_version(version)
                logger.info(
                    "Authenticated as: %s (Horizon %s)",
                    name,
                    version or "unknown",
                )
            else:
                logger.warning(
                    "Whoami returned %d  -  continuing without principal info",
                    resp.status_code,
                )
        except Exception as exc:
            logger.warning("Whoami failed: %s  -  continuing", exc)

    # -- Internal -----------------------------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        request_id: str | None = None,
        timeout_override: float | None = None,
        reauth_attempted: bool = False,
        **kwargs: Any,
    ) -> httpx.Response:
        request_id = request_id or uuid.uuid4().hex[:12]
        start = time.monotonic()

        await self._ensure_initialized()
        await self._auth.refresh_if_needed()
        headers = await self._auth.get_headers()
        headers["X-Request-ID"] = request_id

        # CSRF handling for mutating methods (Play Framework)
        if method.upper() not in ("GET", "HEAD"):
            if self._csrf_token:
                headers["Csrf-Token"] = self._csrf_token
            else:
                # Play Framework API convention: "nocheck" bypasses CSRF for
                # non-browser clients authenticated via API keys.
                headers["Csrf-Token"] = "nocheck"

        if timeout_override:
            kwargs["timeout"] = httpx.Timeout(timeout_override)

        try:
            resp = await self._do_request(method, path, headers, request_id, **kwargs)
        except httpx.ConnectError as exc:
            logger.error(
                "Connection failed",
                extra={"request_id": request_id, "method": method, "path": path},
            )
            raise HorizonError(
                status_code=0,
                message=f"Connection to {self._settings.base_url} failed: {exc}",
                remediation="Check HORIZON_URL and network connectivity.",
            ) from exc

        duration_ms = int((time.monotonic() - start) * 1000)

        logger.info(
            "HTTP %s %s → %d (%dms)",
            method, path, resp.status_code, duration_ms,
            extra={"request_id": request_id, "method": method, "path": path,
                   "status": resp.status_code, "duration_ms": duration_ms},
        )

        # CSRF 403 → single retry after token refresh
        if resp.status_code == 403 and self._is_csrf_rejection(resp):
            logger.info("CSRF rejected  -  refreshing token and retrying",
                        extra={"request_id": request_id})
            await self.fetch_csrf_token()
            headers["Csrf-Token"] = self._csrf_token or "nocheck"
            resp = await self._do_request(method, path, headers, request_id, **kwargs)
            if resp.status_code >= 400:
                raise parse_error_response(resp.status_code, resp.content)
            return resp

        # Auth failure retry: 401 or non-CSRF 403 → re-authenticate once
        if resp.status_code in (401, 403) and not reauth_attempted:
            logger.info(
                "Auth rejected (%d)  -  attempting re-authentication",
                resp.status_code,
                extra={"request_id": request_id},
            )
            await self._auth.mark_auth_failed()
            await self._auth.refresh_if_needed()
            headers = await self._auth.get_headers()
            headers["X-Request-ID"] = request_id
            if method.upper() not in ("GET", "HEAD"):
                headers["Csrf-Token"] = self._csrf_token or "nocheck"
            try:
                resp = await self._do_request(
                    method, path, headers, request_id, **kwargs
                )
            except httpx.ConnectError as exc:
                raise HorizonError(
                    status_code=0,
                    message=f"Connection to {self._settings.base_url} failed: {exc}",
                    remediation="Check HORIZON_URL and network connectivity.",
                ) from exc
            if resp.status_code >= 400:
                raise parse_error_response(resp.status_code, resp.content)
            return resp

        if resp.status_code >= 400:
            raise parse_error_response(resp.status_code, resp.content)

        return resp

    async def _do_request(
        self,
        method: str,
        path: str,
        headers: dict[str, str],
        request_id: str,
        **kwargs: Any,
    ) -> httpx.Response:
        """Execute HTTP request with retry logic based on method safety."""
        upper = method.upper()

        # Safe methods: auto-retry
        if upper in ("GET", "HEAD"):
            return await self._retry_request(method, path, headers=headers, **kwargs)

        # PUT/DELETE: retry only if on the verified allowlist
        if upper in ("PUT", "DELETE") and (upper, path) in RETRYABLE_ENDPOINTS:
            return await self._retry_request(method, path, headers=headers, **kwargs)

        # POST/PATCH and non-allowlisted PUT/DELETE: no retry
        return await self._http.request(method, path, headers=headers, **kwargs)

    @retry(
        retry=retry_if_exception_type((httpx.ConnectError, httpx.ReadTimeout)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    async def _retry_request(
        self, method: str, path: str, **kwargs: Any
    ) -> httpx.Response:
        """Execute request with tenacity retry for transient failures."""
        resp = await self._http.request(method, path, **kwargs)
        if resp.status_code in _RETRYABLE_STATUS:
            raise httpx.ReadTimeout(
                f"Retryable status {resp.status_code}",
                request=resp.request,
            )
        return resp

    async def _request_json(
        self, method: str, path: str, **kwargs: Any
    ) -> dict[str, Any]:
        resp = await self._request(method, path, **kwargs)
        if not resp.content:
            return {}
        return resp.json()

    @staticmethod
    def _is_csrf_rejection(resp: httpx.Response) -> bool:
        """Check if a 403 is specifically a CSRF rejection vs. auth/perm issue."""
        try:
            body = resp.json()
            raw_error = body.get("error", "")
            error_str = raw_error if isinstance(raw_error, str) else str(raw_error)
            message = body.get("message", "")
            message = message if isinstance(message, str) else str(message)
            return "csrf" in error_str.lower() or "csrf" in message.lower()
        except Exception:
            return False
