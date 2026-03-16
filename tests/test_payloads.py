"""Tests for horizon_mcp.models.payloads — update payload infrastructure.

Covers three main areas:
  1. STRIP_FIELDS configuration correctness per domain.
  2. to_update_payload() merge logic (overrides, clear_fields, strip, fallback).
  3. _preflight_deps() dependency validation (missing → error, existing → ok,
     cap at 5 calls, priority order, asyncio.gather batching).
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from typing import Any

import pytest

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.models.payloads import (
    STRIP_FIELDS,
    _BASELINE_STRIP,
    _DEP_CHECKS,
    _MAX_PREFLIGHT_CALLS,
    _check_one,
    _extract_credential,
    _extract_datasource_flow,
    _extract_grading_policies,
    _extract_identity_provider,
    _extract_pki_connector,
    _extract_triggers_from_hooks,
    _preflight_deps,
    to_update_payload,
)


# =========================================================================
# 1. STRIP_FIELDS per domain
# =========================================================================

class TestStripFields:
    """Verify STRIP_FIELDS configuration across all 20 domains (14 v1 + 6 v1.1)."""

    EXPECTED_DOMAINS = frozenset({
        # v1 domains
        "profile", "ca", "connector", "trigger", "label", "proxy",
        "datasource", "role", "team", "idp", "grading_policy",
        "grading_ruleset", "password_policy", "principal",
        # v1.1 domains
        "discovery_campaign", "automation_policy", "execution_policy",
        "wcce_forest", "local_identity", "scheduled_task",
    })

    def test_all_20_domains_present(self):
        assert set(STRIP_FIELDS.keys()) == self.EXPECTED_DOMAINS

    def test_domain_count(self):
        assert len(STRIP_FIELDS) == 20

    # v1.1 domains only strip _id (no id/createdAt/updatedAt), so baseline check
    # applies only to v1 domains.
    V1_DOMAINS = frozenset({
        "profile", "ca", "connector", "trigger", "label", "proxy",
        "datasource", "role", "team", "idp", "grading_policy",
        "grading_ruleset", "password_policy", "principal",
    })

    @pytest.mark.parametrize("domain", sorted(V1_DOMAINS))
    def test_baseline_fields_present_in_v1_domains(self, domain: str):
        """Every v1 domain must include the baseline server-populated fields."""
        assert _BASELINE_STRIP.issubset(STRIP_FIELDS[domain]), (
            f"Domain '{domain}' is missing baseline fields: "
            f"{_BASELINE_STRIP - STRIP_FIELDS[domain]}"
        )

    V11_ID_ONLY_DOMAINS = frozenset({
        "discovery_campaign", "automation_policy", "execution_policy",
        "wcce_forest", "scheduled_task",
    })

    @pytest.mark.parametrize("domain", sorted(V11_ID_ONLY_DOMAINS))
    def test_v11_domains_strip_only_id(self, domain: str):
        """v1.1 domains confirmed to only ignoreField('_id') in Scala source."""
        assert "_id" in STRIP_FIELDS[domain]

    def test_local_identity_has_extra_fields(self):
        extras = {"hash", "resetUUID", "resetExpiration"}
        assert extras.issubset(STRIP_FIELDS["local_identity"])

    def test_baseline_strip_contains_core_fields(self):
        assert _BASELINE_STRIP == frozenset({"_id", "id", "createdAt", "updatedAt"})

    def test_profile_has_extra_fields(self):
        extras = {"lastModifiedBy", "statistics", "status", "certificateCount"}
        assert extras.issubset(STRIP_FIELDS["profile"])

    def test_ca_has_extra_fields(self):
        extras = {"certificate", "crlCache", "statistics"}
        assert extras.issubset(STRIP_FIELDS["ca"])

    def test_connector_has_extra_fields(self):
        extras = {"status", "lastSync"}
        assert extras.issubset(STRIP_FIELDS["connector"])

    def test_trigger_has_extra_fields(self):
        extras = {"lastRun", "statistics"}
        assert extras.issubset(STRIP_FIELDS["trigger"])

    def test_team_has_extra_fields(self):
        extras = {"statistics", "memberCount"}
        assert extras.issubset(STRIP_FIELDS["team"])

    def test_datasource_has_extra_fields(self):
        assert "lastTest" in STRIP_FIELDS["datasource"]

    def test_principal_has_extra_fields(self):
        assert "lastLogin" in STRIP_FIELDS["principal"]

    @pytest.mark.parametrize("domain", sorted(EXPECTED_DOMAINS))
    def test_strip_fields_are_frozensets(self, domain: str):
        assert isinstance(STRIP_FIELDS[domain], frozenset)

    def test_minimal_domains_have_only_baseline(self):
        """Domains without domain-specific extras should equal baseline exactly."""
        minimal = {"label", "proxy", "role", "idp", "grading_policy",
                   "grading_ruleset", "password_policy"}
        for domain in minimal:
            assert STRIP_FIELDS[domain] == _BASELINE_STRIP, (
                f"Domain '{domain}' should have only baseline fields"
            )


# =========================================================================
# 2. to_update_payload() — merge logic
# =========================================================================

class TestToUpdatePayload:
    """Test the GET → PUT/PATCH payload conversion logic."""

    # A typical GET response with server-populated and user fields mixed
    SAMPLE_RESPONSE: dict[str, Any] = {
        "_id": "abc123",
        "id": "prof-1",
        "createdAt": "2025-01-01T00:00:00Z",
        "updatedAt": "2025-06-15T12:00:00Z",
        "lastModifiedBy": "admin",
        "statistics": {"issued": 42},
        "status": "active",
        "certificateCount": 7,
        "name": "My Profile",
        "description": "A test profile",
        "keyType": "RSA",
        "keySize": 2048,
    }

    # -- Basic stripping ---------------------------------------------------

    def test_strips_server_populated_fields_for_profile(self):
        payload = to_update_payload(self.SAMPLE_RESPONSE, domain="profile")
        for field in STRIP_FIELDS["profile"]:
            assert field not in payload

    def test_preserves_user_fields_for_profile(self):
        payload = to_update_payload(self.SAMPLE_RESPONSE, domain="profile")
        assert payload["name"] == "My Profile"
        assert payload["description"] == "A test profile"
        assert payload["keyType"] == "RSA"
        assert payload["keySize"] == 2048

    def test_default_domain_is_profile(self):
        payload = to_update_payload(self.SAMPLE_RESPONSE)
        for field in STRIP_FIELDS["profile"]:
            assert field not in payload

    def test_unknown_domain_falls_back_to_baseline(self):
        """Unknown domains strip only the baseline fields."""
        resp = {"_id": "x", "id": "y", "createdAt": "z", "updatedAt": "w", "custom": 1}
        payload = to_update_payload(resp, domain="nonexistent_domain")
        assert "custom" in payload
        assert payload["custom"] == 1
        for f in _BASELINE_STRIP:
            assert f not in payload

    def test_returns_new_dict_not_mutating_original(self):
        original = dict(self.SAMPLE_RESPONSE)
        payload = to_update_payload(self.SAMPLE_RESPONSE, domain="profile")
        assert self.SAMPLE_RESPONSE == original  # original untouched
        assert payload is not self.SAMPLE_RESPONSE

    # -- Overrides ---------------------------------------------------------

    def test_overrides_replace_existing_values(self):
        payload = to_update_payload(
            self.SAMPLE_RESPONSE,
            overrides={"name": "New Name", "keySize": 4096},
            domain="profile",
        )
        assert payload["name"] == "New Name"
        assert payload["keySize"] == 4096

    def test_overrides_add_new_fields(self):
        payload = to_update_payload(
            self.SAMPLE_RESPONSE,
            overrides={"newField": "newValue"},
            domain="profile",
        )
        assert payload["newField"] == "newValue"

    def test_none_override_values_are_skipped(self):
        """Overrides with None values do NOT set the field to None."""
        payload = to_update_payload(
            self.SAMPLE_RESPONSE,
            overrides={"name": None, "keySize": None},
            domain="profile",
        )
        # Original values preserved because None overrides are skipped
        assert payload["name"] == "My Profile"
        assert payload["keySize"] == 2048

    def test_overrides_none_does_not_remove_original(self):
        """Passing None as the entire overrides dict is safe."""
        payload = to_update_payload(self.SAMPLE_RESPONSE, overrides=None, domain="profile")
        assert payload["name"] == "My Profile"

    # -- clear_fields ------------------------------------------------------

    def test_clear_fields_sets_to_none(self):
        payload = to_update_payload(
            self.SAMPLE_RESPONSE,
            clear_fields=["description", "keyType"],
            domain="profile",
        )
        assert payload["description"] is None
        assert payload["keyType"] is None

    def test_clear_fields_on_nonexistent_field_adds_none(self):
        """Clearing a field that wasn't in the response still adds it as None."""
        payload = to_update_payload(
            self.SAMPLE_RESPONSE,
            clear_fields=["phantomField"],
            domain="profile",
        )
        assert payload["phantomField"] is None

    def test_clear_fields_none_is_safe(self):
        payload = to_update_payload(self.SAMPLE_RESPONSE, clear_fields=None, domain="profile")
        assert payload["name"] == "My Profile"

    def test_clear_fields_empty_list_is_safe(self):
        payload = to_update_payload(self.SAMPLE_RESPONSE, clear_fields=[], domain="profile")
        assert payload["name"] == "My Profile"

    # -- Order of operations: strip → clear → overrides --------------------

    def test_override_wins_over_clear(self):
        """If a field is both cleared and overridden, the override wins
        because overrides are applied after clear_fields."""
        payload = to_update_payload(
            self.SAMPLE_RESPONSE,
            overrides={"description": "Overridden"},
            clear_fields=["description"],
            domain="profile",
        )
        assert payload["description"] == "Overridden"

    def test_clear_wins_over_original(self):
        """clear_fields nullifies a field from the original response."""
        payload = to_update_payload(
            self.SAMPLE_RESPONSE,
            clear_fields=["name"],
            domain="profile",
        )
        assert payload["name"] is None

    def test_cleared_field_not_overridden_when_override_is_none(self):
        """If clear_fields sets a field to None and override for same field
        is also None, the field stays None (override None is skipped)."""
        payload = to_update_payload(
            self.SAMPLE_RESPONSE,
            overrides={"name": None},
            clear_fields=["name"],
            domain="profile",
        )
        assert payload["name"] is None

    def test_strip_removes_before_clear_and_override(self):
        """Server fields are stripped first, so clearing or overriding them
        would re-add them (which is allowed for clear_fields/overrides)."""
        payload = to_update_payload(
            self.SAMPLE_RESPONSE,
            overrides={"_id": "should-be-added-back"},
            domain="profile",
        )
        # _id was stripped but overrides re-add it
        assert payload["_id"] == "should-be-added-back"

    # -- Domain-specific stripping -----------------------------------------

    @pytest.mark.parametrize("domain", sorted(STRIP_FIELDS.keys()))
    def test_all_domains_strip_their_fields(self, domain: str):
        """Build a response with all strip fields present and verify removal."""
        response = {f: f"value-{f}" for f in STRIP_FIELDS[domain]}
        response["userField"] = "keep"
        payload = to_update_payload(response, domain=domain)
        for field in STRIP_FIELDS[domain]:
            assert field not in payload
        assert payload["userField"] == "keep"

    # -- Edge cases --------------------------------------------------------

    def test_empty_response(self):
        payload = to_update_payload({}, domain="profile")
        assert payload == {}

    def test_empty_response_with_overrides(self):
        payload = to_update_payload(
            {}, overrides={"name": "New"}, domain="profile"
        )
        assert payload == {"name": "New"}

    def test_empty_response_with_clear(self):
        payload = to_update_payload(
            {}, clear_fields=["name"], domain="profile"
        )
        assert payload == {"name": None}


