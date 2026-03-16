"""Tool registration hub — wires all tool modules to the MCP server.

Provides two entry points:
    register_phase1_tools  — 96 tools for daily CLM operations + read-only visibility
    register_all_tools     — all 178 tools (Phase 1 + Phase 2 admin)
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


def register_all_tools(mcp: FastMCP) -> None:
    """Register all tool modules with the MCP server instance."""
    # v1 modules
    from horizon_mcp.tools.config import register_config_tools
    from horizon_mcp.tools.connectors import register_connector_tools
    from horizon_mcp.tools.triggers import register_trigger_tools
    from horizon_mcp.tools.profiles import register_profile_tools
    from horizon_mcp.tools.lifecycle import register_lifecycle_tools
    from horizon_mcp.tools.security import register_security_tools
    from horizon_mcp.tools.assist import register_assist_tools

    register_config_tools(mcp)
    register_connector_tools(mcp)
    register_trigger_tools(mcp)
    register_profile_tools(mcp)
    register_lifecycle_tools(mcp)
    register_security_tools(mcp)
    register_assist_tools(mcp)

    # v1.1 modules
    from horizon_mcp.tools.discovery import register_discovery_campaign_tools
    from horizon_mcp.tools.discovery_events import register_discovery_event_tools
    from horizon_mcp.tools.discovery_feed import register_discovery_feed_tools
    from horizon_mcp.tools.dashboards import register_dashboard_tools
    from horizon_mcp.tools.reports import register_report_tools
    from horizon_mcp.tools.archives import register_archive_tools
    from horizon_mcp.tools.automation import register_automation_tools
    from horizon_mcp.tools.local_identities import register_local_identity_tools
    from horizon_mcp.tools.wcce import register_wcce_tools
    from horizon_mcp.tools.scheduler import register_scheduler_tools
    from horizon_mcp.tools.system_config import register_system_config_tools
    from horizon_mcp.tools.analytics import register_analytics_tools

    register_discovery_campaign_tools(mcp)
    register_discovery_event_tools(mcp)
    register_discovery_feed_tools(mcp)
    register_dashboard_tools(mcp)
    register_report_tools(mcp)
    register_archive_tools(mcp)
    register_automation_tools(mcp)
    register_local_identity_tools(mcp)
    register_wcce_tools(mcp)
    register_scheduler_tools(mcp)
    register_system_config_tools(mcp)
    register_analytics_tools(mcp)
