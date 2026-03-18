"""Discovery event tools: search, get, and CSV export.

3 MCP tools for Horizon discovery events (HDQL query language):
  - search_discovery_events: paginated search with analytics toggle
  - get_discovery_event: single event by ID
  - export_discovery_events_csv: bounded CSV export
"""

from __future__ import annotations

import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.state import get_client

logger = logging.getLogger("horizon_mcp.tools.discovery_events")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MAX_PAGE_SIZE = 100
_MAX_CSV_ROWS = 1000
_CSV_TIMEOUT = 120

# ---------------------------------------------------------------------------
# Payload builders (local copies  -  same logic as lifecycle.py)
# ---------------------------------------------------------------------------


def _build_sorted_by(sorted_by: str | None) -> list[dict[str, str]] | None:
    """Convert 'field:Asc' to [{"element": "field", "order": "Asc"}].

    Accepts: 'element', 'element:Asc', 'element:Desc'.
    """
    if not sorted_by:
        return None
    parts = sorted_by.split(":", 1)
    element = parts[0].strip()
    order = parts[1].strip().capitalize() if len(parts) > 1 else "Asc"
    if order not in ("Asc", "Desc"):
        order = "Asc"
    return [{"element": element, "order": order}]


def _build_search_payload(
    query: str,
    fields: list[str] | None,
    page_index: int,
    page_size: int,
    sorted_by: str | None,
    with_count: bool,
) -> dict[str, Any]:
    """Build the JSON payload for a Horizon search endpoint."""
    page_size = min(page_size, _MAX_PAGE_SIZE)
    payload: dict[str, Any] = {
        "query": query,
        "pageIndex": page_index,
        "pageSize": page_size,
    }
    if fields:
        payload["fields"] = fields
    sorted_list = _build_sorted_by(sorted_by)
    if sorted_list:
        payload["sortedBy"] = sorted_list
    if with_count:
        payload["withCount"] = True
    return payload


def _build_export_payload(
    query: str,
    fields: list[str] | None,
    sorted_by: str | None,
) -> dict[str, Any]:
    """Build the JSON payload for a Horizon CSV export endpoint."""
    payload: dict[str, Any] = {"query": query}
    if fields:
        payload["fields"] = fields
    sorted_list = _build_sorted_by(sorted_by)
    if sorted_list:
        payload["sortedBy"] = sorted_list
    return payload


def _csv_truncation_metadata(csv_text: str) -> dict[str, Any]:
    """Build truncation metadata for a CSV export."""
    lines = csv_text.strip().splitlines()
    row_count = max(0, len(lines) - 1) if lines else 0
    return {
        "truncated": row_count >= _MAX_CSV_ROWS,
        "returned_rows": row_count,
        "max_rows": _MAX_CSV_ROWS,
    }


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def register_discovery_event_tools(mcp: FastMCP) -> None:
    """Register all 3 discovery event tools on the given FastMCP server."""

    # ===================================================================
    # Search discovery events
    # ===================================================================

    @mcp.tool()
    async def search_discovery_events(
        query: str,
        page_index: int = 0,
        page_size: int = 25,
        sorted_by: str | None = None,
        with_count: bool = False,
        enable_analytics: bool = True,
    ) -> str:
        """Search discovery events using HDQL query language.

        HDQL syntax -- use 'equals', 'before', 'after', NOT =, <, >.
        IMPORTANT: HDQL field names are ALL LOWERCASE
        (certificateid, sessionid, timestamp  -  NOT certificateId, sessionId).
        Examples:
          timestamp after -24h
          certificateid equals "abc123"
          error.code equals "TIMEOUT" and client.ip contains "10.0"
          sessionid equals "scan-session-id"
        Full reference: horizon://knowledge/query-languages

        HDQL fields: timestamp, certificateid, sessionid, error.code, client.*
        sorted_by format: 'element' or 'element:Desc'.

        Args:
            query: HDQL query string.
            page_index: Zero-based page index (default 0).
            page_size: Results per page, max 100 (default 25).
            sorted_by: Sort specification, e.g. 'timestamp:Desc'.
            with_count: Include total count in response (slower).
            enable_analytics: Enable analytics on the search (default True).
        """
        client = get_client()
        payload = _build_search_payload(
            query, None, page_index, page_size, sorted_by, with_count,
        )
        path = (
            f"/api/v1/discovery/events/search"
            f"?enableAnalytics={str(enable_analytics).lower()}"
        )
        result = await client.post(path, json=payload)

        records = result.get("results", result.get("items", []))
        response: dict[str, Any] = {"results": records}
        if "count" in result:
            response["count"] = result["count"]
        if "hasMore" in result:
            response["hasMore"] = result["hasMore"]
        response["pageIndex"] = page_index
        response["pageSize"] = min(page_size, _MAX_PAGE_SIZE)
        return json.dumps(response, default=str)

    # ===================================================================
    # Get single discovery event
    # ===================================================================

    @mcp.tool()
    async def get_discovery_event(event_id: str) -> str:
        """Get full details of a discovery event by ID.

        Returns the complete discovery event record including certificate
        data, session info, client details, and any error information.

        Args:
            event_id: The discovery event ID.
        """
        client = get_client()
        result = await client.get(f"/api/v1/discovery/events/{event_id}")
        return json.dumps(result, default=str)

    # ===================================================================
    # Export discovery events as CSV
    # ===================================================================

    @mcp.tool()
    async def export_discovery_events_csv(
        query: str,
        fields: list[str] | None = None,
        sorted_by: str | None = None,
        enable_analytics: bool = True,
    ) -> str:
        """Export discovery events matching an HDQL query as CSV.

        Returns up to 1000 rows. For full exports use Horizon UI.

        HDQL syntax -- use 'equals', 'before', 'after', NOT =, <, >.
        IMPORTANT: HDQL field names are ALL LOWERCASE (certificateid, sessionid  -  NOT certificateId, sessionId).
        Example: timestamp after -7d and error.code equals "TIMEOUT"
        Full reference: horizon://knowledge/query-languages

        Args:
            query: HDQL query string.
            fields: Specific fields to include in the CSV columns.
            sorted_by: Sort specification, e.g. 'timestamp:Desc'.
            enable_analytics: Enable analytics on the export (default True).
        """
        client = get_client()
        payload = _build_export_payload(query, fields, sorted_by)
        path = (
            f"/api/v1/discovery/events/csv"
            f"?enableAnalytics={str(enable_analytics).lower()}"
        )
        resp = await client._request(  # noqa: SLF001
            "POST", path, json=payload, timeout_override=_CSV_TIMEOUT,
        )
        csv_text = resp.text

        metadata = _csv_truncation_metadata(csv_text)
        return json.dumps({
            "csv": csv_text,
            **metadata,
        }, default=str)
