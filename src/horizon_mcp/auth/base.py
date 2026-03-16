"""Abstract base class for Horizon authentication providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class AuthProvider(ABC):
    """Base authentication provider for Horizon API requests."""

    @abstractmethod
    async def get_headers(self) -> dict[str, str]:
        """Return authentication headers for an API request."""
        ...

    @abstractmethod
    async def refresh_if_needed(self) -> None:
        """Refresh credentials if expired. No-op for static auth."""
        ...

    def client_kwargs(self) -> dict[str, Any]:
        """Extra kwargs for httpx.AsyncClient construction.

        Override to inject transport-level config (e.g., verify=SSLContext for mTLS).
        """
        return {}

    def cleanup(self) -> None:  # noqa: B027
        """Release resources (e.g., temp files). Called during server shutdown."""

    async def mark_auth_failed(self) -> None:  # noqa: B027
        """Signal that authentication was rejected by the server.

        Override in providers that support re-authentication (e.g., Play Session).
        """

    @property
    def csrf_token(self) -> str | None:
        """Return a pre-captured CSRF token, or None.

        PlaySessionAuthProvider overrides this with the token captured during browser login.
        """
        return None
