"""Phase 5 — Lifecycle tools: certificates, requests, events.

17 MCP tools covering the full Horizon certificate lifecycle:
  - Certificate search (2): search_certificates, export_certificates_csv
  - Certificate operations (2): get_certificate, download_certificate
  - Request management (8): get_request_template, submit_request,
    approve_request, deny_request, cancel_request, search_requests,
    get_request, export_requests_csv
  - Event audit (3): search_events, get_event, export_events_csv
  - Aggregation (2): aggregate_certificates, aggregate_requests
"""

from __future__ import annotations

import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from horizon_mcp.client.errors import HorizonError
from horizon_mcp.client.state import get_client

logger = logging.getLogger("horizon_mcp.tools.lifecycle")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MAX_PAGE_SIZE = 100
_MAX_CSV_ROWS = 1000
_CSV_TIMEOUT = 120
# Field-level truncation limits (search results only)
_MAX_STRING_LEN = 500
_MAX_ARRAY_ELEMENTS = 20
_MAX_NESTED_BYTES = 2048

# ---------------------------------------------------------------------------
# Search presets — default field sets
# ---------------------------------------------------------------------------

_CERT_PRESETS: dict[str, list[str]] = {
    "compact": [
        "dn", "serial", "profile", "module", "notAfter", "keyType", "owner", "team",
    ],
    "diagnostic": [
        "dn", "serial", "profile", "module", "notAfter", "keyType", "owner", "team",
        "revocationReason", "triggerResults",
        "discoverydata.source", "discoverydata.ip", "discoverydata.lastSeen",
        "contactemail",
    ],
    "compliance": [
        "dn", "serial", "profile", "module", "notAfter", "keyType", "owner", "team",
        "grade", "grade.details", "grade.score",
        "signingalgorithm", "keytype",
        "notBefore", "notAfter",
    ],
}

_REQUEST_PRESETS: dict[str, list[str]] = {
    "compact": [
        "workflow", "status", "profile", "module", "requester",
        "approver", "registrationDate", "lastModificationDate",
    ],
    "diagnostic": [
        "workflow", "status", "profile", "module", "requester",
        "approver", "registrationDate", "lastModificationDate",
        "certificate", "dn", "requesterComment", "approverComment",
    ],
    "compliance": [
        "workflow", "status", "profile", "module", "requester",
        "approver", "registrationDate", "lastModificationDate",
        "dn", "certificateId",
    ],
}


# ---------------------------------------------------------------------------
# Truncation helpers (search results only — not applied to get_certificate)
# ---------------------------------------------------------------------------

def _truncate_value(value: Any, field_path: str = "") -> Any:
    """Apply field-level truncation to a single value."""
    if isinstance(value, str) and len(value) > _MAX_STRING_LEN:
        return f"{value[:_MAX_STRING_LEN]}... <truncated: use get_certificate for full value>"

    if isinstance(value, list):
        total = len(value)
        truncated = [_truncate_value(item, field_path) for item in value[:_MAX_ARRAY_ELEMENTS]]
        if total > _MAX_ARRAY_ELEMENTS:
            truncated.append(f"<truncated: {total} total, showing first {_MAX_ARRAY_ELEMENTS}>")
        return truncated

    if isinstance(value, dict):
        serialized = json.dumps(value, default=str)
        if len(serialized.encode()) > _MAX_NESTED_BYTES:
            return "<oversized: use get_certificate>"
        return {k: _truncate_value(v, f"{field_path}.{k}") for k, v in value.items()}

    return value


def _truncate_record(record: dict[str, Any]) -> dict[str, Any]:
    """Apply field-level truncation to every value in a search result record."""
    return {key: _truncate_value(value, key) for key, value in record.items()}


# ---------------------------------------------------------------------------
# Search payload builder
# ---------------------------------------------------------------------------

def _build_sorted_by(sorted_by: str | None) -> list[dict[str, str]] | None:
    """Convert a sorted_by string like 'notAfter' or 'notAfter:desc' to Horizon format.

    Horizon expects: [{"element": "notAfter", "order": "Asc"}].
    Accepts: 'element', 'element:Asc', 'element:Desc'.

    NOTE: sortedBy uses API response field names (notAfter, notBefore),
    NOT HCQL query field names (valid.until, valid.from).
    """
    if not sorted_by:
        return None
    parts = sorted_by.split(":", 1)
    element = parts[0].strip()
    order = parts[1].strip().capitalize() if len(parts) > 1 else "Asc"
    if order not in ("Asc", "Desc"):
        order = "Asc"
    return [{"element": element, "order": order}]


