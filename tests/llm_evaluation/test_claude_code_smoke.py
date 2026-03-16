"""Tier 3 — Claude Code smoke tests.

Quick sanity checks that Claude Code can discover and use Horizon MCP tools.
Uses the shared `mcp_config_path` fixture and `ask_claude` helper.

Requires: `claude` CLI on PATH + HORIZON_E2E_* env vars.
"""

from __future__ import annotations

import pytest

from tests.llm_evaluation.conftest import ask_claude

pytestmark = pytest.mark.llm_evaluation


def test_claude_code_lists_tools(mcp_config_path) -> None:
    """Claude Code mentions certificate tools when asked."""
    result = ask_claude(
        "What tools are available for certificate management?",
        mcp_config_path,
        timeout=60,
    )
    assert result["exit_code"] == 0
    assert "certificate" in result["text"], (
        f"Response did not mention certificates: {result['raw'][:300]}"
    )


def test_claude_code_hcql_query(mcp_config_path) -> None:
    """Claude Code understands HCQL when asked about expired certs."""
    result = ask_claude(
        "How do I query for expired certificates using HCQL?",
        mcp_config_path,
        timeout=60,
    )
    assert result["exit_code"] == 0
    assert any(
        kw in result["text"] for kw in ["status", "expired", "valid.until", "hcql"]
    ), f"Response did not mention HCQL concepts: {result['raw'][:300]}"