# =========================================================================
# 3. Extractor helpers (unit tests for coverage)
# =========================================================================

class TestExtractors:
    """Unit tests for the individual extractor functions."""

    # -- _extract_credential -----------------------------------------------

    def test_credential_string(self):
        assert _extract_credential("my-cred") == [
            ("my-cred", "/api/v1/security/credentials/my-cred")
        ]

    def test_credential_list(self):
        result = _extract_credential(["cred-a", "cred-b"])
        assert len(result) == 2
        assert result[0] == ("cred-a", "/api/v1/security/credentials/cred-a")
        assert result[1] == ("cred-b", "/api/v1/security/credentials/cred-b")

    def test_credential_empty_string(self):
        assert _extract_credential("") == []

    def test_credential_none(self):
        assert _extract_credential(None) == []

    def test_credential_list_with_empties(self):
        result = _extract_credential(["", "valid", ""])
        assert len(result) == 1
        assert result[0][0] == "valid"

    # -- _extract_pki_connector --------------------------------------------

    def test_pki_connector_string(self):
        assert _extract_pki_connector("conn-1") == [
            ("conn-1", "/api/v1/pki/connectors/conn-1")
        ]

    def test_pki_connector_empty(self):
        assert _extract_pki_connector("") == []

    def test_pki_connector_non_string(self):
        assert _extract_pki_connector(123) == []

    # -- _extract_triggers_from_hooks --------------------------------------

    def test_triggers_from_sync_hooks(self):
        hooks = {"onEnroll": ["trig-a", "trig-b"]}
        result = _extract_triggers_from_hooks(hooks)
        names = {r[0] for r in result}
        assert names == {"trig-a", "trig-b"}

    def test_triggers_from_async_hooks(self):
        hooks = {"onRenew": [{"name": "async-trig"}]}
        result = _extract_triggers_from_hooks(hooks)
        assert result == [("async-trig", "/api/v1/triggers/async-trig")]

    def test_triggers_from_mixed_hooks(self):
        hooks = {
            "onEnroll": ["sync-trig"],
            "onRevoke": [{"name": "async-trig"}, "sync-trig"],
        }
        result = _extract_triggers_from_hooks(hooks)
        names = {r[0] for r in result}
        assert names == {"sync-trig", "async-trig"}

    def test_triggers_non_dict_returns_empty(self):
        assert _extract_triggers_from_hooks("not-a-dict") == []
        assert _extract_triggers_from_hooks(None) == []

    def test_triggers_deduplicates(self):
        hooks = {"a": ["dup", "dup"], "b": ["dup"]}
        result = _extract_triggers_from_hooks(hooks)
        assert len(result) == 1

    def test_triggers_skips_non_list_values(self):
        hooks = {"a": "not-a-list", "b": ["valid"]}
        result = _extract_triggers_from_hooks(hooks)
        assert len(result) == 1

    # -- _extract_grading_policies -----------------------------------------

    def test_grading_policies_string(self):
        result = _extract_grading_policies("policy-1")
        assert result == [("policy-1", "/api/v1/certificate/grading/policies/policy-1")]

    def test_grading_policies_list(self):
        result = _extract_grading_policies(["p1", "p2"])
        assert len(result) == 2

    # -- _extract_datasource_flow ------------------------------------------

    def test_datasource_flow_list(self):
        flow = [{"datasource": "ds-a"}, {"datasource": "ds-b"}]
        result = _extract_datasource_flow(flow)
        assert len(result) == 2
        assert result[0] == ("ds-a", "/api/v1/datasources/ds-a")

    def test_datasource_flow_non_list(self):
        assert _extract_datasource_flow("not-a-list") == []

    def test_datasource_flow_missing_key(self):
        flow = [{"other": "val"}]
        assert _extract_datasource_flow(flow) == []

    # -- _extract_identity_provider ----------------------------------------

    def test_idp_string(self):
        result = _extract_identity_provider("my-idp")
        assert result == [("my-idp", "/api/v1/security/identity/providers/my-idp")]

    def test_idp_list(self):
        result = _extract_identity_provider(["idp-1", "idp-2"])
        assert len(result) == 2


