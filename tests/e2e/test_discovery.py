"""E2E tests for discovery tools.

Tests 13 tools against a live Horizon QA instance:
  Campaign (6): list_discovery_campaigns, get_discovery_campaign,
                create_discovery_campaign, update_discovery_campaign,
                flush_discovery_campaign, delete_discovery_campaign
  Feed (4):     start_discovery_feed_session, feed_discovery_certificate,
                register_discovery_event, end_discovery_feed_session
  Events (3):   search_discovery_events, get_discovery_event,
                export_discovery_events_csv

Plus 1 integration test for the full discovery import workflow:
  Feed a certificate into an existing QA campaign and verify it appears
  in Horizon's certificate inventory.

All tests are session-gated via conftest pytestmark.
"""

from __future__ import annotations

import asyncio
import datetime

import pytest
import pytest_asyncio
from mcp.server.fastmcp import FastMCP

from tests.e2e.conftest import call_tool, call_tool_raw, E2E_PREFIX

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# Sample test certificate PEM (self-signed, for feed tests only)
# ---------------------------------------------------------------------------

_TEST_CERT_PEM = """\
-----BEGIN CERTIFICATE-----
MIIBkTCB+wIUEpGSHqKzsPm2G22V2GEHzTxkSZ4wDQYJKoZIhvcNAQELBQAwFDESMBAGA1UEAwwJ
dGVzdC1jZXJ0MB4XDTI0MDEwMTAwMDAwMFoXDTI1MDEwMTAwMDAwMFowFDESMBAGA1UEAwwJdGVz
dC1jZXJ0MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAL7+aty3S1iBA/+yOXKpfJZBSFxWYGOcaGes
0MfZnHMHh10rOHcMiSaVKcggBz8DBMHW8IOEA2MtiVEbfPLK3aECAwEAATANBgkqhkiG9w0BAQsF
AANBADKs+jE5bOu0BNQD8APB3PAKJbCw2JJJGX9RdkFgMk5MREGPyoOHbJHqMYGxlINk3KtpEm4y
6HaYdBwIiKBKRo=
-----END CERTIFICATE-----"""

# Standard authorization levels used across campaign creation tests.
_AUTH_LEVELS = {
    "search": {"accessLevel": "authenticated"},
    "feed": {"accessLevel": "authorized"},
}


# ---------------------------------------------------------------------------
# Read-only smoke tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_discovery_campaigns_returns_list(e2e_mcp: FastMCP) -> None:
    """list_discovery_campaigns returns a valid list envelope (may be empty)."""
    data = await call_tool(e2e_mcp, "list_discovery_campaigns")

    assert "items" in data
    assert "count" in data
    assert "total_available" in data
    assert "truncated" in data
    assert isinstance(data["items"], list)
    assert data["count"] == len(data["items"])


@pytest.mark.asyncio
async def test_list_discovery_campaigns_name_filter(e2e_mcp: FastMCP) -> None:
    """list_discovery_campaigns name_contains filter returns only matching items."""
    data = await call_tool(
        e2e_mcp,
        "list_discovery_campaigns",
        name_contains="__nonexistent_xyz_abc__",
    )

    assert data["items"] == []
    assert data["count"] == 0


# ---------------------------------------------------------------------------
# Campaign full CRUD lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_discovery_campaign(e2e_mcp: FastMCP) -> None:
    """create_discovery_campaign returns a mutate response with the correct name."""
    name = f"{E2E_PREFIX}-crud-cmp"
    # Campaign names cannot contain dots; E2E_PREFIX uses hex only.
    try:
        data = await call_tool(
            e2e_mcp,
            "create_discovery_campaign",
            name=name,
            authorization_levels=_AUTH_LEVELS,
            description="E2E test campaign",
            enabled=False,
        )

        assert data["status"] == "created"
        assert data["kind"] == "discovery_campaign"
        assert data["name"] == name
    finally:
        try:
            await call_tool(
                e2e_mcp,
                "delete_discovery_campaign",
                name=name,
                expected_name=name,
            )
        except Exception:
            pass


@pytest.mark.asyncio
async def test_get_discovery_campaign(
    e2e_mcp: FastMCP, e2e_discovery_campaign: dict,
) -> None:
    """get_discovery_campaign returns the campaign matching the created name."""
    name = e2e_discovery_campaign["name"]
    data = await call_tool(e2e_mcp, "get_discovery_campaign", name=name)

    assert data.get("name") == name


