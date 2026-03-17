"""Tool registration verification tests — ensure register_tools is correct.

Tests validate:
    1. register_tools registers exactly 62 tools (core CLM ops + read-only profiles)
    2. Admin/destructive tools are excluded
    3. Expected tools are present
"""

from __future__ import annotations

import pytest
from mcp.server.fastmcp import FastMCP

from horizon_mcp.tools import register_tools


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tool_names(mcp: FastMCP) -> set[str]:
    """Extract tool names from a FastMCP instance."""
    return {t.name for t in mcp._tool_manager.list_tools()}


def _make_mcp(register_fn) -> FastMCP:
    """Create a FastMCP instance with the given registration function applied."""
    mcp = FastMCP("test")
    register_fn(mcp)
    return mcp


# ---------------------------------------------------------------------------
# Boundary tests
# ---------------------------------------------------------------------------

class TestToolRegistrationBoundary:
    """Verify register_tools has exactly the right tools."""

    def test_tool_count(self) -> None:
        mcp = _make_mcp(register_tools)
        assert len(_tool_names(mcp)) == 63

    def test_excludes_admin_tools(self) -> None:
        names = _tool_names(_make_mcp(register_tools))
        admin_tools = [
            # Config admin (entire module removed)
            "list_cas", "get_ca", "create_ca", "update_ca", "delete_ca",
            "list_labels", "get_label", "create_label", "update_label", "delete_label",
            "create_http_proxy", "update_http_proxy", "delete_http_proxy",
            "create_datasource", "update_datasource", "delete_datasource",
            "create_password_policy", "update_password_policy", "delete_password_policy",
            # Security admin (entire module removed)
            "list_roles", "get_role",
            "create_role", "delete_role", "create_team", "delete_team",
            "create_principal", "delete_principal",
            "create_identity_provider", "delete_identity_provider",
            "list_credentials", "get_credential",
            # Analytics (removed)
            "get_analytics",
            # Profile create/update (removed)
            "create_webra_profile", "update_webra_profile",
            "create_acme_profile", "update_acme_profile",
            "create_scep_profile", "update_scep_profile",
            "create_est_profile", "update_est_profile",
            "create_monitored_profile", "update_monitored_profile",
            "delete_profile",
            "create_wcce_profile", "create_crmp_profile",
            "create_intune_profile", "create_jamf_profile",
            # Connectors / Triggers
            "create_pki_connector", "create_trigger",
        ]
        for tool in admin_tools:
            assert tool not in names, f"Tool '{tool}' should not be registered"

    def test_includes_expected_tools(self) -> None:
        names = _tool_names(_make_mcp(register_tools))
        expected = [
            # Assist
            "whoami", "decode_x509", "validate_hcql",
            # Lifecycle
            "search_certificates", "get_certificate", "download_certificate",
            # Profiles readonly
            "list_profiles", "get_profile",
            # Discovery
            "create_discovery_campaign",
            # Dashboards
            "list_dashboards", "create_dashboard",
            # Reports
            "list_reports",
        ]
        for tool in expected:
            assert tool in names, f"Expected tool '{tool}' missing"
