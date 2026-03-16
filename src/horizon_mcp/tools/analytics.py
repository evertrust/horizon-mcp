"""Analytics status tools for Horizon MCP Server.

1 tool for retrieving analytics synchronization status:
  - get_analytics: fetch sync status for a given analytics domain

Only GET (status retrieval) is exposed. PATCH/DELETE operations are
admin-only and must be performed through the Horizon UI.

NOTE: The discovery domain maps to /api/v1/analytics/discovery/events
(extra path segment). There is NO /api/v1/analytics/requests endpoint.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from horizon_mcp.client.state import get_client

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.analytics")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DOMAIN_PATHS = {
    "certificates": "/api/v1/analytics/certificates",
    "events": "/api/v1/analytics/events",
    "discovery": "/api/v1/analytics/discovery/events",
}


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_analytics_tools(mcp: FastMCP) -> None:
    """Register the analytics status tool on *mcp*."""

    @mcp.tool()
    async def get_analytics(domain: str) -> str:
        """Get analytics synchronization status for a domain.

        Safety tier: read-only
        Reference: horizon://knowledge/system-admin

        Only status retrieval is available. To update or flush analytics,
        use the Horizon UI (admin-only operations).

        Args:
            domain: Analytics domain — one of: certificates, events, discovery.
                    Note: there is no 'requests' analytics endpoint.
        """
        path = _DOMAIN_PATHS.get(domain)
        if not path:
            valid = sorted(_DOMAIN_PATHS.keys())
            return json.dumps({
                "error": True,
                "content": (
                    f"Invalid analytics domain '{domain}'. "
                    f"Must be one of: {', '.join(valid)}."
                ),
            })

        client = get_client()
        result = await client.get(path)
        return json.dumps({
            "content": f"Analytics status for '{domain}'.",
            "data": result,
        })
