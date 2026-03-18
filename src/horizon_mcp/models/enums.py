"""All enumerations for Horizon API objects."""

from __future__ import annotations

from enum import Enum


class ModuleType(str, Enum):
    """Certificate profile module types."""
    WEBRA = "webra"
    ACME = "acme"
    ACME_EXTERNAL = "acmeexternal"
    SCEP = "scep"
    EST = "est"
    WCCE = "wcce"
    CRMP = "crmp"
    INTUNE = "intune"
    INTUNE_PKCS = "intunepkcs"
    JAMF = "jamf"
    MONITORED = "monitored"


class AccessLevel(str, Enum):
    """Authorization access levels  -  WHO can perform the action."""
    EVERYONE = "everyone"
    AUTHENTICATED = "authenticated"
    AUTHORIZED = "authorized"


class HavingOperator(str, Enum):
    """Aggregate query having operators (6 including ne)."""
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    EQ = "eq"
    NE = "ne"


class WorkflowType(str, Enum):
    """Certificate lifecycle workflow types (7 including import)."""
    ENROLL = "enroll"
    REVOKE = "revoke"
    UPDATE = "update"
    RECOVER = "recover"
    MIGRATE = "migrate"
    RENEW = "renew"
    IMPORT = "import"


class PKIConnectorType(str, Enum):
    """PKI connector types (22)."""
    STREAM = "stream"
    ACME_ENROLL = "acmeenroll"
    ACME_REVOKE = "acmerevoke"
    EVT_ADCS = "evtadcs"
    MS_ADCS = "msadcs"
    AWS_ACM_PCA = "awsacmpca"
    CERTEUROPE = "certeurope"
    CMP = "cmp"
    DIGICERT = "digicert"
    EJBCA = "ejbca"
    ENTRUST = "entrust"
    IDCA = "idca"
    INTEGRATED = "integrated"
    FCMS = "fcms"
    GS_ATLAS = "gsatlas"
    GS_MSSL = "gsmssl"
    OTPKI = "otpki"
    METAPKI = "metapki"
    NAMESHIELD = "nameshield"
    NEXUS_CM = "nexuscm"
    SECTIGO = "sectigo"
    SWISSSIGN = "swisssign"


class ThirdPartyConnectorType(str, Enum):
    """Third-party connector types (10)."""
    AWS = "aws"
    AKV = "akv"
    F5_AS3 = "f5as3"
    F5_CLIENT = "f5client"
    GCM = "gcm"
    INTUNE = "intune"
    INTUNE_PKCS = "intunepkcs"
    JAMF = "jamf"
    LDAP_PUB = "ldappub"
    MS_AD = "msad"


class TriggerType(str, Enum):
    """Trigger types (10): 3 notification + 7 third-party.

    Notification triggers send notifications about certificate lifecycle events:
      - email: EmailNotification (sends email with optional cert attachments)
      - rest: CustomRESTNotification (sequential HTTP calls with auth/headers/payload)
      - webhook: WebhookNotification (Teams/Slack/Mattermost via incoming webhook)

    Third-party triggers push/remove certificates to external systems:
      - akv: Azure Key Vault
      - aws: AWS Certificate Manager / Secrets Manager
      - f5client: F5 BIG-IP (client certificate)
      - f5as3: F5 AS3 (Application Services 3)
      - intunepkcs: Microsoft Intune PKCS
      - ldappub: LDAP publish
      - gcm: Google Cloud Certificate Manager
    """
    # Notification triggers
    EMAIL = "email"
    REST = "rest"
    WEBHOOK = "webhook"
    # Third-party triggers
    AKV = "akv"
    AWS = "aws"
    F5CLIENT = "f5client"
    F5AS3 = "f5as3"
    INTUNEPKCS = "intunepkcs"
    LDAPPUB = "ldappub"
    GCM = "gcm"


class CertificateFormat(str, Enum):
    """Certificate download formats."""
    PEM = "pem"
    DER = "der"
    PKCS7 = "pkcs7"
    PKCS12 = "pkcs12"
    JKS = "jks"


class SortOrder(str, Enum):
    """Sort order for aggregate queries."""
    ASC = "Asc"
    DESC = "Desc"
    KEY_ASC = "KeyAsc"
    KEY_DESC = "KeyDesc"


class QueryType(str, Enum):
    """Horizon query language types."""
    HCQL = "hcql"
    HRQL = "hrql"
    HEQL = "heql"
    HDQL = "hdql"


class AuthorizationMode(str, Enum):
    """Profile authorization modes (varies by module)."""
    AUTHORIZED = "authorized"
    AUTO_VALIDATION = "auto-validation"
    AUTO_VALIDATION_AUTHORIZED = "auto-validation-authorized"
    CHALLENGE = "challenge"
    X509 = "x509"
    NDES = "ndes"


class CryptoMode(str, Enum):
    """Crypto policy key generation modes."""
    CENTRALIZED = "centralized"
    DECENTRALIZED = "decentralized"


class KeyType(str, Enum):
    """Certificate key type families.

    Horizon stores the algorithm family only  -  key size is a separate attribute.
    Values are ALL CAPS in API responses but case-insensitive on input.
    """
    RSA = "RSA"
    ECDSA = "ECDSA"
    EDDSA = "EDDSA"
    UNKNOWN = "UNKNOWN"


class DiscoveryScanType(str, Enum):
    """Discovery scan types.

    Values are ALL CAPS in API responses but case-insensitive on input.
    """
    NETSCAN = "NETSCAN"
    LOCALSCAN = "LOCALSCAN"
    NETIMPORT = "NETIMPORT"
    IMPORTSCAN = "IMPORTSCAN"


class RequestStatus(str, Enum):
    """Certificate request statuses."""
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    CANCELED = "CANCELED"
    EXPIRED = "EXPIRED"
    COMPLETED = "COMPLETED"


class Grade(str, Enum):
    """Certificate grading values (A+ through N/A)."""
    A_PLUS = "A+"
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    E = "E"
    F = "F"
    T = "T"
    M = "M"
    NA = "N/A"


class P12PasswordMode(str, Enum):
    """PKCS#12 password modes."""
    MANUAL = "manual"
    RANDOM = "random"
    NONE = "none"


class P12StoreEncryptionType(str, Enum):
    """PKCS#12 store encryption types."""
    LEGACY = "legacy"
    MODERN = "modern"


class DataSourceType(str, Enum):
    """Data source types."""
    DNS = "dns"
    LDAP = "ldap"
    REST = "rest"


class IDPType(str, Enum):
    """Identity provider types."""
    LOCAL = "local"
    OPENID = "openid"


class SafetyTier(str, Enum):
    """Tool safety tiers."""
    READ_ONLY = "read-only"
    MUTATING_SAFE = "mutating-safe"
    MUTATING_DESTRUCTIVE = "mutating-destructive"
    SECURITY_SENSITIVE = "security-sensitive"


class SearchPreset(str, Enum):
    """Search result field presets."""
    COMPACT = "compact"
    DIAGNOSTIC = "diagnostic"
    COMPLIANCE = "compliance"
