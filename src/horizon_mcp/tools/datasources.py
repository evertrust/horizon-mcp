"""External datasource management tools for Horizon MCP Server.

8 tools covering the full datasource lifecycle:
  - list_datasources: list all datasources with optional type/name filtering
  - get_datasource: fetch a single datasource by name
  - create_dns_datasource: create a DNS-type datasource
  - create_ldap_datasource: create an LDAP-type datasource
  - create_rest_datasource: create a REST-type datasource
  - update_datasource: GET-strip-merge-PUT update
  - delete_datasource: delete with safety echo
  - test_datasource: test a datasource against a context dictionary

Knowledge resources:
    - horizon://knowledge/datasources (configuration, integration patterns)
    - horizon://knowledge/validation-rules (validation conditions using ds.* entries)
    - horizon://knowledge/dictionary-entries (all dictionary entries by context)
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from horizon_mcp.client.state import get_client
from horizon_mcp.tools._helpers import (
    apply_name_filter,
    build_list_response,
    build_mutate_response,
    delete_guard,
    get_strip_merge_put,
)

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.datasources")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DS_BASE = "/api/v1/datasources"
_MAX_LIST_ITEMS = 50

_VALID_DS_TYPES = frozenset({"dns", "ldap", "rest"})
_VALID_RECORD_TYPES = frozenset({"a", "aaaa", "cname", "ptr", "txt"})
_VALID_AUTH_TYPES = frozenset({"noauth", "basic", "x509", "bearer", "custom"})


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_ds_type(ds_type: str) -> str | None:
    """Return error JSON if ds_type is invalid, else None."""
    if ds_type not in _VALID_DS_TYPES:
        return json.dumps({
            "error": f"Invalid datasource type '{ds_type}'.",
            "valid_types": sorted(_VALID_DS_TYPES),
        })
    return None


def _validate_record_types(record_types: list[str]) -> str | None:
    """Return error JSON if any DNS record type is invalid, else None."""
    invalid = set(record_types) - _VALID_RECORD_TYPES
    if invalid:
        return json.dumps({
            "error": f"Invalid DNS record type(s): {sorted(invalid)}.",
            "valid_types": sorted(_VALID_RECORD_TYPES),
        })
    return None


def _validate_auth_type(auth_type: str) -> str | None:
    """Return error JSON if REST auth type is invalid, else None."""
    if auth_type not in _VALID_AUTH_TYPES:
        return json.dumps({
            "error": f"Invalid authentication type '{auth_type}'.",
            "valid_types": sorted(_VALID_AUTH_TYPES),
        })
    return None


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_datasource_tools(mcp: FastMCP) -> None:
    """Register all 8 datasource management tools on *mcp*."""

    # ===================================================================
    # Read-only (2 tools)
    # ===================================================================

    @mcp.tool()
    async def list_datasources(
        max_items: int = _MAX_LIST_ITEMS,
        name_contains: str | None = None,
        ds_type: str | None = None,
    ) -> str:
        """List external datasources with optional filtering.

        Safety tier: read-only
        Knowledge: horizon://knowledge/datasources

        Args:
            max_items: Maximum items to return (default 50).
            name_contains: Case-insensitive substring filter on datasource name.
            ds_type: Filter by datasource type: "dns", "ldap", or "rest".

        Returns:
            JSON with items, count, total_available, and truncated flag.

        See also: get_datasource (details), create_dns_datasource / create_ldap_datasource /
            create_rest_datasource (create new), test_datasource (validate before creating).
        """
        if ds_type is not None:
            err = _validate_ds_type(ds_type)
            if err is not None:
                return err

        client = get_client()
        data = await client.get(_DS_BASE)
        items: list[dict[str, Any]] = (
            data if isinstance(data, list) else data.get("items", [data])
        )

        if ds_type is not None:
            items = [it for it in items if it.get("type") == ds_type]

        items = apply_name_filter(items, name_contains)
        return build_list_response(items, max_items, kind="datasource")

    @mcp.tool()
    async def get_datasource(name: str) -> str:
        """Get a single datasource by name.

        Safety tier: read-only
        Knowledge: horizon://knowledge/datasources

        Args:
            name: Exact datasource name.

        Returns:
            JSON representation of the datasource.

        See also: list_datasources (browse all), update_datasource (modify),
            test_datasource (validate config), delete_datasource (remove).
        """
        client = get_client()
        result = await client.get(f"{_DS_BASE}/{name}")
        return json.dumps(result)

    # ===================================================================
    # Create tools (3 tools - one per type)
    # ===================================================================

    @mcp.tool()
    async def create_dns_datasource(
        name: str,
        lookup: str,
        display_name: list[dict[str, str]] | None = None,
        description: str | None = None,
        host: str | None = None,
        port: int = 53,
        timeout: str = "10 seconds",
        record_types: list[str] | None = None,
    ) -> str:
        """STOP - This tool modifies data. You MUST ask the user for explicit
        confirmation before calling this tool. Do not proceed without a clear
        "yes" from the user. Present what you intend to do and wait.

        Create a DNS datasource for hostname lookups during enrollment.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/datasources, horizon://knowledge/validation-rules

        DNS datasources query DNS servers and return record data (A, AAAA,
        CNAME, PTR, TXT) that can be used in computation rules and validation
        rule conditions via ds.<flowIndex>.<resultIndex>.<recordType> entries.

        IMPORTANT: Datasource names are IMMUTABLE after creation. Always ask
        the user for the name before creating.

        The lookup field is a TemplateString that supports {{key}} syntax for
        dynamic DNS queries. For example: "{{csr.san.dnsname.1}}" will look up
        the first DNS SAN from the CSR.

        Args:
            name: Unique datasource name (immutable primary key).
            lookup: DNS hostname to look up - supports TemplateString syntax
                    with {{key}} for dynamic values (e.g., "{{csr.san.dnsname.1}}").
            display_name: Localized display names as [{lang: "en", value: "My DNS"}].
            description: Human-readable description of this datasource's purpose.
            host: DNS server IP address. If omitted, uses Horizon's default resolver.
            port: DNS server port (default 53).
            timeout: Query timeout in finite duration format (default "10 seconds").
                     Examples: "10s", "30 seconds", "5m".
            record_types: Filter which DNS record types to return.
                          Valid values: "a", "aaaa", "cname", "ptr", "txt".
                          If omitted, all record types are fetched.

        Returns:
            JSON with confirmation and created datasource data.

        Typical workflow:
            1. Use test_datasource first to validate your DNS config works
            2. Call this tool to create the datasource
            3. Add the datasource to a profile's dsFlow (via profile configuration)
            4. Use ds.<flowIndex>.<resultIndex>.<recordType> in computation
               rules or validation rule conditions

        When to use DNS datasources:
            - Validate that a SAN hostname has a specific CNAME target
            - Check if a hostname resolves (A/AAAA records exist)
            - Look up TXT records for domain ownership verification
            - Reverse-lookup IP addresses via PTR records

        Example - CNAME validation for PaaS deployment:
            name="san-cname-check"
            lookup="{{csr.san.dnsname.1}}"
            record_types=["cname"]
            -> After creation, add to profile dsFlow with input mapping:
               {"hostname": "{{csr.san.dnsname.1}}"}
            -> Reference in validation rule: {{ds.1.1.cname}} matches ".*\\.paas\\.internal$"

        See also: test_datasource (validate before creating),
            simulate_datasource_flow (test entire flow pipeline),
            list_datasources (verify creation).
        """
        if record_types is not None:
            err = _validate_record_types(record_types)
            if err is not None:
                return err

        payload: dict[str, Any] = {
            "type": "dns",
            "name": name,
            "lookup": lookup,
            "port": port,
            "timeout": timeout,
        }
        if display_name is not None:
            payload["displayName"] = display_name
        if description is not None:
            payload["description"] = description
        if host is not None:
            payload["host"] = host
        if record_types is not None:
            payload["recordTypes"] = record_types

        client = get_client()
        result = await client.post(_DS_BASE, json=payload)
        return build_mutate_response(
            action="created", kind="datasource", name=name, data=result,
        )

    @mcp.tool()
    async def create_ldap_datasource(
        name: str,
        hostname: str,
        credentials: str,
        base_dn: str,
        filter: str,
        secure: bool,
        timeout: str,
        display_name: list[dict[str, str]] | None = None,
        description: str | None = None,
        port: int | None = None,
        disable_hostname_validation: bool = False,
        attributes: list[dict[str, Any]] | None = None,
        limit: int | None = None,
        follow_referrals: bool | None = None,
        proxy: str | None = None,
    ) -> str:
        """STOP - This tool modifies data. You MUST ask the user for explicit
        confirmation before calling this tool. Do not proceed without a clear
        "yes" from the user. Present what you intend to do and wait.

        Create an LDAP datasource for directory lookups during enrollment.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/datasources, horizon://knowledge/validation-rules

        LDAP datasources query directory servers (Active Directory, OpenLDAP, etc.)
        and return user/object attributes that can be used in computation rules and
        validation rule conditions via ds.<flowIndex>.<resultIndex>.<attribute> entries.

        IMPORTANT: Datasource names are IMMUTABLE after creation. Always ask
        the user for the name before creating.

        Prerequisites: The referenced credentials object must already exist in
        Horizon (type: PasswordCredentials with LDAP bind DN + password).

        The baseDn and filter fields support TemplateString syntax with {{key}}
        for dynamic LDAP queries. Example filter: "(sAMAccountName={{username}})".

        Special LDAP attributes are auto-decoded:
            - objectSid, objectGuid: decoded from binary
            - userCertificate: parsed as X.509 PEM + subject elements
            - dn: parsed into subject components (cn, o, ou, etc.)

        Args:
            name: Unique datasource name (immutable primary key).
            hostname: LDAP server URL (e.g., "ldaps://ldap.corp.example.com").
            credentials: Name of existing PasswordCredentials for LDAP bind.
            base_dn: LDAP search base DN - supports {{key}} TemplateString syntax.
                     Example: "OU=Users,DC=corp,DC=example,DC=com".
            filter: LDAP search filter - supports {{key}} TemplateString syntax.
                    Example: "(sAMAccountName={{username}})".
            secure: Use secure LDAP (LDAPS). Set true for ldaps:// connections.
            timeout: Query timeout in finite duration format (e.g., "10s", "30 seconds").
            display_name: Localized display names as [{lang: "en", value: "Corp LDAP"}].
            description: Human-readable description.
            port: LDAP port. Default: 389 (LDAP) or 636 (LDAPS).
            disable_hostname_validation: Skip hostname validation on TLS (default false).
            attributes: Attributes to return. Each: {key: str, multi: bool, selected: bool}.
            limit: Maximum number of LDAP results to return.
            follow_referrals: Enable LDAP referral traversal.
            proxy: Name of an existing HTTP proxy object.

        Returns:
            JSON with confirmation and created datasource data.

        Typical workflow:
            1. Ensure the PasswordCredentials for LDAP bind already exist
            2. Use test_datasource first to validate LDAP connectivity and filter
            3. Call this tool to create the datasource
            4. Add the datasource to a profile's dsFlow
            5. Use ds.<flowIndex>.<resultIndex>.<attribute> in computation rules
               or validation rule conditions

        When to use LDAP datasources:
            - Enrich certificates with user attributes (department, email, manager)
            - Validate user group membership before auto-approving enrollment
            - Look up computer objects for server certificate enrichment
            - Resolve AD attributes for certificate naming policies

        Example - Active Directory user enrichment:
            name="corp-ad"
            hostname="ldaps://dc01.corp.local"
            credentials="ad-bind-creds"
            base_dn="OU=Users,DC=corp,DC=local"
            filter="(sAMAccountName={{principal.identifier}})"
            secure=True
            timeout="10s"
            limit=1
            attributes=[
                {"key": "department", "multi": false, "selected": true},
                {"key": "mail", "multi": false, "selected": true},
                {"key": "memberOf", "multi": true, "selected": true}
            ]

        See also: test_datasource (validate LDAP connectivity before creating),
            simulate_datasource_flow (test full flow pipeline),
            list_datasources (verify creation).
        """
        payload: dict[str, Any] = {
            "type": "ldap",
            "name": name,
            "hostname": hostname,
            "credentials": credentials,
            "baseDn": base_dn,
            "filter": filter,
            "secure": secure,
            "timeout": timeout,
        }
        if display_name is not None:
            payload["displayName"] = display_name
        if description is not None:
            payload["description"] = description
        if port is not None:
            payload["port"] = port
        if disable_hostname_validation:
            payload["disableHostnameValidation"] = True
        if attributes is not None:
            payload["attributes"] = attributes
        if limit is not None:
            payload["limit"] = limit
        if follow_referrals is not None:
            payload["followReferrals"] = follow_referrals
        if proxy is not None:
            payload["proxy"] = proxy

        client = get_client()
        result = await client.post(_DS_BASE, json=payload)
        return build_mutate_response(
            action="created", kind="datasource", name=name, data=result,
        )

    @mcp.tool()
    async def create_rest_datasource(
        name: str,
        method: str,
        url: str,
        authentication_type: str,
        timeout: str,
        expected_http_codes: list[int],
        display_name: list[dict[str, str]] | None = None,
        description: str | None = None,
        credentials: str | None = None,
        headers: list[dict[str, str]] | None = None,
        payload_type: str | None = None,
        payload: str | None = None,
        proxy: str | None = None,
        attributes: list[dict[str, Any]] | None = None,
    ) -> str:
        """STOP - This tool modifies data. You MUST ask the user for explicit
        confirmation before calling this tool. Do not proceed without a clear
        "yes" from the user. Present what you intend to do and wait.

        Create a REST datasource for HTTP API lookups during enrollment.

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/datasources, horizon://knowledge/validation-rules

        REST datasources call HTTP APIs and return parsed response data that
        can be used in computation rules and validation rule conditions via
        ds.<flowIndex>.<resultIndex>.<attribute> entries.

        IMPORTANT: Datasource names are IMMUTABLE after creation. Always ask
        the user for the name before creating.

        Prerequisites: When authenticationType is not "noauth", the referenced
        credentials object must already exist in Horizon.

        The url, headers, and payload fields support TemplateString syntax
        with {{key}} for dynamic values.

        Args:
            name: Unique datasource name (immutable primary key).
            method: HTTP method (GET, POST, PUT, DELETE, etc.).
            url: Endpoint URL - supports {{key}} TemplateString syntax.
            authentication_type: Auth scheme - "noauth", "basic", "x509", "bearer", or "custom".
            timeout: Request timeout in finite duration format (e.g., "10s", "30 seconds").
            expected_http_codes: HTTP status codes indicating success (e.g., [200, 201]).
            display_name: Localized display names.
            description: Human-readable description.
            credentials: Name of existing credentials for authentication.
                         Required when authentication_type is not "noauth".
            headers: Custom HTTP headers as [{name: "X-Custom", value: "{{key}}"}].
            payload_type: Payload format hint (e.g., "json") - for UI formatting.
            payload: Request body - supports {{key}} TemplateString syntax.
            proxy: Name of an existing HTTP proxy object.
            attributes: Response attributes to extract. Each: {key: str, multi: bool, selected: bool}.

        Returns:
            JSON with confirmation and created datasource data.

        Typical workflow:
            1. Ensure credentials exist (unless using noauth)
            2. Use test_datasource first to validate the API call works
            3. Call this tool to create the datasource
            4. Add the datasource to a profile's dsFlow
            5. Use ds.<flowIndex>.<resultIndex>.<attribute> in computation rules

        When to use REST datasources:
            - Query a CMDB API for host ownership information
            - Call an internal service to validate hostnames or domains
            - Fetch user metadata from an HR system API
            - Integrate with any HTTP-based external data source

        Example - CMDB host ownership lookup:
            name="cmdb-lookup"
            method="GET"
            url="https://cmdb.corp.local/api/v1/hosts/{{csr.san.dnsname.1}}"
            authentication_type="bearer"
            credentials="cmdb-api-token"
            timeout="10s"
            expected_http_codes=[200]
            attributes=[{"key": "owner", "multi": false, "selected": true}]

        See also: test_datasource (validate API call before creating),
            simulate_datasource_flow (test full flow pipeline),
            list_datasources (verify creation).
        """
        err = _validate_auth_type(authentication_type)
        if err is not None:
            return err

        if authentication_type != "noauth" and not credentials:
            return json.dumps({
                "error": "credentials is required when authentication_type is not 'noauth'.",
                "hint": "Provide the name of an existing credentials object.",
            })

        if not expected_http_codes:
            return json.dumps({
                "error": "expected_http_codes must contain at least one HTTP status code.",
                "hint": "Common values: [200], [200, 201], [200, 204].",
            })

        body: dict[str, Any] = {
            "type": "rest",
            "name": name,
            "method": method,
            "url": url,
            "authenticationType": authentication_type,
            "timeout": timeout,
            "expectedHttpCodes": expected_http_codes,
        }
        if display_name is not None:
            body["displayName"] = display_name
        if description is not None:
            body["description"] = description
        if credentials is not None:
            body["credentials"] = credentials
        if headers is not None:
            body["headers"] = headers
        if payload_type is not None:
            body["payloadType"] = payload_type
        if payload is not None:
            body["payload"] = payload
        if proxy is not None:
            body["proxy"] = proxy
        if attributes is not None:
            body["attributes"] = attributes

        client = get_client()
        result = await client.post(_DS_BASE, json=body)
        return build_mutate_response(
            action="created", kind="datasource", name=name, data=result,
        )

    # ===================================================================
    # Update (1 tool)
    # ===================================================================

    @mcp.tool()
    async def update_datasource(
        name: str,
        display_name: list[dict[str, str]] | None = None,
        description: str | None = None,
        host: str | None = None,
        port: int | None = None,
        timeout: str | None = None,
        lookup: str | None = None,
        record_types: list[str] | None = None,
        hostname: str | None = None,
        credentials: str | None = None,
        base_dn: str | None = None,
        filter: str | None = None,
        secure: bool | None = None,
        disable_hostname_validation: bool | None = None,
        attributes: list[dict[str, Any]] | None = None,
        limit: int | None = None,
        follow_referrals: bool | None = None,
        method: str | None = None,
        url: str | None = None,
        authentication_type: str | None = None,
        headers: list[dict[str, str]] | None = None,
        payload_type: str | None = None,
        payload: str | None = None,
        expected_http_codes: list[int] | None = None,
        proxy: str | None = None,
        clear_fields: list[str] | None = None,
    ) -> str:
        """STOP - This tool modifies data. You MUST ask the user for explicit
        confirmation before calling this tool. Do not proceed without a clear
        "yes" from the user. Present what you intend to do and wait.

        Update an existing datasource (GET -> strip -> merge -> PUT).

        Safety tier: mutating-safe
        Knowledge: horizon://knowledge/datasources

        Uses the GET-strip-merge-PUT pattern: fetches current state, strips
        server-populated fields, merges your overrides, and PUTs back.

        Parameters are type-specific - only set fields relevant to the
        datasource type (dns, ldap, or rest). Irrelevant fields are ignored.

        IMPORTANT: The datasource name and type cannot be changed after creation.

        Args:
            name: Datasource name to update (used for lookup, cannot be changed).
            display_name: New localized display names.
            description: New description.
            host: (DNS) New DNS server IP.
            port: (DNS/LDAP) New port number.
            timeout: New timeout in finite duration format.
            lookup: (DNS) New lookup TemplateString.
            record_types: (DNS) New record type filter.
            hostname: (LDAP) New LDAP server URL.
            credentials: (LDAP/REST) New credentials name.
            base_dn: (LDAP) New base DN TemplateString.
            filter: (LDAP) New search filter TemplateString.
            secure: (LDAP) New secure flag.
            disable_hostname_validation: (LDAP) New hostname validation flag.
            attributes: (LDAP/REST) New attribute list.
            limit: (LDAP) New result limit.
            follow_referrals: (LDAP) New referral traversal flag.
            method: (REST) New HTTP method.
            url: (REST) New endpoint URL TemplateString.
            authentication_type: (REST) New auth type.
            headers: (REST) New HTTP headers.
            payload_type: (REST) New payload format hint.
            payload: (REST) New request body TemplateString.
            expected_http_codes: (REST) New success HTTP codes.
            proxy: (LDAP/REST) New proxy name.
            clear_fields: Top-level field names to explicitly set to null.

        Returns:
            JSON with confirmation and updated datasource data.

        See also: get_datasource (inspect current config before updating),
            test_datasource (validate new config works before committing).
        """
        if record_types is not None:
            err = _validate_record_types(record_types)
            if err is not None:
                return err

        if authentication_type is not None:
            err = _validate_auth_type(authentication_type)
            if err is not None:
                return err

        overrides: dict[str, Any] = {}
        if display_name is not None:
            overrides["displayName"] = display_name
        if description is not None:
            overrides["description"] = description
        if host is not None:
            overrides["host"] = host
        if port is not None:
            overrides["port"] = port
        if timeout is not None:
            overrides["timeout"] = timeout
        if lookup is not None:
            overrides["lookup"] = lookup
        if record_types is not None:
            overrides["recordTypes"] = record_types
        if hostname is not None:
            overrides["hostname"] = hostname
        if credentials is not None:
            overrides["credentials"] = credentials
        if base_dn is not None:
            overrides["baseDn"] = base_dn
        if filter is not None:
            overrides["filter"] = filter
        if secure is not None:
            overrides["secure"] = secure
        if disable_hostname_validation is not None:
            overrides["disableHostnameValidation"] = disable_hostname_validation
        if attributes is not None:
            overrides["attributes"] = attributes
        if limit is not None:
            overrides["limit"] = limit
        if follow_referrals is not None:
            overrides["followReferrals"] = follow_referrals
        if method is not None:
            overrides["method"] = method
        if url is not None:
            overrides["url"] = url
        if authentication_type is not None:
            overrides["authenticationType"] = authentication_type
        if headers is not None:
            overrides["headers"] = headers
        if payload_type is not None:
            overrides["payloadType"] = payload_type
        if payload is not None:
            overrides["payload"] = payload
        if expected_http_codes is not None:
            overrides["expectedHttpCodes"] = expected_http_codes
        if proxy is not None:
            overrides["proxy"] = proxy

        result = await get_strip_merge_put(
            f"{_DS_BASE}/{name}",
            _DS_BASE,
            "datasource",
            overrides,
            clear_fields,
        )
        return build_mutate_response(
            action="updated", kind="datasource", name=name, data=result,
        )

    # ===================================================================
    # Delete (1 tool)
    # ===================================================================

    @mcp.tool()
    async def delete_datasource(name: str, expected_name: str) -> str:
        """STOP - This tool performs an IRREVERSIBLE destructive operation. You MUST
        ask the user for explicit confirmation before calling this tool. Do not
        proceed without a clear "yes" from the user. Present what will be
        permanently destroyed and wait.

        Delete a datasource. Requires name confirmation.

        A datasource cannot be deleted if it is still
        referenced by any profile's dsFlow.

        Safety tier: mutating-destructive
        Knowledge: horizon://knowledge/datasources

        Args:
            name: Datasource name to delete.
            expected_name: Must exactly match *name* as a deletion safeguard.

        Returns:
            JSON confirmation of deletion.

        See also: get_datasource (inspect before deleting),
            list_datasources (find datasource to delete).
        """
        delete_guard(name, expected_name)
        client = get_client()
        await client.delete(f"{_DS_BASE}/{name}")
        return json.dumps({
            "deleted": True,
            "name": name,
            "kind": "datasource",
        })

    # ===================================================================
    # Test (1 tool)
    # ===================================================================

    @mcp.tool()
    async def test_datasource(
        ds_type: str,
        name: str,
        context: dict[str, str] | None = None,
        lookup: str | None = None,
        host: str | None = None,
        port: int | None = None,
        timeout: str | None = None,
        record_types: list[str] | None = None,
        hostname: str | None = None,
        credentials: str | None = None,
        base_dn: str | None = None,
        filter: str | None = None,
        secure: bool | None = None,
        attributes: list[dict[str, Any]] | None = None,
        limit: int | None = None,
        method: str | None = None,
        url: str | None = None,
        authentication_type: str | None = None,
        headers: list[dict[str, str]] | None = None,
        payload_type: str | None = None,
        payload: str | None = None,
        expected_http_codes: list[int] | None = None,
    ) -> str:
        """Test a datasource configuration against a context dictionary.

        Safety tier: read-only (performs a live query but does not persist anything)
        Knowledge: horizon://knowledge/datasources

        Sends the datasource definition and an optional context dictionary to
        Horizon for a one-off test execution. Useful for validating datasource
        configuration before creating or after modifying it.

        For DNS: returns resolved records (A, AAAA, CNAME, PTR, TXT).
        For LDAP: returns matched attributes and computed DN/filter.
        For REST: returns response code, headers, body, and extracted attributes.

        Args:
            ds_type: Datasource type - "dns", "ldap", or "rest".
            name: Datasource name (for identification in the test result).
            context: Dictionary of key-value pairs to resolve TemplateString
                     variables in the datasource configuration. Example:
                     {"hostname": "web01.corp.local"} for a DNS lookup of "{{hostname}}".
            lookup: (DNS) Hostname to look up - TemplateString.
            host: (DNS) DNS server IP.
            port: (DNS/LDAP) Port number.
            timeout: Timeout in finite duration format.
            record_types: (DNS) Record types to query.
            hostname: (LDAP) LDAP server URL.
            credentials: (LDAP/REST) Credentials name.
            base_dn: (LDAP) Base DN TemplateString.
            filter: (LDAP) Search filter TemplateString.
            secure: (LDAP) Use LDAPS.
            attributes: (LDAP/REST) Attributes to return.
            limit: (LDAP) Max results.
            method: (REST) HTTP method.
            url: (REST) Endpoint URL TemplateString.
            authentication_type: (REST) Auth type.
            headers: (REST) HTTP headers.
            payload_type: (REST) Payload format.
            payload: (REST) Request body TemplateString.
            expected_http_codes: (REST) Success HTTP codes.

        Returns:
            JSON with test results including status, dictionary entries,
            and type-specific computed values.

        Typical workflow:
            1. Call test_datasource with your planned configuration
            2. Check the result: status should be "success"
            3. If successful, proceed to create_dns/ldap/rest_datasource
            4. If failed, adjust configuration and test again

        Example - Test DNS CNAME lookup:
            ds_type="dns", name="test-cname",
            lookup="{{hostname}}", record_types=["cname"],
            context={"hostname": "app.corp.local"}
            -> Expect: status="success", dictionary contains cname record

        Example - Test LDAP user lookup:
            ds_type="ldap", name="test-ldap",
            hostname="ldaps://ldap.corp.local", credentials="ldap-creds",
            base_dn="DC=corp,DC=local", filter="(sAMAccountName={{user}})",
            secure=True,
            context={"user": "jdoe"}
            -> Expect: status="success", dictionary contains user attributes

        See also: create_dns_datasource / create_ldap_datasource /
            create_rest_datasource (create after testing),
            simulate_datasource_flow (test full flow pipeline with chaining).
        """
        err = _validate_ds_type(ds_type)
        if err is not None:
            return err

        ds: dict[str, Any] = {"type": ds_type, "name": name}

        if ds_type == "dns":
            if not lookup:
                return json.dumps({
                    "error": "lookup is required for DNS datasource tests.",
                })
            ds["lookup"] = lookup
            if host is not None:
                ds["host"] = host
            if port is not None:
                ds["port"] = port
            if timeout is not None:
                ds["timeout"] = timeout
            if record_types is not None:
                ds["recordTypes"] = record_types

        elif ds_type == "ldap":
            if not all([hostname, credentials, base_dn, filter]):
                return json.dumps({
                    "error": "hostname, credentials, base_dn, and filter are all required for LDAP tests.",
                })
            ds["hostname"] = hostname
            ds["credentials"] = credentials
            ds["baseDn"] = base_dn
            ds["filter"] = filter
            ds["secure"] = secure if secure is not None else False
            if port is not None:
                ds["port"] = port
            if timeout is not None:
                ds["timeout"] = timeout
            if attributes is not None:
                ds["attributes"] = attributes
            if limit is not None:
                ds["limit"] = limit

        elif ds_type == "rest":
            if not all([method, url, authentication_type]):
                return json.dumps({
                    "error": "method, url, and authentication_type are all required for REST tests.",
                })
            ds["method"] = method
            ds["url"] = url
            ds["authenticationType"] = authentication_type
            if timeout is not None:
                ds["timeout"] = timeout
            if expected_http_codes is not None:
                ds["expectedHttpCodes"] = expected_http_codes
            if credentials is not None:
                ds["credentials"] = credentials
            if headers is not None:
                ds["headers"] = headers
            if payload_type is not None:
                ds["payloadType"] = payload_type
            if payload is not None:
                ds["payload"] = payload
            if attributes is not None:
                ds["attributes"] = attributes

        body: dict[str, Any] = {"ds": ds}
        if context is not None:
            body["context"] = [{"key": k, "value": v} for k, v in context.items()]

        client = get_client()
        result = await client.patch(_DS_BASE, json=body)
        return json.dumps(result)
