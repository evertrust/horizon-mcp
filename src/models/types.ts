/**
 * Shared Zod schemas for Horizon API nested structures.
 * These serve double duty: runtime validation AND TypeScript type inference.
 * Replaces Python's common.py Pydantic models.
 *
 * Note: ToolResult is NOT ported - it was dead code in Python (never imported
 * by any tool module). Tools return CallToolResult directly via the MCP SDK.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. AuthorizationLevels - WHO can do WHAT (28 fields incl import)
// ---------------------------------------------------------------------------

export const authorizationLevelSchema = z.object({
  accessLevel: z.string(),
  enforcedIdentityProviders: z.array(z.string()).default([]),
});
export type AuthorizationLevel = z.infer<typeof authorizationLevelSchema>;

export const authorizationLevelsSchema = z.object({
  enroll: authorizationLevelSchema.optional(),
  enrollApi: authorizationLevelSchema.optional(),
  requestEnroll: authorizationLevelSchema.optional(),
  approveEnroll: authorizationLevelSchema.optional(),
  revoke: authorizationLevelSchema.optional(),
  requestRevoke: authorizationLevelSchema.optional(),
  approveRevoke: authorizationLevelSchema.optional(),
  update: authorizationLevelSchema.optional(),
  requestUpdate: authorizationLevelSchema.optional(),
  approveUpdate: authorizationLevelSchema.optional(),
  recover: authorizationLevelSchema.optional(),
  recoverApi: authorizationLevelSchema.optional(),
  requestRecover: authorizationLevelSchema.optional(),
  approveRecover: authorizationLevelSchema.optional(),
  migrate: authorizationLevelSchema.optional(),
  requestMigrate: authorizationLevelSchema.optional(),
  approveMigrate: authorizationLevelSchema.optional(),
  renew: authorizationLevelSchema.optional(),
  renewApi: authorizationLevelSchema.optional(),
  requestRenew: authorizationLevelSchema.optional(),
  approveRenew: authorizationLevelSchema.optional(),
  import: authorizationLevelSchema.optional(),
  requestImport: authorizationLevelSchema.optional(),
  approveImport: authorizationLevelSchema.optional(),
  search: authorizationLevelSchema.optional(),
  auditRequest: authorizationLevelSchema.optional(),
});
export type AuthorizationLevels = z.infer<typeof authorizationLevelsSchema>;

// ---------------------------------------------------------------------------
// 2. RequestsPolicy - HOW LONG (durations per workflow)
// ---------------------------------------------------------------------------

export const finiteDurationSchema = z.object({
  length: z.number().int(),
  unit: z.string(),
});
export type FiniteDuration = z.infer<typeof finiteDurationSchema>;

export const requestsPolicySchema = z.object({
  enroll: finiteDurationSchema.optional(),
  revoke: finiteDurationSchema.optional(),
  update: finiteDurationSchema.optional(),
  recover: finiteDurationSchema.optional(),
  migrate: finiteDurationSchema.optional(),
  renew: finiteDurationSchema.optional(),
  import: finiteDurationSchema.optional(),
});
export type RequestsPolicy = z.infer<typeof requestsPolicySchema>;

// ---------------------------------------------------------------------------
// 3. TriggerHooks - sync (string[]) vs async (AsyncTrigger[])
// ---------------------------------------------------------------------------

export const asyncTriggerSchema = z.object({
  name: z.string(),
  activationDate: z.string().optional(),
});
export type AsyncTrigger = z.infer<typeof asyncTriggerSchema>;

export const triggerHooksSchema = z.object({
  onEnroll: z.array(z.string()).default([]),
  onPendingEnroll: z.array(asyncTriggerSchema).default([]),
  onSubmitEnroll: z.array(z.string()).default([]),
  onApproveEnroll: z.array(z.string()).default([]),
  onDenyEnroll: z.array(z.string()).default([]),
  onCancelEnroll: z.array(z.string()).default([]),
  onRevoke: z.array(z.string()).default([]),
  onSubmitRevoke: z.array(z.string()).default([]),
  onApproveRevoke: z.array(z.string()).default([]),
  onDenyRevoke: z.array(z.string()).default([]),
  onCancelRevoke: z.array(z.string()).default([]),
  onUpdate: z.array(z.string()).default([]),
  onSubmitUpdate: z.array(z.string()).default([]),
  onApproveUpdate: z.array(z.string()).default([]),
  onDenyUpdate: z.array(z.string()).default([]),
  onCancelUpdate: z.array(z.string()).default([]),
  onRecover: z.array(z.string()).default([]),
  onSubmitRecover: z.array(z.string()).default([]),
  onApproveRecover: z.array(z.string()).default([]),
  onDenyRecover: z.array(z.string()).default([]),
  onCancelRecover: z.array(z.string()).default([]),
  onMigrate: z.array(z.string()).default([]),
  onSubmitMigrate: z.array(z.string()).default([]),
  onApproveMigrate: z.array(z.string()).default([]),
  onDenyMigrate: z.array(z.string()).default([]),
  onCancelMigrate: z.array(z.string()).default([]),
  onRenew: z.array(z.string()).default([]),
  onPendingRenew: z.array(asyncTriggerSchema).default([]),
  onSubmitRenew: z.array(z.string()).default([]),
  onApproveRenew: z.array(z.string()).default([]),
  onDenyRenew: z.array(z.string()).default([]),
  onCancelRenew: z.array(z.string()).default([]),
  onImport: z.array(z.string()).default([]),
  onSubmitImport: z.array(z.string()).default([]),
  onApproveImport: z.array(z.string()).default([]),
  onDenyImport: z.array(z.string()).default([]),
  onCancelImport: z.array(z.string()).default([]),
  onExpire: z.array(asyncTriggerSchema).default([]),
});
export type TriggerHooks = z.infer<typeof triggerHooksSchema>;

// ---------------------------------------------------------------------------
// 4. CryptoPolicy - Managed vs Monitored (discriminated union)
// ---------------------------------------------------------------------------

export const managedCryptoPolicySchema = z.object({
  type: z.literal('managed'),
  defaultKeyType: z.string().optional(),
  authorizedKeyTypes: z.array(z.string()).default([]),
  preferredEnrollmentMode: z.string().optional(),
  escrow: z.boolean().default(false),
  p12passwordPolicy: z.string().optional(),
  p12passwordMode: z.string().optional(),
  p12storeEncryptionType: z.string().optional(),
  showP12Password: z.boolean().optional(),
  keyAvailability: z.string().optional(),
});
export type ManagedCryptoPolicy = z.infer<typeof managedCryptoPolicySchema>;

export const monitoredCryptoPolicySchema = z.object({
  type: z.literal('monitored'),
  authorizedKeyTypes: z.array(z.string()).default([]),
});
export type MonitoredCryptoPolicy = z.infer<typeof monitoredCryptoPolicySchema>;

export const cryptoPolicySchema = z.discriminatedUnion('type', [
  managedCryptoPolicySchema,
  monitoredCryptoPolicySchema,
]);
export type CryptoPolicy = z.infer<typeof cryptoPolicySchema>;

// ---------------------------------------------------------------------------
// 5. ValidationRuleset
// ---------------------------------------------------------------------------

export const validationRuleSchema = z.object({
  condition: z.string(),
});
export type ValidationRule = z.infer<typeof validationRuleSchema>;

export const validationRulesetSchema = z.object({
  rules: z.array(validationRuleSchema).default([]),
  threshold: z.number().int().default(1),
});
export type ValidationRuleset = z.infer<typeof validationRulesetSchema>;

// ---------------------------------------------------------------------------
// 6. DataSourceFlow
// ---------------------------------------------------------------------------

export const dataSourceFlowEntrySchema = z.object({
  datasource: z.string(),
  inputs: z.record(z.string(), z.string()).default({}),
  stopOnSuccess: z.boolean().default(false),
});
export type DataSourceFlowEntry = z.infer<typeof dataSourceFlowEntrySchema>;

export type DataSourceFlow = DataSourceFlowEntry[];

// ---------------------------------------------------------------------------
// 7. CertificateTemplate + sub-elements
// ---------------------------------------------------------------------------

export const dnElementSchema = z.object({
  type: z.string(),
  value: z.string(),
  editable: z.boolean().default(true),
  mandatory: z.boolean().default(false),
});

export const sanElementSchema = z.object({
  type: z.string(),
  value: z.string(),
  editable: z.boolean().default(true),
  mandatory: z.boolean().default(false),
});

export const extensionElementSchema = z.object({
  oid: z.string(),
  value: z.string(),
  critical: z.boolean().default(false),
});

export const labelElementSchema = z.object({
  label: z.string(),
  value: z.string(),
  editable: z.boolean().default(true),
  mandatory: z.boolean().default(false),
});

const fieldPolicySchema = z.object({
  editable: z.boolean().default(true),
  mandatory: z.boolean().default(false),
  defaultValue: z.string().optional(),
  computationRule: z.string().optional(),
});

export const ownerPolicySchema = fieldPolicySchema;
export const teamPolicySchema = fieldPolicySchema;
export const contactEmailPolicySchema = fieldPolicySchema;

export const metadataPolicySchema = fieldPolicySchema.extend({
  name: z.string(),
});

export const certificateTemplateSchema = z.object({
  subject: z.array(dnElementSchema).default([]),
  sans: z.array(sanElementSchema).default([]),
  extensions: z.array(extensionElementSchema).default([]),
  labels: z.array(labelElementSchema).default([]),
  ownerPolicy: ownerPolicySchema.optional(),
  teamPolicy: teamPolicySchema.optional(),
  contactEmailPolicy: contactEmailPolicySchema.optional(),
  metadataPolicies: z.array(metadataPolicySchema).default([]),
});
export type CertificateTemplate = z.infer<typeof certificateTemplateSchema>;

// ---------------------------------------------------------------------------
// SelfPermissions
// ---------------------------------------------------------------------------

export const selfPermissionsSchema = z.object({
  selfRecover: z.boolean().default(false),
  selfUpdate: z.boolean().default(false),
  selfRevoke: z.boolean().default(false),
  selfRenew: z.boolean().default(false),
  selfPopRenew: z.boolean().default(false),
  selfPopRevoke: z.boolean().default(false),
  selfPopUpdate: z.boolean().default(false),
});
export type SelfPermissions = z.infer<typeof selfPermissionsSchema>;

// ---------------------------------------------------------------------------
// MaxCertificatePerHolderPolicy
// ---------------------------------------------------------------------------

export const maxCertificatePerHolderPolicySchema = z.object({
  enabled: z.boolean().default(false),
  maxCertificates: z.number().int().optional(),
  action: z.string().optional(),
});
export type MaxCertificatePerHolderPolicy = z.infer<
  typeof maxCertificatePerHolderPolicySchema
>;
