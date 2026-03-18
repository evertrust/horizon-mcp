"""API Key authentication provider (X-API-ID / X-API-KEY headers)."""

from __future__ import annotations

from horizon_mcp.auth.base import AuthProvider


class ApiKeyAuthProvider(AuthProvider):
    """Authenticate via static API ID and API Key headers."""

    def __init__(self, api_id: str, api_key: str) -> None:
        if not api_id or not api_key:
            raise ValueError(
                "HORIZON_API_ID and HORIZON_API_KEY must be set. "
                "See .env.example for configuration."
            )
        self._api_id = api_id
        self._api_key = api_key

    async def get_headers(self) -> dict[str, str]:
        return {"X-API-ID": self._api_id, "X-API-KEY": self._api_key}

    async def refresh_if_needed(self) -> None:
        pass  # Static credentials  -  nothing to refresh
