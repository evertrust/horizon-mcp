"""Tool registration hub  -  wires all tool modules to the MCP server.

Provides one entry point:
    register_tools   -  core CLM tools for certificate lifecycle operations
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP


def register_tools(mcp: FastMCP) -> None:
    """Register core CLM tools.

    62 tools across 8 domains  -  certificate lifecycle, discovery, dashboards,
    assist, profiles (read-only), reports.
    """
    # Assist (15 tools)
    from horizon_mcp.tools.assist import register_assist_tools

    register_assist_tools(mcp)

    # Lifecycle (17 tools)
    from horizon_mcp.tools.lifecycle import register_lifecycle_tools

    register_lifecycle_tools(mcp)

    # Dashboards (12 tools)
    from horizon_mcp.tools.dashboards import register_dashboard_tools

    register_dashboard_tools(mcp)

    # Discovery (6 tools)
    from horizon_mcp.tools.discovery import register_discovery_campaign_tools

    register_discovery_campaign_tools(mcp)

    # Discovery Events (3 tools)
    from horizon_mcp.tools.discovery_events import register_discovery_event_tools

    register_discovery_event_tools(mcp)

    # Discovery Feed (4 tools)
    from horizon_mcp.tools.discovery_feed import register_discovery_feed_tools

    register_discovery_feed_tools(mcp)

    # Reports (3 tools)
    from horizon_mcp.tools.reports import register_report_tools

    register_report_tools(mcp)

    # Profiles  -  read-only (2 tools)
    from horizon_mcp.tools.profiles import register_profile_readonly_tools

    register_profile_readonly_tools(mcp)
