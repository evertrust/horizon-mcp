"""Local identity management tools for Horizon MCP Server.

8 tools covering the full local identity lifecycle:
  - list_local_identities: list with optional identifier filtering
  - get_local_identity: fetch a single identity by identifier
  - create_local_identity: create a new local identity
  - update_local_identity: GET-strip-merge-PUT update
  - delete_local_identity: delete with safety echo
  - set_local_identity_password: directly set a user's password
  - initiate_password_reset: trigger a password-reset email
  - complete_password_reset: complete a password reset with UUID + new password

LocalIdentity model: {identifier, email, name, password (creation only)}.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from horizon_mcp.client.state import get_client
from horizon_mcp.client.errors import HorizonError
from horizon_mcp.tools._helpers import (
    build_mutate_response,
    delete_guard,
    apply_name_filter,
    build_list_response,
    get_strip_merge_put,
)

logger = logging.getLogger("horizon_mcp.tools.local_identities")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_LOCAL_BASE = "/api/v1/security/identity/locals"
_PASSWORD_BASE = f"{_LOCAL_BASE}/password"


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_local_identity_tools(mcp: FastMCP) -> None:
    """Register all 8 local identity tools on *mcp*."""

    # ===================================================================
    # LIST (1)
    # ===================================================================

    @mcp.tool(
        description=(
            "List Horizon local identities. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def list_local_identities(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List local identities, optionally filtering by identifier substring.

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on identifier.

        Returns:
            JSON with items, count, total_available, truncated flag, and kind.
        """
        client = get_client()
        data = await client.get(_LOCAL_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )

        if name_contains:
            needle = name_contains.lower()
            items = [
                i for i in items
                if needle in (i.get("identifier") or i.get("name") or "").lower()
            ]
        else:
            items = apply_name_filter(items, None)  # no-op

        return build_list_response(items, max_items, kind="local_identity")

    # ===================================================================
    # GET (2)
    # ===================================================================

    @mcp.tool(
        description=(
            "Get a single Horizon local identity by identifier. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def get_local_identity(identifier: str) -> str:
        """Retrieve full details of a local identity.

        Args:
            identifier: Exact identity identifier.

        Returns:
            JSON representation of the local identity.
        """
        client = get_client()
        result = await client.get(f"{_LOCAL_BASE}/{identifier}")
        return json.dumps(result)

    # ===================================================================
    # CREATE (3)
    # ===================================================================

    @mcp.tool(
        description=(
            "Create a new Horizon local identity. "
            "See also: create_identity_provider (identity must belong to a local IDP), "
            "set_local_identity_password (change password after creation). "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def create_local_identity(
        identifier: str,
        name: str | None = None,
        email: str | None = None,
        password: str | None = None,
    ) -> str:
        """Create a local identity with optional name, email, and password.

        Args:
            identifier: Unique identity identifier.
            name: Optional display name.
            email: Optional email address.
            password: Optional initial password (only used at creation time).

        Returns:
            JSON representation of the created local identity.
        """
        client = get_client()
        body: dict[str, Any] = {"identifier": identifier}
        if name is not None:
            body["name"] = name
        if email is not None:
            body["email"] = email
        if password is not None:
            body["password"] = password
        result = await client.post(_LOCAL_BASE, json=body)
        return build_mutate_response(
            action="created", kind="local_identity", name=identifier, data=result,
        )

    # ===================================================================
    # UPDATE (4)
    # ===================================================================

    @mcp.tool(
        description=(
            "Update an existing Horizon local identity (GET-strip-merge-PUT). "
            "Use clear_fields to explicitly null optional fields. "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def update_local_identity(
        identifier: str,
        name: str | None = None,
        email: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update a local identity via GET-strip-merge-PUT.

        Args:
            identifier: Identity identifier to update.
            name: New display name.
            email: New email address.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON representation of the updated local identity.
        """
        overrides: dict[str, Any] = {}
        if name is not None:
            overrides["name"] = name
        if email is not None:
            overrides["email"] = email
        result = await get_strip_merge_put(
            f"{_LOCAL_BASE}/{identifier}",
            f"{_LOCAL_BASE}/",
            "local_identity",
            overrides,
            clear_fields,
        )
        return build_mutate_response(
            action="updated", kind="local_identity", name=identifier, data=result,
        )

    # ===================================================================
    # DELETE (5)
    # ===================================================================

    @mcp.tool(
        description=(
            "Delete a Horizon local identity. Requires expected_identifier "
            "to match identifier as a safety confirmation. "
            "IMPORTANT: Before executing this operation, always confirm "
            "the action with the end-user first. "
            "Safety: mutating-destructive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def delete_local_identity(
        identifier: str,
        expected_identifier: str,
    ) -> str:
        """Delete a local identity after confirming the identifier echo.

        Args:
            identifier: Identity identifier to delete.
            expected_identifier: Must exactly match *identifier* as a
                deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(identifier, expected_identifier, label="identifier")
        client = get_client()
        await client.delete(f"{_LOCAL_BASE}/{identifier}")
        return json.dumps({"deleted": identifier, "status": "success"})

    # ===================================================================
    # SET PASSWORD (6)
    # ===================================================================

    @mcp.tool(
        description=(
            "Directly set the password for a Horizon local identity. "
            "Requires expected_identifier to match identifier as a safety "
            "confirmation. "
            "IMPORTANT: Before executing this operation, always confirm "
            "the action with the end-user first. "
            "Directly sets a user's password — this is a high-impact "
            "security action. "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def set_local_identity_password(
        identifier: str,
        password: str,
        expected_identifier: str,
    ) -> str:
        """Set a local identity's password directly.

        Args:
            identifier: Identity identifier whose password to set.
            password: New password value.
            expected_identifier: Must exactly match *identifier* as a
                safety confirmation for this high-impact action.

        Returns:
            JSON confirmation with server response data.
        """
        delete_guard(identifier, expected_identifier, label="identifier")
        client = get_client()
        payload = {"identifier": identifier, "password": password}
        result = await client.patch(_LOCAL_BASE, json=payload)
        return json.dumps({
            "content": f"Password set for identity '{identifier}'.",
            "data": result,
        })

    # ===================================================================
    # INITIATE PASSWORD RESET (7)
    # ===================================================================

    @mcp.tool(
        description=(
            "Initiate a password reset for a Horizon local identity. "
            "IMPORTANT: Before executing this operation, always confirm "
            "the action with the end-user first. "
            "A 201 response does NOT guarantee the user exists. "
            "It confirms the request was processed. "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def initiate_password_reset(identifier: str) -> str:
        """Trigger a password-reset email for a local identity.

        The server always returns 201 as an anti-enumeration measure —
        a success response does NOT reveal whether the identity exists.

        Args:
            identifier: Identity identifier to initiate reset for.

        Returns:
            JSON confirmation that the reset request was processed.
        """
        client = get_client()
        result = await client.get(f"{_PASSWORD_BASE}/{identifier}")
        return json.dumps({
            "content": (
                f"Password reset initiated for '{identifier}'. "
                "A 201 response does NOT guarantee the user exists — "
                "it only confirms the request was processed."
            ),
            "data": result,
        })

    # ===================================================================
    # COMPLETE PASSWORD RESET (8)
    # ===================================================================

    @mcp.tool(
        description=(
            "Complete a password reset for a Horizon local identity using "
            "the reset UUID received by the user. "
            "IMPORTANT: Before executing this operation, always confirm "
            "the action with the end-user first. "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def complete_password_reset(
        identifier: str,
        reset_uuid: str,
        new_password: str,
    ) -> str:
        """Complete a password reset with the UUID from the reset email.

        Args:
            identifier: Identity identifier to reset password for.
            reset_uuid: UUID from the password-reset email.
            new_password: New password to set.

        Returns:
            JSON confirmation that the password was reset.
        """
        client = get_client()
        payload = {
            "identifier": identifier,
            "uuid": reset_uuid,
            "password": new_password,
        }
        result = await client.post(_PASSWORD_BASE, json=payload)
        return json.dumps({
            "content": f"Password reset completed for '{identifier}'.",
            "data": result,
        })
