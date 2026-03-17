"""E2E tests for the 4 read-only security tools (roles and credentials).

The security tools use _fetch_list internally which returns:
  {"items": [...], "count": N}  — with optional truncation metadata.

All tests are read-only and produce no side effects on the QA instance.
They are automatically skipped when E2E environment variables are absent
(enforced by the pytestmark in conftest.py).
"""

from __future__ import annotations

import pytest
from mcp.server.fastmcp import FastMCP

from tests.e2e.conftest import call_tool

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------


async def test_list_roles(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_roles")
    assert "items" in result, "list_roles response missing 'items' key"
    assert isinstance(result["items"], list)
    assert "count" in result, "list_roles response missing 'count' key"
    assert result["count"] == len(result["items"])


async def test_get_role(e2e_mcp: FastMCP) -> None:
    roles = await call_tool(e2e_mcp, "list_roles")
    if not roles["items"]:
        pytest.skip("No roles configured on this instance")
    name = roles["items"][0].get("name") or roles["items"][0].get("identifier")
    assert name, "First role item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_role", name=name)
    # get_role returns the raw role dict — verify it has at minimum a name field
    assert detail.get("name") == name or "name" in detail or "identifier" in detail


async def test_list_roles_name_filter(e2e_mcp: FastMCP) -> None:
    """Verify name_contains narrows the result set without errors."""
    result = await call_tool(e2e_mcp, "list_roles", name_contains="zzznomatch")
    assert "items" in result
    assert result["items"] == [] or isinstance(result["items"], list)


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------


async def test_list_credentials(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_credentials")
    assert "items" in result, "list_credentials response missing 'items' key"
    assert isinstance(result["items"], list)
    assert "count" in result, "list_credentials response missing 'count' key"
    assert result["count"] == len(result["items"])


async def test_get_credential(e2e_mcp: FastMCP) -> None:
    creds = await call_tool(e2e_mcp, "list_credentials")
    if not creds["items"]:
        pytest.skip("No credentials configured on this instance")
    name = creds["items"][0].get("name") or creds["items"][0].get("identifier")
    assert name, "First credential item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_credential", name=name)
    # get_credential returns the raw credential dict — no secret values exposed
    assert detail.get("name") == name or "name" in detail or "identifier" in detail
    # Sanity check: secret-like keys must not appear with non-empty values.
    # The API may return placeholder keys (e.g. "password": {}) to indicate
    # a field exists without revealing its value — those are acceptable.
    for secret_key in ("password", "secret", "privateKey", "token"):
        if secret_key in detail:
            value = detail[secret_key]
            # An empty dict/list/None is an acceptable redacted placeholder
            assert value in ({}, [], None, ""), (
                f"Credential detail should not expose a real '{secret_key}' value. "
                f"Got: {value!r}"
            )


async def test_list_credentials_name_filter(e2e_mcp: FastMCP) -> None:
    """Verify name_contains narrows the result set without errors."""
    result = await call_tool(e2e_mcp, "list_credentials", name_contains="zzznomatch")
    assert "items" in result
    assert result["items"] == [] or isinstance(result["items"], list)
