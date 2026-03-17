"""Tier 1 — Tool selection: Does Claude Code pick the right tools?

Each scenario sends a question to Claude Code via `claude -p` with the MCP
server attached. We then check whether the response text mentions expected
tool names or relevant domain concepts.

Since `claude -p` executes tools automatically, we can't inspect raw tool_use
blocks. Instead we verify the *result* demonstrates the right tools were used:
- For tool-oriented questions: response should contain tool output patterns
- For knowledge questions: response should contain domain concepts

Requires: `claude` CLI on PATH + HORIZON_E2E_* env vars.
"""

from __future__ import annotations

import pytest

from tests.llm_evaluation.conftest import ask_claude
from tests.llm_evaluation.scenarios import TOOL_SELECTION_SCENARIOS, Scenario

pytestmark = pytest.mark.llm_evaluation


@pytest.mark.parametrize(
    "scenario",
    TOOL_SELECTION_SCENARIOS,
    ids=[s.description for s in TOOL_SELECTION_SCENARIOS],
)
def test_tool_selection(scenario: Scenario, mcp_config_path) -> None:
    """Send question to Claude Code, verify response is relevant."""
    # Prefix to prevent Claude from actually creating/modifying resources
    prefix = (
        "DO NOT create, modify, or delete anything. "
        "Just explain what tools and steps you would use. "
    )
    result = ask_claude(prefix + scenario.question, mcp_config_path, timeout=300)

    assert result["exit_code"] == 0, f"claude -p failed: {result.get('raw', '')[:500]}"

    text = result["text"]  # already lowercased

    if scenario.expected_tools:
        # Response should mention at least one expected tool or its action
        tool_indicators = []
        for tool in scenario.expected_tools:
            # Check both tool name and natural-language equivalents
            tool_indicators.append(tool.lower())
            # Also check key words from the tool name (e.g., "search_certificates" → "search", "certificates")
            tool_indicators.extend(tool.lower().replace("_", " ").split())

        assert any(
            indicator in text for indicator in tool_indicators
        ), (
            f"Expected response to mention tools {scenario.expected_tools} "
            f"but response was: {result['raw'][:300]}"
        )
    else:
        # Knowledge question — should have a substantive text response
        assert len(text) > 50, (
            f"Expected substantive response for knowledge question "
            f"'{scenario.question}', got: {result['raw'][:200]}"
        )
