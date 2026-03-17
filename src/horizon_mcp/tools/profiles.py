"""Certificate profile Phase 1 tools — 12 tools covering list, get, and
module-specific create/update for the 5 v1A profile modules.

v1A modules (5): WebRA, ACME, SCEP, EST, Monitored

Safety tiers:
    - list_profiles, get_profile: read-only
    - create_*_profile: mutating-safe
    - update_*_profile: mutating-destructive (behavior-changing)

References:
    - horizon://knowledge/profiles
    - horizon://knowledge/computation-and-data-flow
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.models.payloads import _preflight_deps, to_update_payload
from horizon_mcp.tools._helpers import (
    apply_name_filter,
    build_list_response,
    build_mutate_response,
)

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.profiles")


# ---------------------------------------------------------------------------
# Docstring helper — f-strings are NOT recognized as __doc__ by Python
# ---------------------------------------------------------------------------

def _with_doc(docstring: str):
    """Decorator that sets __doc__ before @mcp.tool() captures the function."""
    def decorator(fn):
        fn.__doc__ = docstring
        return fn
    return decorator


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PROFILE_BASE = "/api/v1/certificate/profiles"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _set_if_not_none(d: dict[str, Any], key: str, value: Any) -> None:
    """Set a key only when the value is not None."""
    if value is not None:
        d[key] = value


def _apply_module_filter(
    items: list[dict[str, Any]], module: str | None,
) -> list[dict[str, Any]]:
    """Client-side filter on the 'module' field (case-insensitive exact match)."""
    if not module:
        return items
    needle = module.lower()
    return [item for item in items if item.get("module", "").lower() == needle]


# ---------------------------------------------------------------------------
# Payload assembly helpers
# ---------------------------------------------------------------------------

def _build_profile_payload(
    *,
    module: str,
    name: str,
    display_name: str | None = None,
    description: str | None = None,
    enabled: bool = True,
    pki_connector: str | None = None,
    certificate_template: dict | None = None,
    authorization_levels: dict | None = None,
    crypto_policy: dict | None = None,
    self_permissions: dict | None = None,
    requests_policy: dict | None = None,
    triggers: dict | None = None,
    grading_policies: list[str] | None = None,
    ds_flow: list[dict] | None = None,
    max_cert_per_holder_policy: dict | None = None,
    renewal_period: int | None = None,
    pqc_allowed: bool = False,
    third_party_discovery_sync: bool = False,
    **module_specific: Any,
) -> dict[str, Any]:
    """Assemble common + module-specific fields into an API payload dict.

    All keys use the camelCase names expected by the Horizon API.
    None-valued optional fields are omitted so the API applies its defaults.
    """
    payload: dict[str, Any] = {
        "module": module,
        "name": name,
        "enabled": enabled,
        "pqcAllowed": pqc_allowed,
        "thirdPartyDiscoverySync": third_party_discovery_sync,
    }

    # Optional scalar fields
    _set_if_not_none(payload, "displayName", display_name)
    _set_if_not_none(payload, "description", description)
    _set_if_not_none(payload, "pkiConnector", pki_connector)
    _set_if_not_none(payload, "renewalPeriod", renewal_period)

    # Optional complex sub-objects
    _set_if_not_none(payload, "certificateTemplate", certificate_template)
    _set_if_not_none(payload, "authorizationLevels", authorization_levels)
    _set_if_not_none(payload, "cryptoPolicy", crypto_policy)
    _set_if_not_none(payload, "selfPermissions", self_permissions)
    _set_if_not_none(payload, "requestsPolicy", requests_policy)
    _set_if_not_none(payload, "triggerHooks", triggers)
    _set_if_not_none(payload, "gradingPolicies", grading_policies)
    _set_if_not_none(payload, "dsFlow", ds_flow)
    _set_if_not_none(payload, "maxCertificatePerHolderPolicy", max_cert_per_holder_policy)

    # Module-specific fields (already camelCase from each tool function)
    for key, value in module_specific.items():
        if value is not None:
            payload[key] = value

    return payload


def _build_update_overrides(
    *,
    display_name: str | None = None,
    description: str | None = None,
    enabled: bool | None = None,
    pki_connector: str | None = None,
    certificate_template: dict | None = None,
    authorization_levels: dict | None = None,
    crypto_policy: dict | None = None,
    self_permissions: dict | None = None,
    requests_policy: dict | None = None,
    triggers: dict | None = None,
    grading_policies: list[str] | None = None,
    ds_flow: list[dict] | None = None,
    max_cert_per_holder_policy: dict | None = None,
    renewal_period: int | None = None,
    pqc_allowed: bool | None = None,
    third_party_discovery_sync: bool | None = None,
    **module_specific: Any,
) -> dict[str, Any]:
    """Build the overrides dict for update tools (GET->strip->merge->PUT).

    Only non-None values are included so ``to_update_payload`` preserves
    existing values for omitted fields.
    """
    overrides: dict[str, Any] = {}

    _set_if_not_none(overrides, "displayName", display_name)
    _set_if_not_none(overrides, "description", description)
    _set_if_not_none(overrides, "enabled", enabled)
    _set_if_not_none(overrides, "pkiConnector", pki_connector)
    _set_if_not_none(overrides, "renewalPeriod", renewal_period)
    _set_if_not_none(overrides, "pqcAllowed", pqc_allowed)
    _set_if_not_none(overrides, "thirdPartyDiscoverySync", third_party_discovery_sync)
    _set_if_not_none(overrides, "certificateTemplate", certificate_template)
    _set_if_not_none(overrides, "authorizationLevels", authorization_levels)
    _set_if_not_none(overrides, "cryptoPolicy", crypto_policy)
    _set_if_not_none(overrides, "selfPermissions", self_permissions)
    _set_if_not_none(overrides, "requestsPolicy", requests_policy)
    _set_if_not_none(overrides, "triggerHooks", triggers)
    _set_if_not_none(overrides, "gradingPolicies", grading_policies)
    _set_if_not_none(overrides, "dsFlow", ds_flow)
    _set_if_not_none(overrides, "maxCertificatePerHolderPolicy", max_cert_per_holder_policy)

    for key, value in module_specific.items():
        if value is not None:
            overrides[key] = value

    return overrides


async def _do_create(payload: dict[str, Any]) -> str:
    """Preflight-check then POST a profile payload. Returns JSON result."""
    from horizon_mcp.client.state import get_client

    client = get_client()
    warnings = await _preflight_deps(client, payload, "profile")
    result = await client.post(_PROFILE_BASE, json=payload)
    return build_mutate_response(
        action="created",
        kind="profile",
        name=payload["name"],
        data=result,
        warnings=warnings if warnings else None,
    )


async def _do_update(
    name: str,
    overrides: dict[str, Any],
    clear_fields: list[str] | None,
) -> str:
    """GET->strip->merge->PUT update cycle. Returns JSON result."""
    from horizon_mcp.client.state import get_client

    client = get_client()

    # Fetch current state
    current = await client.get(f"{_PROFILE_BASE}/{name}")

    # Build clean update payload
    payload = to_update_payload(
        current,
        overrides=overrides,
        clear_fields=clear_fields,
        domain="profile",
    )

    # Preflight the merged payload
    warnings = await _preflight_deps(client, payload, "profile")

    result = await client.put(_PROFILE_BASE, json=payload)
    return build_mutate_response(
        action="updated",
        kind="profile",
        name=name,
        data=result,
        warnings=warnings if warnings else None,
    )


# ---------------------------------------------------------------------------
# Common docstring fragments
# ---------------------------------------------------------------------------

_COMMON_PARAMS_DOC = """\

