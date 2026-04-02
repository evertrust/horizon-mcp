export enum ModuleType {
  WEBRA = "webra",
  ACME = "acme",
  ACME_EXTERNAL = "acmeexternal",
  SCEP = "scep",
  EST = "est",
  WCCE = "wcce",
  CRMP = "crmp",
  INTUNE = "intune",
  INTUNE_PKCS = "intunepkcs",
  JAMF = "jamf",
  MONITORED = "monitored",
}

export enum AccessLevel {
  EVERYONE = "everyone",
  AUTHENTICATED = "authenticated",
  AUTHORIZED = "authorized",
}

export enum HavingOperator {
  GT = "gt",
  GTE = "gte",
  LT = "lt",
  LTE = "lte",
  EQ = "eq",
  NE = "ne",
}

export enum WorkflowType {
  ENROLL = "enroll",
  REVOKE = "revoke",
  UPDATE = "update",
  RECOVER = "recover",
  MIGRATE = "migrate",
  RENEW = "renew",
  IMPORT = "import",
}

export enum PKIConnectorType {
  STREAM = "stream",
  ACME_ENROLL = "acmeenroll",
  ACME_REVOKE = "acmerevoke",
  EVT_ADCS = "evtadcs",
  MS_ADCS = "msadcs",
  AWS_ACM_PCA = "awsacmpca",
  CERTEUROPE = "certeurope",
  CMP = "cmp",
  DIGICERT = "digicert",
  EJBCA = "ejbca",
  ENTRUST = "entrust",
  IDCA = "idca",
  INTEGRATED = "integrated",
  FCMS = "fcms",
  GS_ATLAS = "gsatlas",
  GS_MSSL = "gsmssl",
  OTPKI = "otpki",
  METAPKI = "metapki",
  NAMESHIELD = "nameshield",
  NEXUS_CM = "nexuscm",
  SECTIGO = "sectigo",
  SWISSSIGN = "swisssign",
}

export enum ThirdPartyConnectorType {
  AWS = "aws",
  AKV = "akv",
  F5_AS3 = "f5as3",
  F5_CLIENT = "f5client",
  GCM = "gcm",
  INTUNE = "intune",
  INTUNE_PKCS = "intunepkcs",
  JAMF = "jamf",
  LDAP_PUB = "ldappub",
  MS_AD = "msad",
}

export enum TriggerType {
  EMAIL = "email",
  REST = "rest",
  WEBHOOK = "webhook",
  AKV = "akv",
  AWS = "aws",
  F5CLIENT = "f5client",
  F5AS3 = "f5as3",
  INTUNEPKCS = "intunepkcs",
  LDAPPUB = "ldappub",
  GCM = "gcm",
}

export enum CertificateFormat {
  PEM = "pem",
  DER = "der",
  PKCS7 = "pkcs7",
  PKCS12 = "pkcs12",
  JKS = "jks",
}

export enum SortOrder {
  ASC = "Asc",
  DESC = "Desc",
  KEY_ASC = "KeyAsc",
  KEY_DESC = "KeyDesc",
}

export enum QueryType {
  HCQL = "hcql",
  HRQL = "hrql",
  HEQL = "heql",
  HDQL = "hdql",
}

export enum AuthorizationMode {
  AUTHORIZED = "authorized",
  AUTO_VALIDATION = "auto-validation",
  AUTO_VALIDATION_AUTHORIZED = "auto-validation-authorized",
  CHALLENGE = "challenge",
  X509 = "x509",
  NDES = "ndes",
}

export enum CryptoMode {
  CENTRALIZED = "centralized",
  DECENTRALIZED = "decentralized",
}

export enum KeyType {
  RSA = "RSA",
  ECDSA = "ECDSA",
  EDDSA = "EDDSA",
  UNKNOWN = "UNKNOWN",
}

export enum DiscoveryScanType {
  NETSCAN = "NETSCAN",
  LOCALSCAN = "LOCALSCAN",
  NETIMPORT = "NETIMPORT",
  IMPORTSCAN = "IMPORTSCAN",
}

export enum RequestStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  DENIED = "DENIED",
  CANCELED = "CANCELED",
  EXPIRED = "EXPIRED",
  COMPLETED = "COMPLETED",
}

export enum Grade {
  A_PLUS = "A+",
  A = "A",
  B = "B",
  C = "C",
  D = "D",
  E = "E",
  F = "F",
  T = "T",
  M = "M",
  NA = "N/A",
}

export enum P12PasswordMode {
  MANUAL = "manual",
  RANDOM = "random",
  NONE = "none",
}

export enum P12StoreEncryptionType {
  LEGACY = "legacy",
  MODERN = "modern",
}

export enum DataSourceType {
  DNS = "dns",
  LDAP = "ldap",
  REST = "rest",
}

export enum IDPType {
  LOCAL = "local",
  OPENID = "openid",
}

export enum SafetyTier {
  READ_ONLY = "read-only",
  MUTATING_SAFE = "mutating-safe",
  MUTATING_DESTRUCTIVE = "mutating-destructive",
  SECURITY_SENSITIVE = "security-sensitive",
}

export enum SearchPreset {
  COMPACT = "compact",
  DIAGNOSTIC = "diagnostic",
  COMPLIANCE = "compliance",
}
