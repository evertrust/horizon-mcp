"""Certificate profile read-only tools — list and get profiles.

Safety tiers:
    - list_profiles, get_profile: read-only

References:
    - horizon://knowledge/profiles
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.tools._helpers import (
    apply_name_filter,
    build_list_response,
)

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.profiles")

_PROFILE_BASE = "/api/v1/certificate/profiles"


def _apply_module_filter(
    items: list[dict[str, Any]], module: str | None,
) -> list[dict[str, Any]]:
    """Client-side filter on the 'module' field (case-insensitive exact match)."""
    if not module:
        return items
    needle = module.lower()
    return [item for item in items if item.get("module", "").lower() == needle]


def register_profile_readonly_tools(mcp: FastMCP) -> None:
    """Register read-only profile tools: list and get (2 tools)."""

    from horizon_mcp.client.state import get_client

    @mcp.tool()
    async def list_profiles(
        max_items: int = 50,
        name_contains: str | None = None,
        module: str | None = None,
    ) -> str:
        """List certificate profiles with optional filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/profiles

        Client-side filtering is applied after fetching all profiles from
        the API. Use name_contains for substring search and module for
        exact module type matching.

        Args:
            max_items: Maximum number of profiles to return (default 50).
            name_contains: Case-insensitive substring filter on profile name.
            module: Filter by module type (webra, acme, scep, est, monitored).

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        data = await client.get(_PROFILE_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )
        items = apply_name_filter(items, name_contains)
        items = _apply_module_filter(items, module)
        return build_list_response(items, max_items, kind="profile")

    @mcp.tool()
    async def get_profile(name: str) -> str:
        """Get full details of a single certificate profile by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/profiles

        Args:
            name: Exact profile name.

        Returns:
            JSON representation of the profile including all configuration.
        """
        client = get_client()
        result = await client.get(f"{_PROFILE_BASE}/{name}")
        return json.dumps(result)
