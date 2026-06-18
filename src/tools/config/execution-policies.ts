/**
 * Execution policy configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * Contract: docs/audit/execution_policies.contract.json (+
 * execution_policies.schema.json), traced to ExecutionPolicy.scala /
 * ExecutionPeriod.scala / DateRange.scala / TimeRange.scala.
 *
 * Route: /api/v1/automation/executions. Update PUTs the COLLECTION root
 * (body-keyed full-replace via Mongo replaceOne; target selected by `name` in
 * the body, NOT a path param); the wrapper does GET-merge so omitted fields are
 * preserved. `_id` is response-only and stripped before PUT.
 *
 * Period inputs are snake_case (authorized_periods / forbidden_periods, each
 * with date_range / weeks / week_days / time_range) and are mapped to the exact
 * camelCase API keys (authorizedPeriods / forbiddenPeriods / dateRange /
 * weeks / weekDays / timeRange). dateRange and timeRange are {start, end}
 * objects (authoritative Scala Json.format[TimeRange] object form, not the
 * OpenAPI single-string shape).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  type ConfigSpec,
  registerCreateTool,
  registerDeleteTool,
  registerReadTools,
  registerUpdateTool,
} from './_scaffold.js';

const SPEC: ConfigSpec = {
  noun: 'execution_policy',
  nounPlural: 'execution_policies',
  label: 'execution policy',
  routeCollection: '/api/v1/automation/executions',
  routeItem: '/api/v1/automation/executions/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id'],
  putOnCollection: true,
};

const WEEK_DAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

const dateRangeSchema = z
  .object({
    start: z
      .string()
      .describe('ISO-8601 calendar date (YYYY-MM-DD). Must be <= end.'),
    end: z
      .string()
      .describe('ISO-8601 calendar date (YYYY-MM-DD). Must be >= start.'),
  })
  .describe('Absolute calendar date window.');

const timeRangeSchema = z
  .object({
    start: z
      .string()
      .describe('ISO-8601 local time (HH:MM:SS). Must be <= end.'),
    end: z
      .string()
      .describe('ISO-8601 local time (HH:MM:SS). Must be >= start.'),
  })
  .describe('Intra-day time window.');

const executionPeriodSchema = z
  .object({
    date_range: dateRangeSchema.optional(),
    weeks: z
      .array(z.number().int())
      .optional()
      .describe('Aligned week-of-year numbers. De-duplicated server-side.'),
    week_days: z
      .array(z.enum(WEEK_DAYS))
      .optional()
      .describe(
        'Week days (exact uppercase names). De-duplicated server-side.',
      ),
    time_range: timeRangeSchema.optional(),
  })
  .describe(
    'A time window. All present constraints must match (AND); omitted fields are unconstrained.',
  );

const authorizedPeriodsSchema = z
  .array(executionPeriodSchema)
  .describe('Periods during which automation execution is permitted.');
const forbiddenPeriodsSchema = z
  .array(executionPeriodSchema)
  .describe('Periods during which automation execution is blocked.');
const descriptionSchema = z.string().describe('Free-text description.');

type DateRangeInput = z.infer<typeof dateRangeSchema>;
type TimeRangeInput = z.infer<typeof timeRangeSchema>;
type PeriodInput = z.infer<typeof executionPeriodSchema>;

/** Map a snake_case period input to the camelCase API ExecutionPeriod shape. */
function buildPeriod(p: PeriodInput): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (p.date_range !== undefined)
    o['dateRange'] = p.date_range as DateRangeInput;
  if (p.weeks !== undefined) o['weeks'] = p.weeks;
  if (p.week_days !== undefined) o['weekDays'] = p.week_days;
  if (p.time_range !== undefined)
    o['timeRange'] = p.time_range as TimeRangeInput;
  return o;
}

function buildExecutionPolicyBody(args: {
  name?: string;
  description?: string;
  authorized_periods?: PeriodInput[];
  forbidden_periods?: PeriodInput[];
}): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (args.name !== undefined) o['name'] = args.name;
  if (args.description !== undefined) o['description'] = args.description;
  if (args.authorized_periods !== undefined)
    o['authorizedPeriods'] = args.authorized_periods.map(buildPeriod);
  if (args.forbidden_periods !== undefined)
    o['forbiddenPeriods'] = args.forbidden_periods.map(buildPeriod);
  return o;
}

export function registerExecutionPolicyTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: 'List execution policy configurations.',
    getDescription: 'Get a single execution policy configuration by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create an execution policy (time-window constraints that gate when ' +
      'automation policies are allowed to run).',
    mandatoryFields: ['name'],
    inputSchema: z.object({
      name: z
        .string()
        .describe(
          'Execution policy name. Immutable primary key, regex [0-9a-zA-Z-_.]+.',
        ),
      description: descriptionSchema.optional(),
      authorized_periods: authorizedPeriodsSchema.optional(),
      forbidden_periods: forbiddenPeriodsSchema.optional(),
    }),
    buildPayload: (args) => buildExecutionPolicyBody(args),
  });

  registerUpdateTool(server, client, SPEC, {
    description: 'Update an existing execution policy configuration.',
    inputSchema: z.object({
      name: z
        .string()
        .describe('Execution policy name to update (immutable key).'),
      description: descriptionSchema.optional(),
      authorized_periods: authorizedPeriodsSchema.optional(),
      forbidden_periods: forbiddenPeriodsSchema.optional(),
      clear_fields: z
        .array(z.string())
        .optional()
        .describe(
          'Top-level fields to explicitly null, e.g. ["description","authorizedPeriods"].',
        ),
    }),
    buildOverrides: (args) => {
      const { name: _name, ...rest } = args;
      return buildExecutionPolicyBody(rest);
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete an execution policy configuration.',
    deleteConstraints:
      'Cannot be deleted while referenced by any automation policy ' +
      '(ExecutionPolicy005).',
  });
}
