/**
 * Embedded resolved request JSON Schema for triggers.
 *
 * Source of truth: docs/audit/triggers.schema.json (resolved from the Scala
 * Trigger case classes + bundled OpenAPI). Polymorphic union discriminated by
 * the lowercase `type` field (11 subtypes). Surfaced verbatim through
 * describe_trigger_schema so the model never guesses the per-subtype structure.
 */
export const triggerRequestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://evertrust.fr/horizon/schemas/triggers.request.json',
  title: 'Horizon Trigger (create/update request body)',
  description:
    "Self-contained resolved JSON Schema for the request body of POST /api/v1/triggers (create) and PUT /api/v1/triggers (update). The body is a polymorphic oneOf discriminated by the 'type' field. The same body shape is used for both create and update; the object is keyed by 'name' (immutable primary key). Server-populated fields '_id' and 'tenant' are ignored on input (Trigger.triggerFormat.ignoreFields(\"_id\",\"tenant\").removeField(\"tenant\")).",
  oneOf: [
    { $ref: '#/$defs/EmailNotification' },
    { $ref: '#/$defs/WebhookNotification' },
    { $ref: '#/$defs/REST' },
    { $ref: '#/$defs/AzureKeyVaultTrigger' },
    { $ref: '#/$defs/F5ClientTrigger' },
    { $ref: '#/$defs/F5AS3Trigger' },
    { $ref: '#/$defs/AWSTrigger' },
    { $ref: '#/$defs/IntunePKCSTrigger' },
    { $ref: '#/$defs/GCMTrigger' },
    { $ref: '#/$defs/LDAPTrigger' },
    { $ref: '#/$defs/NetscalerTrigger' },
  ],
  $defs: {
    TriggerEvent: {
      type: 'string',
      description:
        'Source of truth: app/models/trigger/TriggerEvent.scala (enumeratum PlayEnum, entryName values). This is the authoritative superset; OpenAPI Base.events enum is a subset.',
      enum: [
        'on_enroll',
        'on_submit_enroll',
        'on_cancel_enroll',
        'on_approve_enroll',
        'on_deny_enroll',
        'on_pending_enroll',
        'on_in_progress_enroll',
        'on_failure_enroll',
        'on_revoke',
        'on_submit_revoke',
        'on_cancel_revoke',
        'on_approve_revoke',
        'on_deny_revoke',
        'on_pending_revoke',
        'on_failure_revoke',
        'on_update',
        'on_submit_update',
        'on_cancel_update',
        'on_approve_update',
        'on_deny_update',
        'on_pending_update',
        'on_recover',
        'on_submit_recover',
        'on_cancel_recover',
        'on_approve_recover',
        'on_deny_recover',
        'on_pending_recover',
        'on_migrate',
        'on_submit_migrate',
        'on_cancel_migrate',
        'on_approve_migrate',
        'on_deny_migrate',
        'on_pending_migrate',
        'on_expire',
        'on_license_expiration',
        'on_credentials_expiration',
        'on_license_usage',
        'on_dcv_license_usage',
        'on_renew',
        'on_submit_renew',
        'on_cancel_renew',
        'on_approve_renew',
        'on_deny_renew',
        'on_pending_renew',
        'on_in_progress_renew',
        'on_failure_renew',
        'on_import',
        'on_submit_import',
        'on_cancel_import',
        'on_approve_import',
        'on_deny_import',
        'on_pending_import',
        'on_test',
        'on_trigger_error',
      ],
    },
    FiniteDuration: {
      type: 'string',
      format: 'Finite Duration',
      pattern:
        '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
      example: '30 s',
    },
    TriggerErrorTriggers: {
      type: 'object',
      description:
        'Error-handler chain run on the on_trigger_error event. Source: app/models/trigger/TriggerErrorTriggers.scala. Optional on every subtype (uses Jsonx.formatCaseClassUseDefaults). NOT present in the OpenAPI request schemas.',
      properties: {
        onTriggerError: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
            description: 'Name of another trigger to run on error',
          },
        },
      },
      additionalProperties: false,
    },
    EmailRecipient: {
      type: 'object',
      description:
        'Source: models.notification.email.recipient.EmailRecipient. Title: Email recipient.',
      properties: {
        type: {
          type: 'string',
          description:
            "The type of email recipient. Apart from 'static', all are deduced from the request context. Source of truth: app/models/notification/email/recipient/EmailRecipientType.scala (11 values). The OpenAPI EmailRecipient enum omits 'team_members'.",
          enum: [
            'static',
            'team_contact',
            'label',
            'requester',
            'contact',
            'approver',
            'certificate_rfc822name',
            'team_manager',
            'team_members',
            'certificate_owner',
            'lifecycle_operators',
          ],
        },
        email: {
          type: 'string',
          nullable: true,
          description: "Mandatory for 'static' recipient, ignored otherwise.",
        },
        label: {
          type: 'string',
          nullable: true,
          description: "Mandatory for 'label' recipient, ignored otherwise.",
        },
      },
      required: ['type'],
    },
    MapEntry: {
      type: 'object',
      description: 'Source: models.common.MapEntry. Used for email headers.',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['key', 'value'],
    },
    EmailTemplate: {
      type: 'object',
      title: 'Email template',
      description:
        "Source: app/models/notification/email/EmailTemplate.scala (Jsonx.formatCaseClassUseDefaults). 'cc', 'bcc', 'headers' exist in Scala but are NOT documented in the OpenAPI EmailTemplate request schema.",
      properties: {
        to: {
          type: 'array',
          nullable: true,
          items: { $ref: '#/$defs/EmailRecipient' },
          description:
            "Recipients. Server validation requires non-empty 'to' (EmailNotification constructor).",
        },
        cc: {
          type: 'array',
          nullable: true,
          items: { $ref: '#/$defs/EmailRecipient' },
        },
        bcc: {
          type: 'array',
          nullable: true,
          items: { $ref: '#/$defs/EmailRecipient' },
        },
        from: {
          type: 'string',
          description:
            'Sender address. Must be a valid email (EmailTemplate.validateUpsert).',
        },
        title: {
          type: 'string',
          description: 'TemplateString (supports dynamic attributes).',
        },
        body: {
          type: 'string',
          nullable: true,
          description: 'TemplateString (supports dynamic attributes).',
        },
        isHtml: { type: 'boolean' },
        headers: {
          type: 'array',
          nullable: true,
          items: { $ref: '#/$defs/MapEntry' },
        },
      },
      required: ['from', 'to', 'title', 'isHtml'],
    },
    Webhook: {
      type: 'object',
      title: 'Webhook Definition',
      properties: {
        type: {
          type: 'string',
          enum: ['slack', 'teams'],
          description:
            'Webhook target type (Teams or Slack/Mattermost). Scala WebhookType also supports mattermost.',
        },
        url: { type: 'string', description: 'The webhook URL.' },
      },
      required: ['type', 'url'],
    },
    WebhookRecipient: {
      type: 'object',
      title: 'Webhook Recipient',
      properties: {
        type: {
          type: 'string',
          enum: ['static', 'team'],
          description:
            "Whether the webhook is defined here ('static') or taken dynamically from the certificate's team ('team').",
        },
        webhook: {
          allOf: [{ $ref: '#/$defs/Webhook' }],
          description: "Mandatory in 'static' mode.",
        },
      },
      required: ['type'],
    },
    WebhookTemplate: {
      type: 'object',
      title: 'Webhook template',
      properties: {
        to: {
          allOf: [{ $ref: '#/$defs/WebhookRecipient' }],
          description: 'The target of the webhook.',
        },
        title: { type: 'string', description: 'TemplateString.' },
        body: {
          type: 'string',
          nullable: true,
          description: 'TemplateString.',
        },
      },
      required: ['to', 'title'],
    },
    RESTHeader: {
      type: 'object',
      title: 'Header',
      properties: {
        name: { type: 'string', example: 'Content-Type' },
        value: { type: 'string', example: 'application/json' },
      },
      required: ['name', 'value'],
    },
    CustomRestTrigger: {
      type: 'object',
      description:
        "A single REST request in the 'sequence'. Each request enriches the dictionary with its response for the next.",
      properties: {
        method: { type: 'string', description: 'HTTP method.', example: 'GET' },
        url: { type: 'string', format: 'url', description: 'URL to request.' },
        authenticationType: {
          type: 'string',
          enum: ['noauth', 'basic', 'x509', 'bearer', 'custom'],
          description: "Auth type; linked to 'credentials'.",
        },
        credentials: {
          type: 'string',
          nullable: true,
          description:
            'Name of the credentials to use. Dependency: must reference an existing Credentials object.',
        },
        headers: {
          type: 'array',
          nullable: true,
          items: { $ref: '#/$defs/RESTHeader' },
        },
        payloadType: {
          type: 'string',
          nullable: true,
          description: 'UI hint for body formatting.',
        },
        payload: {
          type: 'string',
          nullable: true,
          description: 'Request body; may contain dynamic attributes.',
        },
        expectedHttpCodes: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Success HTTP codes.',
        },
        proxy: {
          type: 'string',
          nullable: true,
          description:
            'Name of an HTTP Proxy to use. Dependency: must reference an existing Proxy.',
        },
        timeout: { $ref: '#/$defs/FiniteDuration' },
      },
    },
    EmailNotification: {
      type: 'object',
      title: 'Email Notification',
      description:
        'type=email. Domain model: app/models/notification/email/EmailNotification.scala.',
      properties: {
        name: {
          type: 'string',
          description:
            "Immutable primary key. Unique index on 'triggers.name'.",
        },
        type: { type: 'string', const: 'email', enum: ['email'] },
        events: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: { $ref: '#/$defs/TriggerEvent' },
          description:
            'MUST contain exactly one value (server uses events.head). Each value must be in the subtype authorizedEvent set.',
        },
        retries: {
          type: 'integer',
          nullable: true,
          description:
            '0..horizonConfiguration.trigger.maxRetries (validateConfiguration).',
        },
        runPeriod: {
          allOf: [{ $ref: '#/$defs/FiniteDuration' }],
          nullable: true,
          description: 'Only valid on on_expire / on_pending_* events.',
        },
        licenceUsagePercent: {
          type: 'integer',
          nullable: true,
          description:
            '0..100. Must be set on on_license_usage and must NOT be set otherwise.',
        },
        runOnRenewed: {
          type: 'boolean',
          nullable: true,
          description: 'Only valid on on_expire event.',
        },
        emailTemplate: { $ref: '#/$defs/EmailTemplate' },
        ifPkcs12: {
          type: 'boolean',
          nullable: true,
          description:
            'null=always; true=only when PKCS#12 present; false=only when absent.',
        },
        attachPemCertificate: { type: 'boolean', nullable: true },
        attachPemBundle: { type: 'boolean', nullable: true },
        attachDerCertificate: { type: 'boolean', nullable: true },
        attachPkcs7: { type: 'boolean', nullable: true },
        attachPkcs7Bundle: { type: 'boolean', nullable: true },
        attachPkcs12: {
          type: 'boolean',
          nullable: true,
          description: 'Only valid on on_approve_enroll/recover/renew events.',
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'events', 'emailTemplate'],
    },
    WebhookNotification: {
      type: 'object',
      title: 'Webhook Notification (Groupware)',
      description:
        'type=webhook. Domain model: app/models/notification/webhook/WebhookNotification.scala.',
      properties: {
        name: { type: 'string', description: 'Immutable primary key.' },
        type: { type: 'string', const: 'webhook', enum: ['webhook'] },
        events: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: { $ref: '#/$defs/TriggerEvent' },
        },
        retries: {
          type: 'integer',
          nullable: true,
          description:
            'Number of retries when the notification fails (non-200 return code).',
        },
        runPeriod: {
          allOf: [{ $ref: '#/$defs/FiniteDuration' }],
          nullable: true,
        },
        licenceUsagePercent: { type: 'integer', nullable: true },
        runOnRenewed: { type: 'boolean', nullable: true },
        webhookTemplate: { $ref: '#/$defs/WebhookTemplate' },
        proxy: {
          type: 'string',
          nullable: true,
          description:
            'Name of a Proxy to use. Dependency: must reference an existing Proxy.',
        },
        timeout: {
          allOf: [{ $ref: '#/$defs/FiniteDuration' }],
          nullable: true,
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'events', 'webhookTemplate'],
    },
    REST: {
      type: 'object',
      title: 'REST notification',
      description:
        'type=rest. Domain model: app/models/notification/rest/CustomRESTNotification.scala (class CustomRESTNotification).',
      properties: {
        name: { type: 'string', description: 'Immutable primary key.' },
        type: { type: 'string', const: 'rest', enum: ['rest'] },
        events: {
          type: 'array',
          minItems: 1,
          maxItems: 1,
          items: { $ref: '#/$defs/TriggerEvent' },
        },
        retries: {
          type: 'integer',
          nullable: true,
          description: 'Retries on failure (depends on expectedHttpCodes).',
        },
        runPeriod: {
          allOf: [{ $ref: '#/$defs/FiniteDuration' }],
          nullable: true,
        },
        licenceUsagePercent: { type: 'integer', nullable: true },
        runOnRenewed: { type: 'boolean', nullable: true },
        sequence: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/CustomRestTrigger' },
          description:
            'REST requests in execution order. Server rejects empty sequence (CustomRESTNotification constructor).',
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'events', 'sequence'],
    },
    AzureKeyVaultTrigger: {
      type: 'object',
      title: 'Third-Party AKV',
      description:
        "type=akv. Domain model: app/models/thirdparty/azure/AzureKeyVaultTrigger.scala. 'events' is server-fixed (not a client input).",
      properties: {
        name: { type: 'string', description: 'Immutable primary key.' },
        type: { type: 'string', const: 'akv', enum: ['akv'] },
        retries: { type: 'integer', format: 'int32', nullable: true },
        connector: {
          type: 'string',
          description:
            'Name of the third-party connector. Dependency: must reference an existing ThirdPartyConnector of matching type (validateThirdPartyConnector).',
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'connector'],
    },
    F5ClientTrigger: {
      type: 'object',
      title: 'Third-Party F5',
      description:
        'type=f5client. Domain model: app/models/thirdparty/f5/icontrol/F5ClientTrigger.scala.',
      properties: {
        name: { type: 'string', description: 'Immutable primary key.' },
        type: { type: 'string', const: 'f5client', enum: ['f5client'] },
        retries: { type: 'integer', format: 'int32', nullable: true },
        connector: {
          type: 'string',
          description:
            'Name of the third-party connector. Dependency: must pre-exist.',
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'connector'],
    },
    F5AS3Trigger: {
      type: 'object',
      title: 'Third-Party F5 AS3',
      description:
        "type=f5as3. Domain model: app/models/thirdparty/f5/as3/F5AS3Trigger.scala. NOTE: not present in the GET /api/v1/triggers 'types' query enum.",
      properties: {
        name: { type: 'string', description: 'Immutable primary key.' },
        type: { type: 'string', const: 'f5as3', enum: ['f5as3'] },
        retries: { type: 'integer', format: 'int32', nullable: true },
        connector: {
          type: 'string',
          description:
            'Name of the third-party connector. Dependency: must pre-exist.',
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'connector'],
    },
    AWSTrigger: {
      type: 'object',
      title: 'Third-Party AWS',
      description:
        'type=aws. Domain model: app/models/thirdparty/aws/AWSTrigger.scala.',
      properties: {
        name: { type: 'string', description: 'Immutable primary key.' },
        type: { type: 'string', const: 'aws', enum: ['aws'] },
        retries: { type: 'integer', format: 'int32', nullable: true },
        connector: {
          type: 'string',
          description:
            'Name of the third-party connector. Dependency: must pre-exist.',
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'connector'],
    },
    IntunePKCSTrigger: {
      type: 'object',
      title: 'Third-Party Intune PKCS',
      description:
        'type=intunepkcs. Domain model: app/models/intune/IntunePKCSTrigger.scala.',
      properties: {
        name: { type: 'string', description: 'Immutable primary key.' },
        type: { type: 'string', const: 'intunepkcs', enum: ['intunepkcs'] },
        retries: { type: 'integer', format: 'int32', nullable: true },
        connector: {
          type: 'string',
          description:
            'Name of the third-party connector. Dependency: must pre-exist.',
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'connector'],
    },
    GCMTrigger: {
      type: 'object',
      title: 'Third-Party GCM',
      description:
        'type=gcm. Domain model: app/models/thirdparty/google/GCMTrigger.scala.',
      properties: {
        name: { type: 'string', description: 'Immutable primary key.' },
        type: { type: 'string', const: 'gcm', enum: ['gcm'] },
        retries: { type: 'integer', format: 'int32', nullable: true },
        connector: {
          type: 'string',
          description:
            'Name of the third-party connector. Dependency: must pre-exist.',
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'connector'],
    },
    LDAPTrigger: {
      type: 'object',
      title: 'Third-Party LDAP',
      description:
        'type=ldappub. Domain model: app/models/thirdparty/ldap/LDAPCertificatePublisherTrigger.scala.',
      properties: {
        name: { type: 'string', description: 'Immutable primary key.' },
        type: { type: 'string', const: 'ldappub', enum: ['ldappub'] },
        retries: { type: 'integer', format: 'int32', nullable: true },
        connector: {
          type: 'string',
          description:
            'Name of the third-party connector. Dependency: must pre-exist.',
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'connector'],
    },
    NetscalerTrigger: {
      type: 'object',
      title: 'Third-Party Netscaler',
      description:
        "type=netscaler. Domain model: app/models/thirdparty/netscaler/NetscalerTrigger.scala. NOTE: not present in the GET /api/v1/triggers 'types' query enum.",
      properties: {
        name: { type: 'string', description: 'Immutable primary key.' },
        type: { type: 'string', const: 'netscaler', enum: ['netscaler'] },
        retries: { type: 'integer', format: 'int32', nullable: true },
        connector: {
          type: 'string',
          description:
            'Name of the third-party connector. Dependency: must pre-exist.',
        },
        triggers: {
          allOf: [{ $ref: '#/$defs/TriggerErrorTriggers' }],
          nullable: true,
        },
      },
      required: ['name', 'type', 'connector'],
    },
  },
} as const;
