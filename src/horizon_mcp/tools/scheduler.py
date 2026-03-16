"""Scheduled task management tools for Horizon MCP Server.

8 tools covering two task subtypes:
  - Shared (4): list, get, delete, run
  - ThirdParty tasks (2): create, update
  - Report tasks (2): create, update

ScheduledTask is a trait with completely different subtypes (thirdparty
and report).  Type-specific create/update tools enforce the correct
payload shape for each subtype rather than exposing a single generic
interface.

Knowledge resources:
    - horizon://knowledge/system-admin
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.state import get_client
from horizon_mcp.tools._helpers import (
    apply_name_filter,
    build_list_response,
    build_mutate_response,
    delete_guard,
    get_strip_merge_put,
)

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.scheduler")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BASE = "/api/v1/scheduler/tasks"

# Field-name mappings: Python snake_case -> Horizon API camelCase.
# Used by both report create and update to keep the mapping in one place.
_REPORT_FIELD_MAP: dict[str, str] = {
    "report_type": "reportType",
    "from_email": "from",
    "is_html": "isHtml",
    "hql_type": "hqlType",
    "hql_query": "hqlQuery",
    "hql_fields": "hqlFields",
    "hql_sorted_by": "hqlSortedBy",
    "file_name": "fileName",
    "compress_csv": "compressCsv",
    "retention_period": "retentionPeriod",
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _add_optional(payload: dict[str, Any], key: str, value: Any) -> None:
    """Set *key* on *payload* only when *value* is not ``None``."""
    if value is not None:
        payload[key] = value


def _apply_type_filter(
    items: list[dict[str, Any]], task_type: str | None,
) -> list[dict[str, Any]]:
    """Client-side filter on the 'type' field (case-insensitive).

    The server-side ``scheduledTaskType`` query parameter handles this in
    the happy path, but this provides a safety net in case the server
    returns unfiltered results.
    """
    if not task_type:
        return items
    needle = task_type.lower()
    return [item for item in items if item.get("type", "").lower() == needle]


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_scheduler_tools(mcp: FastMCP) -> None:
    """Register all 8 scheduled task tools on *mcp*."""

    # ===================================================================
    # Shared tools (4)
    # ===================================================================

    @mcp.tool()
    async def list_scheduled_tasks(
        max_items: int = 50,
        name_contains: str | None = None,
        task_type: str | None = None,
    ) -> str:
        """List scheduled tasks with optional name and type filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/system-admin

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on task name.
            task_type: Filter by task type — "thirdparty" or "report".

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        params: dict[str, str] = {}
        if task_type:
            params["scheduledTaskType"] = task_type
        data = await client.get(_BASE, params=params)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )
        items = apply_name_filter(items, name_contains)
        items = _apply_type_filter(items, task_type)
        return build_list_response(items, max_items, kind="scheduled_task")

    @mcp.tool()
    async def get_scheduled_task(name: str) -> str:
        """Get a single scheduled task by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/system-admin

        Args:
            name: Exact scheduled task name.

        Returns:
            JSON representation of the scheduled task including its
            type-specific configuration.
        """
        client = get_client()
        result = await client.get(f"{_BASE}/{name}")
        return json.dumps(result)

    @mcp.tool()
    async def delete_scheduled_task(name: str, expected_name: str) -> str:
        """Delete a scheduled task. Requires name confirmation.

        IMPORTANT: Before executing this operation, always confirm the action
        with the end-user first.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/system-admin

        WARNING: Deleting a scheduled task will permanently remove it
        and stop any future executions. This cannot be undone.

        Args:
            name: Scheduled task name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"{_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "scheduled_task",
        })

    @mcp.tool()
    async def run_scheduled_task(name: str) -> str:
        """Trigger immediate execution of a scheduled task.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/system-admin

        Fires the task once right now, outside of its normal cron
        schedule. The task's cron schedule is not affected.

        NOTE: This endpoint uses GET for a mutating operation (confirmed
        in Horizon source).

        Args:
            name: Exact scheduled task name to run.

        Returns:
            JSON result from the run endpoint.
        """
        client = get_client()
        result = await client.get(f"{_BASE}/{name}/run")
        return json.dumps(result)

    # ===================================================================
    # ThirdParty-specific tools (2)
    # ===================================================================

    @mcp.tool()
    async def create_thirdparty_task(
        name: str,
        cron: str,
        module: str,
        profile: str,
        connector: str,
        enroll: bool,
        revoke: bool,
        renew: bool,
        enabled: bool = True,
        description: str | None = None,
        dry_run: bool = False,
        host: str | None = None,
    ) -> str:
        """Create a new third-party scheduled task.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/system-admin

        Prerequisites: Profile (list_profiles), connector (list_thirdparty_connectors),
            and module must all exist in Horizon.
        See also: run_scheduled_task (trigger immediate execution),
            list_scheduled_tasks (verify the task was created).

        Third-party tasks periodically synchronize certificates with an
        external connector (enroll, revoke, and/or renew).

        Args:
            name: Unique scheduled task name.
            cron: Quartz cron expression defining the schedule.
            module: Horizon module to operate in.
            profile: Certificate profile name.
            connector: Third-party connector name.
            enroll: Whether to enroll new certificates.
            revoke: Whether to revoke certificates.
            renew: Whether to renew certificates.
            enabled: Whether the task is enabled (default true).
            description: Optional human-readable description.
            dry_run: If true, simulate without making changes (default false).
            host: Optional host override for task execution.

        Returns:
            JSON representation of the created scheduled task.
        """
        client = get_client()

        payload: dict[str, Any] = {
            "name": name,
            "type": "thirdparty",
            "cron": cron,
            "module": module,
            "profile": profile,
            "connector": connector,
            "enroll": enroll,
            "revoke": revoke,
            "renew": renew,
            "enabled": enabled,
            "dryRun": dry_run,
        }
        _add_optional(payload, "description", description)
        _add_optional(payload, "host", host)

        result = await client.post(_BASE, json=payload)
        return build_mutate_response(action="created", kind="thirdparty_task", name=name, data=result)

    @mcp.tool()
    async def update_thirdparty_task(
        name: str,
        cron: str | None = None,
        module: str | None = None,
        profile: str | None = None,
        connector: str | None = None,
        enroll: bool | None = None,
        revoke: bool | None = None,
        renew: bool | None = None,
        enabled: bool | None = None,
        description: str | None = None,
        dry_run: bool | None = None,
        host: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an existing third-party scheduled task (GET -> strip -> merge -> PUT).

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/system-admin

        Uses the GET-strip-merge-PUT pattern: fetches the current state,
        strips server-populated fields, merges your overrides, and PUTs
        the result back.

        Args:
            name: Scheduled task name to update.
            cron: New Quartz cron expression.
            module: New Horizon module.
            profile: New certificate profile name.
            connector: New third-party connector name.
            enroll: Whether to enroll new certificates.
            revoke: Whether to revoke certificates.
            renew: Whether to renew certificates.
            enabled: Whether the task is enabled.
            description: New description.
            dry_run: New dry-run flag.
            host: New host override.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON with confirmation message and updated task data.
        """
        overrides: dict[str, Any] = {}
        if cron is not None:
            overrides["cron"] = cron
        if module is not None:
            overrides["module"] = module
        if profile is not None:
            overrides["profile"] = profile
        if connector is not None:
            overrides["connector"] = connector
        if enroll is not None:
            overrides["enroll"] = enroll
        if revoke is not None:
            overrides["revoke"] = revoke
        if renew is not None:
            overrides["renew"] = renew
        if enabled is not None:
            overrides["enabled"] = enabled
        if description is not None:
            overrides["description"] = description
        if dry_run is not None:
            overrides["dryRun"] = dry_run
        if host is not None:
            overrides["host"] = host

        result = await get_strip_merge_put(
            f"{_BASE}/{name}",
            f"{_BASE}/",
            "scheduled_task",
            overrides,
            clear_fields,
        )
        return build_mutate_response(action="updated", kind="thirdparty_task", name=name, data=result)

    # ===================================================================
    # Report-specific tools (2)
    # ===================================================================

    @mcp.tool()
    async def create_report_task(
        name: str,
        report_type: str,
        cron: str,
        recipients: list[dict[str, Any]],
        from_email: str,
        title: str,
        is_html: bool,
        hql_type: str,
        hql_query: str | None = None,
        hql_fields: list[str] | None = None,
        hql_sorted_by: list[dict[str, Any]] | None = None,
        file_name: str | None = None,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
        body: str | None = None,
        headers: dict[str, str] | None = None,
        compress_csv: bool | None = None,
        retention_period: str | None = None,
        enabled: bool = True,
        description: str | None = None,
        host: str | None = None,
    ) -> str:
        """Create a new report scheduled task.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/system-admin

        See also: run_scheduled_task (trigger immediate execution),
            validate_hcql / validate_hrql (validate your HQL query first).

        Report tasks periodically generate and email certificate reports.
        The report content is driven by an HQL query whose type matches
        one of the Horizon query languages (HCQL, HRQL, etc.).

        Each recipient is a dict with a ``type`` field and either an
        ``email`` or ``team`` field (mutually exclusive):
          - {"type": "email", "email": "user@example.com"}
          - {"type": "team", "team": "MyTeam"}

        Args:
            name: Unique scheduled task name.
            report_type: Report subtype (e.g. "csv_email", "link_email").
            cron: Quartz cron expression defining the schedule.
            recipients: List of recipient dicts. Each must have a "type" and either "email" or "team":
                [{"type": "email", "email": "user@example.com"}, {"type": "team", "team": "MyTeam"}].
            from_email: Sender email address.
            title: Report/email title.
            is_html: Whether the email body is HTML.
            hql_type: HQL language type (e.g. "HCQL", "HRQL").
            hql_query: Optional HQL query string.
            hql_fields: Optional list of fields to include in the report.
            hql_sorted_by: Sort specification — list of sort elements.
                Example: [{"element": "notAfter", "order": "Asc"}].
                Valid orders: "Asc", "Desc".
            file_name: Optional file name for the report attachment.
            cc: Optional list of CC email addresses.
            bcc: Optional list of BCC email addresses.
            body: Optional email body text.
            headers: Optional dict of extra email headers.
            compress_csv: Whether to gzip-compress CSV attachments.
            retention_period: Retention period for link_email reports
                (REQUIRED when report_type is "link_email").
            enabled: Whether the task is enabled (default true).
            description: Optional human-readable description.
            host: Optional host override for task execution.

        Returns:
            JSON representation of the created scheduled task.
        """
        # Client-side validation: link_email requires retention_period
        if report_type == "link_email" and not retention_period:
            return json.dumps({
                "error": True,
                "content": "link_email reports require retention_period.",
            })

        client = get_client()

        payload: dict[str, Any] = {
            "name": name,
            "type": "report",
            "reportType": report_type,
            "cron": cron,
            "recipients": recipients,
            "from": from_email,
            "title": title,
            "isHtml": is_html,
            "hqlType": hql_type,
            "enabled": enabled,
        }
        _add_optional(payload, "hqlQuery", hql_query)
        _add_optional(payload, "hqlFields", hql_fields)
        _add_optional(payload, "hqlSortedBy", hql_sorted_by)
        _add_optional(payload, "fileName", file_name)
        _add_optional(payload, "cc", cc)
        _add_optional(payload, "bcc", bcc)
        _add_optional(payload, "body", body)
        _add_optional(payload, "headers", headers)
        _add_optional(payload, "compressCsv", compress_csv)
        _add_optional(payload, "retentionPeriod", retention_period)
        _add_optional(payload, "description", description)
        _add_optional(payload, "host", host)

        result = await client.post(_BASE, json=payload)
        return build_mutate_response(action="created", kind="report_task", name=name, data=result)

    @mcp.tool()
    async def update_report_task(
        name: str,
        report_type: str | None = None,
        cron: str | None = None,
        recipients: list[dict[str, Any]] | None = None,
        from_email: str | None = None,
        title: str | None = None,
        is_html: bool | None = None,
        hql_type: str | None = None,
        hql_query: str | None = None,
        hql_fields: list[str] | None = None,
        hql_sorted_by: list[dict[str, Any]] | None = None,
        file_name: str | None = None,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
        body: str | None = None,
        headers: dict[str, str] | None = None,
        compress_csv: bool | None = None,
        retention_period: str | None = None,
        enabled: bool | None = None,
        description: str | None = None,
        host: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an existing report scheduled task (GET -> strip -> merge -> PUT).

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/system-admin

        Uses the GET-strip-merge-PUT pattern: fetches the current state,
        strips server-populated fields, merges your overrides, and PUTs
        the result back.

        Args:
            name: Scheduled task name to update.
            report_type: New report subtype.
            cron: New Quartz cron expression.
            recipients: New list of recipient dicts (type + email/team).
            from_email: New sender email address.
            title: New report/email title.
            is_html: Whether the email body is HTML.
            hql_type: New HQL language type.
            hql_query: New HQL query string.
            hql_fields: New list of fields to include.
            hql_sorted_by: New sort specification.
            file_name: New file name for the report attachment.
            cc: New list of CC email addresses.
            bcc: New list of BCC email addresses.
            body: New email body text.
            headers: New dict of extra email headers.
            compress_csv: Whether to compress CSV attachments.
            retention_period: New retention period for link_email reports.
            enabled: Whether the task is enabled.
            description: New description.
            host: New host override.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON with confirmation message and updated task data.
        """
        overrides: dict[str, Any] = {}
        if report_type is not None:
            overrides["reportType"] = report_type
        if cron is not None:
            overrides["cron"] = cron
        if recipients is not None:
            overrides["recipients"] = recipients
        if from_email is not None:
            overrides["from"] = from_email
        if title is not None:
            overrides["title"] = title
        if is_html is not None:
            overrides["isHtml"] = is_html
        if hql_type is not None:
            overrides["hqlType"] = hql_type
        if hql_query is not None:
            overrides["hqlQuery"] = hql_query
        if hql_fields is not None:
            overrides["hqlFields"] = hql_fields
        if hql_sorted_by is not None:
            overrides["hqlSortedBy"] = hql_sorted_by
        if file_name is not None:
            overrides["fileName"] = file_name
        if cc is not None:
            overrides["cc"] = cc
        if bcc is not None:
            overrides["bcc"] = bcc
        if body is not None:
            overrides["body"] = body
        if headers is not None:
            overrides["headers"] = headers
        if compress_csv is not None:
            overrides["compressCsv"] = compress_csv
        if retention_period is not None:
            overrides["retentionPeriod"] = retention_period
        if enabled is not None:
            overrides["enabled"] = enabled
        if description is not None:
            overrides["description"] = description
        if host is not None:
            overrides["host"] = host

        result = await get_strip_merge_put(
            f"{_BASE}/{name}",
            f"{_BASE}/",
            "scheduled_task",
            overrides,
            clear_fields,
        )
        return build_mutate_response(action="updated", kind="report_task", name=name, data=result)