def _build_search_payload(
    query: str,
    fields: list[str] | None,
    page_index: int,
    page_size: int,
    sorted_by: str | None,
    with_count: bool,
) -> dict[str, Any]:
    """Build the JSON payload for a Horizon search endpoint."""
    page_size = min(page_size, _MAX_PAGE_SIZE)
    payload: dict[str, Any] = {
        "query": query,
        "pageIndex": page_index,
        "pageSize": page_size,
    }
    if fields:
        payload["fields"] = fields
    sorted = _build_sorted_by(sorted_by)
    if sorted:
        payload["sortedBy"] = sorted
    if with_count:
        payload["withCount"] = True
    return payload


def _build_export_payload(
    query: str,
    fields: list[str] | None,
    sorted_by: str | None,
) -> dict[str, Any]:
    """Build the JSON payload for a Horizon CSV export endpoint."""
    payload: dict[str, Any] = {"query": query}
    if fields:
        payload["fields"] = fields
    sorted = _build_sorted_by(sorted_by)
    if sorted:
        payload["sortedBy"] = sorted
    return payload


# ---------------------------------------------------------------------------
# CSV export helper — uses the raw _request method for text response on POST
# ---------------------------------------------------------------------------

async def _post_csv_export(path: str, payload: dict[str, Any]) -> str:
    """POST to a CSV export endpoint and return the raw text response.

    The HorizonClient only exposes ``get_text`` for raw text.  Export
    endpoints require POST with a JSON body, so we drop down to the
    internal ``_request`` to get the raw httpx.Response and read ``.text``.
    """
    client = get_client()
    # Use the internal _request which returns httpx.Response
    resp = await client._request(  # noqa: SLF001
        "POST", path, json=payload, timeout_override=_CSV_TIMEOUT,
    )
    return resp.text


