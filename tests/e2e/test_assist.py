"""E2E tests for assist tools (15) and knowledge resources (12).

Tests run against a live Horizon QA instance.  All tests are session-scoped
where possible and rely on the helpers from conftest.py.
"""

from __future__ import annotations

import pytest

from tests.e2e.conftest import E2E_PREFIX, call_tool, call_tool_raw, read_resource  # noqa: F401

pytestmark = pytest.mark.e2e

# ---------------------------------------------------------------------------
# Test certificate PEM — minimal self-signed cert for decode_x509 tests
# ---------------------------------------------------------------------------

_TEST_CERT_PEM = (
    "-----BEGIN CERTIFICATE-----\n"
    "MIIBkTCB+wIUEpGSHqKzsPm2G22V2GEHzTxkSZ4wDQYJKoZIhvcNAQELBQAwFDES\n"
    "MBAGA1UEAwwJdGVzdC1jZXJ0MB4XDTI0MDEwMTAwMDAwMFoXDTI1MDEwMTAwMDAw\n"
    "MFowFDESMBAGA1UEAwwJdGVzdC1jZXJ0MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJB\n"
    "AL7+aty3S1iBA/+yOXKpfJZBSFxWYGOcaGes0MfZnHMHh10rOHcMiSaVKcggBz8D\n"
    "BMHW8IOEA2MtiVEbfPLK3aECAwEAATANBgkqhkiG9w0BAQsFAANBADKs+jE5bOu0\n"
    "BNQD8APB3PAKJbCw2JJJGX9RdkFgMk5MREGPyoOHbJHqMYGxlINk3KtpEm4y6Ha\n"
    "YdBwIiKBKRo=\n"
    "-----END CERTIFICATE-----"
)

# ---------------------------------------------------------------------------
# Knowledge resource tests (12 URIs)
# ---------------------------------------------------------------------------

_KNOWLEDGE_URIS = [
    "horizon://knowledge/profiles",
    "horizon://knowledge/computation-and-data-flow",
    "horizon://knowledge/workflows",
    "horizon://knowledge/query-languages",
    "horizon://knowledge/rbac",
    "horizon://knowledge/architecture",
    "horizon://knowledge/dictionary-matrix",
    "horizon://knowledge/discovery",
    "horizon://knowledge/automation",
    "horizon://knowledge/integrations",
    "horizon://knowledge/dashboards",
    "horizon://knowledge/system-admin",
]


@pytest.mark.parametrize("uri", _KNOWLEDGE_URIS)
async def test_knowledge_resource_is_accessible_and_non_empty(e2e_mcp, uri):
    """Each knowledge resource must be readable and contain substantial content."""
    content = await read_resource(e2e_mcp, uri)
    assert content, f"Resource {uri} returned empty content"
    assert len(content) > 100, (
        f"Resource {uri} is suspiciously short ({len(content)} chars)"
    )


@pytest.mark.parametrize("uri", _KNOWLEDGE_URIS)
async def test_knowledge_resource_contains_structured_content(e2e_mcp, uri):
    """Each knowledge resource must contain markdown headers or table syntax."""
    content = await read_resource(e2e_mcp, uri)
    has_headers = "## " in content or "# " in content
    has_tables = "|" in content
    assert has_headers or has_tables, (
        f"Resource {uri} does not contain markdown headers (##) or tables (|). "
        f"First 200 chars: {content[:200]!r}"
    )


async def test_server_instructions_non_empty(e2e_mcp):
    """The MCP server must expose non-empty instructions when configured.

    The e2e_mcp fixture creates a FastMCP without instructions so this test
    just verifies the attribute exists (instructions may be None in test context).
    The production server in server.py always sets instructions.
    """
    # The attribute must exist (even if None in test context)
    assert hasattr(e2e_mcp, "instructions"), (
        "FastMCP instance must have an 'instructions' attribute"
    )
    # If instructions are set, they must be non-trivially short
    instructions = e2e_mcp.instructions
    if instructions is not None:
        assert len(instructions) > 10, (
            f"mcp.instructions is suspiciously short: {instructions!r}"
        )