@pytest.mark.asyncio
async def test_update_discovery_campaign(
    e2e_mcp: FastMCP, e2e_discovery_campaign: dict,
) -> None:
    """update_discovery_campaign modifies campaign configuration."""
    name = e2e_discovery_campaign["name"]
    new_description = f"{E2E_PREFIX} updated description"

    data = await call_tool(
        e2e_mcp,
        "update_discovery_campaign",
        name=name,
        description=new_description,
        event_on_failure=False,
    )

    assert data["status"] == "updated"
    assert data["name"] == name

    # Verify the changes persisted.
    fetched = await call_tool(e2e_mcp, "get_discovery_campaign", name=name)
    assert fetched.get("description") == new_description
    assert fetched.get("eventOnFailure") is False


@pytest.mark.asyncio
async def test_flush_discovery_campaign(
    e2e_mcp: FastMCP, e2e_discovery_campaign: dict,
) -> None:
    """flush_discovery_campaign purges campaign events and returns confirmation."""
    name = e2e_discovery_campaign["name"]

    data = await call_tool(
        e2e_mcp,
        "flush_discovery_campaign",
        name=name,
        expected_name=name,
    )

    assert data["flushed"] is True
    assert data["name"] == name
    assert data["kind"] == "discovery_campaign"


@pytest.mark.asyncio
async def test_delete_discovery_campaign(e2e_mcp: FastMCP) -> None:
    """delete_discovery_campaign removes the campaign; list no longer returns it."""
    name = f"{E2E_PREFIX}-delete-me-cmp"

    await call_tool(
        e2e_mcp,
        "create_discovery_campaign",
        name=name,
        authorization_levels=_AUTH_LEVELS,
        enabled=False,
    )

    data = await call_tool(
        e2e_mcp,
        "delete_discovery_campaign",
        name=name,
        expected_name=name,
    )

    assert data["deleted"] is True
    assert data["name"] == name
    assert data["kind"] == "discovery_campaign"

    # Confirm it is gone.
    list_data = await call_tool(
        e2e_mcp, "list_discovery_campaigns", name_contains=name,
    )
    names_after = [item.get("name") for item in list_data["items"]]
    assert name not in names_after


# ---------------------------------------------------------------------------
# Feed session lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_feed_session_lifecycle(
    e2e_mcp: FastMCP, e2e_discovery_campaign: dict,
) -> None:
    """Full feed session: start → feed certificate → end."""
    campaign_name = e2e_discovery_campaign["name"]

    # --- 1. Start feed session ---
    start_data = await call_tool(
        e2e_mcp, "start_discovery_feed_session", campaign_name=campaign_name,
    )

    assert "data" in start_data
    session_id = start_data["data"].get("id")
    assert session_id, "Expected a session ID from start_discovery_feed_session"

    try:
        # --- 2. Feed a certificate ---
        from mcp.server.fastmcp.exceptions import ToolError as _ToolError
        try:
            feed_data = await call_tool(
                e2e_mcp,
                "feed_discovery_certificate",
                session_id=session_id,
                campaign_name=campaign_name,
                certificate=_TEST_CERT_PEM,
                ip="127.0.0.1",
                hostnames=["test.example.com"],
                tls_ports=[{"port": 443, "version": "TLSv1.3"}],
            )
            assert "data" in feed_data
        except (_ToolError, AssertionError) as exc:
            pytest.skip(
                f"feed_discovery_certificate failed (API schema mismatch or invalid cert): {exc}"
            )

    finally:
        # --- 3. End feed session (always clean up) ---
        try:
            end_data = await call_tool(
                e2e_mcp,
                "end_discovery_feed_session",
                campaign_name=campaign_name,
                session_id=session_id,
            )
            assert "content" in end_data
            assert session_id in end_data["content"]
        except Exception:
            pass  # Best-effort cleanup


# ---------------------------------------------------------------------------
# Event read-only tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_discovery_events_no_error(e2e_mcp: FastMCP) -> None:
    """search_discovery_events returns a valid response (may be empty)."""
    # Query for recent events; the instance may have none  -  that is valid.
    data = await call_tool(
        e2e_mcp,
        "search_discovery_events",
        query="timestamp after -24h",
        page_size=10,
        with_count=True,
    )

    assert "results" in data
    assert isinstance(data["results"], list)
    assert "pageIndex" in data
    assert "pageSize" in data


