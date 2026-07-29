/**
 * Scheduled Task configuration tools (polymorphic / "complex").
 *
 * 6 tools: list / get / create / update / delete + describe_scheduled_task_schema.
 * Contract: docs/audit/scheduled_tasks.contract.json (+ scheduled_tasks.schema.json),
 * traced to ScheduledTaskApiV1Controller.scala / ScheduledTask.scala /
 * ThirdPartyScheduledTask.scala / Report.scala.
 *
 * Polymorphic: a oneOf over three subtypes discriminated first by `type`
 * (thirdparty | report) and, for reports, by `reportType`
 * (attachment_email | link_email). Because the editable shape diverges by
 * subtype, create/update take the common typed mandatory params (type, name,
 * cron, enabled) + the second-level discriminator (report_type) + a validated
 * `config` body. The body is merged, checked with assertConfigBody against the
 * resolved subtype's required/known keys, then POSTed/PUT.
 *
 * Route: /api/v1/scheduler/tasks. Update PUTs the COLLECTION root (body-keyed
 * full-replace; the body `name` is the lookup key). The wrapper does
 * GET-strip-merge so omitted fields are preserved. stripFields =
 * [_id, tenant, host, status, lastExecutionDate, lastCompletionDate, detail,
 * executionId] (audited).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  type ConfigSpec,
  assertConfigBody,
  registerCreateTool,
  registerDeleteTool,
  registerDescribeSchemaTool,
  registerReadTools,
  registerUpdateTool,
} from './_scaffold.js';
import { scheduledTaskRequestSchema } from './schemas/scheduled-tasks.schema.js';

const SPEC: ConfigSpec = {
  noun: 'scheduled_task',
  nounPlural: 'scheduled_tasks',
  label: 'Scheduled Task',
  routeCollection: '/api/v1/scheduler/tasks',
  routeItem: '/api/v1/scheduler/tasks/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id', 'type', 'reportType'],
  stripFields: [
    '_id',
    'tenant',
    'host',
    'status',
    'lastExecutionDate',
    'lastCompletionDate',
    'detail',
    'executionId',
  ],
  putOnCollection: true,
};

const TASK_TYPES = ['thirdparty', 'report'] as const;
const REPORT_TYPES = ['attachment_email', 'link_email'] as const;

const SCHEMA_VERSION = '2026-06-04';
const SUBTYPES = [
  'ThirdPartyScheduledTask',
  'AttachmentReportScheduledTask',
  'LinkReportScheduledTask',
] as const;

// Per-subtype required keys (from the resolved schema `required` arrays).
const REQUIRED_THIRDPARTY = [
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
] as const;
const REQUIRED_ATTACHMENT_REPORT = [
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
] as const;
const REQUIRED_LINK_REPORT = [
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
] as const;

// Per-subtype known top-level keys (from the resolved schema `properties`).
const KNOWN_THIRDPARTY = [
  ...REQUIRED_THIRDPARTY,
  'description',
  '_id',
  'host',
  'status',
  'lastExecutionDate',
  'lastCompletionDate',
  'detail',
  'executionId',
] as const;
const KNOWN_REPORT_COMMON = [
  'type',
  'name',
  'cron',
  'enabled',
  'reportType',
  'from',
  'title',
  'isHtml',
  'recipients',
  'cc',
  'bcc',
  'body',
  'fileName',
  'hqlType',
  'hqlQuery',
  'hqlFields',
  'hqlSortedBy',
  'headers',
  'description',
  '_id',
  'host',
  'status',
  'lastExecutionDate',
  'lastCompletionDate',
  'detail',
  'executionId',
] as const;
const KNOWN_ATTACHMENT_REPORT = [
  ...KNOWN_REPORT_COMMON,
  'compressCsv',
] as const;
const KNOWN_LINK_REPORT = [...KNOWN_REPORT_COMMON, 'retentionPeriod'] as const;

const ENUMS: Record<string, readonly string[]> = {
  type: TASK_TYPES,
  reportType: REPORT_TYPES,
  hqlType: ['hcql', 'hpql', 'hrql', 'heql', 'hdql'],
  status: ['warning', 'failure', 'success', 'running'],
};

/**
 * Merge typed mandatory params + caller config into one body, then validate it
 * against the resolved subtype's required/known keys. Throws HorizonError(422)
 * on a missing mandatory field, an unknown top-level field, or a bad enum so
 * the model can self-correct before the network call.
 */
