"""System introspection and grading tools.

4 tools for identity verification, license inspection, and grading
policy/ruleset explanation with optional certificate evaluation.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.assist.system")


def register_system_tools(mcp: FastMCP) -> None:
    """Register system introspection and grading tools on *mcp*."""

    from horizon_mcp.client.state import get_client

    @mcp.tool()
    async def whoami() -> str:
        """Return the authenticated principal's identity and permissions.

        Safety tier: read-only

        Fetches the current authenticated principal information from
        Horizon, including identifier, roles, teams, and permissions.
        Useful for verifying connectivity and understanding what the
        current API key or session can access.

        IMPORTANT — Ownership queries: When searching for "my certificates"
        or "certificates I own", use both the identifier AND team list from
        this response to build the HCQL query:
          owner equals "<identifier>" or team in ("<team1>", "<team2>", ...)
        This captures both direct ownership and indirect team-based ownership.
        See horizon://knowledge/query-languages for full ownership patterns.

        See also: search_certificates (use identifier + teams for ownership queries).

        Returns:
            JSON with principal identity, roles, teams, and permissions.
        """
        client = get_client()
        result = await client.get("/api/v1/security/principals/self")
        return json.dumps(result)

    @mcp.tool()
    async def get_license_info() -> str:
        """Return Horizon license information.

        Safety tier: read-only

        Fetches license details including licensed modules, expiry date,
        certificate quotas, and feature flags. Useful for understanding
        what capabilities are available on this Horizon instance.

        Returns:
            JSON with license details (modules, expiry, quotas, features).
        """
        client = get_client()
        result = await client.get("/api/v1/license")
        return json.dumps(result)

    @mcp.tool()
    async def explain_grading_policy(
        policy_name: str,
        certificate_pem: str | None = None,
    ) -> str:
        """Explain a grading policy and optionally evaluate a certificate against it.

        Safety tier: read-only

        Fetches the full grading policy definition (criteria, thresholds,
        grade mapping). If a certificate PEM is provided, also evaluates
        the certificate against the policy and returns the resulting grade
        with per-rule breakdown.

        Args:
            policy_name: Name of the grading policy to inspect.
            certificate_pem: Optional PEM-encoded certificate to evaluate
                             against the policy. When provided, the response
                             includes the grade result and per-rule details.

        Returns:
            JSON with policy definition and optionally the evaluation result.
        """
        client = get_client()
        encoded_name = quote(policy_name, safe="")

        policy = await client.get(f"/api/v1/grading/policies/{encoded_name}")

        response: dict[str, Any] = {"policy": policy}

        if certificate_pem is not None:
            evaluation = await client.post(
                f"/api/v1/grading/policies/{encoded_name}/evaluate",
                json={"pem": certificate_pem},
            )
            response["evaluation"] = evaluation

        return json.dumps(response)

    @mcp.tool()
    async def explain_grading_ruleset(
        ruleset_name: str,
        certificate_pem: str | None = None,
    ) -> str:
        """Explain a grading ruleset and optionally evaluate a certificate against it.

        Safety tier: read-only

        Fetches the full grading ruleset definition (individual rules,
        conditions, weights). If a certificate PEM is provided, also
        evaluates the certificate against the ruleset and returns the
        per-rule pass/fail breakdown.

        Args:
            ruleset_name: Name of the grading ruleset to inspect.
            certificate_pem: Optional PEM-encoded certificate to evaluate
                             against the ruleset. When provided, the response
                             includes per-rule evaluation results.

        Returns:
            JSON with ruleset definition and optionally the evaluation result.
        """
        client = get_client()
        encoded_name = quote(ruleset_name, safe="")

        ruleset = await client.get(f"/api/v1/grading/rulesets/{encoded_name}")

        response: dict[str, Any] = {"ruleset": ruleset}

        if certificate_pem is not None:
            evaluation = await client.post(
                f"/api/v1/grading/rulesets/{encoded_name}/evaluate",
                json={"pem": certificate_pem},
            )
            response["evaluation"] = evaluation

        return json.dumps(response)