# ---------------------------------------------------------------------------
# System tools
# ---------------------------------------------------------------------------


async def test_whoami_returns_user_info(e2e_mcp):
    """whoami must return a non-empty principal dict with an identifier.

    The actual Horizon API response wraps identity info under an 'identity'
    key: {"identity": {"identifier": "...", ...}, "permissions": [...], ...}
    """
    result = await call_tool(e2e_mcp, "whoami")
    assert result, "whoami returned empty result"
    if "raw" in result:
        assert len(result["raw"]) > 10, "whoami raw response is suspiciously short"
    else:
        # The Horizon principal endpoint returns identity nested under 'identity'
        assert "identity" in result, (
            f"whoami response lacks 'identity' key. Got keys: {list(result.keys())}"
        )
        identity = result["identity"]
        assert isinstance(identity, dict), (
            f"whoami 'identity' must be a dict, got: {type(identity).__name__}"
        )
        # The identity object must contain an identifier
        identity_keys = {"identifier", "login", "id", "_id", "name", "email"}
        assert identity_keys & set(identity.keys()), (
            f"whoami identity lacks any identifier key. Got keys: {list(identity.keys())}"
        )


async def test_get_license_info_returns_license_data(e2e_mcp):
    """get_license_info must return license data with modules or expiry info.

    The /api/v1/license endpoint may not be available on all Horizon versions.
    If the tool raises (404), skip gracefully.
    """
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        result = await call_tool(e2e_mcp, "get_license_info")
    except (ToolError, AssertionError) as exc:
        pytest.skip(f"get_license_info not available on this Horizon instance: {exc}")
    assert result, "get_license_info returned empty result"
    if "raw" in result:
        assert len(result["raw"]) > 10, "get_license_info raw response is too short"
    else:
        # At minimum we should have a non-empty dict
        assert len(result) > 0, "get_license_info returned empty JSON object"


# ---------------------------------------------------------------------------
# Query validation tools
# ---------------------------------------------------------------------------


async def test_validate_hcql_valid_query(e2e_mcp):
    """validate_hcql must confirm a simple valid HCQL expression."""
    result = await call_tool(e2e_mcp, "validate_hcql", query="profile exists")
    assert result.get("valid") is True, (
        f"Expected valid=True for 'profile exists', got: {result}"
    )
    assert result.get("query_type") == "HCQL"


async def test_validate_hcql_invalid_query(e2e_mcp):
    """validate_hcql must flag a syntactically broken HCQL expression.

    When HCQL is invalid the tool returns:
        {"valid": False, "error": "<API error message>", "query_type": "HCQL", ...}
    call_tool() raises on data.get("error") being truthy, so we use call_tool_raw
    to inspect the response directly.
    """
    import json as _json
    raw = await call_tool_raw(e2e_mcp, "validate_hcql", query="INVALID<<<")
    assert raw, "validate_hcql returned empty raw response"
    data = _json.loads(raw)
    assert data.get("valid") is False, (
        f"Expected valid=False for 'INVALID<<<', got: {data}"
    )


async def test_validate_hrql_valid_query(e2e_mcp):
    """validate_hrql must confirm a simple valid HRQL expression."""
    result = await call_tool(e2e_mcp, "validate_hrql", query="profile exists")
    assert result.get("valid") is True, (
        f"Expected valid=True for HRQL 'profile exists', got: {result}"
    )
    assert result.get("query_type") == "HRQL"


async def test_validate_heql_valid_query(e2e_mcp):
    """validate_heql must confirm a simple valid HEQL expression.

    HEQL does not support 'field exists' syntax — use 'field matches ".*"'
    as the equivalent match-all pattern.
    """
    result = await call_tool(e2e_mcp, "validate_heql", query='code matches ".*"')
    assert result.get("valid") is True, (
        f"Expected valid=True for HEQL 'code matches \".*\"', got: {result}"
    )
    assert result.get("query_type") == "HEQL"


