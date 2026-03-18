"""Cryptographic parsing, detection, and remote certificate fetching tools.

7 tools for decoding X.509 certificates, CSRs, CRLs, OCSP responses,
TSA responses, auto-detecting cryptographic file formats, and fetching
live certificates from remote TLS endpoints.

Decode tools use the Horizon RFC 5280/6960/3161 multipart endpoints:
- ``/api/v1/rfc5280/x509``   — X.509 certificate decode
- ``/api/v1/rfc5280/pkcs10`` — PKCS#10 CSR decode
- ``/api/v1/rfc5280/crl``    — CRL decode
- ``/api/v1/rfc6960``        — OCSP response decode
- ``/api/v1/rfc3161``        — TSA response decode
- ``/api/v1/crypto/detect``  — auto-detect and decode any crypto file
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
        """Decode a PEM- or DER-encoded X.509 certificate via Horizon.

        Safety tier: read-only

        Sends the certificate to Horizon's RFC 5280 decode endpoint
        (``POST /api/v1/rfc5280/x509``, multipart/form-data) and returns
        every parsed field.

        **When to use:** after fetching a PEM with ``fetch_exposed_certificate``,
        after retrieving a certificate from the Horizon inventory, or when a
        user pastes a PEM block and wants to understand its contents.

        Args:
            pem: PEM-encoded X.509 certificate string (including the
                 ``-----BEGIN CERTIFICATE-----`` / ``-----END CERTIFICATE-----``
                 markers) **or** base64-encoded DER bytes.

        Returns:
            JSON object with the following fields:

            - ``dn`` (str): subject distinguished name.
            - ``dnElements`` (list): ordered list of DN attribute objects.
            - ``issuerDn`` (str): issuer distinguished name.
            - ``serial`` (str): serial number (hex).
            - ``notBefore`` (int): validity start as epoch milliseconds.
            - ``notAfter`` (int): validity end as epoch milliseconds.
            - ``keyType`` (str): public key algorithm, e.g. ``RSA``, ``EC``.
            - ``signingAlgorithm`` (str): signature algorithm OID / name.
            - ``pem`` (str): normalised PEM.
            - ``subjectKeyIdentifier`` (str): SKI hex string.
            - ``certificateThumbprint`` (str): SHA-256 thumbprint.
            - ``certificateSHAOneThumbprint`` (str): SHA-1 thumbprint.
            - ``publicKeyThumbprint`` (str): public-key SHA-256 thumbprint.
            - ``keyUsages`` (list[str]): key-usage flags.
            - ``isKeyUsagesCritical`` (bool): whether KU extension is critical.
            - ``extendedKeyUsages`` (list[str]): EKU OIDs.
            - ``isExtendedKeyUsagesCritical`` (bool): whether EKU is critical.
            - ``selfSigned`` (bool): true when issuer == subject and self-signed.
            - ``sans`` (list[{sanType, value}], optional): subject alternative names.
            - ``basicConstraints`` (object, optional): CA flag and path length.
            - ``extensions`` (list, optional): all extensions.
            - ``crldps`` (list[str], optional): CRL distribution points.
            - ``aias`` ({crt, ocsp}, optional): authority information access.
            - ``policies`` (list, optional): certificate policies.
            - ``authorityKeyIdentifier`` (str, optional): AKI.
            - ``unsupportedExtensions`` (list, optional): unrecognised extensions.

        See also:
            - ``fetch_exposed_certificate`` — grab a live server cert then feed
              its PEM into this tool.
            - ``decode_csr`` — decode a CSR instead.
            - ``detect_file`` — auto-detect the file type first.
        """
        client = get_client()
        result = await client.post(
            "/api/v1/rfc5280/x509",
            files={"x509": ("certificate.pem", pem.encode(), "application/x-pem-file")},
        )
        return json.dumps(result)

    @mcp.tool()
    async def decode_csr(pem: str) -> str:
        """Decode a PEM- or DER-encoded PKCS#10 Certificate Signing Request.

        Safety tier: read-only

        Sends the CSR to Horizon's RFC 5280 PKCS#10 decode endpoint
        (``POST /api/v1/rfc5280/pkcs10``, multipart/form-data) and returns
        the parsed fields.

        **When to use:** when a user provides a CSR and wants to inspect
        the subject, public key, or requested extensions before submitting
        it for enrollment.

        Args:
            pem: PEM-encoded CSR string (including the
                 ``-----BEGIN CERTIFICATE REQUEST-----`` /
                 ``-----END CERTIFICATE REQUEST-----`` markers)
                 **or** base64-encoded DER bytes.

        Returns:
            JSON object with the following fields:

            - ``dn`` (str): requested subject distinguished name.
            - ``dnElements`` (list): ordered list of DN attribute objects.
            - ``keyType`` (str): public key algorithm.
            - ``pem`` (str): normalised PEM.
            - ``sans`` (list[{sanType, value}], optional): requested SANs.
            - ``extensions`` (list, optional): requested extensions.
            - ``unsupportedExtensions`` (list, optional): unrecognised extensions.

        See also:
            - ``decode_x509`` — decode a certificate instead.
            - ``detect_file`` — auto-detect whether input is a cert or CSR.
        """
        client = get_client()
        result = await client.post(
            "/api/v1/rfc5280/pkcs10",
            files={"pkcs10": ("request.pem", pem.encode(), "application/x-pem-file")},
        )
        return json.dumps(result)

    @mcp.tool()
    async def decode_crl(data: str) -> str:
        """Decode a PEM- or DER-encoded Certificate Revocation List (CRL).

        Safety tier: read-only

        Sends the CRL to Horizon's RFC 5280 CRL decode endpoint
        (``POST /api/v1/rfc5280/crl``, multipart/form-data) and returns
        the parsed fields.

        **When to use:** when a user provides a CRL and wants to check the
        issuer, update timestamps, or CRL number.

        Args:
            data: PEM-encoded CRL string (including the
                  ``-----BEGIN X509 CRL-----`` / ``-----END X509 CRL-----``
                  markers) **or** base64-encoded DER bytes.

        Returns:
            JSON object with the following fields:

            - ``issuerDn`` (str): CRL issuer distinguished name.
            - ``thisUpdate`` (int): issuance date as epoch milliseconds.
            - ``nextUpdate`` (int): next scheduled update as epoch milliseconds.
            - ``number`` (int, optional): CRL sequence number.
            - ``version`` (int, optional): CRL version.

        See also:
            - ``decode_x509`` — decode the issuing CA certificate.
            - ``detect_file`` — auto-detect whether input is a CRL.
        """
        client = get_client()
        result = await client.post(
            "/api/v1/rfc5280/crl",
            files={"crl": ("revocation.crl", data.encode(), "application/x-pem-file")},
        )
        return json.dumps(result)

    @mcp.tool()
    async def decode_ocsp(data: str) -> str:
        """Decode an OCSP response (RFC 6960).

        Safety tier: read-only

        Sends the OCSP response to Horizon's RFC 6960 decode endpoint
        (``POST /api/v1/rfc6960``, multipart/form-data) and returns the
        parsed status and per-certificate responses.

        **When to use:** when a user has captured an OCSP response (DER
        bytes, typically base64-encoded) and wants to inspect the revocation
        status, responder identity, or per-certificate details.

        Args:
            data: base64-encoded DER bytes of the OCSP response.

        Returns:
            JSON object with the following fields:

            - ``status`` (str): top-level response status — one of
              ``"successful"``, ``"malformedRequest"``, ``"internalError"``,
              ``"tryLater"``, ``"sigRequired"``, ``"unauthorized"``.
            - ``respID`` (str, optional): responder identifier.
            - ``responses`` (list, optional): per-certificate entries, each with:
                - ``certID`` (object): ``{serial, hashAlg, issuerKeyHash,
                  issuerNameHash}``.
                - ``status`` (str): certificate status.
                - ``thisUpdate`` (int): epoch milliseconds.
                - ``nextUpdate`` (int): epoch milliseconds.

        See also:
            - ``decode_x509`` — decode the certificate referenced in the OCSP
              response.
        """
        client = get_client()
        result = await client.post(
            "/api/v1/rfc6960",
            files={
                "ocsp-response": (
                    "response.der",
                    data.encode(),
                    "application/octet-stream",
                ),
            },
        )
        return json.dumps(result)

    @mcp.tool()
    async def decode_tsa(data: str) -> str:
        """Decode a TSA (Time-Stamp Authority) response (RFC 3161).

        Safety tier: read-only

        Sends the timestamping response to Horizon's RFC 3161 decode
        endpoint (``POST /api/v1/rfc3161``, multipart/form-data) and returns
        the parsed fields.

        **When to use:** when a user has captured a timestamping response
        (DER bytes, typically base64-encoded) and wants to verify the
        timestamp policy and status.

        Args:
            data: base64-encoded DER bytes of the timestamping response.

        Returns:
            JSON object with the following fields:

            - ``policy`` (str): OID of the TSA policy.
            - ``status`` (str|int): response status.
            - ``failInfo`` (str, optional): failure reason when status is not
              ``granted``.

        See also:
            - ``decode_x509`` — decode the TSA signing certificate.
        """
        client = get_client()
        result = await client.post(
            "/api/v1/rfc3161",
            files={
                "timestamping-response": (
                    "timestamp.der",
                    data.encode(),
                    "application/octet-stream",
                ),
            },
        )
        return json.dumps(result)

    @mcp.tool()
    async def detect_file(data: str) -> str:
        """Auto-detect and decode any cryptographic file.

        Safety tier: read-only

        Sends the raw data to Horizon's crypto detection endpoint
        (``POST /api/v1/crypto/detect``, multipart/form-data). Horizon
        identifies the file type and returns both the type label and the
        decoded content.

        **When to use:** when the user provides an unknown blob of PEM,
        DER, or PKCS#7 data and you need to figure out what it is before
        choosing the right decode tool.

        Args:
            data: The cryptographic data to detect and parse. Can be
                  PEM-encoded, base64-encoded DER, or PKCS#7 content.

        Returns:
            JSON object with the following fields:

            - ``type`` (str): detected type — one of ``"certificate"``,
              ``"csr"``, ``"crl"``, ``"bundle"``, ``"ocsp-response"``,
              ``"timestamping-response"``, ``"openssh-cert"``.
            - ``value`` (object): decoded content whose schema matches the
              corresponding decode tool (e.g., same fields as ``decode_x509``
              when type is ``"certificate"``).

        See also:
            - ``decode_x509``, ``decode_csr``, ``decode_crl``,
              ``decode_ocsp``, ``decode_tsa`` — specialised decode tools
              for when the file type is already known.
        """
        client = get_client()
        result = await client.post(
            "/api/v1/crypto/detect",
            files={"file": ("unknown.bin", data.encode(), "application/octet-stream")},
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
