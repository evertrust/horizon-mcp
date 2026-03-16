"""Discovery campaign management tools for Horizon MCP Server.

6 tools covering the full discovery campaign lifecycle:
  - list_discovery_campaigns: list with optional name filtering
  - get_discovery_campaign: fetch a single campaign by name
  - create_discovery_campaign: create a new campaign
  - update_discovery_campaign: GET-strip-merge-PUT update
  - delete_discovery_campaign: delete with safety echo
  - flush_discovery_campaign: flush (purge events) with safety echo

Knowledge resources:
    - horizon://knowledge/discovery
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.state import get_client
from horizon_mcp.tools._helpers import (
    apply_name_filter,
    build_list_response,
    build_mutate_response,
    delete_guard,
    get_strip_merge_put,
)

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.discovery")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_CAMPAIGN_BASE = "/api/v1/discovery/campaigns"

_VALID_ACCESS_LEVELS = frozenset({"everyone", "authenticated", "authorized"})


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_name(name: str) -> str | None:
    """Return an error JSON string if *name* contains a dot, else None.

    Discovery campaign names use DotlessNameIdentifier — dots are forbidden.
    """
    if "." in name:
        return json.dumps({
            "error": f"Invalid campaign name '{name}'.",
            "hint": "Campaign names cannot contain dots (DotlessNameIdentifier).",
        })
    return None


def _validate_authorization_levels(levels: dict[str, Any]) -> str | None:
    """Return an error JSON string if authorization_levels is malformed, else None.

    Expected shape:
        {"search": {"accessLevel": "...", ...}, "feed": {"accessLevel": "...", ...}}
    """
    for field in ("search", "feed"):
        section = levels.get(field)
        if not isinstance(section, dict):
            return json.dumps({
                "error": f"authorization_levels.{field} is required and must be an object.",
                "hint": (
                    "Each section needs at minimum an 'accessLevel' key with one of: "
                    f"{sorted(_VALID_ACCESS_LEVELS)}."
                ),
            })
        access = section.get("accessLevel")
        if access not in _VALID_ACCESS_LEVELS:
            return json.dumps({
                "error": f"Invalid accessLevel '{access}' in authorization_levels.{field}.",
                "valid_values": sorted(_VALID_ACCESS_LEVELS),
            })
    return None


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_discovery_campaign_tools(mcp: FastMCP) -> None:
    """Register all 6 discovery campaign management tools on *mcp*."""

    # ===================================================================
    # Read-only (2 tools)
    # ===================================================================

    @mcp.tool()
    async def list_discovery_campaigns(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List discovery campaigns with optional name filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/discovery

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on campaign name.

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        data = await client.get(_CAMPAIGN_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )
        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="discovery_campaign")

    @mcp.tool()
    async def get_discovery_campaign(name: str) -> str:
        """Get a single discovery campaign by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/discovery

        Args:
            name: Exact campaign name.

        Returns:
            JSON representation of the discovery campaign.
        """
        client = get_client()
        result = await client.get(f"{_CAMPAIGN_BASE}/{name}")
        return json.dumps(result)

    # ===================================================================
    # Mutating-safe (2 tools)
    # ===================================================================

    @mcp.tool()
    async def create_discovery_campaign(
        name: str,
        authorization_levels: dict,
        event_on_success: bool = True,
        event_on_warning: bool = True,
        event_on_failure: bool = True,
        enabled: bool = True,
        description: str | None = None,
        hosts: list[str] | None = None,
        ports: list[int] | None = None,
        grading_policies: list[str] | None = None,
    ) -> str:
        """Create a new discovery campaign.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/discovery

        Prerequisites: Grading policies must exist if referenced (use list_grading_policies).
            Identity providers in authorization_levels must exist (use list_identity_providers).
        See also: start_discovery_feed_session → feed_discovery_certificate → end_discovery_feed_session
            (manual feed workflow), search_discovery_events (view results).

        Campaign names cannot contain dots (DotlessNameIdentifier).

        authorization_levels must contain 'search' and 'feed' sections, each with:
          - accessLevel (required): "everyone", "authenticated", or "authorized"
          - enforcedIdentityProviders (optional): list of identity provider names

        Args:
            name: Unique campaign name (no dots allowed).
            authorization_levels: Access control for search and feed operations.
                Required shape: {"search": {"accessLevel": "authenticated"}, "feed": {"accessLevel": "authorized"}}.
                Valid accessLevel values: "everyone", "authenticated", "authorized".
                Optional per-section: "enforcedIdentityProviders": ["idp-name"].
            event_on_success: Generate events on successful scans (default true).
            event_on_warning: Generate events on scan warnings (default true).
            event_on_failure: Generate events on scan failures (default true).
            enabled: Whether the campaign is active (default true).
            description: Optional human-readable description.
            hosts: Optional list of hosts/IP ranges to scan.
            ports: Optional list of ports to scan.
            grading_policies: Optional list of grading policy names to apply.

        Returns:
            JSON with confirmation message and created campaign data.
        """
        name_err = _validate_name(name)
        if name_err is not None:
            return name_err

        auth_err = _validate_authorization_levels(authorization_levels)
        if auth_err is not None:
            return auth_err

        client = get_client()

        payload: dict[str, Any] = {
            "name": name,
            "authorizationLevels": authorization_levels,
            "eventOnSuccess": event_on_success,
            "eventOnWarning": event_on_warning,
            "eventOnFailure": event_on_failure,
            "enabled": enabled,
        }
        if description is not None:
            payload["description"] = description
        if hosts is not None:
            payload["hosts"] = hosts
        if ports is not None:
            payload["ports"] = ports
        if grading_policies is not None:
            payload["gradingPolicies"] = grading_policies

        result = await client.post(_CAMPAIGN_BASE, json=payload)
        return build_mutate_response(action="created", kind="discovery_campaign", name=name, data=result)

    @mcp.tool()
    async def update_discovery_campaign(
        name: str,
        authorization_levels: dict | None = None,
        event_on_success: bool | None = None,
        event_on_warning: bool | None = None,
        event_on_failure: bool | None = None,
        enabled: bool | None = None,
        description: str | None = None,
        hosts: list[str] | None = None,
        ports: list[int] | None = None,
        grading_policies: list[str] | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an existing discovery campaign (GET -> strip -> merge -> PUT).

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/discovery

        Uses the GET-strip-merge-PUT pattern: fetches the current state,
        strips server-populated fields, merges your overrides, and PUTs
        the result back.

        Args:
            name: Campaign name to update.
            authorization_levels: New access control configuration.
            event_on_success: Whether to generate events on success.
            event_on_warning: Whether to generate events on warnings.
            event_on_failure: Whether to generate events on failures.
            enabled: Whether the campaign is active.
            description: New description.
            hosts: New list of hosts/IP ranges.
            ports: New list of ports.
            grading_policies: New list of grading policy names.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON with confirmation message and updated campaign data.
        """
        if authorization_levels is not None:
            auth_err = _validate_authorization_levels(authorization_levels)
            if auth_err is not None:
                return auth_err

        overrides: dict[str, Any] = {}
        if authorization_levels is not None:
            overrides["authorizationLevels"] = authorization_levels
        if event_on_success is not None:
            overrides["eventOnSuccess"] = event_on_success
        if event_on_warning is not None:
            overrides["eventOnWarning"] = event_on_warning
        if event_on_failure is not None:
            overrides["eventOnFailure"] = event_on_failure
        if enabled is not None:
            overrides["enabled"] = enabled
        if description is not None:
            overrides["description"] = description
        if hosts is not None:
            overrides["hosts"] = hosts
        if ports is not None:
            overrides["ports"] = ports
        if grading_policies is not None:
            overrides["gradingPolicies"] = grading_policies

        result = await get_strip_merge_put(
            f"{_CAMPAIGN_BASE}/{name}",
            f"{_CAMPAIGN_BASE}/",
            "discovery_campaign",
            overrides,
            clear_fields,
        )
        return build_mutate_response(action="updated", kind="discovery_campaign", name=name, data=result)

    # ===================================================================
    # Mutating-destructive (2 tools)
    # ===================================================================

    @mcp.tool()
    async def delete_discovery_campaign(name: str, expected_name: str) -> str:
        """Delete a discovery campaign. Requires name confirmation.

        IMPORTANT: Before executing this operation, always confirm the action
        with the end-user first.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/discovery

        Args:
            name: Campaign name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"{_CAMPAIGN_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "discovery_campaign",
        })

    @mcp.tool()
    async def flush_discovery_campaign(name: str, expected_name: str) -> str:
        """Flush (purge all events from) a discovery campaign. Requires name confirmation.

        IMPORTANT: Before executing this operation, always confirm the action
        with the end-user first.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/discovery

        Sends a PATCH to purge all discovery events associated with the
        campaign. This is irreversible.

        Args:
            name: Campaign name to flush.
            expected_name: Must exactly match *name* as a flush safeguard.

        Returns:
            JSON confirmation of flush.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.patch(f"{_CAMPAIGN_BASE}/{name}")
        return json.dumps({
            "flushed": True,
            "name": name,
            "kind": "discovery_campaign",
        })
