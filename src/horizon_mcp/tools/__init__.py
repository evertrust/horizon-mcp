"""Tool registration hub — wires all tool modules to the MCP server.

Provides one entry point:
    register_phase1_tools  — 96 tools for daily CLM operations + read-only visibility
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP


def register_phase1_tools(mcp: FastMCP) -> None:
    """Register Phase 1 tools: daily CLM operations + read-only config/security.

    96 tools across 11 domains — what a certificate operator/consumer needs.
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

    # Analytics (1 tool)
    from horizon_mcp.tools.analytics import register_analytics_tools

    register_analytics_tools(mcp)

    # Config — read-only subset (19 tools)
    from horizon_mcp.tools.config import register_config_readonly_tools

    register_config_readonly_tools(mcp)

    # Profiles — Phase 1 subset (12 tools)
    from horizon_mcp.tools.profiles import register_profile_phase1_tools

    register_profile_phase1_tools(mcp)

    # Security — read-only subset (4 tools)
    from horizon_mcp.tools.security import register_security_readonly_tools

    register_security_readonly_tools(mcp)
