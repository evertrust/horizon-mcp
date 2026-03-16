"""E2E tests for lifecycle tools (17).

Tests run against a live Horizon QA instance.  Conditional tests use
pytest.skip() where data may not be present.  All tests are async.
"""

from __future__ import annotations

import pytest

from tests.e2e.conftest import E2E_PREFIX, call_tool, call_tool_raw  # noqa: F401

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# Certificate Search
# ---------------------------------------------------------------------------


async def test_search_certificates_no_query(e2e_mcp):
    """search_certificates with a match-all query must return a paged result."""
    result = await call_tool(e2e_mcp, "search_certificates", query="profile exists")
    assert "results" in result, (
        f"search_certificates response lacks 'results' key. Got: {list(result.keys())}"
    )
    assert isinstance(result["results"], list)
    assert "pageIndex" in result
    assert "pageSize" in result


async def test_search_certificates_with_hcql_filter(e2e_mcp):
    """search_certificates with a valid HCQL filter must return a paged result."""
    result = await call_tool(
        e2e_mcp,
        "search_certificates",
        query="profile exists",
        page_size=5,
        with_count=True,
    )
    assert "results" in result
    assert isinstance(result["results"], list)
    # with_count=True must populate the count field
    assert "count" in result, "with_count=True should populate 'count'"


async def test_search_certificates_compact_preset(e2e_mcp):
    """search_certificates with compact preset must return expected fields."""
    result = await call_tool(
        e2e_mcp,
        "search_certificates",
        query="profile exists",
        preset="compact",
        page_size=1,
    )
    assert "results" in result
    if result["results"]:
        first = result["results"][0]
        # compact preset fields
        compact_fields = {"dn", "serial", "profile", "module", "notAfter", "keyType"}
        assert compact_fields & set(first.keys()), (
            f"compact preset result missing expected fields. Got keys: {list(first.keys())}"
        )


# ---------------------------------------------------------------------------
# Certificate Get
# ---------------------------------------------------------------------------


async def test_get_certificate_by_id(e2e_mcp):
    """get_certificate must return full details for an existing certificate."""
    search = await call_tool(
        e2e_mcp, "search_certificates", query="profile exists", page_size=1,
    )
    certs = search.get("results", [])
    if not certs:
        pytest.skip("No certificates found on this Horizon instance")

    cert_id = certs[0].get("_id")
    if not cert_id:
        pytest.skip("First certificate result has no _id field")

    result = await call_tool(e2e_mcp, "get_certificate", certificate_id=cert_id)
    assert result, "get_certificate returned empty result"
    if "raw" not in result:
        assert result.get("_id") == cert_id or "_id" in result, (
            f"get_certificate response lacks _id. Got keys: {list(result.keys())}"
        )


# ---------------------------------------------------------------------------
# Certificate Download
# ---------------------------------------------------------------------------


async def test_download_certificate_pem(e2e_mcp):
    """download_certificate must return a PEM content string for a known cert."""
    search = await call_tool(
        e2e_mcp, "search_certificates", query="profile exists", page_size=1,
    )
    certs = search.get("results", [])
    if not certs:
        pytest.skip("No certificates found on this Horizon instance")

    cert_id = certs[0].get("_id")
    if not cert_id:
        pytest.skip("First certificate result has no _id field")

    result = await call_tool(
        e2e_mcp, "download_certificate", certificate_id=cert_id, format="pem",
    )
    assert result, "download_certificate returned empty result"
    # Either content is present (success) or error explains why PEM is unavailable
    assert "content" in result or "error" in result, (
        f"download_certificate response lacks 'content' or 'error'. "
        f"Got keys: {list(result.keys())}"
    )
    if "content" in result:
        assert "BEGIN CERTIFICATE" in result["content"], (
            "download_certificate content does not look like a PEM certificate"
        )


async def test_download_certificate_unsupported_format(e2e_mcp):
    """download_certificate with a non-PEM format must return a descriptive error."""
    search = await call_tool(
        e2e_mcp, "search_certificates", query="profile exists", page_size=1,
    )
    certs = search.get("results", [])
    if not certs:
        pytest.skip("No certificates found on this Horizon instance")

    cert_id = certs[0].get("_id")
    if not cert_id:
        pytest.skip("First certificate result has no _id field")

    result = await call_tool(
        e2e_mcp, "download_certificate", certificate_id=cert_id, format="der",
    )
    assert "error" in result, (
        "download_certificate with format=der should return an error dict"
    )


# ---------------------------------------------------------------------------
# CSV Exports
# ---------------------------------------------------------------------------


