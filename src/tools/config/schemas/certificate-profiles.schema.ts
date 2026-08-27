/**
 * Embedded request JSON Schema for Certificate Profiles (polymorphic).
 *
 * Build-time constant mirroring the audited certificate-profile request schema.
 * Surfaced verbatim by describe_certificate_profile_schema so the model can
 * build a correct body before create_certificate_profile /
 * update_certificate_profile.
 *
 * Polymorphic: a oneOf over 11 documented subtypes discriminated by the
 * lowercase string field module (acme, acme-external, est, scep, wcce, webra,
 * crmp, intune, intunepkcs, jamf, monitored). Server-populated fields _id and
 * tenant are ignored/stripped on write. Names are the primary key and immutable;
 * module is also immutable after creation.
 */
import certificateProfileRequestSchema from './certificate-profiles.schema.json';

export { certificateProfileRequestSchema };
