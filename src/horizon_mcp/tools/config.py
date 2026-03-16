"""Configuration CRUD tools for Horizon MCP Server.

34 tools across 7 configuration domains:
  - CAs (8): list, get, create, update, delete, CRL cache, trust chains
  - Labels (5): list, get, create, update, delete
  - HTTP Proxies (5): list, get, create, update, delete
  - Datasources (6): list, get, create, update, delete, simulate
  - Password Policies (6): list, get, generate, create, update, delete
  - Grading Policies (2): list, get
  - Grading Rulesets (2): list, get

Every tool returns a JSON string containing both a human-readable summary
and structured data.  Update tools use the GET->strip->merge->PUT pattern
via `to_update_payload`.  Delete tools require an `expected_name` echo for
safety (mutating-destructive tier).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.models.payloads import to_update_payload
from horizon_mcp.client.state import get_client
from horizon_mcp.tools._helpers import build_mutate_response, delete_guard

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


# ---------------------------------------------------------------------------
# Registration — admin (CUD) tools (15)
# ---------------------------------------------------------------------------

def register_config_admin_tools(mcp: FastMCP) -> None:  # noqa: C901
    """Register the 15 mutating/destructive configuration tools on the given FastMCP instance."""

    # ===================================================================
    # CAs (3 admin tools)
    # ===================================================================

    @mcp.tool()
    async def create_ca(
        certificate: str,
        trusted_for_client_auth: bool = False,
        trusted_for_server_auth: bool = False,
        responder_url: str | None = None,
        crl_url: str | None = None,
        refresh: bool = True,
        outdated_revocation_status_policy: str | None = None,
        timeout: int | None = None,
        proxy: str | None = None,
    ) -> str:
        """Import a certificate authority into Horizon.

        Safety tier: mutating-safe
        Prerequisites: HTTP proxy must exist if referenced (use list_http_proxies to verify).
        See also: list_trust_chains (CAs form trust chains), get_crl_cache (check revocation status).
        Related: horizon://knowledge/architecture

        Args:
            certificate: PEM-encoded CA certificate.
            trusted_for_client_auth: Trust this CA for client authentication.
            trusted_for_server_auth: Trust this CA for server authentication.
            responder_url: OCSP responder URL.
            crl_url: CRL distribution point URL.
            refresh: Whether to refresh CRL/OCSP caches after import.
            outdated_revocation_status_policy: Policy for outdated revocation info.
            timeout: Custom timeout for revocation checks (seconds).
            proxy: HTTP proxy name to use for revocation checks.
        """
        client = get_client()

        # Preflight: validate proxy exists if provided
        if proxy:
            try:
                await client.get(f"/api/v1/proxy/httpproxies/{proxy}")
            except HorizonError as proxy_exc:
                if proxy_exc.status_code == 404:
                    raise HorizonError(
                        status_code=422,
                        error_code="PREFLIGHT-DEP",
                        message=f"Proxy '{proxy}' not found.",
                        remediation="Use list_http_proxies to see available proxies, "
                                    "or create it first with create_http_proxy.",
                    ) from proxy_exc
                raise

        payload: dict[str, Any] = {
            "certificate": certificate,
            "trustedForClientAuth": trusted_for_client_auth,
            "trustedForServerAuth": trusted_for_server_auth,
            "refresh": refresh,
        }
        if responder_url is not None:
            payload["responderUrl"] = responder_url
        if crl_url is not None:
            payload["crlUrl"] = crl_url
        if outdated_revocation_status_policy is not None:
            payload["outdatedRevocationStatusPolicy"] = outdated_revocation_status_policy
        if timeout is not None:
            payload["timeout"] = timeout
        if proxy is not None:
            payload["proxy"] = proxy

        result = await client.post("/api/v1/cas", json=payload)
        ca_name = _extract_name(result)
        return build_mutate_response(action="created", kind="ca", name=ca_name, data=result)

    @mcp.tool()
    async def update_ca(
        name: str,
        trusted_for_client_auth: bool | None = None,
        trusted_for_server_auth: bool | None = None,
        responder_url: str | None = None,
        crl_url: str | None = None,
        outdated_revocation_status_policy: str | None = None,
        timeout: int | None = None,
        proxy: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update a certificate authority using GET->strip->merge->PUT.

        Safety tier: mutating-safe
        Related: horizon://knowledge/architecture

        Args:
            name: Exact CA name.
            trusted_for_client_auth: Update client auth trust setting.
            trusted_for_server_auth: Update server auth trust setting.
            responder_url: New OCSP responder URL.
            crl_url: New CRL URL.
            outdated_revocation_status_policy: New policy for outdated revocation info.
            timeout: New timeout for revocation checks.
            proxy: New HTTP proxy name.
            clear_fields: Field names to explicitly set to null (e.g. ["responderUrl"]).
        """
        client = get_client()
        existing = await client.get(f"/api/v1/cas/{name}")

        overrides: dict[str, Any] = {}
        if trusted_for_client_auth is not None:
            overrides["trustedForClientAuth"] = trusted_for_client_auth
        if trusted_for_server_auth is not None:
            overrides["trustedForServerAuth"] = trusted_for_server_auth
        if responder_url is not None:
            overrides["responderUrl"] = responder_url
        if crl_url is not None:
            overrides["crlUrl"] = crl_url
        if outdated_revocation_status_policy is not None:
            overrides["outdatedRevocationStatusPolicy"] = outdated_revocation_status_policy
        if timeout is not None:
            overrides["timeout"] = timeout
        if proxy is not None:
            overrides["proxy"] = proxy

        payload = to_update_payload(
            existing, overrides=overrides, clear_fields=clear_fields, domain="ca",
        )
        result = await client.put("/api/v1/cas/", json=payload)
        return build_mutate_response(action="updated", kind="ca", name=name, data=result)

    @mcp.tool()
    async def delete_ca(name: str, expected_name: str) -> str:
        """Delete a certificate authority. Requires name confirmation for safety.

        Safety tier: mutating-destructive
        Related: horizon://knowledge/architecture

        Args:
            name: CA name to delete.
            expected_name: Must match 'name' exactly — safety confirmation.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"/api/v1/cas/{name}")
        return json.dumps({"content": f"CA '{name}' deleted successfully."})

    # ===================================================================
    # Labels (3 admin tools)
    # ===================================================================

    @mcp.tool()
    async def create_label(
        name: str,
        display_name: str | None = None,
        description: str | None = None,
    ) -> str:
        """Create a new label.

        Safety tier: mutating-safe

        IMPORTANT: Label name is IMMUTABLE (primary key). Always ask the
        user for both name and display_name before creating.

        See also: create_*_profile (profiles define which labels are available),
            submit_request (labels are attached during enrollment).
        Related: horizon://knowledge/profiles

        Args:
            name: Label name (unique identifier, IMMUTABLE).
            display_name: Human-readable display name (mutable, shown in UI).
            description: Optional description.
        """
        client = get_client()
        payload: dict[str, Any] = {"name": name}
        if display_name is not None:
            payload["displayName"] = display_name
        if description is not None:
            payload["description"] = description

        result = await client.post("/api/v1/certificate/labels", json=payload)
        return build_mutate_response(action="created", kind="label", name=name, data=result)

    @mcp.tool()
    async def update_label(
        name: str,
        display_name: str | None = None,
        description: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update a label using GET->strip->merge->PUT.

        Safety tier: mutating-safe
        Related: horizon://knowledge/profiles

        Args:
            name: Exact label name.
            display_name: New display name.
            description: New description.
            clear_fields: Field names to explicitly set to null.
        """
        client = get_client()
        existing = await client.get(f"/api/v1/certificate/labels/{name}")

        overrides: dict[str, Any] = {}
        if display_name is not None:
            overrides["displayName"] = display_name
        if description is not None:
            overrides["description"] = description

        payload = to_update_payload(
            existing, overrides=overrides, clear_fields=clear_fields, domain="label",
        )
        result = await client.put("/api/v1/certificate/labels/", json=payload)
        return build_mutate_response(action="updated", kind="label", name=name, data=result)

    @mcp.tool()
    async def delete_label(name: str, expected_name: str) -> str:
        """Delete a label. Requires name confirmation for safety.

        Safety tier: mutating-destructive
        Related: horizon://knowledge/profiles

        Args:
            name: Label name to delete.
            expected_name: Must match 'name' exactly — safety confirmation.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"/api/v1/certificate/labels/{name}")
        return json.dumps({"content": f"Label '{name}' deleted successfully."})

    # ===================================================================
    # HTTP Proxies (3 admin tools)
    # ===================================================================

    @mcp.tool()
    async def create_http_proxy(
        name: str,
        host: str,
        port: int,
        credentials: str | None = None,
    ) -> str:
        """Create a new HTTP proxy.

        Safety tier: mutating-safe
        See also: create_ca (CAs can use proxies for revocation checks),
            create_pki_connector (connectors can route through proxies).
        Related: horizon://knowledge/integrations

        If credentials are provided, their existence is validated first
        (credential cross-cutting rule).

        Args:
            name: Proxy name (unique identifier).
            host: Proxy hostname or IP address.
            port: Proxy port number.
            credentials: Optional credential name for proxy authentication.
        """
        client = get_client()

        # Preflight: validate credential existence if provided
        if credentials:
            try:
                await client.get(f"/api/v1/security/credentials/{credentials}")
            except HorizonError as cred_exc:
                if cred_exc.status_code == 404:
                    raise HorizonError(
                        status_code=422,
                        error_code="PREFLIGHT-DEP",
                        message=f"Credential '{credentials}' not found.",
                        remediation="Credentials must be created outside this MCP server "
                                    "(via the Horizon UI or API).",
                    ) from cred_exc
                raise

        payload: dict[str, Any] = {
            "name": name,
            "host": host,
            "port": port,
        }
        if credentials is not None:
            payload["credentials"] = credentials

        result = await client.post("/api/v1/proxy/httpproxies", json=payload)
        return build_mutate_response(action="created", kind="http_proxy", name=name, data=result)

    @mcp.tool()
    async def update_http_proxy(
        name: str,
        host: str | None = None,
        port: int | None = None,
        credentials: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an HTTP proxy using GET->strip->merge->PUT.

        Safety tier: mutating-safe
        Related: horizon://knowledge/integrations

        Args:
            name: Exact proxy name.
            host: New hostname or IP.
            port: New port number.
            credentials: New credential name.
            clear_fields: Field names to explicitly set to null (e.g. ["credentials"]).
        """
        client = get_client()

        # Preflight: validate credential existence if provided
        if credentials:
            try:
                await client.get(f"/api/v1/security/credentials/{credentials}")
            except HorizonError as cred_exc:
                if cred_exc.status_code == 404:
                    raise HorizonError(
                        status_code=422,
                        error_code="PREFLIGHT-DEP",
                        message=f"Credential '{credentials}' not found.",
                        remediation="Credentials must be created outside this MCP server "
                                    "(via the Horizon UI or API).",
                    ) from cred_exc
                raise

        existing = await client.get(f"/api/v1/proxy/httpproxies/{name}")

        overrides: dict[str, Any] = {}
        if host is not None:
            overrides["host"] = host
        if port is not None:
            overrides["port"] = port
        if credentials is not None:
            overrides["credentials"] = credentials

        payload = to_update_payload(
            existing, overrides=overrides, clear_fields=clear_fields, domain="proxy",
        )
        result = await client.put("/api/v1/proxy/httpproxies/", json=payload)
        return build_mutate_response(action="updated", kind="http_proxy", name=name, data=result)

    @mcp.tool()
    async def delete_http_proxy(name: str, expected_name: str) -> str:
        """Delete an HTTP proxy. Requires name confirmation for safety.

        Safety tier: mutating-destructive
        Related: horizon://knowledge/integrations

        Args:
            name: Proxy name to delete.
            expected_name: Must match 'name' exactly — safety confirmation.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"/api/v1/proxy/httpproxies/{name}")
        return json.dumps({"content": f"HTTP proxy '{name}' deleted successfully."})

    # ===================================================================
    # Datasources (3 admin tools)
    # ===================================================================

    @mcp.tool()
    async def create_datasource(
        name: str,
        type: str,
        configuration: dict[str, Any],
    ) -> str:
        """Create a new datasource.

        Safety tier: mutating-safe
        Prerequisites: Credential must exist if referenced in configuration.
        See also: simulate_datasource (test before using in profiles),
            horizon://knowledge/computation-and-data-flow.
        Related: horizon://knowledge/computation-and-data-flow

        Args:
            name: Datasource name (unique identifier).
            type: Datasource type — one of: dns, ldap, rest.
            configuration: Type-specific configuration dict. Structure varies by type:
                - dns: {"server": "...", "port": 53, ...}
                - ldap: {"url": "...", "baseDn": "...", "credentials": "...", ...}
                - rest: {"url": "...", "method": "GET", ...}
        """
        valid_types = {"dns", "ldap", "rest"}
        if type not in valid_types:
            return json.dumps({
                "error": True,
                "content": f"Invalid datasource type '{type}'. Must be one of: {', '.join(sorted(valid_types))}.",
            })

        client = get_client()

        # Preflight: validate credentials in config if present
        cred_name = configuration.get("credentials") or configuration.get("credential")
        if cred_name and isinstance(cred_name, str):
            try:
                await client.get(f"/api/v1/security/credentials/{cred_name}")
            except HorizonError as cred_exc:
                if cred_exc.status_code == 404:
                    raise HorizonError(
                        status_code=422,
                        error_code="PREFLIGHT-DEP",
                        message=f"Credential '{cred_name}' not found.",
                        remediation="Credentials must be created outside this MCP server "
                                    "(via the Horizon UI or API).",
                    ) from cred_exc
                raise

        payload: dict[str, Any] = {
            "name": name,
            "type": type,
            "configuration": configuration,
        }
        result = await client.post("/api/v1/datasources", json=payload)
        return build_mutate_response(action="created", kind="datasource", name=name, data=result)

    @mcp.tool()
    async def update_datasource(
        name: str,
        type: str | None = None,
        configuration: dict[str, Any] | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update a datasource using GET->strip->merge->PUT.

        Safety tier: mutating-safe
        Related: horizon://knowledge/computation-and-data-flow

        Args:
            name: Exact datasource name.
            type: New datasource type (rarely changed).
            configuration: New configuration dict (replaces entire configuration block).
            clear_fields: Field names to explicitly set to null.
        """
        client = get_client()
        existing = await client.get(f"/api/v1/datasources/{name}")

        overrides: dict[str, Any] = {}
        if type is not None:
            overrides["type"] = type
        if configuration is not None:
            overrides["configuration"] = configuration

        payload = to_update_payload(
            existing, overrides=overrides, clear_fields=clear_fields, domain="datasource",
        )
        result = await client.put("/api/v1/datasources/", json=payload)
        return build_mutate_response(action="updated", kind="datasource", name=name, data=result)

    @mcp.tool()
    async def delete_datasource(name: str, expected_name: str) -> str:
        """Delete a datasource. Requires name confirmation for safety.

        Safety tier: mutating-destructive
        Related: horizon://knowledge/computation-and-data-flow

        Args:
            name: Datasource name to delete.
            expected_name: Must match 'name' exactly — safety confirmation.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"/api/v1/datasources/{name}")
        return json.dumps({"content": f"Datasource '{name}' deleted successfully."})

    # ===================================================================
    # Password Policies (3 admin tools)
    # ===================================================================

    @mcp.tool()
    async def create_password_policy(
        name: str,
        configuration: dict[str, Any],
        description: str | None = None,
    ) -> str:
        """Create a new password policy.

        Safety tier: mutating-safe
        Related: horizon://knowledge/rbac

        Args:
            name: Password policy name (unique identifier).
            configuration: Policy configuration dict.
                Example: {"minLength": 12, "maxLength": 64, "requireUppercase": true,
                "requireLowercase": true, "requireDigit": true, "requireSpecialChar": true}.
                Use get_password_policy on an existing policy to see the full schema.
            description: Optional human-readable description.
        """
        client = get_client()
        payload: dict[str, Any] = {
            "name": name,
            "configuration": configuration,
        }
        if description is not None:
            payload["description"] = description

        result = await client.post(
            "/api/v1/security/passwordpolicies", json=payload,
        )
        return build_mutate_response(action="created", kind="password_policy", name=name, data=result)

    @mcp.tool()
    async def update_password_policy(
        name: str,
        configuration: dict[str, Any] | None = None,
        description: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update a password policy using GET->strip->merge->PUT.

        Safety tier: mutating-safe
        Related: horizon://knowledge/rbac

        Args:
            name: Exact password policy name.
            configuration: New configuration dict (replaces entire block).
            description: New description.
            clear_fields: Field names to explicitly set to null.
        """
        client = get_client()
        existing = await client.get(
            f"/api/v1/security/passwordpolicies/{name}",
        )

        overrides: dict[str, Any] = {}
        if configuration is not None:
            overrides["configuration"] = configuration
        if description is not None:
            overrides["description"] = description

        payload = to_update_payload(
            existing,
            overrides=overrides,
            clear_fields=clear_fields,
            domain="password_policy",
        )
        result = await client.put(
            "/api/v1/security/passwordpolicies/", json=payload,
        )
        return build_mutate_response(action="updated", kind="password_policy", name=name, data=result)

    @mcp.tool()
    async def delete_password_policy(
        name: str, expected_name: str,
    ) -> str:
        """Delete a password policy. Requires name confirmation for safety.

        IMPORTANT: Before executing this operation, always confirm
        the action with the end-user first.

        Safety tier: mutating-destructive
        Related: horizon://knowledge/rbac

        Args:
            name: Password policy name to delete.
            expected_name: Must match 'name' exactly — safety confirmation.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(
            f"/api/v1/security/passwordpolicies/{name}",
        )
        return json.dumps({
            "content": f"Password policy '{name}' deleted successfully.",
        })


# ---------------------------------------------------------------------------
# Composition
# ---------------------------------------------------------------------------

def register_config_tools(mcp: FastMCP) -> None:
    """Register all 34 configuration CRUD tools on the given FastMCP instance."""
    register_config_readonly_tools(mcp)
    register_config_admin_tools(mcp)
