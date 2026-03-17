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

        MANDATORY: Before writing ANY computation rule, you MUST read the
        knowledge resource horizon://knowledge/computation-and-data-flow.
        It contains the COMPLETE list of available functions, the exact syntax,
        and real-world PKI examples. DO NOT invent functions or syntax — only
        use what is documented in that resource.

        Safety tier: read-only

        Available functions (exhaustive list — no others exist):
            String: Upper, Lower, Trim, Substr, Concat, Extract, Replace, OrElse
            List: Filter, Slice, Sort, Split, Unique
            Parsing: ShortenDNS, DomainDNS, EmailUser, EmailDomain,
                     SamAccountNameUser, SamAccountNameDomain
            Date: DateTimeFormat
            Access: Get, First, Last, Join, Match
            Encoding: URLEncode, URLDecode, EscapeJson, JsonArray, DerAsBase64
            Special: NULL, NOW

        Syntax rules:
            - Dictionary lookups: ``{{key}}`` for single, ``[[key]]`` for multi
            - Functions wrap lookups: ``Upper({{cn}})``, NOT ``{{Upper(cn)}}``
            - Concat on arrays merges them: ``Concat([[a]], [[b]])`` → combined list
            - Concat with null returns null: use ``OrElse({{key}}, "")`` to guard
            - ``ShortenDNS`` extracts hostname: ``ShortenDNS({{fqdn}})`` → first DNS label
            - ``DomainDNS`` extracts domain: ``DomainDNS({{fqdn}})`` → parent domain
            - ``Sort`` alphabetically sorts a list
            - ``Unique`` deduplicates a list

        Two expression modes:

        **computation_rule** (default): Full expression language with functions.
            ``Upper({{cn}})`` — ``DomainDNS({{fqdn}})`` — ``Sort(Unique([[sans]]))``

        **template_string**: Text interpolation with embedded ``{{ }}`` blocks.
            ``Hello {{name}}, cert expires {{certificate.not_after}}``

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
