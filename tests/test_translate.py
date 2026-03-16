"""Tests for the natural language → HQL translation tool.

Covers:
    1. Intent detection (query type auto-detection)
    2. HCQL condition extraction (statuses, properties, key types, dates, fields, grades)
    3. HRQL condition extraction (workflows, statuses, dates)
    4. HEQL condition extraction (event codes, dates)
    5. HDQL condition extraction (ports, IPs, hostnames, campaigns)
    6. Full tool invocation with mock client validation
    7. Edge cases (empty input, ambiguous input, forced target_type)
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from horizon_mcp.client.state import clear_client, set_client
from horizon_mcp.tools.assist.translate import (
    _Condition,
    _detect_intent,
    _extract_hcql,
    _extract_hdql,
    _extract_heql,
    _extract_hrql,
)


# ---------------------------------------------------------------------------
# 1. Intent detection
# ---------------------------------------------------------------------------

class TestIntentDetection:

    def test_certificates_detected_as_hcql(self):
        qt, conf = _detect_intent("find expired certificates")
        assert qt == "hcql"
        assert conf >= 0.5

    def test_requests_detected_as_hrql(self):
        qt, _ = _detect_intent("pending enrollment requests")
        assert qt == "hrql"

    def test_events_detected_as_heql(self):
        qt, _ = _detect_intent("audit events from last week")
        assert qt == "heql"

    def test_discovery_detected_as_hdql(self):
        qt, _ = _detect_intent("discovery scans on port 443")
        assert qt == "hdql"

    def test_ambiguous_defaults_to_hcql(self):
        qt, conf = _detect_intent("show me everything")
        assert qt == "hcql"
        assert conf < 0.5

    def test_strong_signal_high_confidence(self):
        qt, conf = _detect_intent("list all revoked certificates with grade worse than C")
        assert qt == "hcql"
        assert conf >= 0.7


# ---------------------------------------------------------------------------
# 2. HCQL condition extraction
# ---------------------------------------------------------------------------

class TestHCQLExtraction:

    def test_status_expired(self):
        conds = _extract_hcql("expired certificates")
        fragments = [c.fragment for c in conds]
        assert "status is expired" in fragments

    def test_status_not_revoked(self):
        conds = _extract_hcql("not revoked certificates")
        fragments = [c.fragment for c in conds]
        assert "status is not revoked" in fragments

    def test_status_valid(self):
        conds = _extract_hcql("valid certificates")
        fragments = [c.fragment for c in conds]
        assert "status is valid" in fragments

    def test_selfsigned_property(self):
        conds = _extract_hcql("self-signed certificates")
        fragments = [c.fragment for c in conds]
        assert "certificate is selfsigned" in fragments

    def test_not_selfsigned(self):
        conds = _extract_hcql("not self-signed certificates")
        fragments = [c.fragment for c in conds]
        assert "certificate is not selfsigned" in fragments

    def test_discovered_property(self):
        conds = _extract_hcql("discovered certificates")
        fragments = [c.fragment for c in conds]
        assert "certificate is discovered" in fragments

    def test_rsa_keytype(self):
        conds = _extract_hcql("RSA certificates")
        fragments = [c.fragment for c in conds]
        assert 'keytype contains "rsa"' in fragments

    def test_ecdsa_keytype(self):
        conds = _extract_hcql("ECDSA certificates")
        fragments = [c.fragment for c in conds]
        assert 'keytype contains "ec"' in fragments

    def test_expiring_in_30_days(self):
        conds = _extract_hcql("certificates expiring in 30 days")
        fragments = [c.fragment for c in conds]
        assert "valid.until before 30d" in fragments

    def test_expiring_soon(self):
        conds = _extract_hcql("certificates expiring soon")
        fragments = [c.fragment for c in conds]
        assert "valid.until before 30d" in fragments

    def test_next_7_days(self):
        conds = _extract_hcql("certificates expiring in the next 7 days")
        fragments = [c.fragment for c in conds]
        assert "valid.until before 7d" in fragments

    def test_last_24_hours(self):
        conds = _extract_hcql("certificates issued in the last 24 hours")
        fragments = [c.fragment for c in conds]
        assert "valid.from after -24h" in fragments

    def test_profile_field(self):
        conds = _extract_hcql("certificates from profile WebRA-Prod")
        fragments = [c.fragment for c in conds]
        assert 'profile equals "WebRA-Prod"' in fragments

    def test_team_field(self):
        conds = _extract_hcql("certificates from team platform-team")
        fragments = [c.fragment for c in conds]
        assert 'team equals "platform-team"' in fragments

    def test_owner_field(self):
        conds = _extract_hcql("certificates where owner is admin@corp.io")
        fragments = [c.fragment for c in conds]
        assert 'owner equals "admin@corp.io"' in fragments

    def test_grade_worse_than(self):
        conds = _extract_hcql("certificates with grade worse than B")
        fragments = [c.fragment for c in conds]
        assert "grade strictly lower than B" in fragments

    def test_grade_better_than(self):
        conds = _extract_hcql("certificates with grade better than C")
        fragments = [c.fragment for c in conds]
        assert "grade strictly greater than C" in fragments

    def test_trigger_failure(self):
        conds = _extract_hcql("certificates with failed triggers")
        fragments = [c.fragment for c in conds]
        assert "trigger.results has failure" in fragments

    def test_hybrid_certificate_type(self):
        conds = _extract_hcql("hybrid certificates")
        fragments = [c.fragment for c in conds]
        assert "certificatetype is hybrid" in fragments

    def test_composite_query(self):
        """Multiple conditions combine correctly."""
        conds = _extract_hcql(
            "expired RSA certificates from team alpha expiring in 30 days"
        )
        fragments = [c.fragment for c in conds]
        assert "status is expired" in fragments
        assert 'keytype contains "rsa"' in fragments
        assert 'team equals "alpha"' in fragments

    def test_week_converts_to_days(self):
        conds = _extract_hcql("certificates expiring in the next 2 weeks")
        fragments = [c.fragment for c in conds]
        assert "valid.until before 14d" in fragments

    def test_month_converts_to_days(self):
        conds = _extract_hcql("certificates issued in the last 3 months")
        fragments = [c.fragment for c in conds]
        assert "valid.from after -90d" in fragments


# ---------------------------------------------------------------------------
# 3. HRQL condition extraction
# ---------------------------------------------------------------------------

class TestHRQLExtraction:

    def test_enrollment_workflow(self):
        conds = _extract_hrql("pending enrollment requests")
        fragments = [c.fragment for c in conds]
        assert 'workflow equals "enroll"' in fragments
        assert 'status equals "pending"' in fragments

    def test_denied_requests(self):
        conds = _extract_hrql("denied requests")
        fragments = [c.fragment for c in conds]
        assert 'status equals "denied"' in fragments

    def test_revocation_workflow(self):
        conds = _extract_hrql("revocation requests from last 7 days")
        fragments = [c.fragment for c in conds]
        assert 'workflow equals "revoke"' in fragments
        assert "registration.date after -7d" in fragments

    def test_profile_field(self):
        conds = _extract_hrql("requests for profile ACME-Prod")
        fragments = [c.fragment for c in conds]
        assert 'profile equals "ACME-Prod"' in fragments

    def test_requester_field(self):
        conds = _extract_hrql("requests where requester is admin")
        fragments = [c.fragment for c in conds]
        assert 'requester equals "admin"' in fragments


# ---------------------------------------------------------------------------
# 4. HEQL condition extraction
# ---------------------------------------------------------------------------

class TestHEQLExtraction:

    def test_enrollment_events(self):
        conds = _extract_heql("enrollment events")
        fragments = [c.fragment for c in conds]
        assert 'code equals "LIFECYCLE-ENROLL"' in fragments

    def test_events_last_24h(self):
        conds = _extract_heql("events in the last 24 hours")
        fragments = [c.fragment for c in conds]
        assert "timestamp after -24h" in fragments

    def test_revocation_events(self):
        conds = _extract_heql("revocation events from last 7 days")
        fragments = [c.fragment for c in conds]
        assert 'code equals "LIFECYCLE-REVOKE"' in fragments

    def test_acme_events_generic(self):
        conds = _extract_heql("ACME events from last 24 hours")
        fragments = [c.fragment for c in conds]
        assert 'module equals "ACME"' in fragments

    def test_acme_enrollment_with_certificate(self):
        """Protocol → module filter, certificate → detail.certificateDn."""
        conds = _extract_heql(
            "find me all the events related to the acme enrollment of certificate toto.local"
        )
        fragments = [c.fragment for c in conds]
        assert 'module equals "ACME"' in fragments
        assert 'detail.certificateDn contains "toto.local"' in fragments

    def test_scep_events(self):
        conds = _extract_heql("SCEP enrollment events")
        fragments = [c.fragment for c in conds]
        assert 'module equals "SCEP"' in fragments

    def test_est_events(self):
        conds = _extract_heql("EST enrollment events")
        fragments = [c.fragment for c in conds]
        assert 'module equals "EST"' in fragments

    def test_acme_revocation_events(self):
        conds = _extract_heql("ACME revocation events")
        fragments = [c.fragment for c in conds]
        assert 'module equals "ACME"' in fragments

    def test_authentication_events(self):
        conds = _extract_heql("authentication events")
        fragments = [c.fragment for c in conds]
        assert 'code equals "SEC-AUTHENTICATION"' in fragments

    def test_trigger_events(self):
        conds = _extract_heql("trigger events")
        fragments = [c.fragment for c in conds]
        assert 'code contains "TRIGGER"' in fragments

    def test_request_approval_events(self):
        conds = _extract_heql("request approval events")
        fragments = [c.fragment for c in conds]
        assert 'code equals "REQUEST-APPROVE"' in fragments

    def test_actor_extraction(self):
        conds = _extract_heql("events by admin@corp.io in the last 7 days")
        fragments = [c.fragment for c in conds]
        assert 'detail.actorId equals "admin@corp.io"' in fragments


# ---------------------------------------------------------------------------
# 5. HDQL condition extraction
# ---------------------------------------------------------------------------

class TestHDQLExtraction:

    def test_port(self):
        conds = _extract_hdql("scans on port 443")
        fragments = [c.fragment for c in conds]
        assert "port equals 443" in fragments

    def test_ip_address(self):
        conds = _extract_hdql("scans for 192.168.1.1")
        fragments = [c.fragment for c in conds]
        assert 'ip equals "192.168.1.1"' in fragments

    def test_hostname(self):
        conds = _extract_hdql("discovery on host example.com")
        fragments = [c.fragment for c in conds]
        assert 'hostname equals "example.com"' in fragments

    def test_hostname_glob(self):
        conds = _extract_hdql("discovery on host *.example.com")
        fragments = [c.fragment for c in conds]
        assert 'hostname matches ".*\\.example\\.com"' in fragments

    def test_campaign(self):
        conds = _extract_hdql("discovery campaign weekly-scan")
        fragments = [c.fragment for c in conds]
        assert 'campaign equals "weekly-scan"' in fragments


# ---------------------------------------------------------------------------
# 6. Full tool invocation with mock client
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_client() -> AsyncMock:
    client = AsyncMock()
    client.post = AsyncMock(return_value={"count": 42, "hasMore": True})
    set_client(client)
    yield client
    clear_client()


class TestTranslateToolInvocation:
    """Test the full translate_to_hql tool via ToolCollector."""

    async def test_full_translation_with_validation(self, mock_client):
        from tests.test_safety import ToolCollector
        from horizon_mcp.tools.assist.translate import register_translate_tools

        collector = ToolCollector()
        register_translate_tools(collector)
        result = await collector.get_tool_fn("translate_to_hql")(
            natural_language="expired RSA certificates from team alpha",
        )

        data = json.loads(result)
        assert data["query_type"] == "hcql"
        assert data["query"] is not None
        assert "status is expired" in data["query"]
        assert 'keytype contains "rsa"' in data["query"]
        assert data["confidence"] >= 0.5
        assert len(data["explanation"]) >= 2
        assert data["validation"]["valid"] is True
        assert data["validation"]["count"] == 42

    async def test_translation_without_validation(self, mock_client):
        from tests.test_safety import ToolCollector
        from horizon_mcp.tools.assist.translate import register_translate_tools

        collector = ToolCollector()
        register_translate_tools(collector)
        result = await collector.get_tool_fn("translate_to_hql")(
            natural_language="pending enrollment requests",
            validate=False,
        )

        data = json.loads(result)
        assert data["query_type"] == "hrql"
        assert 'workflow equals "enroll"' in data["query"]
        assert 'status equals "pending"' in data["query"]
        assert "validation" not in data

    async def test_forced_target_type(self, mock_client):
        from tests.test_safety import ToolCollector
        from horizon_mcp.tools.assist.translate import register_translate_tools

        collector = ToolCollector()
        register_translate_tools(collector)
        result = await collector.get_tool_fn("translate_to_hql")(
            natural_language="expired items from last week",
            target_type="hrql",
            validate=False,
        )

        data = json.loads(result)
        assert data["query_type"] == "hrql"

    async def test_invalid_target_type(self, mock_client):
        from tests.test_safety import ToolCollector
        from horizon_mcp.tools.assist.translate import register_translate_tools

        collector = ToolCollector()
        register_translate_tools(collector)
        result = await collector.get_tool_fn("translate_to_hql")(
            natural_language="anything",
            target_type="invalid",
            validate=False,
        )

        data = json.loads(result)
        assert "error" in data
        assert "valid_types" in data

    async def test_no_conditions_returns_field_reference(self, mock_client):
        from tests.test_safety import ToolCollector
        from horizon_mcp.tools.assist.translate import register_translate_tools

        collector = ToolCollector()
        register_translate_tools(collector)
        result = await collector.get_tool_fn("translate_to_hql")(
            natural_language="show me everything",
            validate=False,
        )

        data = json.loads(result)
        assert data["query"] is None
        assert "field_reference" in data
        assert "message" in data

    async def test_validation_failure_captured(self, mock_client):
        from tests.test_safety import ToolCollector
        from horizon_mcp.tools.assist.translate import register_translate_tools

        mock_client.post = AsyncMock(side_effect=Exception("Connection refused"))

        collector = ToolCollector()
        register_translate_tools(collector)
        result = await collector.get_tool_fn("translate_to_hql")(
            natural_language="expired certificates",
        )

        data = json.loads(result)
        assert data["query"] == "status is expired"
        assert data["validation"]["valid"] is False
        assert "Connection refused" in data["validation"]["error"]


# ---------------------------------------------------------------------------
# 7. Query validity — all produced fragments are well-formed HQL
# ---------------------------------------------------------------------------

class TestQueryValidity:
    """Verify that assembled queries are syntactically well-formed."""

    _SHOWCASE_INPUTS = [
        "expired RSA certificates from team-alpha",
        "self-signed certificates expiring in the next 30 days",
        "discovered certificates with grade worse than B",
        "valid ECDSA certificates from profile WebRA-Prod",
        "certificates with failed triggers from last 7 days",
        "pending enrollment requests for the ACME profile",
        "denied revocation requests from last month",
        "audit events in the last 24 hours",
        "enrollment events from last 7 days",
        "discovery scans on port 443",
        "discovery on host *.example.com",
    ]

    @pytest.mark.parametrize("nl_input", _SHOWCASE_INPUTS)
    def test_produced_query_is_nonempty(self, nl_input):
        """Every showcase input should produce at least one condition."""
        qt, _ = _detect_intent(nl_input)
        from horizon_mcp.tools.assist.translate import _EXTRACTORS
        conditions = _EXTRACTORS[qt](nl_input)
        assert len(conditions) > 0, f"No conditions extracted from: {nl_input}"

    @pytest.mark.parametrize("nl_input", _SHOWCASE_INPUTS)
    def test_fragments_are_valid_hql(self, nl_input):
        """Fragments should not contain unquoted user input or broken syntax."""
        qt, _ = _detect_intent(nl_input)
        from horizon_mcp.tools.assist.translate import _EXTRACTORS
        conditions = _EXTRACTORS[qt](nl_input)
        query = " and ".join(c.fragment for c in conditions)
        # Basic structural checks
        assert query.count('"') % 2 == 0, f"Unbalanced quotes in: {query}"
        assert "  " not in query, f"Double spaces in: {query}"
        assert query.strip() == query, f"Leading/trailing whitespace in: {query}"
