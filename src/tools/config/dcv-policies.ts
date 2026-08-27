/**
 * DCV (Domain Control Validation) policy configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * New in Horizon 2.10. A DCV policy binds a DCV provider + provisioner and
 * drives automated domain-control-validation renewal on a cron schedule.
 *
 * Source: models/dcv/DCVPolicy.scala (+ DCVPolicyApiV1Controller.scala). Format
 * is Jsonx.formatCaseClassUseDefaults[DCVPolicy].ignoreFields("_id","tenant").
 * Required: name, provider, provisioner, executionTimeout, retryDelay, enabled
 * (executionTimeout/retryDelay must be > 0). Optional: filter (regex),
 * renewalPolicy {cron, renewalPeriod}, triggers.
 *
 * Route: /api/v1/dcv/policies. Update PUTs the COLLECTION root (body-keyed
 * full-replace); the wrapper does GET-merge so omitted fields are preserved.
 * provider and provisioner must reference existing DCV provider/provisioner
 * configurations (server-validated, InvalidReferenceException otherwise).
 */
import type { McpServer } from '@modelcontextprotocol/server';
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
  noun: 'dcv_policy',
  nounPlural: 'dcv_policies',
  label: 'DCV policy',
  routeCollection: '/api/v1/dcv/policies',
  routeItem: '/api/v1/dcv/policies/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

const durationSchema = (what: string) =>
  z
    .string()
    .describe(
      `${what} as a duration string, e.g. "30 seconds", "1 hour", "7 days".`,
    );

const renewalPolicySchema = z
  .object({
    cron: z
      .string()
      .describe('Quartz cron expression, e.g. "0 0 0 1 1 ? 2099".'),
    renewalPeriod: durationSchema('Renewal window before DCV expiry'),
  })
  .describe(
    'Renewal schedule. Without a renewalPolicy the policy performs no DCV ' +
      'automation (it selects no domains for renewal).',
  );

const triggersSchema = z
  .object({
    onDcvPolicyStart: z.array(z.string()).optional(),
    onDcvPolicyEnd: z.array(z.string()).optional(),
    onDcvValidationSuccess: z.array(z.string()).optional(),
    onDcvValidationFailure: z.array(z.string()).optional(),
    onDcvValidationRetry: z.array(z.string()).optional(),
  })
  .describe(
    'Optional trigger bindings: arrays of existing trigger names fired on each ' +
      'DCV lifecycle event (policy start/end, validation success/failure/retry).',
  );

const providerSchema = z
  .string()
  .describe(
    'Name of an existing DCV provider configuration (server-validated; must pre-exist).',
  );
const provisionerSchema = z
  .string()
  .describe(
    'Name of an existing DCV provisioner configuration (server-validated; must pre-exist).',
  );

const CREATE_DCV_POLICIES_SCHEMA = z.object({
  name: z
    .string()
    .describe('Policy name. Immutable primary key (the update lookup key).'),
  provider: providerSchema,
  provisioner: provisionerSchema,
  executionTimeout: durationSchema('Max run duration per execution (> 0)'),
  retryDelay: durationSchema('Delay between retries (> 0)'),
  enabled: z.boolean().describe('Whether the policy is enabled.'),
  filter: z
    .string()
    .optional()
    .describe('Optional regex; only domains matching it are processed.'),
  renewalPolicy: renewalPolicySchema.optional(),
  triggers: triggersSchema.optional(),
});

const UPDATE_DCV_POLICIES_SCHEMA = z.object({
  name: z.string().describe('Policy name to update (immutable key).'),
  provider: providerSchema.optional(),
  provisioner: provisionerSchema.optional(),
  executionTimeout: durationSchema('Max run duration (> 0)').optional(),
  retryDelay: durationSchema('Delay between retries (> 0)').optional(),
  enabled: z.boolean().optional().describe('Whether the policy is enabled.'),
  filter: z.string().optional().describe('Optional domain-matching regex.'),
  renewalPolicy: renewalPolicySchema.optional(),
  triggers: triggersSchema.optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe(
      'Top-level fields to explicitly null, e.g. ["filter","renewalPolicy","triggers"].',
    ),
});

export function registerDcvPolicyTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List DCV (Domain Control Validation) policies. A DCV policy binds a DCV ' +
      'provider and provisioner and automates domain-control-validation renewal.',
    getDescription: 'Get a single DCV policy by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a DCV (Domain Control Validation) policy that automates DCV ' +
      'renewal using a DCV provider + provisioner. provider and provisioner ' +
      'must reference existing DCV provider/provisioner configurations.',
    mandatoryFields: [
      'name',
      'provider',
      'provisioner',
      'executionTimeout',
      'retryDelay',
      'enabled',
    ],
    inputSchema: CREATE_DCV_POLICIES_SCHEMA,
    buildPayload: (args) => {
      const body: Record<string, unknown> = {
        name: args.name,
        provider: args.provider,
        provisioner: args.provisioner,
        executionTimeout: args.executionTimeout,
        retryDelay: args.retryDelay,
        enabled: args.enabled,
      };
      if (args.filter !== undefined) body['filter'] = args.filter;
      if (args.renewalPolicy !== undefined)
        body['renewalPolicy'] = args.renewalPolicy;
      if (args.triggers !== undefined) body['triggers'] = args.triggers;
      return body;
    },
  });

  registerUpdateTool(server, client, SPEC, {
    description: 'Update an existing DCV policy.',
    inputSchema: UPDATE_DCV_POLICIES_SCHEMA,
    buildOverrides: (args) => {
      const o: Record<string, unknown> = {};
      if (args.provider !== undefined) o['provider'] = args.provider;
      if (args.provisioner !== undefined) o['provisioner'] = args.provisioner;
      if (args.executionTimeout !== undefined)
        o['executionTimeout'] = args.executionTimeout;
      if (args.retryDelay !== undefined) o['retryDelay'] = args.retryDelay;
      if (args.enabled !== undefined) o['enabled'] = args.enabled;
      if (args.filter !== undefined) o['filter'] = args.filter;
      if (args.renewalPolicy !== undefined)
        o['renewalPolicy'] = args.renewalPolicy;
      if (args.triggers !== undefined) o['triggers'] = args.triggers;
      return o;
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a DCV policy.',
    deleteConstraints: 'DELETE /api/v1/dcv/policies/{name}.',
  });
}
