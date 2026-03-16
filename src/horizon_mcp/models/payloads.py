"""Update payload infrastructure: GET response → PUT/PATCH payload conversion.

Bridges the gap between what the API returns (server-populated fields included)
and what it accepts on writes (those fields stripped).  Also provides best-effort
dependency validation before mutating calls hit the wire.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.client.errors import HorizonError

if TYPE_CHECKING:
    from horizon_mcp.client.http import HorizonClient

logger = logging.getLogger("horizon_mcp.payloads")


# ---------------------------------------------------------------------------
# STRIP_FIELDS — server-populated fields to remove per domain
# ---------------------------------------------------------------------------
# Discovered empirically: these fields cause 400/422 errors when echoed back
# in PUT payloads.  Keyed by domain name (lowercase, underscore-separated).

STRIP_FIELDS: dict[str, frozenset[str]] = {
    "profile": frozenset({
        "_id", "id", "createdAt", "updatedAt", "lastModifiedBy",
        "statistics", "status", "certificateCount",
    }),
    "ca": frozenset({
        "_id", "id", "createdAt", "updatedAt",
        "certificate", "crlCache", "statistics",
    }),
    "connector": frozenset({
        "_id", "id", "createdAt", "updatedAt", "status", "lastSync",
    }),
    "trigger": frozenset({
        "_id", "id", "createdAt", "updatedAt", "lastRun", "statistics",
    }),
    "label": frozenset({
        "_id", "id", "createdAt", "updatedAt",
    }),
    "proxy": frozenset({
        "_id", "id", "createdAt", "updatedAt",
    }),
    "datasource": frozenset({
        "_id", "id", "createdAt", "updatedAt", "lastTest",
    }),
    "role": frozenset({
        "_id", "id", "createdAt", "updatedAt",
    }),
    "team": frozenset({
        "_id", "id", "createdAt", "updatedAt", "statistics", "memberCount",
    }),
    "idp": frozenset({
        "_id", "id", "createdAt", "updatedAt",
    }),
    "grading_policy": frozenset({
        "_id", "id", "createdAt", "updatedAt",
    }),
    "grading_ruleset": frozenset({
        "_id", "id", "createdAt", "updatedAt",
    }),
    "password_policy": frozenset({
        "_id", "id", "createdAt", "updatedAt",
    }),
    "principal": frozenset({
        "_id", "id", "createdAt", "updatedAt", "lastLogin",
    }),
    # --- v1.1 domains ---
    # Verified against Scala source: these domains only ignoreField("_id").
    # They lack id/createdAt/updatedAt fields (unlike v1 domains).
    "discovery_campaign": frozenset({"_id"}),
    "automation_policy": frozenset({"_id"}),
    "execution_policy": frozenset({"_id"}),
    "wcce_forest": frozenset({"_id"}),
    # local_identity has server-managed hash/reset fields beyond _id
    "local_identity": frozenset({
        "_id", "hash", "resetUUID", "resetExpiration",
    }),
    # scheduled_task: only _id is stripped; server-populated fields
    # (status, lastExecutionDate, etc.) are preserved on GET→PUT to
    # avoid overwriting execution state.
    "scheduled_task": frozenset({"_id"}),
}

# Baseline fields shared by every domain — makes future domains safer
_BASELINE_STRIP = frozenset({"_id", "id", "createdAt", "updatedAt"})

# ---------------------------------------------------------------------------
# Maximum preflight API calls per invocation
# ---------------------------------------------------------------------------
_MAX_PREFLIGHT_CALLS = 5


# ---------------------------------------------------------------------------
# to_update_payload — merge logic
# ---------------------------------------------------------------------------

def to_update_payload(
    response: dict[str, Any],
    *,
    overrides: dict[str, Any] | None = None,
    clear_fields: list[str] | None = None,
    domain: str = "profile",
) -> dict[str, Any]:
    """Convert a GET response into a clean PUT/PATCH payload.

    Merge logic (applied in order):
        1. Shallow-copy the GET response dict.
        2. Strip server-populated fields for the given *domain*.
        3. For each field in *clear_fields*: set ``payload[field] = None``
           (top-level only in v1).
        4. For each key/value in *overrides*: if the value is not ``None``,
           set ``payload[key] = value``.
        5. Return the cleaned payload.

    Args:
        response: Raw dict from a GET endpoint.
        overrides: Fields to set on the payload.  ``None`` values are
            skipped (use *clear_fields* to explicitly null a field).
        clear_fields: Top-level field names to set to ``None``.
        domain: Domain key into :data:`STRIP_FIELDS`.  Falls back to
            the baseline strip set for unknown domains.

    Returns:
        A new dict safe to send as a PUT/PATCH body.
    """
    strip = STRIP_FIELDS.get(domain, _BASELINE_STRIP)
    payload = {k: v for k, v in response.items() if k not in strip}

    for field in clear_fields or []:
        payload[field] = None

    for key, value in (overrides or {}).items():
        if value is not None:
            payload[key] = value

    return payload


# ---------------------------------------------------------------------------
# _preflight_deps — best-effort dependency validation
# ---------------------------------------------------------------------------

# Priority order for dependency checks (highest first).
# Each entry: (payload_key, extractor, endpoint_template, error_hint)
# extractor: callable that takes the payload value and returns a list of
#            (name_or_id, api_path) tuples to check.

def _extract_pki_connector(value: Any) -> list[tuple[str, str]]:
    """Extract PKI connector name from payload field."""
    if isinstance(value, str) and value:
        return [(value, f"/api/v1/pki/connectors/{value}")]
    return []


def _extract_credential(value: Any) -> list[tuple[str, str]]:
    """Extract credential name(s) from a string or list."""
    names: list[str] = []
    if isinstance(value, str) and value:
        names.append(value)
    elif isinstance(value, list):
        names.extend(n for n in value if isinstance(n, str) and n)
    return [(n, f"/api/v1/security/credentials/{n}") for n in names]


def _extract_triggers_from_hooks(value: Any) -> list[tuple[str, str]]:
    """Collect unique trigger names from a TriggerHooks-shaped dict.

    Handles both sync hooks (list[str]) and async hooks
    (list[dict] with a ``name`` key).
    """
    if not isinstance(value, dict):
        return []

    names: set[str] = set()
    for hook_list in value.values():
        if not isinstance(hook_list, list):
            continue
        for entry in hook_list:
            if isinstance(entry, str) and entry:
                names.add(entry)
            elif isinstance(entry, dict) and isinstance(entry.get("name"), str):
                names.add(entry["name"])

    return [(n, f"/api/v1/triggers/{n}") for n in sorted(names)]


def _extract_grading_policies(value: Any) -> list[tuple[str, str]]:
    """Extract grading policy name(s)."""
    names: list[str] = []
    if isinstance(value, str) and value:
        names.append(value)
    elif isinstance(value, list):
        names.extend(n for n in value if isinstance(n, str) and n)
    return [(n, f"/api/v1/certificate/grading/policies/{n}") for n in names]


def _extract_datasource_flow(value: Any) -> list[tuple[str, str]]:
    """Extract datasource names from a dsFlow list.

    The actual field name in DataSourceFlowEntry is ``ds`` (not ``datasource``).
    We check both for backward compatibility.
    """
    if not isinstance(value, list):
        return []
    names: list[str] = []
    for entry in value:
        if isinstance(entry, dict):
            ds = entry.get("ds") or entry.get("datasource")
            if isinstance(ds, str) and ds:
                names.append(ds)
    return [(n, f"/api/v1/datasources/{n}") for n in names]


def _extract_identity_provider(value: Any) -> list[tuple[str, str]]:
    """Extract identity provider name(s)."""
    names: list[str] = []
    if isinstance(value, str) and value:
        names.append(value)
    elif isinstance(value, list):
        names.extend(n for n in value if isinstance(n, str) and n)
    return [(n, f"/api/v1/security/identity/providers/{n}") for n in names]


# Ordered by priority: credentials → PKI connectors/CAs → triggers
# → datasources/labels → IDPs.
_DEP_CHECKS: list[tuple[str, Any, str]] = [
    # (payload_key, extractor_fn, missing_hint)
    ("credential", _extract_credential,
     "Credentials must be created outside this MCP server."),
    ("credentials", _extract_credential,
     "Credentials must be created outside this MCP server."),
    ("pkiConnector", _extract_pki_connector,
     "Create the PKI connector first via the connector management tools."),
    ("triggerHooks", _extract_triggers_from_hooks,
     "Create the referenced trigger first."),
    ("gradingPolicies", _extract_grading_policies,
     "Create the grading policy first."),
    ("gradingPolicy", _extract_grading_policies,
     "Create the grading policy first."),
    ("dsFlow", _extract_datasource_flow,
     "Create the referenced datasource first."),
    ("identityProvider", _extract_identity_provider,
     "Create the identity provider first."),
    ("identityProviders", _extract_identity_provider,
     "Create the identity provider first."),
]


async def _check_one(
    client: HorizonClient,
    name: str,
    path: str,
    hint: str,
) -> str | None:
    """Check a single dependency. Returns a warning string or raises on hard error.

    - 404 → hard error (dependency missing, cannot proceed).
    - 2xx → ``None`` (exists and presumably compatible).
    - Other error → warning string (never blocks).
    """
    try:
        await client.get(path)
    except HorizonError as exc:
        if exc.status_code == 404:
            raise HorizonError(
                status_code=422,
                error_code="PREFLIGHT-DEP",
                message=f"Dependency not found: '{name}' (checked {path}).",
                remediation=hint,
            ) from exc
        # Any other API error is a non-blocking warning
        return (
            f"Could not verify dependency '{name}' "
            f"({exc.status_code}): {exc.message}"
        )
    except Exception as exc:  # noqa: BLE001
        return f"Could not verify dependency '{name}': {exc}"
    return None


async def _preflight_deps(
    client: HorizonClient,
    payload: dict[str, Any],
    domain: str,
) -> list[str]:
    """Best-effort dependency validation before a mutating API call.

    Checks objects **explicitly referenced in the current payload** only.
    Uses :func:`asyncio.gather` for concurrent checks, capped at
    :data:`_MAX_PREFLIGHT_CALLS` API calls per invocation.

    Priority order (highest first):
        credentials → PKI connectors/CAs → triggers →
        datasources/labels → IDPs

    Returns:
        A list of warning strings (may be empty).  Hard errors
        (missing dependencies) are raised as :class:`HorizonError`.

    Raises:
        HorizonError: If a referenced dependency does not exist (404).
    """
    # Collect all (name, path, hint) tuples in priority order
    checks: list[tuple[str, str, str]] = []
    for key, extractor, hint in _DEP_CHECKS:
        value = payload.get(key)
        if value is None:
            continue
        for name, path in extractor(value):
            checks.append((name, path, hint))
            if len(checks) >= _MAX_PREFLIGHT_CALLS:
                break
        if len(checks) >= _MAX_PREFLIGHT_CALLS:
            break

    if not checks:
        return []

    logger.debug(
        "Preflight: %d dependency check(s) for domain '%s'",
        len(checks), domain,
    )

    results = await asyncio.gather(
        *(_check_one(client, name, path, hint) for name, path, hint in checks),
        return_exceptions=True,
    )

    warnings: list[str] = []
    for result in results:
        if isinstance(result, HorizonError):
            raise result
        if isinstance(result, Exception):
            warnings.append(f"Preflight check failed unexpectedly: {result}")
        elif isinstance(result, str):
            warnings.append(result)

    return warnings


__all__ = [
    "STRIP_FIELDS",
    "to_update_payload",
    "_preflight_deps",
]
