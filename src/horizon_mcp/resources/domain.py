"""MCP resource registration for Horizon knowledge base."""
from __future__ import annotations
from pathlib import Path
from mcp.server.fastmcp import FastMCP

_KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"

def _read_knowledge(filename: str) -> str:
    return (_KNOWLEDGE_DIR / filename).read_text(encoding="utf-8")

def register_all_resources(mcp: FastMCP) -> None:
    @mcp.resource("horizon://knowledge/profiles")
    async def profiles_knowledge() -> str:
        return _read_knowledge("profiles.md")

    @mcp.resource("horizon://knowledge/computation-and-data-flow")
    async def computation_knowledge() -> str:
        return _read_knowledge("computation_and_data_flow.md")

    @mcp.resource("horizon://knowledge/workflows")
    async def workflows_knowledge() -> str:
        return _read_knowledge("workflows.md")

    @mcp.resource("horizon://knowledge/query-languages")
    async def query_languages_knowledge() -> str:
        return _read_knowledge("query_languages.md")

    @mcp.resource("horizon://knowledge/rbac")
    async def rbac_knowledge() -> str:
        return _read_knowledge("rbac.md")

    @mcp.resource("horizon://knowledge/architecture")
    async def architecture_knowledge() -> str:
        return _read_knowledge("architecture.md")

    @mcp.resource("horizon://knowledge/dictionary-matrix")
    async def dictionary_matrix_knowledge() -> str:
        return _read_knowledge("dictionary_matrix.md")

    @mcp.resource("horizon://knowledge/discovery")
    async def discovery_knowledge() -> str:
        return _read_knowledge("discovery.md")

    @mcp.resource("horizon://knowledge/automation")
    async def automation_knowledge() -> str:
        return _read_knowledge("automation.md")

    @mcp.resource("horizon://knowledge/integrations")
    async def integrations_knowledge() -> str:
        return _read_knowledge("integrations.md")

    # v1.1 knowledge resources
    @mcp.resource("horizon://knowledge/dashboards")
    async def dashboards_knowledge() -> str:
        return _read_knowledge("dashboards.md")

    @mcp.resource("horizon://knowledge/system-admin")
    async def system_admin_knowledge() -> str:
        return _read_knowledge("system_admin.md")