function buildScheduledTaskBody(args: {
  type: (typeof TASK_TYPES)[number];
  name: string;
  cron: string;
  enabled: boolean;
  report_type?: (typeof REPORT_TYPES)[number];
  config?: Record<string, unknown>;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...(args.config ?? {}),
    type: args.type,
    name: args.name,
    cron: args.cron,
    enabled: args.enabled,
  };
  if (args.report_type !== undefined) body['reportType'] = args.report_type;

  if (args.type === 'thirdparty') {
    assertConfigBody(body, {
      requiredKeys: REQUIRED_THIRDPARTY,
      knownKeys: KNOWN_THIRDPARTY,
      enums: ENUMS,
    });
  } else {
    // report: pick the concrete subtype by reportType.
    const reportType = body['reportType'];
    if (reportType === 'link_email') {
      assertConfigBody(body, {
        requiredKeys: REQUIRED_LINK_REPORT,
        knownKeys: KNOWN_LINK_REPORT,
        enums: ENUMS,
      });
    } else {
      // attachment_email (or a missing reportType: surfaced as a missing
      // mandatory by REQUIRED_ATTACHMENT_REPORT, which includes reportType).
      assertConfigBody(body, {
        requiredKeys: REQUIRED_ATTACHMENT_REPORT,
        knownKeys: KNOWN_ATTACHMENT_REPORT,
        enums: ENUMS,
      });
    }
  }
  return body;
}

const typeSchema = z
  .enum(TASK_TYPES)
  .describe(
    'Top-level discriminator. "thirdparty" drives connector enroll/revoke/renew ' +
      'runs; "report" emails a scheduled HQL report.',
  );
const nameSchema = z
  .string()
  .describe('Task name. Immutable primary key (the update lookup key).');
const cronSchema = z
  .string()
  .describe('Quartz cron expression, validated server-side.');
const enabledSchema = z.boolean().describe('Whether the task is enabled.');
const reportTypeSchema = z
  .enum(REPORT_TYPES)
  .describe(
    'Second-level discriminator. REQUIRED when type="report": ' +
      '"attachment_email" attaches the CSV, "link_email" emails a download link.',
  );
const configSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Subtype-specific fields, camelCase API keys (not snake_case). Call ' +
      'describe_scheduled_task_schema FIRST to see the exact required/optional ' +
      'fields for the chosen type/reportType. thirdparty: dryRun, module, ' +
      'profile, connector, enroll, revoke, renew. report: recipients, from, ' +
      'title, isHtml, hqlType (+ optional hqlQuery, hqlFields, hqlSortedBy, cc, ' +
      'bcc, body, fileName, headers, compressCsv | retentionPeriod). Do NOT ' +
      'include type/name/cron/enabled/reportType here - pass those as their own ' +
      'parameters.',
  );

const CREATE_SCHEDULED_TASKS_SCHEMA = z.object({
  type: typeSchema,
  name: nameSchema,
  cron: cronSchema,
  enabled: enabledSchema,
  report_type: reportTypeSchema.optional(),
  config: configSchema.optional(),
});

const UPDATE_SCHEDULED_TASKS_SCHEMA = z.object({
  type: typeSchema,
  name: z.string().describe('Task name to update (immutable lookup key).'),
  cron: cronSchema,
  enabled: enabledSchema,
  report_type: reportTypeSchema.optional(),
  config: configSchema.optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe(
      'Top-level fields to explicitly null, e.g. ["hqlQuery","description"].',
    ),
});

export function registerScheduledTaskTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerDescribeSchemaTool(server, {
    noun: SPEC.noun,
    label: SPEC.label,
    discriminatorField: 'type',
    subtypes: SUBTYPES,
    mandatoryFields: ['type', 'name', 'cron', 'enabled'],
    jsonSchema: scheduledTaskRequestSchema,
    schemaVersion: SCHEMA_VERSION,
  });

  registerReadTools(server, client, SPEC, {
    listDescription: 'List scheduled tasks.',
    getDescription: 'Get a single scheduled task by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a scheduled task (third-party connector run or a scheduled HQL ' +
      'email report). Polymorphic: call describe_scheduled_task_schema first to ' +
      'learn the required `config` fields for the chosen type/reportType.',
    mandatoryFields: ['type', 'name', 'cron', 'enabled'],
    inputSchema: CREATE_SCHEDULED_TASKS_SCHEMA,
    buildPayload: (args) => buildScheduledTaskBody(args),
  });

  registerUpdateTool(server, client, SPEC, {
    description:
      'Update an existing scheduled task. The submitted subtype must match the ' +
      'stored one (cannot convert thirdparty<->report or attachment<->link).',
    inputSchema: UPDATE_SCHEDULED_TASKS_SCHEMA,
    buildOverrides: (args) =>
      buildScheduledTaskBody({
        type: args.type,
        name: args.name,
        cron: args.cron,
        enabled: args.enabled,
        report_type: args.report_type,
        config: args.config,
      }),
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a scheduled task.',
    deleteConstraints:
      'DELETE /api/v1/scheduler/tasks/{name}; 404 (SchedTask003) if not found. ' +
      'Requires MANAGE permission on the task. No dependents block deletion.',
  });
}
