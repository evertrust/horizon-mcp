"""Global client state  -  avoids circular imports between server.py and tools."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from horizon_mcp.client.http import HorizonClient

_client: HorizonClient | None = None
_principal_name: str | None = None
_horizon_version: str | None = None


def get_client() -> HorizonClient:
    """Get the shared HorizonClient instance. Raises if not initialized."""
    if _client is None:
        raise RuntimeError("HorizonClient not initialized  -  server not started.")
    return _client


def set_client(client: HorizonClient) -> None:
    """Set the shared HorizonClient (called during server lifespan)."""
    global _client
    _client = client


def clear_client() -> None:
    """Clear the shared client (called during shutdown)."""
    global _client
    _client = None


def get_principal_name() -> str | None:
    """Get the authenticated principal name."""
    return _principal_name


def set_principal_name(name: str | None) -> None:
    global _principal_name
    _principal_name = name


def get_horizon_version() -> str | None:
    return _horizon_version


def set_horizon_version(version: str | None) -> None:
    global _horizon_version
    _horizon_version = version
