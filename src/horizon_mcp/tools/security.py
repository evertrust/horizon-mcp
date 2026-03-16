"""Security & RBAC tools — roles, teams, identity providers, principals, credentials.

29 tools covering the full Horizon RBAC surface:
  - Roles (8): list, get, create, update, delete, get_members, add_members, remove_members
  - Teams (9): list, get, create, update, delete, get_members, add_members, remove_members, transfer
  - Identity Providers (5): list, get, create, update, delete
  - Principals (5): search, get, create, update, delete
  - Credentials (2): list, get (read-only)
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.client.state import get_client
from horizon_mcp.tools._helpers import build_mutate_response, delete_guard, get_strip_merge_put

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.security")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ROLES_BASE = "/api/v1/security/roles"
_TEAMS_BASE = "/api/v1/security/teams"
_IDP_BASE = "/api/v1/security/identity/providers"
_PRINCIPALS_BASE = "/api/v1/security/principals"
_CREDENTIALS_BASE = "/api/v1/security/credentials"

_PERMISSION_EXAMPLES = (
    "Permission strings are patterns validated by Horizon (not a closed enum). "
    "Examples: 'certificates:search:*', 'certificates:enroll:profile-name', "
    "'configuration:cas:read', 'configuration:profiles:*', "
    "'security:roles:read', 'discovery:campaigns:*'."
)


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


def _list_params_for_members(max_items: int) -> dict[str, Any]:
    """Build query parameters for member-list endpoints."""
    return {"size": max_items + 1}


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


async def _fetch_members(
    path: str,
    max_items: int,
) -> str:
    """Fetch a member list with truncation."""
    client = get_client()
    params = _list_params_for_members(max_items)
    raw = await client.get(path, params=params)

    items: list[Any]
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict) and "content" in raw:
        items = raw["content"]
    else:
        items = [raw] if raw else []

    meta = _truncation_meta(items, max_items)
    items = items[:max_items]

    result: dict[str, Any] = {"members": items, "count": len(items)}
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


# ═══════════════════════════════════════════════════════════════════════════
# Registration — Admin (25 tools)
# ═══════════════════════════════════════════════════════════════════════════

def register_security_admin_tools(mcp: FastMCP) -> None:  # noqa: C901 — registration fn
    """Register the 25 admin/mutating security tools."""

    # ===================================================================
    # ROLES — admin (6)
    # ===================================================================

    @mcp.tool(
        description=(
            "Create a new Horizon RBAC role. "
            "Before creating a new role, use list_roles to check if an existing "
            "role already covers the needed permissions. Prefer reusing/extending "
            "over duplicates. "
            f"{_PERMISSION_EXAMPLES} "
            "See also: add_role_members (assign principals to this role after creation). "
            "Safety: mutating-safe. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def create_role(
        name: str,
        description: str | None = None,
        permissions: list[str] | None = None,
    ) -> str:
        """Create a role. Horizon validates permission patterns server-side."""
        client = get_client()
        body: dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        if permissions is not None:
            body["permissions"] = permissions
        result = await client.post(_ROLES_BASE, json=body)
        return build_mutate_response(action="created", kind="role", name=name, data=result)

    @mcp.tool(
        description=(
            "Update an existing Horizon role (GET-strip-merge-PUT). "
            "WARNING: This is a behavior-changing operation — modifying permissions "
            "immediately affects all principals assigned this role. "
            f"{_PERMISSION_EXAMPLES} "
            "Use clear_fields to explicitly null optional fields. "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def update_role(
        name: str,
        description: str | None = None,
        permissions: list[str] | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update role via GET-strip-merge-PUT."""
        overrides: dict[str, Any] = {}
        if description is not None:
            overrides["description"] = description
        if permissions is not None:
            overrides["permissions"] = permissions
        result = await get_strip_merge_put(
            f"{_ROLES_BASE}/{name}", f"{_ROLES_BASE}/", "role", overrides, clear_fields,
        )
        return build_mutate_response(action="updated", kind="role", name=name, data=result)

    @mcp.tool(
        description=(
            "Delete a Horizon role. Requires expected_name to match name as "
            "a safety confirmation. "
            "Safety: mutating-destructive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def delete_role(name: str, expected_name: str) -> str:
        """Delete a role after confirming the name echo."""
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"{_ROLES_BASE}/{name}")
        return json.dumps({"deleted": name, "status": "success"})

    @mcp.tool(
        description=(
            "List members (principals) assigned to a Horizon role. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def get_role_members(name: str, max_items: int = 50) -> str:
        """Get the list of principals assigned to a role."""
        return await _fetch_members(f"{_ROLES_BASE}/{name}/members", max_items)

    @mcp.tool(
        description=(
            "Add members (principals) to a Horizon role. "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def add_role_members(name: str, members: list[str]) -> str:
        """Add one or more principals to a role."""
        client = get_client()
        result = await client.post(
            f"{_ROLES_BASE}/{name}/members", json=members,
        )
        return json.dumps(result if result else {"added": members, "role": name})

    @mcp.tool(
        description=(
            "Remove members (principals) from a Horizon role. "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def remove_role_members(name: str, members: list[str]) -> str:
        """Remove one or more principals from a role (DELETE with body)."""
        client = get_client()
        result = await client.delete(
            f"{_ROLES_BASE}/{name}/members", json=members,
        )
        return json.dumps(
            result if result else {"removed": members, "role": name},
        )

    # ===================================================================
    # TEAMS (9)
    # ===================================================================

    @mcp.tool(
        description=(
            "List Horizon teams. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def list_teams(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List teams, optionally filtering by name substring."""
        return await _fetch_list(_TEAMS_BASE, max_items, name_contains)

    @mcp.tool(
        description=(
            "Get a single Horizon team by name. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def get_team(name: str) -> str:
        """Retrieve full details of a named team."""
        client = get_client()
        team = await client.get(f"{_TEAMS_BASE}/{name}")
        return json.dumps(team)

    @mcp.tool(
        description=(
            "Create a new Horizon team. "
            "IMPORTANT: Team name is IMMUTABLE (primary key). Always ask the "
            "user for both name and display_name before creating. "
            "See also: add_team_members (add principals after creation), "
            "create_role (teams and roles work together for RBAC). "
            "Safety: mutating-safe. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def create_team(
        name: str,
        display_name: str | None = None,
        description: str | None = None,
        contact: str | None = None,
        webhook: str | None = None,
        managers: list[str] | None = None,
    ) -> str:
        """Create a team with optional metadata and managers."""
        client = get_client()
        body: dict[str, Any] = {"name": name}
        if display_name is not None:
            body["displayName"] = display_name
        if description is not None:
            body["description"] = description
        if contact is not None:
            body["contact"] = contact
        if webhook is not None:
            body["webhook"] = webhook
        if managers is not None:
            body["managers"] = managers
        result = await client.post(_TEAMS_BASE, json=body)
        return build_mutate_response(action="created", kind="team", name=name, data=result)

    @mcp.tool(
        description=(
            "Update an existing Horizon team (GET-strip-merge-PUT). "
            "Use clear_fields to explicitly null optional fields. "
            "Safety: mutating-safe. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def update_team(
        name: str,
        display_name: str | None = None,
        description: str | None = None,
        contact: str | None = None,
        webhook: str | None = None,
        managers: list[str] | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update team via GET-strip-merge-PUT."""
        overrides: dict[str, Any] = {}
        if display_name is not None:
            overrides["displayName"] = display_name
        if description is not None:
            overrides["description"] = description
        if contact is not None:
            overrides["contact"] = contact
        if webhook is not None:
            overrides["webhook"] = webhook
        if managers is not None:
            overrides["managers"] = managers
        result = await get_strip_merge_put(
            f"{_TEAMS_BASE}/{name}", f"{_TEAMS_BASE}/", "team", overrides, clear_fields,
        )
        return build_mutate_response(action="updated", kind="team", name=name, data=result)

    @mcp.tool(
        description=(
            "Delete a Horizon team. Requires expected_name to match name as "
            "a safety confirmation. "
            "Safety: mutating-destructive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def delete_team(name: str, expected_name: str) -> str:
        """Delete a team after confirming the name echo."""
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"{_TEAMS_BASE}/{name}")
        return json.dumps({"deleted": name, "status": "success"})

    @mcp.tool(
        description=(
            "List members of a Horizon team. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def get_team_members(name: str, max_items: int = 50) -> str:
        """Get the list of principals belonging to a team."""
        return await _fetch_members(f"{_TEAMS_BASE}/{name}/members", max_items)

    @mcp.tool(
        description=(
            "Add members (principals) to a Horizon team. "
            "Safety: mutating-safe. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def add_team_members(name: str, members: list[str]) -> str:
        """Add one or more principals to a team."""
        client = get_client()
        result = await client.post(
            f"{_TEAMS_BASE}/{name}/members", json=members,
        )
        return json.dumps(result if result else {"added": members, "team": name})

    @mcp.tool(
        description=(
            "Remove members (principals) from a Horizon team. "
            "Safety: mutating-safe. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def remove_team_members(name: str, members: list[str]) -> str:
        """Remove one or more principals from a team (DELETE with body)."""
        client = get_client()
        result = await client.delete(
            f"{_TEAMS_BASE}/{name}/members", json=members,
        )
        return json.dumps(
            result if result else {"removed": members, "team": name},
        )

    @mcp.tool(
        description=(
            "Transfer all certificate ownership from one team to another. "
            "WARNING: This will transfer all certificate ownership from one "
            "team to another. This is a bulk, irreversible operation. "
            "Safety: mutating-destructive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def transfer_team_objects(from_team: str, to_team: str) -> str:
        """Transfer certificate ownership between teams."""
        client = get_client()
        result = await client.patch(
            f"{_TEAMS_BASE}/{from_team}/{to_team}",
        )
        return json.dumps(
            result
            if result
            else {
                "status": "success",
                "from_team": from_team,
                "to_team": to_team,
            },
        )

    # ===================================================================
    # IDENTITY PROVIDERS (5)
    # ===================================================================

    @mcp.tool(
        description=(
            "List Horizon identity providers (IDPs). "
            "This is Horizon's IDP config -- NOT transport auth. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def list_identity_providers(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List identity providers, optionally filtering by name."""
        return await _fetch_list(_IDP_BASE, max_items, name_contains)

    @mcp.tool(
        description=(
            "Get a single Horizon identity provider by name. "
            "This is Horizon's IDP config -- NOT transport auth. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def get_identity_provider(name: str) -> str:
        """Retrieve full details of an identity provider."""
        client = get_client()
        idp = await client.get(f"{_IDP_BASE}/{name}")
        return json.dumps(idp)

    @mcp.tool(
        description=(
            "Create a Horizon identity provider. "
            "This is Horizon's IDP config -- NOT transport auth. "
            "Supported types: "
            "'local' (configuration: {\"passwordPolicy\": \"my-policy\", \"emailTemplate\": \"welcome\"}) or "
            "'openid' (configuration: {\"providerMetadataUrl\": \"https://idp.example.com/.well-known/openid-configuration\", "
            "\"clientCredentials\": \"my-oidc-cred\", \"scope\": \"openid email\", \"identifierClaim\": \"sub\", "
            "\"emailClaim\": \"email\", \"nameClaim\": \"name\"}). "
            "Prerequisites: Credential must exist for openid type (use list_credentials). "
            "See also: create_principal (principals authenticate via identity providers). "
            "Safety: mutating-safe. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def create_identity_provider(
        name: str,
        type: str,
        configuration: dict,
        description: str | None = None,
    ) -> str:
        """Create an identity provider with type-specific configuration."""
        client = get_client()
        body: dict[str, Any] = {
            "name": name,
            "type": type,
            "configuration": configuration,
        }
        if description is not None:
            body["description"] = description
        result = await client.post(_IDP_BASE, json=body)
        return build_mutate_response(action="created", kind="identity_provider", name=name, data=result)

    @mcp.tool(
        description=(
            "Update an existing Horizon identity provider (GET-strip-merge-PUT). "
            "This is Horizon's IDP config -- NOT transport auth. "
            "Use clear_fields to explicitly null optional fields. "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def update_identity_provider(
        name: str,
        configuration: dict | None = None,
        description: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update IDP via GET-strip-merge-PUT."""
        overrides: dict[str, Any] = {}
        if configuration is not None:
            overrides["configuration"] = configuration
        if description is not None:
            overrides["description"] = description
        result = await get_strip_merge_put(
            f"{_IDP_BASE}/{name}", f"{_IDP_BASE}/", "idp", overrides, clear_fields,
        )
        return build_mutate_response(action="updated", kind="identity_provider", name=name, data=result)

    @mcp.tool(
        description=(
            "Delete a Horizon identity provider. Requires expected_name to match "
            "name as a safety confirmation. "
            "Safety: mutating-destructive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def delete_identity_provider(name: str, expected_name: str) -> str:
        """Delete an identity provider after confirming the name echo."""
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"{_IDP_BASE}/{name}")
        return json.dumps({"deleted": name, "status": "success"})

    # ===================================================================
    # PRINCIPALS (5)
    # ===================================================================

    @mcp.tool(
        description=(
            "Search Horizon security principals (users/service accounts). "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def search_principals(
        query: str | None = None,
        max_items: int = 50,
    ) -> str:
        """Search principals with optional query string."""
        client = get_client()
        params: dict[str, Any] = {"size": max_items + 1}
        if query is not None:
            params["query"] = query
        raw = await client.get(_PRINCIPALS_BASE, params=params)

        items: list[Any]
        if isinstance(raw, list):
            items = raw
        elif isinstance(raw, dict) and "content" in raw:
            items = raw["content"]
        else:
            items = [raw] if raw else []

        meta = _truncation_meta(items, max_items)
        items = items[:max_items]

        result: dict[str, Any] = {"principals": items, "count": len(items)}
        if meta:
            result.update(meta)
        return json.dumps(result)

    @mcp.tool(
        description=(
            "Get a single Horizon principal by identifier. "
            "Safety: read-only. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def get_principal(identifier: str) -> str:
        """Retrieve full details of a principal."""
        client = get_client()
        principal = await client.get(f"{_PRINCIPALS_BASE}/{identifier}")
        return json.dumps(principal)

    @mcp.tool(
        description=(
            "Create a Horizon security principal. "
            "Prerequisites: Referenced roles (list_roles) and teams (list_teams) must exist. "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def create_principal(
        identifier: str,
        contact: str | None = None,
        roles: list[str] | None = None,
        teams: list[str] | None = None,
        permissions: list[str] | None = None,
        enabled: bool = True,
    ) -> str:
        """Create a principal with optional roles, teams, and permissions."""
        client = get_client()
        body: dict[str, Any] = {
            "identifier": identifier,
            "enabled": enabled,
        }
        if contact is not None:
            body["contact"] = contact
        if roles is not None:
            body["roles"] = roles
        if teams is not None:
            body["teams"] = teams
        if permissions is not None:
            body["permissions"] = permissions
        result = await client.post(_PRINCIPALS_BASE, json=body)
        return build_mutate_response(action="created", kind="principal", name=identifier, data=result)

    @mcp.tool(
        description=(
            "Update a Horizon principal (GET-strip-merge-PUT). "
            "WARNING: Modifying principal roles/permissions immediately affects "
            "access control. "
            "Use clear_fields to explicitly null optional fields. "
            "Safety: security-sensitive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def update_principal(
        identifier: str,
        contact: str | None = None,
        roles: list[str] | None = None,
        teams: list[str] | None = None,
        permissions: list[str] | None = None,
        enabled: bool | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update principal via GET-strip-merge-PUT."""
        overrides: dict[str, Any] = {}
        if contact is not None:
            overrides["contact"] = contact
        if roles is not None:
            overrides["roles"] = roles
        if teams is not None:
            overrides["teams"] = teams
        if permissions is not None:
            overrides["permissions"] = permissions
        if enabled is not None:
            overrides["enabled"] = enabled
        # Principals don't have a dedicated strip domain; use baseline
        result = await get_strip_merge_put(
            f"{_PRINCIPALS_BASE}/{identifier}",
            f"{_PRINCIPALS_BASE}/",
            "principal",
            overrides,
            clear_fields,
        )
        return build_mutate_response(action="updated", kind="principal", name=identifier, data=result)

    @mcp.tool(
        description=(
            "Delete a Horizon principal. Requires expected_identifier to match "
            "identifier as a safety confirmation. "
            "Safety: mutating-destructive. "
            "Reference: horizon://knowledge/rbac"
        ),
    )
    async def delete_principal(identifier: str, expected_identifier: str) -> str:
        """Delete a principal after confirming the identifier echo."""
        delete_guard(identifier, expected_identifier, label="identifier")
        client = get_client()
        await client.delete(f"{_PRINCIPALS_BASE}/{identifier}")
        return json.dumps({"deleted": identifier, "status": "success"})


# ═══════════════════════════════════════════════════════════════════════════
# Composition
# ═══════════════════════════════════════════════════════════════════════════

def register_security_tools(mcp: FastMCP) -> None:
    """Register all 29 security/RBAC tools on the given FastMCP server."""
    register_security_readonly_tools(mcp)
    register_security_admin_tools(mcp)
