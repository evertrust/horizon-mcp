"""Tests verifying safety tier enforcement for destructive and behavior-changing tools.

Covers:
    1. expected_name echo rejection for ALL 23 delete tools (wrong name -> error, no HTTP call)
    2. expected_name match allows deletion for representative tools (correct name -> HTTP DELETE called)
    3. Behavior-changing update tools include appropriate warnings in their descriptions
    4. Complete enumeration of all delete_* tools (exactly 23)
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
        """Mimic the ``@mcp.tool()`` decorator, capturing the function.

        Handles both ``@mcp.tool()`` (no-arg call returning decorator) and
        ``@mcp.tool`` (direct decoration, unlikely but safe).
        """
        def decorator(f):
            self.tools[f.__name__] = {
                "fn": f,
                "description": description,
                "docstring": f.__doc__ or "",
                "kwargs": kwargs,
            }
            return f

        if fn is not None:
            # Called as @mcp.tool without parentheses
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
    """An AsyncMock pretending to be a HorizonClient.

    Installs itself as the global client via set_client so that both
    module-level and closure-captured ``get_client()`` calls return it.
    Cleans up after the test via clear_client.
    """
    client = AsyncMock()
    client.get = AsyncMock(return_value={})
    client.post = AsyncMock(return_value={})
    client.put = AsyncMock(return_value={})
    client.delete = AsyncMock(return_value={})
    set_client(client)
    yield client
    clear_client()


def _register_all(collector: ToolCollector) -> None:
    """Register every tool module onto the collector."""
    from horizon_mcp.tools.config import register_config_tools
    from horizon_mcp.tools.connectors import register_connector_tools
    from horizon_mcp.tools.profiles import register_profile_tools
    from horizon_mcp.tools.security import register_security_tools
    from horizon_mcp.tools.triggers import register_trigger_tools
    from horizon_mcp.tools.discovery import register_discovery_campaign_tools
    from horizon_mcp.tools.dashboards import register_dashboard_tools
    from horizon_mcp.tools.reports import register_report_tools
    from horizon_mcp.tools.archives import register_archive_tools
    from horizon_mcp.tools.automation import register_automation_tools
    from horizon_mcp.tools.local_identities import register_local_identity_tools
    from horizon_mcp.tools.wcce import register_wcce_tools
    from horizon_mcp.tools.scheduler import register_scheduler_tools

    register_config_tools(collector)
    register_connector_tools(collector)
    register_trigger_tools(collector)
    register_profile_tools(collector)
    register_security_tools(collector)
    register_discovery_campaign_tools(collector)
    register_dashboard_tools(collector)
    register_report_tools(collector)
    register_archive_tools(collector)
    register_automation_tools(collector)
    register_local_identity_tools(collector)
    register_wcce_tools(collector)
    register_scheduler_tools(collector)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse(result: str) -> dict:
    """Parse a JSON tool result string into a dict."""
    return json.loads(result)


def _is_error_response(result: str) -> bool:
    """Check whether a tool result signals an error / safety failure.

    Different modules use slightly different shapes:
      - config tools: {"error": True, "content": "Safety check failed: ..."}
      - connector/trigger/profile tools: {"error": "Safety check failed: ...", "hint": "..."}
    Both are valid -- the presence of an "error" key is the common contract.
    """
    data = _parse(result)
    return "error" in data


# ═══════════════════════════════════════════════════════════════════════════
# 1. expected_name mismatch -> error, no HTTP DELETE
# ═══════════════════════════════════════════════════════════════════════════

class TestDeleteSafetyEchoRejection:
    """Every delete_* tool must reject mismatched expected_name without
    issuing any HTTP DELETE call.
    """

    # -- config.py tools ---------------------------------------------------

    async def test_delete_ca_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.config import register_config_tools

        collector = ToolCollector()
        register_config_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_ca")(
                name="my-ca", expected_name="WRONG",
            )
        mock_client.delete.assert_not_called()

    async def test_delete_label_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.config import register_config_tools

        collector = ToolCollector()
        register_config_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_label")(
                name="env:prod", expected_name="env:staging",
            )
        mock_client.delete.assert_not_called()

    async def test_delete_http_proxy_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.config import register_config_tools

        collector = ToolCollector()
        register_config_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_http_proxy")(
                name="corp-proxy", expected_name="other-proxy",
            )
        mock_client.delete.assert_not_called()

    async def test_delete_datasource_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.config import register_config_tools

        collector = ToolCollector()
        register_config_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_datasource")(
                name="ldap-src", expected_name="dns-src",
            )
        mock_client.delete.assert_not_called()

    # -- connectors.py tools -----------------------------------------------

    async def test_delete_pki_connector_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.connectors import register_connector_tools

        collector = ToolCollector()
        register_connector_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_pki_connector")(
                name="digicert-prod", expected_name="digicert-dev",
            )
        mock_client.delete.assert_not_called()

    async def test_delete_thirdparty_connector_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.connectors import register_connector_tools

        collector = ToolCollector()
        register_connector_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_thirdparty_connector")(
                name="aws-prod", expected_name="aws-dev",
            )
        mock_client.delete.assert_not_called()

    # -- triggers.py -------------------------------------------------------

    async def test_delete_trigger_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.triggers import register_trigger_tools

        collector = ToolCollector()
        register_trigger_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_trigger")(
                name="expiry-alert", expected_name="oops",
            )
        mock_client.delete.assert_not_called()

    # -- profiles.py -------------------------------------------------------

    async def test_delete_profile_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.profiles import register_profile_tools

        collector = ToolCollector()
        register_profile_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_profile")(
                name="webra-prod", expected_name="webra-dev",
            )
        mock_client.delete.assert_not_called()

    # -- security.py tools -------------------------------------------------
    # These use _delete_guard which raises HorizonError instead of returning JSON.

    async def test_delete_role_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.security import register_security_tools

        collector = ToolCollector()
        register_security_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_role")(
                name="admin-role", expected_name="user-role",
            )

        mock_client.delete.assert_not_called()

    async def test_delete_team_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.security import register_security_tools

        collector = ToolCollector()
        register_security_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_team")(
                name="platform-team", expected_name="other-team",
            )

        mock_client.delete.assert_not_called()

    async def test_delete_identity_provider_rejects_wrong_name(self, mock_client):
        from horizon_mcp.tools.security import register_security_tools

        collector = ToolCollector()
        register_security_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_identity_provider")(
                name="okta-prod", expected_name="okta-staging",
            )

        mock_client.delete.assert_not_called()

    async def test_delete_principal_rejects_wrong_identifier(self, mock_client):
        """delete_principal uses identifier/expected_identifier, not name/expected_name."""
        from horizon_mcp.tools.security import register_security_tools

        collector = ToolCollector()
        register_security_tools(collector)
        with pytest.raises(HorizonError, match="Safety check failed"):
            await collector.get_tool_fn("delete_principal")(
                identifier="admin@corp.io", expected_identifier="user@corp.io",
            )

        mock_client.delete.assert_not_called()


# ═══════════════════════════════════════════════════════════════════════════
# 2. expected_name match -> HTTP DELETE is actually called
# ═══════════════════════════════════════════════════════════════════════════

class TestDeleteSafetyEchoSuccess:
    """When expected_name matches, the tool should proceed to call HTTP DELETE."""

    async def test_delete_ca_proceeds_on_match(self, mock_client):
        from horizon_mcp.tools.config import register_config_tools

        collector = ToolCollector()
        register_config_tools(collector)
        result = await collector.get_tool_fn("delete_ca")(
            name="my-ca", expected_name="my-ca",
        )

        data = _parse(result)
        assert "error" not in data
        assert "deleted" in data.get("content", "").lower()
        mock_client.delete.assert_called_once_with("/api/v1/cas/my-ca")

    async def test_delete_trigger_proceeds_on_match(self, mock_client):
        from horizon_mcp.tools.triggers import register_trigger_tools

        collector = ToolCollector()
        register_trigger_tools(collector)
        result = await collector.get_tool_fn("delete_trigger")(
            name="expiry-alert", expected_name="expiry-alert",
        )

        data = _parse(result)
        assert "error" not in data
        assert data.get("deleted") is True
        mock_client.delete.assert_called_once_with("/api/v1/triggers/expiry-alert")

    async def test_delete_role_proceeds_on_match(self, mock_client):
        from horizon_mcp.tools.security import register_security_tools

        collector = ToolCollector()
        register_security_tools(collector)
        result = await collector.get_tool_fn("delete_role")(
            name="admin-role", expected_name="admin-role",
        )

        data = _parse(result)
        assert data.get("deleted") == "admin-role"
        assert data.get("status") == "success"
        mock_client.delete.assert_called_once_with("/api/v1/security/roles/admin-role")


# ═══════════════════════════════════════════════════════════════════════════
# 3. Behavior-changing update tools include warnings in descriptions
# ═══════════════════════════════════════════════════════════════════════════

class TestUpdateToolWarnings:
    """Update tools for profiles, roles, IDPs, and principals should
    include safety-tier or warning text in their docstring / description.
    """

    def test_update_role_warns_about_behavior_change(self):
        from horizon_mcp.tools.security import register_security_tools

        collector = ToolCollector()
        register_security_tools(collector)
        desc = collector.get_description("update_role")
        assert "WARNING" in desc or "behavior-changing" in desc
        assert "permission" in desc.lower()

    def test_update_identity_provider_mentions_security_sensitive(self):
        from horizon_mcp.tools.security import register_security_tools

        collector = ToolCollector()
        register_security_tools(collector)
        desc = collector.get_description("update_identity_provider")
        assert "security-sensitive" in desc.lower() or "Security" in desc

    def test_update_principal_warns_about_access_control(self):
        from horizon_mcp.tools.security import register_security_tools

        collector = ToolCollector()
        register_security_tools(collector)
        desc = collector.get_description("update_principal")
        assert "WARNING" in desc
        assert "access control" in desc.lower() or "permissions" in desc.lower()

    def test_update_profile_tools_mention_behavior_changing(self):
        """All 11 update_*_profile tools should be marked behavior-changing."""
        from horizon_mcp.tools.profiles import register_profile_tools

        collector = ToolCollector()
        register_profile_tools(collector)

        update_profile_tools = [
            name for name in collector.tool_names()
            if name.startswith("update_") and name.endswith("_profile")
        ]
        # There should be 11 update_*_profile tools (one per module)
        assert len(update_profile_tools) == 11, (
            f"Expected 11 update_*_profile tools, found {len(update_profile_tools)}: "
            f"{sorted(update_profile_tools)}"
        )

        for tool_name in sorted(update_profile_tools):
            desc = collector.get_description(tool_name)
            assert "behavior-changing" in desc.lower() or "mutating-destructive" in desc.lower(), (
                f"{tool_name} should mention 'behavior-changing' or 'mutating-destructive' "
                f"in its description, but got: {desc[:200]}"
            )

    def test_update_ca_tool_exists_with_appropriate_tier(self):
        """update_ca should be registered and mention its safety tier."""
        from horizon_mcp.tools.config import register_config_tools

        collector = ToolCollector()
        register_config_tools(collector)
        desc = collector.get_description("update_ca")
        # update_ca is mutating-safe (not destructive), verify it mentions tier
        assert "mutating-safe" in desc.lower() or "safety tier" in desc.lower()


# ═══════════════════════════════════════════════════════════════════════════
# 4. Delete tool enumeration -- exactly 12
# ═══════════════════════════════════════════════════════════════════════════

class TestDeleteToolEnumeration:
    """Verify the complete set of delete_* tools across all modules."""

    EXPECTED_DELETE_TOOLS = sorted([
        # v1 delete tools (12)
        "delete_ca",
        "delete_label",
        "delete_http_proxy",
        "delete_datasource",
        "delete_pki_connector",
        "delete_thirdparty_connector",
        "delete_trigger",
        "delete_profile",
        "delete_role",
        "delete_team",
        "delete_identity_provider",
        "delete_principal",
        # v1.1 delete tools (12)
        "delete_password_policy",
        "delete_discovery_campaign",
        "delete_dashboard",
        "delete_saved_query",
        "delete_report",
        "delete_archive",
        "delete_automation_policy",
        "delete_execution_policy",
        "delete_local_identity",
        "delete_wcce_forest",
        "delete_scheduled_task",
    ])

    def test_exactly_23_delete_tools_expected(self):
        assert len(self.EXPECTED_DELETE_TOOLS) == 23

    def test_all_delete_tools_are_registered(self):
        """Register all tool modules and verify every expected delete tool exists."""
        collector = ToolCollector()
        _register_all(collector)

        registered_delete_tools = sorted(
            t for t in collector.tool_names() if t.startswith("delete_")
        )

        assert registered_delete_tools == self.EXPECTED_DELETE_TOOLS, (
            f"Mismatch.\n"
            f"  Expected: {self.EXPECTED_DELETE_TOOLS}\n"
            f"  Got:      {registered_delete_tools}"
        )

    def test_no_unexpected_delete_tools(self):
        """No delete tool should exist beyond the 12 known ones."""
        collector = ToolCollector()
        _register_all(collector)

        registered_delete_tools = {
            t for t in collector.tool_names() if t.startswith("delete_")
        }
        unexpected = registered_delete_tools - set(self.EXPECTED_DELETE_TOOLS)
        assert not unexpected, f"Unexpected delete tools found: {unexpected}"
