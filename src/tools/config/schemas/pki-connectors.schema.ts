/**
 * Embedded resolved request JSON Schema for PKI connectors.
 *
 * This JSON file is the embedded, resolved schema derived from the Horizon
 * Scala case classes + bundled OpenAPI. Polymorphic union discriminated by the
 * lowercase 'type' field (22 subtypes). Surfaced verbatim through
 * describe_pki_connector_schema so the model never guesses the per-subtype
 * structure.
 *
 * Server-managed fields '_id', 'status', 'tenant' are stripped on read and MUST
 * NOT be sent; ACME-enroll 'account'/'accountUrl' are server-populated and
 * ignored on input.
 */
import pkiConnectorRequestSchema from './pki-connectors.schema.json';

export { pkiConnectorRequestSchema };
