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
    async def simulate_computation_rule(
        rule: str,
        dictionary: dict,
        mode: str = "computation_rule",
    ) -> str:
        """Test a computation rule or template string against a dictionary.

        See horizon://knowledge/computation-and-data-flow for syntax and
        available functions.

        Safety tier: read-only

        Horizon has two expression types:

        **computation_rule** (default): Full expression language with functions.
        Used in profile certificate templates to compute field values.
        Examples:
            - ``Upper({{cn}})`` — uppercase the cn dictionary value
            - ``DomainDNS({{fqdn}})`` — extract parent domain
            - ``Concat({{a}}, "-", {{b}})`` — concatenate values
            - ``{{owner}}`` — simple dictionary lookup
            - ``OrElse({{prefix}}, "default")`` — fallback chain

        **template_string**: Simple text interpolation with ``{{key}}`` placeholders.
        Used in email templates, webhook URLs, notification bodies.
        Examples:
            - ``Hello {{name}}, your cert expires on {{certificate.not_after}}``
            - ``https://api.example.com/v1/{{certificate.serial}}``

        Args:
            rule: The expression to evaluate. For computation rules, use
                  function calls with ``{{key}}`` for dictionary lookups.
                  For template strings, use free text with ``{{key}}`` placeholders.
            dictionary: Key-value pairs available as variables during evaluation.
                        All values must be strings.
            mode: Expression type — "computation_rule" (default) or "template_string".

        Returns:
            JSON with the computed result including computedValueSingle,
            optionally computedValueMulti (for computation rules), and
            the merged dictionary used during evaluation.
        """
        valid_modes = {"computation_rule", "template_string"}
        if mode not in valid_modes:
            return json.dumps({
                "error": True,
                "content": f"Invalid mode '{mode}'. Must be one of: {', '.join(sorted(valid_modes))}.",
            })

        client = get_client()
        key = "computationRule" if mode == "computation_rule" else "templateString"
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
