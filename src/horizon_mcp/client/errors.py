"""Horizon API error parsing with remediation hints."""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("horizon_mcp.client")

# Sensitive fields that must never appear in error details
_SENSITIVE_FIELDS = frozenset({
    "apiKey", "apiSecret", "password", "secret", "privateKey",
    "clientSecret", "token", "csrfToken", "passphrase", "credential",
})

# Error code suffix → remediation hint
_REMEDIATION_MAP: dict[str, str] = {
    "003": "Not found. Use the corresponding list_* tool to see available items.",
    "004": "Already exists. Use the corresponding update_* tool instead.",
    "005": "Referenced by other objects. Remove references first, then retry.",
    "002": "Validation failed. Check the error details for specific field issues.",
}

# Specific error codes
_SPECIFIC_REMEDIATION: dict[str, str] = {
    "HQL-001": "Invalid query syntax. Use validate_hcql/hrql/heql to check your query.",
    "SecAuth001": (
        "Authentication failed. Check credentials  -  "
        "HORIZON_API_ID/HORIZON_API_KEY for API key auth, "
        "client certificate for mTLS, or re-authenticate via browser."
    ),
    "SecPerm001": (
        "Insufficient permissions. Check role assignments for the authenticated principal."
    ),
}


class HorizonError(Exception):
    """Structured error from Horizon API with remediation hints."""

    def __init__(
        self,
        status_code: int,
        error_code: str | None = None,
        message: str = "",
        detail: str | None = None,
        remediation: str | None = None,
        raw: dict[str, Any] | None = None,
    ) -> None:
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.detail = detail
        self.remediation = remediation
        self.raw = raw or {}
        super().__init__(self._format())

    def _format(self) -> str:
        parts = [f"Horizon API error {self.status_code}"]
        if self.error_code:
            parts[0] += f" [{self.error_code}]"
        if self.message:
            parts.append(self.message)
        if self.detail:
            parts.append(f"Detail: {self.detail}")
        if self.remediation:
            parts.append(f"Hint: {self.remediation}")
        return ". ".join(parts)

    def to_tool_result(self) -> str:
        """Format for MCP tool error response."""
        return self._format()


def _redact_sensitive(data: Any) -> Any:
    """Redact sensitive field values from error details."""
    if isinstance(data, dict):
        return {
            k: "<redacted>" if k in _SENSITIVE_FIELDS else _redact_sensitive(v)
            for k, v in data.items()
        }
    if isinstance(data, list):
        return [_redact_sensitive(item) for item in data]
    return data


def _resolve_remediation(error_code: str | None) -> str | None:
    """Find the best remediation hint for an error code."""
    if not error_code:
        return None
    # Check specific codes first
    if error_code in _SPECIFIC_REMEDIATION:
        return _SPECIFIC_REMEDIATION[error_code]
    # Check suffix pattern
    suffix = error_code.rsplit("-", 1)[-1] if "-" in error_code else ""
    return _REMEDIATION_MAP.get(suffix)


def parse_error_response(status_code: int, body: bytes | str) -> HorizonError:
    """Parse a Horizon error response into a structured HorizonError."""
    raw: dict[str, Any] = {}
    try:
        raw = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        return HorizonError(
            status_code=status_code,
            message=str(body)[:500] if body else f"HTTP {status_code}",
        )

    raw = _redact_sensitive(raw)

    # Horizon error responses vary: "error" can be a string code or a nested object
    raw_error = raw.get("error")
    if isinstance(raw_error, dict):
        error_code = raw_error.get("code") or raw_error.get("error")
        message = raw_error.get("message") or raw.get("message") or raw.get("title") or ""
        detail = raw_error.get("detail") or raw.get("detail")
    else:
        error_code = raw_error or raw.get("code")
        message = raw.get("message") or raw.get("title") or ""
        detail = raw.get("detail")

    # Ensure error_code is always a string or None
    if error_code is not None and not isinstance(error_code, str):
        error_code = str(error_code)

    remediation = _resolve_remediation(error_code)

    return HorizonError(
        status_code=status_code,
        error_code=error_code,
        message=message,
        detail=detail,
        remediation=remediation,
        raw=raw,
    )
