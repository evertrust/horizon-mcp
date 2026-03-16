"""FastMCP server entrypoint: lifespan, health check, version detect, tool registration."""

from __future__ import annotations

import json
import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from mcp.server.fastmcp import FastMCP

from horizon_mcp.auth import create_auth_provider
from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.http import HorizonClient
from horizon_mcp.client.state import (
    clear_client,
    get_client,
    set_client,
    set_horizon_version,
    set_principal_name,
)
from horizon_mcp.settings import HorizonSettings

# Re-export get_client for backward compat (tools import from here or state)
__all__ = ["get_client", "mcp", "main"]

# -- Logging setup (structured JSON lines to stderr) -----------------------


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in ("request_id", "method", "path", "status", "duration_ms"):
            val = getattr(record, key, None)
            if val is not None:
                entry[key] = val
        return json.dumps(entry)


def _configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger("horizon_mcp")
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))


logger = logging.getLogger("horizon_mcp.server")


# -- Lifespan --------------------------------------------------------------


@asynccontextmanager
async def lifespan(server: FastMCP) -> AsyncIterator[dict[str, Any]]:
    """Server startup/shutdown: create client (auth is deferred to first use)."""
    settings = HorizonSettings()
    _configure_logging(settings.log_level)

    auth = create_auth_provider(settings)
    client = HorizonClient(settings, auth)
    set_client(client)
    logger.info("Horizon MCP server ready — auth will trigger on first tool call.")

    try:
        yield {"client": client}
    finally:
        await client.close()
        auth.cleanup()
        clear_client()
        logger.info("Horizon MCP server shut down.")


def _log_version_compatibility(settings: HorizonSettings, version: str) -> None:
    major_minor = ".".join(version.split(".")[:2])
    if major_minor in settings.tested_versions:
        logger.info("Horizon version %s (tested — full compatibility)", version)
    elif major_minor in settings.warn_versions:
        logger.warning(
            "Horizon version %s (nearby — most features expected to work, minor issues possible)",
            version,
        )
    else:
        logger.warning(
            "Horizon version %s (untested — operations allowed but may encounter issues)",
            version,
        )


# -- MCP Server Instance ---------------------------------------------------

mcp = FastMCP(
    "Horizon MCP Server",
    instructions=(
        "Production MCP server for Evertrust Horizon CLM — "
        "certificate lifecycle management, configuration, RBAC, and discovery.\n\n"
        "CRITICAL RULES:\n"
        "1. IMMUTABLE NAMES: All object names in Horizon are primary keys and "
        "CANNOT be changed after creation. This applies to every object: profiles, "
        "connectors, dashboards, roles, teams, CAs, triggers, labels, etc. "
        "You MUST ask the user for the name before creating any object — never "
        "invent or guess names. When the tool also accepts a display_name "
        "parameter, always ask for that too — it is the human-friendly label "
        "shown in the UI and can be changed later.\n"
        "2. OWNERSHIP QUERIES: When searching for 'my certificates', call whoami "
        "first to get the user's identifier AND team list, then query both: "
        "owner equals \"<id>\" or team in (\"<team1>\", \"<team2>\", ...). "
        "Direct owner alone misses team-owned certificates.\n"
        "3. SERVICE DISCOVERY: When searching for certificates by service (tomcat, "
        "nginx, apache, etc.), search discoverydata.paths, discoverydata.usages, "
        "and discoverydata.hostnames in addition to dn and san. "
        "See horizon://knowledge/query-languages for patterns.\n"
        "4. HQL FIELD NAMES: ALL query field names (HCQL, HRQL, HEQL, HDQL) are "
        "LOWERCASE — never camelCase. Common mistakes: contactEmail→contactemail, "
        "keyType→keytype, notAfter→valid.until, registrationDate→registration.date, "
        "certificateId→certificateid. Using camelCase causes HQL-001 parse errors. "
        "Note: groupBy and sortedBy fields ARE camelCase (API context, not query context)."
    ),
    lifespan=lifespan,
)


# -- Register all tools and resources --------------------------------------

def _register_all() -> None:
    """Import and register Phase 1 tools + all resources."""
    from horizon_mcp.tools import register_phase1_tools
    from horizon_mcp.resources import register_all_resources
    register_phase1_tools(mcp)
    register_all_resources(mcp)


_register_all()


# -- Entry point -----------------------------------------------------------

def main() -> None:
    """CLI entry point: run the MCP server over stdio."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
