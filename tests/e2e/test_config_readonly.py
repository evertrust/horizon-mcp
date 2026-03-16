"""E2E tests for the 19 read-only configuration tools.

All tests are read-only and produce no side effects on the QA instance.
They are automatically skipped when E2E environment variables are absent
(enforced by the pytestmark in conftest.py).
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from mcp.server.fastmcp import FastMCP

from tests.e2e.conftest import E2E_PREFIX, call_tool

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# CAs
# ---------------------------------------------------------------------------


async def test_list_cas(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_cas")
    assert "items" in result
    assert isinstance(result["items"], list)
    assert "total" in result


async def test_get_ca(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_cas")
    if not result["items"]:
        pytest.skip("No CAs configured on this instance")
    name = result["items"][0].get("name") or result["items"][0].get("identifier")
    assert name, "First CA item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_ca", name=name)
    assert detail.get("data") or detail.get("name") or "content" in detail


# ---------------------------------------------------------------------------
# Trust chains
# ---------------------------------------------------------------------------


async def test_list_trust_chains(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_trust_chains")
    assert "items" in result
    assert isinstance(result["items"], list)
    assert "total" in result


async def test_get_trust_chain(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_trust_chains")
    if not result["items"]:
        pytest.skip("No trust chains configured on this instance")
    name = result["items"][0].get("name") or result["items"][0].get("identifier")
    assert name, "First trust chain item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_trust_chain", name=name)
    assert detail.get("data") or detail.get("name") or "content" in detail


# ---------------------------------------------------------------------------
# CRL cache
# ---------------------------------------------------------------------------


async def test_get_crl_cache_global(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "get_crl_cache")
    # Accepts either a data envelope or a direct dict — just ensure no error
    assert result is not None


async def test_get_crl_cache_with_ca(e2e_mcp: FastMCP) -> None:
    cas = await call_tool(e2e_mcp, "list_cas")
    if not cas["items"]:
        pytest.skip("No CAs configured — cannot test per-CA CRL cache")
    ca_name = cas["items"][0].get("name") or cas["items"][0].get("identifier")
    result = await call_tool(e2e_mcp, "get_crl_cache", ca_name=ca_name)
    assert result is not None
    assert "content" in result or "data" in result


# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------


async def test_list_labels(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_labels")
    assert "items" in result
    assert isinstance(result["items"], list)


async def test_get_label(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_labels")
    if not result["items"]:
        pytest.skip("No labels configured on this instance")
    name = result["items"][0].get("name") or result["items"][0].get("identifier")
    assert name, "First label item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_label", name=name)
    assert detail.get("data") or detail.get("name") or "content" in detail


# ---------------------------------------------------------------------------
# HTTP Proxies
# ---------------------------------------------------------------------------


async def test_list_http_proxies(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_http_proxies")
    assert "items" in result
    assert isinstance(result["items"], list)


async def test_get_http_proxy(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_http_proxies")
    if not result["items"]:
        pytest.skip("No HTTP proxies configured on this instance")
    name = result["items"][0].get("name") or result["items"][0].get("identifier")
    assert name, "First HTTP proxy item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_http_proxy", name=name)
    assert detail.get("data") or detail.get("name") or "content" in detail


# ---------------------------------------------------------------------------
# Datasources
# ---------------------------------------------------------------------------


async def test_list_datasources(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_datasources")
    assert "items" in result
    assert isinstance(result["items"], list)


async def test_get_datasource(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_datasources")
    if not result["items"]:
        pytest.skip("No datasources configured on this instance")
    name = result["items"][0].get("name") or result["items"][0].get("identifier")
    assert name, "First datasource item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_datasource", name=name)
    assert detail.get("data") or detail.get("name") or "content" in detail


async def test_simulate_datasource(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_datasources")
    if not result["items"]:
        pytest.skip("No datasources configured — cannot simulate")
    name = result["items"][0].get("name") or result["items"][0].get("identifier")
    sim = await call_tool(e2e_mcp, "simulate_datasource", name=name)
    assert "content" in sim or "data" in sim


# ---------------------------------------------------------------------------
# Password Policies
# ---------------------------------------------------------------------------


async def test_list_password_policies(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_password_policies")
    assert "items" in result
    assert isinstance(result["items"], list)


async def test_get_password_policy(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_password_policies")
    if not result["items"]:
        pytest.skip("No password policies configured on this instance")
    name = result["items"][0].get("name") or result["items"][0].get("identifier")
    assert name, "First password policy item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_password_policy", name=name)
    assert detail.get("data") or detail.get("name") or "content" in detail


async def test_generate_password(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_password_policies")
    if not result["items"]:
        pytest.skip("No password policies configured — cannot generate password")
    policy_name = result["items"][0].get("name") or result["items"][0].get("identifier")
    gen = await call_tool(e2e_mcp, "generate_password", policy_name=policy_name)
    assert "content" in gen or "data" in gen


# ---------------------------------------------------------------------------
# Grading Policies
# ---------------------------------------------------------------------------


async def test_list_grading_policies(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_grading_policies")
    assert "items" in result
    assert isinstance(result["items"], list)


async def test_get_grading_policy(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_grading_policies")
    if not result["items"]:
        pytest.skip("No grading policies configured on this instance")
    name = result["items"][0].get("name") or result["items"][0].get("identifier")
    assert name, "First grading policy item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_grading_policy", name=name)
    assert detail.get("data") or detail.get("name") or "content" in detail


# ---------------------------------------------------------------------------
# Grading Rulesets
# ---------------------------------------------------------------------------


async def test_list_grading_rulesets(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_grading_rulesets")
    assert "items" in result
    assert isinstance(result["items"], list)


async def test_get_grading_ruleset(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_grading_rulesets")
    if not result["items"]:
        pytest.skip("No grading rulesets configured on this instance")
    name = result["items"][0].get("name") or result["items"][0].get("identifier")
    assert name, "First grading ruleset item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_grading_ruleset", name=name)
    assert detail.get("data") or detail.get("name") or "content" in detail
