"""Query language validation and introspection tools.

5 tools covering the four Horizon query languages (HCQL, HRQL, HEQL, HDQL)
plus a local field-metadata tool for discovering available fields and syntax.

Knowledge resources:
    - horizon://knowledge/query-languages
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.assist.query")

# ---------------------------------------------------------------------------
# Field metadata — pre-built from known Horizon source fields
# ---------------------------------------------------------------------------

_COMMON_DATE_FORMATS = [
    "now",
    "today",
    "YYYY",
    "YYYY-MM",
    "YYYY-MM-DD",
    "YYYY-MM-DDTHH",
    "YYYY-MM-DDTHH:mm",
    "YYYY-MM-DDTHH:mm:ss",
    "30d (relative, unquoted — days)",
    "24h (relative, unquoted — hours)",
    "5m (relative, unquoted — minutes)",
    "60s (relative, unquoted — seconds)",
    "-30d (negative relative — 30 days in the past)",
]

_COMMON_COMBINATORS = [
    "and (&&)",
    "or (||)",
    "not",
    "parentheses",
]

_HCQL_FIELDS: list[dict[str, str]] = [
    {"name": "dn", "type": "string"},
    {"name": "serial", "type": "string"},
    {"name": "issuer", "type": "string"},
    {"name": "profile", "type": "string"},
    {"name": "module", "type": "string"},
    {"name": "owner", "type": "string"},
    {"name": "team", "type": "string"},
    {"name": "san", "type": "string"},
    {"name": "holderid", "type": "string"},
    {"name": "contactemail", "type": "string"},
    {"name": "keytype", "type": "string"},
    {"name": "primarykeytype", "type": "string"},
    {"name": "alternatekeytype", "type": "string"},
    {"name": "signingalgorithm", "type": "string"},
    {"name": "thumbprint", "type": "string"},
    {"name": "publickeythumbprint", "type": "string"},
    {"name": "valid.from", "type": "date"},
    {"name": "valid.until", "type": "date"},
    {"name": "revocation.date", "type": "date"},
    {"name": "revocation.reason", "type": "string"},
    {"name": "purge.date", "type": "date"},
    {"name": "id", "type": "id"},
    {"name": "grade", "type": "grade"},
    {"name": "grade.*", "type": "grade"},
    {"name": "trigger.results", "type": "special"},
    {"name": "label.*", "type": "string"},
    {"name": "metadata.<key>", "type": "string", "note": "restricted keys: pki_connector, scep_transid, certeurope_id, digicert_id, digicert_order_id, entrust_id, fcms_id, gsatlas_id, gs_order_id, metapki_id, eviden_idca_id, nameshield_id, renewed_certificate_id, previous_certificate_id, automation_policy, contact_email"},
    {"name": "discoverydata.ip", "type": "string"},
    {"name": "discoverydata.tls.version", "type": "string"},
    {"name": "discoverydata.hostnames", "type": "string"},
    {"name": "discoverydata.operatingsystems", "type": "string"},
    {"name": "discoverydata.sources", "type": "string"},
    {"name": "discoverydata.tls.port", "type": "number"},
    {"name": "discoveryinfo.campaign", "type": "string"},
    {"name": "thirdparty.connector", "type": "string"},
    {"name": "thirdparty.id", "type": "string"},
    {"name": "thirdparty.fingerprint", "type": "string"},
]

_HCQL_SPECIAL_CONDITIONS = [
    "status is [not] expired|revoked|valid",
    "certificate is [not] archived|escrowed|trusted|selfsigned|discovered",
    "certificatetype is [not] hybrid|legacy|pqc|unknown",
    "trigger.results has [no] success|failure|warning",
]

_HCQL_GROUPBY_FIELDS = ["profile", "module", "keytype", "owner", "team"]

_HRQL_FIELDS: list[dict[str, str]] = [
    {"name": "id", "type": "id"},
    {"name": "module", "type": "string"},
    {"name": "workflow", "type": "string"},
    {"name": "profile", "type": "string"},
    {"name": "status", "type": "string"},
    {"name": "requester", "type": "string"},
    {"name": "approver", "type": "string"},
    {"name": "team", "type": "string"},
    {"name": "owner", "type": "string"},
    {"name": "contact", "type": "string"},
    {"name": "dn", "type": "string"},
    {"name": "holderid", "type": "string"},
    {"name": "comment.requester", "type": "string"},
    {"name": "comment.approver", "type": "string"},
    {"name": "registration.date", "type": "date"},
    {"name": "modification.date", "type": "date"},
    {"name": "expiration.date", "type": "date"},
    {"name": "label.*", "type": "string"},
]

_HRQL_SPECIAL_CONDITIONS = [
    "request is [not] valid|expired",
]

_HEQL_FIELDS: list[dict[str, str]] = [
    {"name": "id", "type": "id"},
    {"name": "code", "type": "string"},
    {"name": "node", "type": "string"},
    {"name": "module", "type": "string"},
    {"name": "status", "type": "string"},
    {"name": "timestamp", "type": "date"},
    {"name": "purge.date", "type": "date"},
    {"name": "detail.*", "type": "string"},
]

_HDQL_FIELDS: list[dict[str, str]] = [
    {"name": "id", "type": "id"},
    {"name": "code", "type": "string"},
    {"name": "status", "type": "string"},
    {"name": "campaign", "type": "string"},
    {"name": "hostname", "type": "string"},
    {"name": "ip", "type": "string"},
    {"name": "port", "type": "number"},
    {"name": "source", "type": "string"},
    {"name": "actorid", "type": "string"},
    {"name": "certificateid", "type": "id"},
    {"name": "sessionid", "type": "id"},
    {"name": "error.code", "type": "string"},
    {"name": "error.message", "type": "string"},
    {"name": "client.version", "type": "string"},
    {"name": "client.ip", "type": "string"},
    {"name": "client.id", "type": "string"},
    {"name": "timestamp", "type": "date"},
]

_QUERY_METADATA: dict[str, dict[str, Any]] = {
    "hcql": {
        "query_type": "hcql",
        "description": "Horizon Certificate Query Language — search certificates",
        "fields": _HCQL_FIELDS,
        "special_conditions": _HCQL_SPECIAL_CONDITIONS,
        "date_formats": _COMMON_DATE_FORMATS,
        "combinators": _COMMON_COMBINATORS,
        "supports_aggregate": True,
        "groupby_fields": _HCQL_GROUPBY_FIELDS,
        "examples": [
            'dn matches ".*example.com" and status is valid',
            'valid.until before 30d and profile equals "MyProfile"',
            'contactemail equals "admin@example.com" and keytype contains "rsa"',
        ],
    },
    "hrql": {
        "query_type": "hrql",
        "description": "Horizon Request Query Language — search workflow requests",
        "fields": _HRQL_FIELDS,
        "special_conditions": _HRQL_SPECIAL_CONDITIONS,
        "date_formats": _COMMON_DATE_FORMATS,
        "combinators": _COMMON_COMBINATORS,
        "supports_aggregate": True,
        "groupby_fields": ["profile", "module", "workflow", "status", "requester", "team"],
        "examples": [
            'workflow equals "enroll" and status equals "pending"',
            'requester equals "admin" and registration.date after 7d',
        ],
    },
    "heql": {
        "query_type": "heql",
        "description": "Horizon Event Query Language — search audit events",
        "fields": _HEQL_FIELDS,
        "special_conditions": [],
        "date_formats": _COMMON_DATE_FORMATS,
        "combinators": _COMMON_COMBINATORS,
        "supports_aggregate": False,
        "groupby_fields": [],
        "examples": [
            'code equals "LIFECYCLE-ENROLL" and timestamp after -24h',
            'detail.actorId equals "admin" and detail.certificateDn matches ".*example.com"',
        ],
    },
    "hdql": {
        "query_type": "hdql",
        "description": "Horizon Discovery Query Language — search discovery events",
        "fields": _HDQL_FIELDS,
        "special_conditions": [],
        "date_formats": _COMMON_DATE_FORMATS,
        "combinators": _COMMON_COMBINATORS,
        "supports_aggregate": False,
        "groupby_fields": [],
        "examples": [
            'hostname matches ".*example.com"',
            'campaign equals "weekly-scan" and timestamp after 7d',
        ],
    },
}

_VALID_QUERY_TYPES = sorted(_QUERY_METADATA.keys())

# ---------------------------------------------------------------------------
# Validation endpoints per query language
# ---------------------------------------------------------------------------

# Horizon has no dedicated /validate endpoints. Validation is done by
# executing a minimal search (pageSize=1) — an invalid query triggers
# a parse error from the server, confirming syntax validity on success.
_SEARCH_ENDPOINTS: dict[str, str] = {
    "hcql": "/api/v1/certificates/search",
    "hrql": "/api/v1/requests/search",
    "heql": "/api/v1/events/search",
    "hdql": "/api/v1/discovery/events/search",
}


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_query_tools(mcp: FastMCP) -> None:
    """Register query validation and introspection tools on *mcp*."""

    from horizon_mcp.client.state import get_client

    async def _validate_query(query_type: str, query: str) -> str:
        """Validate a query by executing a minimal search (pageSize=1).

        If the query is syntactically invalid, Horizon returns a parse error.
        On success, returns a confirmation with match info.
        """
        client = get_client()
        endpoint = _SEARCH_ENDPOINTS[query_type]
        try:
            result = await client.post(
                endpoint,
                json={"query": query, "pageSize": 1},
            )
        except Exception as exc:
            return json.dumps({
                "valid": False,
                "query_type": query_type.upper(),
                "query": query,
                "error": str(exc),
            })
        # If we got here, the query parsed successfully
        count = result.get("count")
        has_more = result.get("hasMore")
        return json.dumps({
            "valid": True,
            "query_type": query_type.upper(),
            "query": query,
            "count": count,
            "has_more": has_more,
        })

    @mcp.tool()
    async def validate_hcql(query: str) -> str:
        """Validate an HCQL (certificate search) query expression.

        Safety tier: read-only
        Knowledge: horizon://knowledge/query-languages

        Validates the query by executing a minimal search (pageSize=1).
        If the query syntax is invalid, Horizon returns a parse error.
        On success, confirms the query is valid and reports match info.

        Args:
            query: HCQL query string to validate. Field names MUST be lowercase
                   (contactemail, keytype — NOT contactEmail, keyType).
                   Example: ``dn matches ".*example.com" and status is valid``.

        Returns:
            JSON with valid (bool), query_type, query, and error or count.
        """
        return await _validate_query("hcql", query)

    @mcp.tool()
    async def validate_hrql(query: str) -> str:
        """Validate an HRQL (request search) query expression.

        Safety tier: read-only
        Knowledge: horizon://knowledge/query-languages

        Validates the query by executing a minimal search (pageSize=1).

        Args:
            query: HRQL query string to validate. Field names MUST be lowercase
                   (registration.date, modification.date — NOT registrationDate).
                   Example: ``workflow equals "enroll" and registration.date before 7d``.

        Returns:
            JSON with valid (bool), query_type, query, and error or count.
        """
        return await _validate_query("hrql", query)

    @mcp.tool()
    async def validate_heql(query: str) -> str:
        """Validate an HEQL (event search) query expression.

        Safety tier: read-only
        Knowledge: horizon://knowledge/query-languages

        Validates the query by executing a minimal search (pageSize=1).

        Args:
            query: HEQL query string to validate. Field names MUST be lowercase
                   (code, timestamp — NOT eventType, eventDate).
                   Example: ``code equals "LIFECYCLE-ENROLL" and timestamp after 24h``.

        Returns:
            JSON with valid (bool), query_type, query, and error or count.
        """
        return await _validate_query("heql", query)

    @mcp.tool()
    async def validate_hdql(query: str) -> str:
        """Validate an HDQL (discovery event search) query expression.

        Safety tier: read-only
        Knowledge: horizon://knowledge/query-languages

        Validates the query by executing a minimal search (pageSize=1).

        Args:
            query: HDQL query string to validate. Field names MUST be lowercase
                   (certificateid, sessionid — NOT certificateId, sessionId).
                   Example: ``certificateid equals "abc123" and timestamp after -24h``.

        Returns:
            JSON with valid (bool), query_type, query, and error or count.
        """
        return await _validate_query("hdql", query)

    @mcp.tool()
    async def describe_query_fields(query_type: str) -> str:
        """Discover available fields and syntax for Horizon query languages.

        See horizon://knowledge/query-languages.

        Safety tier: read-only (local — no API call)

        Returns field metadata, supported operators, date formats, and
        example queries for the specified query language type. This is a
        local tool that does not make any API calls.

        Args:
            query_type: Query language type — one of: hcql, hrql, heql, hdql.

        Returns:
            JSON with fields, special_conditions, date_formats, combinators,
            aggregate support, groupby fields, and example queries.
        """
        normalized = query_type.strip().lower()
        if normalized not in _QUERY_METADATA:
            return json.dumps({
                "error": f"Unknown query type '{query_type}'.",
                "valid_types": _VALID_QUERY_TYPES,
                "hint": "Use one of: hcql (certificates), hrql (requests), "
                        "heql (events), hdql (discovery).",
            })
        return json.dumps(_QUERY_METADATA[normalized])
