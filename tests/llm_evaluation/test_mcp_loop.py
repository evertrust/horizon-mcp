"""Tier 2  -  Full MCP loop tests via Claude Code.

These tests send prompts to `claude -p` with the MCP server attached and
verify that Claude actually executes tools against the live Horizon instance
and produces meaningful results.

Requires: `claude` CLI on PATH + HORIZON_E2E_* env vars.
"""

from __future__ import annotations

import uuid

import pytest

from tests.llm_evaluation.conftest import ask_claude

pytestmark = pytest.mark.llm_evaluation

_PREFIX = f"e2e-llm-{uuid.uuid4().hex[:6]}"


def test_search_flow(mcp_config_path) -> None:
    """Claude searches for certificates using HCQL."""
    result = ask_claude(
        "Find certificates expiring in the next 7 days. "
        "Show me the search results.",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    # Should mention certificates, expiry, or search results
    assert any(
        kw in text for kw in ["certificate", "expir", "search", "found", "result", "valid.until"]
    ), f"Expected certificate search output, got: {result['raw'][:300]}"


def test_dashboard_flow(mcp_config_path) -> None:
    """Claude creates a dashboard and adds a chart."""
    dash_name = f"{_PREFIX}-dash"
    result = ask_claude(
        f"Create a dashboard named '{dash_name}' and add a donut chart "
        "showing certificate status distribution. "
        f"Then delete the dashboard '{dash_name}' when done.",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert any(
        kw in text for kw in ["dashboard", "created", "chart", dash_name.lower()]
    ), f"Expected dashboard creation output, got: {result['raw'][:300]}"


def test_discovery_flow(mcp_config_path) -> None:
    """Claude creates a discovery campaign."""
    campaign_name = f"{_PREFIX}-campaign"
    result = ask_claude(
        f"Create a TLS scan discovery campaign named '{campaign_name}' "
        "targeting 127.0.0.1:443. "
        f"Then delete the campaign '{campaign_name}' when done.",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert any(
        kw in text for kw in ["campaign", "created", "discovery", campaign_name.lower()]
    ), f"Expected discovery campaign output, got: {result['raw'][:300]}"


def test_explain_flow(mcp_config_path) -> None:
    """Claude explains enrollment workflows using knowledge resources."""
    result = ask_claude(
        "Explain certificate enrollment workflows in Horizon. "
        "What are the different ways to enroll a certificate?",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert len(text) > 100, f"Expected substantive explanation, got: {result['raw'][:200]}"
    assert any(
        kw in text for kw in ["workflow", "enroll", "webra", "acme", "request", "profile", "scep", "est"]
    ), f"Expected workflow concepts in response, got: {result['raw'][:300]}"


# =========================================================================
# Datasource tools (Tier 2 - full MCP loop against live Horizon)
# =========================================================================


def test_dns_datasource_lifecycle(mcp_config_path) -> None:
    """Claude creates a DNS datasource, tests it, then cleans up."""
    ds_name = f"{_PREFIX}-dns"
    result = ask_claude(
        f"Create a DNS datasource named '{ds_name}' that looks up CNAME records "
        "for a hostname provided as {{hostname}}. Use record types cname only. "
        f"Then test it with hostname=www.microsoft.com. "
        f"Finally, delete the datasource '{ds_name}' when done. "
        "Show me the test results.",
        mcp_config_path,
        timeout=180,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert any(
        kw in text for kw in ["created", "datasource", ds_name.lower(), "cname", "success", "test"]
    ), f"Expected datasource lifecycle output, got: {result['raw'][:300]}"


def test_rest_datasource_test(mcp_config_path) -> None:
    """Claude tests a REST datasource against a public JSON API."""
    result = ask_claude(
        "Test a REST datasource (don't create it, just test it) with these settings: "
        "type rest, name test-httpbin, method GET, "
        "url https://httpbin.org/json, authenticationType noauth, "
        "timeout 10s, expected HTTP codes [200]. "
        "Show me what dictionary entries the JSON response produces.",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert any(
        kw in text for kw in ["slideshow", "dictionary", "success", "title", "author"]
    ), f"Expected REST test output with JSON fields, got: {result['raw'][:300]}"


def test_datasource_list(mcp_config_path) -> None:
    """Claude lists existing datasources."""
    result = ask_claude(
        "List all configured external datasources on this Horizon instance. "
        "Show me their names and types.",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert any(
        kw in text for kw in ["dns", "ldap", "rest", "datasource"]
    ), f"Expected datasource listing, got: {result['raw'][:300]}"


# =========================================================================
# Knowledge reasoning (Tier 2 - LLM generates correct answers from docs)
# =========================================================================


def test_validation_rule_syntax_knowledge(mcp_config_path) -> None:
    """Claude generates correct validation rule syntax from knowledge."""
    result = ask_claude(
        "Write a validation ruleset with 2 rules: "
        "1) all DNS SANs must end with .corp.local "
        "2) the requesting client IP must be in the 10.0.0.0/8 range. "
        "Both rules must pass. Show me the exact JSON.",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    # Must use correct syntax: "ends with" not "endsWith", square brackets for in
    assert "threshold" in text, f"Expected threshold in ruleset, got: {result['raw'][:300]}"
    # Should NOT contain camelCase syntax errors
    assert "endswith" not in text.replace("ends with", ""), (
        f"Used endsWith instead of 'ends with': {result['raw'][:300]}"
    )


def test_validation_module_support_knowledge(mcp_config_path) -> None:
    """Claude correctly identifies which modules support validation rules."""
    result = ask_claude(
        "Which Horizon profile modules support auto-validation rules? "
        "List them with their supported authorization modes. "
        "Also tell me which modules do NOT support them.",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    # Must mention the 3 supported modules
    assert "webra" in text, f"Should mention WebRA: {result['raw'][:300]}"
    assert any(kw in text for kw in ["scep", "est"]), (
        f"Should mention SCEP or EST: {result['raw'][:300]}"
    )
    # Must mention that ACME does NOT support validation rules
    assert "acme" in text, f"Should mention ACME (as unsupported): {result['raw'][:300]}"


def test_datasource_chaining_knowledge(mcp_config_path) -> None:
    """Claude understands datasource chaining for OAuth flows."""
    result = ask_claude(
        "I need to call an external REST API that requires OAuth "
        "client_credentials authentication. The API token endpoint returns "
        "a JSON with an access_token field. How would I set up datasources "
        "and a dsFlow in Horizon to first get the token, then call the API "
        "using that token? Explain the pattern.",
        mcp_config_path,
        timeout=180,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert len(text) > 200, f"Expected detailed explanation, got: {result['raw'][:200]}"
    # Should describe the two-datasource chaining pattern
    assert any(
        kw in text for kw in ["chain", "first", "token", "bearer", "ds.1", "ds.2", "access_token", "dsflow"]
    ), f"Expected OAuth chaining pattern, got: {result['raw'][:300]}"


def test_dictionary_entries_knowledge(mcp_config_path) -> None:
    """Claude correctly identifies dictionary entries by protocol."""
    result = ask_claude(
        "What dictionary entries are available during SCEP enrollment "
        "that are NOT available during WebRA enrollment? "
        "And vice versa - what does WebRA have that SCEP doesn't?",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert len(text) > 100, f"Expected detailed comparison, got: {result['raw'][:200]}"
    # Should mention protocol-specific entries
    assert any(
        kw in text for kw in ["scep.enroll", "webra.enroll", "principal"]
    ), f"Expected protocol-specific entries, got: {result['raw'][:300]}"
