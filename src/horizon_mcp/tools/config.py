"""Read-only configuration tools for Horizon MCP Server.

19 tools across 7 configuration domains:
  - CAs (5): list, get, CRL cache, trust chains (list + get)
  - Labels (2): list, get
  - HTTP Proxies (2): list, get
  - Datasources (3): list, get, simulate
  - Password Policies (3): list, get, generate
  - Grading Policies (2): list, get
  - Grading Rulesets (2): list, get

Every tool returns a JSON string containing both a human-readable summary
and structured data.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from horizon_mcp.client.state import get_client

logger = logging.getLogger("horizon_mcp.tools.config")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _extract_name(item: dict[str, Any]) -> str:
    """Extract the canonical name from a Horizon config object."""
    return item.get("name") or item.get("identifier") or item.get("_id") or "unknown"


def _filtered_list(
    items: list[dict[str, Any]],
    *,
    max_items: int,
    name_contains: str | None,
) -> dict[str, Any]:
    """Apply client-side name filter and truncation.

    Returns a dict with:
      - items: the (possibly filtered and truncated) list
      - truncated: bool indicating whether the list was capped
      - returned / total: counts
      - hint: present only when truncated
    """
    if name_contains:
        needle = name_contains.lower()
        items = [i for i in items if needle in _extract_name(i).lower()]

    total = len(items)
    truncated = total > max_items
    items = items[:max_items]

    result: dict[str, Any] = {
        "items": items,
        "returned": len(items),
        "total": total,
        "truncated": truncated,
    }
    if truncated:
        result["hint"] = "Increase max_items or use name_contains to narrow results."
    return result


def _list_summary(domain_label: str, data: dict[str, Any]) -> str:
    """Build human-readable summary for a list response."""
    parts = [f"Found {data['total']} {domain_label}(s)"]
    if data["truncated"]:
        parts.append(f" (showing first {data['returned']})")
    parts.append(".")
    names = [_extract_name(i) for i in data["items"]]
    if names:
        parts.append(" Names: ")
        parts.append(", ".join(names))
    return "".join(parts)


# ---------------------------------------------------------------------------
# Registration — read-only tools (19)
# ---------------------------------------------------------------------------

def register_config_readonly_tools(mcp: FastMCP) -> None:  # noqa: C901
    """Register the 19 read-only configuration tools on the given FastMCP instance."""

    # ===================================================================
    # CAs (5 read-only tools)
    # ===================================================================

    @mcp.tool()
    async def list_cas(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List certificate authorities configured in Horizon.

        Safety tier: read-only
        Related: horizon://knowledge/architecture

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Optional substring filter on CA name.
        """
        client = get_client()
        resp = await client.get("/api/v1/cas")
        items = resp if isinstance(resp, list) else resp.get("items", resp.get("content", []))
        if isinstance(items, dict):
            items = [items]
        data = _filtered_list(items, max_items=max_items, name_contains=name_contains)
        return json.dumps({"content": _list_summary("CA", data), **data})

    @mcp.tool()
    async def get_ca(name: str) -> str:
        """Get details of a specific certificate authority.

        Safety tier: read-only
        Related: horizon://knowledge/architecture

        Args:
            name: Exact CA name.
        """
        client = get_client()
        ca = await client.get(f"/api/v1/cas/{name}")
        return json.dumps({
            "content": f"CA '{name}': trusted_client_auth={ca.get('trustedForClientAuth')}, "
                       f"trusted_server_auth={ca.get('trustedForServerAuth')}",
            "data": ca,
        })

    @mcp.tool()
    async def get_crl_cache(ca_name: str | None = None) -> str:
        """Get CRL cache status, optionally for a specific CA.

        Safety tier: read-only
        Related: horizon://knowledge/architecture

        Args:
            ca_name: If provided, get CRL cache for this specific CA.
                     If omitted, get global CRL cache status.
        """
        client = get_client()
        if ca_name:
            path = f"/api/v1/caches/crls/{ca_name}"
            result = await client.get(path)
            return json.dumps({
                "content": f"CRL cache for CA '{ca_name}'.",
                "data": result,
            })
        else:
            result = await client.get("/api/v1/caches/crls")
            return json.dumps({
                "content": "Global CRL cache status.",
                "data": result,
            })

    @mcp.tool()
    async def list_trust_chains(max_items: int = 50) -> str:
        """List certificate trust chains.

        Safety tier: read-only
        Related: horizon://knowledge/architecture

        Args:
            max_items: Maximum items to return (default 50).
        """
        client = get_client()
        resp = await client.get("/api/v1/trustchains")
        items = resp if isinstance(resp, list) else resp.get("items", resp.get("content", []))
        if isinstance(items, dict):
            items = [items]
        data = _filtered_list(items, max_items=max_items, name_contains=None)
        return json.dumps({"content": _list_summary("trust chain", data), **data})

    @mcp.tool()
    async def get_trust_chain(name: str) -> str:
        """Get details of a specific certificate trust chain.

        Safety tier: read-only
        Related: horizon://knowledge/architecture

        Args:
            name: Exact trust chain name.
        """
        client = get_client()
        chain = await client.get(f"/api/v1/trustchains/{name}")
        cert_count = len(chain.get("certificates", chain.get("chain", [])))
        return json.dumps({
            "content": f"Trust chain '{name}': {cert_count} certificate(s).",
            "data": chain,
        })

    # ===================================================================
    # Labels (2 read-only tools)
    # ===================================================================

    @mcp.tool()
    async def list_labels(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List labels configured in Horizon.

        Safety tier: read-only
        Related: horizon://knowledge/profiles

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Optional substring filter on label name.
        """
        client = get_client()
        resp = await client.get("/api/v1/certificate/labels")
        items = resp if isinstance(resp, list) else resp.get("items", resp.get("content", []))
        if isinstance(items, dict):
            items = [items]
        data = _filtered_list(items, max_items=max_items, name_contains=name_contains)
        return json.dumps({"content": _list_summary("label", data), **data})

    @mcp.tool()
    async def get_label(name: str) -> str:
        """Get details of a specific label.

        Safety tier: read-only
        Related: horizon://knowledge/profiles

        Args:
            name: Exact label name.
        """
        client = get_client()
        label = await client.get(f"/api/v1/certificate/labels/{name}")
        display = label.get("displayName", name)
        return json.dumps({
            "content": f"Label '{name}' (display: '{display}').",
            "data": label,
        })

    # ===================================================================
    # HTTP Proxies (2 read-only tools)
    # ===================================================================

    @mcp.tool()
    async def list_http_proxies(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List HTTP proxies configured in Horizon.

        Safety tier: read-only
        Related: horizon://knowledge/integrations

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Optional substring filter on proxy name.
        """
        client = get_client()
        resp = await client.get("/api/v1/proxy/httpproxies")
        items = resp if isinstance(resp, list) else resp.get("items", resp.get("content", []))
        if isinstance(items, dict):
            items = [items]
        data = _filtered_list(items, max_items=max_items, name_contains=name_contains)
        return json.dumps({"content": _list_summary("HTTP proxy", data), **data})

    @mcp.tool()
    async def get_http_proxy(name: str) -> str:
        """Get details of a specific HTTP proxy.

        Safety tier: read-only
        Related: horizon://knowledge/integrations

        Args:
            name: Exact proxy name.
        """
        client = get_client()
        proxy = await client.get(f"/api/v1/proxy/httpproxies/{name}")
        host = proxy.get("host", "?")
        port = proxy.get("port", "?")
        return json.dumps({
            "content": f"HTTP proxy '{name}': {host}:{port}.",
            "data": proxy,
        })

    # ===================================================================
    # Datasources (3 read-only tools)
    # ===================================================================

    @mcp.tool()
    async def list_datasources(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List datasources configured in Horizon.

        Safety tier: read-only
        Related: horizon://knowledge/computation-and-data-flow

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Optional substring filter on datasource name.
        """
        client = get_client()
        resp = await client.get("/api/v1/datasources")
        items = resp if isinstance(resp, list) else resp.get("items", resp.get("content", []))
        if isinstance(items, dict):
            items = [items]
        data = _filtered_list(items, max_items=max_items, name_contains=name_contains)
        return json.dumps({"content": _list_summary("datasource", data), **data})

    @mcp.tool()
    async def get_datasource(name: str) -> str:
        """Get details of a specific datasource.

        Safety tier: read-only
        Related: horizon://knowledge/computation-and-data-flow

        Args:
            name: Exact datasource name.
        """
        client = get_client()
        ds = await client.get(f"/api/v1/datasources/{name}")
        ds_type = ds.get("type", "unknown")
        return json.dumps({
            "content": f"Datasource '{name}' (type: {ds_type}).",
            "data": ds,
        })

    @mcp.tool()
    async def simulate_datasource(
        name: str,
        context: dict[str, Any] | None = None,
    ) -> str:
        """Test/simulate a datasource with optional context parameters.

        Safety tier: read-only (non-mutating test call)
        Related: horizon://knowledge/computation-and-data-flow

        Args:
            name: Datasource name to test.
            context: Optional context dict with test input parameters.
                The keys correspond to the datasource's expected input variables.
                Example for a DNS datasource: {"hostname": "example.com"}.
                Example for an LDAP datasource: {"filter": "(cn=test)", "attributes": ["mail"]}.
        """
        client = get_client()
        payload: dict[str, Any] = {}
        if context is not None:
            payload["context"] = context

        payload["name"] = name
        result = await client.patch("/api/v1/datasources/", json=payload)
        success = result.get("success", result.get("status") == "ok")
        status_text = "succeeded" if success else "returned errors"
        return json.dumps({
            "content": f"Datasource '{name}' simulation {status_text}.",
            "data": result,
        })

    # ===================================================================
    # Password Policies (3 read-only tools)
    # ===================================================================

    @mcp.tool()
    async def list_password_policies(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List password policies configured in Horizon.

        Safety tier: read-only
        Related: horizon://knowledge/rbac

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Optional substring filter on policy name.
        """
        client = get_client()
        resp = await client.get("/api/v1/security/passwordpolicies")
        items = resp if isinstance(resp, list) else resp.get("items", resp.get("content", []))
        if isinstance(items, dict):
            items = [items]
        data = _filtered_list(items, max_items=max_items, name_contains=name_contains)
        return json.dumps({"content": _list_summary("password policy", data), **data})

    @mcp.tool()
    async def get_password_policy(name: str) -> str:
        """Get details of a specific password policy.

        Safety tier: read-only
        Related: horizon://knowledge/rbac

        Args:
            name: Exact password policy name.
        """
        client = get_client()
        policy = await client.get(f"/api/v1/security/passwordpolicies/{name}")
        min_len = policy.get("minLength", "?")
        max_len = policy.get("maxLength", "?")
        return json.dumps({
            "content": f"Password policy '{name}': length {min_len}-{max_len}.",
            "data": policy,
        })

    @mcp.tool()
    async def generate_password(policy_name: str) -> str:
        """Generate a random password using a specific password policy.

        Safety tier: read-only (generates but does not store)
        Related: horizon://knowledge/rbac

        Args:
            policy_name: Name of the password policy to use for generation.
        """
        client = get_client()
        result = await client.get(f"/api/v1/security/passwordpolicies/{policy_name}/generate")
        password = result.get("password", result.get("value", ""))
        # Truncate display for safety — show length only
        return json.dumps({
            "content": f"Password generated using policy '{policy_name}' "
                       f"({len(password)} characters).",
            "data": result,
        })

    # ===================================================================
    # Grading Policies (2 read-only tools)
    # ===================================================================

    @mcp.tool()
    async def list_grading_policies(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List certificate grading policies.

        Safety tier: read-only
        Related: horizon://knowledge/architecture

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Optional substring filter on policy name.
        """
        client = get_client()
        resp = await client.get("/api/v1/certificate/grading/policies")
        items = resp if isinstance(resp, list) else resp.get("items", resp.get("content", []))
        if isinstance(items, dict):
            items = [items]
        data = _filtered_list(items, max_items=max_items, name_contains=name_contains)
        return json.dumps({"content": _list_summary("grading policy", data), **data})

    @mcp.tool()
    async def get_grading_policy(name: str) -> str:
        """Get details of a specific certificate grading policy.

        Safety tier: read-only
        Related: horizon://knowledge/architecture

        Args:
            name: Exact grading policy name.
        """
        client = get_client()
        policy = await client.get(f"/api/v1/certificate/grading/policies/{name}")
        ruleset_count = len(policy.get("rulesets", policy.get("rules", [])))
        return json.dumps({
            "content": f"Grading policy '{name}': {ruleset_count} ruleset(s).",
            "data": policy,
        })

    # ===================================================================
    # Grading Rulesets (2 read-only tools)
    # ===================================================================

    @mcp.tool()
    async def list_grading_rulesets(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List certificate grading rulesets.

        Safety tier: read-only
        Related: horizon://knowledge/architecture

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Optional substring filter on ruleset name.
        """
        client = get_client()
        resp = await client.get("/api/v1/certificate/grading/rulesets")
        items = resp if isinstance(resp, list) else resp.get("items", resp.get("content", []))
        if isinstance(items, dict):
            items = [items]
        data = _filtered_list(items, max_items=max_items, name_contains=name_contains)
        return json.dumps({"content": _list_summary("grading ruleset", data), **data})

    @mcp.tool()
    async def get_grading_ruleset(name: str) -> str:
        """Get details of a specific certificate grading ruleset.

        Safety tier: read-only
        Related: horizon://knowledge/architecture

        Args:
            name: Exact grading ruleset name.
        """
        client = get_client()
        ruleset = await client.get(f"/api/v1/certificate/grading/rulesets/{name}")
        rule_count = len(ruleset.get("rules", []))
        return json.dumps({
            "content": f"Grading ruleset '{name}': {rule_count} rule(s).",
            "data": ruleset,
        })

