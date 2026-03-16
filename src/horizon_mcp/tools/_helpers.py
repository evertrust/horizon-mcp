"""Shared helpers extracted from proven v1 tool patterns.

Four functions covering identical boilerplate found in 4+ tool modules:
  - delete_guard: safety echo enforcement for destructive deletes
  - apply_name_filter: client-side case-insensitive substring filter
  - build_list_response: truncated list with metadata
  - get_strip_merge_put: GET→strip→merge→PUT update cycle

NOT a generic CRUD framework — literal extraction of code that already
exists in connectors.py, triggers.py, profiles.py, and security.py.
"""

from __future__ import annotations

import json
from typing import Any

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.state import get_client
from horizon_mcp.models.payloads import to_update_payload


def delete_guard(name: str, expected: str, *, label: str = "name") -> None:
    """Raise HorizonError(422, SAFETY-ECHO) if safety echo doesn't match.

    Extracted from ``_delete_guard()`` in security.py.
    """
    if name != expected:
        raise HorizonError(
            status_code=422,
            error_code="SAFETY-ECHO",
            message=(
                f"Safety check failed: expected_{label}='{expected}' "
                f"does not match {label}='{name}'."
            ),
            remediation=(
                f"Pass expected_{label} equal to {label} to confirm deletion."
            ),
        )


def apply_name_filter(
    items: list[dict[str, Any]], name_contains: str | None,
) -> list[dict[str, Any]]:
    """Client-side case-insensitive substring filter on item name.

    Extracted from ``_apply_name_filter()`` in connectors.py / triggers.py /
    profiles.py (identical code in all three).
    """
    if not name_contains:
        return items
    needle = name_contains.lower()
    return [item for item in items if needle in item.get("name", "").lower()]


def build_list_response(
    items: list[dict[str, Any]],
    max_items: int,
    *,
    kind: str,
) -> str:
    """Truncate items, build JSON with items/count/total_available/truncated/kind.

    Unified from ``_list_response()`` in connectors.py / triggers.py /
    profiles.py.  Returns a JSON string.
    """
    total = len(items)
    truncated = total > max_items
    items = items[:max_items]
    return json.dumps({
        "items": items,
        "count": len(items),
        "total_available": total,
        "truncated": truncated,
        "kind": kind,
    })


def build_mutate_response(
    *,
    action: str,
    kind: str,
    name: str,
    data: dict[str, Any] | None = None,
    warnings: list[str] | None = None,
) -> str:
    """Build standardized JSON for create/update mutations.

    Every mutating tool returns the same envelope so the LLM consumer
    can predict the response shape without per-tool learning:

        {"status": "created"|"updated", "kind": "...", "name": "...",
         "data": {...}, "warnings": [...]}
    """
    response: dict[str, Any] = {
        "status": action,
        "kind": kind,
        "name": name,
    }
    if data is not None:
        response["data"] = data
    if warnings:
        response["warnings"] = warnings
    return json.dumps(response, default=str)


async def get_strip_merge_put(
    get_path: str,
    put_path: str,
    domain: str,
    overrides: dict[str, Any],
    clear_fields: list[str] | None,
) -> dict[str, Any]:
    """GET current → to_update_payload() → PUT back.

    Extracted from ``_get_strip_merge_put()`` in security.py.
    """
    client = get_client()
    current = await client.get(get_path)
    payload = to_update_payload(
        current,
        overrides=overrides,
        clear_fields=clear_fields,
        domain=domain,
    )
    return await client.put(put_path, json=payload)
