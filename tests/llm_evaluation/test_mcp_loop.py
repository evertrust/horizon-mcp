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
