"""Unit tests for tools/_helpers.py — shared helper functions.

Tests cover all 4 public helpers:
  - delete_guard: safety echo enforcement
  - apply_name_filter: client-side case-insensitive substring filter
  - build_list_response: truncated list with metadata envelope
  - get_strip_merge_put: GET → strip → merge → PUT update cycle
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.state import clear_client, set_client
from horizon_mcp.tools._helpers import (
    apply_name_filter,
    build_list_response,
    delete_guard,
    get_strip_merge_put,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def patched_client():
    """Wire a mock HorizonClient into the global state module."""
    client = AsyncMock()
    client.get = AsyncMock(
        return_value={"_id": "abc123", "name": "test-role", "field": "old"},
    )
    client.put = AsyncMock(
        return_value={"name": "test-role", "field": "new"},
    )
    set_client(client)
    yield client
    clear_client()


# ---------------------------------------------------------------------------
# delete_guard
# ---------------------------------------------------------------------------

class TestDeleteGuard:
    """Tests for delete_guard() safety echo enforcement."""

    def test_matching_names_pass(self):
        """No error when name matches expected."""
        delete_guard("my-role", "my-role")  # should not raise

    def test_mismatching_names_raise_422(self):
        """Mismatched names raise HorizonError with status_code=422."""
        with pytest.raises(HorizonError) as exc_info:
            delete_guard("actual-name", "wrong-name")

        err = exc_info.value
        assert err.status_code == 422
        assert err.error_code == "SAFETY-ECHO"
        assert "wrong-name" in err.message
        assert "actual-name" in err.message

    def test_custom_label(self):
        """Custom label appears in the error message and remediation."""
        with pytest.raises(HorizonError) as exc_info:
            delete_guard("a", "b", label="connector")

        err = exc_info.value
        assert "connector" in err.message
        assert "connector" in err.remediation


# ---------------------------------------------------------------------------
# apply_name_filter
# ---------------------------------------------------------------------------

class TestApplyNameFilter:
    """Tests for apply_name_filter() client-side filtering."""

    _ITEMS = [
        {"name": "Alpha-Connector"},
        {"name": "beta-trigger"},
        {"name": "GAMMA-profile"},
        {"name": "delta"},
    ]

    def test_none_filter_returns_all(self):
        """None filter preserves the full list."""
        result = apply_name_filter(self._ITEMS, None)
        assert result == self._ITEMS

    def test_empty_string_returns_all(self):
        """Empty string filter preserves the full list."""
        result = apply_name_filter(self._ITEMS, "")
        assert result == self._ITEMS

    def test_case_insensitive_substring_match(self):
        """Matching is case-insensitive and substring-based."""
        result = apply_name_filter(self._ITEMS, "ALPHA")
        assert len(result) == 1
        assert result[0]["name"] == "Alpha-Connector"

    def test_no_matches_returns_empty(self):
        """Filter with no matches returns an empty list."""
        result = apply_name_filter(self._ITEMS, "nonexistent")
        assert result == []

    def test_missing_name_key_skipped(self):
        """Items without a 'name' key are excluded from results."""
        items = [{"id": 1}, {"name": "target"}]
        result = apply_name_filter(items, "target")
        assert len(result) == 1
        assert result[0]["name"] == "target"


# ---------------------------------------------------------------------------
# build_list_response
# ---------------------------------------------------------------------------

class TestBuildListResponse:
    """Tests for build_list_response() truncation and envelope."""

    def test_no_truncation(self):
        """Items within max_items are not truncated."""
        items = [{"name": "a"}, {"name": "b"}]
        raw = build_list_response(items, max_items=5, kind="connector")
        data = json.loads(raw)

        assert data["count"] == 2
        assert data["total_available"] == 2
        assert data["truncated"] is False
        assert data["kind"] == "connector"
        assert data["items"] == items

    def test_truncation(self):
        """Items exceeding max_items are truncated; metadata reflects it."""
        items = [{"name": f"item-{i}"} for i in range(10)]
        raw = build_list_response(items, max_items=3, kind="trigger")
        data = json.loads(raw)

        assert data["count"] == 3
        assert data["total_available"] == 10
        assert data["truncated"] is True
        assert len(data["items"]) == 3

    def test_json_structure_keys(self):
        """Response JSON contains exactly the expected keys."""
        raw = build_list_response([], max_items=10, kind="role")
        data = json.loads(raw)
        assert set(data.keys()) == {
            "items", "count", "total_available", "truncated", "kind",
        }


# ---------------------------------------------------------------------------
# get_strip_merge_put
# ---------------------------------------------------------------------------

class TestGetStripMergePut:
    """Tests for get_strip_merge_put() async update cycle."""

    @pytest.mark.asyncio
    async def test_strips_id_and_puts_merged(self, patched_client):
        """_id is stripped from GET; overrides are merged into PUT payload."""
        result = await get_strip_merge_put(
            get_path="/api/v1/security/roles/admin",
            put_path="/api/v1/security/roles/",
            domain="role",
            overrides={"field": "new"},
            clear_fields=None,
        )

        # Verify GET was called with the correct path
        patched_client.get.assert_awaited_once_with(
            "/api/v1/security/roles/admin",
        )

        # Verify PUT received a payload without _id and with merged field
        patched_client.put.assert_awaited_once()
        put_args = patched_client.put.call_args
        payload = put_args.kwargs["json"]
        assert "_id" not in payload
        assert payload["field"] == "new"
        assert payload["name"] == "test-role"

        # Return value is the PUT response
        assert result == {"name": "test-role", "field": "new"}

    @pytest.mark.asyncio
    async def test_clear_fields_sets_none(self, patched_client):
        """clear_fields explicitly sets specified fields to None."""
        await get_strip_merge_put(
            get_path="/api/v1/security/roles/admin",
            put_path="/api/v1/security/roles/",
            domain="role",
            overrides={},
            clear_fields=["field"],
        )

        payload = patched_client.put.call_args.kwargs["json"]
        assert payload["field"] is None

    @pytest.mark.asyncio
    async def test_overrides_replace_values(self, patched_client):
        """Overrides replace existing values in the payload."""
        patched_client.get.return_value = {
            "_id": "x", "name": "r1", "description": "old-desc",
        }

        await get_strip_merge_put(
            get_path="/api/v1/security/roles/r1",
            put_path="/api/v1/security/roles/",
            domain="role",
            overrides={"description": "new-desc"},
            clear_fields=None,
        )

        payload = patched_client.put.call_args.kwargs["json"]
        assert payload["description"] == "new-desc"
        assert payload["name"] == "r1"
        assert "_id" not in payload