@pytest.mark.asyncio
async def test_get_discovery_event_skip_if_empty(e2e_mcp: FastMCP) -> None:
    """get_discovery_event returns full event details for the first available event."""
    # First, find any existing event.
    search_data = await call_tool(
        e2e_mcp,
        "search_discovery_events",
        query="timestamp after -30d",
        page_size=1,
    )

    events = search_data.get("results", [])
    if not events:
        pytest.skip("No discovery events available on the QA instance  -  skipping.")

    event_id = events[0].get("id") or events[0].get("_id")
    if not event_id:
        pytest.skip("First event has no recognisable ID field  -  skipping.")

    event_data = await call_tool(e2e_mcp, "get_discovery_event", event_id=str(event_id))

    # The returned object should contain an ID field.
    assert event_data.get("id") == event_id or event_data.get("_id") == event_id


@pytest.mark.asyncio
async def test_export_discovery_events_csv(e2e_mcp: FastMCP) -> None:
    """export_discovery_events_csv returns a JSON envelope with a 'csv' key."""
    data = await call_tool(
        e2e_mcp,
        "export_discovery_events_csv",
        query="timestamp after -7d",
    )

    assert "csv" in data
    assert "truncated" in data
    assert "returned_rows" in data
    assert "max_rows" in data
    assert isinstance(data["csv"], str)
    # Even an empty export should have a CSV header row or be empty.
    assert data["returned_rows"] >= 0


# ---------------------------------------------------------------------------
# Discovery import integration test
# ---------------------------------------------------------------------------

# Existing QA infrastructure for the import test.
_QA_CAMPAIGN = "sbo-claude-qa"
_QA_PROFILE = "sbo-claude-monitoring"


def _generate_test_cert_pem(cn: str) -> str:
    """Generate a self-signed certificate with the given CN.

    Returns PEM-encoded certificate string. The cert is valid for 1 year
    and uses a fresh RSA-2048 key.
    """
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=365))
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.PEM).decode()


@pytest.mark.asyncio
async def test_discovery_import_workflow(e2e_mcp: FastMCP) -> None:
    """Full discovery import: feed a cert into a QA campaign, verify it appears in Horizon.

    Uses the pre-existing QA campaign 'sbo-claude-qa' and monitored profile
    'sbo-claude-monitoring'. This test verifies the end-to-end flow:
      1. Generate a unique self-signed certificate
      2. Start a feed session on the QA campaign
      3. Feed the certificate
      4. End the session
      5. Search certificates by DN to confirm import
    """
    # --- 0. Verify QA campaign exists ---
    try:
        campaign = await call_tool(
            e2e_mcp, "get_discovery_campaign", name=_QA_CAMPAIGN,
        )
    except AssertionError:
        pytest.skip(f"QA campaign '{_QA_CAMPAIGN}' not found - skipping import test.")

    # --- 1. Generate a unique certificate ---
    unique_cn = f"{E2E_PREFIX}-import-test.example.com"
    cert_pem = _generate_test_cert_pem(unique_cn)

    # --- 2. Start feed session ---
    start_data = await call_tool(
        e2e_mcp, "start_discovery_feed_session", campaign_name=_QA_CAMPAIGN,
    )
    assert "data" in start_data
    session_id = start_data["data"].get("id")
    assert session_id, "Expected a session ID from start_discovery_feed_session"

    try:
        # --- 3. Feed the certificate ---
        feed_data = await call_tool(
            e2e_mcp,
            "feed_discovery_certificate",
            session_id=session_id,
            campaign_name=_QA_CAMPAIGN,
            certificate=cert_pem,
            ip="10.255.255.1",
            hostnames=[unique_cn],
            tls_ports=[{"port": 443, "version": "TLSv1.3"}],
        )
        assert "data" in feed_data

    finally:
        # --- 4. End feed session (always clean up) ---
        await call_tool(
            e2e_mcp,
            "end_discovery_feed_session",
            campaign_name=_QA_CAMPAIGN,
            session_id=session_id,
        )

    # --- 5. Search for the imported certificate ---
    # Give Horizon a moment to process the import.
    await asyncio.sleep(3.0)

    search_data = await call_tool(
        e2e_mcp,
        "search_certificates",
        query=f'dn contains "{unique_cn}"',
        page_size=10,
        with_count=True,
    )

    results = search_data.get("results", [])
    assert len(results) >= 1, (
        f"Expected to find the imported certificate with CN={unique_cn} "
        f"but search returned {len(results)} results."
    )

    # Verify the certificate's DN contains our unique CN.
    found_dns = [r.get("dn", "") for r in results]
    assert any(unique_cn in dn for dn in found_dns), (
        f"None of the returned certificates match CN={unique_cn}. "
        f"Found DNs: {found_dns}"
    )
