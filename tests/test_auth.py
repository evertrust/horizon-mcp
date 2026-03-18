"""Tests for mTLS, Play Session, and auth factory auto-detection."""

from __future__ import annotations

import os
import ssl
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from horizon_mcp.auth import create_auth_provider
from horizon_mcp.auth.apikey import ApiKeyAuthProvider
from horizon_mcp.auth.mtls import MtlsAuthProvider
from horizon_mcp.auth.play_session import PlaySessionAuthProvider
from horizon_mcp.settings import HorizonSettings


# -- Helpers: self-signed cert generation (PEM) --------------------------------


def _generate_self_signed_pem(
    tmp_dir: str,
    *,
    key_password: str | None = None,
) -> tuple[str, str]:
    """Generate a self-signed cert + key PEM pair in tmp_dir."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    import datetime

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test-mtls")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(
            datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=365)
        )
        .sign(key, hashes.SHA256())
    )

    cert_path = os.path.join(tmp_dir, "cert.pem")
    key_path = os.path.join(tmp_dir, "key.pem")

    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    enc = (
        serialization.BestAvailableEncryption(key_password.encode())
        if key_password
        else serialization.NoEncryption()
    )
    with open(key_path, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, enc))

    return cert_path, key_path


def _generate_self_signed_pfx(
    tmp_dir: str,
    *,
    password: str | None = None,
) -> str:
    """Generate a self-signed PKCS12/PFX bundle in tmp_dir."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID
    import datetime

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test-mtls-pfx")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(
            datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=365)
        )
        .sign(key, hashes.SHA256())
    )

    pfx_path = os.path.join(tmp_dir, "client.p12")
    pwd_bytes = password.encode() if password else None
    pfx_data = pkcs12.serialize_key_and_certificates(
        name=b"test",
        key=key,
        cert=cert,
        cas=None,
        encryption_algorithm=(
            serialization.BestAvailableEncryption(pwd_bytes)
            if pwd_bytes
            else serialization.NoEncryption()
        ),
    )
    with open(pfx_path, "wb") as f:
        f.write(pfx_data)

    return pfx_path


# -- Fixtures ------------------------------------------------------------------


@pytest.fixture
def pem_certs(tmp_path: Path) -> tuple[str, str]:
    """Generate self-signed PEM cert + key (no password)."""
    return _generate_self_signed_pem(str(tmp_path))


@pytest.fixture
def pem_certs_encrypted(tmp_path: Path) -> tuple[str, str]:
    """Generate self-signed PEM cert + encrypted key."""
    return _generate_self_signed_pem(str(tmp_path), key_password="test-password")


@pytest.fixture
def pfx_bundle(tmp_path: Path) -> str:
    """Generate self-signed PFX bundle (no password)."""
    return _generate_self_signed_pfx(str(tmp_path))


@pytest.fixture
def pfx_bundle_encrypted(tmp_path: Path) -> str:
    """Generate self-signed PFX bundle with password."""
    return _generate_self_signed_pfx(str(tmp_path), password="pfx-secret")


# -- TestMtlsAuthPem ----------------------------------------------------------


