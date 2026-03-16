"""Horizon MCP assist tools — computation, query, crypto, system, and translate helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING

from horizon_mcp.tools.assist.computation import register_computation_tools
from horizon_mcp.tools.assist.crypto import register_crypto_tools
from horizon_mcp.tools.assist.query import register_query_tools
from horizon_mcp.tools.assist.system import register_system_tools
from horizon_mcp.tools.assist.translate import register_translate_tools

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP


def register_assist_tools(mcp: FastMCP) -> None:
    """Register all assist tools (computation, query, crypto, system, translate)."""
    register_computation_tools(mcp)
    register_query_tools(mcp)
    register_crypto_tools(mcp)
    register_system_tools(mcp)
    register_translate_tools(mcp)
