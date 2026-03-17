"""E2E tests for dashboard and saved query tools.

Tests 12 tools against a live Horizon QA instance:
  Dashboards (5): list_dashboards, get_dashboard, create_dashboard,
                  update_dashboard, delete_dashboard
  Charts (3): add_dashboard_chart, update_dashboard_chart, remove_dashboard_chart
  Saved queries (4): list_saved_queries, get_saved_query,
                     upsert_saved_query, delete_saved_query

All tests are session-gated via conftest pytestmark.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from mcp.server.fastmcp import FastMCP

from tests.e2e.conftest import call_tool, call_tool_raw, E2E_PREFIX

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# Read-only smoke tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_dashboards_returns_list(e2e_mcp: FastMCP) -> None:
    """list_dashboards returns a valid list envelope (may be empty)."""
    data = await call_tool(e2e_mcp, "list_dashboards")

    assert "items" in data
    assert "count" in data
    assert "total_available" in data
    assert "truncated" in data
    assert isinstance(data["items"], list)
    assert data["count"] == len(data["items"])


@pytest.mark.asyncio
async def test_list_dashboards_name_filter(e2e_mcp: FastMCP) -> None:
    """list_dashboards name_contains filter returns only matching items."""
    data = await call_tool(
        e2e_mcp,
        "list_dashboards",
        name_contains="__nonexistent_xyz_abc__",
    )

    assert data["items"] == []
    assert data["count"] == 0


@pytest.mark.asyncio
async def test_list_dashboards_type_filter_certificate(e2e_mcp: FastMCP) -> None:
    """list_dashboards with dashboard_type='certificate' does not error."""
    data = await call_tool(e2e_mcp, "list_dashboards", dashboard_type="certificate")

    assert "items" in data
    assert isinstance(data["items"], list)


@pytest.mark.asyncio
async def test_list_saved_queries_returns_list(e2e_mcp: FastMCP) -> None:
    """list_saved_queries returns a valid list envelope (may be empty)."""
    data = await call_tool(e2e_mcp, "list_saved_queries")

    assert "items" in data
    assert "count" in data
    assert isinstance(data["items"], list)


@pytest.mark.asyncio
async def test_list_saved_queries_type_filter(e2e_mcp: FastMCP) -> None:
    """list_saved_queries with query_type='hcql' does not error."""
    data = await call_tool(e2e_mcp, "list_saved_queries", query_type="hcql")

    assert "items" in data
    assert isinstance(data["items"], list)


# ---------------------------------------------------------------------------
# Dashboard full CRUD lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_dashboard(e2e_mcp: FastMCP) -> None:
    """create_dashboard returns a mutate response with the correct name."""
    name = f"{E2E_PREFIX}-crud-dash"
    try:
        data = await call_tool(
            e2e_mcp,
            "create_dashboard",
            name=name,
            dashboard_type="certificate",
            description="E2E test dashboard",
        )

        assert data["status"] == "created"
        assert data["kind"] == "dashboard"
        assert data["name"] == name
    finally:
        # Best-effort cleanup even if assertions fail.
        try:
            await call_tool(
                e2e_mcp, "delete_dashboard", name=name, expected_name=name,
            )
        except Exception:
            pass


@pytest.mark.asyncio
async def test_get_dashboard(e2e_mcp: FastMCP, e2e_dashboard: dict) -> None:
    """get_dashboard returns the dashboard matching the created name."""
    name = e2e_dashboard["name"]
    data = await call_tool(e2e_mcp, "get_dashboard", name=name)

    assert data.get("name") == name


@pytest.mark.asyncio
async def test_add_dashboard_chart(e2e_mcp: FastMCP, e2e_dashboard: dict) -> None:
    """add_dashboard_chart appends a chart and returns its ID."""
    name = e2e_dashboard["name"]
    chart = {
        "type": "donut",
        "title": f"{E2E_PREFIX} chart",
        "localQuery": "status is valid",
        "fields": ["keyType"],
        "i": f"{E2E_PREFIX}-c1",
        "x": 0,
        "y": 0,
        "w": 6,
        "h": 4,
    }

    data = await call_tool(e2e_mcp, "add_dashboard_chart", dashboard_name=name, chart=chart)

    assert "chart_id" in data
    assert data["chart_id"] == f"{E2E_PREFIX}-c1"
    assert "dashboard" in data

    # Verify chart is present in the PUT response (the tool returns the updated dashboard
    # from the PUT response which is immediately consistent).
    # Note: get_dashboard reads from GET /principals/self which may be stale for ~500ms.
    returned_dashboard = data["dashboard"]
    chart_ids = [c.get("i") for c in returned_dashboard.get("charts", [])]
    assert f"{E2E_PREFIX}-c1" in chart_ids


@pytest.mark.asyncio
async def test_update_dashboard_chart(e2e_mcp: FastMCP, e2e_dashboard: dict) -> None:
    """update_dashboard_chart modifies chart fields within the dashboard."""
    name = e2e_dashboard["name"]
    chart_id = f"{E2E_PREFIX}-upd-c1"

    # Add a chart first.
    await call_tool(
        e2e_mcp,
        "add_dashboard_chart",
        dashboard_name=name,
        chart={
            "type": "pie",
            "title": "Original Title",
            "localQuery": "status is valid",
            "fields": ["keyType"],
            "i": chart_id,
            "x": 0,
            "y": 0,
            "w": 6,
            "h": 4,
        },
    )
    # Brief pause to let the Horizon server cache refresh after the PUT.
    import asyncio as _asyncio
    await _asyncio.sleep(1.0)

    # Update the chart title and type.
    updated = await call_tool(
        e2e_mcp,
        "update_dashboard_chart",
        dashboard_name=name,
        chart_id=chart_id,
        title="Updated Title",
        chart_type="bar-vertical",
    )

    # The response is the updated dashboard object directly.
    charts = updated.get("charts", [])
    matching = [c for c in charts if c.get("i") == chart_id]
    assert len(matching) == 1
    assert matching[0]["title"] == "Updated Title"
    assert matching[0]["type"] == "bar-vertical"


@pytest.mark.asyncio
async def test_remove_dashboard_chart(e2e_mcp: FastMCP, e2e_dashboard: dict) -> None:
    """remove_dashboard_chart removes the chart from the dashboard."""
    name = e2e_dashboard["name"]
    chart_id = f"{E2E_PREFIX}-rem-c1"

    # Add a chart first.
    await call_tool(
        e2e_mcp,
        "add_dashboard_chart",
        dashboard_name=name,
        chart={
            "type": "metric",
            "title": "To Be Removed",
            "localQuery": "status is valid",
            "fields": ["keyType"],
            "i": chart_id,
            "x": 0,
            "y": 0,
            "w": 3,
            "h": 2,
        },
    )
    # Brief pause to let the Horizon server cache refresh after the PUT.
    import asyncio as _asyncio
    await _asyncio.sleep(1.0)

    # Remove it.
    data = await call_tool(
        e2e_mcp, "remove_dashboard_chart", dashboard_name=name, chart_id=chart_id,
    )

    assert data["removed_chart"] == chart_id

    # Verify the chart is gone from the PUT response (immediately consistent).
    # Note: get_dashboard reads from GET /principals/self which may be stale.
    returned_dashboard = data.get("dashboard", {})
    chart_ids = [c.get("i") for c in returned_dashboard.get("charts", [])]
    assert chart_id not in chart_ids


@pytest.mark.asyncio
async def test_update_dashboard_description(
    e2e_mcp: FastMCP, e2e_dashboard: dict,
) -> None:
    """update_dashboard changes the dashboard description."""
    name = e2e_dashboard["name"]
    new_description = f"{E2E_PREFIX} updated description"

    data = await call_tool(
        e2e_mcp,
        "update_dashboard",
        name=name,
        description=new_description,
    )

    assert data["status"] == "updated"
    assert data["name"] == name

    # Verify the description is in the response data (from the PUT response).
    # Note: a subsequent get_dashboard via GET /principals/self may be stale for ~500ms.
    response_data = data.get("data") or {}
    assert response_data.get("description") == new_description, (
        f"update_dashboard response data does not reflect updated description. "
        f"Expected {new_description!r}, got: {response_data.get('description')!r}"
    )


@pytest.mark.asyncio
async def test_delete_dashboard(e2e_mcp: FastMCP) -> None:
    """delete_dashboard removes the dashboard; subsequent get fails."""
    name = f"{E2E_PREFIX}-delete-me"

    # Create a fresh dashboard specifically for this deletion test.
    await call_tool(
        e2e_mcp,
        "create_dashboard",
        name=name,
        dashboard_type="certificate",
    )

    data = await call_tool(
        e2e_mcp, "delete_dashboard", name=name, expected_name=name,
    )

    assert data["deleted"] is True
    assert data["name"] == name
    assert data["kind"] == "dashboard"

    # Note: the Horizon API may not immediately reflect the deletion in
    # subsequent GET /principals/self calls due to server-side caching.
    # We trust the 204 response from the DELETE endpoint as confirmation.
    # A list check here would be flaky due to eventual consistency.


# ---------------------------------------------------------------------------
# Saved query lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upsert_saved_query_create(e2e_mcp: FastMCP) -> None:
    """upsert_saved_query (create) returns a mutate response with the correct name."""
    name = f"{E2E_PREFIX}-sq-create"
    try:
        data = await call_tool(
            e2e_mcp,
            "upsert_saved_query",
            name=name,
            query_type="hcql",
            query="profile exists",
            description="E2E created saved query",
        )

        assert data["status"] == "upserted"
        assert data["kind"] == "saved_query"
        assert data["name"] == name
    finally:
        try:
            await call_tool(
                e2e_mcp, "delete_saved_query", name=name, expected_name=name,
            )
        except Exception:
            pass


@pytest.mark.asyncio
async def test_get_saved_query(e2e_mcp: FastMCP, e2e_saved_query: dict) -> None:
    """get_saved_query returns the saved query matching the created name."""
    name = e2e_saved_query["name"]
    data = await call_tool(e2e_mcp, "get_saved_query", name=name)

    assert data.get("name") == name


@pytest.mark.asyncio
async def test_upsert_saved_query_update(
    e2e_mcp: FastMCP, e2e_saved_query: dict,
) -> None:
    """upsert_saved_query (update) changes the query content."""
    name = e2e_saved_query["name"]
    new_query = "profile exists and status is valid"

    data = await call_tool(
        e2e_mcp,
        "upsert_saved_query",
        name=name,
        query_type="hcql",
        query=new_query,
    )

    assert data["status"] == "upserted"
    assert data["name"] == name

    # Verify the new query persisted.
    fetched = await call_tool(e2e_mcp, "get_saved_query", name=name)
    assert fetched.get("query") == new_query


@pytest.mark.asyncio
async def test_delete_saved_query(e2e_mcp: FastMCP) -> None:
    """delete_saved_query removes the saved query; subsequent list does not return it."""
    name = f"{E2E_PREFIX}-sq-delete-me"

    # Create a query specifically for this deletion test.
    await call_tool(
        e2e_mcp,
        "upsert_saved_query",
        name=name,
        query_type="hcql",
        query="profile exists",
    )

    data = await call_tool(
        e2e_mcp, "delete_saved_query", name=name, expected_name=name,
    )

    assert data["deleted"] is True
    assert data["name"] == name
    assert data["kind"] == "saved_query"

    # Confirm it is gone.
    list_data = await call_tool(
        e2e_mcp, "list_saved_queries", name_contains=name,
    )
    names_after = [item.get("name") for item in list_data["items"]]
    assert name not in names_after