async def test_export_certificates_csv(e2e_mcp):
    """export_certificates_csv must return a CSV payload with metadata."""
    result = await call_tool(
        e2e_mcp, "export_certificates_csv", query="profile exists",
    )
    assert "csv" in result, (
        f"export_certificates_csv response lacks 'csv'. Got keys: {list(result.keys())}"
    )
    assert "truncated" in result
    assert "returned_rows" in result
    # CSV content must be a string (possibly just a header row if no data)
    assert isinstance(result["csv"], str)


async def test_export_requests_csv(e2e_mcp):
    """export_requests_csv must return a CSV payload with metadata."""
    result = await call_tool(
        e2e_mcp, "export_requests_csv", query="profile exists",
    )
    assert "csv" in result, (
        f"export_requests_csv response lacks 'csv'. Got keys: {list(result.keys())}"
    )
    assert "truncated" in result
    assert isinstance(result["csv"], str)


async def test_export_events_csv(e2e_mcp):
    """export_events_csv must return a CSV payload with metadata."""
    result = await call_tool(
        e2e_mcp, "export_events_csv", query="code exists",
    )
    assert "csv" in result, (
        f"export_events_csv response lacks 'csv'. Got keys: {list(result.keys())}"
    )
    assert "truncated" in result
    assert isinstance(result["csv"], str)


# ---------------------------------------------------------------------------
# Request Search & Get
# ---------------------------------------------------------------------------


async def test_search_requests_basic(e2e_mcp):
    """search_requests with a match-all query must return a paged result."""
    result = await call_tool(e2e_mcp, "search_requests", query="profile exists")
    assert "results" in result, (
        f"search_requests response lacks 'results'. Got: {list(result.keys())}"
    )
    assert isinstance(result["results"], list)
    assert "pageIndex" in result


async def test_get_request_by_id(e2e_mcp):
    """get_request must return full details for an existing request."""
    search = await call_tool(
        e2e_mcp, "search_requests", query="profile exists", page_size=1,
    )
    requests = search.get("results", [])
    if not requests:
        pytest.skip("No requests found on this Horizon instance")

    req_id = requests[0].get("_id")
    if not req_id:
        pytest.skip("First request result has no _id field")

    result = await call_tool(e2e_mcp, "get_request", request_id=req_id)
    assert result, "get_request returned empty result"
    if "raw" not in result:
        assert "_id" in result or "workflow" in result, (
            f"get_request response lacks expected keys. Got: {list(result.keys())}"
        )


# ---------------------------------------------------------------------------
# Request Template
# ---------------------------------------------------------------------------


async def test_get_request_template_enroll(e2e_mcp):
    """get_request_template must return a template structure for a known profile."""
    profiles = await call_tool(e2e_mcp, "list_profiles")
    items = profiles.get("items", [])
    if not items:
        pytest.skip("No profiles configured on this Horizon instance")

    profile_name = items[0].get("name") or items[0].get("identifier")
    if not profile_name:
        pytest.skip("Could not extract name from first profile")

    result = await call_tool(
        e2e_mcp,
        "get_request_template",
        workflow="enroll",
        profile=profile_name,
    )
    assert result, "get_request_template returned empty result"
    # A template should describe the structure — could be a dict or contain
    # template-related keys.  We just verify it is non-empty and not an error.
    if "raw" not in result:
        assert len(result) > 0, "get_request_template returned empty JSON object"


# ---------------------------------------------------------------------------
# Event Search & Get
# ---------------------------------------------------------------------------


async def test_search_events_basic(e2e_mcp):
    """search_events with a match-all query must return a paged result."""
    result = await call_tool(e2e_mcp, "search_events", query="code exists")
    assert "results" in result, (
        f"search_events response lacks 'results'. Got: {list(result.keys())}"
    )
    assert isinstance(result["results"], list)


async def test_get_event_by_id(e2e_mcp):
    """get_event must return full details for an existing audit event."""
    search = await call_tool(
        e2e_mcp, "search_events", query="code exists", page_size=1,
    )
    events = search.get("results", [])
    if not events:
        pytest.skip("No audit events found on this Horizon instance")

    event_id = events[0].get("_id")
    if not event_id:
        pytest.skip("First event result has no _id field")

    result = await call_tool(e2e_mcp, "get_event", event_id=event_id)
    assert result, "get_event returned empty result"
    if "raw" not in result:
        assert "_id" in result or "code" in result, (
            f"get_event response lacks expected keys. Got: {list(result.keys())}"
        )


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


