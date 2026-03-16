"""Phase split verification tests — ensure Phase 1 registration is correct.

Tests validate:
    1. Phase 1 registers exactly 96 tools (daily CLM ops + read-only config/security)
    2. Admin/destructive tools are excluded from Phase 1
    3. Expected read-only tools are present in Phase 1
"""

from __future__ import annotations

import pytest
from mcp.server.fastmcp import FastMCP

from horizon_mcp.tools import register_phase1_tools


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
# Phase 1 boundary tests
# ---------------------------------------------------------------------------

class TestPhase1Boundary:
    """Verify Phase 1 has exactly the right tools."""

    def test_phase1_tool_count(self) -> None:
        mcp = _make_mcp(register_phase1_tools)
        assert len(_tool_names(mcp)) == 96

    def test_phase1_excludes_admin_tools(self) -> None:
        names = _tool_names(_make_mcp(register_phase1_tools))
        admin_tools = [
            # Config admin
            "create_ca", "update_ca", "delete_ca",
            "create_label", "update_label", "delete_label",
            "create_http_proxy", "update_http_proxy", "delete_http_proxy",
            "create_datasource", "update_datasource", "delete_datasource",
            "create_password_policy", "update_password_policy", "delete_password_policy",
            # Security admin
            "create_role", "delete_role", "create_team", "delete_team",
            "create_principal", "delete_principal",
            "create_identity_provider", "delete_identity_provider",
            # Profile Phase 2
            "delete_profile",
            "create_wcce_profile", "create_crmp_profile",
            "create_intune_profile", "create_jamf_profile",
            # Connectors / Triggers
            "create_pki_connector", "create_trigger",
        ]
        for tool in admin_tools:
            assert tool not in names, f"Admin tool '{tool}' should not be in Phase 1"

    def test_phase1_includes_expected_readonly_tools(self) -> None:
        names = _tool_names(_make_mcp(register_phase1_tools))
        expected = [
            # Assist
            "whoami", "decode_x509", "validate_hcql",
            # Lifecycle
            "search_certificates", "get_certificate", "download_certificate",
            # Config readonly
            "list_cas", "get_ca", "list_labels", "get_label",
            "list_trust_chains", "get_trust_chain", "get_crl_cache",
            "list_grading_policies", "get_grading_policy",
            # Security readonly
            "list_roles", "get_role", "list_credentials", "get_credential",
            # Profiles phase1
            "list_profiles", "get_profile", "create_webra_profile",
            # Discovery
            "create_discovery_campaign",
            # Dashboards
            "list_dashboards", "create_dashboard",
            # Reports
            "list_reports",
            # Analytics
            "get_analytics",
        ]
        for tool in expected:
            assert tool in names, f"Expected tool '{tool}' missing from Phase 1"
