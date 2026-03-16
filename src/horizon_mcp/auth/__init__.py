"""Authentication providers for Horizon API — auto-detection factory."""

from __future__ import annotations

import logging

from horizon_mcp.auth.apikey import ApiKeyAuthProvider
from horizon_mcp.auth.base import AuthProvider
from horizon_mcp.auth.mtls import MtlsAuthProvider
from horizon_mcp.auth.play_session import PlaySessionAuthProvider
from horizon_mcp.settings import HorizonSettings

logger = logging.getLogger("horizon_mcp.auth")


def create_auth_provider(settings: HorizonSettings) -> AuthProvider:
    """Factory: auto-detect auth mode from which env vars are set.

    Priority: mTLS (client cert) > API Key > OIDC browser session.
    """
    if settings.auth_mode:
        logger.warning(
            "HORIZON_AUTH_MODE is deprecated and ignored. "
            "Auth mode is now auto-detected from credentials."
        )

    # Priority 1: mTLS (client certificate)
    if settings.client_cert or settings.client_pfx:
        if settings.client_cert and settings.client_pfx:
            raise ValueError("Set HORIZON_CLIENT_CERT or HORIZON_CLIENT_PFX, not both.")
        if settings.client_cert and not settings.client_key:
            raise ValueError("HORIZON_CLIENT_KEY is required when HORIZON_CLIENT_CERT is set.")
        logger.info("Auth mode: mTLS (client certificate)")
        return MtlsAuthProvider(
            cert_path=settings.client_cert,
            key_path=settings.client_key,
            key_password=settings.client_key_password,
            pfx_path=settings.client_pfx,
            pfx_password=settings.client_pfx_password,
            verify_ssl=settings.verify_ssl,
        )

    # Priority 2: API Key
    if settings.api_id:
        logger.info("Auth mode: API Key")
        return ApiKeyAuthProvider(api_id=settings.api_id, api_key=settings.api_key)

    # Priority 3: Play Session browser login (fallback)
    logger.info("Auth mode: Play Session (browser login)")
    return PlaySessionAuthProvider(
        horizon_url=settings.base_url,
        verify_ssl=settings.verify_ssl,
        login_timeout=settings.login_timeout,
    )


__all__ = [
    "AuthProvider",
    "ApiKeyAuthProvider",
    "MtlsAuthProvider",
    "PlaySessionAuthProvider",
    "create_auth_provider",
]
