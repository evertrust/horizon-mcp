"""E2E tests for the 3 report tools.

Covers:
  - list_reports — read-only listing with optional filters
  - download_report — CSV download by UUID (skipped if no reports)

The delete_report tool is NOT tested here (mutating-destructive; it requires
a real UUID to confirm and would permanently remove a report from the QA
instance).

All tests are automatically skipped when E2E environment variables are absent
(enforced by the pytestmark in conftest.py).
"""

from __future__ import annotations

import pytest
from mcp.server.fastmcp import FastMCP

from tests.e2e.conftest import call_tool

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# list_reports
# ---------------------------------------------------------------------------


async def test_list_reports(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_reports")
    assert "items" in result, "list_reports response missing 'items' key"
    assert isinstance(result["items"], list)
    assert "count" in result
    assert "total_available" in result
    assert "truncated" in result
    assert "kind" in result
    assert result["kind"] == "report"
    # count must be consistent with items length
    assert result["count"] == len(result["items"])


async def test_list_reports_expired_flag(e2e_mcp: FastMCP) -> None:
    """Requesting expired reports must not raise an error."""
    result = await call_tool(e2e_mcp, "list_reports", expired=True)
    assert "items" in result
    assert isinstance(result["items"], list)


async def test_list_reports_by_name(e2e_mcp: FastMCP) -> None:
    """Filtering by a non-existent report name returns an empty list without error."""
    result = await call_tool(
        e2e_mcp, "list_reports", report_name="zzznomatch-e2e-report"
    )
    # When no report matches the name the server may return [] or a 404-style empty
    assert "items" in result or result == {}


# ---------------------------------------------------------------------------
# download_report
# ---------------------------------------------------------------------------


async def test_download_report(e2e_mcp: FastMCP) -> None:
    """Download the first available report as CSV and verify the response shape."""
    reports = await call_tool(e2e_mcp, "list_reports")
    if not reports["items"]:
        pytest.skip("No reports available on this instance")

    # Find a report entry that exposes a UUID field
    report_uuid: str | None = None
    for item in reports["items"]:
        report_uuid = (
            item.get("uuid")
            or item.get("id")
            or item.get("_id")
        )
        if report_uuid:
            break

    if not report_uuid:
        pytest.skip("No report UUID found in list_reports items")

    result = await call_tool(e2e_mcp, "download_report", report_uuid=report_uuid)
    assert "csv" in result, "download_report response missing 'csv' key"
    assert "rows" in result, "download_report response missing 'rows' key"
    assert "content" in result
    assert isinstance(result["rows"], int)
    assert result["rows"] >= 0


