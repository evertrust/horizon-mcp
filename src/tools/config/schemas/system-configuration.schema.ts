/**
 * Embedded, fully-resolved request JSON Schema for the Horizon System
 * Configuration upsert body (PUT /api/v1/system/configuration).
 *
 * Build-time constant mirrored verbatim from
 * docs/audit/system_configuration.schema.json. The body is a discriminated
 * union keyed on `type` (oneOf license | internal_monitor |
 * interface_customization | storage). The server-managed `_id` and stripped
 * `tenant` fields are NOT part of the request body and do not appear here.
 *
 * Surfaced to the model via the describe_system_config_schema tool so the
 * config body is never guessed.
 */
export const systemConfigurationRequestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://evertrust.fr/horizon/schemas/system_configuration.request.json',
  title:
    'System Configuration upsert request body (PUT /api/v1/system/configuration)',
  description:
    'Self-contained resolved JSON Schema for the PUT (upsert) request body of the Horizon System Configuration singleton-per-type object. The body is a discriminated union keyed on the `type` field. Resolved from bundled OpenAPI components (LicenseConfiguration, InternalMonitorConfiguration, InterfaceCustomizationConfiguration, StorageConfiguration) and confirmed against the Scala domain model. The server-populated `_id` field is NOT part of the request body (ignored on write via SystemConfigurationEntry.systemConfigurationEntryFormat.ignoreFields("_id")), and `tenant` is stripped (removeField("tenant")). Therefore neither appears here.',
  oneOf: [
    { $ref: '#/$defs/LicenseConfiguration' },
    { $ref: '#/$defs/InternalMonitorConfiguration' },
    { $ref: '#/$defs/InterfaceCustomizationConfiguration' },
    { $ref: '#/$defs/StorageConfiguration' },
  ],
  $defs: {
    LicenseConfiguration: {
      title: 'License Configuration',
      type: 'object',
      properties: {
        type: {
          type: 'string',
          const: 'license',
          description: 'The discriminator. Selects this subtype.',
        },
        triggers: {
          description:
            'Triggers to execute on license events. Optional (defaults to null/absent). Server validates that every referenced trigger name exists AND is runnable on the corresponding event (InvalidReferenceException / InvalidObjectAttributeException -> HTTP 400).',
          type: ['object', 'null'],
          $ref: '#/$defs/LicenseTriggers',
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
    LicenseTriggers: {
      title: 'License Triggers',
      type: 'object',
      properties: {
        onLicenseExpiration: {
          description:
            'Names of the triggers to execute when the license expires. Each name MUST reference an existing trigger runnable on ON_LICENSE_EXPIRATION.',
          type: ['array', 'null'],
          items: { type: 'string' },
        },
        onLicenseUsage: {
          description:
            'Names of the triggers to execute when the license usage exceeds threshold. Each name MUST reference an existing trigger runnable on ON_LICENSE_USAGE.',
          type: ['array', 'null'],
          items: { type: 'string' },
        },
      },
      additionalProperties: false,
    },
    InternalMonitorConfiguration: {
      title: 'Internal Monitor Configuration',
      type: 'object',
      properties: {
        type: {
          type: 'string',
          const: 'internal_monitor',
          description: 'The discriminator. Selects this subtype.',
        },
        cron: {
          type: 'string',
          description:
            'Quartz Cron expression defining when to run internal monitor checks. MANDATORY (no default in domain model). Parsed as org.quartz.CronExpression via CronExpressionFormat; an invalid expression is rejected with HTTP 400.',
          examples: ['0 0 0 ? * * *', '0 /1 * ? * *'],
        },
      },
      required: ['type', 'cron'],
      additionalProperties: false,
    },
    InterfaceCustomizationConfiguration: {
      title: 'Interface Customization Configuration',
      type: 'object',
      properties: {
        type: {
          type: 'string',
          const: 'interface_customization',
          description: 'The discriminator. Selects this subtype.',
        },
        logo: {
          type: ['string', 'null'],
          description:
            'A logo to display on the product, base64 encoded. Optional (default null).',
        },
        headerStart: {
          type: ['string', 'null'],
          description:
            'The HTML color code for the left side of the banner gradient. Optional (default null).',
          examples: ['abcdef', '#fcba03'],
        },
        headerEnd: {
          type: ['string', 'null'],
          description:
            'The HTML color code for the right side of the banner gradient. Optional (default null).',
          examples: ['fedcba', '#fc03d2'],
        },
        announcements: {
          type: 'array',
          description:
            'Announcements to display to all users in the Horizon instance. Optional (defaults to empty array).',
          items: { $ref: '#/$defs/Announcement' },
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
    Announcement: {
      title: 'Announcement',
      type: 'object',
      description: 'An announcement to display.',
      properties: {
        level: {
          type: 'string',
          description: 'The announcement level. Required.',
          enum: ['info', 'warning', 'danger'],
        },
        content: {
          type: 'array',
          description:
            "The announcement contents. Server-enforced: MUST contain at least one element (Announcement.announcementFormat rejects empty content with JsError 'expected at least one element').",
          minItems: 1,
          items: { $ref: '#/$defs/LocalizedString' },
        },
      },
      required: ['level', 'content'],
      additionalProperties: false,
    },
    LocalizedString: {
      title: 'LocalizedString',
      type: 'object',
      properties: {
        lang: {
          type: 'string',
          description:
            'The ISO 3166-1 (2-letters) code of the language used for the value. Required.',
          examples: ['en', 'fr'],
        },
        value: {
          type: 'string',
          description: 'The localized value. Required.',
          examples: ['Value In English'],
        },
      },
      required: ['lang', 'value'],
      additionalProperties: false,
    },
    StorageConfiguration: {
      title: 'Storage Configuration',
      type: 'object',
      properties: {
        type: {
          type: 'string',
          const: 'storage',
          description:
            'The discriminator. Selects this subtype. NOTE: the body discriminator value is the literal `storage` (Scala SystemConfigurationEntryType.STORAGE.entryName). The GET /{type} path parameter enum lists `storage_configuration`, which is a documented mismatch in the bundled OpenAPI; the actual stored/discriminated type value is `storage`.',
        },
        archiveStorage: {
          type: ['string', 'null'],
          description:
            "Name of a system storage to use for archive file storage. Optional. If set, MUST reference an existing storage (system.storage object); otherwise rejected with InvalidObjectAttributeException -> HTTP 400. The referenced storage's type must be allowed by horizonConfiguration.storage.",
        },
        magicLinkReportStorage: {
          type: ['string', 'null'],
          description:
            'Name of a system storage to use for magic link reports storage. Optional. Same existence/allowed-type validation as archiveStorage.',
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
} as const;