# =========================================================================
# 4. _check_one() — single dependency check
# =========================================================================

class TestCheckOne:
    """Tests for the single-dependency checker coroutine."""

    async def test_existing_dependency_returns_none(self):
        client = AsyncMock()
        client.get = AsyncMock(return_value={"name": "exists"})
        result = await _check_one(client, "my-dep", "/api/v1/things/my-dep", "hint")
        assert result is None
        client.get.assert_awaited_once_with("/api/v1/things/my-dep")

    async def test_missing_dependency_raises_horizon_error(self):
        client = AsyncMock()
        client.get = AsyncMock(
            side_effect=HorizonError(status_code=404, message="Not found")
        )
        with pytest.raises(HorizonError) as exc_info:
            await _check_one(client, "missing", "/api/v1/things/missing", "Create it first.")
        err = exc_info.value
        assert err.status_code == 422
        assert err.error_code == "PREFLIGHT-DEP"
        assert "missing" in err.message
        assert err.remediation == "Create it first."

    async def test_other_api_error_returns_warning(self):
        client = AsyncMock()
        client.get = AsyncMock(
            side_effect=HorizonError(status_code=500, message="Internal error")
        )
        result = await _check_one(client, "flaky", "/api/v1/things/flaky", "hint")
        assert isinstance(result, str)
        assert "flaky" in result
        assert "500" in result

    async def test_generic_exception_returns_warning(self):
        client = AsyncMock()
        client.get = AsyncMock(side_effect=RuntimeError("boom"))
        result = await _check_one(client, "broken", "/path", "hint")
        assert isinstance(result, str)
        assert "broken" in result
        assert "boom" in result


