"""Trigger management and profile-hook wiring tools for Horizon MCP Server.

8 tools covering the full trigger lifecycle (CRUD + simulate) plus the
attach/detach bridge between triggers and certificate profiles.

Knowledge resources:
    - horizon://knowledge/automation
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.models.enums import TriggerType
from horizon_mcp.models.payloads import to_update_payload
from horizon_mcp.tools._helpers import apply_name_filter, build_list_response, build_mutate_response, delete_guard

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.triggers")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TRIGGER_BASE = "/api/v1/triggers"
_PROFILE_BASE = "/api/v1/certificate/profiles"
_TRIGGER_TYPES = sorted(t.value for t in TriggerType)

# ---------------------------------------------------------------------------
# Hook auto-mapping tables
#
# A trigger's `events` list contains snake_case event names.  Each event
# maps to exactly one hook field on the profile's `triggerHooks` object.
#
# Sync hooks store trigger names as plain strings: list[str].
# Async hooks store trigger references as dicts:   list[{"name": str}].
# ---------------------------------------------------------------------------

# event_name -> (camelCase hook field, is_async)
_EVENT_TO_HOOK: dict[str, tuple[str, bool]] = {
    # Enroll
    "on_enroll":           ("onEnroll",         False),
    "on_pending_enroll":   ("onPendingEnroll",  True),
    "on_submit_enroll":    ("onSubmitEnroll",   False),
    "on_approve_enroll":   ("onApproveEnroll",  False),
    "on_deny_enroll":      ("onDenyEnroll",     False),
    "on_cancel_enroll":    ("onCancelEnroll",   False),
    # Revoke
    "on_revoke":           ("onRevoke",         False),
    "on_submit_revoke":    ("onSubmitRevoke",   False),
    "on_approve_revoke":   ("onApproveRevoke",  False),
    "on_deny_revoke":      ("onDenyRevoke",     False),
    "on_cancel_revoke":    ("onCancelRevoke",   False),
    # Update
    "on_update":           ("onUpdate",         False),
    "on_submit_update":    ("onSubmitUpdate",   False),
    "on_approve_update":   ("onApproveUpdate",  False),
    "on_deny_update":      ("onDenyUpdate",     False),
    "on_cancel_update":    ("onCancelUpdate",   False),
    # Recover
    "on_recover":          ("onRecover",        False),
    "on_submit_recover":   ("onSubmitRecover",  False),
    "on_approve_recover":  ("onApproveRecover", False),
    "on_deny_recover":     ("onDenyRecover",    False),
    "on_cancel_recover":   ("onCancelRecover",  False),
    # Migrate
    "on_migrate":          ("onMigrate",        False),
    "on_submit_migrate":   ("onSubmitMigrate",  False),
    "on_approve_migrate":  ("onApproveMigrate", False),
    "on_deny_migrate":     ("onDenyMigrate",    False),
    "on_cancel_migrate":   ("onCancelMigrate",  False),
    # Renew
    "on_renew":            ("onRenew",          False),
    "on_pending_renew":    ("onPendingRenew",   True),
    "on_submit_renew":     ("onSubmitRenew",    False),
    "on_approve_renew":    ("onApproveRenew",   False),
    "on_deny_renew":       ("onDenyRenew",      False),
    "on_cancel_renew":     ("onCancelRenew",    False),
    # Import
    "on_import":           ("onImport",         False),
    "on_submit_import":    ("onSubmitImport",   False),
    "on_approve_import":   ("onApproveImport",  False),
    "on_deny_import":      ("onDenyImport",     False),
    "on_cancel_import":    ("onCancelImport",   False),
    # Expire (always async)
    "on_expire":           ("onExpire",         True),
}

# All known hook field names for detach iteration
_ALL_HOOK_FIELDS: set[str] = {hook for hook, _ in _EVENT_TO_HOOK.values()}
# Subset that are async hooks
_ASYNC_HOOK_FIELDS: set[str] = {hook for hook, is_async in _EVENT_TO_HOOK.values() if is_async}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _trigger_name_in_sync_hook(hook_list: list[Any], trigger_name: str) -> bool:
    """Check if a trigger name already exists in a sync hook list."""
    return trigger_name in hook_list


def _trigger_name_in_async_hook(hook_list: list[Any], trigger_name: str) -> bool:
    """Check if a trigger name already exists in an async hook list."""
    return any(
        (isinstance(entry, dict) and entry.get("name") == trigger_name)
        or (isinstance(entry, str) and entry == trigger_name)
        for entry in hook_list
    )


def _remove_from_sync_hook(hook_list: list[Any], trigger_name: str) -> list[Any]:
    """Remove all occurrences of a trigger name from a sync hook list."""
    return [entry for entry in hook_list if entry != trigger_name]


def _remove_from_async_hook(hook_list: list[Any], trigger_name: str) -> list[Any]:
    """Remove all occurrences of a trigger name from an async hook list."""
    return [
        entry for entry in hook_list
        if not (
            (isinstance(entry, dict) and entry.get("name") == trigger_name)
            or (isinstance(entry, str) and entry == trigger_name)
        )
    ]


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_trigger_tools(mcp: FastMCP) -> None:
    """Register all 8 trigger management tools on *mcp*."""

    from horizon_mcp.client.state import get_client

    # ===================================================================
    # Core CRUD (5 tools)
    # ===================================================================

    @mcp.tool()
    async def list_triggers(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List notification triggers with optional name filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/automation

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on trigger name.

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        data = await client.get(_TRIGGER_BASE)
        items: list[dict[str, Any]] = data if isinstance(data, list) else data.get("items", [data])
        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="trigger")

    @mcp.tool()
    async def get_trigger(name: str) -> str:
        """Get a single trigger by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/automation

        Args:
            name: Exact trigger name.

        Returns:
            JSON representation of the trigger including its events and configuration.
        """
        client = get_client()
        result = await client.get(f"{_TRIGGER_BASE}/{name}")
        return json.dumps(result)

    @mcp.tool()
    async def create_trigger(
        name: str,
        type: str,
        events: list[str],
        configuration: dict,
        retries: int = 0,
        run_period: str | None = None,
        run_on_renewed: bool = False,
        description: str | None = None,
    ) -> str:
        """Create a new notification trigger.

        Safety tier: mutating-safe
        Prerequisites: If type is a third-party type (akv, aws, etc.), the matching
            third-party connector must exist first.
        See also: attach_trigger_to_profile (wire this trigger into a profile's hooks).
        Knowledge: horizon://knowledge/automation

        Supported types: 3 notification (email, rest, webhook) + 7 third-party
        (akv, aws, f5client, f5as3, intunepkcs, ldappub, gcm).

        Args:
            name: Unique trigger name.
            type: Trigger type — one of the 10 supported types.
            events: List of event names this trigger fires on
                (e.g., ["on_enroll", "on_expire"]).
            configuration: Type-specific configuration dict. Shape depends on type.
                EMAIL example: {"recipients": ["admin@example.com"], "subject": "Alert: {{certificate.dn}}", "body": "..."}.
                WEBHOOK example: {"url": "https://hooks.example.com/notify", "method": "POST", "headers": {"Authorization": "Bearer ..."}}.
                Use get_trigger on an existing trigger to see the full shape for a given type.
            retries: Number of retry attempts on failure (default 0).
            run_period: Optional cron-like period expression for scheduled runs.
            run_on_renewed: Whether to fire on certificate renewal (default false).
            description: Optional human-readable description.

        Returns:
            JSON representation of the created trigger.
        """
        if type not in _TRIGGER_TYPES:
            return json.dumps({
                "error": f"Invalid trigger type '{type}'.",
                "valid_types": _TRIGGER_TYPES,
            })

        # Validate event names
        unknown_events = [e for e in events if e not in _EVENT_TO_HOOK]
        if unknown_events:
            return json.dumps({
                "error": f"Unknown event(s): {unknown_events}.",
                "valid_events": sorted(_EVENT_TO_HOOK.keys()),
            })

        client = get_client()

        payload: dict[str, Any] = {
            "name": name,
            "type": type,
            "events": events,
            "configuration": configuration,
            "retries": retries,
            "runOnRenewed": run_on_renewed,
        }
        if run_period is not None:
            payload["runPeriod"] = run_period
        if description is not None:
            payload["description"] = description

        result = await client.post(_TRIGGER_BASE, json=payload)
        return build_mutate_response(action="created", kind="trigger", name=name, data=result)

    @mcp.tool()
    async def update_trigger(
        name: str,
        events: list[str] | None = None,
        configuration: dict | None = None,
        retries: int | None = None,
        run_period: str | None = None,
        run_on_renewed: bool | None = None,
        description: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an existing trigger (GET -> strip -> merge -> PUT).

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/automation

        Uses the GET-strip-merge-PUT pattern: fetches the current state,
        strips server-populated fields, merges your overrides, and PUTs
        the result back.

        Args:
            name: Trigger name to update.
            events: New list of event names (replaces existing).
            configuration: New configuration dict (replaces existing).
            retries: New retry count.
            run_period: New run period expression.
            run_on_renewed: Whether to fire on renewal.
            description: New description.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON representation of the updated trigger.
        """
        if events is not None:
            unknown_events = [e for e in events if e not in _EVENT_TO_HOOK]
            if unknown_events:
                return json.dumps({
                    "error": f"Unknown event(s): {unknown_events}.",
                    "valid_events": sorted(_EVENT_TO_HOOK.keys()),
                })

        client = get_client()
        current = await client.get(f"{_TRIGGER_BASE}/{name}")

        overrides: dict[str, Any] = {}
        if events is not None:
            overrides["events"] = events
        if configuration is not None:
            overrides["configuration"] = configuration
        if retries is not None:
            overrides["retries"] = retries
        if run_period is not None:
            overrides["runPeriod"] = run_period
        if run_on_renewed is not None:
            overrides["runOnRenewed"] = run_on_renewed
        if description is not None:
            overrides["description"] = description

        payload = to_update_payload(
            current,
            overrides=overrides,
            clear_fields=clear_fields,
            domain="trigger",
        )

        result = await client.put(f"{_TRIGGER_BASE}/", json=payload)
        return build_mutate_response(action="updated", kind="trigger", name=name, data=result)

    @mcp.tool()
    async def delete_trigger(name: str, expected_name: str) -> str:
        """Delete a trigger. Requires name confirmation.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/automation

        WARNING: Deleting a trigger will remove it from all profiles
        that reference it in their hook configuration.

        Args:
            name: Trigger name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
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
    async def simulate_trigger(
        name: str,
        dictionary: dict | None = None,
    ) -> str:
        """Simulate (test-fire) a trigger without affecting real certificates.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/automation

        Sends a test invocation to the trigger's configured endpoint
        (email server, webhook URL, or third-party connector) using
        an optional template variable dictionary.

        Args:
            name: Trigger name to simulate.
            dictionary: Optional dict of template variables to inject
                into the trigger's message/payload template.
                Example: {"certificate.dn": "CN=test.example.com", "certificate.notAfter": "2025-12-31"}.

        Returns:
            JSON result from the simulation endpoint.
        """
        client = get_client()
        payload: dict[str, Any] = {"name": name}
        if dictionary is not None:
            payload["dictionary"] = dictionary
        result = await client.patch(f"{_TRIGGER_BASE}/", json=payload)
        return json.dumps(result)

    # ===================================================================
    # Profile-hook wiring (2 tools)
    # ===================================================================

    @mcp.tool()
    async def attach_trigger_to_profile(
        profile_name: str,
        trigger_name: str,
    ) -> str:
        """Attach a trigger to a profile by wiring it into the correct hooks.

        Safety tier: mutating-safe
        Prerequisites: Both the trigger (create_trigger) and the profile
            (create_*_profile) must already exist.
        Knowledge: horizon://knowledge/automation, horizon://knowledge/automation

        Reads the trigger's events list, reads the profile, maps each event
        to the corresponding hook field on the profile's triggerHooks object,
        and PUTs the updated profile back.

        Auto-mapping rules:
        - Sync hooks (e.g., on_enroll -> onEnroll): trigger name appended
          as a plain string.
        - Async hooks (e.g., on_expire -> onExpire): trigger name appended
          as {"name": trigger_name} (no activationDate by default).

        Idempotent: if the trigger is already present in a hook, it is
        not added again.

        Args:
            profile_name: Name of the certificate profile to modify.
            trigger_name: Name of the trigger to attach.

        Returns:
            JSON summary of hooks modified and the updated profile.
        """
        client = get_client()

        # 1. Fetch the trigger to learn its events
        trigger = await client.get(f"{_TRIGGER_BASE}/{trigger_name}")
        events: list[str] = trigger.get("events", [])
        if not events:
            return json.dumps({
                "error": f"Trigger '{trigger_name}' has no events defined.",
                "hint": "Update the trigger to include at least one event before attaching.",
            })

        # Validate all events map to known hooks
        unmapped = [e for e in events if e not in _EVENT_TO_HOOK]
        if unmapped:
            return json.dumps({
                "error": f"Trigger has unknown event(s): {unmapped}.",
                "hint": "These events cannot be auto-mapped to profile hooks.",
            })

        # 2. Fetch the profile
        profile = await client.get(f"{_PROFILE_BASE}/{profile_name}")
        hooks: dict[str, Any] = profile.get("triggerHooks", {})

        # 3. Wire each event into the corresponding hook
        hooks_modified: list[str] = []

        for event in events:
            hook_field, is_async = _EVENT_TO_HOOK[event]
            hook_list: list[Any] = hooks.get(hook_field, [])

            if is_async:
                if not _trigger_name_in_async_hook(hook_list, trigger_name):
                    hook_list.append({"name": trigger_name})
                    hooks[hook_field] = hook_list
                    hooks_modified.append(hook_field)
            else:
                if not _trigger_name_in_sync_hook(hook_list, trigger_name):
                    hook_list.append(trigger_name)
                    hooks[hook_field] = hook_list
                    hooks_modified.append(hook_field)

        if not hooks_modified:
            return json.dumps({
                "message": (
                    f"Trigger '{trigger_name}' is already attached to all "
                    f"relevant hooks on profile '{profile_name}'."
                ),
                "hooks_modified": [],
            })

        # 4. PUT the updated profile
        profile["triggerHooks"] = hooks
        payload = to_update_payload(profile, domain="profile")

        result = await client.put(f"{_PROFILE_BASE}/", json=payload)
        return json.dumps({
            "message": (
                f"Attached trigger '{trigger_name}' to profile '{profile_name}'."
            ),
            "hooks_modified": hooks_modified,
            "profile": result,
        })

    @mcp.tool()
    async def detach_trigger_from_profile(
        profile_name: str,
        trigger_name: str,
    ) -> str:
        """Detach a trigger from a profile by removing it from all hooks.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/automation, horizon://knowledge/automation

        Reads the profile, iterates over every hook field in triggerHooks,
        removes any reference to the trigger (both sync string entries
        and async dict entries), and PUTs the cleaned profile back.

        Idempotent: if the trigger is not present in any hook, no
        modification is made.

        Args:
            profile_name: Name of the certificate profile to modify.
            trigger_name: Name of the trigger to detach.

        Returns:
            JSON summary of hooks modified and the updated profile.
        """
        client = get_client()

        # 1. Fetch the profile
        profile = await client.get(f"{_PROFILE_BASE}/{profile_name}")
        hooks: dict[str, Any] = profile.get("triggerHooks", {})

        # 2. Remove trigger from every hook field
        hooks_modified: list[str] = []

        for hook_field in _ALL_HOOK_FIELDS:
            hook_list: list[Any] = hooks.get(hook_field, [])
            if not hook_list:
                continue

            is_async = hook_field in _ASYNC_HOOK_FIELDS

            if is_async:
                if _trigger_name_in_async_hook(hook_list, trigger_name):
                    hooks[hook_field] = _remove_from_async_hook(hook_list, trigger_name)
                    hooks_modified.append(hook_field)
            else:
                if _trigger_name_in_sync_hook(hook_list, trigger_name):
                    hooks[hook_field] = _remove_from_sync_hook(hook_list, trigger_name)
                    hooks_modified.append(hook_field)

        if not hooks_modified:
            return json.dumps({
                "message": (
                    f"Trigger '{trigger_name}' was not found in any hook "
                    f"on profile '{profile_name}'. No changes made."
                ),
                "hooks_modified": [],
            })

        # 3. PUT the updated profile
        profile["triggerHooks"] = hooks
        payload = to_update_payload(profile, domain="profile")

        result = await client.put(f"{_PROFILE_BASE}/", json=payload)
        return json.dumps({
            "message": (
                f"Detached trigger '{trigger_name}' from profile '{profile_name}'."
            ),
            "hooks_modified": hooks_modified,
            "profile": result,
        })
