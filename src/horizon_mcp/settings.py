"""Configuration via environment variables using pydantic-settings."""

from __future__ import annotations

from pydantic_settings import BaseSettings


class HorizonSettings(BaseSettings):
    """Horizon MCP Server settings loaded from environment variables."""

    model_config = {"env_prefix": "HORIZON_"}

    url: str = "https://localhost"
    api_id: str = ""
    api_key: str = ""
    auth_mode: str = ""  # deprecated  -  auto-detected from credentials

    # mTLS: PEM files
    client_cert: str = ""
    client_key: str = ""
    client_key_password: str = ""

    # mTLS: PKCS#12/PFX bundle
    client_pfx: str = ""
    client_pfx_password: str = ""
    verify_ssl: bool = True
    login_timeout: int = 300  # Browser login timeout in seconds
    timeout: int = 30
    export_timeout: int = 120
    log_level: str = "INFO"

    # Version compatibility
    tested_versions: tuple[str, ...] = ("2.8",)
    warn_versions: tuple[str, ...] = ("2.7", "2.9")

    @property
    def base_url(self) -> str:
        return self.url.rstrip("/")
