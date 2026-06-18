/**
 * PKI queue configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * Contract: docs/audit/pki_queues.contract.json (+ pki_queues.schema.json),
 * traced to PKIQueueApiV1Controller / PKIQueue.scala / PKIQueueService.scala.
 *
 * Route: /api/v1/pki/queues. Update PUTs the COLLECTION root (body-keyed
 * full-replace; the target queue is looked up by `name` inside the body); the
 * wrapper does GET-merge so omitted fields are preserved. stripFields are the
 * audited server-derived fields (_id, tenant).
 *
 * Object-specific rule: clusterWide is an optional create param defaulting to
 * false (matching Scala) and is ALWAYS sent explicitly on create, so it is not
 * listed as a mandatory field the model must ask the user about.
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
  noun: 'pki_queue',
  nounPlural: 'pki_queues',
  label: 'PKI queue',
  routeCollection: '/api/v1/pki/queues',
  routeItem: '/api/v1/pki/queues/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

const descriptionSchema = z
  .string()
  .describe('Optional human-readable description.');
const throttleDurationSchema = z
  .string()
  .describe(
    'Optional throttle window as a Scala FiniteDuration string, e.g. "5 seconds". ' +
      'If set, throttle_parallelism must also be set and the duration must be > 0.',
  );
const throttleParallelismSchema = z
  .number()
  .int()
  .describe(
    'Optional max parallelism within the throttle window. If set, must be > 0.',
  );

function buildPkiQueueBody(args: {
  name?: string;
  size?: number;
  cluster_wide?: boolean;
  description?: string;
  throttle_duration?: string;
  throttle_parallelism?: number;
}): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (args.name !== undefined) o['name'] = args.name;
  if (args.size !== undefined) o['size'] = args.size;
  if (args.cluster_wide !== undefined) o['clusterWide'] = args.cluster_wide;
  if (args.description !== undefined) o['description'] = args.description;
  if (args.throttle_duration !== undefined)
    o['throttleDuration'] = args.throttle_duration;
  if (args.throttle_parallelism !== undefined)
    o['throttleParallelism'] = args.throttle_parallelism;
  return o;
}

export function registerPkiQueueTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: 'List PKI queue configurations.',
    getDescription: 'Get a single PKI queue configuration by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a PKI queue used to throttle and bound concurrent PKI connector ' +
      'operations.',
    mandatoryFields: ['name', 'size'],
    inputSchema: z.object({
      name: z
        .string()
        .describe(
          'PKI queue name. Immutable primary key, must not already exist.',
        ),
      size: z.number().int().describe('Queue size. Mandatory, must be > 0.'),
      cluster_wide: z
        .boolean()
        .default(false)
        .describe(
          'Optional: whether the queue is shared cluster-wide. Defaults to ' +
            'false (matching Horizon) and is always sent on create, so you ' +
            'need not ask the user unless they want it cluster-wide.',
        ),
      description: descriptionSchema.optional(),
      throttle_duration: throttleDurationSchema.optional(),
      throttle_parallelism: throttleParallelismSchema.optional(),
    }),
    buildPayload: (args) => buildPkiQueueBody(args),
  });

  registerUpdateTool(server, client, SPEC, {
    description: 'Update an existing PKI queue configuration.',
    inputSchema: z.object({
      name: z.string().describe('PKI queue name to update (immutable key).'),
      size: z.number().int().optional(),
      cluster_wide: z.boolean().optional(),
      description: descriptionSchema.optional(),
      throttle_duration: throttleDurationSchema.optional(),
      throttle_parallelism: throttleParallelismSchema.optional(),
      clear_fields: z
        .array(z.string())
        .optional()
        .describe(
          'Top-level fields to explicitly null, e.g. ["description","throttleDuration"].',
        ),
    }),
    buildOverrides: (args) => {
      const { name: _name, ...rest } = args;
      return buildPkiQueueBody(rest);
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a PKI queue configuration.',
    deleteConstraints:
      'Cannot be deleted while referenced by a PKI connector (PKI-QUEUE-005).',
  });
}
