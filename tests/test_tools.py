"""Unit tests for the tool layer — representative tools from each domain.

Strategy:
    - Mock ``get_client()`` in ``horizon_mcp.client.state`` to return an
      ``AsyncMock`` HorizonClient.
    - Register tools on a real ``FastMCP`` instance via the domain-specific
      ``register_*_tools()`` functions.
    - Invoke each tool through the FastMCP ``_tool_manager.call_tool()``
      interface (validates argument parsing exactly as the MCP runtime would).
    - Assert correct HTTP method/endpoint, payload, and response formatting.

Domains covered (3):
    Profiles   — list_profiles (read-only)
    Lifecycle  — search_certificates, get_certificate, download_certificate
    Assist     — whoami, decode_x509, validate_hcql
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from mcp.server.fastmcp import FastMCP


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_client() -> AsyncMock:
    """Return a mock HorizonClient with async HTTP methods."""
    client = AsyncMock()
    # By default, async methods return empty dicts/lists
    client.get = AsyncMock(return_value=[])
    client.post = AsyncMock(return_value={})
    client.put = AsyncMock(return_value={})
    client.delete = AsyncMock(return_value=None)
    client.get_text = AsyncMock(return_value="")
    client.get_bytes = AsyncMock(return_value=b"")
    return client


@pytest.fixture
def patched_client(mock_client: AsyncMock):
    """Set the global client state so every ``get_client()`` call returns the mock.

    Uses ``set_client`` / ``clear_client`` instead of patching the function
    itself -- this way every module that imported ``get_client`` at the top
    level still resolves correctly through the shared ``_client`` global.
    """
    from horizon_mcp.client.state import set_client, clear_client
    set_client(mock_client)
    yield mock_client
    clear_client()


@pytest.fixture
def profile_mcp(patched_client: AsyncMock) -> FastMCP:
    """FastMCP with profile readonly tools registered."""
    mcp = FastMCP("test-profiles")
    from horizon_mcp.tools.profiles import register_profile_readonly_tools
    register_profile_readonly_tools(mcp)
    return mcp


@pytest.fixture
def lifecycle_mcp(patched_client: AsyncMock) -> FastMCP:
    """FastMCP with lifecycle tools registered."""
    mcp = FastMCP("test-lifecycle")
    from horizon_mcp.tools.lifecycle import register_lifecycle_tools
    register_lifecycle_tools(mcp)
    return mcp


@pytest.fixture
def assist_mcp(patched_client: AsyncMock) -> FastMCP:
    """FastMCP with assist tools registered."""
    mcp = FastMCP("test-assist")
    from horizon_mcp.tools.assist import register_assist_tools
    register_assist_tools(mcp)
    return mcp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def call(mcp: FastMCP, name: str, args: dict | None = None) -> dict:
    """Invoke a tool by name, parse the JSON string result into a dict."""
    raw = await mcp._tool_manager.call_tool(name, args or {})
    return json.loads(raw)


# ═══════════════════════════════════════════════════════════════════════════
# 1. PROFILE TOOLS (read-only)
# ═══════════════════════════════════════════════════════════════════════════

class TestProfileList:
    """list_profiles — GET with name + module filtering."""

    async def test_returns_profiles(self, profile_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "WebRA-Prod", "module": "webra"},
            {"name": "ACME-Staging", "module": "acme"},
        ]
        result = await call(profile_mcp, "list_profiles")

        patched_client.get.assert_awaited_once_with("/api/v1/certificate/profiles")
        assert result["count"] == 2
        assert result["kind"] == "profile"

    async def test_module_filter(self, profile_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "WebRA-Prod", "module": "webra"},
            {"name": "ACME-Staging", "module": "acme"},
            {"name": "WebRA-Dev", "module": "webra"},
        ]
        result = await call(profile_mcp, "list_profiles", {"module": "webra"})
        assert result["count"] == 2
        assert all(i["module"] == "webra" for i in result["items"])


# ═══════════════════════════════════════════════════════════════════════════
# 2. LIFECYCLE TOOLS
# ═══════════════════════════════════════════════════════════════════════════

class TestLifecycleSearchCertificates:
    """search_certificates — POST with HCQL query, field presets, truncation."""

    async def test_basic_search(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = {
            "results": [
                {"dn": "CN=test.example.com", "serial": "01", "profile": "WebRA"},
            ],
        }
        result = await call(lifecycle_mcp, "search_certificates", {
            "query": 'profile = "WebRA"',
        })

        patched_client.post.assert_awaited_once()
        post_args = patched_client.post.call_args
        assert post_args[0][0] == "/api/v1/certificates/search"
        payload = post_args[1]["json"]
        assert payload["query"] == 'profile = "WebRA"'
        # Default preset is "compact"
        assert "dn" in payload["fields"]
        assert "serial" in payload["fields"]
        assert payload["pageIndex"] == 0
        assert payload["pageSize"] == 25

        assert len(result["results"]) == 1
        assert result["pageIndex"] == 0

    async def test_custom_fields_override_preset(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = {"results": []}
        await call(lifecycle_mcp, "search_certificates", {
            "query": "*",
            "fields": ["dn", "grade"],
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["fields"] == ["dn", "grade"]

    async def test_page_size_capped(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = {"results": []}
        result = await call(lifecycle_mcp, "search_certificates", {
            "query": "*",
            "page_size": 500,
        })
        payload = patched_client.post.call_args[1]["json"]
        assert payload["pageSize"] == 100  # MAX_PAGE_SIZE
        assert result["pageSize"] == 100


class TestLifecycleGetCertificate:
    """get_certificate — GET by ID, untruncated."""

    async def test_returns_full_certificate(self, lifecycle_mcp, patched_client):
        cert_data = {
            "dn": "CN=test.example.com",
            "serial": "01AB",
            "profile": "WebRA",
            "extensions": {"keyUsage": ["digitalSignature"]},
        }
        patched_client.get.return_value = cert_data
        result = await call(lifecycle_mcp, "get_certificate", {
            "certificate_id": "abc-123",
        })

        patched_client.get.assert_awaited_once_with("/api/v1/certificates/abc-123")
        assert result["dn"] == "CN=test.example.com"
        assert result["extensions"]["keyUsage"] == ["digitalSignature"]


class TestLifecycleDownloadCertificate:
    """download_certificate — PEM extraction from certificate details."""

    async def test_pem_download(self, lifecycle_mcp, patched_client):
        pem = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----"
        patched_client.get.return_value = {
            "dn": "CN=test.example.com",
            "certificate": pem,
        }

        result = await call(lifecycle_mcp, "download_certificate", {
            "certificate_id": "abc-123",
            "format": "pem",
        })

        patched_client.get.assert_awaited_once_with("/api/v1/certificates/abc-123")
        assert result["format"] == "pem"
        assert result["content"] == pem

    async def test_non_pem_format_returns_error(self, lifecycle_mcp, patched_client):
        result = await call(lifecycle_mcp, "download_certificate", {
            "certificate_id": "abc-123",
            "format": "der",
        })
        assert "error" in result
        assert "Only PEM" in result["error"]

    async def test_invalid_format_rejected(self, lifecycle_mcp, patched_client):
        result = await call(lifecycle_mcp, "download_certificate", {
            "certificate_id": "abc-123",
            "format": "xml",
        })
        assert "error" in result
        assert "Only PEM" in result["error"]

    async def test_jks_format_returns_error(self, lifecycle_mcp, patched_client):
        result = await call(lifecycle_mcp, "download_certificate", {
            "certificate_id": "abc-123",
            "format": "jks",
        })
        assert "error" in result
        assert "Only PEM" in result["error"]


class TestLifecycleSubmitRequest:
    """submit_request — POST with structured template payload."""

    async def test_enrollment_with_template(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = {
            "id": "req-001",
            "workflow": "enroll",
            "status": "pending",
        }
        template = {
            "subject": [{"element": "cn.1", "type": "CN", "value": "server.local"}],
            "sans": [{"type": "DNSNAME", "value": ["server.local"]}],
            "labels": [{"label": "env", "value": "prod"}],
            "keyType": "rsa-3072",
        }
        result = await call(lifecycle_mcp, "submit_request", {
            "workflow": "enroll",
            "profile": "my-profile",
            "module": "webra",
            "template": template,
            "password": "changeit",
        })

        patched_client.post.assert_awaited_once()
        call_args = patched_client.post.call_args
        assert call_args[0][0] == "/api/v1/requests/submit"
        payload = call_args[1]["json"]
        assert payload["workflow"] == "enroll"
        assert payload["profile"] == "my-profile"
        assert payload["module"] == "webra"
        assert payload["password"] == "changeit"
        assert payload["template"]["keyType"] == "rsa-3072"
        assert payload["template"]["sans"][0]["value"] == ["server.local"]
        assert payload["template"]["labels"][0]["label"] == "env"
        assert result["id"] == "req-001"

    async def test_revoke_without_template(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = {"id": "req-002", "workflow": "revoke"}
        result = await call(lifecycle_mcp, "submit_request", {
            "workflow": "revoke",
            "profile": "my-profile",
            "module": "webra",
            "certificate_id": "cert-abc",
        })

        payload = patched_client.post.call_args[1]["json"]
        assert payload["workflow"] == "revoke"
        assert payload["certificateId"] == "cert-abc"
        assert "template" not in payload
        assert "password" not in payload

    async def test_explicit_params_override_data(self, lifecycle_mcp, patched_client):
        patched_client.post.return_value = {"id": "req-003"}
        await call(lifecycle_mcp, "submit_request", {
            "workflow": "enroll",
            "profile": "p",
            "module": "webra",
            "template": {"keyType": "rsa-3072"},
            "data": {"template": {"keyType": "rsa-2048"}, "extra": "field"},
        })

        payload = patched_client.post.call_args[1]["json"]
        # Explicit template param should override data's template
        assert payload["template"]["keyType"] == "rsa-3072"
        # Extra fields from data should still be present
        assert payload["extra"] == "field"


class TestLifecycleApproveRequest:
    """approve_request — preflight permission check + POST with id and workflow."""

    async def test_approve_with_permission(self, lifecycle_mcp, patched_client):
        # GET request returns permissions and workflow
        patched_client.get.return_value = {
            "workflow": "enroll",
            "status": "pending",
            "profile": "my-profile",
            "permissions": {"approve": True, "cancel": True},
        }
        patched_client.post.return_value = {
            "id": "req-001",
            "status": "approved",
        }
        result = await call(lifecycle_mcp, "approve_request", {
            "request_id": "req-001",
        })

        # Verify preflight GET
        patched_client.get.assert_awaited_once_with("/api/v1/requests/req-001")
        # Verify POST with id + auto-detected workflow
        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload == {"id": "req-001", "workflow": "enroll"}
        assert result["status"] == "approved"

    async def test_approve_without_permission_blocked(self, lifecycle_mcp, patched_client):
        patched_client.get.return_value = {
            "workflow": "enroll",
            "status": "pending",
            "profile": "my-profile",
            "permissions": {"approve": False, "cancel": True},
        }
        result = await call(lifecycle_mcp, "approve_request", {
            "request_id": "req-001",
        })

        # POST should NOT have been called
        patched_client.post.assert_not_awaited()
        assert "Permission denied" in result["error"]
        assert result["your_permissions"]["approve"] is False
        assert "Do NOT retry" in result["error"]

    async def test_approve_non_pending_blocked(self, lifecycle_mcp, patched_client):
        patched_client.get.return_value = {
            "workflow": "enroll",
            "status": "approved",
            "permissions": {"approve": True, "cancel": False},
        }
        result = await call(lifecycle_mcp, "approve_request", {
            "request_id": "req-001",
        })

        patched_client.post.assert_not_awaited()
        assert "not pending" in result["error"]


class TestLifecycleDenyRequest:
    """deny_request — preflight permission check + POST."""

    async def test_deny_with_permission(self, lifecycle_mcp, patched_client):
        patched_client.get.return_value = {
            "workflow": "enroll",
            "status": "pending",
            "permissions": {"approve": True, "cancel": True},
        }
        patched_client.post.return_value = {"id": "req-002", "status": "denied"}
        result = await call(lifecycle_mcp, "deny_request", {
            "request_id": "req-002",
        })

        payload = patched_client.post.call_args[1]["json"]
        assert payload == {"id": "req-002", "workflow": "enroll"}
        assert result["status"] == "denied"

    async def test_deny_without_permission_blocked(self, lifecycle_mcp, patched_client):
        patched_client.get.return_value = {
            "workflow": "enroll",
            "status": "pending",
            "permissions": {"approve": False, "cancel": True},
        }
        result = await call(lifecycle_mcp, "deny_request", {
            "request_id": "req-002",
        })

        patched_client.post.assert_not_awaited()
        assert "Permission denied" in result["error"]


class TestLifecycleCancelRequest:
    """cancel_request — preflight permission check + POST."""

    async def test_cancel_with_permission(self, lifecycle_mcp, patched_client):
        patched_client.get.return_value = {
            "workflow": "enroll",
            "status": "pending",
            "permissions": {"approve": False, "cancel": True},
        }
        patched_client.post.return_value = {"id": "req-003", "status": "cancelled"}
        result = await call(lifecycle_mcp, "cancel_request", {
            "request_id": "req-003",
        })

        payload = patched_client.post.call_args[1]["json"]
        assert payload == {"id": "req-003", "workflow": "enroll"}
        assert result["status"] == "cancelled"

    async def test_cancel_without_permission_blocked(self, lifecycle_mcp, patched_client):
        patched_client.get.return_value = {
            "workflow": "enroll",
            "status": "pending",
            "permissions": {"approve": True, "cancel": False},
        }
        result = await call(lifecycle_mcp, "cancel_request", {
            "request_id": "req-003",
        })

        patched_client.post.assert_not_awaited()
        assert "Permission denied" in result["error"]


# ═══════════════════════════════════════════════════════════════════════════
# 3. ASSIST TOOLS
# ═══════════════════════════════════════════════════════════════════════════

class TestAssistWhoami:
    """whoami — GET /api/v1/security/principals/self."""

    async def test_returns_principal(self, assist_mcp, patched_client):
        principal = {
            "identifier": "test-admin",
            "name": "Test Admin",
            "roles": ["admin"],
            "teams": [],
            "permissions": ["*"],
        }
        patched_client.get.return_value = principal
        result = await call(assist_mcp, "whoami")

        patched_client.get.assert_awaited_once_with(
            "/api/v1/security/principals/self",
        )
        assert result["identifier"] == "test-admin"
        assert result["roles"] == ["admin"]


class TestAssistDecodeX509:
    """decode_x509 — POST PEM to decode endpoint."""

    async def test_decodes_certificate(self, assist_mcp, patched_client):
        decode_result = {
            "subject": {"CN": "test.example.com"},
            "issuer": {"CN": "Test CA"},
            "notAfter": "2025-12-31T23:59:59Z",
        }
        patched_client.post.return_value = decode_result

        pem = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----"
        result = await call(assist_mcp, "decode_x509", {"pem": pem})

        patched_client.post.assert_awaited_once_with(
            "/api/v1/rfc5280/x509",
            files={"x509": ("certificate.pem", pem.encode(), "application/x-pem-file")},
        )
        assert result["subject"]["CN"] == "test.example.com"


class TestAssistValidateHcql:
    """validate_hcql — minimal search to validate query syntax."""

    async def test_valid_query(self, assist_mcp, patched_client):
        patched_client.post.return_value = {"count": 42, "hasMore": True, "results": []}

        query = 'dn matches ".*example.com" and status is valid'
        result = await call(assist_mcp, "validate_hcql", {"query": query})

        patched_client.post.assert_awaited_once_with(
            "/api/v1/certificates/search",
            json={"query": query, "pageSize": 1},
        )
        assert result["valid"] is True
        assert result["query_type"] == "HCQL"
        assert result["count"] == 42

    async def test_invalid_query(self, assist_mcp, patched_client):
        patched_client.post.side_effect = Exception("Unexpected token at position 5")
        result = await call(assist_mcp, "validate_hcql", {"query": "bad %%% query"})
        assert result["valid"] is False
        assert "error" in result


class TestAssistDescribeQueryFields:
    """describe_query_fields — local tool (no API call)."""

    async def test_hcql_metadata(self, assist_mcp, patched_client):
        result = await call(assist_mcp, "describe_query_fields", {
            "query_type": "hcql",
        })
        assert result["query_type"] == "hcql"
        assert result["supports_aggregate"] is True
        field_names = [f["name"] for f in result["fields"]]
        assert "dn" in field_names
        # No API call should have been made
        patched_client.get.assert_not_awaited()

    async def test_unknown_type(self, assist_mcp, patched_client):
        result = await call(assist_mcp, "describe_query_fields", {
            "query_type": "sql",
        })
        assert "error" in result
        assert "valid_types" in result
