/** ACME External Account Binding policy tools (Horizon 2.11+). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { VALIDATION_METHODS } from '../acme/common.js';
import {
  type ConfigSpec,
  registerCreateTool,
  registerDeleteTool,
  registerReadTools,
  registerUpdateTool,
} from './_scaffold.js';

const VERSION_NOTE = 'Horizon 2.11+.';

const SPEC: ConfigSpec = {
  noun: 'eab_policy',
  nounPlural: 'eab_policies',
  label: 'EAB policy',
  routeCollection: '/api/v1/acme/eab-policies',
  routeItem: '/api/v1/acme/eab-policies/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id'],
  putOnCollection: true,
  listRequest: { path: '/api/v1/acme/eab-policies/list', body: {} },
};

const constraintShape = {
  identifier_constraint: z
    .string()
    .optional()
    .describe('Regular expression that every order identifier must match.'),
  allowed_profiles: z
    .array(z.string())
    .optional()
    .describe('ACME profiles that bound accounts may use.'),
  validation_methods: z
    .array(z.enum(VALIDATION_METHODS))
    .optional()
    .describe('Allowed challenge types.'),
  email_constraint: z
    .string()
    .optional()
    .describe(
      'Regular expression that every account contact email must match.',
    ),
};

const CLEARABLE_FIELDS = [
  'identifierConstraint',
  'allowedProfiles',
  'validationMethods',
  'emailConstraint',
] as const;
const LIST_FIELDS: readonly string[] = ['allowedProfiles', 'validationMethods'];

type ConstraintArgs = {
  identifier_constraint?: string;
  allowed_profiles?: string[];
  validation_methods?: string[];
  email_constraint?: string;
};

function constraintFields(args: ConstraintArgs): Record<string, unknown> {
  return {
    ...(args.identifier_constraint !== undefined && {
      identifierConstraint: args.identifier_constraint,
    }),
    ...(args.allowed_profiles !== undefined && {
      allowedProfiles: args.allowed_profiles,
    }),
    ...(args.validation_methods !== undefined && {
      validationMethods: args.validation_methods,
    }),
    ...(args.email_constraint !== undefined && {
      emailConstraint: args.email_constraint,
    }),
  };
}

function emptiedLists(cleared: readonly string[] = []): Record<string, []> {
  return Object.fromEntries(
    cleared
      .filter((field) => LIST_FIELDS.includes(field))
      .map((field) => [field, []]),
  );
}

const CREATE_EAB_POLICY_OPTS = {
  description:
    `${VERSION_NOTE} Create an ACME EAB policy: shared constraints for the ` +
    'EABs that reference it. A request must satisfy both the policy and the EAB constraints.',
  mandatoryFields: ['name'],
  inputSchema: z.object({
    name: z
      .string()
      .min(1)
      .describe(
        'EAB policy name. Unique identifier; it cannot change after creation.',
      ),
    ...constraintShape,
  }),
  buildPayload: ({ name, ...rest }) => ({ name, ...constraintFields(rest) }),
} satisfies Parameters<typeof registerCreateTool>[3];

const UPDATE_EAB_POLICY_OPTS = {
  description:
    `${VERSION_NOTE} Update an ACME EAB policy. A change applies at once to ` +
    'every EAB that references the policy.',
  inputSchema: z.object({
    name: z
      .string()
      .min(1)
      .describe('EAB policy name to update (immutable key).'),
    ...constraintShape,
    clear_fields: z
      .array(z.enum(CLEARABLE_FIELDS))
      .optional()
      .describe(
        'Constraints to remove. A text constraint is left out and a list becomes empty. An empty constraint imposes no restriction at policy level.',
      ),
  }),
  buildOverrides: (args: ConstraintArgs & { clear_fields?: string[] }) => ({
    ...emptiedLists(args.clear_fields),
    ...constraintFields(args),
  }),
  omitClearedFields: true,
} satisfies Parameters<typeof registerUpdateTool>[3];

export function registerEabPolicyTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: `${VERSION_NOTE} List ACME EAB policies.`,
    getDescription: `${VERSION_NOTE} Get a single ACME EAB policy by name.`,
  });
  registerCreateTool(server, client, SPEC, CREATE_EAB_POLICY_OPTS);
  registerUpdateTool(server, client, SPEC, UPDATE_EAB_POLICY_OPTS);
  registerDeleteTool(server, client, SPEC, {
    description: `${VERSION_NOTE} Delete an ACME EAB policy.`,
    deleteConstraints:
      'Cannot be deleted while at least one EAB references it (EAB-POLICY-002).',
  });
}