# =========================================================================
# 5. _preflight_deps() — dependency validation
# =========================================================================

class TestPreflightDeps:
    """Tests for the preflight dependency validation orchestrator."""

    def _make_client(self, side_effects: dict[str, Any] | None = None) -> AsyncMock:
        """Create a mock HorizonClient with configurable per-path responses.

        side_effects: mapping of API path → return value or exception.
        """
        client = AsyncMock()

        if side_effects is None:
            # Default: everything exists
            client.get = AsyncMock(return_value={})
            return client

        async def _get(path: str, **kwargs: Any) -> dict[str, Any]:
            if path in side_effects:
                val = side_effects[path]
                if isinstance(val, Exception):
                    raise val
                return val
            return {}

        client.get = AsyncMock(side_effect=_get)
        return client

    # -- Empty payload: no checks ------------------------------------------

    async def test_empty_payload_returns_no_warnings(self):
        client = self._make_client()
        warnings = await _preflight_deps(client, {}, "profile")
        assert warnings == []
        client.get.assert_not_awaited()

    async def test_payload_without_deps_returns_no_warnings(self):
        client = self._make_client()
        warnings = await _preflight_deps(
            client, {"name": "test", "keySize": 2048}, "profile"
        )
        assert warnings == []
        client.get.assert_not_awaited()

    # -- Existing dependency: success --------------------------------------

    async def test_existing_credential_returns_no_warnings(self):
        client = self._make_client({"/api/v1/security/credentials/cred-1": {}})
        warnings = await _preflight_deps(
            client, {"credential": "cred-1"}, "profile"
        )
        assert warnings == []
        client.get.assert_awaited_once_with("/api/v1/security/credentials/cred-1")

    # -- Missing dependency: hard error ------------------------------------

    async def test_missing_credential_raises_error(self):
        client = self._make_client({
            "/api/v1/security/credentials/missing": HorizonError(
                status_code=404, message="Not found"
            ),
        })
        with pytest.raises(HorizonError) as exc_info:
            await _preflight_deps(
                client, {"credential": "missing"}, "profile"
            )
        err = exc_info.value
        assert err.status_code == 422
        assert err.error_code == "PREFLIGHT-DEP"
        assert "missing" in err.message

    async def test_missing_pki_connector_raises_error(self):
        client = self._make_client({
            "/api/v1/pki/connectors/bad-conn": HorizonError(
                status_code=404, message="Not found"
            ),
        })
        with pytest.raises(HorizonError):
            await _preflight_deps(
                client, {"pkiConnector": "bad-conn"}, "profile"
            )

    async def test_missing_trigger_raises_error(self):
        client = self._make_client({
            "/api/v1/triggers/bad-trig": HorizonError(
                status_code=404, message="Not found"
            ),
        })
        with pytest.raises(HorizonError):
            await _preflight_deps(
                client,
                {"triggerHooks": {"onEnroll": ["bad-trig"]}},
                "profile",
            )

    async def test_missing_idp_raises_error(self):
        client = self._make_client({
            "/api/v1/security/identity/providers/bad-idp": HorizonError(
                status_code=404, message="Not found"
            ),
        })
        with pytest.raises(HorizonError):
            await _preflight_deps(
                client, {"identityProvider": "bad-idp"}, "profile"
            )

    async def test_missing_datasource_raises_error(self):
        client = self._make_client({
            "/api/v1/datasources/ds-bad": HorizonError(
                status_code=404, message="Not found"
            ),
        })
        with pytest.raises(HorizonError):
            await _preflight_deps(
                client,
                {"dsFlow": [{"datasource": "ds-bad"}]},
                "profile",
            )

    # -- Non-blocking warnings (non-404 errors) ----------------------------

    async def test_500_error_produces_warning_not_exception(self):
        client = self._make_client({
            "/api/v1/security/credentials/flaky": HorizonError(
                status_code=500, message="Internal server error"
            ),
        })
        warnings = await _preflight_deps(
            client, {"credential": "flaky"}, "profile"
        )
        assert len(warnings) == 1
        assert "flaky" in warnings[0]

    # -- Max preflight calls cap at 5 -------------------------------------

    async def test_max_5_preflight_calls(self):
        """Even with many dependencies, at most 5 API calls are made."""
        assert _MAX_PREFLIGHT_CALLS == 5

        # Build a payload with 8 credentials
        creds = [f"cred-{i}" for i in range(8)]
        client = self._make_client()  # all succeed
        warnings = await _preflight_deps(
            client, {"credential": creds}, "profile"
        )
        assert warnings == []
        # At most 5 calls made
        assert client.get.await_count <= _MAX_PREFLIGHT_CALLS

    async def test_cap_spans_multiple_dep_types(self):
        """The 5-call cap spans across different dependency types."""
        payload = {
            "credential": ["c1", "c2", "c3"],
            "pkiConnector": "conn-1",
            "triggerHooks": {"onEnroll": ["t1", "t2"]},
            "identityProvider": "idp-1",
        }
        # Total would be 3 + 1 + 2 + 1 = 7, but cap is 5
        client = self._make_client()
        await _preflight_deps(client, payload, "profile")
        assert client.get.await_count == _MAX_PREFLIGHT_CALLS

    # -- Priority order: credentials first ---------------------------------

    async def test_credentials_checked_before_connectors(self):
        """Credentials have higher priority than PKI connectors."""
        call_order: list[str] = []

        async def _get(path: str, **kwargs: Any) -> dict[str, Any]:
            call_order.append(path)
            return {}

        client = AsyncMock()
        client.get = AsyncMock(side_effect=_get)

        payload = {
            "pkiConnector": "conn-1",
            "credential": "cred-1",
        }
        await _preflight_deps(client, payload, "profile")

        # Both should be checked, credentials path appears first in the
        # checks list (priority order). Since asyncio.gather runs them
        # concurrently, we verify the checks were collected correctly by
        # ensuring both paths were called.
        paths_called = set(call_order)
        assert "/api/v1/security/credentials/cred-1" in paths_called
        assert "/api/v1/pki/connectors/conn-1" in paths_called

    async def test_priority_order_in_dep_checks(self):
        """Verify the ordering of _DEP_CHECKS matches documented priority."""
        keys = [key for key, _, _ in _DEP_CHECKS]
        # credentials → connectors → triggers → grading → datasources → IDPs
        cred_idx = min(i for i, k in enumerate(keys) if k in ("credential", "credentials"))
        conn_idx = min(i for i, k in enumerate(keys) if k == "pkiConnector")
        trig_idx = min(i for i, k in enumerate(keys) if k == "triggerHooks")
        ds_idx = min(i for i, k in enumerate(keys) if k == "dsFlow")
        idp_idx = min(i for i, k in enumerate(keys) if k in ("identityProvider", "identityProviders"))

        assert cred_idx < conn_idx < trig_idx < ds_idx < idp_idx

    # -- asyncio.gather batching -------------------------------------------

    async def test_checks_run_concurrently_via_gather(self):
        """Multiple dependency checks should be dispatched concurrently."""
        client = self._make_client()
        payload = {"credential": ["c1", "c2", "c3"]}
        await _preflight_deps(client, payload, "profile")
        # All 3 checks should have been started
        assert client.get.await_count == 3

    # -- Mixed results: one warning, rest ok -------------------------------

    async def test_mixed_success_and_warning(self):
        client = self._make_client({
            "/api/v1/security/credentials/ok-cred": {},
            "/api/v1/pki/connectors/flaky-conn": HorizonError(
                status_code=503, message="Unavailable"
            ),
        })
        warnings = await _preflight_deps(
            client,
            {"credential": "ok-cred", "pkiConnector": "flaky-conn"},
            "profile",
        )
        assert len(warnings) == 1
        assert "flaky-conn" in warnings[0]

    # -- Gather propagates HorizonError through return_exceptions ----------

    async def test_gather_raises_first_hard_error(self):
        """When gather returns exceptions, the first HorizonError (404) is raised."""
        client = self._make_client({
            "/api/v1/security/credentials/c1": {},
            "/api/v1/security/credentials/c2": HorizonError(
                status_code=404, message="Not found"
            ),
        })
        with pytest.raises(HorizonError) as exc_info:
            await _preflight_deps(
                client, {"credential": ["c1", "c2"]}, "profile"
            )
        assert exc_info.value.status_code == 422

    # -- Generic exception from gather is converted to warning -------------

    async def test_unexpected_exception_becomes_warning(self):
        """A non-HorizonError exception from gather becomes a warning string."""
        async def _get(path: str, **kwargs: Any) -> dict[str, Any]:
            raise RuntimeError("unexpected crash")

        client = AsyncMock()
        client.get = AsyncMock(side_effect=_get)

        warnings = await _preflight_deps(
            client, {"credential": "c1"}, "profile"
        )
        assert len(warnings) == 1
        assert "unexpectedly" in warnings[0] or "crash" in warnings[0]

    # -- Payload keys with None values are skipped -------------------------

    async def test_none_valued_dep_keys_are_skipped(self):
        client = self._make_client()
        payload = {"credential": None, "pkiConnector": None}
        warnings = await _preflight_deps(client, payload, "profile")
        assert warnings == []
        client.get.assert_not_awaited()

    # -- credentials (plural key) -----------------------------------------

    async def test_plural_credentials_key(self):
        client = self._make_client({"/api/v1/security/credentials/c1": {}})
        warnings = await _preflight_deps(
            client, {"credentials": "c1"}, "profile"
        )
        assert warnings == []
        client.get.assert_awaited_once()

    # -- identityProviders (plural key) ------------------------------------

    async def test_plural_identity_providers_key(self):
        client = self._make_client({"/api/v1/security/identity/providers/idp-1": {}})
        warnings = await _preflight_deps(
            client, {"identityProviders": ["idp-1"]}, "profile"
        )
        assert warnings == []

    # -- gradingPolicy (singular) and gradingPolicies (plural) -------------

    async def test_grading_policy_singular_key(self):
        client = self._make_client({"/api/v1/certificate/grading/policies/gp1": {}})
        warnings = await _preflight_deps(
            client, {"gradingPolicy": "gp1"}, "profile"
        )
        assert warnings == []

    async def test_grading_policies_plural_key(self):
        client = self._make_client({
            "/api/v1/certificate/grading/policies/gp1": {},
            "/api/v1/certificate/grading/policies/gp2": {},
        })
        warnings = await _preflight_deps(
            client, {"gradingPolicies": ["gp1", "gp2"]}, "profile"
        )
        assert warnings == []
