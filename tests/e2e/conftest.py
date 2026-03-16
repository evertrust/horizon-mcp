"""E2E test configuration — fixtures for testing against a live Horizon instance.

Environment variables required:
    HORIZON_E2E_URL      — Base URL of the Horizon QA instance
    HORIZON_E2E_API_ID   — API key identifier
    HORIZON_E2E_API_KEY  — API key secret

All E2E tests are skipped if these are not set.
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any, AsyncIterator

import pytest
import pytest_asyncio
from mcp.server.fastmcp import FastMCP

from horizon_mcp.auth.apikey import ApiKeyAuthProvider
from horizon_mcp.client.http import HorizonClient
from horizon_mcp.client.state import clear_client, set_client
from horizon_mcp.settings import HorizonSettings
from horizon_mcp.tools import register_phase1_tools
from horizon_mcp.resources import register_all_resources


# ---------------------------------------------------------------------------
# Environment gating
# ---------------------------------------------------------------------------

E2E_URL = os.environ.get("HORIZON_E2E_URL", "")
E2E_API_ID = os.environ.get("HORIZON_E2E_API_ID", "")
E2E_API_KEY = os.environ.get("HORIZON_E2E_API_KEY", "")

_MISSING = not all([E2E_URL, E2E_API_ID, E2E_API_KEY])

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(_MISSING, reason="E2E env vars not set"),
]


# ---------------------------------------------------------------------------
# Unique prefix for resource names created during tests
# ---------------------------------------------------------------------------

E2E_PREFIX = f"e2e-{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="session")
async def e2e_client() -> AsyncIterator[HorizonClient]:
    """Create a real HorizonClient connected to the QA instance."""
    settings = HorizonSettings(
        url=E2E_URL,
        api_id=E2E_API_ID,
        api_key=E2E_API_KEY,
    )
    auth = ApiKeyAuthProvider(E2E_API_ID, E2E_API_KEY)
    client = HorizonClient(settings, auth)
    set_client(client)
    try:
        yield client
    finally:
        await client.close()
        clear_client()


@pytest_asyncio.fixture(scope="session")
async def e2e_mcp(e2e_client: HorizonClient) -> FastMCP:
    """FastMCP instance with Phase 1 tools + all resources registered."""
    mcp = FastMCP("e2e-test")
    register_phase1_tools(mcp)
    register_all_resources(mcp)
    return mcp


# ---------------------------------------------------------------------------
# Tool / resource call helpers
# ---------------------------------------------------------------------------

async def call_tool(mcp: FastMCP, tool_name: str, **kwargs: Any) -> dict[str, Any]:
    """Invoke an MCP tool and return the parsed JSON response.

    Raises AssertionError if the tool returns an error or unparseable content.
    """
    result = await mcp._tool_manager.call_tool(tool_name, kwargs)
    assert result and len(result) > 0, f"Tool '{tool_name}' returned empty result"

    text = result[0].text if hasattr(result[0], "text") else str(result[0])
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Some tools return plain text
        return {"raw": text}

    assert not data.get("error"), f"Tool '{tool_name}' returned error: {data}"
    return data


async def call_tool_raw(mcp: FastMCP, tool_name: str, **kwargs: Any) -> str:
    """Invoke an MCP tool and return the raw text response."""
    result = await mcp._tool_manager.call_tool(tool_name, kwargs)
    assert result and len(result) > 0, f"Tool '{tool_name}' returned empty result"
    return result[0].text if hasattr(result[0], "text") else str(result[0])


async def read_resource(mcp: FastMCP, uri: str) -> str:
    """Read an MCP resource by URI and return the text content."""
    result = await mcp._resource_manager.read_resource(uri)
    assert result, f"Resource '{uri}' returned empty result"
    if isinstance(result, list):
        return result[0].text if hasattr(result[0], "text") else str(result[0])
    return str(result)


# ---------------------------------------------------------------------------
# Factory fixtures — create/delete resources for test lifecycle
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def e2e_dashboard(e2e_mcp: FastMCP) -> AsyncIterator[dict[str, Any]]:
    """Create a test dashboard, yield it, then delete it."""
    name = f"{E2E_PREFIX}-dash"
    result = await call_tool(e2e_mcp, "create_dashboard", name=name)
    yield {"name": name, **result}
    try:
        await call_tool(e2e_mcp, "delete_dashboard", name=name, expected_name=name)
    except Exception:
        pass  # Best-effort cleanup


@pytest_asyncio.fixture
async def e2e_saved_query(e2e_mcp: FastMCP) -> AsyncIterator[dict[str, Any]]:
    """Create a test saved query, yield it, then delete it."""
    name = f"{E2E_PREFIX}-sq"
    result = await call_tool(
        e2e_mcp, "upsert_saved_query",
        name=name,
        query_type="HCQL",
        query="profile exists",
    )
    yield {"name": name, **result}
    try:
        await call_tool(e2e_mcp, "delete_saved_query", name=name, expected_name=name)
    except Exception:
        pass


@pytest_asyncio.fixture
async def e2e_discovery_campaign(
    e2e_mcp: FastMCP,
    e2e_client: HorizonClient,
) -> AsyncIterator[dict[str, Any]]:
    """Create a test discovery campaign, yield it, then delete via API."""
    name = f"{E2E_PREFIX}-campaign"
    result = await call_tool(
        e2e_mcp, "create_discovery_campaign",
        name=name,
        campaign_type="TLSSCAN",
        configuration={"targets": ["127.0.0.1:443"]},
    )
    yield {"name": name, **result}
    try:
        await call_tool(
            e2e_mcp, "delete_discovery_campaign",
            name=name,
            expected_name=name,
        )
    except Exception:
        pass
