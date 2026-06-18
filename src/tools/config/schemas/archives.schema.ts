/**
 * Embedded request JSON Schema for Archives (polymorphic).
 *
 * Build-time constant mirroring docs/audit/archives.schema.json verbatim.
 * Surfaced by `describe_archive_schema` so the model can build a correct body
 * before create_archive.
 *
 * Polymorphic: a oneOf over two concrete subtypes discriminated by `type`
 * (certificate -> CertificateArchive, event -> EventArchive). Server-populated
 * fields (_id, status, count, error, createdAt, purgeAt, tenant) are stripped on
 * write and only appear in responses. There is no update (PUT/PATCH) endpoint -
 * archives are create-and-delete only.
 */
export const archiveRequestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://evertrust.fr/horizon/schemas/archives.create-request.json',
  title: 'Archives create request body (POST /api/v1/archives)',
  description:
    "Self-contained resolved request schema for registering a Horizon archive. Polymorphic on the 'type' discriminator: 'certificate' -> CertificateArchive, 'event' -> EventArchive. Server-populated fields (_id, status, count, error, createdAt, purgeAt, tenant) are stripped from the input before deserialization (models/archive/Archive.scala archiveFormat.ignoreFields) and MUST NOT be supplied; if supplied they are silently ignored. There is no update (PUT/PATCH) endpoint - archives are create-and-delete only.",
  oneOf: [
    { $ref: '#/$defs/CertificateArchive' },
    { $ref: '#/$defs/EventArchive' },
  ],
  $defs: {
    CertificateArchive: {
      type: 'object',
      title: 'Certificate Archive',
      description:
        'An archive of certificates matching an HCQL filter. Requires CLM or PKI license entitlement.',
      properties: {
        name: {
          type: 'string',
          description:
            "Primary key / immutable identifier of the archive. Must be unique (enforced by a unique Mongo index 'name_idx' and by a pre-insert existence check returning ARCHIVE-004 'Archive already exists').",
        },
        type: {
          type: 'string',
          description:
            "Discriminator. Must be 'certificate' for a CertificateArchive.",
          enum: ['certificate'],
        },
        filename: {
          type: 'string',
          description:
            "Target output file name for the archive (Apache Parquet). Must be unique across archives (ARCHIVE validation: 'Archive <x> already uses file name ...') and must not already exist on the configured storage backend.",
        },
        archiveKeys: {
          type: 'boolean',
          description:
            'Whether escrowed private keys are included in the archive.',
        },
        filter: {
          type: ['string', 'null'],
          description:
            "Optional HCQL filter selecting which certificates to archive. Validated server-side via HCQLParser.parse; an invalid filter yields ARCHIVE-002 'Invalid archive'.",
        },
      },
      required: ['name', 'type', 'filename', 'archiveKeys'],
      additionalProperties: false,
    },
    EventArchive: {
      type: 'object',
      title: 'Event Archive',
      description:
        'An archive of events occurring before a given instant. Requires CLM, PKI or DCV license entitlement.',
      properties: {
        name: {
          type: 'string',
          description:
            "Primary key / immutable identifier of the archive. Must be unique (unique Mongo index 'name_idx'; pre-insert check returns ARCHIVE-004 'Archive already exists').",
        },
        type: {
          type: 'string',
          description: "Discriminator. Must be 'event' for an EventArchive.",
          enum: ['event'],
        },
        filename: {
          type: 'string',
          description:
            'Target output file name for the archive (Apache Parquet). Must be unique across archives and not already exist on the configured storage backend.',
        },
        before: {
          type: 'integer',
          format: 'epoch',
          example: 1609459200000,
          description:
            "Epoch milliseconds. Date before which all events will be archived. Server validation: must be earlier than (now - horizon.archive.eventGracePeriod), and event archiving is rejected entirely when horizon.event.ttl is configured. Violations yield ARCHIVE-002 'Invalid archive'.",
        },
      },
      required: ['name', 'type', 'filename', 'before'],
      additionalProperties: false,
    },
  },
} as const;
