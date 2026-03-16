"""Read-only security tools — roles and credentials listing.

4 read-only tools:
  - Roles (2): list, get
  - Credentials (2): list, get
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.client.state import get_client

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.security")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ROLES_BASE = "/api/v1/security/roles"
_CREDENTIALS_BASE = "/api/v1/security/credentials"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _truncation_meta(items: list[Any], max_items: int) -> dict[str, Any]:
    """Return truncation metadata if the result list was capped."""
    if len(items) > max_items:
        return {
            "truncated": True,
            "returned": max_items,
            "hint": f"Showing first {max_items} items. Increase max_items or use name_contains to narrow results.",
        }
    return {}


def _list_params(
    max_items: int,
    name_contains: str | None = None,
) -> dict[str, Any]:
    """Build query parameters for config-list endpoints."""
    params: dict[str, Any] = {"size": max_items + 1}
    if name_contains:
        params["search"] = name_contains
    return params


async def _fetch_list(
    path: str,
    max_items: int,
    name_contains: str | None = None,
) -> str:
    """Generic list-fetch: call GET, apply truncation, return JSON string."""
    client = get_client()
    params = _list_params(max_items, name_contains)
    raw = await client.get(path, params=params)

    # Horizon may return a list directly or wrap in a { content: [...] } envelope
    items: list[Any]
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict) and "content" in raw:
        items = raw["content"]
    else:
        # Single-item fallback (unlikely for list endpoints)
        items = [raw] if raw else []

    meta = _truncation_meta(items, max_items)
    items = items[:max_items]

    result: dict[str, Any] = {"items": items, "count": len(items)}
    if meta:
        result.update(meta)
    return json.dumps(result)


# ═══════════════════════════════════════════════════════════════════════════
# Registration — Read-Only (4 tools)
# ═══════════════════════════════════════════════════════════════════════════

def register_security_readonly_tools(mcp: FastMCP) -> None:
    """Register the 4 read-only security tools: list_roles, get_role, list_credentials, get_credential."""

    # ===================================================================
    # ROLES — read-only (2)
    # ===================================================================

    @mcp.tool(
        description=(
            "List Horizon RBAC roles. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def list_roles(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List roles, optionally filtering by name substring."""
        return await _fetch_list(_ROLES_BASE, max_items, name_contains)

    @mcp.tool(
        description=(
            "Get a single Horizon role by name, including its permissions. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def get_role(name: str) -> str:
        """Retrieve full details of a named role."""
        client = get_client()
        role = await client.get(f"{_ROLES_BASE}/{name}")
        return json.dumps(role)

    # ===================================================================
    # CREDENTIALS — read-only (2)
    # ===================================================================

    @mcp.tool(
        description=(
            "List Horizon credentials (read-only metadata). "
            "Credentials are read-only through this server. "
            "To create or manage credentials, use the Horizon UI. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def list_credentials(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List credentials metadata (never exposes secret values)."""
        return await _fetch_list(_CREDENTIALS_BASE, max_items, name_contains)

    @mcp.tool(
        description=(
            "Get a single Horizon credential by name. Returns type, description, "
            "expiry, and targets -- NOT secret values. "
            "Credentials are read-only through this server. "
            "To create or manage credentials, use the Horizon UI. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def get_credential(name: str) -> str:
        """Get credential metadata (never returns secret values)."""
        client = get_client()
        credential = await client.get(f"{_CREDENTIALS_BASE}/{name}")
        return json.dumps(credential)
