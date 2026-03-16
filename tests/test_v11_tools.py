"""Unit tests for the v1.1 tool layer — 12 new domains, 81 tools.

Strategy:
    - Mock ``get_client()`` in ``horizon_mcp.client.state`` to return an
      ``AsyncMock`` HorizonClient.
    - Register tools on a real ``FastMCP`` instance via the domain-specific
      ``register_*_tools()`` functions.
    - Invoke each tool through the FastMCP ``_tool_manager.call_tool()``
      interface (validates argument parsing exactly as the MCP runtime would).
    - Assert correct HTTP method/endpoint, payload, and response formatting.

Domains covered (12):
    Discovery campaigns — list, get, create, update, delete, flush
    Discovery events    — search, get, export CSV
    Discovery feed      — start session, feed cert, register event, end session
    Dashboards          — CRUD + chart ops + saved queries
    Reports             — list, download, delete
    Archives            — list, get, create, download, delete, retry, cancel, count
    Automation          — policies CRUD, execution policies CRUD, lifecycle
    Local identities    — CRUD + password management
    WCCE                — forest CRUD + enroll + exchange certificate
    Scheduler           — shared CRUD + thirdparty + report task creation
    System config       — system config CRUD + import/export
    Analytics           — get analytics status
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from mcp.server.fastmcp import FastMCP

from horizon_mcp.client.errors import HorizonError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_client() -> AsyncMock:
    """Return a mock HorizonClient with async HTTP methods."""
    client = AsyncMock()
    client.get = AsyncMock(return_value=[])
    client.post = AsyncMock(return_value={})
    client.put = AsyncMock(return_value={})
    client.delete = AsyncMock(return_value=None)
    client.get_text = AsyncMock(return_value="")
    client.get_bytes = AsyncMock(return_value=b"")
    client.patch = AsyncMock(return_value=None)
    # _request is used by CSV export tools
    resp_mock = MagicMock()
    resp_mock.text = ""
    client._request = AsyncMock(return_value=resp_mock)
    return client


@pytest.fixture
def patched_client(mock_client: AsyncMock):
    """Set the global client state so every ``get_client()`` call returns the mock."""
    from horizon_mcp.client.state import set_client, clear_client
    set_client(mock_client)
    yield mock_client
    clear_client()


# --- Domain fixtures ---

@pytest.fixture
def discovery_mcp(patched_client):
    mcp = FastMCP("test-discovery")
    from horizon_mcp.tools.discovery import register_discovery_campaign_tools
    register_discovery_campaign_tools(mcp)
    return mcp


@pytest.fixture
def discovery_events_mcp(patched_client):
    mcp = FastMCP("test-discovery-events")
    from horizon_mcp.tools.discovery_events import register_discovery_event_tools
    register_discovery_event_tools(mcp)
    return mcp


@pytest.fixture
def discovery_feed_mcp(patched_client):
    mcp = FastMCP("test-discovery-feed")
    from horizon_mcp.tools.discovery_feed import register_discovery_feed_tools
    register_discovery_feed_tools(mcp)
    return mcp


@pytest.fixture
def dashboard_mcp(patched_client):
    mcp = FastMCP("test-dashboards")
    from horizon_mcp.tools.dashboards import register_dashboard_tools
    register_dashboard_tools(mcp)
    return mcp


@pytest.fixture
def report_mcp(patched_client):
    mcp = FastMCP("test-reports")
    from horizon_mcp.tools.reports import register_report_tools
    register_report_tools(mcp)
    return mcp


@pytest.fixture
def archive_mcp(patched_client):
    mcp = FastMCP("test-archives")
    from horizon_mcp.tools.archives import register_archive_tools
    register_archive_tools(mcp)
    return mcp


@pytest.fixture
def automation_mcp(patched_client):
    mcp = FastMCP("test-automation")
    from horizon_mcp.tools.automation import register_automation_tools
    register_automation_tools(mcp)
    return mcp


@pytest.fixture
def local_identity_mcp(patched_client):
    mcp = FastMCP("test-local-identities")
    from horizon_mcp.tools.local_identities import register_local_identity_tools
    register_local_identity_tools(mcp)
    return mcp


@pytest.fixture
def wcce_mcp(patched_client):
    mcp = FastMCP("test-wcce")
    from horizon_mcp.tools.wcce import register_wcce_tools
    register_wcce_tools(mcp)
    return mcp


@pytest.fixture
def scheduler_mcp(patched_client):
    mcp = FastMCP("test-scheduler")
    from horizon_mcp.tools.scheduler import register_scheduler_tools
    register_scheduler_tools(mcp)
    return mcp


@pytest.fixture
def system_config_mcp(patched_client):
    mcp = FastMCP("test-system-config")
    from horizon_mcp.tools.system_config import register_system_config_tools
    register_system_config_tools(mcp)
    return mcp


@pytest.fixture
def analytics_mcp(patched_client):
    mcp = FastMCP("test-analytics")
    from horizon_mcp.tools.analytics import register_analytics_tools
    register_analytics_tools(mcp)
    return mcp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def call(mcp: FastMCP, name: str, args: dict | None = None) -> dict:
    """Invoke a tool by name, parse the JSON string result into a dict."""
    raw = await mcp._tool_manager.call_tool(name, args or {})
    return json.loads(raw)


# =========================================================================
# 1. DISCOVERY CAMPAIGNS (6 tools)
# =========================================================================

class TestDiscoveryCampaignList:
    async def test_returns_all_campaigns(self, discovery_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "net-scan-prod"},
            {"name": "net-scan-dev"},
        ]
        result = await call(discovery_mcp, "list_discovery_campaigns")
        patched_client.get.assert_awaited_once_with("/api/v1/discovery/campaigns")
        assert result["count"] == 2
        assert result["kind"] == "discovery_campaign"
        assert result["truncated"] is False

    async def test_name_filter(self, discovery_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "net-scan-prod"},
            {"name": "net-scan-dev"},
            {"name": "tls-check"},
        ]
        result = await call(discovery_mcp, "list_discovery_campaigns", {
            "name_contains": "net",
        })
        assert result["count"] == 2

    async def test_truncation(self, discovery_mcp, patched_client):
        patched_client.get.return_value = [{"name": f"camp-{i}"} for i in range(60)]
        result = await call(discovery_mcp, "list_discovery_campaigns", {"max_items": 5})
        assert result["truncated"] is True
        assert result["count"] == 5
        assert result["total_available"] == 60


class TestDiscoveryCampaignGet:
    async def test_returns_campaign(self, discovery_mcp, patched_client):
        patched_client.get.return_value = {"name": "prod-scan", "enabled": True}
        result = await call(discovery_mcp, "get_discovery_campaign", {"name": "prod-scan"})
        patched_client.get.assert_awaited_once_with("/api/v1/discovery/campaigns/prod-scan")
        assert result["name"] == "prod-scan"


class TestDiscoveryCampaignCreate:
    async def test_valid_create(self, discovery_mcp, patched_client):
        patched_client.post.return_value = {"name": "new-scan"}
        auth_levels = {
            "search": {"accessLevel": "authenticated"},
            "feed": {"accessLevel": "authorized"},
        }
        result = await call(discovery_mcp, "create_discovery_campaign", {
            "name": "new-scan",
            "authorization_levels": auth_levels,
        })
        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["name"] == "new-scan"
        assert payload["authorizationLevels"] == auth_levels
        assert payload["eventOnSuccess"] is True
        assert payload["enabled"] is True
        assert result["status"] == "created"
        assert result["kind"] == "discovery_campaign"
        assert result["name"] == "new-scan"

    async def test_dot_in_name_rejected(self, discovery_mcp, patched_client):
        result = await call(discovery_mcp, "create_discovery_campaign", {
            "name": "bad.name",
            "authorization_levels": {
                "search": {"accessLevel": "everyone"},
                "feed": {"accessLevel": "everyone"},
            },
        })
        assert "error" in result
        assert "dot" in result["hint"].lower()
        patched_client.post.assert_not_awaited()

    async def test_invalid_access_level_rejected(self, discovery_mcp, patched_client):
        result = await call(discovery_mcp, "create_discovery_campaign", {
            "name": "test",
            "authorization_levels": {
                "search": {"accessLevel": "public"},
                "feed": {"accessLevel": "everyone"},
            },
        })
        assert "error" in result
        assert "valid_values" in result
        patched_client.post.assert_not_awaited()

    async def test_missing_feed_section_rejected(self, discovery_mcp, patched_client):
        result = await call(discovery_mcp, "create_discovery_campaign", {
            "name": "test",
            "authorization_levels": {
                "search": {"accessLevel": "everyone"},
            },
        })
        assert "error" in result
        patched_client.post.assert_not_awaited()


class TestDiscoveryCampaignUpdate:
    async def test_update_merges(self, discovery_mcp, patched_client):
        patched_client.get.return_value = {
            "_id": "abc", "name": "my-scan", "enabled": True,
        }
        patched_client.put.return_value = {"name": "my-scan", "enabled": False}
        result = await call(discovery_mcp, "update_discovery_campaign", {
            "name": "my-scan",
            "enabled": False,
        })
        assert result["status"] == "updated"
        assert result["kind"] == "discovery_campaign"


class TestDiscoveryCampaignDelete:
    async def test_delete_with_matching_name(self, discovery_mcp, patched_client):
        result = await call(discovery_mcp, "delete_discovery_campaign", {
            "name": "old-scan",
            "expected_name": "old-scan",
        })
        patched_client.delete.assert_awaited_once_with(
            "/api/v1/discovery/campaigns/old-scan",
        )
        assert result["deleted"] is True

    async def test_delete_mismatch_raises(self, discovery_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(discovery_mcp, "delete_discovery_campaign", {
                "name": "scan-a",
                "expected_name": "scan-b",
            })
        patched_client.delete.assert_not_awaited()


class TestDiscoveryCampaignFlush:
    async def test_flush_with_matching_name(self, discovery_mcp, patched_client):
        result = await call(discovery_mcp, "flush_discovery_campaign", {
            "name": "old-scan",
            "expected_name": "old-scan",
        })
        patched_client.patch.assert_awaited_once_with(
            "/api/v1/discovery/campaigns/old-scan",
        )
        assert result["flushed"] is True

    async def test_flush_mismatch_raises(self, discovery_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(discovery_mcp, "flush_discovery_campaign", {
                "name": "scan-a",
                "expected_name": "scan-b",
            })
        patched_client.patch.assert_not_awaited()


# =========================================================================
# 2. DISCOVERY EVENTS (3 tools)
# =========================================================================

class TestDiscoveryEventSearch:
    async def test_basic_search(self, discovery_events_mcp, patched_client):
        patched_client.post.return_value = {
            "results": [{"id": "ev-1", "timestamp": "2025-01-01T00:00:00Z"}],
        }
        result = await call(discovery_events_mcp, "search_discovery_events", {
            "query": 'timestamp after -24h',
        })
        patched_client.post.assert_awaited_once()
        call_args = patched_client.post.call_args
        assert "/api/v1/discovery/events/search" in call_args[0][0]
        payload = call_args[1]["json"]
        assert payload["query"] == "timestamp after -24h"
        assert payload["pageSize"] == 25
        assert len(result["results"]) == 1

    async def test_page_size_capped(self, discovery_events_mcp, patched_client):
        patched_client.post.return_value = {"results": []}
        await call(discovery_events_mcp, "search_discovery_events", {
            "query": "*",
            "page_size": 500,
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["pageSize"] == 100

    async def test_sorted_by_parsed(self, discovery_events_mcp, patched_client):
        patched_client.post.return_value = {"results": []}
        await call(discovery_events_mcp, "search_discovery_events", {
            "query": "*",
            "sorted_by": "timestamp:Desc",
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["sortedBy"] == [{"element": "timestamp", "order": "Desc"}]


class TestDiscoveryEventGet:
    async def test_returns_event(self, discovery_events_mcp, patched_client):
        patched_client.get.return_value = {"id": "ev-42", "certificateid": "cert-1"}
        result = await call(discovery_events_mcp, "get_discovery_event", {
            "event_id": "ev-42",
        })
        patched_client.get.assert_awaited_once_with("/api/v1/discovery/events/ev-42")
        assert result["id"] == "ev-42"


class TestDiscoveryEventExportCsv:
    async def test_export_csv(self, discovery_events_mcp, patched_client):
        csv_text = "col1,col2\nval1,val2\nval3,val4"
        resp_mock = MagicMock()
        resp_mock.text = csv_text
        patched_client._request.return_value = resp_mock

        result = await call(discovery_events_mcp, "export_discovery_events_csv", {
            "query": "timestamp after -7d",
        })
        patched_client._request.assert_awaited_once()
        assert result["returned_rows"] == 2
        assert result["csv"] == csv_text

    async def test_export_csv_empty(self, discovery_events_mcp, patched_client):
        resp_mock = MagicMock()
        resp_mock.text = ""
        patched_client._request.return_value = resp_mock

        result = await call(discovery_events_mcp, "export_discovery_events_csv", {
            "query": "*",
        })
        assert result["returned_rows"] == 0


# =========================================================================
# 3. DISCOVERY FEED (4 tools)
# =========================================================================

class TestDiscoveryFeedStartSession:
    async def test_start_session(self, discovery_feed_mcp, patched_client):
        patched_client.get.return_value = {"id": "sess-001", "campaign": "my-camp"}
        result = await call(discovery_feed_mcp, "start_discovery_feed_session", {
            "campaign_name": "my-camp",
        })
        patched_client.get.assert_awaited_once_with("/api/v1/discovery/feed/my-camp")
        assert "sess-001" in result["content"]
        assert result["data"]["id"] == "sess-001"


class TestDiscoveryFeedCertificate:
    async def test_feed_certificate(self, discovery_feed_mcp, patched_client):
        patched_client.post.return_value = {"status": "accepted"}
        result = await call(discovery_feed_mcp, "feed_discovery_certificate", {
            "session_id": "sess-001",
            "certificate": "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----",
            "host": "server.example.com",
            "port": 443,
        })
        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["sessionId"] == "sess-001"
        assert payload["host"] == "server.example.com"
        assert payload["port"] == 443
        assert "Certificate fed" in result["content"]

    async def test_feed_with_optional_fields(self, discovery_feed_mcp, patched_client):
        patched_client.post.return_value = {}
        await call(discovery_feed_mcp, "feed_discovery_certificate", {
            "session_id": "sess-001",
            "certificate": "PEM",
            "host": "h",
            "port": 443,
            "ip": "10.0.0.1",
            "protocol": "https",
            "metadata": {"key": "value"},
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["ip"] == "10.0.0.1"
        assert payload["protocol"] == "https"
        assert payload["metadata"] == {"key": "value"}


class TestDiscoveryFeedRegisterEvent:
    async def test_register_event(self, discovery_feed_mcp, patched_client):
        patched_client.put.return_value = {"status": "ok"}
        result = await call(discovery_feed_mcp, "register_discovery_event", {
            "session_id": "sess-001",
            "data": {"type": "error", "code": "TIMEOUT"},
        })
        patched_client.put.assert_awaited_once()
        payload = patched_client.put.call_args[1]["json"]
        assert payload["sessionId"] == "sess-001"
        assert payload["type"] == "error"
        assert "registered" in result["content"]


class TestDiscoveryFeedEndSession:
    async def test_end_session(self, discovery_feed_mcp, patched_client):
        result = await call(discovery_feed_mcp, "end_discovery_feed_session", {
            "campaign_name": "my-camp",
            "session_id": "sess-001",
        })
        patched_client.delete.assert_awaited_once_with(
            "/api/v1/discovery/feed/my-camp/sess-001",
        )
        assert "ended" in result["content"]


# =========================================================================
# 4. DASHBOARDS (12 tools)
# =========================================================================

class TestDashboardList:
    async def test_returns_dashboards(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = {
            "customDashboards": [
                {"name": "ops-overview", "type": "certificate"},
                {"name": "request-monitor", "type": "request"},
            ],
        }
        result = await call(dashboard_mcp, "list_dashboards")
        assert result["count"] == 2
        assert result["kind"] == "dashboard"

    async def test_type_filter(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = {
            "customDashboards": [
                {"name": "ops-overview", "type": "certificate"},
                {"name": "request-monitor", "type": "request"},
            ],
        }
        result = await call(dashboard_mcp, "list_dashboards", {
            "dashboard_type": "certificate",
        })
        assert result["count"] == 1
        assert result["items"][0]["name"] == "ops-overview"

    async def test_invalid_type_rejected(self, dashboard_mcp, patched_client):
        result = await call(dashboard_mcp, "list_dashboards", {
            "dashboard_type": "invalid",
        })
        assert "error" in result
        assert "valid_types" in result
        patched_client.get.assert_not_awaited()

    async def test_none_response_returns_empty(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = {"customDashboards": None}
        result = await call(dashboard_mcp, "list_dashboards")
        assert result["count"] == 0
        assert result["items"] == []


class TestDashboardGet:
    async def test_returns_dashboard(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = {
            "customDashboards": [
                {"name": "my-dash", "type": "certificate", "charts": []},
            ],
        }
        result = await call(dashboard_mcp, "get_dashboard", {"name": "my-dash"})
        patched_client.get.assert_awaited_once_with(
            "/api/v1/security/principals/self",
        )
        assert result["name"] == "my-dash"

    async def test_not_found_raises(self, dashboard_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        patched_client.get.return_value = {
            "customDashboards": [
                {"name": "other-dash", "type": "certificate", "charts": []},
            ],
        }
        with pytest.raises(ToolError, match="not found"):
            await call(dashboard_mcp, "get_dashboard", {"name": "missing"})

    async def test_no_dashboards_raises(self, dashboard_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        patched_client.get.return_value = {"customDashboards": []}
        with pytest.raises(ToolError, match="no dashboards exist"):
            await call(dashboard_mcp, "get_dashboard", {"name": "any"})


class TestDashboardCreate:
    async def test_create_blank_dashboard(self, dashboard_mcp, patched_client):
        patched_client.put.return_value = {
            "name": "new-dash", "type": "certificate", "charts": [],
        }
        result = await call(dashboard_mcp, "create_dashboard", {
            "name": "new-dash",
            "dashboard_type": "certificate",
        })
        patched_client.put.assert_awaited_once()
        payload = patched_client.put.call_args[1]["json"]
        assert payload["name"] == "new-dash"
        assert payload["type"] == "certificate"
        assert payload["charts"] == []
        assert result["name"] == "new-dash"

    async def test_invalid_type_rejected(self, dashboard_mcp, patched_client):
        result = await call(dashboard_mcp, "create_dashboard", {
            "name": "bad",
            "dashboard_type": "invalid",
        })
        assert "error" in result
        patched_client.post.assert_not_awaited()


class TestDashboardUpdate:
    async def test_update_description(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = {
            "customDashboards": [
                {"name": "my-dash", "type": "certificate", "charts": []},
            ],
        }
        patched_client.put.return_value = {
            "name": "my-dash", "description": "Updated",
        }
        result = await call(dashboard_mcp, "update_dashboard", {
            "name": "my-dash",
            "description": "Updated",
        })
        patched_client.put.assert_awaited_once()
        payload = patched_client.put.call_args[1]["json"]
        assert payload["description"] == "Updated"


class TestDashboardDelete:
    async def test_delete_success(self, dashboard_mcp, patched_client):
        result = await call(dashboard_mcp, "delete_dashboard", {
            "name": "old-dash",
            "expected_name": "old-dash",
        })
        patched_client.delete.assert_awaited_once_with(
            "/api/v1/security/principals/dashboards/old-dash",
        )
        assert result["deleted"] is True

    async def test_delete_mismatch(self, dashboard_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(dashboard_mcp, "delete_dashboard", {
                "name": "dash-a",
                "expected_name": "dash-b",
            })
        patched_client.delete.assert_not_awaited()


class TestDashboardChartAdd:
    async def test_add_chart(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = {
            "customDashboards": [
                {"name": "my-dash", "type": "certificate", "charts": []},
            ],
        }
        patched_client.put.return_value = {"name": "my-dash", "charts": [{"i": "c1"}]}
        result = await call(dashboard_mcp, "add_dashboard_chart", {
            "dashboard_name": "my-dash",
            "chart": {"title": "Expiring Certs", "type": "pie"},
        })
        payload = patched_client.put.call_args[1]["json"]
        assert len(payload["charts"]) == 1
        assert "chart_id" in result


class TestDashboardChartUpdate:
    async def test_update_chart(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = {
            "customDashboards": [
                {"name": "my-dash",
                 "charts": [{"i": "c1", "title": "Old Title", "type": "pie"}]},
            ],
        }
        patched_client.put.return_value = {"name": "my-dash"}
        result = await call(dashboard_mcp, "update_dashboard_chart", {
            "dashboard_name": "my-dash",
            "chart_id": "c1",
            "title": "New Title",
        })
        payload = patched_client.put.call_args[1]["json"]
        assert payload["charts"][0]["title"] == "New Title"
        assert payload["charts"][0]["type"] == "pie"

    async def test_chart_not_found(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = {
            "customDashboards": [{"name": "my-dash", "charts": []}],
        }
        result = await call(dashboard_mcp, "update_dashboard_chart", {
            "dashboard_name": "my-dash",
            "chart_id": "nonexistent",
        })
        assert "error" in result
        patched_client.put.assert_not_awaited()


class TestDashboardChartRemove:
    async def test_remove_chart(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = {
            "customDashboards": [
                {"name": "my-dash",
                 "charts": [{"i": "c1"}, {"i": "c2"}]},
            ],
        }
        patched_client.put.return_value = {"name": "my-dash"}
        result = await call(dashboard_mcp, "remove_dashboard_chart", {
            "dashboard_name": "my-dash",
            "chart_id": "c1",
        })
        payload = patched_client.put.call_args[1]["json"]
        assert len(payload["charts"]) == 1
        assert payload["charts"][0]["i"] == "c2"
        assert result["removed_chart"] == "c1"

    async def test_remove_chart_not_found(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = {
            "customDashboards": [{"name": "my-dash", "charts": []}],
        }
        result = await call(dashboard_mcp, "remove_dashboard_chart", {
            "dashboard_name": "my-dash",
            "chart_id": "nonexistent",
        })
        assert "error" in result


class TestSavedQueryList:
    async def test_returns_queries(self, dashboard_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "expiring-certs", "type": "hcql"},
            {"name": "failed-events", "type": "heql"},
        ]
        result = await call(dashboard_mcp, "list_saved_queries")
        assert result["count"] == 2
        assert result["kind"] == "saved_query"

    async def test_invalid_type_rejected(self, dashboard_mcp, patched_client):
        result = await call(dashboard_mcp, "list_saved_queries", {
            "query_type": "sql",
        })
        assert "error" in result
        assert "valid_types" in result


class TestSavedQueryUpsert:
    async def test_create_query(self, dashboard_mcp, patched_client):
        patched_client.post.return_value = {"name": "my-query", "type": "hcql"}
        result = await call(dashboard_mcp, "upsert_saved_query", {
            "name": "my-query",
            "query_type": "hcql",
            "query": 'status is valid',
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["type"] == "hcql"
        assert payload["query"] == "status is valid"

    async def test_invalid_query_type_rejected(self, dashboard_mcp, patched_client):
        result = await call(dashboard_mcp, "upsert_saved_query", {
            "name": "bad",
            "query_type": "sql",
            "query": "SELECT *",
        })
        assert "error" in result
        patched_client.post.assert_not_awaited()


class TestSavedQueryDelete:
    async def test_delete_success(self, dashboard_mcp, patched_client):
        result = await call(dashboard_mcp, "delete_saved_query", {
            "name": "old-query",
            "expected_name": "old-query",
        })
        patched_client.delete.assert_awaited_once_with(
            "/api/v1/security/principals/queries/old-query",
        )
        assert result["deleted"] is True


# =========================================================================
# 5. REPORTS (3 tools)
# =========================================================================

class TestReportList:
    async def test_returns_reports(self, report_mcp, patched_client):
        patched_client.get.return_value = [
            {"uuid": "r1", "name": "monthly-certs"},
            {"uuid": "r2", "name": "weekly-events"},
        ]
        result = await call(report_mcp, "list_reports")
        assert result["count"] == 2
        assert result["kind"] == "report"

    async def test_filter_by_name(self, report_mcp, patched_client):
        patched_client.get.return_value = [{"uuid": "r1", "name": "monthly-certs"}]
        result = await call(report_mcp, "list_reports", {"report_name": "monthly-certs"})
        call_args = patched_client.get.call_args
        assert "monthly-certs" in call_args[0][0]


class TestReportDownload:
    async def test_download_csv(self, report_mcp, patched_client):
        csv_text = "header1,header2\nrow1a,row1b\nrow2a,row2b"
        resp_mock = MagicMock()
        resp_mock.text = csv_text
        patched_client._request.return_value = resp_mock

        result = await call(report_mcp, "download_report", {
            "report_uuid": "uuid-123",
        })
        patched_client._request.assert_awaited_once_with(
            "GET", "/reports/uuid-123",
        )
        assert result["rows"] == 2
        assert result["csv"] == csv_text


class TestReportDelete:
    async def test_delete_success(self, report_mcp, patched_client):
        result = await call(report_mcp, "delete_report", {
            "report_uuid": "uuid-123",
            "expected_uuid": "uuid-123",
        })
        patched_client.delete.assert_awaited_once_with("/api/v1/reports/uuid-123")
        assert result["deleted"] is True

    async def test_delete_mismatch(self, report_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(report_mcp, "delete_report", {
                "report_uuid": "uuid-a",
                "expected_uuid": "uuid-b",
            })
        patched_client.delete.assert_not_awaited()


# =========================================================================
# 6. ARCHIVES (8 tools)
# =========================================================================

class TestArchiveList:
    async def test_returns_archives(self, archive_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "cert-archive-2024", "type": "certificate"},
            {"name": "event-archive-2024", "type": "event"},
        ]
        result = await call(archive_mcp, "list_archives")
        patched_client.get.assert_awaited_once_with("/api/v1/archives")
        assert result["count"] == 2
        assert result["kind"] == "archive"

    async def test_name_filter(self, archive_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "cert-archive-2024"},
            {"name": "event-archive-2024"},
        ]
        result = await call(archive_mcp, "list_archives", {"name_contains": "cert"})
        assert result["count"] == 1


class TestArchiveGet:
    async def test_returns_archive(self, archive_mcp, patched_client):
        patched_client.get.return_value = {"name": "my-archive", "type": "certificate"}
        result = await call(archive_mcp, "get_archive", {"name": "my-archive"})
        patched_client.get.assert_awaited_once_with("/api/v1/archives/my-archive")
        assert result["name"] == "my-archive"


class TestArchiveCreate:
    async def test_create_certificate_archive(self, archive_mcp, patched_client):
        patched_client.post.return_value = {
            "name": "cert-2024", "type": "certificate", "status": "pending",
        }
        result = await call(archive_mcp, "create_archive", {
            "name": "cert-2024",
            "archive_type": "certificate",
            "filename": "certs-2024.zip",
            "filter": 'status is expired',
        })
        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["type"] == "certificate"
        assert payload["filter"] == "status is expired"
        assert result["name"] == "cert-2024"

    async def test_create_event_archive(self, archive_mcp, patched_client):
        patched_client.post.return_value = {"name": "ev-2024", "type": "event"}
        result = await call(archive_mcp, "create_archive", {
            "name": "ev-2024",
            "archive_type": "event",
            "filename": "events-2024.zip",
            "before": 1704067200000,
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["before"] == 1704067200000

    async def test_invalid_type_rejected(self, archive_mcp, patched_client):
        result = await call(archive_mcp, "create_archive", {
            "name": "bad",
            "archive_type": "invalid",
            "filename": "f.zip",
        })
        assert result["error"] is True
        patched_client.post.assert_not_awaited()

    async def test_cert_archive_without_filter_rejected(self, archive_mcp, patched_client):
        result = await call(archive_mcp, "create_archive", {
            "name": "bad",
            "archive_type": "certificate",
            "filename": "f.zip",
        })
        assert result["error"] is True
        patched_client.post.assert_not_awaited()

    async def test_event_archive_without_before_rejected(self, archive_mcp, patched_client):
        result = await call(archive_mcp, "create_archive", {
            "name": "bad",
            "archive_type": "event",
            "filename": "f.zip",
        })
        assert result["error"] is True
        patched_client.post.assert_not_awaited()

    async def test_event_archive_with_keys_rejected(self, archive_mcp, patched_client):
        result = await call(archive_mcp, "create_archive", {
            "name": "bad",
            "archive_type": "event",
            "filename": "f.zip",
            "before": 1704067200000,
            "archive_keys": True,
        })
        assert result["error"] is True
        patched_client.post.assert_not_awaited()


class TestArchiveDownload:
    async def test_download(self, archive_mcp, patched_client):
        patched_client.get_bytes.return_value = b"\x50\x4b\x03\x04"  # ZIP header
        result = await call(archive_mcp, "download_archive", {"name": "my-archive"})
        patched_client.get_bytes.assert_awaited_once_with(
            "/api/v1/archives/my-archive/download",
        )
        assert result["size_bytes"] == 4
        assert "content_base64" in result


class TestArchiveDelete:
    async def test_delete_success(self, archive_mcp, patched_client):
        result = await call(archive_mcp, "delete_archive", {
            "name": "old-archive",
            "expected_name": "old-archive",
        })
        patched_client.delete.assert_awaited_once_with("/api/v1/archives/old-archive")
        assert result["deleted"] is True

    async def test_delete_mismatch(self, archive_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(archive_mcp, "delete_archive", {
                "name": "arch-a",
                "expected_name": "arch-b",
            })
        patched_client.delete.assert_not_awaited()


class TestArchiveLifecycle:
    async def test_retry(self, archive_mcp, patched_client):
        patched_client.get.return_value = {"name": "failed-arch", "status": "retrying"}
        result = await call(archive_mcp, "retry_archive", {"name": "failed-arch"})
        patched_client.get.assert_awaited_once_with("/api/v1/archives/failed-arch/retry")
        assert result["status"] == "retrying"

    async def test_cancel(self, archive_mcp, patched_client):
        patched_client.get.return_value = {"name": "running-arch", "status": "cancelled"}
        result = await call(archive_mcp, "cancel_archive", {"name": "running-arch"})
        patched_client.get.assert_awaited_once_with("/api/v1/archives/running-arch/cancel")
        assert result["status"] == "cancelled"


class TestArchiveCount:
    async def test_count_cert_matches(self, archive_mcp, patched_client):
        patched_client.post.return_value = {"count": 42}
        result = await call(archive_mcp, "count_archive_matches", {
            "archive_type": "certificate",
            "filter": "status is expired",
        })
        patched_client.post.assert_awaited_once()
        call_args = patched_client.post.call_args
        assert call_args[0][0] == "/api/v1/archives/count"
        assert result["count"] == 42

    async def test_count_invalid_type(self, archive_mcp, patched_client):
        result = await call(archive_mcp, "count_archive_matches", {
            "archive_type": "invalid",
        })
        assert result["error"] is True


# =========================================================================
# 7. AUTOMATION (12 tools)
# =========================================================================

class TestAutomationPolicyList:
    async def test_returns_policies(self, automation_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "auto-renew-prod", "profile": "WebRA"},
        ]
        result = await call(automation_mcp, "list_automation_policies")
        patched_client.get.assert_awaited_once_with("/api/v1/automation/policies")
        assert result["count"] == 1
        assert result["kind"] == "automation_policy"


class TestAutomationPolicyGet:
    async def test_returns_policy(self, automation_mcp, patched_client):
        patched_client.get.return_value = {"name": "my-policy", "profile": "WebRA"}
        result = await call(automation_mcp, "get_automation_policy", {"name": "my-policy"})
        patched_client.get.assert_awaited_once_with("/api/v1/automation/policies/my-policy")
        assert result["name"] == "my-policy"


class TestAutomationPolicyCreate:
    async def test_create_minimal(self, automation_mcp, patched_client):
        patched_client.post.return_value = {"name": "new-auto", "profile": "WebRA"}
        result = await call(automation_mcp, "create_automation_policy", {
            "name": "new-auto",
            "profile": "WebRA",
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["name"] == "new-auto"
        assert payload["profile"] == "WebRA"
        assert result["name"] == "new-auto"

    async def test_create_with_optional_fields(self, automation_mcp, patched_client):
        patched_client.post.return_value = {"name": "full-auto"}
        await call(automation_mcp, "create_automation_policy", {
            "name": "full-auto",
            "profile": "WebRA",
            "execution_policy": "weekday-only",
            "trust_chains": ["chain-a", "chain-b"],
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["executionPolicy"] == "weekday-only"
        assert payload["trustChains"] == ["chain-a", "chain-b"]


class TestAutomationPolicyUpdate:
    async def test_update(self, automation_mcp, patched_client):
        patched_client.get.return_value = {"_id": "x", "name": "my-auto", "profile": "WebRA"}
        patched_client.put.return_value = {"name": "my-auto", "profile": "ACME"}
        result = await call(automation_mcp, "update_automation_policy", {
            "name": "my-auto",
            "profile": "ACME",
        })
        assert result["status"] == "updated"
        assert result["kind"] == "automation_policy"


class TestAutomationPolicyDelete:
    async def test_delete_success(self, automation_mcp, patched_client):
        result = await call(automation_mcp, "delete_automation_policy", {
            "name": "old-auto",
            "expected_name": "old-auto",
        })
        patched_client.delete.assert_awaited_once_with(
            "/api/v1/automation/policies/old-auto",
        )
        assert result["deleted"] is True

    async def test_delete_mismatch(self, automation_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(automation_mcp, "delete_automation_policy", {
                "name": "a",
                "expected_name": "b",
            })


class TestExecutionPolicyList:
    async def test_returns_policies(self, automation_mcp, patched_client):
        patched_client.get.return_value = [{"name": "weekday-only"}]
        result = await call(automation_mcp, "list_execution_policies")
        patched_client.get.assert_awaited_once_with("/api/v1/automation/executions")
        assert result["count"] == 1
        assert result["kind"] == "execution_policy"


class TestExecutionPolicyGet:
    async def test_returns_policy(self, automation_mcp, patched_client):
        patched_client.get.return_value = {"name": "weekday-only", "authorizedPeriods": []}
        result = await call(automation_mcp, "get_execution_policy", {"name": "weekday-only"})
        assert result["name"] == "weekday-only"


class TestExecutionPolicyCreate:
    async def test_create_minimal(self, automation_mcp, patched_client):
        patched_client.post.return_value = {"name": "new-exec"}
        result = await call(automation_mcp, "create_execution_policy", {
            "name": "new-exec",
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["name"] == "new-exec"
        assert result["name"] == "new-exec"

    async def test_create_with_periods(self, automation_mcp, patched_client):
        patched_client.post.return_value = {"name": "full-exec"}
        await call(automation_mcp, "create_execution_policy", {
            "name": "full-exec",
            "authorized_periods": [
                {"weekDays": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]},
            ],
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["authorizedPeriods"][0]["weekDays"][0] == "MONDAY"


class TestExecutionPolicyUpdate:
    async def test_update(self, automation_mcp, patched_client):
        patched_client.get.return_value = {"_id": "x", "name": "my-exec"}
        patched_client.put.return_value = {"name": "my-exec", "description": "new"}
        result = await call(automation_mcp, "update_execution_policy", {
            "name": "my-exec",
            "description": "new",
        })
        assert result["status"] == "updated"
        assert result["kind"] == "execution_policy"


class TestExecutionPolicyDelete:
    async def test_delete_success(self, automation_mcp, patched_client):
        result = await call(automation_mcp, "delete_execution_policy", {
            "name": "old-exec",
            "expected_name": "old-exec",
        })
        assert result["deleted"] is True


class TestAutomationLifecycle:
    async def test_get_enrollment(self, automation_mcp, patched_client):
        patched_client.get.return_value = {"policy": "my-policy", "params": {}}
        result = await call(automation_mcp, "get_automation_enrollment", {
            "policy_name": "my-policy",
        })
        patched_client.get.assert_awaited_once_with(
            "/api/v1/automation/lifecycle/my-policy",
        )
        assert result["policy"] == "my-policy"

    async def test_verify_compliant(self, automation_mcp, patched_client):
        # 204 response yields None
        patched_client.get.return_value = None
        result = await call(automation_mcp, "verify_automation_certificate", {
            "policy_name": "my-policy",
        })
        assert result["compliant"] is True
        assert result["policy"] == "my-policy"

    async def test_verify_non_compliant(self, automation_mcp, patched_client):
        patched_client.get.return_value = {"runnable": True, "renewable": True}
        result = await call(automation_mcp, "verify_automation_certificate", {
            "policy_name": "my-policy",
        })
        assert result["runnable"] is True


# =========================================================================
# 8. LOCAL IDENTITIES (8 tools)
# =========================================================================

class TestLocalIdentityList:
    async def test_returns_identities(self, local_identity_mcp, patched_client):
        patched_client.get.return_value = [
            {"identifier": "alice", "name": "Alice"},
            {"identifier": "bob", "name": "Bob"},
        ]
        result = await call(local_identity_mcp, "list_local_identities")
        patched_client.get.assert_awaited_once_with(
            "/api/v1/security/identity/locals",
        )
        assert result["count"] == 2
        assert result["kind"] == "local_identity"

    async def test_identifier_filter(self, local_identity_mcp, patched_client):
        patched_client.get.return_value = [
            {"identifier": "alice"},
            {"identifier": "bob"},
        ]
        result = await call(local_identity_mcp, "list_local_identities", {
            "name_contains": "ali",
        })
        assert result["count"] == 1


class TestLocalIdentityGet:
    async def test_returns_identity(self, local_identity_mcp, patched_client):
        patched_client.get.return_value = {"identifier": "alice", "email": "alice@ex.com"}
        result = await call(local_identity_mcp, "get_local_identity", {
            "identifier": "alice",
        })
        patched_client.get.assert_awaited_once_with(
            "/api/v1/security/identity/locals/alice",
        )
        assert result["identifier"] == "alice"


class TestLocalIdentityCreate:
    async def test_create_minimal(self, local_identity_mcp, patched_client):
        patched_client.post.return_value = {"identifier": "charlie"}
        result = await call(local_identity_mcp, "create_local_identity", {
            "identifier": "charlie",
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["identifier"] == "charlie"
        assert "password" not in payload
        assert result["status"] == "created"
        assert result["kind"] == "local_identity"
        assert result["name"] == "charlie"

    async def test_create_with_all_fields(self, local_identity_mcp, patched_client):
        patched_client.post.return_value = {"identifier": "charlie"}
        await call(local_identity_mcp, "create_local_identity", {
            "identifier": "charlie",
            "name": "Charlie Brown",
            "email": "charlie@ex.com",
            "password": "s3cret",
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["name"] == "Charlie Brown"
        assert payload["email"] == "charlie@ex.com"
        assert payload["password"] == "s3cret"


class TestLocalIdentityUpdate:
    async def test_update(self, local_identity_mcp, patched_client):
        patched_client.get.return_value = {
            "_id": "x", "identifier": "alice", "name": "Alice",
        }
        patched_client.put.return_value = {"identifier": "alice", "name": "Alice B"}
        result = await call(local_identity_mcp, "update_local_identity", {
            "identifier": "alice",
            "name": "Alice B",
        })
        assert result["status"] == "updated"
        assert result["kind"] == "local_identity"
        assert result["name"] == "alice"
        assert result["data"]["name"] == "Alice B"


class TestLocalIdentityDelete:
    async def test_delete_success(self, local_identity_mcp, patched_client):
        result = await call(local_identity_mcp, "delete_local_identity", {
            "identifier": "bob",
            "expected_identifier": "bob",
        })
        patched_client.delete.assert_awaited_once_with(
            "/api/v1/security/identity/locals/bob",
        )
        assert result["deleted"] == "bob"

    async def test_delete_mismatch(self, local_identity_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(local_identity_mcp, "delete_local_identity", {
                "identifier": "bob",
                "expected_identifier": "alice",
            })
        patched_client.delete.assert_not_awaited()


class TestLocalIdentitySetPassword:
    async def test_set_password(self, local_identity_mcp, patched_client):
        patched_client.patch.return_value = {"status": "ok"}
        result = await call(local_identity_mcp, "set_local_identity_password", {
            "identifier": "alice",
            "password": "newpass",
            "expected_identifier": "alice",
        })
        patched_client.patch.assert_awaited_once()
        payload = patched_client.patch.call_args[1]["json"]
        assert payload["identifier"] == "alice"
        assert payload["password"] == "newpass"
        assert "Password set" in result["content"]

    async def test_set_password_mismatch(self, local_identity_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(local_identity_mcp, "set_local_identity_password", {
                "identifier": "alice",
                "password": "newpass",
                "expected_identifier": "bob",
            })
        patched_client.patch.assert_not_awaited()


class TestLocalIdentityPasswordReset:
    async def test_initiate_reset(self, local_identity_mcp, patched_client):
        patched_client.get.return_value = {}
        result = await call(local_identity_mcp, "initiate_password_reset", {
            "identifier": "alice",
        })
        patched_client.get.assert_awaited_once_with(
            "/api/v1/security/identity/locals/password/alice",
        )
        assert "reset initiated" in result["content"]

    async def test_complete_reset(self, local_identity_mcp, patched_client):
        patched_client.post.return_value = {"status": "ok"}
        result = await call(local_identity_mcp, "complete_password_reset", {
            "identifier": "alice",
            "reset_uuid": "uuid-abc-123",
            "new_password": "brand-new-pass",
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["identifier"] == "alice"
        assert payload["uuid"] == "uuid-abc-123"
        assert payload["password"] == "brand-new-pass"
        assert "completed" in result["content"]


# =========================================================================
# 9. WCCE (7 tools)
# =========================================================================

class TestWcceForestList:
    async def test_returns_forests(self, wcce_mcp, patched_client):
        patched_client.get.return_value = [
            {"forest": "corp.example.com"},
            {"forest": "dev.example.com"},
        ]
        result = await call(wcce_mcp, "list_wcce_forests")
        patched_client.get.assert_awaited_once_with("/api/v1/wcce/forests")
        assert result["count"] == 2
        assert result["kind"] == "wcce_forest"

    async def test_name_filter_on_forest_field(self, wcce_mcp, patched_client):
        patched_client.get.return_value = [
            {"forest": "corp.example.com"},
            {"forest": "dev.example.com"},
        ]
        result = await call(wcce_mcp, "list_wcce_forests", {"name_contains": "corp"})
        assert result["count"] == 1


class TestWcceForestGet:
    async def test_returns_forest(self, wcce_mcp, patched_client):
        patched_client.get.return_value = {
            "forest": "corp.example.com",
            "templateMappings": [],
        }
        result = await call(wcce_mcp, "get_wcce_forest", {"name": "corp.example.com"})
        patched_client.get.assert_awaited_once_with(
            "/api/v1/wcce/forests/corp.example.com",
        )
        assert result["forest"] == "corp.example.com"


class TestWcceForestCreate:
    async def test_valid_create(self, wcce_mcp, patched_client):
        patched_client.post.return_value = {"forest": "corp.example.com"}
        result = await call(wcce_mcp, "create_wcce_forest", {
            "forest_name": "corp.example.com",
            "template_mappings": [{
                "template": "WebServer",
                "profile": "WebRA-Prod",
                "enrollmentMode": "eobo",
                "templateVersion": "v2",
            }],
        })
        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["forest"] == "corp.example.com"
        assert len(payload["templateMappings"]) == 1

    async def test_invalid_forest_name(self, wcce_mcp, patched_client):
        result = await call(wcce_mcp, "create_wcce_forest", {
            "forest_name": "invalid name!",
            "template_mappings": [{
                "template": "t",
                "profile": "p",
                "enrollmentMode": "eobo",
                "templateVersion": "v1",
            }],
        })
        assert "error" in result
        patched_client.post.assert_not_awaited()

    async def test_missing_mapping_field(self, wcce_mcp, patched_client):
        result = await call(wcce_mcp, "create_wcce_forest", {
            "forest_name": "corp.example.com",
            "template_mappings": [{
                "template": "WebServer",
                "profile": "WebRA-Prod",
                # missing enrollmentMode and templateVersion
            }],
        })
        assert "error" in result
        patched_client.post.assert_not_awaited()

    async def test_invalid_enrollment_mode(self, wcce_mcp, patched_client):
        result = await call(wcce_mcp, "create_wcce_forest", {
            "forest_name": "corp.example.com",
            "template_mappings": [{
                "template": "WebServer",
                "profile": "WebRA",
                "enrollmentMode": "invalid",
                "templateVersion": "v1",
            }],
        })
        assert "error" in result
        assert "valid_values" in result

    async def test_empty_mappings(self, wcce_mcp, patched_client):
        result = await call(wcce_mcp, "create_wcce_forest", {
            "forest_name": "corp.example.com",
            "template_mappings": [],
        })
        assert "error" in result
        patched_client.post.assert_not_awaited()


class TestWcceForestUpdate:
    async def test_update(self, wcce_mcp, patched_client):
        patched_client.get.return_value = {
            "_id": "x", "forest": "corp.example.com", "templateMappings": [],
        }
        patched_client.put.return_value = {"forest": "corp.example.com"}
        result = await call(wcce_mcp, "update_wcce_forest", {
            "forest_name": "corp.example.com",
            "template_mappings": [{
                "template": "t",
                "profile": "p",
                "enrollmentMode": "entity",
                "templateVersion": "v2",
            }],
        })
        assert result["status"] == "updated"
        assert result["kind"] == "wcce_forest"
        assert result["name"] == "corp.example.com"
        assert result["data"]["forest"] == "corp.example.com"


class TestWcceForestDelete:
    async def test_delete_success(self, wcce_mcp, patched_client):
        result = await call(wcce_mcp, "delete_wcce_forest", {
            "forest_name": "old.forest.com",
            "expected_name": "old.forest.com",
        })
        patched_client.delete.assert_awaited_once_with(
            "/api/v1/wcce/forests/old.forest.com",
        )
        assert result["deleted"] is True

    async def test_delete_mismatch(self, wcce_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(wcce_mcp, "delete_wcce_forest", {
                "forest_name": "a",
                "expected_name": "b",
            })


class TestWcceEnroll:
    async def test_enroll_with_pkcs10(self, wcce_mcp, patched_client):
        patched_client.post.return_value = {"status": "issued", "certificate": "PEM"}
        result = await call(wcce_mcp, "wcce_enroll", {
            "forest_name": "corp.example.com",
            "template_name": "WebServer",
            "template_oid": "1.3.6.1.4.1.311.21.8.1234",
            "caller_identity": {"upn": "user@corp.example.com"},
            "pkcs10": "BASE64CSR",
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["forestName"] == "corp.example.com"
        assert payload["pkcs10"] == "BASE64CSR"
        assert "cmc" not in payload
        assert result["status"] == "issued"

    async def test_enroll_without_csr_rejected(self, wcce_mcp, patched_client):
        result = await call(wcce_mcp, "wcce_enroll", {
            "forest_name": "corp.example.com",
            "template_name": "WebServer",
            "template_oid": "1.3.6.1.4.1.311.21.8.1234",
            "caller_identity": {"upn": "user@corp.example.com"},
        })
        assert result["error"] is True
        patched_client.post.assert_not_awaited()


class TestWcceExchangeCertificate:
    async def test_get_exchange_cert(self, wcce_mcp, patched_client):
        patched_client.get.return_value = {"pem": "-----BEGIN CERTIFICATE-----\n..."}
        result = await call(wcce_mcp, "get_wcce_exchange_certificate", {
            "profile": "WebRA",
        })
        patched_client.get.assert_awaited_once_with("/api/v1/wcce/exchanges/WebRA")
        assert result["pem"] == "-----BEGIN CERTIFICATE-----\n..."

    async def test_no_exchange_cert(self, wcce_mcp, patched_client):
        patched_client.get.return_value = None
        result = await call(wcce_mcp, "get_wcce_exchange_certificate", {
            "profile": "WebRA",
        })
        assert result["exchange_certificate"] is None


# =========================================================================
# 10. SCHEDULER (8 tools)
# =========================================================================

class TestSchedulerListTasks:
    async def test_returns_tasks(self, scheduler_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "sync-adcs", "type": "thirdparty"},
            {"name": "weekly-report", "type": "report"},
        ]
        result = await call(scheduler_mcp, "list_scheduled_tasks")
        patched_client.get.assert_awaited_once()
        assert result["count"] == 2
        assert result["kind"] == "scheduled_task"

    async def test_type_filter(self, scheduler_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "sync-adcs", "type": "thirdparty"},
            {"name": "weekly-report", "type": "report"},
        ]
        result = await call(scheduler_mcp, "list_scheduled_tasks", {
            "task_type": "report",
        })
        assert result["count"] == 1
        assert result["items"][0]["type"] == "report"


class TestSchedulerGetTask:
    async def test_returns_task(self, scheduler_mcp, patched_client):
        patched_client.get.return_value = {
            "name": "sync-adcs", "type": "thirdparty", "cron": "0 0 * * *",
        }
        result = await call(scheduler_mcp, "get_scheduled_task", {"name": "sync-adcs"})
        patched_client.get.assert_awaited_once_with("/api/v1/scheduler/tasks/sync-adcs")
        assert result["name"] == "sync-adcs"


class TestSchedulerDeleteTask:
    async def test_delete_success(self, scheduler_mcp, patched_client):
        result = await call(scheduler_mcp, "delete_scheduled_task", {
            "name": "old-task",
            "expected_name": "old-task",
        })
        patched_client.delete.assert_awaited_once_with(
            "/api/v1/scheduler/tasks/old-task",
        )
        assert result["deleted"] is True

    async def test_delete_mismatch(self, scheduler_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(scheduler_mcp, "delete_scheduled_task", {
                "name": "a",
                "expected_name": "b",
            })


class TestSchedulerRunTask:
    async def test_run_task(self, scheduler_mcp, patched_client):
        patched_client.get.return_value = {"status": "triggered"}
        result = await call(scheduler_mcp, "run_scheduled_task", {"name": "sync-adcs"})
        patched_client.get.assert_awaited_once_with(
            "/api/v1/scheduler/tasks/sync-adcs/run",
        )
        assert result["status"] == "triggered"


class TestSchedulerThirdPartyCreate:
    async def test_create(self, scheduler_mcp, patched_client):
        patched_client.post.return_value = {"name": "new-sync", "type": "thirdparty"}
        result = await call(scheduler_mcp, "create_thirdparty_task", {
            "name": "new-sync",
            "cron": "0 0 * * *",
            "module": "webra",
            "profile": "WebRA-Prod",
            "connector": "adcs-prod",
            "enroll": True,
            "revoke": True,
            "renew": False,
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["type"] == "thirdparty"
        assert payload["enroll"] is True
        assert payload["dryRun"] is False
        assert payload["enabled"] is True
        assert result["name"] == "new-sync"


class TestSchedulerThirdPartyUpdate:
    async def test_update(self, scheduler_mcp, patched_client):
        patched_client.get.return_value = {
            "_id": "x", "name": "my-sync", "type": "thirdparty",
        }
        patched_client.put.return_value = {"name": "my-sync"}
        result = await call(scheduler_mcp, "update_thirdparty_task", {
            "name": "my-sync",
            "enabled": False,
        })
        assert result["status"] == "updated"
        assert result["kind"] == "thirdparty_task"


class TestSchedulerReportTaskCreate:
    async def test_create_csv_email(self, scheduler_mcp, patched_client):
        patched_client.post.return_value = {"name": "weekly-report", "type": "report"}
        result = await call(scheduler_mcp, "create_report_task", {
            "name": "weekly-report",
            "report_type": "csv_email",
            "cron": "0 0 * * 1",
            "recipients": [{"type": "email", "email": "admin@ex.com"}],
            "from_email": "noreply@ex.com",
            "title": "Weekly Cert Report",
            "is_html": False,
            "hql_type": "HCQL",
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["type"] == "report"
        assert payload["reportType"] == "csv_email"
        assert payload["from"] == "noreply@ex.com"
        assert payload["isHtml"] is False
        assert result["name"] == "weekly-report"

    async def test_link_email_without_retention_rejected(self, scheduler_mcp, patched_client):
        result = await call(scheduler_mcp, "create_report_task", {
            "name": "bad-report",
            "report_type": "link_email",
            "cron": "0 0 * * 1",
            "recipients": [{"type": "email", "email": "admin@ex.com"}],
            "from_email": "noreply@ex.com",
            "title": "Report",
            "is_html": False,
            "hql_type": "HCQL",
        })
        assert result["error"] is True
        patched_client.post.assert_not_awaited()


class TestSchedulerReportTaskUpdate:
    async def test_update(self, scheduler_mcp, patched_client):
        patched_client.get.return_value = {
            "_id": "x", "name": "my-report", "type": "report",
        }
        patched_client.put.return_value = {"name": "my-report"}
        result = await call(scheduler_mcp, "update_report_task", {
            "name": "my-report",
            "title": "Updated Title",
        })
        assert result["status"] == "updated"
        assert result["kind"] == "report_task"


# =========================================================================
# 11. SYSTEM CONFIG (6 tools)
# =========================================================================

class TestSystemConfigList:
    async def test_returns_configs(self, system_config_mcp, patched_client):
        patched_client.get.return_value = [
            {"type": "license", "configuration": {}},
        ]
        result = await call(system_config_mcp, "list_system_configs")
        patched_client.get.assert_awaited_once_with("/api/v1/system/configuration")
        assert isinstance(result, list)
        assert result[0]["type"] == "license"


class TestSystemConfigGet:
    async def test_get_valid_type(self, system_config_mcp, patched_client):
        patched_client.get.return_value = {"type": "license", "configuration": {"key": "val"}}
        result = await call(system_config_mcp, "get_system_config", {
            "config_type": "license",
        })
        patched_client.get.assert_awaited_once_with(
            "/api/v1/system/configuration/license",
        )
        assert result["type"] == "license"

    async def test_get_invalid_type(self, system_config_mcp, patched_client):
        result = await call(system_config_mcp, "get_system_config", {
            "config_type": "invalid",
        })
        assert result["error"] is True
        patched_client.get.assert_not_awaited()


class TestSystemConfigUpsert:
    async def test_upsert(self, system_config_mcp, patched_client):
        patched_client.put.return_value = {"type": "license", "configuration": {"key": "new"}}
        result = await call(system_config_mcp, "upsert_system_config", {
            "config_type": "license",
            "configuration": {"key": "new"},
        })
        payload = patched_client.put.call_args[1]["json"]
        assert payload["type"] == "license"
        assert payload["configuration"] == {"key": "new"}
        assert result["status"] == "upserted"
        assert result["kind"] == "system_config"
        assert result["name"] == "license"

    async def test_upsert_invalid_type(self, system_config_mcp, patched_client):
        result = await call(system_config_mcp, "upsert_system_config", {
            "config_type": "invalid",
            "configuration": {},
        })
        assert result["error"] is True
        patched_client.put.assert_not_awaited()


class TestExportableItems:
    async def test_list_exportable(self, system_config_mcp, patched_client):
        patched_client.get.return_value = {
            "cas": [{"name": "Root-CA"}],
            "profiles": [{"name": "WebRA"}],
        }
        result = await call(system_config_mcp, "list_exportable_items")
        patched_client.get.assert_awaited_once_with(
            "/api/v1/system/configurations/export",
        )
        assert "cas" in result


class TestExportConfiguration:
    async def test_full_export(self, system_config_mcp, patched_client):
        patched_client.post.return_value = {"cas": [], "profiles": []}
        result = await call(system_config_mcp, "export_configuration")
        patched_client.post.assert_awaited_once()
        assert "cas" in result

    async def test_selective_export(self, system_config_mcp, patched_client):
        patched_client.post.return_value = {"cas": [{"name": "Root-CA"}]}
        await call(system_config_mcp, "export_configuration", {
            "cas": [{"name": "Root-CA"}],
        })
        payload = patched_client.post.call_args[1]["json"]
        assert "cas" in payload
        assert payload["cas"] == [{"name": "Root-CA"}]


class TestImportConfiguration:
    async def test_import_without_confirm_rejected(self, system_config_mcp, patched_client):
        result = await call(system_config_mcp, "import_configuration", {
            "export_data": {"cas": []},
        })
        assert result["error"] is True
        assert "confirm_import" in result["content"]
        patched_client.post.assert_not_awaited()

    async def test_import_with_confirm(self, system_config_mcp, patched_client):
        patched_client.post.return_value = {"status": "imported"}
        result = await call(system_config_mcp, "import_configuration", {
            "export_data": {"cas": [{"name": "Root-CA"}]},
            "confirm_import": True,
        })
        patched_client.post.assert_awaited_once()
        assert result["status"] == "imported"


# =========================================================================
# 12. ANALYTICS (1 tool)
# =========================================================================

class TestAnalyticsGet:
    async def test_valid_domain(self, analytics_mcp, patched_client):
        patched_client.get.return_value = {"synced": True, "lastSync": "2025-01-01T00:00:00Z"}
        result = await call(analytics_mcp, "get_analytics", {"domain": "certificates"})
        patched_client.get.assert_awaited_once_with("/api/v1/analytics/certificates")
        assert result["data"]["synced"] is True
        assert "certificates" in result["content"]

    async def test_discovery_domain_path(self, analytics_mcp, patched_client):
        patched_client.get.return_value = {}
        await call(analytics_mcp, "get_analytics", {"domain": "discovery"})
        patched_client.get.assert_awaited_once_with(
            "/api/v1/analytics/discovery/events",
        )

    async def test_invalid_domain(self, analytics_mcp, patched_client):
        result = await call(analytics_mcp, "get_analytics", {"domain": "requests"})
        assert result["error"] is True
        assert "certificates" in result["content"]
        patched_client.get.assert_not_awaited()

    async def test_events_domain(self, analytics_mcp, patched_client):
        patched_client.get.return_value = {"synced": False}
        result = await call(analytics_mcp, "get_analytics", {"domain": "events"})
        patched_client.get.assert_awaited_once_with("/api/v1/analytics/events")
        assert result["data"]["synced"] is False


# =========================================================================
# CROSS-CUTTING: HorizonError propagation
# =========================================================================

class TestHorizonErrorPropagation:
    """Verify that HorizonError from the mock client propagates through FastMCP."""

    async def test_discovery_campaign_404(self, discovery_mcp, patched_client):
        patched_client.get.side_effect = HorizonError(
            status_code=404,
            error_code="DISC-003",
            message="Campaign not found",
        )
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(discovery_mcp, "get_discovery_campaign", {"name": "no-exist"})

    async def test_dashboard_403(self, dashboard_mcp, patched_client):
        patched_client.get.side_effect = HorizonError(
            status_code=403,
            error_code="SecPerm001",
            message="Forbidden",
        )
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(dashboard_mcp, "get_dashboard", {"name": "restricted"})

    async def test_archive_create_500(self, archive_mcp, patched_client):
        patched_client.post.side_effect = HorizonError(
            status_code=500,
            error_code="INTERNAL",
            message="Server error",
        )
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(archive_mcp, "create_archive", {
                "name": "err",
                "archive_type": "certificate",
                "filename": "f.zip",
                "filter": "status is valid",
            })

    async def test_scheduler_run_error(self, scheduler_mcp, patched_client):
        patched_client.get.side_effect = HorizonError(
            status_code=404,
            error_code="SCHED-003",
            message="Task not found",
        )
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(scheduler_mcp, "run_scheduled_task", {"name": "ghost"})


# ---------------------------------------------------------------------------
# Aggregation tools (added to lifecycle.py)
# ---------------------------------------------------------------------------


@pytest.fixture
def lifecycle_mcp(patched_client):
    mcp = FastMCP("test-lifecycle")
    from horizon_mcp.tools.lifecycle import register_lifecycle_tools
    register_lifecycle_tools(mcp)
    return mcp


class TestAggregation:
    """Tests for aggregate_certificates and aggregate_requests."""

    async def test_aggregate_certificates_basic(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = [
            {"key": "rsa-2048", "count": 150},
            {"key": "ec-p256", "count": 42},
        ]
        result = await call(lifecycle_mcp, "aggregate_certificates", {
            "query": "status is valid",
            "group_by": ["keyType"],
        })
        patched_client.post.assert_awaited_once()
        args = patched_client.post.call_args
        assert args[0][0] == "/api/v1/certificates/aggregate"
        payload = args[1]["json"]
        assert payload["query"] == "status is valid"
        assert payload["groupBy"] == ["keyType"]
        assert payload["sortOrder"] == "Desc"  # default

    async def test_aggregate_certificates_with_having(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = [
            {"key": "TLS-Internal", "count": 200},
        ]
        await call(lifecycle_mcp, "aggregate_certificates", {
            "query": "status is valid",
            "group_by": ["profile"],
            "having": {"operator": "gt", "value": 100},
            "sort_order": "KeyAsc",
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["having"] == {"operator": "gt", "value": 100}
        assert payload["sortOrder"] == "KeyAsc"

    async def test_aggregate_certificates_multi_groupby(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = []
        await call(lifecycle_mcp, "aggregate_certificates", {
            "query": "valid.until before 30d",
            "group_by": ["profile", "keyType"],
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["groupBy"] == ["profile", "keyType"]

    async def test_aggregate_certificates_invalid_query(self, lifecycle_mcp, patched_client):
        patched_client.post.side_effect = HorizonError(
            status_code=400,
            error_code="HQL-001",
            message="Invalid HCQL query",
        )
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError, match="Invalid HCQL"):
            await call(lifecycle_mcp, "aggregate_certificates", {
                "query": "BAD SYNTAX !!!",
                "group_by": ["keyType"],
            })

    async def test_aggregate_requests_basic(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = [
            {"key": "enroll", "count": 85},
            {"key": "renew", "count": 30},
        ]
        result = await call(lifecycle_mcp, "aggregate_requests", {
            "query": "status equals \"pending\"",
            "group_by": ["workflow"],
        })
        args = patched_client.post.call_args
        assert args[0][0] == "/api/v1/requests/aggregate"
        payload = args[1]["json"]
        assert payload["groupBy"] == ["workflow"]

    async def test_aggregate_requests_no_having_omitted(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = []
        await call(lifecycle_mcp, "aggregate_requests", {
            "query": "workflow equals \"enroll\"",
            "group_by": ["profile"],
        })
        payload = patched_client.post.call_args[1]["json"]
        assert "having" not in payload  # omitted when None
