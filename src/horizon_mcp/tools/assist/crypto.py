"""Cryptographic parsing, detection, and remote certificate fetching tools.

4 tools for decoding X.509 certificates, CSRs, auto-detecting
RFC 5280 file formats, and fetching live certificates from remote TLS endpoints.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import socket
import ssl
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("horizon_mcp.tools.assist.crypto")


def register_crypto_tools(mcp: FastMCP) -> None:
    """Register crypto parsing tools on *mcp*."""

    from horizon_mcp.client.state import get_client

    @mcp.tool()
    async def decode_x509(pem: str) -> str:
        """Decode a PEM-encoded X.509 certificate and display its fields.

        Safety tier: read-only

        Parses the certificate server-side and returns structured fields
        including subject, issuer, validity dates, extensions, key info,
        and signature algorithm.

        Args:
            pem: PEM-encoded X.509 certificate string (including the
                 ``-----BEGIN CERTIFICATE-----`` and
                 ``-----END CERTIFICATE-----`` markers).

        Returns:
            JSON with parsed certificate fields.
        """
        client = get_client()
        result = await client.post(
            "/api/v1/certificates/decode",
            json={"pem": pem},
        )
        return json.dumps(result)

    @mcp.tool()
    async def decode_csr(pem: str) -> str:
        """Decode a PEM-encoded PKCS#10 Certificate Signing Request (CSR).

        Safety tier: read-only

        Parses the CSR server-side and returns structured fields including
        the subject, public key info, requested extensions, and signature.

        Args:
            pem: PEM-encoded CSR string (including the
                 ``-----BEGIN CERTIFICATE REQUEST-----`` and
                 ``-----END CERTIFICATE REQUEST-----`` markers).

        Returns:
            JSON with parsed CSR fields.
        """
        client = get_client()
        result = await client.post(
            "/api/v1/certificates/csr/decode",
            json={"pem": pem},
        )
        return json.dumps(result)

    @mcp.tool()
    async def detect_file(data: str) -> str:
        """Auto-detect and parse an RFC 5280 cryptographic file.

        Safety tier: read-only

        Accepts PEM, DER (base64-encoded), or PKCS#7 data and
        automatically identifies the format and content type. Returns
        the parsed structure along with the detected format.

        Args:
            data: The cryptographic data to detect and parse. Can be
                  PEM-encoded, base64-encoded DER, or PKCS#7 content.

        Returns:
            JSON with detected format and parsed content fields.
        """
        client = get_client()
        result = await client.post(
            "/api/v1/certificates/detect",
            json={"data": data},
        )
        return json.dumps(result)

    @mcp.tool()
    async def fetch_exposed_certificate(
        uri: str,
        timeout: int = 10,
    ) -> str:
        """Fetch the TLS certificate exposed by a remote server.

        Safety tier: read-only (outbound TLS connection only, no data sent)

        Connects to the specified host and port, performs a TLS handshake,
        and retrieves the server's leaf certificate. Useful for:
        - Verifying a certificate deployed through the CLM is actually live
        - Comparing the exposed certificate against what Horizon manages
        - Feeding the PEM into decode_x509 for detailed parsing
        - Importing discovered certificates into Horizon via discovery feed

        The URI format is ``protocol://fqdn:port`` or just ``fqdn:port``.
        The protocol is used only to determine the default port if omitted:
        - https → 443
        - ldaps → 636
        - imaps → 993
        - smtps → 465
        - ftps  → 990
        If no protocol and no port, defaults to 443.

        Args:
            uri: Target endpoint. Examples:
                 ``https://www.example.com``
                 ``ldaps://dc01.corp.local:636``
                 ``192.168.1.1:8443``
                 ``mail.example.com:993``
            timeout: Connection timeout in seconds (default 10).

        Returns:
            JSON with the leaf certificate PEM, subject, issuer, SANs,
            validity dates, serial number, and thumbprint (SHA-256).
        """
        host, port = _parse_tls_uri(uri)

        def _fetch() -> bytes:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            with socket.create_connection((host, port), timeout=timeout) as sock:
                with ctx.wrap_socket(sock, server_hostname=host) as tls:
                    der = tls.getpeercert(binary_form=True)
                    if not der:
                        raise ValueError("Server did not present a certificate")
                    return der

        try:
            der_bytes = await asyncio.get_event_loop().run_in_executor(None, _fetch)
        except (socket.timeout, TimeoutError):
            return json.dumps({
                "error": True,
                "content": f"Connection to {host}:{port} timed out after {timeout}s.",
            })
        except (ConnectionRefusedError, OSError) as exc:
            return json.dumps({
                "error": True,
                "content": f"Cannot connect to {host}:{port}: {exc}",
            })

        cert = x509.load_der_x509_certificate(der_bytes)
        pem = cert.public_bytes(serialization.Encoding.PEM).decode("ascii")
        thumbprint = cert.fingerprint(hashes.SHA256()).hex()

        san_list: list[str] = []
        try:
            san_ext = cert.extensions.get_extension_for_class(
                x509.SubjectAlternativeName,
            )
            san_list = san_ext.value.get_values_for_type(x509.DNSName)
        except x509.ExtensionNotFound:
            pass

        result: dict[str, Any] = {
            "content": (
                f"Certificate from {host}:{port} — "
                f"CN={cert.subject.get_attributes_for_oid(x509.oid.NameOID.COMMON_NAME)[0].value if cert.subject.get_attributes_for_oid(x509.oid.NameOID.COMMON_NAME) else 'N/A'}, "
                f"expires {cert.not_valid_after_utc.isoformat()}"
            ),
            "pem": pem,
            "subject": cert.subject.rfc4514_string(),
            "issuer": cert.issuer.rfc4514_string(),
            "serial": format(cert.serial_number, "x"),
            "not_before": cert.not_valid_before_utc.isoformat(),
            "not_after": cert.not_valid_after_utc.isoformat(),
            "thumbprint_sha256": thumbprint,
            "dns_sans": san_list,
            "host": host,
            "port": port,
        }
        return json.dumps(result)


# ---------------------------------------------------------------------------
# URI parsing helper
# ---------------------------------------------------------------------------

_DEFAULT_PORTS: dict[str, int] = {
    "https": 443,
    "ldaps": 636,
    "imaps": 993,
    "smtps": 465,
    "ftps": 990,
}


def _parse_tls_uri(uri: str) -> tuple[str, int]:
    """Parse a TLS URI into (host, port).

    Accepts formats:
        https://host:port
        host:port
        host (defaults to port 443)
    """
    uri = uri.strip()

    # If it looks like scheme://..., parse with urlparse
    if re.match(r"^[a-z]+://", uri, re.IGNORECASE):
        parsed = urlparse(uri)
        host = parsed.hostname or ""
        port = parsed.port or _DEFAULT_PORTS.get(parsed.scheme.lower(), 443)
        return host, port

    # host:port
    if ":" in uri:
        parts = uri.rsplit(":", 1)
        try:
            return parts[0], int(parts[1])
        except ValueError:
            pass

    # bare hostname
    return uri, 443
