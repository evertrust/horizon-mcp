"""Tests for HorizonClient: auth, CSRF, errors, retry behavior."""

from __future__ import annotations

import pytest
import httpx
import respx

from horizon_mcp.auth.apikey import ApiKeyAuthProvider
from unittest.mock import AsyncMock

from horizon_mcp.auth.base import AuthProvider
from horizon_mcp.client.errors import HorizonError, parse_error_response
from horizon_mcp.client.http import HorizonClient
from horizon_mcp.settings import HorizonSettings


# -- Auth tests -------------------------------------------------------------

class TestApiKeyAuth:
    async def test_get_headers(self):
        auth = ApiKeyAuthProvider(api_id="myid", api_key="mykey")
        headers = await auth.get_headers()
        assert headers == {"X-API-ID": "myid", "X-API-KEY": "mykey"}

    async def test_refresh_is_noop(self):
        auth = ApiKeyAuthProvider(api_id="myid", api_key="mykey")
        await auth.refresh_if_needed()  # Should not raise

    def test_missing_credentials_raises(self):
        with pytest.raises(ValueError, match="HORIZON_API_ID"):
            ApiKeyAuthProvider(api_id="", api_key="mykey")
        with pytest.raises(ValueError, match="HORIZON_API_ID"):
            ApiKeyAuthProvider(api_id="myid", api_key="")


class TestBaseAuthDefaults:
    """Verify default implementations on AuthProvider base class."""

    async def test_client_kwargs_default_empty(self):
        auth = ApiKeyAuthProvider(api_id="id", api_key="key")
        assert auth.client_kwargs() == {}

    async def test_mark_auth_failed_default_noop(self):
        auth = ApiKeyAuthProvider(api_id="id", api_key="key")
        await auth.mark_auth_failed()  # Should not raise

    def test_csrf_token_default_none(self):
        auth = ApiKeyAuthProvider(api_id="id", api_key="key")
        assert auth.csrf_token is None


# -- Error parsing tests ----------------------------------------------------

class TestErrorParsing:
    def test_parse_not_found(self):
        err = parse_error_response(404, b'{"error": "CA-003", "message": "CA not found"}')
        assert err.status_code == 404
        assert err.error_code == "CA-003"
        assert "not found" in err.message.lower()
        assert err.remediation is not None
        assert "list_" in err.remediation

    def test_parse_already_exists(self):
        err = parse_error_response(409, b'{"error": "PRF-004", "message": "Profile exists"}')
        assert err.error_code == "PRF-004"
        assert "update_" in err.remediation

    def test_parse_validation_error(self):
        err = parse_error_response(
            400,
            b'{"error": "PRF-002", "message": "Validation failed", "detail": "name is required"}',
        )
        assert "Validation" in err.remediation
        assert err.detail == "name is required"

    def test_parse_auth_error(self):
        err = parse_error_response(401, b'{"error": "SecAuth001", "message": "Unauthorized"}')
        assert "HORIZON_API_ID" in err.remediation

    def test_parse_perm_error(self):
        err = parse_error_response(403, b'{"error": "SecPerm001", "message": "Forbidden"}')
        assert "role" in err.remediation.lower()

    def test_parse_invalid_json(self):
        err = parse_error_response(500, b"Internal Server Error")
        assert err.status_code == 500
        assert err.error_code is None

    def test_sensitive_fields_redacted(self):
        err = parse_error_response(
            400,
            b'{"error": "X-001", "message": "bad", "apiKey": "secret123", "password": "pw"}',
        )
        assert err.raw.get("apiKey") == "<redacted>"
        assert err.raw.get("password") == "<redacted>"

    def test_to_tool_result(self):
        err = HorizonError(status_code=404, error_code="CA-003", message="Not found")
        result = err.to_tool_result()
        assert "404" in result
        assert "CA-003" in result


# -- Client retry tests -----------------------------------------------------

