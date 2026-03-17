"""Golden / snapshot tests for tool schemas and knowledge resource integrity.

These tests import the FastMCP instance *after* all tools and resources have
been registered (module-level side-effect in server.py) and verify:
  - Exact tool count and name enumeration (prevents drift)
  - Exact resource count and URI enumeration
  - Critical tool parameter schemas (spot-check, not full snapshot)
  - Tool description -> knowledge URI cross-references
  - Knowledge file non-emptiness and field alignment with tool schemas
"""

from __future__ import annotations

from pathlib import Path

import pytest

from horizon_mcp.server import mcp

# ---------------------------------------------------------------------------
# Accessors — one indirection so tests survive internal refactors of FastMCP
# ---------------------------------------------------------------------------

_tools = mcp._tool_manager._tools  # dict[str, Tool]
_resources = mcp._resource_manager._resources  # dict[str, Resource]

_KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "src" / "horizon_mcp" / "resources" / "knowledge"


# ===================================================================
# 1. Tool count test
# ===================================================================


def test_tool_count_is_62():
    """Exactly 62 tools must be registered on the main server —
    any addition or removal is intentional and must update this test."""
    assert len(_tools) == 62, (
        f"Expected 62 tools, got {len(_tools)}. "
        f"If you added or removed a tool, update this test and the "
        f"EXPECTED_TOOL_NAMES list in test_tool_name_enumeration."
    )


# ===================================================================
# 2. Tool name enumeration test
# ===================================================================

EXPECTED_TOOL_NAMES: list[str] = sorted([
    # --- 62 tools ---
    # assist/system.py (4)
    "whoami",
    "get_license_info",
    "explain_grading_policy",
    "explain_grading_ruleset",
    # assist/computation.py (2)
    "simulate_computation_rule",
    "simulate_datasource_flow",
    # assist/crypto.py (3)
    "decode_x509",
    "decode_csr",
    "detect_file",
    # assist/query.py (5)
    "validate_hcql",
    "validate_hrql",
    "validate_heql",
    "validate_hdql",
    "describe_query_fields",
    # assist/translate.py (1)
    "translate_to_hql",
    # lifecycle.py (17)
    "search_certificates",
    "export_certificates_csv",
    "get_certificate",
    "download_certificate",
    "get_request_template",
    "submit_request",
    "approve_request",
    "deny_request",
    "cancel_request",
    "search_requests",
    "get_request",
    "export_requests_csv",
    "search_events",
    "get_event",
    "export_events_csv",
    "aggregate_certificates",
    "aggregate_requests",
    # profiles.py — readonly (2)
    "list_profiles",
    "get_profile",
    # discovery.py (6)
    "list_discovery_campaigns",
    "get_discovery_campaign",
    "create_discovery_campaign",
    "update_discovery_campaign",
    "delete_discovery_campaign",
    "flush_discovery_campaign",
    # discovery_events.py (3)
    "search_discovery_events",
    "get_discovery_event",
    "export_discovery_events_csv",
    # discovery_feed.py (4)
    "start_discovery_feed_session",
    "feed_discovery_certificate",
    "register_discovery_event",
    "end_discovery_feed_session",
    # dashboards.py (12)
    "list_dashboards",
    "get_dashboard",
    "create_dashboard",
    "update_dashboard",
    "delete_dashboard",
    "add_dashboard_chart",
    "update_dashboard_chart",
    "remove_dashboard_chart",
    "list_saved_queries",
    "get_saved_query",
    "upsert_saved_query",
    "delete_saved_query",
    # reports.py (3)
    "list_reports",
    "download_report",
    "delete_report",
])


def test_tool_name_enumeration():
    """The complete sorted set of tool names must match exactly."""
    actual = sorted(_tools.keys())
    assert actual == EXPECTED_TOOL_NAMES, (
        f"Tool name drift detected.\n"
        f"  Added:   {sorted(set(actual) - set(EXPECTED_TOOL_NAMES))}\n"
        f"  Removed: {sorted(set(EXPECTED_TOOL_NAMES) - set(actual))}"
    )


# ===================================================================
# 3. Resource count test
# ===================================================================


def test_resource_count_is_12():
    """Exactly 12 knowledge resources must be registered."""
    assert len(_resources) == 12, (
        f"Expected 12 resources, got {len(_resources)}."
    )


# ===================================================================
# 4. Resource URI test
# ===================================================================

EXPECTED_RESOURCE_URIS: list[str] = sorted([
    "horizon://knowledge/profiles",
    "horizon://knowledge/computation-and-data-flow",
    "horizon://knowledge/workflows",
    "horizon://knowledge/query-languages",
    "horizon://knowledge/rbac",
    "horizon://knowledge/architecture",
    "horizon://knowledge/dictionary-matrix",
    "horizon://knowledge/discovery",
    "horizon://knowledge/automation",
    "horizon://knowledge/integrations",
    # v1.1 knowledge resources
    "horizon://knowledge/dashboards",
    "horizon://knowledge/system-admin",
])