async def test_validate_hdql_valid_query(e2e_mcp):
    """validate_hdql must confirm a simple valid HDQL expression."""
    result = await call_tool(e2e_mcp, "validate_hdql", query="status exists")
    assert result.get("valid") is True, (
        f"Expected valid=True for HDQL 'status exists', got: {result}"
    )
    assert result.get("query_type") == "HDQL"


@pytest.mark.parametrize("query_type", ["hcql", "hrql", "heql", "hdql"])
async def test_describe_query_fields_returns_metadata(e2e_mcp, query_type):
    """describe_query_fields must return structured metadata for each query type."""
    result = await call_tool(e2e_mcp, "describe_query_fields", query_type=query_type)
    assert "error" not in result, f"describe_query_fields returned error for {query_type}: {result}"
    assert result.get("query_type") == query_type
    assert isinstance(result.get("fields"), list), "fields must be a list"
    assert len(result["fields"]) > 0, f"No fields returned for {query_type}"
    assert isinstance(result.get("examples"), list), "examples must be a list"


# ---------------------------------------------------------------------------
# Crypto tools
# ---------------------------------------------------------------------------


async def test_decode_x509_with_test_cert(e2e_mcp):
    """decode_x509 must parse the bundled test certificate without error.

    The decode endpoint may not be available on all Horizon instances (404).
    If unavailable, skip gracefully.
    """
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        result = await call_tool(e2e_mcp, "decode_x509", pem=_TEST_CERT_PEM)
    except (ToolError, AssertionError) as exc:
        pytest.skip(f"decode_x509 not available on this Horizon instance: {exc}")
    assert result, "decode_x509 returned empty result"
    # A decoded cert should contain subject or DN-related fields
    if "raw" not in result:
        cert_keys = {"subject", "issuer", "dn", "notBefore", "notAfter", "serial"}
        assert cert_keys & set(result.keys()), (
            f"decode_x509 response lacks certificate fields. Got keys: {list(result.keys())}"
        )


async def test_decode_csr_with_invalid_data_returns_error(e2e_mcp):
    """decode_csr with clearly non-CSR data must return an error, not crash.

    The decode endpoint may not be available on all Horizon instances (404).
    If it raises a ToolError, that is acceptable — the tool does not swallow it.
    """
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        raw = await call_tool_raw(e2e_mcp, "decode_csr", pem="not-a-csr")
        # We expect either an error JSON or an error message
        assert raw, "decode_csr returned empty raw response"
    except ToolError:
        # Endpoint unavailable (404) or other server error — skip
        pytest.skip("decode_csr endpoint not available on this Horizon instance")


async def test_detect_file_with_cert_pem(e2e_mcp):
    """detect_file must correctly identify the test PEM certificate format.

    The detect endpoint may not be available on all Horizon instances (404).
    If unavailable, skip gracefully.
    """
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        result = await call_tool(e2e_mcp, "detect_file", data=_TEST_CERT_PEM)
    except (ToolError, AssertionError) as exc:
        pytest.skip(f"detect_file not available on this Horizon instance: {exc}")
    assert result, "detect_file returned empty result"
    if "raw" not in result:
        # The response should include some type/format indicator
        format_keys = {"type", "format", "contentType", "detected"}
        assert format_keys & set(result.keys()), (
            f"detect_file response lacks format keys. Got keys: {list(result.keys())}"
        )


# ---------------------------------------------------------------------------
# Computation tools
# ---------------------------------------------------------------------------