class TestClientRetry:
    @respx.mock(base_url="https://horizon.test")
    async def test_get_retries_on_503(self, respx_mock: respx.MockRouter):
        """GET should retry on 503 and succeed on next attempt."""
        settings = HorizonSettings(
            url="https://horizon.test", api_id="id", api_key="key",
            verify_ssl=False, timeout=5,
        )
        auth = ApiKeyAuthProvider(api_id="id", api_key="key")
        client = HorizonClient(settings, auth)
        client._initialized = True  # Skip lazy init — testing retry, not init

        route = respx_mock.get("/api/v1/cas").mock(
            side_effect=[
                httpx.Response(503, json={"error": "unavailable"}),
                httpx.Response(200, json=[{"name": "ca1"}]),
            ]
        )

        result = await client.get("/api/v1/cas")
        assert result == [{"name": "ca1"}]
        assert route.call_count == 2
        await client.close()

    @respx.mock(base_url="https://horizon.test")
    async def test_post_does_not_retry(self, respx_mock: respx.MockRouter):
        """POST should NOT retry — mutations are not idempotent."""
        settings = HorizonSettings(
            url="https://horizon.test", api_id="id", api_key="key",
            verify_ssl=False, timeout=5,
        )
        auth = ApiKeyAuthProvider(api_id="id", api_key="key")
        client = HorizonClient(settings, auth)
        client._initialized = True  # Skip lazy init — testing retry, not init

        route = respx_mock.post("/api/v1/cas").mock(
            return_value=httpx.Response(500, json={"error": "X-001", "message": "fail"})
        )

        with pytest.raises(HorizonError) as exc_info:
            await client.post("/api/v1/cas", json={"name": "test"})
        assert exc_info.value.status_code == 500
        assert route.call_count == 1
        await client.close()

    @respx.mock(base_url="https://horizon.test")
    async def test_csrf_retry_on_403(self, respx_mock: respx.MockRouter):
        """CSRF 403 should trigger single retry after token refresh."""
        settings = HorizonSettings(
            url="https://horizon.test", api_id="id", api_key="key",
            verify_ssl=False, timeout=5,
        )
        auth = ApiKeyAuthProvider(api_id="id", api_key="key")
        client = HorizonClient(settings, auth)
        client._initialized = True  # Skip lazy init — testing CSRF retry, not init

        # First PUT → CSRF 403, then CSRF fetch, then retry succeeds
        put_route = respx_mock.put("/api/v1/cas/test").mock(
            side_effect=[
                httpx.Response(403, json={"error": "csrf", "message": "CSRF token invalid"}),
                httpx.Response(200, json={"name": "test"}),
            ]
        )
        csrf_route = respx_mock.get("/api/v1/security/csrf").mock(
            return_value=httpx.Response(200, json={"token": "new-csrf-token"})
        )

        result = await client.put("/api/v1/cas/test", json={"name": "test"})
        assert result == {"name": "test"}
        assert put_route.call_count == 2
        assert csrf_route.call_count == 1
        await client.close()


# -- Version detection tests ------------------------------------------------

class TestSettings:
    def test_base_url_strips_trailing_slash(self):
        s = HorizonSettings(url="https://horizon.test/")
        assert s.base_url == "https://horizon.test"

    def test_defaults(self):
        s = HorizonSettings(url="https://horizon.test", api_id="id", api_key="key")
        assert s.timeout == 30
        assert s.verify_ssl is True
        assert s.log_level == "INFO"


# -- Re-auth retry tests -------------------------------------------------------


class _MockReauthProvider(AuthProvider):
    """Auth provider that tracks mark_auth_failed and refresh_if_needed calls."""

    def __init__(self) -> None:
        self._headers = {"X-API-ID": "test", "X-API-KEY": "test"}
        self.mark_auth_failed_count = 0
        self.refresh_count = 0

    async def get_headers(self) -> dict[str, str]:
        return dict(self._headers)

    async def refresh_if_needed(self) -> None:
        self.refresh_count += 1

    async def mark_auth_failed(self) -> None:
        self.mark_auth_failed_count += 1


