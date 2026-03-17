"""Tests verifying safety tier enforcement for registered tools.

Covers:
    1. Delete tool enumeration — only dashboard/discovery/report delete tools exist
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from horizon_mcp.tools import register_tools


# ---------------------------------------------------------------------------
# Test infrastructure (also imported by test_translate.py)
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


# ═══════════════════════════════════════════════════════════════════════════
# Delete tool enumeration
# ═══════════════════════════════════════════════════════════════════════════

class TestDeleteToolEnumeration:
    """Verify the complete set of delete_* tools."""

    EXPECTED_DELETE_TOOLS = sorted([
        "delete_discovery_campaign",
        "delete_dashboard",
        "delete_saved_query",
        "delete_report",
    ])

    def test_delete_tools(self):
        """Only dashboard/discovery/report delete tools should be registered."""
        mcp = FastMCP("test")
        register_tools(mcp)
        registered_delete_tools = sorted(
            t.name for t in mcp._tool_manager.list_tools() if t.name.startswith("delete_")
        )
        assert registered_delete_tools == self.EXPECTED_DELETE_TOOLS, (
            f"Mismatch.\n"
            f"  Expected: {self.EXPECTED_DELETE_TOOLS}\n"
            f"  Got:      {registered_delete_tools}"
        )
