"""Computation and datasource flow simulation tools.

2 tools for testing computation rule expressions and datasource flow
pipelines against sample data before deploying them in production profiles.

Knowledge resources:
    - horizon://knowledge/computation-and-data-flow
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.assist.computation")


def register_computation_tools(mcp: FastMCP) -> None:
    """Register computation simulation tools on *mcp*."""

    from horizon_mcp.client.state import get_client

    @mcp.tool()
    async def simulate_computation_rule(rule: str, dictionary: dict) -> str:
        """Test a computation rule expression against a dictionary of values.

        See horizon://knowledge/computation-and-data-flow for syntax and
        available functions.

        Safety tier: read-only

        Evaluates a Horizon computation rule template string using the
        provided dictionary as the variable context. Useful for verifying
        that DN templates, label expressions, or validation rules produce
        the expected output before embedding them in a profile.

        Args:
            rule: The computation rule expression to evaluate
                  (e.g., ``{{subject.cn}}`` or ``{{upper(owner)}}``).
            dictionary: Key-value pairs available as variables during
                        evaluation.

        Returns:
            JSON with the computed result from the Horizon template engine.
        """
        client = get_client()
        # The Horizon API distinguishes between templateString (Mustache-like
        # syntax e.g. {{owner}}) and computationRule (expression syntax).
        # Template strings contain {{ }} delimiters; computation rules do not.
        is_template = "{{" in rule
        key = "templateString" if is_template else "computationRule"
        result = await client.post(
            "/api/v1/templatestring/playground",
            json={key: rule, "dictionary": dictionary},
        )
        return json.dumps(result)

    @mcp.tool()
    async def simulate_datasource_flow(
        flow: list[dict],
        context: dict[str, Any] | None = None,
    ) -> str:
        """Test a datasource flow pipeline against an optional context.

        Safety tier: read-only

        Executes a datasource flow chain in test mode and returns the
        enriched dictionary. Each flow entry specifies a datasource name,
        input mappings, and an optional stop-on-success flag.

        Args:
            flow: Ordered list of flow entries. Each entry is a dict with
                  keys ``datasource`` (str), ``inputs`` (dict[str, str]),
                  and optionally ``stopOnSuccess`` (bool).
            context: Optional initial context dictionary providing seed
                     values for the flow evaluation.

        Returns:
            JSON with the enriched dictionary produced by the flow.
        """
        client = get_client()
        body: dict[str, Any] = {"flow": flow}
        if context is not None:
            body["context"] = context
        result = await client.post("/api/v1/datasources/flow/test", json=body)
        return json.dumps(result)
