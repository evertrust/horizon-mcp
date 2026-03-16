"""Dashboard and saved query tools for Horizon MCP Server.

12 tools covering:
  - Dashboards (5): list, get, create, update, delete
  - Chart-level operations (3): add, update, remove
  - Saved queries (4): list, get, upsert, delete

Dashboards are personal/principal-scoped, embedded in PrincipalInfo.
No _id field, no STRIP_FIELDS needed — the full object round-trips as-is.
HTTP 204 from Horizon means "empty collection", not an error.

Knowledge resources:
    - horizon://knowledge/dashboards
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from mcp.server.fastmcp import FastMCP

from horizon_mcp.client.state import get_client
from horizon_mcp.client.errors import HorizonError
from horizon_mcp.tools._helpers import (
    build_mutate_response,
    delete_guard,
    apply_name_filter,
    build_list_response,
)

logger = logging.getLogger("horizon_mcp.tools.dashboards")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DASHBOARD_BASE = "/api/v1/security/principals/dashboards"
_QUERY_BASE = "/api/v1/security/principals/queries"

_DASHBOARD_TYPES = ("certificate", "request")
_QUERY_TYPES = ("hcql", "hrql", "heql", "hdql", "hpql")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _empty_list_response(kind: str) -> str:
    """Return a canonical empty-list JSON response."""
    return json.dumps({
        "items": [],
        "count": 0,
        "total_available": 0,
        "truncated": False,
        "kind": kind,
    })


def _find_chart_index(
    charts: list[dict[str, Any]], chart_id: str,
) -> int:
    """Return the index of the chart with ``i == chart_id``, or -1."""
    for idx, chart in enumerate(charts):
        if chart.get("i") == chart_id:
            return idx
    return -1


async def _fetch_dashboard_by_name(name: str) -> dict[str, Any]:
    """Fetch a single dashboard by listing all and filtering by name.

    Dashboards are embedded in the principal's ``customDashboards`` array
    (returned by ``GET /api/v1/security/principals/self``). There is no
    individual GET-by-name endpoint. This helper fetches the principal,
    extracts ``customDashboards``, and returns the one matching *name*.

    Raises :class:`HorizonError` (404) if no dashboard matches.
    """
    client = get_client()
    principal = await client.get("/api/v1/security/principals/self")

    dashboards: list[dict[str, Any]] = principal.get("customDashboards") or []

    if not dashboards:
        raise HorizonError(
            status_code=404,
            message=f"Dashboard '{name}' not found (no dashboards exist).",
            remediation="Use create_dashboard to create one.",
        )

    for item in dashboards:
        if item.get("name") == name:
            return item

    available = [d.get("name", "?") for d in dashboards]
    raise HorizonError(
        status_code=404,
        message=f"Dashboard '{name}' not found.",
        detail=f"Available dashboards: {available}",
        remediation="Use list_dashboards to see available dashboards.",
    )


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_dashboard_tools(mcp: FastMCP) -> None:
    """Register all 12 dashboard and saved query tools on *mcp*."""

    # ===================================================================
    # Dashboard CRUD (5 tools)
    # ===================================================================

    @mcp.tool()
    async def list_dashboards(
        max_items: int = 50,
        name_contains: str | None = None,
        dashboard_type: str | None = None,
    ) -> str:
        """List personal dashboards with optional filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/dashboards

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on dashboard name.
            dashboard_type: Filter by type — "certificate" or "request".

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        if dashboard_type and dashboard_type not in _DASHBOARD_TYPES:
            return json.dumps({
                "error": f"Invalid dashboard_type '{dashboard_type}'.",
                "valid_types": list(_DASHBOARD_TYPES),
            })

        client = get_client()
        principal = await client.get("/api/v1/security/principals/self")
        data: list[dict[str, Any]] = principal.get("customDashboards") or []

        if not data:
            return _empty_list_response("dashboard")

        items: list[dict[str, Any]] = data
        if dashboard_type:
            items = [d for d in items if d.get("type") == dashboard_type]
        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="dashboard")

    @mcp.tool()
    async def get_dashboard(name: str) -> str:
        """Get a single dashboard by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/dashboards

        Args:
            name: Exact dashboard name.

        Returns:
            JSON representation of the dashboard including its charts.
        """
        result = await _fetch_dashboard_by_name(name)
        return json.dumps(result)

    @mcp.tool()
    async def create_dashboard(
        name: str,
        dashboard_type: str,
        charts: list[dict[str, Any]] | None = None,
        description: str | None = None,
    ) -> str:
        """Create a new personal dashboard.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/dashboards

        IMPORTANT — The dashboard name is IMMUTABLE: it CANNOT be changed
        after creation. You MUST ask the user for the name (and optionally
        a description) before calling this tool. Never invent a name on the
        user's behalf.

        Dashboard Creation Workflow (recommended):
        1) Ask the user for the dashboard name and optional description
        2) Create a blank dashboard with charts=[]
        3) Use add_dashboard_chart to add charts one at a time,
           prompting the user for each chart's configuration.

        See also: add_dashboard_chart (add charts one by one after creation),
            upsert_saved_query (save queries for reuse in charts).

        Args:
            name: Unique dashboard name (IMMUTABLE — cannot be renamed later).
            dashboard_type: Dashboard scope — "certificate" or "request".
            charts: List of chart objects (default: empty list for blank dashboard).
                Each chart: {"type": "donut", "title": "My Chart",
                "localQuery": "status is valid", "fields": ["keyType"],
                "i": "1", "x": 0, "y": 0, "w": 6, "h": 4}.
                Recommended: start with charts=[] and use add_dashboard_chart interactively.
            description: Optional human-readable description.

        Returns:
            JSON representation of the created dashboard.
        """
        if dashboard_type not in _DASHBOARD_TYPES:
            return json.dumps({
                "error": f"Invalid dashboard_type '{dashboard_type}'.",
                "valid_types": list(_DASHBOARD_TYPES),
            })

        client = get_client()

        payload: dict[str, Any] = {
            "name": name,
            "type": dashboard_type,
            "charts": charts if charts is not None else [],
        }
        if description is not None:
            payload["description"] = description

        result = await client.put(_DASHBOARD_BASE, json=payload)
        return build_mutate_response(action="created", kind="dashboard", name=name, data=result)

    @mcp.tool()
    async def update_dashboard(
        name: str,
        charts: list[dict[str, Any]] | None = None,
        description: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an existing dashboard (GET -> merge -> PUT).

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/dashboards

        Fetches the current dashboard, merges provided overrides, and
        PUTs the full object back. No field stripping needed — dashboards
        are principal-scoped with no server-injected metadata.

        Args:
            name: Dashboard name to update.
            charts: New charts list (replaces existing).
            description: New description.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON representation of the updated dashboard.
        """
        existing = await _fetch_dashboard_by_name(name)

        if charts is not None:
            existing["charts"] = charts
        if description is not None:
            existing["description"] = description
        for field in (clear_fields or []):
            existing[field] = None

        client = get_client()
        result = await client.put(_DASHBOARD_BASE, json=existing)
        return build_mutate_response(action="updated", kind="dashboard", name=name, data=result)

    @mcp.tool()
    async def delete_dashboard(name: str, expected_name: str) -> str:
        """Delete a dashboard. Requires name confirmation.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/dashboards

        Args:
            name: Dashboard name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(name, expected_name)

        client = get_client()
        await client.delete(f"{_DASHBOARD_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "dashboard",
        })

    # ===================================================================
    # Chart-level operations (3 tools)
    # ===================================================================

    @mcp.tool()
    async def add_dashboard_chart(
        dashboard_name: str,
        chart: dict[str, Any],
    ) -> str:
        """Add a chart to an existing dashboard.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/dashboards

        Prerequisites: Dashboard must exist (use create_dashboard first).

        Fetches the dashboard, appends the chart to its charts list,
        and PUTs the updated dashboard back. Auto-generates a unique
        chart identifier if the chart does not already include one.

        Args:
            dashboard_name: Name of the dashboard to modify.
            chart: Chart configuration object. Required fields:
                {"type": "donut", "title": "My Chart",
                "localQuery": "status is valid", "fields": ["keyType"]}.
                Valid chart types: area, donut, heatmap, bar-horizontal,
                line, metric, pie, polar, pyramid, radar, table, treemap,
                bar-vertical.
                Optional layout: "x", "y", "w", "h", "i" (grid position/size/id).
                Optional: "limit" (max buckets), "sortOrder" ("Asc"|"Desc"|"KeyAsc"|"KeyDesc"),
                "direction" ("asc"|"desc"), "colors" (["#A6ADF7", "#4D54A2", ...]),
                "log" (boolean — logarithmic scale), "description" (string).
                Full example:
                {"type": "bar-vertical", "title": "Grades", "fields": ["grade.MyPolicy"],
                "localQuery": "status is valid", "sortOrder": "KeyAsc",
                "colors": ["#A6ADF7", "#4D54A2"], "log": false,
                "i": "1", "x": 0, "y": 0, "w": 6, "h": 4}

        Returns:
            JSON with the assigned chart identifier and updated dashboard.
        """
        chart.setdefault("i", f"chart-{uuid.uuid4().hex[:8]}")
        chart_id = chart["i"]

        existing = await _fetch_dashboard_by_name(dashboard_name)

        charts: list[dict[str, Any]] = existing.get("charts", [])
        charts.append(chart)
        existing["charts"] = charts

        client = get_client()
        result = await client.put(_DASHBOARD_BASE, json=existing)
        return json.dumps({
            "chart_id": chart_id,
            "dashboard": result,
        })

    @mcp.tool()
    async def update_dashboard_chart(
        dashboard_name: str,
        chart_id: str,
        title: str | None = None,
        chart_type: str | None = None,
        local_query: str | None = None,
        fields: list[str] | None = None,
        limit: int | None = None,
        having: dict[str, Any] | None = None,
        sort_order: str | None = None,
        direction: str | None = None,
        colors: list[str] | None = None,
        description: str | None = None,
        x: int | None = None,
        y: int | None = None,
        w: int | None = None,
        h: int | None = None,
        logarithmic: bool | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update a single chart within a dashboard.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/dashboards

        Fetches the dashboard, locates the chart by its identifier,
        merges only the provided fields, and PUTs the dashboard back.

        Args:
            dashboard_name: Name of the dashboard containing the chart.
            chart_id: Unique chart identifier (the "i" field).
            title: New chart title.
            chart_type: Chart type — area, donut, heatmap, bar-horizontal,
                line, metric, pie, polar, pyramid, radar, table, treemap,
                or bar-vertical.
            local_query: New HQL query string for chart data.
            fields: New list of aggregation/group-by fields.
            limit: Max buckets returned (>= 0).
            having: Post-aggregation filter, e.g. {"operator": "gte", "value": 10}.
            sort_order: Data sort — "Asc", "Desc", "KeyAsc", or "KeyDesc".
            direction: Visual rendering direction — "asc" or "desc".
            colors: List of hex color codes, e.g. ["#A6ADF7", "#4D54A2"].
            description: New chart description.
            x: Grid x position (0-11).
            y: Grid y position.
            w: Grid column span (1-12).
            h: Grid row span.
            logarithmic: Enable logarithmic scale on value axis (API field: "log").
            clear_fields: Chart field names to explicitly set to null.

        Returns:
            JSON representation of the updated dashboard.
        """
        existing = await _fetch_dashboard_by_name(dashboard_name)

        charts: list[dict[str, Any]] = existing.get("charts", [])
        idx = _find_chart_index(charts, chart_id)
        if idx == -1:
            return json.dumps({
                "error": f"Chart '{chart_id}' not found in dashboard '{dashboard_name}'.",
                "hint": "Use get_dashboard to see available chart identifiers.",
            })

        target = charts[idx]

        # Merge provided overrides (API field names)
        _FIELD_MAP: dict[str, str] = {
            "title": "title",
            "chart_type": "type",
            "local_query": "localQuery",
            "fields": "fields",
            "limit": "limit",
            "having": "having",
            "sort_order": "sortOrder",
            "direction": "direction",
            "colors": "colors",
            "description": "description",
            "x": "x",
            "y": "y",
            "w": "w",
            "h": "h",
            "logarithmic": "log",
        }

        local_vars = {
            "title": title,
            "chart_type": chart_type,
            "local_query": local_query,
            "fields": fields,
            "limit": limit,
            "having": having,
            "sort_order": sort_order,
            "direction": direction,
            "colors": colors,
            "description": description,
            "x": x,
            "y": y,
            "w": w,
            "h": h,
            "logarithmic": logarithmic,
        }

        for param_name, api_key in _FIELD_MAP.items():
            value = local_vars[param_name]
            if value is not None:
                target[api_key] = value

        for field in (clear_fields or []):
            target[field] = None

        charts[idx] = target
        existing["charts"] = charts

        client = get_client()
        result = await client.put(_DASHBOARD_BASE, json=existing)
        return json.dumps(result)

    @mcp.tool()
    async def remove_dashboard_chart(
        dashboard_name: str,
        chart_id: str,
    ) -> str:
        """Remove a chart from a dashboard.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/dashboards

        Fetches the dashboard, removes the chart matching the given
        identifier, and PUTs the updated dashboard back.

        Args:
            dashboard_name: Name of the dashboard containing the chart.
            chart_id: Unique chart identifier (the "i" field) to remove.

        Returns:
            JSON confirmation with the updated dashboard.
        """
        existing = await _fetch_dashboard_by_name(dashboard_name)

        charts: list[dict[str, Any]] = existing.get("charts", [])
        idx = _find_chart_index(charts, chart_id)
        if idx == -1:
            return json.dumps({
                "error": f"Chart '{chart_id}' not found in dashboard '{dashboard_name}'.",
                "hint": "Use get_dashboard to see available chart identifiers.",
            })

        removed = charts.pop(idx)
        existing["charts"] = charts

        client = get_client()
        result = await client.put(_DASHBOARD_BASE, json=existing)
        return json.dumps({
            "removed_chart": removed.get("i"),
            "dashboard": result,
        })

    # ===================================================================
    # Saved Queries (4 tools)
    # ===================================================================

    @mcp.tool()
    async def list_saved_queries(
        max_items: int = 50,
        name_contains: str | None = None,
        query_type: str | None = None,
    ) -> str:
        """List saved HQL queries with optional filtering.

        Safety tier: read-only

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on query name.
            query_type: Filter by HQL language — "hcql", "hrql", "heql",
                "hdql", or "hpql".

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        if query_type and query_type not in _QUERY_TYPES:
            return json.dumps({
                "error": f"Invalid query_type '{query_type}'.",
                "valid_types": list(_QUERY_TYPES),
            })

        client = get_client()
        params: dict[str, str] = {}
        if query_type:
            params["type"] = query_type

        data = await client.get(_QUERY_BASE, params=params)

        if data is None:
            return _empty_list_response("saved_query")

        items: list[dict[str, Any]] = data if isinstance(data, list) else [data]
        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="saved_query")

    @mcp.tool()
    async def get_saved_query(name: str) -> str:
        """Get a single saved query by name.

        Safety tier: read-only

        Args:
            name: Exact saved query name.

        Returns:
            JSON representation of the saved query.
        """
        client = get_client()
        result = await client.get(f"{_QUERY_BASE}/{name}")
        return json.dumps(result)

    @mcp.tool()
    async def upsert_saved_query(
        name: str,
        query_type: str,
        query: str,
        description: str | None = None,
    ) -> str:
        """Create or update a saved HQL query.

        Safety tier: mutating-safe

        Uses upsert semantics — if a query with the given name exists it
        is updated, otherwise a new one is created. The server validates
        the HQL syntax for the specified query type.

        Args:
            name: Unique query name (acts as the upsert key).
            query_type: HQL language — "hcql", "hrql", "heql", "hdql", or "hpql".
            query: The HQL query string.
            description: Optional human-readable description.

        Returns:
            JSON representation of the created or updated saved query.
        """
        if query_type not in _QUERY_TYPES:
            return json.dumps({
                "error": f"Invalid query_type '{query_type}'.",
                "valid_types": list(_QUERY_TYPES),
            })

        client = get_client()

        payload: dict[str, Any] = {
            "name": name,
            "type": query_type,
            "query": query,
        }
        if description is not None:
            payload["description"] = description

        result = await client.post(_QUERY_BASE, json=payload)
        return build_mutate_response(action="upserted", kind="saved_query", name=name, data=result)

    @mcp.tool()
    async def delete_saved_query(name: str, expected_name: str) -> str:
        """Delete a saved query. Requires name confirmation.

        Safety tier: mutating-destructive

        Args:
            name: Saved query name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(name, expected_name)

        client = get_client()
        await client.delete(f"{_QUERY_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "saved_query",
        })
