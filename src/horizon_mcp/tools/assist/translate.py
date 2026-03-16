"""Natural language to HQL translation tool.

1 tool: translate_to_hql

Translates natural language descriptions into syntactically valid
Horizon Query Language expressions (HCQL, HRQL, HEQL, or HDQL).

Every query fragment is assembled from whitelisted, known-valid patterns
so the output is syntactically correct by construction.  An optional
validation step confirms it against the live Horizon instance.

Knowledge resources:
    - horizon://knowledge/query-languages
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.assist.translate")


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class _Condition:
    """A single HQL condition with its human-readable explanation."""
    fragment: str
    reason: str
    confidence: float = 0.9


# ---------------------------------------------------------------------------
# Intent detection — weighted keyword scoring
# ---------------------------------------------------------------------------

_INTENT_KEYWORDS: dict[str, dict[str, int]] = {
    "hcql": {
        "certificate": 10, "cert": 10, "certs": 10,
        "expir": 8, "revok": 8, "revocation": 8,
        "issuer": 7, "subject": 7, "dn": 7, "serial": 7,
        "key": 4, "rsa": 5, "ecdsa": 5, "eddsa": 5,
        "grade": 6, "san": 7, "thumbprint": 7,
        "selfsigned": 8, "self-signed": 8, "archived": 6,
        "discovered": 6, "escrowed": 6, "trusted": 5,
        "keytype": 7,
    },
    "hrql": {
        "request": 10, "requests": 10,
        "enroll": 9, "enrollment": 9,
        "approv": 9, "approval": 9, "approved": 9,
        "deny": 9, "denied": 9, "rejection": 9,
        "pending": 8, "workflow": 8,
        "requester": 7, "cancel": 7, "cancelled": 7,
        "submit": 7, "submitted": 7,
    },
    "heql": {
        "event": 10, "events": 10,
        "audit": 10, "log": 8, "logs": 8,
        "action": 5, "activity": 6, "node": 6,
    },
    "hdql": {
        "discover": 10, "discovery": 10,
        "scan": 9, "netscan": 9,
        "host": 8, "hostname": 8,
        "port": 7, "tls": 8,
        "campaign": 7, "network": 6, "ip": 6,
    },
}

# Shared keywords (weak signal — only used for tie-breaking)
_SHARED_KEYWORDS: dict[str, int] = {
    "profile": 2, "team": 2, "owner": 2, "module": 2,
}


def _detect_intent(text: str) -> tuple[str, float]:
    """Score *text* against intent keywords; return (query_type, confidence)."""
    lower = text.lower()
    scores: dict[str, int] = {qt: 0 for qt in _INTENT_KEYWORDS}

    for qt, keywords in _INTENT_KEYWORDS.items():
        for kw, weight in keywords.items():
            if re.search(rf"\b{re.escape(kw)}\w*\b", lower):
                scores[qt] += weight

    # Add shared keywords to all types equally (tie-break only)
    for kw, weight in _SHARED_KEYWORDS.items():
        if re.search(rf"\b{re.escape(kw)}\w*\b", lower):
            for qt in scores:
                scores[qt] += weight

    best = max(scores, key=lambda k: scores[k])
    total = sum(scores.values())

    if total == 0:
        return "hcql", 0.3  # default fallback

    confidence = scores[best] / max(total, 1)
    if scores[best] >= 10:
        confidence = min(confidence + 0.2, 1.0)
    return best, round(confidence, 2)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _to_duration(amount: int, unit: str) -> str:
    """Convert (amount, unit) to an HQL duration string like ``30d``."""
    if unit in ("day", "days"):
        return f"{amount}d"
    if unit in ("hour", "hours"):
        return f"{amount}h"
    if unit in ("minute", "minutes"):
        return f"{amount}m"
    if unit in ("second", "seconds"):
        return f"{amount}s"
    if unit in ("week", "weeks"):
        return f"{amount * 7}d"
    if unit in ("month", "months"):
        return f"{amount * 30}d"
    return f"{amount}d"


_DEFAULT_DATE_FIELDS: dict[str, dict[str, str]] = {
    "hcql":  {"future": "valid.until",      "past": "valid.from"},
    "hrql":  {"future": "expiration.date",   "past": "registration.date"},
    "heql":  {"future": "timestamp",         "past": "timestamp"},
    "hdql":  {"future": "timestamp",         "past": "timestamp"},
}


def _extract_date_conditions(
    text: str, conditions: list[_Condition], query_type: str,
) -> None:
    """Append date-related conditions extracted from *text*."""

    # "next / within / coming N units"
    m = re.search(
        r"(?:in\s+the\s+)?(?:next|within|coming)\s+(\d+)\s+"
        r"(day|hour|minute|second|week|month)s?",
        text,
    )
    if m:
        dur = _to_duration(int(m.group(1)), m.group(2))
        # Context: "expiring in next 30 days" → valid.until before 30d
        if re.search(r"expir", text):
            field = "valid.until"
        else:
            field = _DEFAULT_DATE_FIELDS[query_type]["future"]
        conditions.append(_Condition(
            f"{field} before {dur}",
            f"within the next {m.group(1)} {m.group(2)}(s)",
        ))
        return

    # "last / past / previous N units"
    m = re.search(
        r"(?:in\s+the\s+)?(?:last|past|previous)\s+(\d+)\s+"
        r"(day|hour|minute|second|week|month)s?",
        text,
    )
    if m:
        dur = _to_duration(int(m.group(1)), m.group(2))
        field = _DEFAULT_DATE_FIELDS[query_type]["past"]
        if re.search(r"expir", text):
            field = "valid.until"
        elif re.search(r"revok|revoc", text) and query_type == "hcql":
            field = "revocation.date"  # only HCQL has revocation.date
        elif re.search(r"register|submit", text):
            field = "registration.date"
        conditions.append(_Condition(
            f"{field} after -{dur}",
            f"in the last {m.group(1)} {m.group(2)}(s)",
        ))
        return

    # "expiring in N days" (without explicit next/last)
    m = re.search(
        r"expir\w*\s+(?:in\s+)?(\d+)\s+(day|hour|minute|week|month)s?",
        text,
    )
    if m:
        dur = _to_duration(int(m.group(1)), m.group(2))
        conditions.append(_Condition(
            f"valid.until before {dur}",
            f"expiring within {m.group(1)} {m.group(2)}(s)",
        ))
        return

    # "expiring soon" (no number)
    if re.search(r"expir\w*\s+soon", text):
        conditions.append(_Condition(
            "valid.until before 30d",
            "expiring soon (within 30 days)",
        ))


def _glob_to_regex(glob: str) -> str:
    """Convert a shell-like glob to a regex suitable for HQL ``matches``."""
    return glob.replace(".", r"\.").replace("*", ".*").replace("?", ".")


def _choose_operator(value: str, field: str) -> tuple[str, str]:
    """Pick the best HQL operator and formatted value.

    Returns (operator, formatted_value) — always producing valid,
    copy-paste-ready HQL (no unnecessary escape characters).
    """
    if "*" in value or "?" in value:
        return "matches", _glob_to_regex(value)
    if field in ("dn", "issuer", "san") and "." in value:
        # Use contains for simple domain-like values — cleaner than regex
        return "contains", value
    return "equals", value


# Field-value extraction patterns: (regex, hql_field, label)
_FIELD_PATTERNS: dict[str, list[tuple[str, str, str]]] = {
    "hcql": [
        (r'profile\s+(?:named?\s+|called\s+|=\s*)?["\']?([\w][\w.-]*)["\']?',
         "profile", "profile"),
        (r'team\s+(?:named?\s+|called\s+|=\s*)?["\']?([\w][\w.-]*)["\']?',
         "team", "team"),
        (r'owner\s+(?:is\s+|=\s*)?["\']?([\w@._-]+)["\']?',
         "owner", "owner"),
        (r'issuer\s+(?:is\s+|=\s*|contains?\s+)?["\']?([\w\s.*=,-]+?)["\']?(?:\s+and\b|\s*$)',
         "issuer", "issuer"),
        (r'(?:subject|dn)\s+(?:match(?:es|ing)?\s+|contains?\s+|=\s*)?["\']?([\w\s.*=,-]+?)["\']?(?:\s+and\b|\s*$)',
         "dn", "subject/DN"),
        (r'(?:module|connector)\s+(?:named?\s+|=\s*)?["\']?([\w][\w.-]*)["\']?',
         "module", "module"),
        (r'(?:san|subject.alt)\w*\s+(?:contains?\s+|match(?:es|ing)?\s+)?["\']?([\w.*@-]+)["\']?',
         "san", "SAN"),
    ],
    "hrql": [
        (r'profile\s+(?:named?\s+|called\s+|=\s*)?["\']?([\w][\w.-]*)["\']?',
         "profile", "profile"),
        (r'team\s+(?:named?\s+|called\s+|=\s*)?["\']?([\w][\w.-]*)["\']?',
         "team", "team"),
        (r'requester\s+(?:is\s+|=\s*)?["\']?([\w@._-]+)["\']?',
         "requester", "requester"),
        (r'owner\s+(?:is\s+|=\s*)?["\']?([\w@._-]+)["\']?',
         "owner", "owner"),
        (r'(?:module|connector)\s+(?:named?\s+|=\s*)?["\']?([\w][\w.-]*)["\']?',
         "module", "module"),
    ],
    "heql": [
        (r'(?:module|connector)\s+(?:named?\s+|=\s*)?["\']?([\w][\w.-]*)["\']?',
         "module", "module"),
        (r'node\s+(?:named?\s+|=\s*)?["\']?([\w][\w.-]*)["\']?',
         "node", "node"),
    ],
    "hdql": [
        (r'source\s+(?:is\s+|=\s*)?["\']?([\w][\w.-]*)["\']?',
         "source", "source"),
    ],
}


def _extract_field_values(
    text: str, conditions: list[_Condition], query_type: str,
) -> None:
    """Append field=value conditions extracted from *text*."""
    for pattern, hql_field, label in _FIELD_PATTERNS.get(query_type, []):
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            raw = m.group(1).strip().strip("'\"")
            if not raw:
                continue
            op, val = _choose_operator(raw, hql_field)
            conditions.append(_Condition(
                f'{hql_field} {op} "{val}"',
                f"{label} matching '{raw}'" if op == "matches" else f"{label} is '{raw}'",
            ))


# ---------------------------------------------------------------------------
# Per-type condition extractors
# ---------------------------------------------------------------------------

def _extract_hcql(text: str) -> list[_Condition]:
    conditions: list[_Condition] = []
    lower = text.lower()

    # --- Status ---
    _status_map = [("expired", r"expired?"), ("revoked", r"revoked?"), ("valid", r"valid")]
    for status, pat in _status_map:
        if re.search(rf"\bnot?\s+{pat}\b", lower):
            conditions.append(_Condition(f"status is not {status}", f"non-{status} certificates"))
        elif re.search(rf"\b{pat}\b", lower):
            # Avoid matching "valid.until" as a status reference
            if status == "valid" and re.search(r"valid\.\w+", lower):
                continue
            conditions.append(_Condition(f"status is {status}", f"{status} certificates"))

    # --- Certificate properties ---
    _props = [
        ("selfsigned", r"self[- ]?signed"),
        ("archived", r"archived?"),
        ("discovered", r"discovered?"),
        ("escrowed", r"escrowed?"),
        ("trusted", r"trusted"),
    ]
    for prop, pat in _props:
        if re.search(rf"\bnot?\s+{pat}\b", lower):
            conditions.append(_Condition(f"certificate is not {prop}", f"not {prop}"))
        elif re.search(rf"\b{pat}\b", lower):
            conditions.append(_Condition(f"certificate is {prop}", f"{prop} certificates"))

    # --- Certificate type ---
    for ctype in ("hybrid", "legacy", "pqc"):
        if re.search(rf"\b{ctype}\b", lower):
            conditions.append(_Condition(
                f'certificatetype is {ctype}', f"{ctype} certificate type",
            ))

    # --- Key type ---
    for kt, pat in [("rsa", r"rsa"), ("ec", r"ecdsa|elliptic\s+curve"), ("eddsa", r"eddsa|ed25519|edwards")]:
        if re.search(rf"\b(?:{pat})\b", lower):
            conditions.append(_Condition(f'keytype contains "{kt}"', f"{kt.upper()} key type"))
            break

    # --- Grade ---
    m = re.search(r"grade\s+(?:worse|lower|below)\s+(?:than\s+)?([a-f])\b", lower)
    if m:
        conditions.append(_Condition(
            f"grade strictly lower than {m.group(1).upper()}",
            f"grade worse than {m.group(1).upper()}",
        ))
    m = re.search(r"grade\s+(?:better|higher|above)\s+(?:than\s+)?([a-f])\b", lower)
    if m:
        conditions.append(_Condition(
            f"grade strictly greater than {m.group(1).upper()}",
            f"grade better than {m.group(1).upper()}",
        ))

    # --- Trigger results ---
    if re.search(r"trigger.*fail|failed?\s+trigger", lower):
        conditions.append(_Condition("trigger.results has failure", "failed triggers"))
    elif re.search(r"trigger.*warn", lower):
        conditions.append(_Condition("trigger.results has warning", "trigger warnings"))

    # --- Dates ---
    _extract_date_conditions(lower, conditions, "hcql")

    # --- Field-value pairs ---
    _extract_field_values(text, conditions, "hcql")

    return conditions


def _extract_hrql(text: str) -> list[_Condition]:
    conditions: list[_Condition] = []
    lower = text.lower()

    # --- Workflow type ---
    _wf_map = [
        ("enroll", r"enroll"),
        ("revoke", r"revok|revocation"),
        ("renew", r"renew"),
        ("update", r"updat"),
        ("recover", r"recover"),
        ("migrate", r"migrat"),
        ("import", r"import"),
    ]
    for wf, pat in _wf_map:
        if re.search(rf"\b{pat}", lower):
            conditions.append(_Condition(f'workflow equals "{wf}"', f"{wf} workflow"))
            break

    # --- Request status ---
    _status_map = [
        ("pending", r"pending"),
        ("approved", r"approved?"),
        ("denied", r"denied?|rejected?"),
        ("cancelled", r"cancell?ed"),
    ]
    for status, pat in _status_map:
        if re.search(rf"\b{pat}\b", lower):
            conditions.append(_Condition(f'status equals "{status}"', f"{status} requests"))
            break

    _extract_date_conditions(lower, conditions, "hrql")
    _extract_field_values(text, conditions, "hrql")
    return conditions


def _extract_heql(text: str) -> list[_Condition]:
    conditions: list[_Condition] = []
    lower = text.lower()

    # --- Module filter (protocol / subsystem) ---
    # When a protocol or subsystem is mentioned, filter on `module` to
    # capture ALL related events rather than guessing a single event code.
    _module_map: list[tuple[str, str, str]] = [
        # (pattern, module_value, label)
        (r"\bacme\b", "ACME", "ACME"),
        (r"\bscep\b", "SCEP", "SCEP"),
        (r"\best\b", "EST", "EST"),
        (r"\bwcce\b", "WCCE", "WCCE"),
        (r"\bcrmp\b", "CRMP", "CRMP"),
        (r"\bwebra\b", "WEBRA", "WebRA"),
        (r"\bintune\b", "INTUNE", "Intune"),
        (r"\bjamf\b", "JAMF", "Jamf"),
    ]

    module_found = False
    for pat, module_val, label in _module_map:
        if re.search(pat, lower):
            conditions.append(_Condition(
                f'module equals "{module_val}"', f"{label} events",
            ))
            module_found = True
            break

    # --- Event code filter (only when no module detected) ---
    # Generic action words → specific event codes via `code` field.
    if not module_found:
        _code_map: list[tuple[str, str, str]] = [
            # --- Lifecycle events ---
            (r"\benroll", "LIFECYCLE-ENROLL", "enrollment"),
            (r"\brevok|revocation", "LIFECYCLE-REVOKE", "revocation"),
            (r"\brenew", "LIFECYCLE-RENEW", "renewal"),
            (r"\bupdat", "LIFECYCLE-UPDATE", "update"),
            (r"\brecover", "LIFECYCLE-RECOVER", "recovery"),
            (r"\bmigrat", "LIFECYCLE-MIGRATE", "migration"),
            (r"\bimport", "LIFECYCLE-IMPORT", "import"),
            (r"\bescrow", "LIFECYCLE-ESCROW", "key escrow"),
            # --- Request events ---
            (r"\brequest.*submit|submit.*request", "REQUEST-SUBMIT", "request submission"),
            (r"\brequest.*approv|approv.*request", "REQUEST-APPROVE", "request approval"),
            (r"\brequest.*deny|deny.*request|denied", "REQUEST-DENY", "request denial"),
            (r"\brequest.*cancel|cancel.*request", "REQUEST-CANCEL", "request cancellation"),
            # --- Security events ---
            (r"\bauthenticat", "SEC-AUTHENTICATION", "authentication"),
            (r"\brole", "SEC-ROLE", "role management"),
            (r"\bteam", "SEC-TEAM", "team management"),
            # --- Trigger events ---
            (r"\btrigger.*email|email.*trigger", "TRIGGER-EMAIL", "email trigger"),
            (r"\btrigger.*push|push.*trigger", "TRIGGER-PUSH", "certificate push"),
            (r"\btrigger", "TRIGGER", "trigger"),
            # --- Config events ---
            (r"\bconfig.*add|config.*creat", "CONF-ADD", "configuration addition"),
            (r"\bconfig.*delet|config.*remov", "CONF-DELETE", "configuration deletion"),
            (r"\bconfig.*updat|config.*modif", "CONF-UPDATE", "configuration update"),
            # --- Infrastructure events ---
            (r"\bservice.*start|start.*service", "SERVICE-START", "service start"),
            (r"\bservice.*stop|stop.*service", "SERVICE-STOP", "service stop"),
            (r"\blicen", "LICENSE", "license"),
            (r"\bgrad", "GRADING", "grading"),
            (r"\barchiv", "ARCHIVE", "archive"),
            (r"\bsync", "SYNC", "synchronization"),
            (r"\bdiscovery", "DISCOVERY", "discovery"),
            (r"\bbootstrap", "BOOTSTRAP", "bootstrap"),
        ]

        for pat, code, label in _code_map:
            if re.search(pat, lower):
                if "-" in code:
                    conditions.append(_Condition(
                        f'code equals "{code}"', f"{label} events",
                    ))
                else:
                    conditions.append(_Condition(
                        f'code contains "{code}"', f"{label} events",
                    ))
                break

    # --- HEQL detail.* fields ---
    # Certificate references → detail.certificateDn
    m = re.search(
        r"(?:certificate|cert)\s+(?:named?\s+|called\s+|for\s+)?"
        r"[\"']?([\w][\w.*-]*(?:\.[\w.*-]+)*)[\"']?",
        lower,
    )
    if m:
        val = m.group(1)
        # Preserve original case from the input text
        orig_m = re.search(
            r"(?:certificate|cert)\s+(?:named?\s+|called\s+|for\s+)?"
            r"[\"']?([\w][\w.*-]*(?:\.[\w.*-]+)*)[\"']?",
            text, re.IGNORECASE,
        )
        if orig_m:
            val = orig_m.group(1)
        conditions.append(_Condition(
            f'detail.certificateDn contains "{val}"',
            f"certificate matching '{val}'",
        ))

    # Actor/user references → detail.actorId
    m = re.search(
        r"(?:actor|user|by)\s+(?:is\s+)?[\"']?([\w@._-]+)[\"']?",
        text, re.IGNORECASE,
    )
    if m:
        val = m.group(1).strip("'\"")
        if val not in ("is", "the", "a", "an", "all"):
            conditions.append(_Condition(
                f'detail.actorId equals "{val}"',
                f"actor '{val}'",
            ))

    _extract_date_conditions(lower, conditions, "heql")
    _extract_field_values(text, conditions, "heql")
    return conditions


def _extract_hdql(text: str) -> list[_Condition]:
    conditions: list[_Condition] = []
    lower = text.lower()

    # --- Port ---
    m = re.search(r"\bport\s+(\d+)\b", lower)
    if m:
        conditions.append(_Condition(f"port equals {m.group(1)}", f"port {m.group(1)}"))

    # --- IP ---
    m = re.search(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:/\d{1,2})?)\b", lower)
    if m:
        conditions.append(_Condition(f'ip equals "{m.group(1)}"', f"IP {m.group(1)}"))

    # --- Hostname ---
    m = re.search(
        r"(?:host(?:name)?|domain|server)\s+(?:is\s+|named?\s+)?"
        r"[\"']?([\w.*-]+\.[\w.*-]+)[\"']?",
        lower,
    )
    if m:
        hostname = m.group(1)
        if "*" in hostname:
            regex = _glob_to_regex(hostname)
            conditions.append(_Condition(f'hostname matches "{regex}"', f"hostname matching {hostname}"))
        else:
            conditions.append(_Condition(f'hostname equals "{hostname}"', f"hostname {hostname}"))

    # --- Campaign ---
    m = re.search(r'campaign\s+(?:named?\s+)?["\']?([\w-]+)["\']?', lower)
    if m:
        conditions.append(_Condition(f'campaign equals "{m.group(1)}"', f"campaign '{m.group(1)}'"))

    _extract_date_conditions(lower, conditions, "hdql")
    _extract_field_values(text, conditions, "hdql")
    return conditions


# ---------------------------------------------------------------------------
# Assembler + validator
# ---------------------------------------------------------------------------

_EXTRACTORS: dict[str, Any] = {
    "hcql": _extract_hcql,
    "hrql": _extract_hrql,
    "heql": _extract_heql,
    "hdql": _extract_hdql,
}

_SEARCH_ENDPOINTS: dict[str, str] = {
    "hcql": "/api/v1/certificates/search",
    "hrql": "/api/v1/requests/search",
    "heql": "/api/v1/events/search",
    "hdql": "/api/v1/discovery/events/search",
}

_TYPE_LABELS: dict[str, str] = {
    "hcql": "HCQL (Horizon Certificate Query Language)",
    "hrql": "HRQL (Horizon Request Query Language)",
    "heql": "HEQL (Horizon Event Query Language)",
    "hdql": "HDQL (Horizon Discovery Query Language)",
}


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_translate_tools(mcp: "FastMCP") -> None:
    """Register the natural-language → HQL translation tool on *mcp*."""

    from horizon_mcp.client.state import get_client

    @mcp.tool()
    async def translate_to_hql(
        natural_language: str,
        target_type: str | None = None,
        validate: bool = True,
    ) -> str:
        """Translate natural language into a Horizon Query Language expression.

        Safety tier: read-only
        Knowledge: horizon://knowledge/query-languages

        Takes a plain-English description and produces a syntactically valid
        HQL query.  Auto-detects the appropriate query type (HCQL for
        certificates, HRQL for requests, HEQL for events, HDQL for discovery)
        unless *target_type* is specified.

        The generated query is optionally validated against the live Horizon
        instance to confirm syntactic correctness and report match counts.

        Args:
            natural_language: Plain-English description of what to search for.
                Examples:
                - "expired RSA certificates from team-alpha"
                - "pending enrollment requests for the ACME profile"
                - "audit events in the last 24 hours"
                - "discovery scans on port 443"
            target_type: Force a specific query type (hcql, hrql, heql, hdql).
                         If omitted the type is auto-detected from the input.
            validate: Whether to validate the query against Horizon
                      (default true).  Set to false for offline usage.

        Returns:
            JSON with query_type, query, confidence, explanation[],
            and optionally validation results (valid, count, has_more).
        """
        # --- Phase 1: detect query type ---
        if target_type:
            qt = target_type.strip().lower()
            if qt not in _EXTRACTORS:
                return json.dumps({
                    "error": f"Unknown query type '{target_type}'.",
                    "valid_types": sorted(_EXTRACTORS),
                })
            intent_confidence = 1.0
        else:
            qt, intent_confidence = _detect_intent(natural_language)

        # --- Phase 2: extract conditions ---
        conditions = _EXTRACTORS[qt](natural_language)

        if not conditions:
            from horizon_mcp.tools.assist.query import _QUERY_METADATA
            return json.dumps({
                "query_type": qt,
                "type_label": _TYPE_LABELS[qt],
                "query": None,
                "confidence": round(intent_confidence * 0.5, 2),
                "message": (
                    "Could not extract specific search conditions from the input. "
                    "Use the field reference below to construct the query manually, "
                    "or rephrase with specific field names, values, or date ranges."
                ),
                "field_reference": _QUERY_METADATA[qt],
            })

        # --- Phase 3: assemble query ---
        query = " and ".join(c.fragment for c in conditions)
        avg_conf = sum(c.confidence for c in conditions) / len(conditions)
        overall = round(min(intent_confidence, avg_conf), 2)

        result: dict[str, Any] = {
            "query_type": qt,
            "type_label": _TYPE_LABELS[qt],
            "query": query,
            "confidence": overall,
            "explanation": [
                {"fragment": c.fragment, "reason": c.reason}
                for c in conditions
            ],
        }

        # --- Phase 4: validate against live Horizon ---
        if validate:
            try:
                client = get_client()
                endpoint = _SEARCH_ENDPOINTS[qt]
                resp = await client.post(
                    endpoint, json={"query": query, "pageSize": 1},
                )
                result["validation"] = {
                    "valid": True,
                    "count": resp.get("count"),
                    "has_more": resp.get("hasMore"),
                }
            except Exception as exc:
                result["validation"] = {
                    "valid": False,
                    "error": str(exc),
                }

        return json.dumps(result)
