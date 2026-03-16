"""Unit tests for the tool layer — representative tools from each domain.

Strategy:
    - Mock ``get_client()`` in ``horizon_mcp.client.state`` to return an
      ``AsyncMock`` HorizonClient.
    - Register tools on a real ``FastMCP`` instance via the domain-specific
      ``register_*_tools()`` functions.
    - Invoke each tool through the FastMCP ``_tool_manager.call_tool()``
      interface (validates argument parsing exactly as the MCP runtime would).
    - Assert correct HTTP method/endpoint, payload, and response formatting.

Domains covered (7):
    Config     — list_cas, create_ca, update_ca
    Connectors — list_pki_connectors, create_pki_connector
    Triggers   — list_triggers, create_trigger
    Profiles   — list_profiles, create_webra_profile
    Lifecycle  — search_certificates, get_certificate, download_certificate
    Security   — list_roles, create_role
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
def config_mcp(patched_client: AsyncMock) -> FastMCP:
    """FastMCP with config tools registered."""
    mcp = FastMCP("test-config")
    from horizon_mcp.tools.config import register_config_tools
    register_config_tools(mcp)
    return mcp


@pytest.fixture
def connector_mcp(patched_client: AsyncMock) -> FastMCP:
    """FastMCP with connector tools registered."""
    mcp = FastMCP("test-connectors")
    from horizon_mcp.tools.connectors import register_connector_tools
    register_connector_tools(mcp)
    return mcp


@pytest.fixture
def trigger_mcp(patched_client: AsyncMock) -> FastMCP:
    """FastMCP with trigger tools registered."""
    mcp = FastMCP("test-triggers")
    from horizon_mcp.tools.triggers import register_trigger_tools
    register_trigger_tools(mcp)
    return mcp


@pytest.fixture
def profile_mcp(patched_client: AsyncMock) -> FastMCP:
    """FastMCP with profile tools registered."""
    mcp = FastMCP("test-profiles")
    from horizon_mcp.tools.profiles import register_profile_tools
    register_profile_tools(mcp)
    return mcp


@pytest.fixture
def lifecycle_mcp(patched_client: AsyncMock) -> FastMCP:
    """FastMCP with lifecycle tools registered."""
    mcp = FastMCP("test-lifecycle")
    from horizon_mcp.tools.lifecycle import register_lifecycle_tools
    register_lifecycle_tools(mcp)
    return mcp


@pytest.fixture
def security_mcp(patched_client: AsyncMock) -> FastMCP:
    """FastMCP with security tools registered."""
    mcp = FastMCP("test-security")
    from horizon_mcp.tools.security import register_security_tools
    register_security_tools(mcp)
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
# 1. CONFIG TOOLS
# ═══════════════════════════════════════════════════════════════════════════

class TestConfigListCas:
    """list_cas — read-only GET → client-side filter → JSON response."""

    async def test_returns_all_cas(self, config_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "Root-CA"},
            {"name": "Issuing-CA"},
        ]
        result = await call(config_mcp, "list_cas")

        patched_client.get.assert_awaited_once_with("/api/v1/cas")
        assert result["total"] == 2
        assert result["returned"] == 2
        assert result["truncated"] is False
        assert "Root-CA" in result["content"]

    async def test_name_filter(self, config_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "Root-CA"},
            {"name": "Issuing-CA"},
            {"name": "Test-CA"},
        ]
        result = await call(config_mcp, "list_cas", {"name_contains": "root"})

        assert result["returned"] == 1
        assert result["items"][0]["name"] == "Root-CA"

    async def test_truncation(self, config_mcp, patched_client):
        patched_client.get.return_value = [{"name": f"CA-{i}"} for i in range(60)]
        result = await call(config_mcp, "list_cas", {"max_items": 5})

        assert result["truncated"] is True
        assert result["returned"] == 5
        assert result["total"] == 60
        assert "hint" in result

    async def test_dict_response_envelope(self, config_mcp, patched_client):
        """API sometimes returns {items: [...]} instead of a bare list."""
        patched_client.get.return_value = {"items": [{"name": "CA-1"}]}
        result = await call(config_mcp, "list_cas")
        assert result["returned"] == 1


class TestConfigCreateCa:
    """create_ca — POST with payload construction."""

    async def test_minimal_create(self, config_mcp, patched_client):
        patched_client.post.return_value = {"name": "New-CA", "trustedForClientAuth": False}
        result = await call(config_mcp, "create_ca", {
            "certificate": "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----",
        })

        patched_client.post.assert_awaited_once()
        call_args = patched_client.post.call_args
        assert call_args[0][0] == "/api/v1/cas"
        payload = call_args[1]["json"]
        assert payload["certificate"].startswith("-----BEGIN")
        assert payload["trustedForClientAuth"] is False
        assert payload["trustedForServerAuth"] is False
        assert payload["refresh"] is True
        assert result["status"] == "created"
        assert result["kind"] == "ca"
        assert result["name"] == "New-CA"
        assert result["data"]["name"] == "New-CA"

    async def test_create_with_all_optional_fields(self, config_mcp, patched_client):
        patched_client.post.return_value = {"name": "Full-CA"}
        # Proxy preflight check must succeed
        patched_client.get.return_value = {"name": "my-proxy"}

        result = await call(config_mcp, "create_ca", {
            "certificate": "PEM",
            "trusted_for_client_auth": True,
            "trusted_for_server_auth": True,
            "responder_url": "http://ocsp.example.com",
            "crl_url": "http://crl.example.com",
            "outdated_revocation_status_policy": "ignore",
            "timeout": 30,
            "proxy": "my-proxy",
        })

        payload = patched_client.post.call_args[1]["json"]
        assert payload["trustedForClientAuth"] is True
        assert payload["responderUrl"] == "http://ocsp.example.com"
        assert payload["proxy"] == "my-proxy"
        assert result["status"] == "created"
        assert result["name"] == "Full-CA"


class TestConfigUpdateCa:
    """update_ca — GET->strip->merge->PUT flow."""

    async def test_update_merges_with_existing(self, config_mcp, patched_client):
        # Existing CA from GET
        existing = {
            "_id": "abc123",
            "name": "My-CA",
            "trustedForClientAuth": False,
            "trustedForServerAuth": True,
            "createdAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-06-01T00:00:00Z",
            "certificate": "existing-pem",
        }
        patched_client.get.return_value = existing
        patched_client.put.return_value = {
            "name": "My-CA",
            "trustedForClientAuth": True,
            "trustedForServerAuth": True,
        }

        result = await call(config_mcp, "update_ca", {
            "name": "My-CA",
            "trusted_for_client_auth": True,
        })

        # Verify GET was called
        patched_client.get.assert_awaited_once_with("/api/v1/cas/My-CA")

        # Verify PUT payload
        put_call = patched_client.put.call_args
        assert put_call[0][0] == "/api/v1/cas/"
        payload = put_call[1]["json"]

        # Server fields should be stripped
        assert "_id" not in payload
        assert "createdAt" not in payload
        assert "updatedAt" not in payload
        assert "certificate" not in payload  # stripped for CA domain

        # Override applied
        assert payload["trustedForClientAuth"] is True
        # Preserved from existing
        assert payload["trustedForServerAuth"] is True

        assert result["status"] == "updated"
        assert result["kind"] == "ca"
        assert result["name"] == "My-CA"

    async def test_update_clear_fields(self, config_mcp, patched_client):
        existing = {
            "name": "My-CA",
            "trustedForClientAuth": False,
            "responderUrl": "http://ocsp.example.com",
        }
        patched_client.get.return_value = existing
        patched_client.put.return_value = {"name": "My-CA"}

        await call(config_mcp, "update_ca", {
            "name": "My-CA",
            "clear_fields": ["responderUrl"],
        })

        payload = patched_client.put.call_args[1]["json"]
        assert payload["responderUrl"] is None


# ═══════════════════════════════════════════════════════════════════════════
# 2. CONNECTOR TOOLS
# ═══════════════════════════════════════════════════════════════════════════

class TestConnectorListPki:
    """list_pki_connectors — GET, client-side filter, truncation."""

    async def test_returns_connectors(self, connector_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "adcs-connector", "type": "msadcs"},
            {"name": "ejbca-connector", "type": "ejbca"},
        ]
        result = await call(connector_mcp, "list_pki_connectors")

        patched_client.get.assert_awaited_once_with("/api/v1/pki/connectors")
        assert result["count"] == 2
        assert result["kind"] == "pki_connector"
        assert result["truncated"] is False

    async def test_name_filter(self, connector_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "adcs-prod", "type": "msadcs"},
            {"name": "adcs-dev", "type": "msadcs"},
            {"name": "digicert", "type": "digicert"},
        ]
        result = await call(connector_mcp, "list_pki_connectors", {
            "name_contains": "adcs",
        })
        assert result["count"] == 2


class TestConnectorCreatePki:
    """create_pki_connector — type validation + POST."""

    async def test_valid_create(self, connector_mcp, patched_client):
        patched_client.post.return_value = {
            "name": "my-adcs",
            "type": "msadcs",
            "configuration": {"url": "https://adcs.local"},
        }
        result = await call(connector_mcp, "create_pki_connector", {
            "name": "my-adcs",
            "type": "msadcs",
            "configuration": {"url": "https://adcs.local"},
            "description": "Production ADCS",
        })

        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["name"] == "my-adcs"
        assert payload["type"] == "msadcs"
        assert payload["description"] == "Production ADCS"
        assert result["name"] == "my-adcs"

    async def test_invalid_type_rejected(self, connector_mcp, patched_client):
        result = await call(connector_mcp, "create_pki_connector", {
            "name": "bad",
            "type": "invalid-type",
            "configuration": {},
        })
        assert "error" in result
        assert "valid_types" in result
        # Client POST should never have been called
        patched_client.post.assert_not_awaited()


# ═══════════════════════════════════════════════════════════════════════════
# 3. TRIGGER TOOLS
# ═══════════════════════════════════════════════════════════════════════════

class TestTriggerList:
    """list_triggers — GET with client-side filtering."""

    async def test_returns_triggers(self, trigger_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "email-notify", "type": "email"},
            {"name": "webhook-ci", "type": "webhook"},
        ]
        result = await call(trigger_mcp, "list_triggers")

        patched_client.get.assert_awaited_once_with("/api/v1/triggers")
        assert result["count"] == 2
        assert result["kind"] == "trigger"


class TestTriggerCreate:
    """create_trigger — type/event validation + POST."""

    async def test_valid_create(self, trigger_mcp, patched_client):
        patched_client.post.return_value = {
            "name": "notify-enroll",
            "type": "email",
            "events": ["on_enroll"],
        }
        result = await call(trigger_mcp, "create_trigger", {
            "name": "notify-enroll",
            "type": "email",
            "events": ["on_enroll"],
            "configuration": {"to": "admin@example.com"},
        })

        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["name"] == "notify-enroll"
        assert payload["type"] == "email"
        assert payload["events"] == ["on_enroll"]
        assert payload["retries"] == 0
        assert payload["runOnRenewed"] is False
        assert result["name"] == "notify-enroll"

    async def test_invalid_type(self, trigger_mcp, patched_client):
        result = await call(trigger_mcp, "create_trigger", {
            "name": "bad",
            "type": "sms",
            "events": ["on_enroll"],
            "configuration": {},
        })
        assert "error" in result
        assert "valid_types" in result
        patched_client.post.assert_not_awaited()

    async def test_unknown_events(self, trigger_mcp, patched_client):
        result = await call(trigger_mcp, "create_trigger", {
            "name": "bad",
            "type": "email",
            "events": ["on_enroll", "on_explode"],
            "configuration": {},
        })
        assert "error" in result
        assert "on_explode" in str(result["error"])
        patched_client.post.assert_not_awaited()


# ═══════════════════════════════════════════════════════════════════════════
# 4. PROFILE TOOLS
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


class TestProfileCreateWebra:
    """create_webra_profile — payload assembly + preflight + POST."""

    async def test_minimal_create(self, profile_mcp, patched_client):
        api_response = {"name": "My-WebRA", "module": "webra", "enabled": True}
        patched_client.post.return_value = api_response
        # Preflight checks PKI connector existence
        patched_client.get.return_value = {"name": "my-pki-conn", "type": "msadcs"}

        result = await call(profile_mcp, "create_webra_profile", {
            "name": "My-WebRA",
            "pki_connector": "my-pki-conn",
            "certificate_template": {"subject": {"cn": {"mode": "required"}}},
            "authorization_levels": {"enroll": "authenticated"},
        })

        # POST should have been called with the correct payload
        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["module"] == "webra"
        assert payload["name"] == "My-WebRA"
        assert payload["pkiConnector"] == "my-pki-conn"
        assert payload["enabled"] is True
        assert payload["authorizationMode"] == "authorized"  # default
        assert result["status"] == "created"
        assert result["kind"] == "profile"
        assert result["name"] == "My-WebRA"
        assert result["data"]["name"] == "My-WebRA"


# ═══════════════════════════════════════════════════════════════════════════
# 5. LIFECYCLE TOOLS
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
# 6. SECURITY TOOLS
# ═══════════════════════════════════════════════════════════════════════════

class TestSecurityListRoles:
    """list_roles — delegated to _fetch_list helper."""

    async def test_returns_roles(self, security_mcp, patched_client):
        patched_client.get.return_value = [
            {"name": "admin", "permissions": ["*"]},
            {"name": "operator", "permissions": ["certificates:*"]},
        ]
        result = await call(security_mcp, "list_roles")

        patched_client.get.assert_awaited_once()
        call_args = patched_client.get.call_args
        assert call_args[0][0] == "/api/v1/security/roles"
        # _list_params passes size = max_items + 1
        assert call_args[1]["params"]["size"] == 51
        assert result["count"] == 2
        assert len(result["items"]) == 2

    async def test_name_filter_passed_as_search(self, security_mcp, patched_client):
        patched_client.get.return_value = [{"name": "admin"}]
        await call(security_mcp, "list_roles", {"name_contains": "adm"})

        params = patched_client.get.call_args[1]["params"]
        assert params["search"] == "adm"


class TestSecurityCreateRole:
    """create_role — POST with name, description, permissions."""

    async def test_create_with_permissions(self, security_mcp, patched_client):
        patched_client.post.return_value = {
            "name": "cert-viewer",
            "description": "Can view certificates",
            "permissions": ["certificates:search:*"],
        }
        result = await call(security_mcp, "create_role", {
            "name": "cert-viewer",
            "description": "Can view certificates",
            "permissions": ["certificates:search:*"],
        })

        patched_client.post.assert_awaited_once()
        payload = patched_client.post.call_args[1]["json"]
        assert payload["name"] == "cert-viewer"
        assert payload["description"] == "Can view certificates"
        assert payload["permissions"] == ["certificates:search:*"]
        assert result["name"] == "cert-viewer"

    async def test_create_minimal(self, security_mcp, patched_client):
        patched_client.post.return_value = {"name": "empty-role"}
        result = await call(security_mcp, "create_role", {"name": "empty-role"})

        payload = patched_client.post.call_args[1]["json"]
        assert payload == {"name": "empty-role"}
        assert result["name"] == "empty-role"


class TestSecurityDeleteRole:
    """delete_role — safety echo check."""

    async def test_delete_with_matching_name(self, security_mcp, patched_client):
        patched_client.delete.return_value = None
        result = await call(security_mcp, "delete_role", {
            "name": "old-role",
            "expected_name": "old-role",
        })
        patched_client.delete.assert_awaited_once_with("/api/v1/security/roles/old-role")
        assert result["deleted"] == "old-role"

    async def test_delete_with_mismatch_raises(self, security_mcp, patched_client):
        """Mismatched expected_name raises HorizonError via _delete_guard."""
        from horizon_mcp.client.errors import HorizonError
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError):
            await call(security_mcp, "delete_role", {
                "name": "role-a",
                "expected_name": "role-b",
            })
        patched_client.delete.assert_not_awaited()


# ═══════════════════════════════════════════════════════════════════════════
# 7. ASSIST TOOLS
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
            "/api/v1/certificates/decode",
            json={"pem": pem},
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


# ═══════════════════════════════════════════════════════════════════════════
# CROSS-CUTTING: Error handling
# ═══════════════════════════════════════════════════════════════════════════

class TestConfigErrorHandling:
    """Verify that HorizonError from the client propagates as ToolError."""

    async def test_horizon_error_formatted(self, config_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        from horizon_mcp.client.errors import HorizonError
        patched_client.get.side_effect = HorizonError(
            status_code=404,
            error_code="CA-003",
            message="CA not found",
        )
        with pytest.raises(ToolError, match="CA not found"):
            await call(config_mcp, "list_cas")

    async def test_get_ca_error(self, config_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        from horizon_mcp.client.errors import HorizonError
        patched_client.get.side_effect = HorizonError(
            status_code=403,
            error_code="SecPerm001",
            message="Forbidden",
        )
        with pytest.raises(ToolError, match="Forbidden"):
            await call(config_mcp, "get_ca", {"name": "restricted-ca"})


# ═══════════════════════════════════════════════════════════════════════════
# CROSS-CUTTING: Delete safety echo
# ═══════════════════════════════════════════════════════════════════════════

class TestDeleteSafetyEcho:
    """Delete tools in config domain return error JSON on name mismatch."""

    async def test_ca_delete_mismatch(self, config_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError, match="Safety check failed"):
            await call(config_mcp, "delete_ca", {
                "name": "Real-CA",
                "expected_name": "Wrong-CA",
            })
        patched_client.delete.assert_not_awaited()

    async def test_ca_delete_success(self, config_mcp, patched_client):
        patched_client.delete.return_value = None
        result = await call(config_mcp, "delete_ca", {
            "name": "Old-CA",
            "expected_name": "Old-CA",
        })
        patched_client.delete.assert_awaited_once_with("/api/v1/cas/Old-CA")
        assert "deleted successfully" in result["content"]

    async def test_connector_delete_mismatch(self, connector_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError, match="Safety check failed"):
            await call(connector_mcp, "delete_pki_connector", {
                "name": "conn-a",
                "expected_name": "conn-b",
            })
        patched_client.delete.assert_not_awaited()

    async def test_trigger_delete_mismatch(self, trigger_mcp, patched_client):
        from mcp.server.fastmcp.exceptions import ToolError
        with pytest.raises(ToolError, match="Safety check failed"):
            await call(trigger_mcp, "delete_trigger", {
                "name": "trg-a",
                "expected_name": "trg-b",
            })
        patched_client.delete.assert_not_awaited()
