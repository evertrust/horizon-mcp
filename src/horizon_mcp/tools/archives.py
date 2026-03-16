"""Archive management tools for Horizon MCP Server.

8 tools covering archive listing, creation, download, deletion, and lifecycle:
  - list_archives: list archives with optional name filtering
  - get_archive: fetch a single archive by name
  - create_archive: create a certificate or event archive
  - download_archive: download archive contents as base64
  - delete_archive: delete an archive with safety echo
  - retry_archive: retry a failed archive
  - cancel_archive: cancel a running archive
  - count_archive_matches: count items matching archive criteria

Archives are discriminated by type:
  - CertificateArchive: uses an HCQL filter query string
  - EventArchive: uses a 'before' timestamp (epoch milliseconds)

NOTE: Archives have NO update route.
"""

from __future__ import annotations

import base64
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
)

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.archives")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ARCHIVE_BASE = "/api/v1/archives"
_VALID_TYPES = frozenset({"certificate", "event"})


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_archive_params(
    archive_type: str,
    filter: str | None,
    before: int | None,
    archive_keys: bool = False,
) -> str | None:
    """Validate archive type/filter/before combinations.

    Returns a JSON error string if validation fails, or None if valid.
    """
    if archive_type not in _VALID_TYPES:
        return json.dumps({
            "error": True,
            "content": (
                f"Invalid archive_type '{archive_type}'. "
                f"Must be one of: {sorted(_VALID_TYPES)}."
            ),
        })
    if archive_type == "certificate" and not filter:
        return json.dumps({
            "error": True,
            "content": "Certificate archives require 'filter' (HCQL query string).",
        })
    if archive_type == "event" and before is None:
        return json.dumps({
            "error": True,
            "content": "Event archives require 'before' (epoch milliseconds timestamp).",
        })
    if archive_type == "event" and archive_keys:
        return json.dumps({
            "error": True,
            "content": "archive_keys is only valid for certificate archives.",
        })
    return None


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_archive_tools(mcp: FastMCP) -> None:
    """Register all 8 archive management tools on *mcp*."""

    # ===================================================================
    # List & Get (2 tools)
    # ===================================================================

    @mcp.tool()
    async def list_archives(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List archives with optional name filtering.

        Safety tier: read-only

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on archive name.

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        data = await client.get(_ARCHIVE_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )
        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="archive")

    @mcp.tool()
    async def get_archive(name: str) -> str:
        """Get a single archive by name.

        Safety tier: read-only

        Args:
            name: Exact archive name.

        Returns:
            JSON representation of the archive including its type, status,
            filter/before criteria, and progress information.
        """
        client = get_client()
        result = await client.get(f"{_ARCHIVE_BASE}/{name}")
        return json.dumps(result)

    # ===================================================================
    # Create (1 tool — no update route exists for archives)
    # ===================================================================

    @mcp.tool()
    async def create_archive(
        name: str,
        archive_type: str,
        filename: str,
        filter: str | None = None,
        before: int | None = None,
        archive_keys: bool = False,
        purge_at: int | None = None,
    ) -> str:
        """Create a new certificate or event archive.

        Safety tier: mutating-safe
        See also: count_archive_matches (preview match count before creating),
            get_archive (check archive status after creation),
            download_archive (download completed archive).

        Archives are discriminated by type:
        - 'certificate': requires 'filter' (an HCQL query string selecting
          which certificates to archive). HCQL field names are ALL LOWERCASE
          (keytype, contactemail, signingalgorithm — NOT keyType, contactEmail).
          Example: filter="status is expired and valid.until before 90d"
          WRONG: "notAfter before 90d" → CORRECT: "valid.until before 90d"
          Optionally set archive_keys=True to include private keys.
        - 'event': requires 'before' (epoch milliseconds timestamp). All
          events older than this timestamp will be archived.

        The 'before' timestamp must be sufficiently in the past (older than
        server grace period). Example: before=1704067200000 (2024-01-01T00:00:00Z).

        NOTE: Archives have NO update route. To change parameters, delete
        and recreate.

        Args:
            name: Unique archive name.
            archive_type: Archive type — 'certificate' or 'event'.
            filename: Output filename for the archive.
            filter: HCQL query string (required for certificate archives).
            before: Epoch milliseconds timestamp (required for event archives).
            archive_keys: Include private keys (certificate archives only,
                default false).
            purge_at: Optional epoch milliseconds timestamp for automatic
                purge scheduling.

        Returns:
            JSON representation of the created archive.
        """
        error = _validate_archive_params(archive_type, filter, before, archive_keys)
        if error is not None:
            return error

        payload: dict[str, Any] = {
            "name": name,
            "type": archive_type,
            "filename": filename,
        }
        if filter is not None:
            payload["filter"] = filter
        if before is not None:
            payload["before"] = before
        if archive_keys:
            payload["archiveKeys"] = archive_keys
        if purge_at is not None:
            payload["purgeAt"] = purge_at

        client = get_client()
        result = await client.post(_ARCHIVE_BASE, json=payload)
        return build_mutate_response(
            action="created", kind="archive", name=name, data=result,
        )

    # ===================================================================
    # Download (1 tool)
    # ===================================================================

    @mcp.tool()
    async def download_archive(name: str) -> str:
        """Download an archive's contents.

        Safety tier: read-only

        Returns the raw archive data as a base64-encoded string. The
        caller is responsible for decoding and saving the file.

        Args:
            name: Exact archive name.

        Returns:
            JSON with name, base64-encoded content, and byte size.
        """
        client = get_client()
        raw = await client.get_bytes(f"{_ARCHIVE_BASE}/{name}/download")
        encoded = base64.b64encode(raw).decode("ascii")
        return json.dumps({
            "name": name,
            "content_base64": encoded,
            "size_bytes": len(raw),
        })

    # ===================================================================
    # Delete (1 tool)
    # ===================================================================

    @mcp.tool()
    async def delete_archive(name: str, expected_name: str) -> str:
        """Delete an archive. Requires name confirmation.

        Safety tier: mutating-destructive

        IMPORTANT: Before executing this operation, always confirm the
        action with the end-user first.

        Args:
            name: Archive name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"{_ARCHIVE_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "archive",
        })

    # ===================================================================
    # Lifecycle actions (2 tools)
    # ===================================================================

    @mcp.tool()
    async def retry_archive(name: str) -> str:
        """Retry a failed archive.

        Safety tier: mutating-safe

        Re-triggers the archive process for an archive that previously
        failed. Only applicable to archives in a failed state.

        Args:
            name: Exact archive name to retry.

        Returns:
            JSON representation of the retried archive.
        """
        client = get_client()
        result = await client.get(f"{_ARCHIVE_BASE}/{name}/retry")
        return json.dumps(result)

    @mcp.tool()
    async def cancel_archive(name: str) -> str:
        """Cancel a running archive.

        Safety tier: mutating-safe

        Cancels an archive that is currently in progress. Only applicable
        to archives in a running state.

        Args:
            name: Exact archive name to cancel.

        Returns:
            JSON representation of the cancelled archive.
        """
        client = get_client()
        result = await client.get(f"{_ARCHIVE_BASE}/{name}/cancel")
        return json.dumps(result)

    # ===================================================================
    # Count (1 tool)
    # ===================================================================

    @mcp.tool()
    async def count_archive_matches(
        archive_type: str,
        filter: str | None = None,
        before: int | None = None,
    ) -> str:
        """Count items matching archive criteria without creating an archive.

        Safety tier: read-only

        Useful for previewing how many certificates or events would be
        included in an archive before actually creating it.

        Args:
            archive_type: Archive type — 'certificate' or 'event'.
            filter: HCQL query string (required for certificate type).
                HCQL field names are ALL LOWERCASE (keytype, contactemail — NOT keyType, contactEmail).
                Example: "status is valid and keytype contains \"rsa\""
            before: Epoch milliseconds timestamp (required for event type).

        Returns:
            JSON with the match count and the criteria used.
        """
        error = _validate_archive_params(archive_type, filter, before)
        if error is not None:
            return error

        payload: dict[str, Any] = {"type": archive_type}
        if filter is not None:
            payload["filter"] = filter
        if before is not None:
            payload["before"] = before

        client = get_client()
        result = await client.post(f"{_ARCHIVE_BASE}/count", json=payload)
        return json.dumps(result)