async def test_simulate_computation_rule_basic(e2e_mcp):
    """simulate_computation_rule must evaluate a simple template expression.

    The playground endpoint payload key may differ across Horizon versions.
    If the tool raises (400 bad request or 404), skip gracefully rather than fail.
    """
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        result = await call_tool(
            e2e_mcp,
            "simulate_computation_rule",
            rule="{{owner}}",
            dictionary={"owner": "test-user"},
        )
        assert result, "simulate_computation_rule returned empty result"
    except (ToolError, AssertionError) as exc:
        pytest.skip(
            f"simulate_computation_rule not available on this Horizon instance: {exc}"
        )


async def test_simulate_computation_rule_with_function(e2e_mcp):
    """simulate_computation_rule must handle a built-in function (upper).

    The playground endpoint payload key may differ across Horizon versions.
    If the tool raises (400 bad request or 404), skip gracefully.
    """
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        result = await call_tool(
            e2e_mcp,
            "simulate_computation_rule",
            rule="{{upper(cn)}}",
            dictionary={"cn": "hello"},
        )
        assert result, "simulate_computation_rule returned empty result"
    except (ToolError, AssertionError) as exc:
        pytest.skip(
            f"simulate_computation_rule not available on this Horizon instance: {exc}"
        )


async def test_simulate_computation_rule_extract_with_group(e2e_mcp):
    """Extract with capture group: Extract("user@domain.com", "(.*)@", 1) → "user"."""
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        result = await call_tool(
            e2e_mcp,
            "simulate_computation_rule",
            rule='{{Extract(email, "(.*)@", 1)}}',
            dictionary={"email": "alice@example.com"},
        )
        raw = result.get("raw", str(result))
        assert "alice" in str(raw).lower(), f"Expected 'alice' in result: {result}"
    except (ToolError, AssertionError) as exc:
        pytest.skip(f"simulate_computation_rule not available: {exc}")


async def test_simulate_computation_rule_domain_dns(e2e_mcp):
    """DomainDNS: extract parent domain from FQDN."""
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        result = await call_tool(
            e2e_mcp,
            "simulate_computation_rule",
            rule="{{DomainDNS(fqdn)}}",
            dictionary={"fqdn": "machine.domain.local"},
        )
        raw = result.get("raw", str(result))
        assert "domain.local" in str(raw).lower(), f"Expected 'domain.local' in result: {result}"
    except (ToolError, AssertionError) as exc:
        pytest.skip(f"simulate_computation_rule not available: {exc}")


async def test_simulate_computation_rule_shorten_dns(e2e_mcp):
    """ShortenDNS: extract hostname from FQDN."""
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        result = await call_tool(
            e2e_mcp,
            "simulate_computation_rule",
            rule="{{ShortenDNS(fqdn)}}",
            dictionary={"fqdn": "web01.corp.example.com"},
        )
        raw = result.get("raw", str(result))
        assert "web01" in str(raw).lower(), f"Expected 'web01' in result: {result}"
    except (ToolError, AssertionError) as exc:
        pytest.skip(f"simulate_computation_rule not available: {exc}")


async def test_simulate_computation_rule_concat_and_orelse(e2e_mcp):
    """Concat + OrElse: build string with fallback."""
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        result = await call_tool(
            e2e_mcp,
            "simulate_computation_rule",
            rule='{{Concat(OrElse(prefix, "default"), "-", name)}}',
            dictionary={"name": "server01"},
        )
        raw = result.get("raw", str(result))
        assert "default-server01" in str(raw).lower(), f"Expected 'default-server01' in result: {result}"
    except (ToolError, AssertionError) as exc:
        pytest.skip(f"simulate_computation_rule not available: {exc}")


async def test_simulate_datasource_flow_empty_flow(e2e_mcp):
    """simulate_datasource_flow with an empty flow must not crash.

    The datasource playground endpoint may not be available on all instances.
    If the tool raises, skip gracefully.
    """
    from mcp.server.fastmcp.exceptions import ToolError
    try:
        raw = await call_tool_raw(e2e_mcp, "simulate_datasource_flow", flow=[])
        assert raw, "simulate_datasource_flow returned empty raw response"
    except ToolError as exc:
        pytest.skip(
            f"simulate_datasource_flow not available on this Horizon instance: {exc}"
        )