def test_resource_uris():
    """All 12 resource URIs must match the expected list exactly."""
    actual = sorted(_resources.keys())
    assert actual == EXPECTED_RESOURCE_URIS, (
        f"Resource URI drift detected.\n"
        f"  Added:   {sorted(set(actual) - set(EXPECTED_RESOURCE_URIS))}\n"
        f"  Removed: {sorted(set(EXPECTED_RESOURCE_URIS) - set(actual))}"
    )


# ===================================================================
# 5. Critical tool schema snapshots (parameter spot-checks)
# ===================================================================


def _get_param_names(tool_name: str) -> set[str]:
    """Extract the set of parameter names from a tool's JSON schema."""
    tool = _tools[tool_name]
    props = tool.parameters.get("properties", {})
    return set(props.keys())


class TestCriticalToolSchemas:
    """Verify that critical tools expose the expected parameter names."""

    def test_search_certificates_params(self):
        params = _get_param_names("search_certificates")
        expected = {"query", "preset", "fields", "page_index", "page_size", "sorted_by", "with_count"}
        assert expected.issubset(params), (
            f"search_certificates missing params: {expected - params}"
        )

    def test_submit_request_params(self):
        params = _get_param_names("submit_request")
        expected = {"workflow", "profile", "module", "template", "data"}
        assert expected.issubset(params), (
            f"submit_request missing params: {expected - params}"
        )


# ===================================================================
# 6. Tool description -> knowledge URI reference tests
# ===================================================================


def _get_description(tool_name: str) -> str:
    """Return the full description string for a registered tool."""
    return _tools[tool_name].description


class TestToolDescriptionKnowledgeReferences:
    """Verify that representative tools reference the correct knowledge URIs."""

    def test_profile_tools_reference_profiles_knowledge(self):
        for tool_name in ("list_profiles", "get_profile"):
            desc = _get_description(tool_name)
            assert "horizon://knowledge/profiles" in desc, (
                f"{tool_name} description should reference horizon://knowledge/profiles"
            )

    def test_lifecycle_tools_reference_query_languages(self):
        for tool_name in ("search_certificates", "search_requests", "search_events"):
            desc = _get_description(tool_name)
            assert "horizon://knowledge/query-languages" in desc, (
                f"{tool_name} description should reference horizon://knowledge/query-languages"
            )

    def test_workflow_tools_reference_workflows(self):
        for tool_name in ("get_request_template", "submit_request"):
            desc = _get_description(tool_name)
            assert "horizon://knowledge/workflows" in desc, (
                f"{tool_name} description should reference horizon://knowledge/workflows"
            )

    def test_computation_tools_reference_computation_knowledge(self):
        desc = _get_description("simulate_computation_rule")
        assert "horizon://knowledge/computation-and-data-flow" in desc, (
            "simulate_computation_rule should reference computation-and-data-flow"
        )


# ===================================================================
# 7. Knowledge resource non-empty test
# ===================================================================

_KNOWLEDGE_FILES = [
    "profiles.md",
    "computation_and_data_flow.md",
    "workflows.md",
    "query_languages.md",
    "rbac.md",
    "architecture.md",
    "dictionary_matrix.md",
    "discovery.md",
    "automation.md",
    "integrations.md",
    # v1.1 knowledge resources
    "dashboards.md",
    "system_admin.md",
]


@pytest.mark.parametrize("filename", _KNOWLEDGE_FILES)
def test_knowledge_file_non_empty(filename: str):
    """Each knowledge file must exist and have more than 50 lines."""
    path = _KNOWLEDGE_DIR / filename
    assert path.exists(), f"Knowledge file not found: {path}"
    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) > 50, (
        f"{filename} has only {len(lines)} lines (expected >50)"
    )


# ===================================================================
# 8. Knowledge resource field alignment
# ===================================================================


class TestKnowledgeFieldAlignment:
    """Verify that key field names mentioned in knowledge resources appear
    in the corresponding tool parameter schemas."""

    def test_workflows_knowledge_mentions_workflow_types(self):
        """The workflows knowledge doc mentions the 7 workflow types, and the
        submit_request tool accepts a 'workflow' parameter."""
        knowledge_text = (_KNOWLEDGE_DIR / "workflows.md").read_text(encoding="utf-8")
        for wf in ("enroll", "revoke", "update", "recover", "migrate", "renew"):
            assert wf in knowledge_text, f"Workflow '{wf}' not found in workflows.md"
        params = _get_param_names("submit_request")
        assert "workflow" in params

    def test_query_languages_knowledge_mentions_hcql_fields(self):
        """The query-languages knowledge doc mentions key HCQL fields, and
        search_certificates accepts a 'query' parameter."""
        knowledge_text = (_KNOWLEDGE_DIR / "query_languages.md").read_text(encoding="utf-8")
        for field in ("dn", "serial", "profile", "module"):
            assert field in knowledge_text, (
                f"HCQL field '{field}' not found in query_languages.md"
            )
        params = _get_param_names("search_certificates")
        assert "query" in params
