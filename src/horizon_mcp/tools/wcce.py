"""WCCE (Windows Certificate Connector for Enterprise) tools for Horizon MCP Server.

7 tools covering forest mapping CRUD and WCCE enrollment protocol:
  - list_wcce_forests: list with optional name filtering on "forest" field
  - get_wcce_forest: fetch a single forest mapping by name
  - create_wcce_forest: create a new forest mapping
  - update_wcce_forest: GET-strip-merge-PUT update
  - delete_wcce_forest: delete with safety echo
  - wcce_enroll: enroll a certificate via WCCE protocol
  - get_wcce_exchange_certificate: retrieve exchange certificate PEM for a profile

Knowledge resources:
    - horizon://knowledge/integrations
"""

from __future__ import annotations

import json
import logging
import re
from typing import TYPE_CHECKING, Any

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.state import get_client
from horizon_mcp.tools._helpers import (
    build_list_response,
    build_mutate_response,
    delete_guard,
    get_strip_merge_put,
)

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.wcce")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_FOREST_BASE = "/api/v1/wcce/forests"
_ENROLL_PATH = "/api/v1/wcce/enroll"
_EXCHANGE_BASE = "/api/v1/wcce/exchanges"

_FOREST_NAME_RE = re.compile(r"^[0-9a-zA-Z\-_\.]+$")

_VALID_ENROLLMENT_MODES = frozenset({"eobo", "entity", "trust_request"})
_VALID_TEMPLATE_VERSIONS = frozenset({"v1", "v2"})


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_forest_name(forest_name: str) -> str | None:
    """Return an error JSON string if *forest_name* is invalid, else None.

    Forest names must match ``[0-9a-zA-Z-_\\.]+``.
    """
    if not _FOREST_NAME_RE.match(forest_name):
        return json.dumps({
            "error": f"Invalid forest name '{forest_name}'.",
            "hint": "Forest names must match the pattern [0-9a-zA-Z-_.]+ (alphanumeric, hyphens, underscores, dots).",
        })
    return None


