"""PKI and third-party connector management tools for Horizon MCP Server.

10 tools covering the full CRUD lifecycle for both PKI connectors
(``/api/v1/pki/connectors``) and third-party connectors
(``/api/v1/thirdparty/connectors``).

Knowledge resources:
    - horizon://knowledge/integrations
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.models.enums import PKIConnectorType, ThirdPartyConnectorType
from horizon_mcp.models.payloads import to_update_payload
from horizon_mcp.tools._helpers import apply_name_filter, build_list_response, build_mutate_response, delete_guard

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.connectors")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PKI_BASE = "/api/v1/pki/connectors"
_TP_BASE = "/api/v1/thirdparty/connectors"
_CREDENTIAL_PATH = "/api/v1/security/credentials"

_PKI_TYPES = sorted(t.value for t in PKIConnectorType)
_TP_TYPES = sorted(t.value for t in ThirdPartyConnectorType)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _validate_credential(client: Any, credential: str) -> None:
    """Preflight: verify that a credential exists before referencing it.

    Raises HorizonError with a clear remediation hint on 404.
    """
    try:
        await client.get(f"{_CREDENTIAL_PATH}/{credential}")
    except HorizonError as exc:
        if exc.status_code == 404:
            raise HorizonError(
                status_code=422,
                error_code="PREFLIGHT-DEP",
                message=f"Credential '{credential}' not found.",
                remediation=(
                    "Credentials must be created via the Horizon UI or API "
                    "before they can be referenced by a connector."
                ),
            ) from exc
        raise


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_connector_tools(mcp: FastMCP) -> None:
    """Register all 10 connector management tools on *mcp*."""

    from horizon_mcp.client.state import get_client

    # ===================================================================
    # PKI Connectors (5 tools)
    # ===================================================================

    @mcp.tool()
    async def list_pki_connectors(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List PKI connectors with optional name filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/integrations

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on connector name.

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        data = await client.get(_PKI_BASE)
        items: list[dict[str, Any]] = data if isinstance(data, list) else data.get("items", [data])
        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="pki_connector")

    @mcp.tool()
    async def get_pki_connector(name: str) -> str:
        """Get a single PKI connector by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/integrations

        Args:
            name: Exact connector name.

        Returns:
            JSON representation of the PKI connector.
        """
        client = get_client()
        result = await client.get(f"{_PKI_BASE}/{name}")
        return json.dumps(result)

    @mcp.tool()
    async def create_pki_connector(
        name: str,
        type: str,
        configuration: dict,
        credential: str | None = None,
        proxy: str | None = None,
        description: str | None = None,
    ) -> str:
        """Create a new PKI connector.

        Safety tier: mutating-safe
        Prerequisites: Credential must already exist if referenced (use list_credentials to verify).
        See also: create_webra_profile, create_acme_profile (profiles reference connectors by name).
        Knowledge: horizon://knowledge/integrations

        Supported types (22): acmeenroll, acmerevoke, awsacmpca, certeurope,
        cmp, digicert, ejbca, entrust, evtadcs, fcms, gsatlas, gsmssl, idca,
        integrated, metapki, msadcs, nameshield, nexuscm, otpki, sectigo,
        stream, swisssign.

        Args:
            name: Unique connector name.
            type: Connector type — must be one of the 22 supported types.
            configuration: Type-specific configuration dict. Shape depends on type.
                Common fields: {"url": "https://...", "caName": "..."}.
                MSADCS example: {"url": "https://adcs.local/certsrv", "caName": "MyCA", "templateName": "WebServer"}.
                DigiCert example: {"url": "https://api.digicert.com", "organizationId": "...", "certType": "..."}.
                Use get_pki_connector on an existing connector to see the full shape for a given type.
            credential: Optional credential name (must exist).
            proxy: Optional proxy name.
            description: Optional human-readable description.

        Returns:
            JSON representation of the created connector.
        """
        if type not in _PKI_TYPES:
            return json.dumps({
                "error": f"Invalid PKI connector type '{type}'.",
                "valid_types": _PKI_TYPES,
            })

        client = get_client()

        if credential:
            await _validate_credential(client, credential)

        payload: dict[str, Any] = {
            "name": name,
            "type": type,
            "configuration": configuration,
        }
        if credential is not None:
            payload["credential"] = credential
        if proxy is not None:
            payload["proxy"] = proxy
        if description is not None:
            payload["description"] = description

        result = await client.post(_PKI_BASE, json=payload)
        return build_mutate_response(action="created", kind="pki_connector", name=name, data=result)

    @mcp.tool()
    async def update_pki_connector(
        name: str,
        configuration: dict | None = None,
        credential: str | None = None,
        proxy: str | None = None,
        description: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an existing PKI connector (GET -> strip -> merge -> PUT).

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/integrations

        Uses the GET-strip-merge-PUT pattern: fetches the current state,
        strips server-populated fields, merges your overrides, and PUTs
        the result back.

        Args:
            name: Connector name to update.
            configuration: New configuration dict (replaces existing).
            credential: New credential name (must exist).
            proxy: New proxy name.
            description: New description.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON representation of the updated connector.
        """
        client = get_client()

        if credential:
            await _validate_credential(client, credential)

        current = await client.get(f"{_PKI_BASE}/{name}")

        overrides: dict[str, Any] = {}
        if configuration is not None:
            overrides["configuration"] = configuration
        if credential is not None:
            overrides["credential"] = credential
        if proxy is not None:
            overrides["proxy"] = proxy
        if description is not None:
            overrides["description"] = description

        payload = to_update_payload(
            current,
            overrides=overrides,
            clear_fields=clear_fields,
            domain="connector",
        )

        result = await client.put(f"{_PKI_BASE}/", json=payload)
        return build_mutate_response(action="updated", kind="pki_connector", name=name, data=result)

    @mcp.tool()
    async def delete_pki_connector(name: str, expected_name: str) -> str:
        """Delete a PKI connector. Requires name confirmation.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/integrations

        WARNING: Deleting a PKI connector may affect all profiles using it.
        Certificate enrollment and renewal workflows that reference this
        connector will stop working.

        Args:
            name: Connector name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(name, expected_name)

        client = get_client()
        await client.delete(f"{_PKI_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "pki_connector",
            "warning": "Profiles referencing this connector may need to be updated.",
        })

    # ===================================================================
    # Third-Party Connectors (5 tools)
    # ===================================================================

    @mcp.tool()
    async def list_thirdparty_connectors(
        max_items: int = 50,
        name_contains: str | None = None,
    ) -> str:
        """List third-party connectors with optional name filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/integrations

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on connector name.

        Returns:
            JSON with items, count, total_available, and truncated flag.
        """
        client = get_client()
        data = await client.get(_TP_BASE)
        items: list[dict[str, Any]] = data if isinstance(data, list) else data.get("items", [data])
        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="thirdparty_connector")

    @mcp.tool()
    async def get_thirdparty_connector(name: str) -> str:
        """Get a single third-party connector by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/integrations

        Args:
            name: Exact connector name.

        Returns:
            JSON representation of the third-party connector.
        """
        client = get_client()
        result = await client.get(f"{_TP_BASE}/{name}")
        return json.dumps(result)

    @mcp.tool()
    async def create_thirdparty_connector(
        name: str,
        type: str,
        configuration: dict,
        credential: str | None = None,
        description: str | None = None,
    ) -> str:
        """Create a new third-party connector.

        Safety tier: mutating-safe
        Prerequisites: Credential must already exist if referenced (use list_credentials to verify).
        See also: create_thirdparty_task (scheduled tasks reference connectors by name),
            attach_trigger_to_profile (third-party triggers reference connectors).
        Knowledge: horizon://knowledge/integrations

        Supported types (10): akv, aws, f5as3, f5client, gcm, intune,
        intunepkcs, jamf, ldappub, msad.

        Args:
            name: Unique connector name.
            type: Connector type — must be one of the 10 supported types.
            configuration: Type-specific configuration dict. Shape depends on type.
                AKV example: {"vaultUrl": "https://myvault.vault.azure.net", "tenantId": "..."}.
                LDAP example: {"url": "ldap://...", "baseDn": "dc=example,dc=com"}.
                Use get_thirdparty_connector on an existing connector to see the full shape for a given type.
            credential: Optional credential name (must exist).
            description: Optional human-readable description.

        Returns:
            JSON representation of the created connector.
        """
        if type not in _TP_TYPES:
            return json.dumps({
                "error": f"Invalid third-party connector type '{type}'.",
                "valid_types": _TP_TYPES,
            })

        client = get_client()

        if credential:
            await _validate_credential(client, credential)

        payload: dict[str, Any] = {
            "name": name,
            "type": type,
            "configuration": configuration,
        }
        if credential is not None:
            payload["credential"] = credential
        if description is not None:
            payload["description"] = description

        result = await client.post(_TP_BASE, json=payload)
        return build_mutate_response(action="created", kind="thirdparty_connector", name=name, data=result)

    @mcp.tool()
    async def update_thirdparty_connector(
        name: str,
        configuration: dict | None = None,
        credential: str | None = None,
        description: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """Update an existing third-party connector (GET -> strip -> merge -> PUT).

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/integrations

        Uses the GET-strip-merge-PUT pattern: fetches the current state,
        strips server-populated fields, merges your overrides, and PUTs
        the result back.

        Args:
            name: Connector name to update.
            configuration: New configuration dict (replaces existing).
            credential: New credential name (must exist).
            description: New description.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON representation of the updated connector.
        """
        client = get_client()

        if credential:
            await _validate_credential(client, credential)

        current = await client.get(f"{_TP_BASE}/{name}")

        overrides: dict[str, Any] = {}
        if configuration is not None:
            overrides["configuration"] = configuration
        if credential is not None:
            overrides["credential"] = credential
        if description is not None:
            overrides["description"] = description

        payload = to_update_payload(
            current,
            overrides=overrides,
            clear_fields=clear_fields,
            domain="connector",
        )

        result = await client.put(f"{_TP_BASE}/", json=payload)
        return build_mutate_response(action="updated", kind="thirdparty_connector", name=name, data=result)

    @mcp.tool()
    async def delete_thirdparty_connector(name: str, expected_name: str) -> str:
        """Delete a third-party connector. Requires name confirmation.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/integrations

        WARNING: Deleting a third-party connector may affect all profiles
        and automation workflows that reference it.

        Args:
            name: Connector name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.
        """
        delete_guard(name, expected_name)

        client = get_client()
        await client.delete(f"{_TP_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "thirdparty_connector",
        })
