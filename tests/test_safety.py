"""Tests verifying safety tier enforcement for Phase 1 tools.

Covers:
    1. Behavior-changing update tools include appropriate warnings in their descriptions
    2. Phase 1 profile update tools mention safety tiers
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.state import clear_client, set_client


# ---------------------------------------------------------------------------
# Test infrastructure
# ---------------------------------------------------------------------------

class ToolCollector:
    """A lightweight stand-in for FastMCP that captures tool registrations.

    When a module calls ``mcp.tool()(fn)`` or ``mcp.tool(description=...)(fn)``,
    this collector stores the function and its metadata in a dict keyed by
    function name.  This avoids any dependency on FastMCP internal attributes.
    """

    def __init__(self) -> None:
        self.tools: dict[str, dict[str, Any]] = {}

    def tool(self, fn=None, *, description: str | None = None, **kwargs: Any):
        """Mimic the ``@mcp.tool()`` decorator, capturing the function."""
        def decorator(f):
            self.tools[f.__name__] = {
                "fn": f,
                "description": description,
                "docstring": f.__doc__ or "",
                "kwargs": kwargs,
            }
            return f

        if fn is not None:
            return decorator(fn)
        return decorator

    def resource(self, uri: str | None = None, **kwargs: Any):
        """No-op for resource registrations that some modules may use."""
        def decorator(fn):
            return fn
        return decorator

    def get_tool_fn(self, name: str):
        """Retrieve a captured tool function by name."""
        return self.tools[name]["fn"]

    def get_description(self, name: str) -> str:
        """Get the effective description: explicit kwarg first, then docstring."""
        entry = self.tools[name]
        return entry["description"] or entry["docstring"] or ""

    def tool_names(self) -> set[str]:
        """Return all registered tool names."""
        return set(self.tools.keys())


@pytest.fixture
def mock_client() -> AsyncMock:
    """An AsyncMock pretending to be a HorizonClient."""
    client = AsyncMock()
    client.get = AsyncMock(return_value={})
    client.post = AsyncMock(return_value={})
    client.put = AsyncMock(return_value={})
    client.delete = AsyncMock(return_value={})
    set_client(client)
    yield client
    clear_client()


# ═══════════════════════════════════════════════════════════════════════════
# Phase 1 profile update tools mention behavior-changing
# ═══════════════════════════════════════════════════════════════════════════

class TestUpdateProfileToolWarnings:
    """Phase 1 update_*_profile tools should be marked behavior-changing."""

    def test_update_profile_tools_mention_behavior_changing(self):
        """All 5 Phase 1 update_*_profile tools should be marked behavior-changing."""
        from horizon_mcp.tools.profiles import register_profile_phase1_tools

        collector = ToolCollector()
        register_profile_phase1_tools(collector)

        update_profile_tools = [
            name for name in collector.tool_names()
            if name.startswith("update_") and name.endswith("_profile")
        ]
        # Phase 1 has 5 update_*_profile tools (webra, acme, scep, est, monitored)
        assert len(update_profile_tools) == 5, (
            f"Expected 5 update_*_profile tools, found {len(update_profile_tools)}: "
            f"{sorted(update_profile_tools)}"
        )

        for tool_name in sorted(update_profile_tools):
            desc = collector.get_description(tool_name)
            assert "behavior-changing" in desc.lower() or "mutating-destructive" in desc.lower(), (
                f"{tool_name} should mention 'behavior-changing' or 'mutating-destructive' "
                f"in its description, but got: {desc[:200]}"
            )


# ═══════════════════════════════════════════════════════════════════════════
# Phase 1 delete tool enumeration
# ═══════════════════════════════════════════════════════════════════════════

class TestPhase1DeleteToolEnumeration:
    """Verify the complete set of delete_* tools in Phase 1."""

    EXPECTED_DELETE_TOOLS = sorted([
        "delete_discovery_campaign",
        "delete_dashboard",
        "delete_saved_query",
        "delete_report",
    ])

    def test_phase1_delete_tools(self):
        """Phase 1 should only contain dashboard/discovery/report delete tools."""
        from horizon_mcp.tools import register_phase1_tools
        from mcp.server.fastmcp import FastMCP

        mcp = FastMCP("test")
        register_phase1_tools(mcp)
        registered_delete_tools = sorted(
            t.name for t in mcp._tool_manager.list_tools() if t.name.startswith("delete_")
        )
        assert registered_delete_tools == self.EXPECTED_DELETE_TOOLS, (
            f"Mismatch.\n"
            f"  Expected: {self.EXPECTED_DELETE_TOOLS}\n"
            f"  Got:      {registered_delete_tools}"
        )