class TestClientReauth:
    @respx.mock(base_url="https://horizon.test")
    async def test_401_triggers_reauth_retry(self, respx_mock: respx.MockRouter):
        """401 should trigger mark_auth_failed + refresh + retry."""
        settings = HorizonSettings(
            url="https://horizon.test", verify_ssl=False, timeout=5,
        )
        auth = _MockReauthProvider()
        client = HorizonClient(settings, auth)
        client._initialized = True  # Skip lazy init — testing reauth, not init

        route = respx_mock.get("/api/v1/cas").mock(
            side_effect=[
                httpx.Response(401, json={"error": "SecAuth001", "message": "Unauthorized"}),
                httpx.Response(200, json=[{"name": "ca1"}]),
            ]
        )

        result = await client.get("/api/v1/cas")
        assert result == [{"name": "ca1"}]
        assert route.call_count == 2
        assert auth.mark_auth_failed_count == 1
        await client.close()

    @respx.mock(base_url="https://horizon.test")
    async def test_non_csrf_403_triggers_reauth(self, respx_mock: respx.MockRouter):
        """Non-CSRF 403 should trigger re-auth retry."""
        settings = HorizonSettings(
            url="https://horizon.test", verify_ssl=False, timeout=5,
        )
        auth = _MockReauthProvider()
        client = HorizonClient(settings, auth)
        client._initialized = True  # Skip lazy init — testing reauth, not init

        route = respx_mock.get("/api/v1/cas").mock(
            side_effect=[
                httpx.Response(403, json={"error": "SecPerm001", "message": "Forbidden"}),
                httpx.Response(200, json=[{"name": "ca1"}]),
            ]
        )

        result = await client.get("/api/v1/cas")
        assert result == [{"name": "ca1"}]
        assert route.call_count == 2
        assert auth.mark_auth_failed_count == 1
        await client.close()

    @respx.mock(base_url="https://horizon.test")
    async def test_reauth_only_once(self, respx_mock: respx.MockRouter):
        """Second 401 after retry should raise, not loop."""
        settings = HorizonSettings(
            url="https://horizon.test", verify_ssl=False, timeout=5,
        )
        auth = _MockReauthProvider()
        client = HorizonClient(settings, auth)
        client._initialized = True  # Skip lazy init — testing reauth, not init

        route = respx_mock.get("/api/v1/cas").mock(
            side_effect=[
                httpx.Response(401, json={"error": "SecAuth001", "message": "Unauthorized"}),
                httpx.Response(401, json={"error": "SecAuth001", "message": "Unauthorized"}),
            ]
        )

        with pytest.raises(HorizonError) as exc_info:
            await client.get("/api/v1/cas")
        assert exc_info.value.status_code == 401
        assert route.call_count == 2
        assert auth.mark_auth_failed_count == 1
        await client.close()

    @respx.mock(base_url="https://horizon.test")
    async def test_csrf_403_still_works(self, respx_mock: respx.MockRouter):
        """CSRF 403 should use the CSRF path, not the re-auth path."""
        settings = HorizonSettings(
            url="https://horizon.test", verify_ssl=False, timeout=5,
        )
        auth = _MockReauthProvider()
        client = HorizonClient(settings, auth)
        client._initialized = True  # Skip lazy init — testing CSRF path, not init

        put_route = respx_mock.put("/api/v1/cas/test").mock(
            side_effect=[
                httpx.Response(403, json={"error": "csrf", "message": "CSRF token invalid"}),
                httpx.Response(200, json={"name": "test"}),
            ]
        )
        csrf_route = respx_mock.get("/api/v1/security/csrf").mock(
            return_value=httpx.Response(200, json={"token": "new-csrf"})
        )

        result = await client.put("/api/v1/cas/test", json={"name": "test"})
        assert result == {"name": "test"}
        assert put_route.call_count == 2
        assert csrf_route.call_count >= 1
        # CSRF path should NOT trigger mark_auth_failed
        assert auth.mark_auth_failed_count == 0
        await client.close()
