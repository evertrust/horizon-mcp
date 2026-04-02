"""REST notification and trigger management tools for Horizon MCP Server.

6 tools covering the trigger lifecycle for custom REST connectors:
  - list_credentials: list stored credentials (names/types, no secrets)
  - list_triggers: list all triggers with optional type/name filtering
  - get_trigger: fetch a single trigger by name
  - create_rest_notification: create a REST notification with multi-step sequences
  - delete_trigger: delete with safety echo
  - simulate_trigger: test-fire a trigger without real certificate context

Knowledge resources:
    - horizon://knowledge/rest-notifications (REST API schema, chaining, examples)
    - horizon://knowledge/automation (trigger types, events, profile attachment)
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.client.state import get_client
from horizon_mcp.tools._helpers import (
    apply_name_filter,
    build_list_response,
    build_mutate_response,
    delete_guard,
)

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.triggers")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TRIGGER_BASE = "/api/v1/triggers"
_MAX_LIST_ITEMS = 50

_VALID_TRIGGER_TYPES = frozenset({
    "email", "rest", "webhook",
    "akv", "aws", "f5client", "f5as3", "intunepkcs", "ldappub", "gcm",
})
_VALID_NOTIFICATION_TYPES = frozenset({"email", "rest", "webhook"})
_VALID_AUTH_TYPES = frozenset({"noauth", "basic", "x509", "bearer", "custom"})
_VALID_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"})

_EVENTS_REQUIRING_RUN_PERIOD = frozenset({
    "on_expire", "on_pending_enroll", "on_pending_revoke", "on_pending_update",
    "on_pending_recover", "on_pending_migrate", "on_pending_renew",
    "on_pending_import", "on_license_expiration", "on_credentials_expiration",
})


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_trigger_type(trigger_type: str) -> str | None:
    if trigger_type not in _VALID_TRIGGER_TYPES:
        return json.dumps({
            "error": f"Invalid trigger type '{trigger_type}'.",
            "valid_types": sorted(_VALID_TRIGGER_TYPES),
        })
    return None


def _validate_event(event: str) -> str | None:
    """Basic validation - Horizon will enforce exact validity on the server."""
    if not event.startswith("on_"):
        return json.dumps({
            "error": f"Invalid event '{event}'. Events must start with 'on_'.",
            "hint": "Examples: on_enroll, on_revoke, on_renew, on_expire, on_submit_enroll",
        })
    return None


def _validate_sequence_step(step: dict[str, Any], index: int) -> str | None:
    """Validate a single sequence step. Returns error JSON or None."""
    if "url" not in step:
        return json.dumps({
            "error": f"Sequence step {index + 1}: 'url' is required.",
        })
    method = step.get("method", "")
    if method.upper() not in _VALID_METHODS:
        return json.dumps({
            "error": f"Sequence step {index + 1}: invalid method '{method}'.",
            "valid_methods": sorted(_VALID_METHODS),
        })
    auth = step.get("authenticationType", "noauth")
    if auth not in _VALID_AUTH_TYPES:
        return json.dumps({
            "error": f"Sequence step {index + 1}: invalid authenticationType '{auth}'.",
            "valid_types": sorted(_VALID_AUTH_TYPES),
        })
    if auth != "noauth" and not step.get("credentials"):
        return json.dumps({
            "error": (
                f"Sequence step {index + 1}: 'credentials' is required "
                f"when authenticationType is '{auth}'."
            ),
        })
    if not step.get("expectedHttpCodes"):
        return json.dumps({
            "error": f"Sequence step {index + 1}: 'expectedHttpCodes' must contain at least one HTTP status code.",
            "hint": "Common values: [200], [200, 201], [200, 201, 204].",
        })
    return None


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

_CRED_BASE = "/api/v1/security/credentials"
_MAX_CRED_ITEMS = 50


def register_trigger_tools(mcp: FastMCP) -> None:
    """Register all 6 trigger management tools on *mcp*."""

    # ===================================================================
    # Credentials (1 tool - read-only)
    # ===================================================================

    @mcp.tool()
    async def list_credentials(
        max_items: int = _MAX_CRED_ITEMS,
        name_contains: str | None = None,
        credential_type: str | None = None,
    ) -> str:
        """List stored credentials (names and types only - secrets are never exposed).

        Safety tier: read-only
        Knowledge: horizon://knowledge/rest-notifications

        Credentials are referenced by name in REST notification steps and
        datasource configurations. Use this tool to discover available credential
        names before creating a REST notification that requires authentication.

        Note: Secret values (passwords, API tokens, private keys) are NEVER
        returned by this tool. Only the credential name, type, description,
        and expiration date are shown.

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on credential name.
            credential_type: Filter by type: "password" (login/password),
                             "raw" (API token), or "x509" (client certificate).

        Returns:
            JSON with items, count, total_available, and truncated flag.

        See also: create_rest_notification (uses credentials for authentication),
            create_rest_datasource (uses credentials for API auth).
        """
        valid_types = frozenset({"password", "raw", "x509"})
        if credential_type is not None and credential_type not in valid_types:
            return json.dumps({
                "error": f"Invalid credential type '{credential_type}'.",
                "valid_types": sorted(valid_types),
            })

        client = get_client()
        data = await client.get(_CRED_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )

        if credential_type is not None:
            items = [it for it in items if it.get("type") == credential_type]

        items = apply_name_filter(items, name_contains)

        # Strip secret values from response - only expose metadata
        safe_items = []
        for item in items:
            safe = {
                k: v for k, v in item.items()
                if k not in ("password", "secret", "store", "login")
            }
            safe_items.append(safe)

        return build_list_response(safe_items, max_items, kind="credential")

    # ===================================================================
    # Read-only (2 tools)
    # ===================================================================

    @mcp.tool()
    async def list_triggers(
        max_items: int = _MAX_LIST_ITEMS,
        name_contains: str | None = None,
        trigger_type: str | None = None,
    ) -> str:
        """List triggers (notifications and third-party connectors) with optional filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/rest-notifications, horizon://knowledge/automation

        Returns all configured triggers. Use trigger_type="rest" to list only
        REST notifications (custom connectors).

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on trigger name.
            trigger_type: Filter by type: "rest", "email", "webhook", "akv",
                          "aws", "f5client", "f5as3", "intunepkcs", "ldappub", "gcm".

        Returns:
            JSON with items, count, total_available, and truncated flag.

        See also: get_trigger (inspect one), create_rest_notification (create new),
            simulate_trigger (test-fire), delete_trigger (remove).
        """
        if trigger_type is not None:
            err = _validate_trigger_type(trigger_type)
            if err is not None:
                return err

        client = get_client()
        data = await client.get(_TRIGGER_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )

        if trigger_type is not None:
            items = [it for it in items if it.get("type") == trigger_type]

        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="trigger")

    @mcp.tool()
    async def get_trigger(name: str) -> str:
        """Get a single trigger by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/rest-notifications, horizon://knowledge/automation

        Returns the full trigger configuration including sequence steps,
        authentication, headers, and payload templates for REST notifications.

        Args:
            name: Exact trigger name.

        Returns:
            JSON representation of the trigger.

        See also: list_triggers (browse all), create_rest_notification (create new),
            simulate_trigger (test-fire), delete_trigger (remove).
        """
        client = get_client()
        result = await client.get(f"{_TRIGGER_BASE}/{name}")
        return json.dumps(result)

    # ===================================================================
    # Create (1 tool)
    # ===================================================================

    @mcp.tool()
    async def create_rest_notification(
        name: str,
        event: str,
        sequence: list[dict[str, Any]],
        retries: int = 10,
        run_period: str | None = None,
        run_on_renewed: bool | None = None,
        licence_usage_percent: int | None = None,
        on_trigger_error: list[str] | None = None,
    ) -> str:
        """STOP - This tool modifies data. You MUST ask the user for explicit
        confirmation before calling this tool. Do not proceed without a clear
        "yes" from the user. Present what you intend to do and wait.

        Create a REST notification for custom certificate deployment or integration.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/rest-notifications

        REST notifications execute a sequence of HTTP requests when a certificate
        lifecycle event occurs. Each step can reference template variables from the
        certificate/request dictionary and from previous steps' responses.

        IMPORTANT: Trigger names are IMMUTABLE after creation. Always ask the
        user for the name before creating.

        Each step in the sequence is a dict with these fields:
            - url (required): Target URL - supports {{variable}} template strings
            - method (required): HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD)
            - authenticationType (required): "noauth", "basic", "bearer", "x509", or "custom"
            - credentials (required unless noauth): Name of credential in Horizon
            - expectedHttpCodes (required): List of HTTP codes meaning success (e.g., [200, 201])
            - timeout (required): Duration string (e.g., "30 seconds")
            - headers: List of {name, value} dicts - values support {{variable}} templates
            - payloadType: "json", "text", or "none"
            - payload: Request body - supports {{variable}} template strings
            - proxy: Name of HTTP proxy in Horizon

        Template variables available in URL, headers, and payload:
            - Certificate: {{certificate.pem}}, {{certificate.serial}}, {{certificate.subject.cn.1}},
              {{certificate.san.dnsname.1}}, {{certificate.thumbprint}}, {{certificate.private_key}}, etc.
            - Request: {{request.id}}, {{request.workflow}}, {{request.requester}}, etc.
            - Previous cert (on_renew only): {{previous.certificate.serial}}, etc.
            - Credentials (custom auth): {{credentials.key}}, {{credentials.login}}, {{credentials.password}}
            - Response chaining: {{rest.response.1.field}}, {{rest.response.2.field.nested}}, etc.
            - Computation rules: {{Upper({{certificate.subject.cn.1}})}}, {{Base64(Raw({{certificate.pem}}))}}, etc.

        See horizon://knowledge/rest-notifications for the complete dictionary reference
        and multi-step chaining patterns.

        Args:
            name: Unique trigger name (immutable primary key).
            event: Single lifecycle event to subscribe to.
                   Examples: "on_enroll", "on_revoke", "on_renew", "on_expire",
                   "on_submit_enroll", "on_approve_revoke", etc.
            sequence: Ordered list of REST call steps (see field reference above).
                      Steps execute sequentially - each must succeed before the next runs.
                      Response data from step N is available to step N+1 via
                      {{rest.response.N.field}} template variables.
            retries: Retry count on failure with exponential backoff (default 10).
            run_period: Duration for periodic events (e.g., "30 days", "24h").
                        MANDATORY for on_expire, on_pending_*, on_license_expiration,
                        on_credentials_expiration. FORBIDDEN for all other events.
            run_on_renewed: Whether to fire even if certificate was renewed.
                            MANDATORY for on_expire only. FORBIDDEN for all others.
            licence_usage_percent: Threshold 1-100 for on_license_usage.
                                   MANDATORY for on_license_usage. FORBIDDEN for all others.
            on_trigger_error: Names of triggers to fire if this notification fails.
                              Useful for alerting (e.g., send Slack message on failure).

        Returns:
            JSON with confirmation and created trigger data.

        Common patterns:
            - Single-step deployment: POST cert PEM + key to a target API
            - OAuth + deploy: Step 1 gets token, step 2 uses {{rest.response.1.access_token}}
            - Lookup + update: Step 1 finds resource ID, step 2 updates by ID
            - Create + activate: Step 1 creates resource, step 2 activates it

        After creating, attach the trigger to a profile using the Horizon UI or API
        to start receiving events. See horizon://knowledge/automation for attachment.

        See also: simulate_trigger (test before attaching to profile),
            list_triggers (verify creation), get_trigger (inspect config),
            delete_trigger (remove).
        """
        err = _validate_event(event)
        if err is not None:
            return err

        if not sequence:
            return json.dumps({
                "error": "sequence must contain at least one REST call step.",
                "hint": "See horizon://knowledge/rest-notifications for step format.",
            })

        for i, step in enumerate(sequence):
            err = _validate_sequence_step(step, i)
            if err is not None:
                return err

        if event in _EVENTS_REQUIRING_RUN_PERIOD and not run_period:
            return json.dumps({
                "error": f"run_period is MANDATORY for event '{event}'.",
                "hint": "Examples: '30 days', '24h', '7d'.",
            })

        if event == "on_expire" and run_on_renewed is None:
            return json.dumps({
                "error": "run_on_renewed is MANDATORY for event 'on_expire'.",
                "hint": "Set to true to fire even if the certificate was already renewed, false otherwise.",
            })

        if event == "on_license_usage" and licence_usage_percent is None:
            return json.dumps({
                "error": "licence_usage_percent is MANDATORY for event 'on_license_usage'.",
                "hint": "Integer between 1 and 100.",
            })

        payload: dict[str, Any] = {
            "name": name,
            "type": "rest",
            "events": [event],
            "retries": retries,
            "sequence": sequence,
        }
        if run_period is not None:
            payload["runPeriod"] = run_period
        if run_on_renewed is not None:
            payload["runOnRenewed"] = run_on_renewed
        if licence_usage_percent is not None:
            payload["licenceUsagePercent"] = licence_usage_percent
        if on_trigger_error is not None:
            payload["triggers"] = {"onTriggerError": on_trigger_error}

        client = get_client()
        result = await client.post(_TRIGGER_BASE, json=payload)
        return build_mutate_response(
            action="created", kind="trigger", name=name, data=result,
        )

    # ===================================================================
    # Delete (1 tool)
    # ===================================================================

    @mcp.tool()
    async def delete_trigger(name: str, expected_name: str) -> str:
        """STOP - This tool performs an IRREVERSIBLE destructive operation. You MUST
        ask the user for explicit confirmation before calling this tool. Do not
        proceed without a clear "yes" from the user. Present what will be
        permanently destroyed and wait.

        Delete a trigger. Requires name confirmation.

        A trigger should be detached from all profiles before deletion.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/rest-notifications, horizon://knowledge/automation

        Args:
            name: Trigger name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.

        See also: get_trigger (inspect before deleting),
            list_triggers (find trigger to delete).
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"{_TRIGGER_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "trigger",
        })

    # ===================================================================
    # Simulate (1 tool)
    # ===================================================================

    @mcp.tool()
    async def simulate_trigger(name: str) -> str:
        """Test-fire an existing trigger without real certificate context.

        Safety tier: read-only (executes the trigger but uses test context only)
        Knowledge: horizon://knowledge/rest-notifications

        Sends a PATCH request to simulate the trigger. The trigger must already
        exist. Horizon executes it with a synthetic test context and returns the
        execution result.

        Use this to verify that a REST notification's sequence steps, authentication,
        and URL/payload templates work correctly before attaching the trigger to a
        production profile.

        Note: Template variables like {{certificate.serial}} will not have real values
        during simulation - they are filled with test/placeholder data.

        Args:
            name: Name of the existing trigger to simulate.

        Returns:
            JSON with the simulation result including execution status and
            any error details.

        Typical workflow:
            1. Create a REST notification with create_rest_notification
            2. Call simulate_trigger to verify the HTTP calls succeed
            3. If simulation passes, attach the trigger to a profile
            4. If simulation fails, inspect errors, fix config, and retry

        See also: create_rest_notification (create before simulating),
            get_trigger (inspect current config).
        """
        client = get_client()
        result = await client.patch(_TRIGGER_BASE, json={"name": name})
        return json.dumps(result)
