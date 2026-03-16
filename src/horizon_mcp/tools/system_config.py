"""System configuration and config import/export tools for Horizon MCP Server.

6 tools across 2 sub-domains:

  - System Configuration (3): list, get by type, upsert
    Endpoint: /api/v1/system/configuration (singular)

  - Config Import/Export (3): list exportable items, export, import
    Endpoint: /api/v1/system/configurations (plural)

Knowledge resources:
    - horizon://knowledge/system-admin
"""

from __future__ import annotations

import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.state import get_client
from horizon_mcp.tools._helpers import build_mutate_response

logger = logging.getLogger("horizon_mcp.tools.system_config")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_CONFIG_BASE = "/api/v1/system/configuration"
_CONFIGS_BASE = "/api/v1/system/configurations"

_VALID_CONFIG_TYPES = frozenset({
    "license",
    "internal_monitor",
    "interface_customization",
})


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_system_config_tools(mcp: FastMCP) -> None:
    """Register all 6 system configuration tools on *mcp*."""

    # ===================================================================
    # System Configuration (3 tools)
    # ===================================================================

    @mcp.tool()
    async def list_system_configs() -> str:
        """List all system configuration entries.

        Safety tier: read-only
        Knowledge: horizon://knowledge/system-admin

        Returns:
            JSON array of SystemConfigurationEntry objects.
        """
        client = get_client()
        result = await client.get(_CONFIG_BASE)
        return json.dumps(result)

    @mcp.tool()
    async def get_system_config(config_type: str) -> str:
        """Get a single system configuration entry by type.

        Safety tier: read-only
        Knowledge: horizon://knowledge/system-admin

        Args:
            config_type: One of 'license', 'internal_monitor',
                or 'interface_customization'.

        Returns:
            JSON representation of the SystemConfigurationEntry.
        """
        if config_type not in _VALID_CONFIG_TYPES:
            return json.dumps({
                "error": True,
                "content": (
                    f"Invalid config_type '{config_type}'. "
                    f"Must be one of: {', '.join(sorted(_VALID_CONFIG_TYPES))}."
                ),
            })
        client = get_client()
        result = await client.get(f"{_CONFIG_BASE}/{config_type}")
        return json.dumps(result)

    @mcp.tool(
        description=(
            "Create or update a system configuration entry. "
            "IMPORTANT: Before executing this operation, always confirm "
            "the action with the end-user first. "
            "WARNING: Modifying system configuration can immediately "
            "alter Horizon behavior. "
            "Safety tier: security-sensitive. "
            "Reference: horizon://knowledge/system-admin"
        ),
    )
    async def upsert_system_config(
        config_type: str,
        configuration: dict,
    ) -> str:
        """Upsert a system configuration entry via PUT.

        Args:
            config_type: One of 'license', 'internal_monitor',
                or 'interface_customization'.
            configuration: The configuration payload to set.
                Use get_system_config to see the current shape for each type.

        Returns:
            JSON representation of the updated SystemConfigurationEntry.
        """
        if config_type not in _VALID_CONFIG_TYPES:
            return json.dumps({
                "error": True,
                "content": (
                    f"Invalid config_type '{config_type}'. "
                    f"Must be one of: {', '.join(sorted(_VALID_CONFIG_TYPES))}."
                ),
            })
        client = get_client()
        payload: dict[str, Any] = {
            "type": config_type,
            "configuration": configuration,
        }
        result = await client.put(_CONFIG_BASE, json=payload)
        return build_mutate_response(
            action="upserted", kind="system_config", name=config_type, data=result,
        )

    # ===================================================================
    # Config Import/Export (3 tools)
    # ===================================================================

    @mcp.tool()
    async def list_exportable_items() -> str:
        """List all exportable configuration items from the Horizon instance.

        Safety tier: read-only
        Knowledge: horizon://knowledge/system-admin

        Returns a catalog of items that can be selectively exported via
        export_configuration().

        Returns:
            JSON object describing exportable configuration categories
            and their items.
        """
        client = get_client()
        result = await client.get(f"{_CONFIGS_BASE}/export")
        return json.dumps(result)

    @mcp.tool()
    async def export_configuration(
        cas: list[dict] | None = None,
        pki_connectors: list[dict] | None = None,
        roles: list[dict] | None = None,
        teams: list[dict] | None = None,
        password_policies: list[dict] | None = None,
        notifications: list[dict] | None = None,
        datasources: list[dict] | None = None,
        discovery_campaigns: list[dict] | None = None,
        third_parties: list[dict] | None = None,
        reports: list[dict] | None = None,
        triggers: list[dict] | None = None,
        automations: list[dict] | None = None,
        executions: list[dict] | None = None,
        profiles: list[dict] | None = None,
        forest_mappings: list[dict] | None = None,
        labels: list[dict] | None = None,
        proxies: list[dict] | None = None,
        pki_queues: list[dict] | None = None,
        scim_profiles: list[dict] | None = None,
    ) -> str:
        """Export Horizon configuration, optionally filtering by category.

        Safety tier: read-only
        Knowledge: horizon://knowledge/system-admin

        When called with no arguments, exports the entire configuration.
        Pass one or more category parameters to selectively export only
        those items. Use list_exportable_items() first to discover what
        is available.

        Each parameter accepts a list of HorizonExportableItem dicts,
        where each dict has at minimum a 'name' key and optionally
        'displayName', 'description', and 'detail'.

        Args:
            cas: CA items to export.
            pki_connectors: PKI connector items to export.
            roles: Role items to export.
            teams: Team items to export.
            password_policies: Password policy items to export.
            notifications: Notification items to export.
            datasources: Datasource items to export.
            discovery_campaigns: Discovery campaign items to export.
            third_parties: Third-party integration items to export.
            reports: Report items to export.
            triggers: Trigger items to export.
            automations: Automation policy items to export.
            executions: Execution policy items to export.
            profiles: Certificate profile items to export.
            forest_mappings: Forest mapping items to export.
            labels: Label items to export.
            proxies: HTTP proxy items to export.
            pki_queues: PKI queue items to export.
            scim_profiles: SCIM profile items to export.

        Returns:
            JSON export bundle suitable for import_configuration().
        """
        payload: dict[str, Any] = {}
        mapping: dict[str, list[dict] | None] = {
            "cas": cas,
            "pkiConnectors": pki_connectors,
            "roles": roles,
            "teams": teams,
            "passwordPolicies": password_policies,
            "notifications": notifications,
            "datasources": datasources,
            "discoveryCampaigns": discovery_campaigns,
            "thirdParties": third_parties,
            "reports": reports,
            "triggers": triggers,
            "automations": automations,
            "executions": executions,
            "profiles": profiles,
            "forestMappings": forest_mappings,
            "labels": labels,
            "proxies": proxies,
            "pkiQueues": pki_queues,
            "scimProfiles": scim_profiles,
        }
        for key, value in mapping.items():
            if value is not None:
                payload[key] = value

        client = get_client()
        result = await client.post(f"{_CONFIGS_BASE}/export", json=payload)
        return json.dumps(result)

    @mcp.tool(
        description=(
            "Import a previously exported Horizon configuration bundle. "
            "IMPORTANT: Always call export_configuration() before importing "
            "to create a backup. "
            "WARNING: Import overwrites Horizon configuration. This action "
            "cannot be undone. Always confirm with the end-user first. "
            "Safety tier: security-sensitive. "
            "Reference: horizon://knowledge/system-admin"
        ),
    )
    async def import_configuration(
        export_data: dict,
        confirm_import: bool = False,
    ) -> str:
        """Import a configuration bundle into the Horizon instance.

        Args:
            export_data: The configuration bundle, typically obtained
                from a previous export_configuration() call.
            confirm_import: Client-side safety flag. Must be True to
                proceed. This is NOT sent to the API.

        Returns:
            JSON result from the import operation, or an error if
            confirm_import is not True.
        """
        if not confirm_import:
            return json.dumps({
                "error": True,
                "content": (
                    "Import refused: confirm_import must be True. "
                    "Call export_configuration() first as backup, "
                    "then set confirm_import=True to proceed."
                ),
            })
        client = get_client()
        result = await client.post(f"{_CONFIGS_BASE}/import", json=export_data)
        return build_mutate_response(
            action="imported", kind="configuration", name="horizon", data=result,
        )
