"""Report management tools for Horizon MCP Server.

3 tools covering report listing, CSV download, and deletion:
  - list_reports: list reports with optional name filter and expiry toggle
  - download_report: fetch raw CSV content by report UUID
  - delete_report: delete a report by UUID with safety echo

CRITICAL path note:
  - CSV downloads use ``/reports/{uuid}`` (NO ``/api/v1`` prefix).
  - API management (list / delete) uses ``/api/v1/reports/``.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.state import get_client
from horizon_mcp.tools._helpers import delete_guard

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.reports")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_REPORT_API_BASE = "/api/v1/reports"
_REPORT_CSV_BASE = "/reports"


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_report_tools(mcp: FastMCP) -> None:
    """Register all 3 report tools on *mcp*."""

    @mcp.tool()
    async def list_reports(
        max_items: int = 50,
        report_name: str | None = None,
        expired: bool = False,
    ) -> str:
        """List available reports, optionally filtered by name.

        Safety tier: read-only

        When *report_name* is provided the server returns all report entries
        matching that name (there can be more than one).  Without a name the
        full report catalogue is returned.

        Args:
            max_items: Maximum items to return (default 50).
            report_name: Exact report name to filter on (server-side).
            expired: Include expired reports (default false).

        Returns:
            JSON with items, count, total_available, truncated flag, and kind.
        """
        client = get_client()
        params: dict[str, str] = {"expired": str(expired).lower()}
        path = (
            f"{_REPORT_API_BASE}/{report_name}"
            if report_name
            else _REPORT_API_BASE
        )
        data = await client.get(path, params=params)

        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else [data] if data else []
        )
        total = len(items)
        truncated = total > max_items
        items = items[:max_items]

        return json.dumps({
            "items": items,
            "count": len(items),
            "total_available": total,
            "truncated": truncated,
            "kind": "report",
        })

    @mcp.tool()
    async def download_report(report_uuid: str) -> str:
        """Download a report as CSV by its UUID.

        Safety tier: read-only

        CRITICAL: The CSV endpoint lives at ``/reports/{uuid}`` — there is
        NO ``/api/v1`` prefix for this path.

        Args:
            report_uuid: UUID of the report to download.

        Returns:
            JSON with a summary message, the raw CSV text, and a row count.
        """
        client = get_client()
        resp = await client._request("GET", f"{_REPORT_CSV_BASE}/{report_uuid}")
        csv_text = resp.text

        lines = csv_text.strip().splitlines()
        row_count = max(0, len(lines) - 1) if lines else 0

        return json.dumps({
            "content": f"Report {report_uuid} downloaded ({row_count} rows).",
            "csv": csv_text,
            "rows": row_count,
        })

    @mcp.tool()
    async def delete_report(report_uuid: str, expected_uuid: str) -> str:
        """Delete a report by UUID. Requires UUID confirmation.

        Safety tier: mutating-destructive

        IMPORTANT: Before executing this operation, always confirm the
        action with the end-user first.

        Args:
            report_uuid: UUID of the report to delete.
            expected_uuid: Must exactly match *report_uuid* as a deletion
                safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(report_uuid, expected_uuid, label="uuid")
        client = get_client()
        await client.delete(f"{_REPORT_API_BASE}/{report_uuid}")
        return json.dumps({
            "deleted": True,
            "uuid": report_uuid,
            "kind": "report",
        })
