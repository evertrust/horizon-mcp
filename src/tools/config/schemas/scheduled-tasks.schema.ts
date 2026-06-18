/**
 * Embedded request JSON Schema for Scheduled Tasks (polymorphic).
 *
 * Build-time constant mirroring docs/audit/scheduled_tasks.schema.json. Surfaced
 * verbatim by `describe_scheduled_task_schema` so the model can build a correct
 * body before create_scheduled_task / update_scheduled_task.
 *
 * Polymorphic: a oneOf over three subtypes discriminated by `type`
 * (thirdparty | report) and, for reports, by `reportType`
 * (attachment_email | link_email).
 */
export const scheduledTaskRequestSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://evertrust.io/horizon/schemas/scheduled_tasks.request.json',
  title: 'ScheduledTasks (create/update request body)',
  description:
    'Request body for POST /api/v1/scheduler/tasks (create) and PUT /api/v1/scheduler/tasks (update). Polymorphic: a oneOf over three concrete subtypes discriminated first by `type` (thirdparty | report) and, for reports, by `reportType` (link_email | attachment_email). Server-populated fields (host, status, lastExecutionDate, lastCompletionDate, detail, executionId) and the internal id (_id) are ignored/stripped on write and only appear in responses. Names are the primary key and immutable.',
  oneOf: [
    { $ref: '#/$defs/ThirdPartyScheduledTask' },
    { $ref: '#/$defs/AttachmentReportScheduledTask' },
    { $ref: '#/$defs/LinkReportScheduledTask' },
  ],
  $defs: {
    ScheduledTaskType: {
      type: 'string',
      enum: ['thirdparty', 'report'],
      description: 'Discriminator for the scheduled task family.',
    },
    ReportType: {
      type: 'string',
      enum: ['attachment_email', 'link_email'],
      description: 'Discriminator for report subtypes.',
    },
    HQLType: {
      type: 'string',
      enum: ['hcql', 'hpql', 'hrql', 'heql', 'hdql'],
      description:
        'Query language for the report. Note: hpql is accepted by the enum but searchQuery() only supports hcql/hrql/heql/hdql; report validation rejects hpql.',
    },
    ReportRecipientType: {
      type: 'string',
      enum: ['static', 'team_contact', 'team_manager', 'team_members'],
      description:
        'static requires email and forbids team; the team_* types require team and forbid email.',
    },
    SortOrder: {
      type: 'string',
      enum: ['Asc', 'Desc', 'KeyAsc', 'KeyDesc'],
    },
    CronExpression: {
      type: 'string',
      description:
        'Quartz cron expression. Validated server-side by org.quartz.CronExpression; invalid expressions are rejected with a parse error.',
    },
    FiniteDuration: {
      type: 'string',
      pattern:
        '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
      description: "Scala FiniteDuration string, e.g. '10s', '7 days'.",
    },
    ReportRecipient: {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { $ref: '#/$defs/ReportRecipientType' },
        email: {
          type: ['string', 'null'],
          description:
            'Mandatory and must be a valid email when type=static; must be absent for team_* types.',
        },
        team: {
          type: ['string', 'null'],
          description:
            'Mandatory when type is team_contact/team_manager/team_members; must be absent when type=static. Referenced team must already exist.',
        },
      },
    },
    MapEntry: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'value'],
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
    },
    SortElement: {
      type: 'object',
      additionalProperties: false,
      required: ['element', 'order'],
      properties: {
        element: {
          type: 'string',
          description: 'Field to sort by; must be one of the query fields.',
        },
        order: { $ref: '#/$defs/SortOrder' },
      },
    },
    ThirdPartyScheduledTask: {
      type: 'object',
      additionalProperties: false,
      description:
        'type=thirdparty. Drives third-party connector enroll/revoke/renew runs against a profile.',
      required: [
        'type',
        'name',
        'cron',
        'enabled',
        'dryRun',
        'module',
        'profile',
        'connector',
        'enroll',
        'revoke',
        'renew',
      ],
      properties: {
        type: { const: 'thirdparty' },
        name: {
          type: 'string',
          description:
            'Primary key. Immutable after creation (update is keyed by name).',
        },
        cron: { $ref: '#/$defs/CronExpression' },
        enabled: { type: 'boolean' },
        dryRun: { type: 'boolean' },
        module: {
          type: 'string',
          description:
            'Horizon module (e.g. an mdm/protocol module). Drives permission scope.',
        },
        profile: {
          type: 'string',
          description:
            'Certificate profile name. Must exist for the given module and be enabled.',
        },
        connector: {
          type: 'string',
          description:
            'Third party connector name. Must exist and be authorized on the module.',
        },
        enroll: { type: 'boolean' },
        revoke: { type: 'boolean' },
        renew: {
          type: 'boolean',
          description:
            'Required in the Scala case class (no default). OpenAPI omits it from the required list; Scala is authoritative => required.',
        },
        description: { type: ['string', 'null'] },
        _id: {
          type: 'string',
          description:
            'Server-populated internal id. Ignored on write (ignoreFields _id). Present only on responses.',
        },
        host: {
          type: ['string', 'null'],
          description: 'Server-populated; stripped on create.',
        },
        status: {
          type: ['string', 'null'],
          enum: ['warning', 'failure', 'success', 'running', null],
          description: 'Server-populated; stripped on create.',
        },
        lastExecutionDate: {
          type: ['integer', 'null'],
          description: 'Server-populated epoch millis; stripped on create.',
        },
        lastCompletionDate: {
          type: ['integer', 'null'],
          description: 'Server-populated epoch millis; stripped on create.',
        },
        detail: {
          type: ['string', 'null'],
          description: 'Server-populated; stripped on create.',
        },
        executionId: {
          type: ['string', 'null'],
          description: 'Server-populated; defaults to null.',
        },
      },
    },
    ReportCommon: {
      type: 'object',
      description:
        'Shared report fields (type=report). Concrete subtypes refine reportType and add their own fields.',
      properties: {
        type: { const: 'report' },
        name: {
          type: 'string',
          description: 'Primary key. Immutable after creation.',
        },
        cron: { $ref: '#/$defs/CronExpression' },
        enabled: { type: 'boolean' },
        from: {
          type: 'string',
          description:
            'Sender email. Validated server-side as a real email address (require isEmail).',
        },
        title: { type: 'string', description: 'Email subject.' },
        isHtml: { type: 'boolean' },
        recipients: {
          type: 'array',
          items: { $ref: '#/$defs/ReportRecipient' },
          description: "Primary recipients (the 'to' field).",
        },
        cc: {
          type: ['array', 'null'],
          items: { $ref: '#/$defs/ReportRecipient' },
          description:
            'Present in Scala case classes via formatCaseClassUseDefaults; absent from OpenAPI. Optional.',
        },
        bcc: {
          type: ['array', 'null'],
          items: { $ref: '#/$defs/ReportRecipient' },
          description:
            'Present in Scala case classes; absent from OpenAPI. Optional.',
        },
        body: { type: ['string', 'null'] },
        fileName: {
          type: ['string', 'null'],
          pattern: '^[0-9a-zA-Z\\-_\\.]+$',
          description:
            'Optional; when set must match [0-9a-zA-Z-_.]+ else InvalidObjectAttributeException.',
        },
        hqlType: { $ref: '#/$defs/HQLType' },
        hqlQuery: {
          type: ['string', 'null'],
          description: 'Validated by the matching HQL parser at upsert.',
        },
        hqlFields: { type: ['array', 'null'], items: { type: 'string' } },
        hqlSortedBy: {
          type: ['array', 'null'],
          items: { $ref: '#/$defs/SortElement' },
        },
        headers: {
          type: ['array', 'null'],
          items: { $ref: '#/$defs/MapEntry' },
          description:
            'Present in Scala case classes; absent from OpenAPI. Optional email headers.',
        },
        description: { type: ['string', 'null'] },
        _id: {
          type: 'string',
          description:
            'Server-populated internal id. Ignored on write. Response only.',
        },
        host: {
          type: ['string', 'null'],
          description: 'Server-populated; stripped on create.',
        },
        status: {
          type: ['string', 'null'],
          enum: ['warning', 'failure', 'success', 'running', null],
          description: 'Server-populated; stripped on create.',
        },
        lastExecutionDate: {
          type: ['integer', 'null'],
          description: 'Server-populated; stripped on create.',
        },
        lastCompletionDate: {
          type: ['integer', 'null'],
          description: 'Server-populated; stripped on create.',
        },
        detail: {
          type: ['string', 'null'],
          description: 'Server-populated; stripped on create.',
        },
        executionId: {
          type: ['string', 'null'],
          description: 'Server-populated; defaults to null.',
        },
      },
    },
    AttachmentReportScheduledTask: {
      allOf: [{ $ref: '#/$defs/ReportCommon' }],
      type: 'object',
      additionalProperties: false,
      description:
        'type=report, reportType=attachment_email. Emails the CSV as an attachment.',
      required: [
        'type',
        'name',
        'cron',
        'enabled',
        'reportType',
        'recipients',
        'from',
        'title',
        'isHtml',
        'hqlType',
      ],
      properties: {
        type: { const: 'report' },
        reportType: { const: 'attachment_email' },
        compressCsv: {
          type: 'boolean',
          default: false,
          description:
            'GZip the CSV. Defaults to false (added in 2.7.4, optional to preserve backward compatibility).',
        },
        name: true,
        cron: true,
        enabled: true,
        from: true,
        title: true,
        isHtml: true,
        recipients: true,
        cc: true,
        bcc: true,
        body: true,
        fileName: true,
        hqlType: true,
        hqlQuery: true,
        hqlFields: true,
        hqlSortedBy: true,
        headers: true,
        description: true,
        _id: true,
        host: true,
        status: true,
        lastExecutionDate: true,
        lastCompletionDate: true,
        detail: true,
        executionId: true,
      },
    },
    LinkReportScheduledTask: {
      allOf: [{ $ref: '#/$defs/ReportCommon' }],
      type: 'object',
      additionalProperties: false,
      description:
        'type=report, reportType=link_email. Emails a download link instead of attaching the CSV.',
      required: [
        'type',
        'name',
        'cron',
        'enabled',
        'reportType',
        'retentionPeriod',
        'recipients',
        'from',
        'title',
        'isHtml',
        'hqlType',
      ],
      properties: {
        type: { const: 'report' },
        reportType: { const: 'link_email' },
        retentionPeriod: {
          allOf: [{ $ref: '#/$defs/FiniteDuration' }],
          description:
            'How long the report stays downloadable. Required (no default) for link reports.',
        },
        name: true,
        cron: true,
        enabled: true,
        from: true,
        title: true,
        isHtml: true,
        recipients: true,
        cc: true,
        bcc: true,
        body: true,
        fileName: true,
        hqlType: true,
        hqlQuery: true,
        hqlFields: true,
        hqlSortedBy: true,
        headers: true,
        description: true,
        _id: true,
        host: true,
        status: true,
        lastExecutionDate: true,
        lastCompletionDate: true,
        detail: true,
        executionId: true,
      },
    },
  },
} as const;