Common parameters (shared across all managed profile modules):
    - certificate_template: dict — Template defining certificate fields.
      Example: {{"subject": [{{"element": "cn.1", "type": "CN", "value": "example.com"}}],
      "sans": [{{"type": "DNSNAME", "value": ["*.example.com"]}}],
      "keyType": "rsa-2048", "extensions": {{}}}}.
      Use get_profile on an existing profile to see the full template shape.
    - authorization_levels: dict — Access control configuration.
      Example: {{"enroll": {{"accessLevel": "authenticated"}}, "revoke": {{"accessLevel": "authorized"}},
      "update": {{"accessLevel": "authorized"}}, "recover": {{"accessLevel": "authorized"}}}}.
      Valid accessLevel values: "everyone", "authenticated", "authorized".
    - crypto_policy: dict — ManagedCryptoPolicy shape (key types, escrow,
      PKCS#12 settings).
    - self_permissions: dict — SelfPermissions shape (self-service flags).
    - requests_policy: dict — Workflow approval policy.
      Example: {{"enroll": "auto", "revoke": "one_step", "update": "auto", "recover": "one_step"}}.
      Valid values per workflow: "auto" (immediate), "one_step" (requires approval).
    - triggers: dict — TriggerHooks shape (sync list[str] and async
      list[{{name, activationDate}}] hooks per workflow event).
    - grading_policies: list[str] — names of grading policies to apply.
    - ds_flow: list[dict] — DataSourceFlow shape (datasource chain with
      inputs and stopOnSuccess).
    - max_cert_per_holder_policy: dict — {{enabled, maxCertificates, action}}.
    - renewal_period: int — auto-renewal period in days.
    - pqc_allowed: bool — allow post-quantum cryptography (default false).
    - third_party_discovery_sync: bool — sync with third-party discovery
      (default false).

NOTE: csrDataMapping is DEPRECATED — use computation rules instead.
See: horizon://knowledge/profiles, horizon://knowledge/computation-and-data-flow"""

_UPDATE_EXTRA_DOC = """
    - clear_fields: list[str] — top-level field names to explicitly set to
      null. Use this to remove optional configuration (e.g., triggers,
      crypto_policy). Fields omitted from other parameters are preserved
      as-is from the current profile."""

_CREATE_WORKFLOW_DOC = """

        IMPORTANT: The profile name is IMMUTABLE (primary key) — it cannot be
        changed after creation. Always ask the user for both the name AND
        display_name before creating. display_name is the human-friendly label
        shown in the UI and can be changed later.

        Prerequisites: PKI connector must exist if referenced (use list_pki_connectors).
            Third-party connectors must exist if referenced (use list_thirdparty_connectors).
        See also: create_trigger + attach_trigger_to_profile (wire notifications),
            create_automation_policy (automate lifecycle operations for this profile)."""


# ---------------------------------------------------------------------------
# Tool registration
# ---------------------------------------------------------------------------

def register_profile_phase1_tools(mcp: FastMCP) -> None:
    """Register phase-1 profile tools: list, get, and v1A create/update pairs (12 tools)."""

    from horizon_mcp.client.state import get_client

    # ===================================================================
    # 1. list_profiles (read-only)
    # ===================================================================

    @mcp.tool()
    async def list_profiles(
        max_items: int = 50,
        name_contains: str | None = None,
        module: str | None = None,
    ) -> str:
        """List certificate profiles with optional filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/profiles

        Client-side filtering is applied after fetching all profiles from
        the API. Use name_contains for substring search and module for
        exact module type matching.

        Args:
            max_items: Maximum number of profiles to return (default 50).
            name_contains: Case-insensitive substring filter on profile name.
            module: Filter by module type (webra, acme, scep, est, monitored).

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        data = await client.get(_PROFILE_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )
        items = apply_name_filter(items, name_contains)
        items = _apply_module_filter(items, module)
        return build_list_response(items, max_items, kind="profile")

    # ===================================================================
    # 2. get_profile (read-only)
    # ===================================================================

    @mcp.tool()
    async def get_profile(name: str) -> str:
        """Get full details of a single certificate profile by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/profiles

        Args:
            name: Exact profile name.

        Returns:
            JSON representation of the profile including all configuration.
        """
        client = get_client()
        result = await client.get(f"{_PROFILE_BASE}/{name}")
        return json.dumps(result)

    # ===================================================================
    # 4. create_webra_profile (mutating-safe)
    # ===================================================================

    @mcp.tool()
    @_with_doc(        f"""Create a WebRA certificate profile.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/profiles

        WebRA is the web-based registration authority module for interactive
        certificate enrollment through the Horizon UI or API.

        WebRA-specific parameters:
            authorization_mode: One of 'authorized', 'auto-validation', or
                'auto-validation-authorized'.
            validation_ruleset: dict (ValidationRuleset shape) — required when
                authorization_mode includes 'auto-validation'. Contains rules
                (list of {{condition: str}}) and threshold (int).
        {_COMMON_PARAMS_DOC}
        {_CREATE_WORKFLOW_DOC}
        """)
    async def create_webra_profile(
        name: str,
        pki_connector: str,
        certificate_template: dict,
        authorization_levels: dict,
        authorization_mode: str = "authorized",
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool = True,
        crypto_policy: dict | None = None,
        self_permissions: dict | None = None,
        requests_policy: dict | None = None,
        triggers: dict | None = None,
        grading_policies: list[str] | None = None,
        ds_flow: list[dict] | None = None,
        max_cert_per_holder_policy: dict | None = None,
        renewal_period: int | None = None,
        pqc_allowed: bool = False,
        third_party_discovery_sync: bool = False,
        validation_ruleset: dict | None = None,
    ) -> str:
        payload = _build_profile_payload(
            module="webra",
            name=name,
            display_name=display_name,
            description=description,
            enabled=enabled,
            pki_connector=pki_connector,
            certificate_template=certificate_template,
            authorization_levels=authorization_levels,
            crypto_policy=crypto_policy,
            self_permissions=self_permissions,
            requests_policy=requests_policy,
            triggers=triggers,
            grading_policies=grading_policies,
            ds_flow=ds_flow,
            max_cert_per_holder_policy=max_cert_per_holder_policy,
            renewal_period=renewal_period,
            pqc_allowed=pqc_allowed,
            third_party_discovery_sync=third_party_discovery_sync,
            authorizationMode=authorization_mode,
            validationRuleset=validation_ruleset,
        )
        return await _do_create(payload)

    # ===================================================================
    # 5. update_webra_profile (mutating-destructive)
    # ===================================================================

    @mcp.tool()
    @_with_doc(        f"""Update an existing WebRA certificate profile.

        Safety tier: mutating-destructive (behavior-changing)
        Knowledge: horizon://knowledge/profiles

        Uses GET->strip->merge->PUT to safely update. Only provided
        parameters are changed; omitted parameters preserve their current
        values. Use clear_fields to explicitly null optional fields.

        WebRA-specific parameters:
            authorization_mode: One of 'authorized', 'auto-validation', or
                'auto-validation-authorized'.
            validation_ruleset: dict (ValidationRuleset shape) — required when
                authorization_mode includes 'auto-validation'.
        {_COMMON_PARAMS_DOC}
        {_UPDATE_EXTRA_DOC}
        """)
    async def update_webra_profile(
        name: str,
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool | None = None,
        pki_connector: str | None = None,
        certificate_template: dict | None = None,
        authorization_levels: dict | None = None,
        authorization_mode: str | None = None,
        crypto_policy: dict | None = None,
        self_permissions: dict | None = None,
        requests_policy: dict | None = None,
        triggers: dict | None = None,
        grading_policies: list[str] | None = None,
        ds_flow: list[dict] | None = None,
        max_cert_per_holder_policy: dict | None = None,
        renewal_period: int | None = None,
        pqc_allowed: bool | None = None,
        third_party_discovery_sync: bool | None = None,
        validation_ruleset: dict | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        overrides = _build_update_overrides(
            display_name=display_name,
            description=description,
            enabled=enabled,
            pki_connector=pki_connector,
            certificate_template=certificate_template,
            authorization_levels=authorization_levels,
            crypto_policy=crypto_policy,
            self_permissions=self_permissions,
            requests_policy=requests_policy,
            triggers=triggers,
            grading_policies=grading_policies,
            ds_flow=ds_flow,
            max_cert_per_holder_policy=max_cert_per_holder_policy,
            renewal_period=renewal_period,
            pqc_allowed=pqc_allowed,
            third_party_discovery_sync=third_party_discovery_sync,
            authorizationMode=authorization_mode,
            validationRuleset=validation_ruleset,
        )
        return await _do_update(name, overrides, clear_fields)

    # ===================================================================
    # 6. create_acme_profile (mutating-safe)
    # ===================================================================

    @mcp.tool()
    @_with_doc(        f"""Create an ACME certificate profile.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/profiles

        ACME (Automatic Certificate Management Environment) enables automated
        certificate issuance via the ACME protocol (RFC 8555).

        ACME-specific parameters:
            authorization_methods: list of challenge types to enable.
                Allowed values: 'http-01', 'dns-01', 'tls-alpn-01'.
            http01_port: Custom port for HTTP-01 challenge validation.
            tls_alpn01_port: Custom port for TLS-ALPN-01 challenge validation.
            authorize_short_name: Allow short (non-FQDN) names (default false).
            max_dns_name: Maximum number of DNS names per certificate.
            proxy: HTTP proxy URL for outbound ACME validation requests.
        {_COMMON_PARAMS_DOC}
        {_CREATE_WORKFLOW_DOC}
        """)
    async def create_acme_profile(
        name: str,
        pki_connector: str,
        certificate_template: dict,
        authorization_levels: dict,
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool = True,
        crypto_policy: dict | None = None,
        self_permissions: dict | None = None,
        requests_policy: dict | None = None,
        triggers: dict | None = None,
        grading_policies: list[str] | None = None,
        ds_flow: list[dict] | None = None,
        max_cert_per_holder_policy: dict | None = None,
        renewal_period: int | None = None,
        pqc_allowed: bool = False,
        third_party_discovery_sync: bool = False,
        authorization_methods: list[str] | None = None,
        http01_port: int | None = None,
        tls_alpn01_port: int | None = None,
        authorize_short_name: bool = False,
        max_dns_name: int | None = None,
        proxy: str | None = None,
    ) -> str:
        payload = _build_profile_payload(
            module="acme",
            name=name,
            display_name=display_name,
            description=description,
            enabled=enabled,
            pki_connector=pki_connector,
            certificate_template=certificate_template,
            authorization_levels=authorization_levels,
            crypto_policy=crypto_policy,
            self_permissions=self_permissions,
            requests_policy=requests_policy,
            triggers=triggers,
            grading_policies=grading_policies,
            ds_flow=ds_flow,
            max_cert_per_holder_policy=max_cert_per_holder_policy,
            renewal_period=renewal_period,
            pqc_allowed=pqc_allowed,
            third_party_discovery_sync=third_party_discovery_sync,
            authorizationMethods=authorization_methods,
            http01Port=http01_port,
            tlsAlpn01Port=tls_alpn01_port,
            authorizeShortName=authorize_short_name,
            maxDnsName=max_dns_name,
            proxy=proxy,
        )
        return await _do_create(payload)

    # ===================================================================
    # 7. update_acme_profile (mutating-destructive)
    # ===================================================================

    @mcp.tool()
    @_with_doc(        f"""Update an existing ACME certificate profile.

        Safety tier: mutating-destructive (behavior-changing)
        Knowledge: horizon://knowledge/profiles

        Uses GET->strip->merge->PUT to safely update. Only provided
        parameters are changed; omitted parameters preserve their current
        values. Use clear_fields to explicitly null optional fields.

        ACME-specific parameters:
            authorization_methods: list of challenge types ('http-01',
                'dns-01', 'tls-alpn-01').
            http01_port: Custom port for HTTP-01 challenge validation.
            tls_alpn01_port: Custom port for TLS-ALPN-01 challenge validation.
            authorize_short_name: Allow short (non-FQDN) names.
            max_dns_name: Maximum number of DNS names per certificate.
            proxy: HTTP proxy URL for outbound ACME validation requests.
        {_COMMON_PARAMS_DOC}
        {_UPDATE_EXTRA_DOC}
        """)
    async def update_acme_profile(
        name: str,
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool | None = None,
        pki_connector: str | None = None,
        certificate_template: dict | None = None,
        authorization_levels: dict | None = None,
        crypto_policy: dict | None = None,
        self_permissions: dict | None = None,
        requests_policy: dict | None = None,
        triggers: dict | None = None,
        grading_policies: list[str] | None = None,
        ds_flow: list[dict] | None = None,
        max_cert_per_holder_policy: dict | None = None,
        renewal_period: int | None = None,
        pqc_allowed: bool | None = None,
        third_party_discovery_sync: bool | None = None,
        authorization_methods: list[str] | None = None,
        http01_port: int | None = None,
        tls_alpn01_port: int | None = None,
        authorize_short_name: bool | None = None,
        max_dns_name: int | None = None,
        proxy: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        overrides = _build_update_overrides(
            display_name=display_name,
            description=description,
            enabled=enabled,
            pki_connector=pki_connector,
            certificate_template=certificate_template,
            authorization_levels=authorization_levels,
            crypto_policy=crypto_policy,
            self_permissions=self_permissions,
            requests_policy=requests_policy,
            triggers=triggers,
            grading_policies=grading_policies,
            ds_flow=ds_flow,
            max_cert_per_holder_policy=max_cert_per_holder_policy,
            renewal_period=renewal_period,
            pqc_allowed=pqc_allowed,
            third_party_discovery_sync=third_party_discovery_sync,
            authorizationMethods=authorization_methods,
            http01Port=http01_port,
            tlsAlpn01Port=tls_alpn01_port,
            authorizeShortName=authorize_short_name,
            maxDnsName=max_dns_name,
            proxy=proxy,
        )
        return await _do_update(name, overrides, clear_fields)

    # ===================================================================
    # 8. create_scep_profile (mutating-safe)
    # ===================================================================

    @mcp.tool()
    @_with_doc(        f"""Create a SCEP certificate profile.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/profiles

        SCEP (Simple Certificate Enrollment Protocol) enables automated
        certificate enrollment for network devices and MDM-managed endpoints.

        SCEP-specific parameters:
            mode: 'ca' (direct CA signing) or 'ra' (RA proxy mode). When
                mode='ra', scep_ra is required.
            scep_ra: RA certificate name — required when mode='ra'.
            caps: SCEP capabilities to advertise (e.g., 'POSTPKIOperation',
                'SHA-256', 'AES').
            encryption_algorithm: Encryption algorithm for SCEP messages.
            authorization_mode: One of 'challenge', 'authorized', 'ndes',
                or 'auto-validation'.
            dn_whitelist: Allowed DN patterns for enrollment filtering.
            validation_ruleset: dict (ValidationRuleset shape) — required
                when authorization_mode is 'auto-validation'.
        {_COMMON_PARAMS_DOC}
        {_CREATE_WORKFLOW_DOC}
        """)
    async def create_scep_profile(
        name: str,
        pki_connector: str,
        certificate_template: dict,
        authorization_levels: dict,
        mode: str = "ca",
        authorization_mode: str = "challenge",
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool = True,
        crypto_policy: dict | None = None,
        self_permissions: dict | None = None,
        requests_policy: dict | None = None,
        triggers: dict | None = None,
        grading_policies: list[str] | None = None,
        ds_flow: list[dict] | None = None,
        max_cert_per_holder_policy: dict | None = None,
        renewal_period: int | None = None,
        pqc_allowed: bool = False,
        third_party_discovery_sync: bool = False,
        scep_ra: str | None = None,
        caps: list[str] | None = None,
        encryption_algorithm: str | None = None,
        dn_whitelist: list[str] | None = None,
        validation_ruleset: dict | None = None,
    ) -> str:
        payload = _build_profile_payload(
            module="scep",
            name=name,
            display_name=display_name,
            description=description,
            enabled=enabled,
            pki_connector=pki_connector,
            certificate_template=certificate_template,
            authorization_levels=authorization_levels,
            crypto_policy=crypto_policy,
            self_permissions=self_permissions,
            requests_policy=requests_policy,
            triggers=triggers,
            grading_policies=grading_policies,
            ds_flow=ds_flow,
            max_cert_per_holder_policy=max_cert_per_holder_policy,
            renewal_period=renewal_period,
            pqc_allowed=pqc_allowed,
            third_party_discovery_sync=third_party_discovery_sync,
            mode=mode,
            scepRa=scep_ra,
            caps=caps,
            encryptionAlgorithm=encryption_algorithm,
            authorizationMode=authorization_mode,
            dnWhitelist=dn_whitelist,
            validationRuleset=validation_ruleset,
        )
        return await _do_create(payload)

    # ===================================================================
    # 9. update_scep_profile (mutating-destructive)
    # ===================================================================

    @mcp.tool()
    @_with_doc(        f"""Update an existing SCEP certificate profile.

        Safety tier: mutating-destructive (behavior-changing)
        Knowledge: horizon://knowledge/profiles

        Uses GET->strip->merge->PUT to safely update. Only provided
        parameters are changed; omitted parameters preserve their current
        values. Use clear_fields to explicitly null optional fields.

        SCEP-specific parameters:
            mode: 'ca' or 'ra'. When mode='ra', scep_ra is required.
            scep_ra: RA certificate name (required when mode='ra').
            caps: SCEP capabilities to advertise.
            encryption_algorithm: Encryption algorithm for SCEP messages.
            authorization_mode: 'challenge', 'authorized', 'ndes', or
                'auto-validation'.
            dn_whitelist: Allowed DN patterns for enrollment filtering.
            validation_ruleset: dict (ValidationRuleset shape) — required
                when authorization_mode is 'auto-validation'.
        {_COMMON_PARAMS_DOC}
        {_UPDATE_EXTRA_DOC}
        """)
    async def update_scep_profile(
        name: str,
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool | None = None,
        pki_connector: str | None = None,
        certificate_template: dict | None = None,
        authorization_levels: dict | None = None,
        crypto_policy: dict | None = None,
        self_permissions: dict | None = None,
        requests_policy: dict | None = None,
        triggers: dict | None = None,
        grading_policies: list[str] | None = None,
        ds_flow: list[dict] | None = None,
        max_cert_per_holder_policy: dict | None = None,
        renewal_period: int | None = None,
        pqc_allowed: bool | None = None,
        third_party_discovery_sync: bool | None = None,
        mode: str | None = None,
        scep_ra: str | None = None,
        caps: list[str] | None = None,
        encryption_algorithm: str | None = None,
        authorization_mode: str | None = None,
        dn_whitelist: list[str] | None = None,
        validation_ruleset: dict | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        overrides = _build_update_overrides(
            display_name=display_name,
            description=description,
            enabled=enabled,
            pki_connector=pki_connector,
            certificate_template=certificate_template,
            authorization_levels=authorization_levels,
            crypto_policy=crypto_policy,
            self_permissions=self_permissions,
            requests_policy=requests_policy,
            triggers=triggers,
            grading_policies=grading_policies,
            ds_flow=ds_flow,
            max_cert_per_holder_policy=max_cert_per_holder_policy,
            renewal_period=renewal_period,
            pqc_allowed=pqc_allowed,
            third_party_discovery_sync=third_party_discovery_sync,
            mode=mode,
            scepRa=scep_ra,
            caps=caps,
            encryptionAlgorithm=encryption_algorithm,
            authorizationMode=authorization_mode,
            dnWhitelist=dn_whitelist,
            validationRuleset=validation_ruleset,
        )
        return await _do_update(name, overrides, clear_fields)

    # ===================================================================
    # 10. create_est_profile (mutating-safe)
    # ===================================================================

    @mcp.tool()
    @_with_doc(        f"""Create an EST certificate profile.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/profiles

        EST (Enrollment over Secure Transport, RFC 7030) enables certificate
        enrollment and renewal over HTTPS with mutual TLS or challenge-based
        authentication.

        For EST renewal, CAs used must have trustedForClientAuthentication=true.

        EST-specific parameters:
            authorization_mode: One of 'authorized', 'x509', 'challenge', or
                'auto-validation'.
            dn_whitelist: Allowed DN patterns for enrollment filtering.
            enroll_authorized_cas: CA names authorized for initial enrollment
                (x509 mode).
            renewal_authorized_cas: CA names authorized for renewal (x509
                mode). CAs must have trustedForClientAuthentication=true.
            password_policy: Password policy name for challenge-based auth.
            validation_ruleset: dict (ValidationRuleset shape) — required
                when authorization_mode is 'auto-validation'.
        {_COMMON_PARAMS_DOC}
        {_CREATE_WORKFLOW_DOC}
        """)
    async def create_est_profile(
        name: str,
        pki_connector: str,
        certificate_template: dict,
        authorization_levels: dict,
        authorization_mode: str = "authorized",
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool = True,
        crypto_policy: dict | None = None,
        self_permissions: dict | None = None,
        requests_policy: dict | None = None,
        triggers: dict | None = None,
        grading_policies: list[str] | None = None,
        ds_flow: list[dict] | None = None,
        max_cert_per_holder_policy: dict | None = None,
        renewal_period: int | None = None,
        pqc_allowed: bool = False,
        third_party_discovery_sync: bool = False,
        dn_whitelist: list[str] | None = None,
        enroll_authorized_cas: list[str] | None = None,
        renewal_authorized_cas: list[str] | None = None,
        password_policy: str | None = None,
        validation_ruleset: dict | None = None,
    ) -> str:
        payload = _build_profile_payload(
            module="est",
            name=name,
            display_name=display_name,
            description=description,
            enabled=enabled,
            pki_connector=pki_connector,
            certificate_template=certificate_template,
            authorization_levels=authorization_levels,
            crypto_policy=crypto_policy,
            self_permissions=self_permissions,
            requests_policy=requests_policy,
            triggers=triggers,
            grading_policies=grading_policies,
            ds_flow=ds_flow,
            max_cert_per_holder_policy=max_cert_per_holder_policy,
            renewal_period=renewal_period,
            pqc_allowed=pqc_allowed,
            third_party_discovery_sync=third_party_discovery_sync,
            authorizationMode=authorization_mode,
            dnWhitelist=dn_whitelist,
            enrollAuthorizedCas=enroll_authorized_cas,
            renewalAuthorizedCas=renewal_authorized_cas,
            passwordPolicy=password_policy,
            validationRuleset=validation_ruleset,
        )
        return await _do_create(payload)

    # ===================================================================
    # 11. update_est_profile (mutating-destructive)
    # ===================================================================

    @mcp.tool()
    @_with_doc(        f"""Update an existing EST certificate profile.

        Safety tier: mutating-destructive (behavior-changing)
        Knowledge: horizon://knowledge/profiles

        Uses GET->strip->merge->PUT to safely update. Only provided
        parameters are changed; omitted parameters preserve their current
        values. Use clear_fields to explicitly null optional fields.

        For EST renewal, CAs used must have trustedForClientAuthentication=true.

        EST-specific parameters:
            authorization_mode: 'authorized', 'x509', 'challenge', or
                'auto-validation'.
            dn_whitelist: Allowed DN patterns for enrollment filtering.
            enroll_authorized_cas: CA names authorized for initial enrollment.
            renewal_authorized_cas: CA names authorized for renewal. CAs must
                have trustedForClientAuthentication=true.
            password_policy: Password policy name for challenge-based auth.
            validation_ruleset: dict (ValidationRuleset shape).
        {_COMMON_PARAMS_DOC}
        {_UPDATE_EXTRA_DOC}
        """)
    async def update_est_profile(
        name: str,
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool | None = None,
        pki_connector: str | None = None,
        certificate_template: dict | None = None,
        authorization_levels: dict | None = None,
        crypto_policy: dict | None = None,
        self_permissions: dict | None = None,
        requests_policy: dict | None = None,
        triggers: dict | None = None,
        grading_policies: list[str] | None = None,
        ds_flow: list[dict] | None = None,
        max_cert_per_holder_policy: dict | None = None,
        renewal_period: int | None = None,
        pqc_allowed: bool | None = None,
        third_party_discovery_sync: bool | None = None,
        authorization_mode: str | None = None,
        dn_whitelist: list[str] | None = None,
        enroll_authorized_cas: list[str] | None = None,
        renewal_authorized_cas: list[str] | None = None,
        password_policy: str | None = None,
        validation_ruleset: dict | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        overrides = _build_update_overrides(
            display_name=display_name,
            description=description,
            enabled=enabled,
            pki_connector=pki_connector,
            certificate_template=certificate_template,
            authorization_levels=authorization_levels,
            crypto_policy=crypto_policy,
            self_permissions=self_permissions,
            requests_policy=requests_policy,
            triggers=triggers,
            grading_policies=grading_policies,
            ds_flow=ds_flow,
            max_cert_per_holder_policy=max_cert_per_holder_policy,
            renewal_period=renewal_period,
            pqc_allowed=pqc_allowed,
            third_party_discovery_sync=third_party_discovery_sync,
            authorizationMode=authorization_mode,
            dnWhitelist=dn_whitelist,
            enrollAuthorizedCas=enroll_authorized_cas,
            renewalAuthorizedCas=renewal_authorized_cas,
            passwordPolicy=password_policy,
            validationRuleset=validation_ruleset,
        )
        return await _do_update(name, overrides, clear_fields)

    # ===================================================================
    # 12. create_monitored_profile (mutating-safe)
    # ===================================================================

    @mcp.tool()
    @_with_doc(        f"""Create a Monitored certificate profile.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/profiles

        Monitored profiles are read-only / import-only. They do NOT connect
        to a PKI connector and have a limited lifecycle (no enrollment, only
        import and discovery). Use MonitoredCryptoPolicy (only
        authorized_key_types) instead of ManagedCryptoPolicy.

        Monitored-specific notes:
            - No pki_connector (monitored profiles are not PKI-connected).
            - crypto_policy uses MonitoredCryptoPolicy shape (only
              authorized_key_types, no escrow/PKCS#12 settings).
            - No renewal_period (lifecycle is read-only).
        {_COMMON_PARAMS_DOC}
        {_CREATE_WORKFLOW_DOC}
        """)
    async def create_monitored_profile(
        name: str,
        certificate_template: dict,
        authorization_levels: dict,
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool = True,
        crypto_policy: dict | None = None,
        self_permissions: dict | None = None,
        requests_policy: dict | None = None,
        triggers: dict | None = None,
        grading_policies: list[str] | None = None,
        ds_flow: list[dict] | None = None,
        max_cert_per_holder_policy: dict | None = None,
        pqc_allowed: bool = False,
        third_party_discovery_sync: bool = False,
    ) -> str:
        # Monitored profiles have no pki_connector and no renewal_period.
        # Build payload manually to exclude those fields entirely.
        payload: dict[str, Any] = {
            "module": "monitored",
            "name": name,
            "enabled": enabled,
            "pqcAllowed": pqc_allowed,
            "thirdPartyDiscoverySync": third_party_discovery_sync,
        }

        _set_if_not_none(payload, "displayName", display_name)
        _set_if_not_none(payload, "description", description)
        _set_if_not_none(payload, "certificateTemplate", certificate_template)
        _set_if_not_none(payload, "authorizationLevels", authorization_levels)
        _set_if_not_none(payload, "cryptoPolicy", crypto_policy)
        _set_if_not_none(payload, "selfPermissions", self_permissions)
        _set_if_not_none(payload, "requestsPolicy", requests_policy)
        _set_if_not_none(payload, "triggerHooks", triggers)
        _set_if_not_none(payload, "gradingPolicies", grading_policies)
        _set_if_not_none(payload, "dsFlow", ds_flow)
        _set_if_not_none(payload, "maxCertificatePerHolderPolicy", max_cert_per_holder_policy)

        return await _do_create(payload)

    # ===================================================================
    # 13. update_monitored_profile (mutating-destructive)
    # ===================================================================

    @mcp.tool()
    @_with_doc(        f"""Update an existing Monitored certificate profile.

        Safety tier: mutating-destructive (behavior-changing)
        Knowledge: horizon://knowledge/profiles

        Uses GET->strip->merge->PUT to safely update. Only provided
        parameters are changed; omitted parameters preserve their current
        values. Use clear_fields to explicitly null optional fields.

        Monitored-specific notes:
            - No pki_connector (monitored profiles are not PKI-connected).
            - crypto_policy uses MonitoredCryptoPolicy shape (only
              authorized_key_types).
            - No renewal_period (lifecycle is read-only).
        {_COMMON_PARAMS_DOC}
        {_UPDATE_EXTRA_DOC}
        """)
    async def update_monitored_profile(
        name: str,
        display_name: str | None = None,
        description: str | None = None,
        enabled: bool | None = None,
        certificate_template: dict | None = None,
        authorization_levels: dict | None = None,
        crypto_policy: dict | None = None,
        self_permissions: dict | None = None,
        requests_policy: dict | None = None,
        triggers: dict | None = None,
        grading_policies: list[str] | None = None,
        ds_flow: list[dict] | None = None,
        max_cert_per_holder_policy: dict | None = None,
        pqc_allowed: bool | None = None,
        third_party_discovery_sync: bool | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        # Monitored overrides: no pki_connector, no renewal_period
        overrides: dict[str, Any] = {}

        _set_if_not_none(overrides, "displayName", display_name)
        _set_if_not_none(overrides, "description", description)
        _set_if_not_none(overrides, "enabled", enabled)
        _set_if_not_none(overrides, "pqcAllowed", pqc_allowed)
        _set_if_not_none(overrides, "thirdPartyDiscoverySync", third_party_discovery_sync)
        _set_if_not_none(overrides, "certificateTemplate", certificate_template)
        _set_if_not_none(overrides, "authorizationLevels", authorization_levels)
        _set_if_not_none(overrides, "cryptoPolicy", crypto_policy)
        _set_if_not_none(overrides, "selfPermissions", self_permissions)
        _set_if_not_none(overrides, "requestsPolicy", requests_policy)
        _set_if_not_none(overrides, "triggerHooks", triggers)
        _set_if_not_none(overrides, "gradingPolicies", grading_policies)
        _set_if_not_none(overrides, "dsFlow", ds_flow)
        _set_if_not_none(overrides, "maxCertificatePerHolderPolicy", max_cert_per_holder_policy)

        return await _do_update(name, overrides, clear_fields)