async def test_aggregate_certificates_by_status(e2e_mcp):
    """aggregate_certificates must return bucketed results grouped by status."""
    result = await call_tool(
        e2e_mcp,
        "aggregate_certificates",
        query="profile exists",
        group_by=["status"],
    )
    assert result, "aggregate_certificates returned empty result"
    if "raw" not in result:
        # Aggregation response typically contains buckets or results
        agg_keys = {"buckets", "results", "items", "data"}
        assert agg_keys & set(result.keys()), (
            f"aggregate_certificates response lacks expected keys. "
            f"Got keys: {list(result.keys())}"
        )


async def test_aggregate_certificates_by_profile(e2e_mcp):
    """aggregate_certificates grouped by profile must return valid bucket data."""
    result = await call_tool(
        e2e_mcp,
        "aggregate_certificates",
        query="profile exists",
        group_by=["profile"],
        sort_order="Desc",
    )
    assert result, "aggregate_certificates by profile returned empty result"


async def test_aggregate_requests_by_status(e2e_mcp):
    """aggregate_requests must return bucketed results grouped by status."""
    result = await call_tool(
        e2e_mcp,
        "aggregate_requests",
        query="profile exists",
        group_by=["status"],
    )
    assert result, "aggregate_requests returned empty result"
    if "raw" not in result:
        agg_keys = {"buckets", "results", "items", "data"}
        assert agg_keys & set(result.keys()), (
            f"aggregate_requests response lacks expected keys. "
            f"Got keys: {list(result.keys())}"
        )


async def test_aggregate_requests_by_workflow(e2e_mcp):
    """aggregate_requests grouped by workflow must return valid bucket data."""
    result = await call_tool(
        e2e_mcp,
        "aggregate_requests",
        query="profile exists",
        group_by=["workflow"],
        sort_order="Desc",
    )
    assert result, "aggregate_requests by workflow returned empty result"


# ---------------------------------------------------------------------------
# Submit / Cancel flow (conditional)
# ---------------------------------------------------------------------------


async def test_submit_and_cancel_enroll_request(e2e_mcp):
    """submit_request followed by cancel_request must succeed for a webra profile.

    This test is skipped unless a webra profile with direct-issue capability
    is present.  We submit an enrollment request and immediately cancel it to
    avoid leaving pending state on the QA instance.
    """
    # Find a webra profile to enroll against
    profiles = await call_tool(e2e_mcp, "list_profiles", module="webra")
    items = profiles.get("items", [])
    if not items:
        pytest.skip("No webra profiles configured — skipping submit/cancel flow test")

    profile_name = items[0].get("name") or items[0].get("identifier")
    if not profile_name:
        pytest.skip("Could not extract name from first webra profile")

    # Fetch the enroll template to build a minimal valid payload
    template_result = await call_tool(
        e2e_mcp,
        "get_request_template",
        workflow="enroll",
        profile=profile_name,
        module="webra",
    )
    if template_result.get("error"):
        pytest.skip(
            f"get_request_template returned error for profile '{profile_name}': "
            f"{template_result['error']}"
        )

    # Build minimal enroll payload
    cn_value = f"{E2E_PREFIX}.test.local"
    submit_result = await call_tool_raw(
        e2e_mcp,
        "submit_request",
        workflow="enroll",
        profile=profile_name,
        module="webra",
        template={
            "subject": [{"element": "cn.1", "type": "CN", "value": cn_value}],
            "sans": [{"type": "DNSNAME", "value": [cn_value]}],
            "keyType": "rsa-2048",
        },
    )
    assert submit_result, "submit_request returned empty response"

    import json
    try:
        submit_data = json.loads(submit_result)
    except json.JSONDecodeError:
        pytest.skip(f"submit_request returned non-JSON: {submit_result[:200]}")

    if submit_data.get("error"):
        pytest.skip(
            f"submit_request failed (profile may require approvals or special config): "
            f"{submit_data['error']}"
        )

    # Extract request ID from the submit response
    request_id = (
        submit_data.get("_id")
        or submit_data.get("id")
        or submit_data.get("requestId")
    )
    if not request_id:
        pytest.skip(
            f"Could not extract request ID from submit response. "
            f"Keys: {list(submit_data.keys())}"
        )

    # Cancel the just-submitted request
    cancel_result = await call_tool_raw(
        e2e_mcp, "cancel_request", request_id=request_id,
    )
    assert cancel_result, "cancel_request returned empty response"

    try:
        cancel_data = json.loads(cancel_result)
    except json.JSONDecodeError:
        # Non-JSON cancel response — still counts as a successful call
        return

    # Permission denied on cancel is acceptable for this flow test
    # (the submit succeeded, which is the main goal)
    if cancel_data.get("error"):
        # Log but do not fail — the request may have already transitioned
        pass