class TestMtlsAuthPem:
    def test_client_kwargs_pem_no_password(self, pem_certs: tuple[str, str]):
        cert_path, key_path = pem_certs
        provider = MtlsAuthProvider(
            cert_path=cert_path, key_path=key_path, verify_ssl=False
        )
        kw = provider.client_kwargs()
        assert "verify" in kw
        assert isinstance(kw["verify"], ssl.SSLContext)

    def test_client_kwargs_pem_with_password(self, pem_certs_encrypted: tuple[str, str]):
        cert_path, key_path = pem_certs_encrypted
        provider = MtlsAuthProvider(
            cert_path=cert_path,
            key_path=key_path,
            key_password="test-password",
            verify_ssl=False,
        )
        kw = provider.client_kwargs()
        assert isinstance(kw["verify"], ssl.SSLContext)

    async def test_get_headers_empty(self, pem_certs: tuple[str, str]):
        cert_path, key_path = pem_certs
        provider = MtlsAuthProvider(
            cert_path=cert_path, key_path=key_path, verify_ssl=False
        )
        headers = await provider.get_headers()
        assert headers == {}

    async def test_refresh_noop(self, pem_certs: tuple[str, str]):
        cert_path, key_path = pem_certs
        provider = MtlsAuthProvider(
            cert_path=cert_path, key_path=key_path, verify_ssl=False
        )
        await provider.refresh_if_needed()  # Should not raise

    async def test_mark_auth_failed_noop(self, pem_certs: tuple[str, str]):
        cert_path, key_path = pem_certs
        provider = MtlsAuthProvider(
            cert_path=cert_path, key_path=key_path, verify_ssl=False
        )
        await provider.mark_auth_failed()  # Should not raise

    def test_missing_cert_file_raises(self, tmp_path: Path):
        key_path = str(tmp_path / "key.pem")
        Path(key_path).touch()
        with pytest.raises(FileNotFoundError, match="HORIZON_CLIENT_CERT"):
            MtlsAuthProvider(
                cert_path="/nonexistent/cert.pem",
                key_path=key_path,
                verify_ssl=False,
            )

    def test_missing_key_file_raises(self, pem_certs: tuple[str, str]):
        cert_path, _ = pem_certs
        with pytest.raises(FileNotFoundError, match="HORIZON_CLIENT_KEY"):
            MtlsAuthProvider(
                cert_path=cert_path,
                key_path="/nonexistent/key.pem",
                verify_ssl=False,
            )

    def test_missing_key_param_raises(self, pem_certs: tuple[str, str]):
        cert_path, _ = pem_certs
        with pytest.raises(ValueError, match="HORIZON_CLIENT_KEY is required"):
            MtlsAuthProvider(cert_path=cert_path, verify_ssl=False)

    def test_verify_ssl_false(self, pem_certs: tuple[str, str]):
        cert_path, key_path = pem_certs
        provider = MtlsAuthProvider(
            cert_path=cert_path, key_path=key_path, verify_ssl=False
        )
        ctx = provider.client_kwargs()["verify"]
        assert ctx.check_hostname is False
        assert ctx.verify_mode == ssl.CERT_NONE

    def test_csrf_token_is_none(self, pem_certs: tuple[str, str]):
        cert_path, key_path = pem_certs
        provider = MtlsAuthProvider(
            cert_path=cert_path, key_path=key_path, verify_ssl=False
        )
        assert provider.csrf_token is None


# -- TestMtlsAuthPfx ----------------------------------------------------------


class TestMtlsAuthPfx:
    def test_client_kwargs_pfx(self, pfx_bundle: str):
        provider = MtlsAuthProvider(pfx_path=pfx_bundle, verify_ssl=False)
        kw = provider.client_kwargs()
        assert "verify" in kw
        assert isinstance(kw["verify"], ssl.SSLContext)

    def test_pfx_with_password(self, pfx_bundle_encrypted: str):
        provider = MtlsAuthProvider(
            pfx_path=pfx_bundle_encrypted,
            pfx_password="pfx-secret",
            verify_ssl=False,
        )
        kw = provider.client_kwargs()
        assert isinstance(kw["verify"], ssl.SSLContext)

    def test_pfx_verify_ssl_false(self, pfx_bundle: str):
        provider = MtlsAuthProvider(pfx_path=pfx_bundle, verify_ssl=False)
        ctx = provider.client_kwargs()["verify"]
        assert ctx.check_hostname is False
        assert ctx.verify_mode == ssl.CERT_NONE

    def test_invalid_pfx_password(self, pfx_bundle_encrypted: str):
        with pytest.raises(ValueError, match="HORIZON_CLIENT_PFX"):
            MtlsAuthProvider(
                pfx_path=pfx_bundle_encrypted,
                pfx_password="wrong-password",
                verify_ssl=False,
            )

    def test_missing_pfx_file(self):
        with pytest.raises(FileNotFoundError, match="HORIZON_CLIENT_PFX"):
            MtlsAuthProvider(pfx_path="/nonexistent/client.p12", verify_ssl=False)

    def test_temp_files_cleaned_immediately(self, pfx_bundle: str):
        """PFX temp files are wiped right after SSLContext loads  -  not deferred."""
        provider = MtlsAuthProvider(pfx_path=pfx_bundle, verify_ssl=False)
        # Temp dir should already be cleaned up after __init__
        assert provider._temp_dir is None

    def test_cleanup_idempotent(self, pfx_bundle: str):
        provider = MtlsAuthProvider(pfx_path=pfx_bundle, verify_ssl=False)
        provider.cleanup()  # Already cleaned, should not raise
        provider.cleanup()  # Again  -  should not raise


