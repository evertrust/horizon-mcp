"""mTLS authentication provider  -  client certificates via SSLContext."""

from __future__ import annotations

import logging
import os
import shutil
import ssl
import stat
import tempfile
from pathlib import Path
from typing import Any

from horizon_mcp.auth.base import AuthProvider

logger = logging.getLogger("horizon_mcp.auth.mtls")


class MtlsAuthProvider(AuthProvider):
    """Authenticate via mutual TLS client certificate.

    Supports two input formats:
    - PEM: separate certificate and private key files
    - PKCS#12/PFX: single bundle file

    Both paths build an ``ssl.SSLContext`` returned via ``client_kwargs()``
    so httpx uses it for TLS handshake. No auth headers are needed  -  the
    certificate IS the credential.
    """

    def __init__(
        self,
        *,
        cert_path: str = "",
        key_path: str = "",
        key_password: str = "",
        pfx_path: str = "",
        pfx_password: str = "",
        verify_ssl: bool = True,
    ) -> None:
        self._cert_path = cert_path
        self._key_path = key_path
        self._key_password = key_password
        self._pfx_path = pfx_path
        self._pfx_password = pfx_password
        self._verify_ssl = verify_ssl
        self._temp_dir: str | None = None

        self._validate()
        self._ssl_ctx = self._build_ssl_context()

    # -- AuthProvider interface ------------------------------------------------

    async def get_headers(self) -> dict[str, str]:
        return {}

    async def refresh_if_needed(self) -> None:
        pass  # Client certs are static files

    def client_kwargs(self) -> dict[str, Any]:
        return {"verify": self._ssl_ctx}

    # -- Cleanup ---------------------------------------------------------------

    def cleanup(self) -> None:
        """Remove temporary PEM files extracted from PFX."""
        if self._temp_dir and Path(self._temp_dir).exists():
            shutil.rmtree(self._temp_dir, ignore_errors=True)
            logger.debug("Cleaned up temp mTLS files: %s", self._temp_dir)
            self._temp_dir = None

    # -- Internal --------------------------------------------------------------

    def _validate(self) -> None:
        """Fail fast with actionable error messages."""
        if self._cert_path:
            if not Path(self._cert_path).is_file():
                raise FileNotFoundError(
                    f"HORIZON_CLIENT_CERT file not found: {self._cert_path}"
                )
            if not self._key_path:
                raise ValueError(
                    "HORIZON_CLIENT_KEY is required when HORIZON_CLIENT_CERT is set."
                )
            if not Path(self._key_path).is_file():
                raise FileNotFoundError(
                    f"HORIZON_CLIENT_KEY file not found: {self._key_path}"
                )
        elif self._pfx_path:
            if not Path(self._pfx_path).is_file():
                raise FileNotFoundError(
                    f"HORIZON_CLIENT_PFX file not found: {self._pfx_path}"
                )

    def _build_ssl_context(self) -> ssl.SSLContext:
        """Build an SSLContext with client certificate loaded."""
        if self._cert_path:
            return self._build_pem_context()
        return self._build_pfx_context()

    def _build_pem_context(self) -> ssl.SSLContext:
        """Build SSLContext from PEM certificate and key files."""
        ctx = self._create_base_context()
        password_bytes = self._key_password.encode() if self._key_password else None
        ctx.load_cert_chain(
            certfile=self._cert_path,
            keyfile=self._key_path,
            password=password_bytes,
        )
        logger.info("mTLS: loaded PEM cert=%s key=%s", self._cert_path, self._key_path)
        return ctx

    def _build_pfx_context(self) -> ssl.SSLContext:
        """Build SSLContext from PKCS#12/PFX bundle via temp PEM files."""
        from cryptography.hazmat.primitives.serialization import (
            Encoding,
            NoEncryption,
            PrivateFormat,
            pkcs12,
        )

        pfx_data = Path(self._pfx_path).read_bytes()
        password_bytes = self._pfx_password.encode() if self._pfx_password else None

        try:
            private_key, certificate, chain = pkcs12.load_key_and_certificates(
                pfx_data, password_bytes
            )
        except ValueError as exc:
            raise ValueError(
                f"Failed to load HORIZON_CLIENT_PFX ({self._pfx_path}): {exc}. "
                "Check the file format and HORIZON_CLIENT_PFX_PASSWORD."
            ) from exc

        if private_key is None or certificate is None:
            raise ValueError(
                f"HORIZON_CLIENT_PFX ({self._pfx_path}) must contain "
                "both a private key and a certificate."
            )

        # Write to temp files with restricted permissions
        self._temp_dir = tempfile.mkdtemp(prefix="horizon_mtls_")
        cert_pem_path = os.path.join(self._temp_dir, "cert.pem")
        key_pem_path = os.path.join(self._temp_dir, "key.pem")

        cert_pem = certificate.public_bytes(Encoding.PEM)
        if chain:
            for ca_cert in chain:
                cert_pem += ca_cert.public_bytes(Encoding.PEM)

        key_pem = private_key.private_bytes(
            Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
        )

        self._write_secure(cert_pem_path, cert_pem)
        self._write_secure(key_pem_path, key_pem)

        ctx = self._create_base_context()
        try:
            ctx.load_cert_chain(certfile=cert_pem_path, keyfile=key_pem_path)
        finally:
            # Wipe temp files immediately  -  SSLContext retains certs in memory
            self.cleanup()

        logger.info("mTLS: loaded PFX bundle=%s", self._pfx_path)
        return ctx

    def _create_base_context(self) -> ssl.SSLContext:
        """Create base SSLContext respecting verify_ssl setting."""
        if self._verify_ssl:
            ctx = ssl.create_default_context()
        else:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        return ctx

    @staticmethod
    def _write_secure(path: str, data: bytes) -> None:
        """Write data to file with owner-only permissions (0o600)."""
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
        try:
            os.write(fd, data)
        finally:
            os.close(fd)
