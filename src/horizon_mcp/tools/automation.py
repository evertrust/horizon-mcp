"""Automation policy, execution policy, and lifecycle tools for Horizon MCP Server.

12 tools covering three sub-domains:
  - Automation Policies (5): CRUD for ``/api/v1/automation/policies``
  - Execution Policies (5): CRUD for ``/api/v1/automation/executions``
  - Automation Lifecycle (2): read-only enrollment and certificate verification

Knowledge resources:
    - horizon://knowledge/automation
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

logger = logging.getLogger("horizon_mcp.tools.automation")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_POLICY_BASE = "/api/v1/automation/policies"
_EXECUTION_BASE = "/api/v1/automation/executions"
_LIFECYCLE_BASE = "/api/v1/automation/lifecycle"


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_automation_tools(mcp: FastMCP) -> None:
    """Register all 12 automation tools on *mcp*."""

    # ===================================================================
    # Automation Policies (5 tools)
    # ===================================================================

    @mcp.tool()
    async def list_automation_policies(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List automation policies with optional name filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/automation

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on policy name.

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        data = await client.get(_POLICY_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )
        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="automation_policy")

    @mcp.tool()
    async def get_automation_policy(name: str) -> str:
        """Get a single automation policy by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/automation

        Args:
            name: Exact automation policy name.

        Returns:
            JSON representation of the automation policy.
        """
        client = get_client()
        result = await client.get(f"{_POLICY_BASE}/{name}")
        return json.dumps(result)

    @mcp.tool()
    async def create_automation_policy(
        name: str,
        profile: str,
        execution_policy: str | None = None,
        compliance_policy: str | None = None,
        trust_chains: list[str] | None = None,
    ) -> str:
        """Create a new automation policy.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/automation

        An automation policy binds a certificate profile to optional
        execution, compliance, and trust-chain constraints.

        Prerequisites: Profile must exist (use list_profiles). Execution policy
            and trust chains must exist if referenced.
        See also: create_execution_policy (time-window constraints),
            list_trust_chains, get_automation_enrollment (bootstrap automation agents).

        Args:
            name: Unique automation policy name.
            profile: Certificate profile name to associate.
            execution_policy: Optional execution policy name (string reference).
            compliance_policy: Optional compliance policy name.
            trust_chains: Optional list of trust chain names.

        Returns:
            JSON representation of the created automation policy.
        """
        client = get_client()

        payload: dict[str, Any] = {
            "name": name,
            "profile": profile,
        }
        if execution_policy is not None:
            payload["executionPolicy"] = execution_policy
        if compliance_policy is not None:
            payload["compliancePolicy"] = compliance_policy
        if trust_chains is not None:
            payload["trustChains"] = trust_chains

        result = await client.post(_POLICY_BASE, json=payload)
        return build_mutate_response(action="created", kind="automation_policy", name=name, data=result)

    @mcp.tool()
    async def update_automation_policy(
        name: str,
        profile: str | None = None,
        execution_policy: str | None = None,
        compliance_policy: str | None = None,
        trust_chains: list[str] | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an existing automation policy (GET -> strip -> merge -> PUT).

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/automation

        Uses the GET-strip-merge-PUT pattern: fetches the current state,
        strips server-populated fields, merges your overrides, and PUTs
        the result back.

        Args:
            name: Automation policy name to update.
            profile: New certificate profile name.
            execution_policy: New execution policy name (string reference).
            compliance_policy: New compliance policy name.
            trust_chains: New list of trust chain names.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON with confirmation message and updated policy data.
        """
        overrides: dict[str, Any] = {}
        if profile is not None:
            overrides["profile"] = profile
        if execution_policy is not None:
            overrides["executionPolicy"] = execution_policy
        if compliance_policy is not None:
            overrides["compliancePolicy"] = compliance_policy
        if trust_chains is not None:
            overrides["trustChains"] = trust_chains

        result = await get_strip_merge_put(
            f"{_POLICY_BASE}/{name}",
            f"{_POLICY_BASE}/",
            "automation_policy",
            overrides,
            clear_fields,
        )
        return build_mutate_response(action="updated", kind="automation_policy", name=name, data=result)

    @mcp.tool()
    async def delete_automation_policy(name: str, expected_name: str) -> str:
        """Delete an automation policy. Requires name confirmation.

        IMPORTANT: Before executing this operation, always confirm the action
        with the end-user first.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/automation

        WARNING: Deleting an automation policy will stop any automated
        certificate lifecycle operations governed by this policy.

        Args:
            name: Automation policy name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"{_POLICY_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "automation_policy",
        })

    # ===================================================================
    # Execution Policies (5 tools)
    # ===================================================================

    @mcp.tool()
    async def list_execution_policies(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List execution policies with optional name filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/automation

        Execution policies define time windows (authorized and forbidden
        periods) during which automation operations may run.

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on policy name.

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        data = await client.get(_EXECUTION_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )
        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="execution_policy")

    @mcp.tool()
    async def get_execution_policy(name: str) -> str:
        """Get a single execution policy by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/automation

        Args:
            name: Exact execution policy name.

        Returns:
            JSON representation of the execution policy including its
            authorized and forbidden periods.
        """
        client = get_client()
        result = await client.get(f"{_EXECUTION_BASE}/{name}")
        return json.dumps(result)

    @mcp.tool()
    async def create_execution_policy(
        name: str,
        description: str | None = None,
        authorized_periods: list[dict] | None = None,
        forbidden_periods: list[dict] | None = None,
    ) -> str:
        """Create a new execution policy.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/automation

        Execution policies control *when* automation operations are allowed
        to run via authorized and forbidden time windows.

        Each ExecutionPeriod may contain:
          - dateRange: {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}
          - weeks: list of ISO week numbers (ints)
          - weekDays: list of day names in ALL CAPS (MONDAY..SUNDAY)
          - timeRange: {"start": "HH:mm:ss", "end": "HH:mm:ss"}

        Args:
            name: Unique execution policy name.
            description: Optional human-readable description.
            authorized_periods: Optional list of ExecutionPeriod dicts
                defining when operations ARE allowed.
            forbidden_periods: Optional list of ExecutionPeriod dicts
                defining when operations are NOT allowed (takes precedence).

        See also: create_automation_policy (references execution policies by name).

        Returns:
            JSON representation of the created execution policy.
        """
        client = get_client()

        payload: dict[str, Any] = {"name": name}
        if description is not None:
            payload["description"] = description
        if authorized_periods is not None:
            payload["authorizedPeriods"] = authorized_periods
        if forbidden_periods is not None:
            payload["forbiddenPeriods"] = forbidden_periods

        result = await client.post(_EXECUTION_BASE, json=payload)
        return build_mutate_response(action="created", kind="execution_policy", name=name, data=result)

    @mcp.tool()
    async def update_execution_policy(
        name: str,
        description: str | None = None,
        authorized_periods: list[dict] | None = None,
        forbidden_periods: list[dict] | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an existing execution policy (GET -> strip -> merge -> PUT).

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/automation

        Uses the GET-strip-merge-PUT pattern: fetches the current state,
        strips server-populated fields, merges your overrides, and PUTs
        the result back.

        Args:
            name: Execution policy name to update.
            description: New description.
            authorized_periods: New list of authorized ExecutionPeriod dicts.
            forbidden_periods: New list of forbidden ExecutionPeriod dicts.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON with confirmation message and updated policy data.
        """
        overrides: dict[str, Any] = {}
        if description is not None:
            overrides["description"] = description
        if authorized_periods is not None:
            overrides["authorizedPeriods"] = authorized_periods
        if forbidden_periods is not None:
            overrides["forbiddenPeriods"] = forbidden_periods

        result = await get_strip_merge_put(
            f"{_EXECUTION_BASE}/{name}",
            f"{_EXECUTION_BASE}/",
            "execution_policy",
            overrides,
            clear_fields,
        )
        return build_mutate_response(action="updated", kind="execution_policy", name=name, data=result)

    @mcp.tool()
    async def delete_execution_policy(name: str, expected_name: str) -> str:
        """Delete an execution policy. Requires name confirmation.

        IMPORTANT: Before executing this operation, always confirm the action
        with the end-user first.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/automation

        WARNING: Deleting an execution policy will affect all automation
        policies that reference it. Those policies will lose their
        time-window constraints.

        Args:
            name: Execution policy name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"{_EXECUTION_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "execution_policy",
        })

    # ===================================================================
    # Automation Lifecycle (2 tools)
    # ===================================================================

    @mcp.tool()
    async def get_automation_enrollment(policy_name: str) -> str:
        """Get automation enrollment parameters for a policy.

        Safety tier: read-only
        Knowledge: horizon://knowledge/automation

        Returns the AutomationInitialisationParameters (JSON) that an
        automation agent would use to bootstrap enrollment under the
        given policy.

        Args:
            policy_name: Automation policy name.

        Returns:
            JSON AutomationInitialisationParameters object.
        """
        client = get_client()
        result = await client.get(f"{_LIFECYCLE_BASE}/{policy_name}")
        return json.dumps(result)

    @mcp.tool()
    async def verify_automation_certificate(policy_name: str) -> str:
        """Verify compliance of the current automation certificate.

        Safety tier: read-only
        Knowledge: horizon://knowledge/automation

        Checks whether the certificate currently held by the automation
        agent is compliant with the policy. Returns 204 (compliant) or
        200 with a JSON body containing ``runnable`` and ``renewable``
        flags indicating what actions are available.

        NOTE: This endpoint requires X.509 client certificate
        authentication. It will fail if the Horizon client is configured
        with API-key-only authentication.

        Args:
            policy_name: Automation policy name to verify against.

        Returns:
            JSON with compliance status. If compliant, returns
            {"compliant": true}. Otherwise, returns the server response
            with runnable/renewable flags.
        """
        client = get_client()
        result = await client.get(f"{_LIFECYCLE_BASE}/{policy_name}/verify")
        # A 204 response yields None or empty dict from the client
        if result is None or result == {}:
            return json.dumps({"compliant": True, "policy": policy_name})
        return json.dumps(result)