def _validate_template_mappings(mappings: list[dict[str, Any]]) -> str | None:
    """Return an error JSON string if *mappings* contain invalid entries, else None.

    Each mapping must have 'template', 'profile', 'enrollmentMode', and
    'templateVersion'.  'eoboTrustedCas' is optional.
    """
    if not mappings:
        return json.dumps({
            "error": "templateMappings must contain at least one mapping.",
        })

    for idx, mapping in enumerate(mappings):
        for required_key in ("template", "profile", "enrollmentMode", "templateVersion"):
            if required_key not in mapping:
                return json.dumps({
                    "error": f"templateMappings[{idx}] is missing required key '{required_key}'.",
                    "required_keys": ["template", "profile", "enrollmentMode", "templateVersion"],
                })

        mode = mapping["enrollmentMode"]
        if mode not in _VALID_ENROLLMENT_MODES:
            return json.dumps({
                "error": f"templateMappings[{idx}].enrollmentMode '{mode}' is invalid.",
                "valid_values": sorted(_VALID_ENROLLMENT_MODES),
            })

        version = mapping["templateVersion"]
        if version not in _VALID_TEMPLATE_VERSIONS:
            return json.dumps({
                "error": f"templateMappings[{idx}].templateVersion '{version}' is invalid.",
                "valid_values": sorted(_VALID_TEMPLATE_VERSIONS),
            })

    return None


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_wcce_tools(mcp: FastMCP) -> None:
    """Register all 7 WCCE tools on *mcp*."""

    # ===================================================================
    # Forest management — read-only (2 tools)
    # ===================================================================

    @mcp.tool()
    async def list_wcce_forests(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List WCCE forest mappings with optional name filtering.

        Safety tier: read-only

        Filters on the 'forest' identifier field (not the generic 'name' field).

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on the forest identifier.

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        data = await client.get(_FOREST_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )
        # Custom filter: WCCE forests use "forest" as the identifier field,
        # not "name". Fall back to "name" for resilience.
        if name_contains:
            needle = name_contains.lower()
            items = [
                i for i in items
                if needle in (i.get("forest") or i.get("name") or "").lower()
            ]
        return build_list_response(items, max_items, kind="wcce_forest")

    @mcp.tool()
    async def get_wcce_forest(name: str) -> str:
        """Get a single WCCE forest mapping by name.

        Safety tier: read-only

        Args:
            name: Exact forest identifier.

        Returns:
            JSON representation of the WCCE forest mapping including its
            template mappings.
        """
        client = get_client()
        result = await client.get(f"{_FOREST_BASE}/{name}")
        return json.dumps(result)

    # ===================================================================
    # Forest management — mutating-safe (2 tools)
    # ===================================================================

    @mcp.tool()
    async def create_wcce_forest(
        forest_name: str,
        template_mappings: list[dict],
    ) -> str:
        """Create a new WCCE forest mapping.

        Safety tier: mutating-safe

        See also: create_wcce_profile (profiles reference forests).

        Each template mapping must contain:
          - template: AD CS template name
          - profile: Horizon certificate profile name
          - enrollmentMode: "eobo", "entity", or "trust_request"
          - templateVersion: "v1" or "v2"
          - eoboTrustedCas (optional): list of trusted CA names for EOBO mode

        Args:
            forest_name: Forest identifier (alphanumeric, hyphens, underscores, dots).
            template_mappings: List of template-to-profile mapping dicts.

        Returns:
            JSON representation of the created forest mapping.
        """
        name_err = _validate_forest_name(forest_name)
        if name_err is not None:
            return name_err

        mapping_err = _validate_template_mappings(template_mappings)
        if mapping_err is not None:
            return mapping_err

        client = get_client()
        payload: dict[str, Any] = {
            "forest": forest_name,
            "templateMappings": template_mappings,
        }
        result = await client.post(_FOREST_BASE, json=payload)
        return build_mutate_response(action="created", kind="wcce_forest", name=forest_name, data=result)

    @mcp.tool()
    async def update_wcce_forest(
        forest_name: str,
        template_mappings: list[dict] | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an existing WCCE forest mapping (GET -> strip -> merge -> PUT).

        Safety tier: mutating-safe

        Uses the GET-strip-merge-PUT pattern: fetches the current state,
        strips server-populated fields, merges your overrides, and PUTs
        the result back.

        Args:
            forest_name: Forest identifier to update.
            template_mappings: New list of template-to-profile mapping dicts
                (replaces existing). Each mapping requires template, profile,
                enrollmentMode, and templateVersion.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON representation of the updated forest mapping.
        """
        if template_mappings is not None:
            mapping_err = _validate_template_mappings(template_mappings)
            if mapping_err is not None:
                return mapping_err

        overrides: dict[str, Any] = {}
        if template_mappings is not None:
            overrides["templateMappings"] = template_mappings

        result = await get_strip_merge_put(
            f"{_FOREST_BASE}/{forest_name}",
            f"{_FOREST_BASE}/",
            "wcce_forest",
            overrides,
            clear_fields,
        )
        return build_mutate_response(action="updated", kind="wcce_forest", name=forest_name, data=result)

    # ===================================================================
    # Forest management — mutating-destructive (1 tool)
    # ===================================================================

    @mcp.tool()
    async def delete_wcce_forest(forest_name: str, expected_name: str) -> str:
        """Delete a WCCE forest mapping. Requires name confirmation.

        IMPORTANT: Before executing this operation, always confirm the action
        with the end-user first.

        Safety tier: mutating-destructive

        WARNING: Deleting a WCCE forest mapping will break certificate enrollment
        for all AD CS templates mapped through this forest.

        Args:
            forest_name: Forest identifier to delete.
            expected_name: Must exactly match *forest_name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(forest_name, expected_name)
        client = get_client()
        await client.delete(f"{_FOREST_BASE}/{forest_name}")
        return json.dumps({
            "deleted": True,
            "name": forest_name,
            "kind": "wcce_forest",
        })

    # ===================================================================
    # WCCE Protocol (2 tools)
    # ===================================================================

    @mcp.tool()
    async def wcce_enroll(
        forest_name: str,
        template_name: str,
        template_oid: str,
        caller_identity: dict,
        pkcs10: str | None = None,
        cmc: str | None = None,
    ) -> str:
        """Enroll a certificate through the WCCE protocol.

        Safety tier: mutating-safe

        Prerequisites: WCCE forest and WCCE profile must both exist.

        Submits a PKCS#10 CSR or CMC request to the WCCE enrollment endpoint
        for the specified forest and AD CS template.

        At least one of pkcs10 or cmc must be provided.

        Args:
            forest_name: Target forest identifier.
            template_name: AD CS certificate template name.
            template_oid: AD CS certificate template OID.
            caller_identity: Identity of the enrolling entity (dict with
                identity fields required by the WCCE connector).
            pkcs10: Base64-encoded PKCS#10 CSR.
            cmc: Base64-encoded CMC request.

        Returns:
            JSON result from the WCCE enrollment endpoint.
        """
        if not pkcs10 and not cmc:
            return json.dumps({
                "error": True,
                "content": "At least one of pkcs10 or cmc must be provided.",
            })

        client = get_client()
        payload: dict[str, Any] = {
            "forestName": forest_name,
            "templateName": template_name,
            "templateOID": template_oid,
            "callerIdentity": caller_identity,
        }
        if pkcs10:
            payload["pkcs10"] = pkcs10
        if cmc:
            payload["cmc"] = cmc

        result = await client.post(_ENROLL_PATH, json=payload)
        return json.dumps(result)

    @mcp.tool()
    async def get_wcce_exchange_certificate(profile: str) -> str:
        """Retrieve the WCCE exchange certificate (PEM) for a profile.

        Safety tier: read-only

        Returns the exchange certificate in PEM format if one exists.
        May return an empty response (204) if no exchange certificate has
        been generated yet, or 404 if the profile is not found.

        Args:
            profile: Horizon certificate profile name.

        Returns:
            JSON with the PEM-encoded exchange certificate, or an
            informational message if none exists.
        """
        client = get_client()
        result = await client.get(f"{_EXCHANGE_BASE}/{profile}")
        if result is None:
            return json.dumps({
                "profile": profile,
                "exchange_certificate": None,
                "message": "No exchange certificate available for this profile.",
            })
        return json.dumps(result) if isinstance(result, dict) else json.dumps({
            "profile": profile,
            "exchange_certificate": result,
        })
