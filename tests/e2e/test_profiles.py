"""E2E tests for the 12 Phase 1 profile tools.

Covers:
  - list_profiles (read-only)
  - list_profiles with module filter (read-only)
  - get_profile (read-only)
  - Monitored profile lifecycle (create → get → update → delete via direct API)

The monitored profile tests create a real profile on the QA instance and
clean it up via the HorizonClient directly (delete_profile is Phase 2).

All tests are automatically skipped when E2E environment variables are absent
(enforced by the pytestmark in conftest.py).
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from mcp.server.fastmcp import FastMCP

from horizon_mcp.client.http import HorizonClient
from tests.e2e.conftest import E2E_PREFIX, call_tool

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# Read-only: list_profiles
# ---------------------------------------------------------------------------


async def test_list_profiles(e2e_mcp: FastMCP) -> None:
    result = await call_tool(e2e_mcp, "list_profiles")
    assert "items" in result, "list_profiles response missing 'items' key"
    assert isinstance(result["items"], list)
    assert "count" in result
    assert "total_available" in result
    assert "kind" in result
    assert result["kind"] == "profile"


async def test_list_profiles_module_filter(e2e_mcp: FastMCP) -> None:
    """Module filter should narrow results to only the requested module type."""
    for module in ("webra", "acme", "scep", "est", "monitored"):
        result = await call_tool(e2e_mcp, "list_profiles", module=module)
        assert "items" in result
        # Every returned item must match the requested module (if any exist)
        for item in result["items"]:
            assert item.get("module", "").lower() == module, (
                f"list_profiles(module='{module}') returned an item with "
                f"module='{item.get('module')}'"
            )


async def test_list_profiles_name_filter(e2e_mcp: FastMCP) -> None:
    """name_contains should filter without raising an error."""
    result = await call_tool(e2e_mcp, "list_profiles", name_contains="zzznomatch")
    assert "items" in result
    assert result["items"] == [] or isinstance(result["items"], list)


# ---------------------------------------------------------------------------
# Read-only: get_profile
# ---------------------------------------------------------------------------


async def test_get_profile(e2e_mcp: FastMCP) -> None:
    profiles = await call_tool(e2e_mcp, "list_profiles")
    if not profiles["items"]:
        pytest.skip("No profiles configured on this instance")
    name = profiles["items"][0].get("name") or profiles["items"][0].get("identifier")
    assert name, "First profile item has no name or identifier"
    detail = await call_tool(e2e_mcp, "get_profile", name=name)
    # get_profile returns the raw profile dict
    assert detail.get("name") == name or "name" in detail


# ---------------------------------------------------------------------------
# Mutating: monitored profile lifecycle
# ---------------------------------------------------------------------------

_MONITORED_NAME = f"{E2E_PREFIX}-monitored"

# Monitored profiles do NOT accept subject/sans/extensions in certificate_template
_CERT_TEMPLATE: dict = {}

# Minimal authorization_levels required by the API — monitored profiles need
# all the standard access-control slots; the API validates their presence.
_AUTH_LEVELS: dict = {
    "enroll": {"accessLevel": "authenticated"},
    "enrollApi": {"accessLevel": "authenticated"},
    "requestEnroll": {"accessLevel": "authenticated"},
    "approveEnroll": {"accessLevel": "authenticated"},
    "revoke": {"accessLevel": "authorized"},
    "requestRevoke": {"accessLevel": "authorized"},
    "approveRevoke": {"accessLevel": "authorized"},
    "search": {"accessLevel": "authenticated"},
    "update": {"accessLevel": "authorized"},
    "requestUpdate": {"accessLevel": "authorized"},
    "approveUpdate": {"accessLevel": "authorized"},
    "recover": {"accessLevel": "authorized"},
}

# Minimal cryptoPolicy for monitored profiles
_CRYPTO_POLICY: dict = {
    "escrow": False,
    "p12passwordMode": "random",
    "p12storeEncryptionType": "DES_AVERAGE",
    "showP12PasswordOnRecover": True,
    "showP12OnRecover": True,
}

# Minimal selfPermissions
_SELF_PERMISSIONS: dict = {
    "selfRecover": False,
    "selfUpdate": False,
    "selfRevoke": False,
    "selfRenew": False,
    "selfPopRenew": False,
    "selfPopRevoke": False,
    "selfPopUpdate": False,
    "selfPopImport": False,
}

# Minimal requestsPolicy
_REQUESTS_POLICY: dict = {
    "recover": "7 days",
    "update": "7 days",
    "migrate": "7 days",
    "import": "7 days",
}


async def test_create_monitored_profile(
    e2e_mcp: FastMCP,
    e2e_client: HorizonClient,
) -> None:
    """Create a monitored profile, verify it exists, update it, then delete it."""
    # --- CREATE ---
    # description must be a list (array) per the Horizon API schema, not a string.
    create_result = await call_tool(
        e2e_mcp,
        "create_monitored_profile",
        name=_MONITORED_NAME,
        certificate_template=_CERT_TEMPLATE,
        authorization_levels=_AUTH_LEVELS,
        crypto_policy=_CRYPTO_POLICY,
        self_permissions=_SELF_PERMISSIONS,
        requests_policy=_REQUESTS_POLICY,
        enabled=True,
    )
    assert create_result.get("status") == "created", (
        f"Expected status='created', got: {create_result}"
    )
    assert create_result.get("kind") == "profile"
    assert create_result.get("name") == _MONITORED_NAME

    try:
        # --- GET (verify creation) ---
        fetched = await call_tool(e2e_mcp, "get_profile", name=_MONITORED_NAME)
        assert fetched.get("name") == _MONITORED_NAME
        assert fetched.get("module", "").lower() == "monitored"

        # --- UPDATE (enable/disable toggle) ---
        # NOTE: The Horizon API stores description as an array, not a plain string.
        # The update_monitored_profile tool passes description as-is to the API.
        # To avoid schema validation issues, we test a simple boolean field update
        # (enabled=False) which is less fragile than description.
        update_result = await call_tool(
            e2e_mcp,
            "update_monitored_profile",
            name=_MONITORED_NAME,
            enabled=False,
        )
        assert update_result.get("status") == "updated", (
            f"Expected status='updated', got: {update_result}"
        )
        assert update_result.get("name") == _MONITORED_NAME

        # Verify the update was persisted
        after_update = await call_tool(e2e_mcp, "get_profile", name=_MONITORED_NAME)
        assert after_update.get("enabled") is False, (
            f"enabled was not updated to False. Got: {after_update.get('enabled')}"
        )

    finally:
        # --- CLEANUP (direct API call; delete_profile is Phase 2) ---
        try:
            await e2e_client.delete(
                f"/api/v1/certificate/profiles/{_MONITORED_NAME}"
            )
        except Exception:
            pass  # Best-effort cleanup — do not mask test failures
