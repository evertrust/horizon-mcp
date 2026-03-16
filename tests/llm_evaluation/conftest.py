"""LLM evaluation conftest — Claude Code subprocess helper + environment gating.

All evaluation tests run via `claude -p` with the MCP server attached.
Required: Claude Code CLI (`claude`) on PATH + HORIZON_E2E_* env vars.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# Environment gating
# ---------------------------------------------------------------------------

_HAS_CLAUDE = bool(shutil.which("claude"))
_E2E_URL = os.environ.get("HORIZON_E2E_URL", "")
_E2E_API_ID = os.environ.get("HORIZON_E2E_API_ID", "")
_E2E_API_KEY = os.environ.get("HORIZON_E2E_API_KEY", "")
_E2E_READY = all([_E2E_URL, _E2E_API_ID, _E2E_API_KEY])

_SKIP_REASON = (
    "Claude Code CLI not installed" if not _HAS_CLAUDE
    else "E2E env vars not set" if not _E2E_READY
    else ""
)

pytestmark = [
    pytest.mark.llm_evaluation,
    pytest.mark.skipif(bool(_SKIP_REASON), reason=_SKIP_REASON or "n/a"),
]


# ---------------------------------------------------------------------------
# MCP config fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def mcp_config_path() -> Path:
    """Create a temporary MCP config file pointing to the local horizon-mcp."""
    venv_bin = Path(__file__).resolve().parent.parent.parent / ".venv" / "bin" / "horizon-mcp"
    config = {
        "mcpServers": {
            "horizon": {
                "command": str(venv_bin),
                "env": {
                    "HORIZON_URL": _E2E_URL,
                    "HORIZON_API_ID": _E2E_API_ID,
                    "HORIZON_API_KEY": _E2E_API_KEY,
                },
            }
        }
    }
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", prefix="horizon-mcp-eval-", delete=False,
    )
    json.dump(config, tmp)
    tmp.close()
    yield Path(tmp.name)
    Path(tmp.name).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Claude Code subprocess helper
# ---------------------------------------------------------------------------

def ask_claude(
    question: str,
    mcp_config: Path,
    *,
    timeout: int = 120,
) -> dict[str, Any]:
    """Run `claude -p` with the MCP server and return parsed output.

    Returns a dict with:
        - "text": the full response text (lowercased for easy assertion)
        - "raw": the original response text (preserving case)
        - "exit_code": process exit code
    """
    result = subprocess.run(
        [
            "claude", "-p", question,
            "--output-format", "json",
            "--mcp-config", str(mcp_config),
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
    )

    raw = result.stdout.strip()

    # Try to parse as JSON (claude --output-format json returns structured output)
    try:
        parsed = json.loads(raw)
        text = parsed.get("result", parsed.get("text", raw))
    except (json.JSONDecodeError, TypeError):
        text = raw

    return {
        "text": text.lower() if isinstance(text, str) else str(text).lower(),
        "raw": text,
        "exit_code": result.returncode,
    }