# -- TestPlaySessionAuth -------------------------------------------------------


class TestPlaySessionAuth:
    def test_init_starts_expired(self):
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")
        assert provider._expired is True
        assert provider._session_cookie is None

    def test_init_accepts_custom_timeout(self):
        provider = PlaySessionAuthProvider(
            horizon_url="https://horizon.test", login_timeout=60
        )
        assert provider._login_timeout == 60

    async def test_get_headers_with_cookie(self):
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")
        provider._session_cookie = "abc123"
        provider._expired = False
        headers = await provider.get_headers()
        assert headers == {"Cookie": "PLAY_SESSION=abc123"}

    async def test_get_headers_includes_csrf_cookie(self):
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")
        provider._session_cookie = "abc123"
        provider._csrf_token_value = "csrf-xyz"
        provider._expired = False
        headers = await provider.get_headers()
        assert headers == {
            "Cookie": "PLAY_SESSION=abc123; csrf-token=csrf-xyz"
        }

    async def test_get_headers_no_cookie_raises(self):
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")
        with pytest.raises(RuntimeError, match="No Play session"):
            await provider.get_headers()

    async def test_mark_auth_failed_sets_expired(self):
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")
        provider._expired = False
        provider._session_cookie = "abc123"
        await provider.mark_auth_failed()
        assert provider._expired is True

    def test_csrf_token_property(self):
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")
        assert provider.csrf_token is None
        provider._csrf_token_value = "csrf-abc"
        assert provider.csrf_token == "csrf-abc"

    async def test_playwright_import_error(self):
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")
        with patch.object(
            PlaySessionAuthProvider,
            "_check_playwright_available",
            side_effect=ImportError(
                "Play session auth requires Playwright."
            ),
        ):
            with pytest.raises(ImportError, match="Play session auth requires Playwright"):
                await provider.refresh_if_needed()

    async def test_refresh_triggers_acquire_when_expired(self):
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")
        provider._acquire_session = AsyncMock()  # type: ignore[method-assign]
        await provider.refresh_if_needed()
        provider._acquire_session.assert_called_once()

    async def test_refresh_skips_when_not_expired(self):
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")
        provider._expired = False
        provider._session_cookie = "abc123"
        provider._acquire_session = AsyncMock()  # type: ignore[method-assign]
        await provider.refresh_if_needed()
        provider._acquire_session.assert_not_called()

    async def test_navigation_error_wraps_with_context(self):
        """Playwright navigation failure wraps with connectivity hint."""
        provider = PlaySessionAuthProvider(
            horizon_url="https://unreachable.invalid"
        )

        # Mock Playwright to simulate a navigation error
        mock_page = AsyncMock()
        mock_page.goto = AsyncMock(
            side_effect=Exception("net::ERR_NAME_NOT_RESOLVED")
        )
        mock_context = AsyncMock()
        mock_context.pages = [mock_page]
        mock_context.close = AsyncMock()

        with patch.object(
            PlaySessionAuthProvider, "_launch_persistent_context",
            return_value=mock_context,
        ):
            with patch.object(
                PlaySessionAuthProvider, "_check_playwright_available",
            ):
                with patch("shutil.rmtree"):
                    with patch("tempfile.mkdtemp", return_value="/tmp/fake"):
                        with pytest.raises(ConnectionError, match="Failed to navigate"):
                            await provider._acquire_session()

    async def test_browser_closed_before_login(self):
        """Simulate browser closed (TargetClosedError) during cookie wait."""
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")

        mock_context = AsyncMock()
        mock_context.cookies = AsyncMock(
            side_effect=Exception("Target closed")
        )
        mock_page = MagicMock()
        mock_page.url = "https://horizon.test/ui"

        with pytest.raises(RuntimeError, match="Browser closed before login"):
            await provider._wait_for_authenticated_session(
                mock_context, mock_page, None, 5
            )

    async def test_wait_skips_pre_auth_session(self):
        """Cookie polling ignores the initial pre-auth PLAY_SESSION value."""
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")

        pre_auth_value = "pre-auth-verifier-cookie"
        post_auth_value = "authenticated-session"

        # First call returns pre-auth value, second returns post-auth
        call_count = 0

        async def mock_cookies(urls=None):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                return [{"name": "PLAY_SESSION", "value": pre_auth_value}]
            return [{"name": "PLAY_SESSION", "value": post_auth_value}]

        mock_context = AsyncMock()
        mock_context.cookies = mock_cookies
        mock_page = MagicMock()
        mock_page.url = "https://horizon.test/ui"

        result = await provider._wait_for_authenticated_session(
            mock_context, mock_page, pre_auth_value, 10
        )
        assert result == post_auth_value

    async def test_oidc_code_verifier_error_triggers_retry(self):
        """When OIDC code verifier expires, the flow retries with SSO cookies."""
        from horizon_mcp.auth.play_session import _OidcFlowError

        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")

        # First call: page URL shows the code verifier error
        # Second call: page URL is clean, PLAY_SESSION appears
        attempt = 0

        async def mock_cookies(urls=None):
            nonlocal attempt
            if attempt == 1:
                return [{"name": "PLAY_SESSION", "value": "pre-auth"}]
            if attempt == 2:
                # Second attempt succeeds
                return [
                    {"name": "PLAY_SESSION", "value": "authenticated-session"},
                    {"name": "csrf-token", "value": "csrf-xyz"},
                ]
            return []

        mock_context = AsyncMock()
        mock_context.cookies = mock_cookies
        mock_context.pages = []

        mock_page = AsyncMock()

        # Simulate: first attempt → error URL, second attempt → success
        goto_calls = 0

        async def mock_goto(url, **kwargs):
            nonlocal attempt, goto_calls
            goto_calls += 1
            attempt = goto_calls

        mock_page.goto = mock_goto
        mock_page.url = "https://horizon.test/ui"

        # On first attempt, _wait_for_authenticated_session raises _OidcFlowError
        # On second attempt, it succeeds
        wait_calls = 0
        original_wait = provider._wait_for_authenticated_session

        async def mock_wait(context, page, initial, timeout):
            nonlocal wait_calls
            wait_calls += 1
            if wait_calls == 1:
                raise _OidcFlowError("code verifier expired")
            return "authenticated-session"

        async def mock_new_page():
            return mock_page

        mock_context.new_page = mock_new_page

        provider._wait_for_authenticated_session = mock_wait  # type: ignore[method-assign]

        await provider._run_auth_flow_with_retry(mock_context)
        assert provider._session_cookie == "authenticated-session"
        assert wait_calls == 2

    async def test_oidc_error_detected_in_page_url(self):
        """_check_for_oidc_error detects code verifier expiry in URL."""
        from horizon_mcp.auth.play_session import _OidcFlowError

        mock_page = MagicMock()
        mock_page.url = (
            "https://horizon.test/api/v1/security/principals/authenticate"
            "?redirect=%2Fui&auth_error_detail=Unexpected+error+while+"
            "retrieving+code+verifier%3A+Code+verifier+not+found"
        )

        with pytest.raises(_OidcFlowError, match="code verifier expired"):
            PlaySessionAuthProvider._check_for_oidc_error(mock_page)

    async def test_oidc_error_not_raised_for_normal_url(self):
        """_check_for_oidc_error does nothing for normal URLs."""
        mock_page = MagicMock()
        mock_page.url = "https://horizon.test/ui#/ra"

        # Should not raise
        PlaySessionAuthProvider._check_for_oidc_error(mock_page)

    async def test_login_timeout_from_settings(self):
        """Verify factory passes login_timeout from settings."""
        settings = HorizonSettings(url="https://horizon.test", login_timeout=42)
        provider = create_auth_provider(settings)
        assert isinstance(provider, PlaySessionAuthProvider)
        assert provider._login_timeout == 42

    async def test_chromium_not_installed_error(self):
        """_launch_persistent_context wraps missing chromium with clear message."""
        provider = PlaySessionAuthProvider(horizon_url="https://horizon.test")

        mock_playwright = MagicMock()
        mock_playwright.chromium.launch_persistent_context = AsyncMock(
            side_effect=Exception(
                "Executable doesn't exist at /path/chromium"
            )
        )

        with pytest.raises(RuntimeError, match="Chromium browser not found"):
            await provider._launch_persistent_context(
                mock_playwright, "/tmp/fake"
            )


