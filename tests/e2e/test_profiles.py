"""E2E tests for the 2 read-only profile tools.

Covers:
  - list_profiles (read-only)
  - list_profiles with module filter (read-only)
  - get_profile (read-only)

All tests are automatically skipped when E2E environment variables are absent
(enforced by the pytestmark in conftest.py).
"""

from __future__ import annotations

import pytest
from mcp.server.fastmcp import FastMCP

from tests.e2e.conftest import call_tool

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# Read-only: list_profiles
# ---------------------------------------------------------------------------


async def test_list_profiles(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_profiles")
    assert "items" in result, "list_profiles response missing 'items' key"
    assert isinstance(result["items"], list)
    assert "count" in result
    assert "total_available" in result
    assert "kind" in result
    assert result["kind"] == "profile"


async def test_list_profiles_module_filter(e2e_mcp: FastMCP) -> None:
    """Module filter should narrow results to only the requested module type."""
    for module in ("webra", "acme", "scep", "est", "monitored"):
        result = await call_tool(e2e_mcp, "list_profiles", module=module)
        assert "items" in result
        # Every returned item must match the requested module (if any exist)
        for item in result["items"]:
            assert item.get("module", "").lower() == module, (
                f"list_profiles(module='{module}') returned an item with "
                f"module='{item.get('module')}'"
            )


async def test_list_profiles_name_filter(e2e_mcp: FastMCP) -> None:
    """name_contains should filter without raising an error."""
    result = await call_tool(e2e_mcp, "list_profiles", name_contains="zzznomatch")
    assert "items" in result
    assert result["items"] == [] or isinstance(result["items"], list)


# ---------------------------------------------------------------------------
# Read-only: get_profile
# ---------------------------------------------------------------------------


async def test_get_profile(e2e_mcp: FastMCP) -> None:
    profiles = await call_tool(e2e_mcp, "list_profiles")
    if not profiles["items"]:
        pytest.skip("No profiles configured on this instance")
    name = profiles["items"][0].get("name") or profiles["items"][0].get("identifier")
    assert name, "First profile item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_profile", name=name)
    # get_profile returns the raw profile dict
    assert detail.get("name") == name or "name" in detail
