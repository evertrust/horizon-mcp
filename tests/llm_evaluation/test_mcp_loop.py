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


# =========================================================================
# REST notifications knowledge (Tier 2 - LLM reasons from knowledge docs)
# =========================================================================


def test_rest_notification_lifecycle(mcp_config_path) -> None:
    """Claude creates a REST notification, lists it, and deletes it."""
    notif_name = f"{_PREFIX}-rest-notif"
    result = ask_claude(
        f"Create a REST notification named '{notif_name}' that fires on "
        "on_enroll and POSTs to https://httpbin.org/post with JSON body "
        "containing the certificate serial ({{{{certificate.serial}}}}) and CN "
        "({{{{certificate.subject.cn.1}}}}). Use no authentication, expect "
        "HTTP 200, timeout 30 seconds. "
        f"Then list triggers and confirm '{notif_name}' exists. "
        f"Finally, delete the trigger '{notif_name}'.",
        mcp_config_path,
        timeout=180,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert any(
        kw in text for kw in ["created", "trigger", notif_name.lower(), "deleted", "rest"]
    ), f"Expected trigger lifecycle output, got: {result['raw'][:300]}"


def test_rest_notification_deployment_knowledge(mcp_config_path) -> None:
    """Claude designs a REST notification for certificate deployment."""
    result = ask_claude(
        "I need to deploy certificates to our internal load balancer whenever "
        "a certificate is enrolled. The load balancer has a REST API at "
        "https://lb.internal/api/certs that accepts POST with JSON body "
        "containing 'domain', 'pem', and 'serial' fields. It uses bearer "
        "token auth. Show me the exact JSON to create this REST notification.",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert "rest" in text, f"Should mention REST type: {result['raw'][:300]}"
    assert any(
        kw in text for kw in ["sequence", "on_enroll", "bearer", "certificate.pem"]
    ), f"Expected REST notification JSON, got: {result['raw'][:300]}"


def test_rest_notification_oauth_chaining_knowledge(mcp_config_path) -> None:
    """Claude designs a multi-step REST notification with OAuth chaining."""
    result = ask_claude(
        "How do I build a REST notification that first obtains an OAuth "
        "token from https://auth.example.com/token using client credentials, "
        "then uses that token to push the certificate PEM and private key to "
        "https://api.example.com/certificates? The auth endpoint returns JSON "
        "with an access_token field. Show me the complete multi-step sequence.",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert len(text) > 200, f"Expected detailed explanation, got: {result['raw'][:200]}"
    assert any(
        kw in text for kw in ["rest.response.1", "access_token", "sequence"]
    ), f"Expected OAuth chaining pattern, got: {result['raw'][:300]}"


def test_rest_notification_dictionary_knowledge(mcp_config_path) -> None:
    """Claude correctly identifies available template variables."""
    result = ask_claude(
        "What template variables can I use in a REST notification payload? "
        "Specifically for a notification on the on_renew event, I need to "
        "include the new certificate's PEM, the old certificate's serial, "
        "and the certificate's first DNS SAN. Show me the exact keys to use.",
        mcp_config_path,
        timeout=120,
    )
    assert result["exit_code"] == 0
    text = result["text"]
    assert any(
        kw in text for kw in ["certificate.pem", "previous.certificate"]
    ), f"Expected dictionary keys, got: {result['raw'][:300]}"
    assert any(
        kw in text for kw in ["san.dnsname.1", "san.dnsname"]
    ), f"Expected SAN key format, got: {result['raw'][:300]}"


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
