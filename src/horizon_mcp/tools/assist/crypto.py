"""Cryptographic parsing and detection tools.

3 tools for decoding X.509 certificates, CSRs, and auto-detecting
RFC 5280 file formats (PEM, DER base64, PKCS#7).
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

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
