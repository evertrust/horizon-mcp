"""Shared test fixtures for Horizon MCP Server tests."""

from __future__ import annotations

import pytest
import respx
import httpx

from horizon_mcp.auth.apikey import ApiKeyAuthProvider
from horizon_mcp.client.http import HorizonClient
from horizon_mcp.settings import HorizonSettings


@pytest.fixture
def settings() -> HorizonSettings:
    """Test settings pointing to a mock server."""
    return HorizonSettings(
        url="https://horizon.test",
        api_id="test-id",
        api_key="test-key",
        verify_ssl=False,
        timeout=5,
        log_level="DEBUG",
    )


@pytest.fixture
def auth() -> ApiKeyAuthProvider:
    """Test API key auth provider."""
    return ApiKeyAuthProvider(api_id="test-id", api_key="test-key")


@pytest.fixture
async def client(settings: HorizonSettings, auth: ApiKeyAuthProvider) -> HorizonClient:
    """Create a HorizonClient for testing (must be used with respx mock)."""
    c = HorizonClient(settings, auth)
    yield c
    await c.close()


@pytest.fixture
def mock_api() -> respx.MockRouter:
    """Create a respx mock router for Horizon API calls."""
    with respx.mock(base_url="https://horizon.test") as router:
        yield router


# -- Common mock response factories ----------------------------------------

def make_list_response(items: list[dict], total: int | None = None) -> dict:
    """Create a standard list API response."""
    return items if total is None else {"items": items, "total": total}


def make_error_response(
    status: int, code: str, message: str, detail: str | None = None
) -> httpx.Response:
    """Create a mock error response."""
    body = {"error": code, "message": message}
    if detail:
        body["detail"] = detail
    return httpx.Response(status, json=body)


def make_principal_response(
    identifier: str = "test-admin",
    name: str = "Test Admin",
) -> dict:
    """Create a mock principal/self response."""
    return {
        "identifier": identifier,
        "name": name,
        "roles": ["admin"],
        "teams": [],
        "permissions": ["*"],
        "enabled": True,
    }