# -- TestAuthFactory -----------------------------------------------------------


class TestAuthFactory:
    def test_auto_detect_mtls_pem(self, pem_certs: tuple[str, str]):
        cert_path, key_path = pem_certs
        settings = HorizonSettings(
            url="https://horizon.test",
            client_cert=cert_path,
            client_key=key_path,
            verify_ssl=False,
        )
        provider = create_auth_provider(settings)
        assert isinstance(provider, MtlsAuthProvider)

    def test_auto_detect_mtls_pfx(self, pfx_bundle: str):
        settings = HorizonSettings(
            url="https://horizon.test",
            client_pfx=pfx_bundle,
            verify_ssl=False,
        )
        provider = create_auth_provider(settings)
        assert isinstance(provider, MtlsAuthProvider)

    def test_auto_detect_apikey(self):
        settings = HorizonSettings(
            url="https://horizon.test",
            api_id="test-id",
            api_key="test-key",
        )
        provider = create_auth_provider(settings)
        assert isinstance(provider, ApiKeyAuthProvider)

    def test_auto_detect_play_session_fallback(self):
        settings = HorizonSettings(url="https://horizon.test")
        provider = create_auth_provider(settings)
        assert isinstance(provider, PlaySessionAuthProvider)

    def test_mtls_priority_over_apikey(self, pem_certs: tuple[str, str]):
        cert_path, key_path = pem_certs
        settings = HorizonSettings(
            url="https://horizon.test",
            api_id="test-id",
            api_key="test-key",
            client_cert=cert_path,
            client_key=key_path,
            verify_ssl=False,
        )
        provider = create_auth_provider(settings)
        assert isinstance(provider, MtlsAuthProvider)

    def test_pem_without_key_raises(self, pem_certs: tuple[str, str]):
        cert_path, _ = pem_certs
        settings = HorizonSettings(
            url="https://horizon.test",
            client_cert=cert_path,
            verify_ssl=False,
        )
        with pytest.raises(ValueError, match="HORIZON_CLIENT_KEY is required"):
            create_auth_provider(settings)

    def test_pfx_and_pem_conflict_raises(self, pem_certs: tuple[str, str], pfx_bundle: str):
        cert_path, key_path = pem_certs
        settings = HorizonSettings(
            url="https://horizon.test",
            client_cert=cert_path,
            client_key=key_path,
            client_pfx=pfx_bundle,
            verify_ssl=False,
        )
        with pytest.raises(ValueError, match="not both"):
            create_auth_provider(settings)

    def test_apikey_without_key_raises(self):
        settings = HorizonSettings(
            url="https://horizon.test",
            api_id="test-id",
            api_key="",
        )
        with pytest.raises(ValueError, match="HORIZON_API_ID"):
            create_auth_provider(settings)

    def test_deprecated_auth_mode_warns(self, caplog: pytest.LogCaptureFixture):
        settings = HorizonSettings(
            url="https://horizon.test",
            api_id="test-id",
            api_key="test-key",
            auth_mode="apikey",
        )
        with caplog.at_level("WARNING", logger="horizon_mcp.auth"):
            provider = create_auth_provider(settings)
        assert isinstance(provider, ApiKeyAuthProvider)
        assert "deprecated" in caplog.text.lower()
