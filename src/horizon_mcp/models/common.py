"""7 first-class shared submodels for Horizon API objects.

These models represent the complex nested structures shared across
profiles, connectors, triggers, and other Horizon objects.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 1. AuthorizationLevels — WHO can do WHAT (28 fields incl import)
# ---------------------------------------------------------------------------

class AuthorizationLevel(BaseModel):
    """Single authorization level: access + optional IDP enforcement."""
    access_level: str = Field(
        description="Access level: 'everyone', 'authenticated', or 'authorized'"
    )
    enforced_identity_providers: list[str] = Field(
        default_factory=list,
        description="IDP names that must be used for this action",
    )


class AuthorizationLevels(BaseModel):
    """28 authorization level fields covering all 7 workflows + search/audit.

    This is the WHO (access control), not the HOW LONG (that's RequestsPolicy).
    """
    # Enroll workflow
    enroll: AuthorizationLevel | None = None
    enroll_api: AuthorizationLevel | None = Field(None, alias="enrollApi")
    request_enroll: AuthorizationLevel | None = Field(None, alias="requestEnroll")
    approve_enroll: AuthorizationLevel | None = Field(None, alias="approveEnroll")

    # Revoke workflow
    revoke: AuthorizationLevel | None = None
    request_revoke: AuthorizationLevel | None = Field(None, alias="requestRevoke")
    approve_revoke: AuthorizationLevel | None = Field(None, alias="approveRevoke")

    # Update workflow
    update: AuthorizationLevel | None = None
    request_update: AuthorizationLevel | None = Field(None, alias="requestUpdate")
    approve_update: AuthorizationLevel | None = Field(None, alias="approveUpdate")

    # Recover workflow
    recover: AuthorizationLevel | None = None
    recover_api: AuthorizationLevel | None = Field(None, alias="recoverApi")
    request_recover: AuthorizationLevel | None = Field(None, alias="requestRecover")
    approve_recover: AuthorizationLevel | None = Field(None, alias="approveRecover")

    # Migrate workflow
    migrate: AuthorizationLevel | None = None
    request_migrate: AuthorizationLevel | None = Field(None, alias="requestMigrate")
    approve_migrate: AuthorizationLevel | None = Field(None, alias="approveMigrate")

    # Renew workflow
    renew: AuthorizationLevel | None = None
    renew_api: AuthorizationLevel | None = Field(None, alias="renewApi")
    request_renew: AuthorizationLevel | None = Field(None, alias="requestRenew")
    approve_renew: AuthorizationLevel | None = Field(None, alias="approveRenew")

    # Import workflow
    import_: AuthorizationLevel | None = Field(None, alias="import")
    request_import: AuthorizationLevel | None = Field(None, alias="requestImport")
    approve_import: AuthorizationLevel | None = Field(None, alias="approveImport")

    # Search + audit
    search: AuthorizationLevel | None = None
    audit_request: AuthorizationLevel | None = Field(None, alias="auditRequest")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# 2. RequestsPolicy — HOW LONG (durations per workflow)
# ---------------------------------------------------------------------------

class FiniteDuration(BaseModel):
    """Duration with unit (e.g., 30 days, 24 hours)."""
    length: int
    unit: str = Field(description="Time unit: 'seconds', 'minutes', 'hours', 'days'")


class RequestsPolicy(BaseModel):
    """Duration limits per workflow request type.

    This is the HOW LONG (timeout), not the WHO (that's AuthorizationLevels).
    """
    enroll: FiniteDuration | None = None
    revoke: FiniteDuration | None = None
    update: FiniteDuration | None = None
    recover: FiniteDuration | None = None
    migrate: FiniteDuration | None = None
    renew: FiniteDuration | None = None
    import_: FiniteDuration | None = Field(None, alias="import")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# 3. TriggerHooks — sync (list[str]) vs async (list[AsyncTrigger])
# ---------------------------------------------------------------------------

class AsyncTrigger(BaseModel):
    """Asynchronous trigger with optional activation date."""
    name: str
    activation_date: str | None = Field(
        None,
        alias="activationDate",
        description="ISO 8601 date/time or relative expression (e.g., '-30d')",
    )

    model_config = {"populate_by_name": True}


class TriggerHooks(BaseModel):
    """Profile trigger hooks: sync = list[str], async = list[AsyncTrigger].

    Sync hooks fire immediately. Async hooks fire after activation_date.
    """
    # Enroll
    on_enroll: list[str] = Field(default_factory=list, alias="onEnroll")
    on_pending_enroll: list[AsyncTrigger] = Field(default_factory=list, alias="onPendingEnroll")
    on_submit_enroll: list[str] = Field(default_factory=list, alias="onSubmitEnroll")
    on_approve_enroll: list[str] = Field(default_factory=list, alias="onApproveEnroll")
    on_deny_enroll: list[str] = Field(default_factory=list, alias="onDenyEnroll")
    on_cancel_enroll: list[str] = Field(default_factory=list, alias="onCancelEnroll")

    # Revoke
    on_revoke: list[str] = Field(default_factory=list, alias="onRevoke")
    on_submit_revoke: list[str] = Field(default_factory=list, alias="onSubmitRevoke")
    on_approve_revoke: list[str] = Field(default_factory=list, alias="onApproveRevoke")
    on_deny_revoke: list[str] = Field(default_factory=list, alias="onDenyRevoke")
    on_cancel_revoke: list[str] = Field(default_factory=list, alias="onCancelRevoke")

    # Update
    on_update: list[str] = Field(default_factory=list, alias="onUpdate")
    on_submit_update: list[str] = Field(default_factory=list, alias="onSubmitUpdate")
    on_approve_update: list[str] = Field(default_factory=list, alias="onApproveUpdate")
    on_deny_update: list[str] = Field(default_factory=list, alias="onDenyUpdate")
    on_cancel_update: list[str] = Field(default_factory=list, alias="onCancelUpdate")

    # Recover
    on_recover: list[str] = Field(default_factory=list, alias="onRecover")
    on_submit_recover: list[str] = Field(default_factory=list, alias="onSubmitRecover")
    on_approve_recover: list[str] = Field(default_factory=list, alias="onApproveRecover")
    on_deny_recover: list[str] = Field(default_factory=list, alias="onDenyRecover")
    on_cancel_recover: list[str] = Field(default_factory=list, alias="onCancelRecover")

    # Migrate
    on_migrate: list[str] = Field(default_factory=list, alias="onMigrate")
    on_submit_migrate: list[str] = Field(default_factory=list, alias="onSubmitMigrate")
    on_approve_migrate: list[str] = Field(default_factory=list, alias="onApproveMigrate")
    on_deny_migrate: list[str] = Field(default_factory=list, alias="onDenyMigrate")
    on_cancel_migrate: list[str] = Field(default_factory=list, alias="onCancelMigrate")

    # Renew
    on_renew: list[str] = Field(default_factory=list, alias="onRenew")
    on_pending_renew: list[AsyncTrigger] = Field(default_factory=list, alias="onPendingRenew")
    on_submit_renew: list[str] = Field(default_factory=list, alias="onSubmitRenew")
    on_approve_renew: list[str] = Field(default_factory=list, alias="onApproveRenew")
    on_deny_renew: list[str] = Field(default_factory=list, alias="onDenyRenew")
    on_cancel_renew: list[str] = Field(default_factory=list, alias="onCancelRenew")

    # Import
    on_import: list[str] = Field(default_factory=list, alias="onImport")
    on_submit_import: list[str] = Field(default_factory=list, alias="onSubmitImport")
    on_approve_import: list[str] = Field(default_factory=list, alias="onApproveImport")
    on_deny_import: list[str] = Field(default_factory=list, alias="onDenyImport")
    on_cancel_import: list[str] = Field(default_factory=list, alias="onCancelImport")

    # Expire (always async)
    on_expire: list[AsyncTrigger] = Field(default_factory=list, alias="onExpire")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# 4. CryptoPolicy — ManagedCryptoPolicy vs MonitoredCryptoPolicy (discriminated)
# ---------------------------------------------------------------------------

class ManagedCryptoPolicy(BaseModel):
    """Crypto policy for managed (PKI-connected) profiles."""
    type: Literal["managed"] = "managed"
    default_key_type: str | None = Field(None, alias="defaultKeyType")
    authorized_key_types: list[str] = Field(default_factory=list, alias="authorizedKeyTypes")
    preferred_enrollment_mode: str | None = Field(None, alias="preferredEnrollmentMode")
    escrow: bool = False
    p12_password_policy: str | None = Field(None, alias="p12passwordPolicy")
    p12_password_mode: str | None = Field(None, alias="p12passwordMode")
    p12_store_encryption_type: str | None = Field(None, alias="p12storeEncryptionType")
    show_p12_password: bool | None = Field(None, alias="showP12Password")
    key_availability: str | None = Field(None, alias="keyAvailability")

    model_config = {"populate_by_name": True}


class MonitoredCryptoPolicy(BaseModel):
    """Crypto policy for monitored profiles (no PKI connector, read-only lifecycle)."""
    type: Literal["monitored"] = "monitored"
    authorized_key_types: list[str] = Field(default_factory=list, alias="authorizedKeyTypes")

    model_config = {"populate_by_name": True}


CryptoPolicy = ManagedCryptoPolicy | MonitoredCryptoPolicy


# ---------------------------------------------------------------------------
# 5. ValidationRuleset
# ---------------------------------------------------------------------------

class ValidationRule(BaseModel):
    """Single validation rule with a condition expression."""
    condition: str = Field(description="Computation rule expression evaluating to boolean")


class ValidationRuleset(BaseModel):
    """Validation ruleset for auto-validation profiles."""
    rules: list[ValidationRule] = Field(default_factory=list)
    threshold: int = Field(
        default=1,
        description="Minimum number of rules that must pass for auto-validation",
    )


# ---------------------------------------------------------------------------
# 6. DataSourceFlow
# ---------------------------------------------------------------------------

class DataSourceFlowEntry(BaseModel):
    """Single entry in a datasource flow chain."""
    datasource: str = Field(description="Datasource name")
    inputs: dict[str, str] = Field(
        default_factory=dict,
        description="Input mappings: datasource param → computation rule expression",
    )
    stop_on_success: bool = Field(
        default=False,
        alias="stopOnSuccess",
        description="Stop flow chain if this datasource returns results",
    )

    model_config = {"populate_by_name": True}


DataSourceFlow = list[DataSourceFlowEntry]


# ---------------------------------------------------------------------------
# 7. CertificateTemplate + sub-elements
# ---------------------------------------------------------------------------

class DNElement(BaseModel):
    """Distinguished Name element (CN, O, OU, etc.)."""
    type: str = Field(description="DN attribute type: CN, O, OU, C, ST, L, etc.")
    value: str = Field(description="Value or computation rule expression")
    editable: bool = True
    mandatory: bool = False


class SANElement(BaseModel):
    """Subject Alternative Name element."""
    type: str = Field(description="SAN type: dns, email, ip, uri, upn, etc.")
    value: str = Field(description="Value or computation rule expression")
    editable: bool = True
    mandatory: bool = False


class ExtensionElement(BaseModel):
    """X.509 extension element."""
    oid: str = Field(description="Extension OID (e.g., '2.5.29.37' for EKU)")
    value: str
    critical: bool = False


class LabelElement(BaseModel):
    """Certificate label element."""
    label: str = Field(description="Label name (must exist in Horizon)")
    value: str = Field(description="Value or computation rule expression")
    editable: bool = True
    mandatory: bool = False


class OwnerPolicy(BaseModel):
    """Certificate owner policy."""
    editable: bool = True
    mandatory: bool = False
    default_value: str | None = Field(None, alias="defaultValue")
    computation_rule: str | None = Field(None, alias="computationRule")

    model_config = {"populate_by_name": True}


class TeamPolicy(BaseModel):
    """Certificate team policy."""
    editable: bool = True
    mandatory: bool = False
    default_value: str | None = Field(None, alias="defaultValue")
    computation_rule: str | None = Field(None, alias="computationRule")

    model_config = {"populate_by_name": True}


class ContactEmailPolicy(BaseModel):
    """Certificate contact email policy."""
    editable: bool = True
    mandatory: bool = False
    default_value: str | None = Field(None, alias="defaultValue")
    computation_rule: str | None = Field(None, alias="computationRule")

    model_config = {"populate_by_name": True}


class MetadataPolicy(BaseModel):
    """Certificate metadata field policy."""
    name: str
    editable: bool = True
    mandatory: bool = False
    default_value: str | None = Field(None, alias="defaultValue")
    computation_rule: str | None = Field(None, alias="computationRule")

    model_config = {"populate_by_name": True}


class CertificateTemplate(BaseModel):
    """Full certificate template with subject, SANs, extensions, labels, and policies."""
    subject: list[DNElement] = Field(default_factory=list)
    sans: list[SANElement] = Field(default_factory=list)
    extensions: list[ExtensionElement] = Field(default_factory=list)
    labels: list[LabelElement] = Field(default_factory=list)
    owner_policy: OwnerPolicy | None = Field(None, alias="ownerPolicy")
    team_policy: TeamPolicy | None = Field(None, alias="teamPolicy")
    contact_email_policy: ContactEmailPolicy | None = Field(None, alias="contactEmailPolicy")
    metadata_policies: list[MetadataPolicy] = Field(default_factory=list, alias="metadataPolicies")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# SelfPermissions
# ---------------------------------------------------------------------------

class SelfPermissions(BaseModel):
    """Self-service permissions for certificate holders."""
    self_recover: bool = Field(default=False, alias="selfRecover")
    self_update: bool = Field(default=False, alias="selfUpdate")
    self_revoke: bool = Field(default=False, alias="selfRevoke")
    self_renew: bool = Field(default=False, alias="selfRenew")
    self_pop_renew: bool = Field(default=False, alias="selfPopRenew",
                                  description="Proof-of-possession renewal")
    self_pop_revoke: bool = Field(default=False, alias="selfPopRevoke",
                                   description="Proof-of-possession revocation")
    self_pop_update: bool = Field(default=False, alias="selfPopUpdate",
                                   description="Proof-of-possession update")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# MaxCertificatePerHolderPolicy
# ---------------------------------------------------------------------------

class MaxCertificatePerHolderPolicy(BaseModel):
    """Policy limiting certificates per holder."""
    enabled: bool = False
    max_certificates: int | None = Field(None, alias="maxCertificates")
    action: str | None = Field(None, description="Action on limit: 'block' or 'revoke_oldest'")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# ToolResult — standard response wrapper
# ---------------------------------------------------------------------------

class ToolResult(BaseModel):
    """Standard tool response wrapper.

    content: Human-readable summary (never raw JSON).
    structured_content: Full JSON with optional warnings and request_id.
    """
    content: str
    structured_content: dict[str, Any] = Field(default_factory=dict)

    def with_warnings(self, warnings: list[str]) -> ToolResult:
        if warnings:
            self.structured_content["warnings"] = warnings
        return self

    def with_request_id(self, request_id: str) -> ToolResult:
        self.structured_content["request_id"] = request_id
        return self


__all__ = [
    "AuthorizationLevel",
    "AuthorizationLevels",
    "FiniteDuration",
    "RequestsPolicy",
    "AsyncTrigger",
    "TriggerHooks",
    "ManagedCryptoPolicy",
    "MonitoredCryptoPolicy",
    "CryptoPolicy",
    "ValidationRule",
    "ValidationRuleset",
    "DataSourceFlowEntry",
    "DataSourceFlow",
    "DNElement",
    "SANElement",
    "ExtensionElement",
    "LabelElement",
    "OwnerPolicy",
    "TeamPolicy",
    "ContactEmailPolicy",
    "MetadataPolicy",
    "CertificateTemplate",
    "SelfPermissions",
    "MaxCertificatePerHolderPolicy",
    "ToolResult",
]