def _csv_truncation_metadata(csv_text: str) -> dict[str, Any]:
    """Build truncation metadata for a CSV export."""
    # Count data rows (subtract 1 for header line)
    lines = csv_text.strip().splitlines()
    row_count = max(0, len(lines) - 1) if lines else 0
    return {
        "truncated": row_count >= _MAX_CSV_ROWS,
        "returned_rows": row_count,
        "max_rows": _MAX_CSV_ROWS,
    }


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_lifecycle_tools(mcp: FastMCP) -> None:
    """Register all 17 lifecycle tools on the given FastMCP server."""

    # ===================================================================
    # Certificate Search (2)
    # ===================================================================

    @mcp.tool()
    async def search_certificates(
        query: str,
        preset: str = "compact",
        fields: list[str] | None = None,
        page_index: int = 0,
        page_size: int = 25,
        sorted_by: str | None = None,
        with_count: bool = False,
    ) -> str:
        """Search certificates using HCQL query language.

        IMPORTANT — HCQL is NOT SQL. Use these operators (not =, <, >, LIKE):
          String:  field equals "value" | field matches "regex" | field contains "sub" | field in ("a","b")
          Multi-regex: field within ["regex1", "regex2"]
          Date:    field before "2025-06-01" | field after 30d
          Grade:   grade greater than C | grade strictly lower than B  (grade values: A-E)
          Status:  status is valid | status is not revoked
          Logic:   and, or, not, parentheses

        Date formats: "2025-06-01", now, today, 30d, 24h, -30d (relative durations are unquoted)
        Supported units: d/days, h/hours, m/minutes, s/seconds (NO weeks or months)

        Examples (all field names are lowercase — NEVER camelCase):
          module equals "webra" and status is valid
          status is valid and valid.until before 360d and profile equals "TLS-Internal"
          dn matches ".*example\\.com" and keytype equals "RSA"
          contactemail equals "user@example.com" or owner equals "user@example.com"
          san contains "example" and status is not revoked

        Full reference: horizon://knowledge/query-languages

        IMPORTANT — HCQL vs API field names differ:
          - HCQL query fields are lowercase: contactemail, keytype, signingalgorithm
          - API fields/sorted_by are camelCase: contactEmail, keyType, signingAlgorithm
          - HCQL date fields: valid.until, valid.from
          - API date fields: notAfter, notBefore
          - sorted_by format: 'element' or 'element:Desc' (e.g. 'notAfter:Asc')
          - Sortable elements (API names): _id, module, profile, owner, team,
            discoveredTrusted, thumbprint, selfSigned, publicKeyThumbprint, dn,
            serial, issuer, notBefore, notAfter, revocationDate, revocationReason,
            keyType, signingAlgorithm, holderId, contactEmail, grades, escrowed, removeAt

        Presets (return fields):
          - compact (default): dn, serial, profile, module, notAfter, keyType, owner, team
          - diagnostic: adds revocationReason, triggerResults, discoverydata.*, contactemail
          - compliance: adds grade, grade.*, signingalgorithm, keytype, notBefore, notAfter

        The `fields` parameter overrides the preset if provided.

        IMPORTANT — Ownership queries: When user asks for "my certificates",
        call whoami first to get identifier + teams, then query BOTH:
          owner equals "<id>" or team in ("<team1>", "<team2>", ...)
        Full reference: horizon://knowledge/query-languages (Ownership Patterns section).

        See also: whoami (get identity + teams for ownership queries),
            get_certificate (full details by ID), aggregate_certificates (group-by analytics),
            export_certificates_csv (bulk CSV export).
        """
        client = get_client()
        effective_fields = fields if fields else _CERT_PRESETS.get(preset, _CERT_PRESETS["compact"])
        payload = _build_search_payload(
            query, effective_fields, page_index, page_size, sorted_by, with_count,
        )
        result = await client.post("/api/v1/certificates/search", json=payload)

        # Apply field-level truncation to each record
        records = result.get("results", result.get("items", []))
        if isinstance(records, list):
            records = [_truncate_record(r) for r in records]

        response: dict[str, Any] = {"results": records}
        if "count" in result:
            response["count"] = result["count"]
        if "hasMore" in result:
            response["hasMore"] = result["hasMore"]
        response["pageIndex"] = page_index
        response["pageSize"] = min(page_size, _MAX_PAGE_SIZE)
        return json.dumps(response, default=str)

    @mcp.tool()
    async def export_certificates_csv(
        query: str,
        fields: list[str] | None = None,
        sorted_by: str | None = None,
    ) -> str:
        """Export certificates matching an HCQL query as CSV (bounded export helper).

        Returns up to 1000 rows. For full exports use Horizon UI.

        HCQL syntax — use 'equals', 'before', 'after', NOT =, <, >.
        IMPORTANT: HCQL field names are ALL LOWERCASE (keytype, contactemail — NOT keyType, contactEmail).
        Example: status is valid and valid.until before 30d
        Full reference: horizon://knowledge/query-languages
        """
        payload = _build_export_payload(query, fields, sorted_by)
        csv_text = await _post_csv_export("/api/v1/certificates/csv", payload)

        metadata = _csv_truncation_metadata(csv_text)
        return json.dumps({
            "csv": csv_text,
            **metadata,
        }, default=str)

    # ===================================================================
    # Certificate Operations (2)
    # ===================================================================

    @mcp.tool()
    async def get_certificate(certificate_id: str) -> str:
        """Get full certificate details by ID.

        Returns complete untruncated data including all fields, SANs,
        extensions, labels, metadata, and discovery data.
        """
        client = get_client()
        result = await client.get(f"/api/v1/certificates/{certificate_id}")
        return json.dumps(result, default=str)

    @mcp.tool()
    async def download_certificate(
        certificate_id: str,
        format: str = "pem",
    ) -> str:
        """Download a certificate in PEM format.

        Only PEM format is available from the certificate object.

        IMPORTANT — PKCS#12 / PFX retrieval: The PKCS#12 bundle (certificate +
        private key) is NOT stored on the certificate object. For centralized
        enrollment (server-side key generation), the PKCS#12 is returned in the
        **enrollment request response**. To retrieve it:
        1. Use search_requests to find the enrollment request for this certificate
        2. Use get_request to fetch the request — the response contains the
           PKCS#12 (base64-encoded) in the ``pkcs12`` or ``keyStore`` field
        This only works for centralized enrollments where a password was
        provided at submission time via submit_request(password=...).
        """
        client = get_client()
        fmt = format.lower()
        if fmt != "pem":
            return json.dumps({
                "error": f"Only PEM format is available via the API. "
                         f"For {fmt.upper()} format, use the Horizon UI.",
            })

        cert = await client.get(f"/api/v1/certificates/{certificate_id}")

        pem = cert.get("certificate") or cert.get("pem") or cert.get("certificatePEM")
        if not pem:
            return json.dumps({
                "error": "Certificate PEM not found in response. "
                         "The certificate may not have PEM data available.",
                "available_fields": list(cert.keys()),
            })

        return json.dumps({
            "format": "pem",
            "content": pem,
            "certificate_id": certificate_id,
        }, default=str)

    # ===================================================================
    # Requests (8)
    # ===================================================================

    @mcp.tool()
    async def get_request_template(
        workflow: str,
        module: str | None = None,
        profile: str | None = None,
        certificate_id: str | None = None,
    ) -> str:
        """Get the request template showing which fields are required/editable.

        MUST be called before submit_request. The template response tells you:
        - Which subject fields exist and whether they are editable or computed
        - Which SAN types are allowed
        - Which labels are available
        - Whether contactEmail, owner, team are editable
        - Whether a password is required (centralized) or a CSR (decentralized)
        - The allowed key types for centralized generation

        Use the template to determine what information to ask the user for
        before submitting. Do not guess — the template is the source of truth.

        Knowledge: horizon://knowledge/workflows

        Args:
            workflow: enroll, renew, revoke, update, recover, migrate, import.
            module: Profile module (webra, est, scep, acme, etc.).
            profile: Profile name. Required for enroll to get profile-specific
                template. Optional for other workflows if certificate_id is given.
            certificate_id: For renew/revoke/update/recover/migrate — the existing
                certificate ID. The template will be pre-populated with existing
                values.
        """
        client = get_client()
        params: dict[str, str] = {"workflow": workflow}
        if module:
            params["module"] = module
        if profile:
            params["profile"] = profile
        if certificate_id:
            params["certificateId"] = certificate_id

        result = await client.post("/api/v1/requests/template", json=params)
        return json.dumps(result, default=str)

    @mcp.tool()
    async def submit_request(
        workflow: str,
        profile: str,
        module: str,
        template: dict | None = None,
        password: str | None = None,
        certificate_id: str | None = None,
        data: dict | None = None,
    ) -> str:
        """Submit a certificate lifecycle request (enroll, renew, revoke, etc.).

        Knowledge: horizon://knowledge/workflows

        MANDATORY WORKFLOW — follow these steps in order:
        1. Call get_request_template(workflow, module, profile) to discover which
           fields are required, optional, and editable for this profile+workflow.
        2. Examine the template response — it shows the full field structure
           including which subject fields, SANs, labels, metadata, contact email,
           owner, and team the requester can fill in.
        3. ASK THE USER for all required information you don't already have.
           Do not guess or invent values for user-facing fields.
        4. Only call submit_request once all required fields are filled.

        PERMISSION-BASED BEHAVIOR — the outcome depends on the caller's
        permissions on the profile (see horizon://knowledge/workflows):

        - If the caller has the DIRECT action permission (e.g., ``enrollApi``
          for enroll, ``revokeApi`` for revoke, ``renewApi`` for renew), the
          operation completes immediately. The certificate is issued/revoked/
          renewed directly and the response contains the result.
        - If the caller only has the REQUEST permission (e.g., ``enrollRequest``,
          ``revokeRequest``, ``renewRequest``), the request is created in
          PENDING state and requires approval by an authorized operator via
          approve_request. The response contains the request ID.

        Tell the user which outcome occurred based on the response status.
        If the status is "pending", inform them that approval is required.

        Supported modules: webra, est, scep, acme, crmp, wcce, intune, jamf.
        For EST and SCEP, this endpoint generates the enrollment challenge/password.
        The challenge is returned in the response and can be used by the EST/SCEP
        client to complete enrollment through the protocol endpoint.

        Workflows and what to ask the user:
        - **enroll**: Subject (CN, O, OU, etc.), SANs, labels, contact email,
          owner, team, key type. Check get_request_template for which fields
          are editable vs computed vs fixed by the profile.
        - **renew**: certificate_id required. Template is pre-populated from
          the existing cert. Ask if any fields should change.
        - **revoke**: certificate_id required. Ask for revocationReason:
          keycompromise, cacompromise, affiliationchange, superseded,
          cessationofoperation, certificatehold, removefromcrl,
          privilegewithdrawn, aacompromise, unspecified.
        - **update**: certificate_id required. Ask which metadata to change
          (labels, contact email, owner, team).
        - **recover**: certificate_id required. For re-issuing a lost cert.
        - **migrate**: certificate_id required. For moving between profiles.

        Args:
            workflow: enroll, renew, revoke, update, recover, migrate, or import.
            profile: Certificate profile name.
            module: Profile module type (webra, est, scep, acme, crmp, etc.).
            template: Certificate request template object. Structure:
                - subject: list of DN elements, each as
                  {"element": "cn.1", "type": "CN", "value": "server.example.com"}
                - sans: list of SAN entries — values MUST be arrays:
                  {"type": "DNSNAME", "value": ["server.example.com", "alias.example.com"]}
                  Valid types: DNSNAME, RFC822NAME, URI, IPADDRESS, OTHERNAME,
                  DIRECTORYNAME, REGISTEREDID
                - labels: [{"label": "environment", "value": "production"}]
                - contactEmail: {"value": "admin@example.com"}
                - owner: {"value": "admin-principal"}
                - team: {"value": "infra-team"}
                - keyType: "rsa-2048", "rsa-3072", "ec-p256", etc.
                - csr: PEM-encoded CSR (for decentralized key generation)
                - extensions: optional certificate extensions
            password: PKCS#12 password for centralized key generation. When
                provided, Horizon generates the key pair server-side and returns
                the PKCS#12 in the response (base64). Also retrievable via
                get_request. May be auto-generated by profile password policy —
                check get_request_template.
            certificate_id: Certificate ID (required for renew, revoke, update,
                recover, migrate). Use search_certificates to find it.
            data: Additional workflow-specific fields merged into the payload.
                For revoke: {"revocationReason": "keycompromise"}.
                For EST/SCEP with DN whitelist: {"dn": "CN=my-device"}.
                For dry run validation: {"dryRun": true}.
                For requester comment: {"requesterComment": "reason for request"}.

        Enrollment example (centralized, WebRA):
            workflow="enroll", profile="TLS-Internal", module="webra",
            template={"subject": [{"element": "cn.1", "type": "CN", "value": "server.local"}],
                      "sans": [{"type": "DNSNAME", "value": ["server.local"]}],
                      "labels": [{"label": "env", "value": "prod"}],
                      "contactEmail": {"value": "admin@corp.com"},
                      "owner": {"value": "jdoe"},
                      "team": {"value": "infra"},
                      "keyType": "rsa-3072"},
            password="changeit"

        EST challenge example:
            workflow="enroll", profile="EST-Devices", module="est",
            template={"subject": [{"element": "cn.1", "type": "CN", "value": "device01"}],
                      "contactEmail": {"value": "ops@corp.com"}},
            password="challenge-password"

        Revoke example:
            workflow="revoke", profile="TLS-Internal", module="webra",
            certificate_id="abc123",
            data={"revocationReason": "keycompromise"}
        """
        client = get_client()
        payload: dict[str, Any] = {
            "workflow": workflow,
            "profile": profile,
            "module": module,
        }
        if data:
            payload.update(data)
        # Explicit params override anything from data
        if template is not None:
            payload["template"] = template
        if password is not None:
            payload["password"] = password
        if certificate_id is not None:
            payload["certificateId"] = certificate_id
        result = await client.post("/api/v1/requests/submit", json=payload)
        return json.dumps(result, default=str)

    async def _preflight_request_action(
        action: str,
        request_id: str,
        permission_key: str,
    ) -> dict[str, Any]:
        """Fetch a request and check permissions before acting.

        Returns the request dict if permission is granted.
        Returns an error dict if permission is denied or the request is not found.
        """
        client = get_client()
        try:
            request = await client.get(f"/api/v1/requests/{request_id}")
        except HorizonError as exc:
            return {"error": exc.to_tool_result()}

        perms = request.get("permissions", {})
        if not perms.get(permission_key):
            return {
                "error": f"Permission denied: you do not have '{action}' "
                         f"permission on this request. Do NOT retry — use a "
                         f"principal with the appropriate role, or check the "
                         f"profile's authorization levels.",
                "request_id": request_id,
                "request_status": request.get("status"),
                "request_workflow": request.get("workflow"),
                "request_profile": request.get("profile"),
                "your_permissions": perms,
            }

        status = request.get("status", "").lower()
        if status != "pending":
            return {
                "error": f"Request is not pending (current status: '{status}'). "
                         f"Only pending requests can be {action}d.",
                "request_id": request_id,
                "request_status": status,
            }

        return request

    @mcp.tool()
    async def approve_request(request_id: str) -> str:
        """Approve a pending certificate lifecycle request.

        Prerequisites: Use search_requests or get_request to find the request ID.
            Only pending requests can be approved. Permissions are checked automatically.

        Checks permissions before attempting the approval. The workflow
        type is determined automatically from the request.
        If permission is denied, returns an error — do NOT retry.

        Args:
            request_id: The request ID to approve.
        """
        preflight = await _preflight_request_action("approve", request_id, "approve")
        if "error" in preflight:
            return json.dumps(preflight)

        client = get_client()
        try:
            result = await client.post(
                "/api/v1/requests/approve",
                json={"id": request_id, "workflow": preflight["workflow"]},
            )
        except HorizonError as exc:
            return json.dumps({"error": exc.to_tool_result()})
        return json.dumps(result, default=str)

    @mcp.tool()
    async def deny_request(request_id: str) -> str:
        """Deny a pending certificate lifecycle request.

        Prerequisites: Use search_requests or get_request to find the request ID.
            Only pending requests can be denied. Permissions are checked automatically.

        Checks permissions before attempting the denial. The workflow
        type is determined automatically from the request.
        If permission is denied, returns an error — do NOT retry.

        Args:
            request_id: The request ID to deny.
        """
        preflight = await _preflight_request_action("deny", request_id, "approve")
        if "error" in preflight:
            return json.dumps(preflight)

        client = get_client()
        try:
            result = await client.post(
                "/api/v1/requests/deny",
                json={"id": request_id, "workflow": preflight["workflow"]},
            )
        except HorizonError as exc:
            return json.dumps({"error": exc.to_tool_result()})
        return json.dumps(result, default=str)

    @mcp.tool()
    async def cancel_request(request_id: str) -> str:
        """Cancel a pending certificate lifecycle request.

        Prerequisites: Use search_requests or get_request to find the request ID.
            Only pending requests can be cancelled. Permissions are checked automatically.

        Checks permissions before attempting the cancellation. The workflow
        type is determined automatically from the request.
        If permission is denied, returns an error — do NOT retry.

        Args:
            request_id: The request ID to cancel.
        """
        preflight = await _preflight_request_action("cancel", request_id, "cancel")
        if "error" in preflight:
            return json.dumps(preflight)

        client = get_client()
        try:
            result = await client.post(
                "/api/v1/requests/cancel",
                json={"id": request_id, "workflow": preflight["workflow"]},
            )
        except HorizonError as exc:
            return json.dumps({"error": exc.to_tool_result()})
        return json.dumps(result, default=str)

    @mcp.tool()
    async def search_requests(
        query: str,
        preset: str = "compact",
        fields: list[str] | None = None,
        page_index: int = 0,
        page_size: int = 25,
        sorted_by: str | None = None,
        with_count: bool = False,
    ) -> str:
        """Search certificate lifecycle requests using HRQL query language.

        HRQL syntax — use 'equals', 'before', 'after', NOT =, <, >.
        IMPORTANT: HRQL field names are ALL LOWERCASE with dots for dates
        (registration.date, modification.date — NOT registrationDate, lastModificationDate).
        Examples:
          workflow equals "enroll" and status equals "pending"
          status equals "denied" and modification.date after 30d
          profile equals "TLS-Internal" and requester contains "admin"
        Full reference: horizon://knowledge/query-languages

        Results are paginated and field-truncated — use get_request for
        full untruncated data on a specific request.

        sorted_by format: 'element' or 'element:Desc'.
        Sortable elements: _id, module, workflow, status, profile, requester,
          approver, team, owner, contact, requesterComment, approverComment,
          certificateId, certificate, dn, registrationDate, lastModificationDate,
          expirationDate, holderId, labels, metadata, releaseAt

        Usable return fields: _id, approver, approverComment, certificate,
          certificateId, contact, dn, expirationDate, holderId, label.<key>,
          labels, lastModificationDate, metadata, metadata.<key>, module,
          owner, profile, registrationDate, releaseAt, requester,
          requesterComment, status, team, workflow

        Presets:
          - compact (default): workflow, status, profile, module, requester,
            approver, registrationDate, lastModificationDate
          - diagnostic: adds certificate, dn, requesterComment, approverComment
          - compliance: adds dn, certificateId

        See also: get_request (full details by ID), aggregate_requests (group-by analytics),
            export_requests_csv (bulk CSV export).
        """
        client = get_client()
        effective_fields = fields if fields else _REQUEST_PRESETS.get(
            preset, _REQUEST_PRESETS["compact"],
        )
        payload = _build_search_payload(
            query, effective_fields, page_index, page_size, sorted_by, with_count,
        )
        result = await client.post("/api/v1/requests/search", json=payload)

        records = result.get("results", result.get("items", []))
        if isinstance(records, list):
            records = [_truncate_record(r) for r in records]

        response: dict[str, Any] = {"results": records}
        if "count" in result:
            response["count"] = result["count"]
        if "hasMore" in result:
            response["hasMore"] = result["hasMore"]
        response["pageIndex"] = page_index
        response["pageSize"] = min(page_size, _MAX_PAGE_SIZE)
        return json.dumps(response, default=str)

    @mcp.tool()
    async def get_request(request_id: str) -> str:
        """Get full details of a certificate lifecycle request by ID.

        Returns complete untruncated data including all workflow fields,
        certificate details, requester/approver info, and audit trail.

        PKCS#12 / PFX: For centralized enrollment requests (server-side key
        generation), the response contains the PKCS#12 bundle with the
        certificate and private key. Look for the ``pkcs12`` or ``keyStore``
        field (base64-encoded). This is the ONLY way to retrieve the private
        key — it is NOT available on the certificate object itself.
        """
        client = get_client()
        result = await client.get(f"/api/v1/requests/{request_id}")
        return json.dumps(result, default=str)

    @mcp.tool()
    async def export_requests_csv(
        query: str,
        fields: list[str] | None = None,
        sorted_by: str | None = None,
    ) -> str:
        """Export requests matching an HRQL query as CSV (bounded export helper).

        Returns up to 1000 rows. For full exports use Horizon UI.
        HRQL syntax — use 'equals', 'before', 'after', NOT =, <, >.
        IMPORTANT: HRQL field names are ALL LOWERCASE (registration.date, NOT registrationDate).
        Full reference: horizon://knowledge/query-languages
        """
        payload = _build_export_payload(query, fields, sorted_by)
        csv_text = await _post_csv_export("/api/v1/requests/csv", payload)

        metadata = _csv_truncation_metadata(csv_text)
        return json.dumps({
            "csv": csv_text,
            **metadata,
        }, default=str)

    # ===================================================================
    # Events (3)
    # ===================================================================

    @mcp.tool()
    async def search_events(
        query: str,
        page_index: int = 0,
        page_size: int = 25,
        sorted_by: str | None = None,
    ) -> str:
        """Search audit events using HEQL query language.

        HEQL syntax — use 'equals', 'before', 'after', NOT =, <, >.
        IMPORTANT: HEQL field names are ALL LOWERCASE (code, timestamp, detail.* — NOT eventType, eventDate).
        Examples:
          code equals "LIFECYCLE-ENROLL" and status equals "failure" and timestamp after -24h
          module equals "ACME" and detail.actorId equals "admin@example.com"
        Full reference: horizon://knowledge/query-languages

        sorted_by format: 'element' or 'element:Desc'.
        Sortable elements: _id, code, module, node, timestamp, removeAt, status

        Results are paginated. Events capture all certificate lifecycle actions
        including enrollments, revocations, approvals, and configuration changes.
        """
        client = get_client()
        page_size = min(page_size, _MAX_PAGE_SIZE)
        payload: dict[str, Any] = {
            "query": query,
            "pageIndex": page_index,
            "pageSize": page_size,
        }
        sorted = _build_sorted_by(sorted_by)
        if sorted:
            payload["sortedBy"] = sorted

        result = await client.post("/api/v1/events/search", json=payload)

        records = result.get("results", result.get("items", []))
        response: dict[str, Any] = {"results": records}
        if "count" in result:
            response["count"] = result["count"]
        if "hasMore" in result:
            response["hasMore"] = result["hasMore"]
        response["pageIndex"] = page_index
        response["pageSize"] = page_size
        return json.dumps(response, default=str)

    @mcp.tool()
    async def get_event(event_id: str) -> str:
        """Get full details of an audit event by ID.

        Returns the complete event record including actor, action, target
        object, timestamp, and any associated metadata.
        """
        client = get_client()
        result = await client.get(f"/api/v1/events/{event_id}")
        return json.dumps(result, default=str)

    @mcp.tool()
    async def export_events_csv(
        query: str,
        fields: list[str] | None = None,
        sorted_by: str | None = None,
    ) -> str:
        """Export audit events matching an HEQL query as CSV (bounded export helper).

        Returns up to 1000 rows. For full exports use Horizon UI.
        HEQL syntax — use 'equals', 'before', 'after', NOT =, <, >.
        IMPORTANT: HEQL field names are ALL LOWERCASE (code, timestamp — NOT eventType, eventDate).
        Full reference: horizon://knowledge/query-languages
        """
        payload = _build_export_payload(query, fields, sorted_by)
        csv_text = await _post_csv_export("/api/v1/events/csv", payload)

        metadata = _csv_truncation_metadata(csv_text)
        return json.dumps({
            "csv": csv_text,
            **metadata,
        }, default=str)

    # ===================================================================
    # Aggregation (2)
    # ===================================================================

    @mcp.tool()
    async def aggregate_certificates(
        query: str,
        group_by: list[str],
        having: dict[str, Any] | None = None,
        sort_order: str = "Desc",
    ) -> str:
        """Aggregate certificates by groupBy dimensions using HCQL query.

        Returns counts grouped by the specified fields — ideal for
        dashboarding, reporting, and distribution analysis (e.g. "how many
        valid certs per profile?", "key type distribution?").

        HCQL syntax — use 'equals', 'matches', 'before', 'after', NOT =/</>.
        IMPORTANT — TWO different naming contexts:
          - query field names are ALL LOWERCASE: keytype, contactemail, signingalgorithm
          - groupBy field names are camelCase: keyType, signingAlgorithm, holderId
        Full reference: horizon://knowledge/query-languages

        Example (note lowercase query vs camelCase groupBy):
          query="status is valid and keytype contains \"rsa\"",
          group_by=["keyType", "profile"]

        WRONG: query="keyType contains \"rsa\"" (camelCase in query → HQL-001 error)
        CORRECT: query="keytype contains \"rsa\"" (lowercase in query)

        Valid groupBy fields (camelCase): profile, module, keyType, team, issuer, status,
        expired, revoked, graded, signingAlgorithm, selfSigned,
        discoveredTrusted, holderId, dn, certificateType,
        publicKeyThumbprint, revocationReason,
        notAfter.day/month/year, notBefore.day/month/year,
        revocationDate.day/month/year, label.*, metadata.*, grade.*

        NOTE: 'owner' is NOT valid for certificate aggregation (use holderId).

        Args:
            query: HCQL filter expression (ALL LOWERCASE field names).
            group_by: List of field names to group by.
            having: Optional post-aggregation filter on count.
                Example: {"operator": "gt", "value": 10}
                Operators: gt, gte, lt, lte, eq, ne
            sort_order: Bucket sort order — Asc, Desc, KeyAsc, KeyDesc.
        """
        client = get_client()
        payload: dict[str, Any] = {
            "query": query,
            "groupBy": group_by,
        }
        if having is not None:
            payload["having"] = having
        if sort_order:
            payload["sortOrder"] = sort_order
        result = await client.post("/api/v1/certificates/aggregate", json=payload)
        return json.dumps(result, default=str)

    @mcp.tool()
    async def aggregate_requests(
        query: str,
        group_by: list[str],
        having: dict[str, Any] | None = None,
        sort_order: str = "Desc",
    ) -> str:
        """Aggregate requests by groupBy dimensions using HRQL query.

        Returns counts grouped by the specified fields — ideal for
        workflow analytics (e.g. "pending requests by profile?",
        "approval rate by approver?").

        HRQL syntax — use 'equals', 'matches', 'before', 'after', NOT =/</>.
        IMPORTANT — TWO different naming contexts:
          - query field names are ALL LOWERCASE: registration.date, modification.date
          - groupBy field names are camelCase: registrationDate, lastModificationDate
        Full reference: horizon://knowledge/query-languages

        Example (note lowercase query vs camelCase groupBy):
          query="status equals \"pending\" and registration.date after 30d",
          group_by=["workflow", "registrationDate.month"]

        WRONG: query="registrationDate after 30d" (camelCase in query → HQL-001 error)
        CORRECT: query="registration.date after 30d" (lowercase with dots in query)

        Valid groupBy fields (camelCase): approver, contact, module, profile, requester,
        status, workflow, team, owner, dn,
        expirationDate.day/month/year,
        lastModificationDate.day/month/year,
        registrationDate.day/month/year, label.*, metadata.*

        Args:
            query: HRQL filter expression (ALL LOWERCASE field names).
            group_by: List of field names to group by.
            having: Optional post-aggregation filter on count.
                Example: {"operator": "gt", "value": 5}
                Operators: gt, gte, lt, lte, eq, ne
            sort_order: Bucket sort order — Asc, Desc, KeyAsc, KeyDesc.
        """
        client = get_client()
        payload: dict[str, Any] = {
            "query": query,
            "groupBy": group_by,
        }
        if having is not None:
            payload["having"] = having
        if sort_order:
            payload["sortOrder"] = sort_order
        result = await client.post("/api/v1/requests/aggregate", json=payload)
        return json.dumps(result, default=str)
