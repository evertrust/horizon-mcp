"""Unit tests for the datasource tools layer.

Strategy:
    - Mock ``get_client()`` to return an ``AsyncMock`` HorizonClient.
    - Register tools on a real ``FastMCP`` instance.
    - Invoke each tool through ``_tool_manager.call_tool()``.
    - Assert correct HTTP method/endpoint, payload, and response formatting.

Coverage:
    8 tools: list, get, create (dns/ldap/rest), update, delete, test
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
    client.patch = AsyncMock(return_value={})
    return client


@pytest.fixture
def patched_client(mock_client: AsyncMock):
    """Set the global client state so every ``get_client()`` call returns the mock."""
    from horizon_mcp.client.state import set_client, clear_client
    set_client(mock_client)
    yield mock_client
    clear_client()


@pytest.fixture
def ds_mcp(patched_client):
    mcp = FastMCP("test-datasources")
    from horizon_mcp.tools.datasources import register_datasource_tools
    register_datasource_tools(mcp)
    return mcp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def call(mcp: FastMCP, name: str, args: dict | None = None) -> dict:
    """Invoke a tool by name, parse the JSON string result into a dict."""
    raw = await mcp._tool_manager.call_tool(name, args or {})
    return json.loads(raw)


# =========================================================================
# 1. LIST DATASOURCES
# =========================================================================

class TestListDatasources:
    async def test_returns_all(self, ds_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "corp-ldap", "type": "ldap"},
            {"name": "dns-check", "type": "dns"},
            {"name": "api-lookup", "type": "rest"},
        ]
        result = await call(ds_mcp, "list_datasources")
        patched_client.get.assert_awaited_once_with("/api/v1/datasources")
        assert result["count"] == 3
        assert result["kind"] == "datasource"
        assert result["truncated"] is False

    async def test_type_filter(self, ds_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "corp-ldap", "type": "ldap"},
            {"name": "dns-check", "type": "dns"},
        ]
        result = await call(ds_mcp, "list_datasources", {"ds_type": "dns"})
        assert result["count"] == 1
        assert result["items"][0]["name"] == "dns-check"

    async def test_name_filter(self, ds_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "corp-ldap", "type": "ldap"},
            {"name": "corp-dns", "type": "dns"},
            {"name": "api-lookup", "type": "rest"},
        ]
        result = await call(ds_mcp, "list_datasources", {"name_contains": "corp"})
        assert result["count"] == 2

    async def test_invalid_type_rejected(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "list_datasources", {"ds_type": "sql"})
        assert "error" in result
        assert "valid_types" in result
        patched_client.get.assert_not_awaited()

    async def test_truncation(self, ds_mcp, patched_client):
        patched_client.get.return_value = [{"name": f"ds-{i}", "type": "dns"} for i in range(60)]
        result = await call(ds_mcp, "list_datasources", {"max_items": 5})
        assert result["truncated"] is True
        assert result["count"] == 5
        assert result["total_available"] == 60


# =========================================================================
# 2. GET DATASOURCE
# =========================================================================

class TestGetDatasource:
    async def test_returns_datasource(self, ds_mcp, patched_client):
        patched_client.get.return_value = {"name": "corp-ldap", "type": "ldap", "hostname": "ldaps://ldap.corp.local"}
        result = await call(ds_mcp, "get_datasource", {"name": "corp-ldap"})
        patched_client.get.assert_awaited_once_with("/api/v1/datasources/corp-ldap")
        assert result["name"] == "corp-ldap"
        assert result["type"] == "ldap"

    async def test_not_found_raises(self, ds_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        patched_client.get.side_effect = HorizonError(
            status_code=404, error_code="DS-003", message="DataSource not found",
        )
        with pytest.raises(ToolError):
            await call(ds_mcp, "get_datasource", {"name": "nonexistent"})


# =========================================================================
# 3. CREATE DNS DATASOURCE
# =========================================================================

class TestCreateDnsDatasource:
    async def test_minimal_create(self, ds_mcp, patched_client):
        patched_client.post.return_value = {"name": "dns-check", "type": "dns"}
        result = await call(ds_mcp, "create_dns_datasource", {
            "name": "dns-check",
            "lookup": "{{csr.san.dnsname.1}}",
        })
        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["type"] == "dns"
        assert payload["name"] == "dns-check"
        assert payload["lookup"] == "{{csr.san.dnsname.1}}"
        assert payload["port"] == 53
        assert payload["timeout"] == "10 seconds"
        assert result["status"] == "created"
        assert result["kind"] == "datasource"

    async def test_full_create(self, ds_mcp, patched_client):
        patched_client.post.return_value = {"name": "dns-full", "type": "dns"}
        result = await call(ds_mcp, "create_dns_datasource", {
            "name": "dns-full",
            "lookup": "{{hostname}}",
            "host": "10.0.0.53",
            "port": 5353,
            "timeout": "30s",
            "record_types": ["a", "cname"],
            "description": "Corporate DNS check",
            "display_name": [{"lang": "en", "value": "DNS Check"}],
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["host"] == "10.0.0.53"
        assert payload["port"] == 5353
        assert payload["timeout"] == "30s"
        assert payload["recordTypes"] == ["a", "cname"]
        assert payload["description"] == "Corporate DNS check"
        assert payload["displayName"] == [{"lang": "en", "value": "DNS Check"}]

    async def test_invalid_record_type_rejected(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "create_dns_datasource", {
            "name": "bad-dns",
            "lookup": "{{hostname}}",
            "record_types": ["a", "mx"],
        })
        assert "error" in result
        assert "mx" in str(result)
        patched_client.post.assert_not_awaited()


# =========================================================================
# 4. CREATE LDAP DATASOURCE
# =========================================================================

class TestCreateLdapDatasource:
    async def test_minimal_create(self, ds_mcp, patched_client):
        patched_client.post.return_value = {"name": "corp-ldap", "type": "ldap"}
        result = await call(ds_mcp, "create_ldap_datasource", {
            "name": "corp-ldap",
            "hostname": "ldaps://ldap.corp.local",
            "credentials": "ldap-bind-creds",
            "base_dn": "DC=corp,DC=local",
            "filter": "(sAMAccountName={{username}})",
            "secure": True,
            "timeout": "10s",
        })
        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["type"] == "ldap"
        assert payload["name"] == "corp-ldap"
        assert payload["hostname"] == "ldaps://ldap.corp.local"
        assert payload["credentials"] == "ldap-bind-creds"
        assert payload["baseDn"] == "DC=corp,DC=local"
        assert payload["filter"] == "(sAMAccountName={{username}})"
        assert payload["secure"] is True
        assert payload["timeout"] == "10s"
        assert result["status"] == "created"

    async def test_full_create(self, ds_mcp, patched_client):
        patched_client.post.return_value = {"name": "corp-ldap-full", "type": "ldap"}
        await call(ds_mcp, "create_ldap_datasource", {
            "name": "corp-ldap-full",
            "hostname": "ldaps://ldap.corp.local",
            "credentials": "ldap-bind-creds",
            "base_dn": "DC=corp,DC=local",
            "filter": "(cn={{cn}})",
            "secure": True,
            "timeout": "10s",
            "port": 636,
            "disable_hostname_validation": True,
            "attributes": [{"key": "cn", "multi": False, "selected": True}],
            "limit": 1,
            "follow_referrals": True,
            "proxy": "corp-proxy",
            "description": "Corporate LDAP lookup",
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["port"] == 636
        assert payload["disableHostnameValidation"] is True
        assert payload["attributes"] == [{"key": "cn", "multi": False, "selected": True}]
        assert payload["limit"] == 1
        assert payload["followReferrals"] is True
        assert payload["proxy"] == "corp-proxy"


# =========================================================================
# 5. CREATE REST DATASOURCE
# =========================================================================

class TestCreateRestDatasource:
    async def test_minimal_create(self, ds_mcp, patched_client):
        patched_client.post.return_value = {"name": "api-lookup", "type": "rest"}
        result = await call(ds_mcp, "create_rest_datasource", {
            "name": "api-lookup",
            "method": "GET",
            "url": "https://api.example.com/v1/check/{{hostname}}",
            "authentication_type": "bearer",
            "credentials": "api-token",
            "timeout": "10s",
            "expected_http_codes": [200],
        })
        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["type"] == "rest"
        assert payload["method"] == "GET"
        assert payload["url"] == "https://api.example.com/v1/check/{{hostname}}"
        assert payload["authenticationType"] == "bearer"
        assert payload["credentials"] == "api-token"
        assert payload["expectedHttpCodes"] == [200]
        assert result["status"] == "created"

    async def test_invalid_auth_type_rejected(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "create_rest_datasource", {
            "name": "bad-rest",
            "method": "GET",
            "url": "https://example.com",
            "authentication_type": "oauth2",
            "timeout": "10s",
            "expected_http_codes": [200],
        })
        assert "error" in result
        assert "valid_types" in result
        patched_client.post.assert_not_awaited()

    async def test_missing_credentials_for_auth(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "create_rest_datasource", {
            "name": "bad-rest",
            "method": "GET",
            "url": "https://example.com",
            "authentication_type": "basic",
            "timeout": "10s",
            "expected_http_codes": [200],
        })
        assert "error" in result
        assert "credentials" in result["error"]
        patched_client.post.assert_not_awaited()

    async def test_empty_expected_codes_rejected(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "create_rest_datasource", {
            "name": "bad-rest",
            "method": "GET",
            "url": "https://example.com",
            "authentication_type": "noauth",
            "timeout": "10s",
            "expected_http_codes": [],
        })
        assert "error" in result
        patched_client.post.assert_not_awaited()

    async def test_noauth_no_credentials_ok(self, ds_mcp, patched_client):
        patched_client.post.return_value = {"name": "public-api", "type": "rest"}
        result = await call(ds_mcp, "create_rest_datasource", {
            "name": "public-api",
            "method": "GET",
            "url": "https://api.example.com/check",
            "authentication_type": "noauth",
            "timeout": "10s",
            "expected_http_codes": [200],
        })
        assert result["status"] == "created"

    async def test_full_create_with_payload(self, ds_mcp, patched_client):
        patched_client.post.return_value = {"name": "cmdb-api", "type": "rest"}
        await call(ds_mcp, "create_rest_datasource", {
            "name": "cmdb-api",
            "method": "POST",
            "url": "https://cmdb.corp.local/api/hosts",
            "authentication_type": "custom",
            "credentials": "cmdb-token",
            "timeout": "15s",
            "expected_http_codes": [200, 201],
            "headers": [{"name": "X-Custom-Auth", "value": "Token {{credentials.raw}}"}],
            "payload_type": "json",
            "payload": "hostname={{csr.san.dnsname.1}}",
            "proxy": "corp-proxy",
            "attributes": [{"key": "owner", "multi": False, "selected": True}],
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["headers"] == [{"name": "X-Custom-Auth", "value": "Token {{credentials.raw}}"}]
        assert payload["payloadType"] == "json"
        assert payload["payload"] == "hostname={{csr.san.dnsname.1}}"
        assert payload["proxy"] == "corp-proxy"


# =========================================================================
# 6. UPDATE DATASOURCE
# =========================================================================

class TestUpdateDatasource:
    async def test_update_dns_lookup(self, ds_mcp, patched_client):
        patched_client.get.return_value = {
            "_id": "abc", "name": "dns-check", "type": "dns",
            "lookup": "{{old}}", "port": 53,
        }
        patched_client.put.return_value = {"name": "dns-check", "lookup": "{{new}}"}
        result = await call(ds_mcp, "update_datasource", {
            "name": "dns-check",
            "lookup": "{{new}}",
        })
        assert result["status"] == "updated"
        assert result["kind"] == "datasource"

        # Verify GET-strip-merge-PUT cycle
        patched_client.get.assert_awaited_once_with("/api/v1/datasources/dns-check")
        put_payload = patched_client.put.call_args[1]["json"]
        assert put_payload["lookup"] == "{{new}}"
        assert "_id" not in put_payload  # stripped

    async def test_update_ldap_filter(self, ds_mcp, patched_client):
        patched_client.get.return_value = {
            "_id": "def", "name": "corp-ldap", "type": "ldap",
            "filter": "(cn={{old}})", "baseDn": "DC=corp,DC=local",
        }
        patched_client.put.return_value = {"name": "corp-ldap"}
        await call(ds_mcp, "update_datasource", {
            "name": "corp-ldap",
            "filter": "(sAMAccountName={{new}})",
        })
        put_payload = patched_client.put.call_args[1]["json"]
        assert put_payload["filter"] == "(sAMAccountName={{new}})"
        assert put_payload["baseDn"] == "DC=corp,DC=local"  # preserved

    async def test_invalid_record_types_rejected(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "update_datasource", {
            "name": "dns-check",
            "record_types": ["mx"],
        })
        assert "error" in result
        patched_client.get.assert_not_awaited()


# =========================================================================
# 7. DELETE DATASOURCE
# =========================================================================

class TestDeleteDatasource:
    async def test_delete_with_matching_name(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "delete_datasource", {
            "name": "old-ds",
            "expected_name": "old-ds",
        })
        patched_client.delete.assert_awaited_once_with("/api/v1/datasources/old-ds")
        assert result["deleted"] is True
        assert result["kind"] == "datasource"

    async def test_delete_mismatch_raises(self, ds_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(ds_mcp, "delete_datasource", {
                "name": "ds-a",
                "expected_name": "ds-b",
            })
        patched_client.delete.assert_not_awaited()

    async def test_referenced_ds_returns_error(self, ds_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        patched_client.delete.side_effect = HorizonError(
            status_code=400, error_code="DS-005",
            message="Referenced DataSource - cannot delete",
        )
        with pytest.raises(ToolError):
            await call(ds_mcp, "delete_datasource", {
                "name": "in-use-ds",
                "expected_name": "in-use-ds",
            })


# =========================================================================
# 8. TEST DATASOURCE
# =========================================================================

class TestTestDatasource:
    async def test_dns_test(self, ds_mcp, patched_client):
        patched_client.patch.return_value = {
            "name": "dns-check", "type": "dns", "status": "success",
            "dictionary": [{"key": "cname", "value": "web01.paas.internal"}],
        }
        result = await call(ds_mcp, "test_datasource", {
            "ds_type": "dns",
            "name": "dns-check",
            "lookup": "{{hostname}}",
            "context": {"hostname": "app.corp.local"},
        })
        patched_client.patch.assert_awaited_once()
        body = patched_client.patch.call_args[1]["json"]
        assert body["ds"]["type"] == "dns"
        assert body["ds"]["lookup"] == "{{hostname}}"
        assert body["context"] == [{"key": "hostname", "value": "app.corp.local"}]
        assert result["status"] == "success"

    async def test_dns_requires_lookup(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "test_datasource", {
            "ds_type": "dns",
            "name": "dns-check",
        })
        assert "error" in result
        patched_client.patch.assert_not_awaited()

    async def test_ldap_test(self, ds_mcp, patched_client):
        patched_client.patch.return_value = {
            "name": "corp-ldap", "type": "ldap", "status": "success",
            "computedDN": "DC=corp,DC=local",
            "computedFilter": "(sAMAccountName=jdoe)",
            "dictionary": [{"key": "department", "value": "Engineering"}],
        }
        result = await call(ds_mcp, "test_datasource", {
            "ds_type": "ldap",
            "name": "corp-ldap",
            "hostname": "ldaps://ldap.corp.local",
            "credentials": "ldap-creds",
            "base_dn": "DC=corp,DC=local",
            "filter": "(sAMAccountName={{username}})",
            "secure": True,
            "context": {"username": "jdoe"},
        })
        assert result["status"] == "success"
        assert result["computedFilter"] == "(sAMAccountName=jdoe)"

    async def test_ldap_missing_required_fields(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "test_datasource", {
            "ds_type": "ldap",
            "name": "bad-ldap",
            "hostname": "ldaps://ldap.corp.local",
            # Missing credentials, base_dn, filter
        })
        assert "error" in result
        patched_client.patch.assert_not_awaited()

    async def test_rest_test(self, ds_mcp, patched_client):
        patched_client.patch.return_value = {
            "name": "api-check", "type": "rest", "status": "success",
            "responseCode": 200,
            "dictionary": [{"key": "owner", "value": "team-platform"}],
        }
        result = await call(ds_mcp, "test_datasource", {
            "ds_type": "rest",
            "name": "api-check",
            "method": "GET",
            "url": "https://api.example.com/check/{{hostname}}",
            "authentication_type": "noauth",
            "timeout": "10s",
            "expected_http_codes": [200],
            "context": {"hostname": "web01.corp.local"},
        })
        assert result["status"] == "success"
        assert result["responseCode"] == 200

    async def test_rest_missing_required_fields(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "test_datasource", {
            "ds_type": "rest",
            "name": "bad-rest",
            "method": "GET",
            # Missing url and authentication_type
        })
        assert "error" in result
        patched_client.patch.assert_not_awaited()

    async def test_invalid_type_rejected(self, ds_mcp, patched_client):
        result = await call(ds_mcp, "test_datasource", {
            "ds_type": "graphql",
            "name": "bad",
        })
        assert "error" in result
        assert "valid_types" in result

    async def test_dns_with_record_types(self, ds_mcp, patched_client):
        patched_client.patch.return_value = {"status": "success", "dictionary": []}
        await call(ds_mcp, "test_datasource", {
            "ds_type": "dns",
            "name": "dns-cname-only",
            "lookup": "{{hostname}}",
            "record_types": ["cname"],
            "host": "10.0.0.53",
            "context": {"hostname": "app.corp.local"},
        })
        body = patched_client.patch.call_args[1]["json"]
        assert body["ds"]["recordTypes"] == ["cname"]
        assert body["ds"]["host"] == "10.0.0.53"


# =========================================================================
# CROSS-CUTTING: HorizonError propagation
# =========================================================================

class TestDatasourceErrorPropagation:
    async def test_already_exists_on_create(self, ds_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        patched_client.post.side_effect = HorizonError(
            status_code=400, error_code="DS-004",
            message="DataSource already exists",
        )
        with pytest.raises(ToolError):
            await call(ds_mcp, "create_dns_datasource", {
                "name": "existing-ds",
                "lookup": "{{hostname}}",
            })

    async def test_404_on_get(self, ds_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        patched_client.get.side_effect = HorizonError(
            status_code=404, error_code="DS-003",
            message="DataSource not found",
        )
        with pytest.raises(ToolError):
            await call(ds_mcp, "get_datasource", {"name": "nonexistent"})
