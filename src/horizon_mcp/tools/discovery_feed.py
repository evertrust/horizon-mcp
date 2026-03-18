"""Discovery feed tools for Horizon MCP Server.

4 tools covering the discovery feed lifecycle: start a feed session,
feed certificates, register events, and end the session.

The discovery feed API lets external scanners push certificate data
into a Horizon discovery campaign programmatically.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.discovery_feed")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_FEED_BASE = "/api/v1/discovery/feed"


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_discovery_feed_tools(mcp: FastMCP) -> None:
    """Register all 4 discovery feed tools on *mcp*."""

    from horizon_mcp.client.state import get_client

    @mcp.tool()
    async def start_discovery_feed_session(campaign_name: str) -> str:
        """Start a discovery feed session for a campaign.

        Safety tier: mutating-safe

        Store the returned 'id' field  -  you will need it to end the session.
        If you lose this value, use list_discovery_campaigns to check campaign
        status, or use Horizon UI to clean up.

        Args:
            campaign_name: Name of the discovery campaign to feed into.

        Returns:
            JSON with the session ID and full session data.
        """
        client = get_client()
        result = await client.get(f"{_FEED_BASE}/{campaign_name}")
        session_id = result.get("id", "")
        return json.dumps({
            "content": (
                f"Feed session started for campaign '{campaign_name}'. "
                f"Session ID: {session_id}. "
                "Store this ID to end the session later."
            ),
            "data": result,
        })

    @mcp.tool()
    async def feed_discovery_certificate(
        session_id: str,
        certificate: str,
        host: str,
        port: int,
        ip: str | None = None,
        protocol: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Feed a discovered certificate into an active feed session.

        Safety tier: mutating-safe

        Args:
            session_id: Session ID obtained from start_discovery_feed_session.
            certificate: PEM-encoded certificate string.
            host: Hostname where the certificate was discovered.
            port: Port number where the certificate was discovered.
            ip: Optional IP address of the host.
            protocol: Optional protocol (e.g., "https", "smtps").
            metadata: Optional dict of additional metadata key-value pairs.

        Returns:
            JSON confirmation with server response data.
        """
        client = get_client()
        payload: dict[str, Any] = {
            "sessionId": session_id,
            "certificate": certificate,
            "host": host,
            "port": port,
        }
        if ip is not None:
            payload["ip"] = ip
        if protocol is not None:
            payload["protocol"] = protocol
        if metadata is not None:
            payload["metadata"] = metadata
        result = await client.post(_FEED_BASE, json=payload)
        return json.dumps({"content": "Certificate fed to discovery session.", "data": result})

    @mcp.tool()
    async def register_discovery_event(
        session_id: str,
        data: dict[str, Any],
    ) -> str:
        """Register an arbitrary discovery event in an active feed session.

        Safety tier: mutating-safe

        Args:
            session_id: Session ID obtained from start_discovery_feed_session.
            data: Event data dict  -  contents depend on the event type.

        Returns:
            JSON confirmation with server response data.
        """
        client = get_client()
        payload: dict[str, Any] = {"sessionId": session_id, **data}
        result = await client.put(_FEED_BASE, json=payload)
        return json.dumps({"content": "Discovery event registered.", "data": result})

    @mcp.tool()
    async def end_discovery_feed_session(
        campaign_name: str,
        session_id: str,
    ) -> str:
        """End a discovery feed session.

        Safety tier: mutating-safe

        Args:
            campaign_name: Name of the discovery campaign.
            session_id: Session ID obtained from start_discovery_feed_session.

        Returns:
            JSON confirmation that the session was ended.
        """
        client = get_client()
        await client.delete(f"{_FEED_BASE}/{campaign_name}/{session_id}")
        return json.dumps({
            "content": f"Feed session '{session_id}' ended for campaign '{campaign_name}'.",
        })
