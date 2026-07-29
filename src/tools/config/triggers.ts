/**
 * Trigger CRUD gap-fill (polymorphic create/update + describe-schema).
 *
 * 3 tools: describe_trigger_schema / create_trigger / update_trigger.
 * The legacy src/tools/triggers.ts already provides list_triggers, get_trigger,
 * delete_trigger, simulate_trigger, and the create_rest_notification
 * convenience tool - this module adds the GENERIC create + update that were
 * missing, covering all 11 trigger subtypes.
 *
 * Contract: docs/audit/triggers.contract.json (+ triggers.schema.json), traced
 * to Trigger.scala / TriggerService.scala / TriggerType.scala. Polymorphic union
 * discriminated by the lowercase `type` field. Route /api/v1/triggers; update
 * PUTs the COLLECTION root (body-keyed full-replace); the wrapper does GET-merge
 * so omitted fields are preserved. name is immutable; strip [_id, tenant].
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  type ConfigSpec,
  assertConfigBody,
  registerCreateTool,
  registerDescribeSchemaTool,
  registerUpdateTool,
} from './_scaffold.js';
import { triggerRequestSchema } from './schemas/triggers.schema.js';

const SPEC: ConfigSpec = {
  noun: 'trigger',
  nounPlural: 'triggers',
  label: 'trigger',
  routeCollection: '/api/v1/triggers',
  routeItem: '/api/v1/triggers/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

/** Discriminator literals (lowercase) - one per trigger subtype. */
const TRIGGER_TYPES = [
  'email',
  'webhook',
  'rest',
  'akv',
  'f5client',
  'f5as3',
  'aws',
  'intunepkcs',
  'gcm',
  'ldappub',
  'netscaler',
] as const;

/** Union of every subtype's top-level property keys (from the resolved schema). */
const KNOWN_KEYS = [
  'attachDerCertificate',
  'attachPemBundle',
  'attachPemCertificate',
  'attachPkcs12',
  'attachPkcs7',
  'attachPkcs7Bundle',
  'connector',
  'emailTemplate',
  'events',
  'ifPkcs12',
  'licenceUsagePercent',
  'name',
  'proxy',
  'retries',
  'runOnRenewed',
  'runPeriod',
  'sequence',
  'timeout',
  'triggers',
  'type',
  'webhookTemplate',
] as const;

const nameSchema = z
  .string()
  .describe(
    'Trigger name. Immutable primary key, unique. Ask the user - never invent it.',
  );
const typeSchema = z
  .enum(TRIGGER_TYPES)
  .describe(
    'Trigger subtype discriminator (lowercase). Determines required `config` ' +
      'fields (e.g. emailTemplate for email, webhookTemplate for webhook, ' +
      'sequence for rest, connector for third-party subtypes). Immutable.',
  );
const configSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Subtype-specific fields as a flat object using the EXACT camelCase keys ' +
      'from describe_trigger_schema for the chosen `type` (e.g. {events, ' +
      'emailTemplate} for email; {connector} for third-party). Do NOT include ' +
      'name/type here. Call describe_trigger_schema first - never guess the keys.',
  );

function mergeBody(
  name: string,
  type: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...config, name, type };
  assertConfigBody(body, {
    requiredKeys: ['name', 'type'],
    knownKeys: KNOWN_KEYS,
    enums: { type: TRIGGER_TYPES },
  });
  return body;
}

export function registerTriggerCrudTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerDescribeSchemaTool(server, {
    noun: 'trigger',
    label: 'trigger',
    discriminatorField: 'type',
    subtypes: TRIGGER_TYPES,
    mandatoryFields: ['name', 'type'],
    jsonSchema: triggerRequestSchema,
    schemaVersion: 'triggers.request.json',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a trigger: an EVENT-DRIVEN action that fires ON certificate ' +
      'lifecycle events (email, webhook, rest, akv, f5client, f5as3, aws, ' +
      'intunepkcs, gcm, ldappub, netscaler). A vendor-typed trigger is the event ' +
      'HOOK - distinct from a third-party connector of the same vendor (the ' +
      'standing publish integration, create_thirdparty_connector). For a simple ' +
      'REST ' +
      'notification you may prefer create_rest_notification. Call ' +
      'describe_trigger_schema for the chosen type first - never guess the ' +
      '`config` fields.',
    mandatoryFields: ['name', 'type'],
    inputSchema: z.object({
      name: nameSchema,
      type: typeSchema,
      config: configSchema.optional(),
    }),
    nextSteps:
      'A trigger runs only when bound to a certificate profile for specific ' +
      'lifecycle events. Ask the user which certificate profile(s) and which ' +
      'events (enroll, revoke, renew), then add this trigger name to each ' +
      'profile via update_certificate_profile ' +
      '(config.triggers.onEnroll / onRevoke / onRenew). A publishing trigger ' +
      '(type aws/akv/f5.../ldappub/...) must also set config.connector to an ' +
      'existing third-party connector. Do not infer - ask the user.',
    buildPayload: ({ name, type, config }) =>
      mergeBody(name, type, config ?? {}),
  });

  registerUpdateTool(server, client, SPEC, {
    description:
      'Update an existing trigger. The subtype (type) cannot change. ' +
      'Full-replace: pass the complete `config` for the subtype (call ' +
      'describe_trigger_schema).',
    inputSchema: z.object({
      name: nameSchema,
      type: typeSchema,
      config: configSchema.optional(),
      clear_fields: z
        .array(z.string())
        .optional()
        .describe('Top-level fields to explicitly null, e.g. ["proxy"].'),
    }),
    buildOverrides: ({ name, type, config }) =>
      mergeBody(name, type, config ?? {}),
  });
}
