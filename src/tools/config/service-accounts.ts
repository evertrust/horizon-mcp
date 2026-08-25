/**
 * Service account configuration tools.
 *
 * This deliberately reverses the branch's read-only stance on service accounts
 * per explicit user instruction. The tools manage the 2.10 federated JWT trust
 * configuration, validation rules, permissions, and roles.
 *
 * Route: /api/v1/security/service-accounts. POST and PUT target the collection
 * with `name` in the body; DELETE targets /{name}.
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
  noun: 'service_account',
  nounPlural: 'service_accounts',
  label: 'service account',
  routeCollection: '/api/v1/security/service-accounts',
  routeItem: '/api/v1/security/service-accounts/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id'],
  stripFields: ['_id', 'tenant', 'readonly'],
  putOnCollection: true,
};

const nameSchema = z
  .string()
  .describe('Service-account name. Immutable primary key.');

const staticJwksSchema = z.object({
  type: z.literal('static_jwks'),
  jwks: z.string().describe('JWKS JSON document, serialized as a string.'),
});

const dynamicJwksSchema = z.object({
  type: z.literal('dynamic_jwks'),
  url: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value), {
      message: 'JWKS URL must use http or https.',
    })
    .describe('Absolute HTTP(S) URL from which Horizon fetches the JWKS.'),
  proxy: z
    .string()
    .optional()
    .describe('Name of an existing HTTP proxy configuration.'),
});

const trustConfigSchema = z
  .discriminatedUnion('type', [staticJwksSchema, dynamicJwksSchema])
  .describe(
    'JWT trust configuration, either an inline static JWKS or dynamic JWKS URL.',
  );

const permissionsSchema = z
  .array(
    z.object({
      value: z.string().describe('Horizon permission string.'),
      filter: z
        .string()
        .optional()
        .describe('Optional HPQL filter applied to this permission.'),
    }),
  )
  .describe('Permissions granted to principals authenticated by this account.');

const validationRulesSchema = z
  .array(z.string())
  .describe('Condition templates evaluated against incoming JWT claims.');

const rolesSchema = z
  .array(z.string())
  .describe('Existing roles granted to successfully authenticated principals.');

const durationSchema = z
  .string()
  .describe('Horizon duration string, for example "5 minutes".');

const CREATE_SERVICE_ACCOUNT_SCHEMA = z.object({
  name: nameSchema,
  trustConfig: trustConfigSchema,
  validationRules: validationRulesSchema,
  permissions: permissionsSchema,
  roles: rolesSchema,
  iatFutureRestriction: durationSchema.optional(),
  iatPastRestriction: durationSchema.optional(),
  jwtAllowedClockSkew: durationSchema.optional(),
  identifierMapping: z
    .string()
    .optional()
    .describe(
      'Template used to derive the authenticated principal identifier.',
    ),
});

const UPDATE_SERVICE_ACCOUNT_SCHEMA = z.object({
  name: nameSchema.describe('Service-account name to update (immutable key).'),
  trustConfig: trustConfigSchema.optional(),
  validationRules: validationRulesSchema.optional(),
  permissions: permissionsSchema.optional(),
  roles: rolesSchema.optional(),
  iatFutureRestriction: durationSchema.optional(),
  iatPastRestriction: durationSchema.optional(),
  jwtAllowedClockSkew: durationSchema.optional(),
  identifierMapping: z.string().optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe('Top-level optional fields to null explicitly.'),
});

type ServiceAccountFields = {
  readonly trustConfig?: z.infer<typeof trustConfigSchema>;
  readonly validationRules?: string[];
  readonly permissions?: z.infer<typeof permissionsSchema>;
  readonly roles?: string[];
  readonly iatFutureRestriction?: string;
  readonly iatPastRestriction?: string;
  readonly jwtAllowedClockSkew?: string;
  readonly identifierMapping?: string;
};

function buildServiceAccountBody({
  trustConfig,
  validationRules,
  permissions,
  roles,
  iatFutureRestriction,
  iatPastRestriction,
  jwtAllowedClockSkew,
  identifierMapping,
}: ServiceAccountFields): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (trustConfig !== undefined) body['trustConfig'] = trustConfig;
  if (validationRules !== undefined) body['validationRules'] = validationRules;
  if (permissions !== undefined) body['permissions'] = permissions;
  if (roles !== undefined) body['roles'] = roles;
  if (iatFutureRestriction !== undefined) {
    body['iatFutureRestriction'] = iatFutureRestriction;
  }
  if (iatPastRestriction !== undefined)
    body['iatPastRestriction'] = iatPastRestriction;
  if (jwtAllowedClockSkew !== undefined)
    body['jwtAllowedClockSkew'] = jwtAllowedClockSkew;
  if (identifierMapping !== undefined)
    body['identifierMapping'] = identifierMapping;
  return body;
}

function normalizeServiceAccountCurrent(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const trustConfig = current['trustConfig'];
  if (
    trustConfig === null ||
    typeof trustConfig !== 'object' ||
    Array.isArray(trustConfig)
  ) {
    return current;
  }
  const config = trustConfig as Record<string, unknown>;
  if (config['type'] !== 'static_jwks' || typeof config['jwks'] !== 'object') {
    return current;
  }
  return {
    ...current,
    trustConfig: { ...config, jwks: JSON.stringify(config['jwks']) },
  };
}

export function registerServiceAccountTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List service accounts. Requires audit access; manage access is required ' +
      'to change accounts (`access-management:service-account:*`).',
    getDescription:
      'Get a single service account by name, including its JWT trust configuration. ' +
      'Requires audit access; manage access is required for mutations.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a service account for federated JWT authentication. Requires manage ' +
      'access (`access-management:service-account:*`). Grant only explicit roles ' +
      'and permissions, never broad permissions inferred by the model.',
    mandatoryFields: [
      'name',
      'trustConfig',
      'validationRules',
      'permissions',
      'roles',
    ],
    inputSchema: CREATE_SERVICE_ACCOUNT_SCHEMA,
    buildPayload: (args) => ({
      name: args.name,
      ...buildServiceAccountBody(args),
    }),
  });

  registerUpdateTool(server, client, SPEC, {
    description:
      'Update a service account. Requires manage access ' +
      '(`access-management:service-account:*`). GET static JWKS objects are ' +
      'serialized before the merged PUT because the API expects a JSON string.',
    inputSchema: UPDATE_SERVICE_ACCOUNT_SCHEMA,
    buildOverrides: (args) => buildServiceAccountBody(args),
    normalizeCurrent: normalizeServiceAccountCurrent,
  });

  registerDeleteTool(server, client, SPEC, {
    description:
      'Delete a service account. Requires manage access ' +
      '(`access-management:service-account:*`).',
    deleteConstraints:
      'Configuration-defined accounts are read-only and cannot be deleted (SERV-ACC-005).',
  });
}