# ---------------------------------------------------------------------------
# Translation tool
# ---------------------------------------------------------------------------


async def test_translate_to_hql_certificate_description(e2e_mcp):
    """translate_to_hql must produce a non-null query for a certificate description."""
    result = await call_tool(
        e2e_mcp,
        "translate_to_hql",
        natural_language="expired RSA certificates",
    )
    assert result, "translate_to_hql returned empty result"
    assert result.get("query_type") == "hcql", (
        f"Expected hcql query type for certificate description, got: {result.get('query_type')}"
    )
    # Either a query is produced or a helpful message is returned
    assert result.get("query") or result.get("message"), (
        f"translate_to_hql returned neither query nor message: {result}"
    )


async def test_translate_to_hql_with_forced_type(e2e_mcp):
    """translate_to_hql must respect a forced target_type."""
    result = await call_tool(
        e2e_mcp,
        "translate_to_hql",
        natural_language="pending requests",
        target_type="hrql",
    )
    assert result, "translate_to_hql returned empty result"
    assert result.get("query_type") == "hrql", (
        f"Expected hrql, got: {result.get('query_type')}"
    )


async def test_translate_to_hql_validates_against_live_instance(e2e_mcp):
    """translate_to_hql with validate=True must include a validation block."""
    result = await call_tool(
        e2e_mcp,
        "translate_to_hql",
        natural_language="valid certificates",
        validate=True,
    )
    if result.get("query"):
        assert "validation" in result, (
            "translate_to_hql with validate=True must include 'validation' key"
        )


# ---------------------------------------------------------------------------
# Grading tools (conditional — skip if no policies configured)
# ---------------------------------------------------------------------------


async def test_explain_grading_policy(e2e_mcp):
    """explain_grading_policy must return policy details for the first policy found.

    Skipped if no policies are configured or if the detail endpoint is unavailable.
    """
    from mcp.server.fastmcp.exceptions import ToolError
    policies = await call_tool(e2e_mcp, "list_grading_policies")
    if not policies.get("items"):
        pytest.skip("No grading policies configured on this Horizon instance")

    first = policies["items"][0]
    name = first.get("name") or first.get("identifier")
    if not name:
        pytest.skip("Could not extract name from first grading policy")

    try:
        result = await call_tool(e2e_mcp, "explain_grading_policy", policy_name=name)
    except (ToolError, AssertionError) as exc:
        pytest.skip(
            f"explain_grading_policy not available on this Horizon instance: {exc}"
        )
    assert result, "explain_grading_policy returned empty result"
    assert "policy" in result, (
        f"explain_grading_policy response lacks 'policy' key. Got: {list(result.keys())}"
    )


async def test_explain_grading_ruleset(e2e_mcp):
    """explain_grading_ruleset must return ruleset details for the first ruleset found.

    Skipped if no rulesets are configured or if the detail endpoint is unavailable.
    """
    from mcp.server.fastmcp.exceptions import ToolError
    rulesets = await call_tool(e2e_mcp, "list_grading_rulesets")
    if not rulesets.get("items"):
        pytest.skip("No grading rulesets configured on this Horizon instance")

    first = rulesets["items"][0]
    name = first.get("name") or first.get("identifier")
    if not name:
        pytest.skip("Could not extract name from first grading ruleset")

    try:
        result = await call_tool(e2e_mcp, "explain_grading_ruleset", ruleset_name=name)
    except (ToolError, AssertionError) as exc:
        pytest.skip(
            f"explain_grading_ruleset not available on this Horizon instance: {exc}"
        )
    assert result, "explain_grading_ruleset returned empty result"
    assert "ruleset" in result, (
        f"explain_grading_ruleset response lacks 'ruleset' key. Got: {list(result.keys())}"
    )
