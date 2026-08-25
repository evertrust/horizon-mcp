/**
 * DCV (Domain Control Validation) provider configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * New in Horizon 2.10. A DCV provider is the CA-side integration that issues and
 * tracks DCV challenges. The configuration is discriminated by `type`; Horizon
 * 2.10 ships "digicert" and "gs_mssl" provider types. The schemas are
 * discriminated by type because GlobalSign MSSL requires additional fields.
 *
 * Source: models/dcv/DCVProviderConfig.scala + DCVProviderType.scala +
 * implementation/{digicert,globalsign}/*DCVProviderConfig.scala. Format ignores
 * "_id"/"tenant". gs_mssl additionally requires profile, defaultEmail, and
 * defaultPhone. timeout is mandatory for both types; proxy is optional.
 *
 * Route: /api/v1/dcv/providers. Update PUTs the COLLECTION root (body-keyed
 * full-replace); the wrapper does GET-merge so omitted fields are preserved.
 * Cannot be deleted while referenced by a DCV policy (InvalidReferenceException).
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
  noun: 'dcv_provider',
  nounPlural: 'dcv_providers',
  label: 'DCV provider',
  routeCollection: '/api/v1/dcv/providers',
  routeItem: '/api/v1/dcv/providers/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

const endpointSchema = z
  .string()
  .describe('Provider API base URL, e.g. "https://www.digicert.com".');
const credentialsSchema = z
  .string()
  .describe(
    'Name of an existing credentials object (DCV target) holding the provider API key.',
  );
const timeoutSchema = z
  .string()
  .describe(
    'Request timeout as a duration string, e.g. "30 seconds". Mandatory.',
  );
const proxySchema = z
  .string()
  .describe('Optional name of an existing HTTP proxy configuration.');
const profileSchema = z
  .string()
  .describe('GlobalSign MSSL profile identifier (gs_mssl).');
const defaultEmailSchema = z
  .string()
  .describe('Default contact email for GlobalSign MSSL DCV (gs_mssl).');
const defaultPhoneSchema = z
  .string()
  .describe('Default contact phone for GlobalSign MSSL DCV (gs_mssl).');
const providerNameSchema = z
  .string()
  .describe('Provider name. Immutable primary key (the update lookup key).');
const clearFieldsSchema = z
  .array(z.string())
  .optional()
  .describe('Top-level fields to explicitly null, e.g. ["proxy"].');

const CREATE_DCV_PROVIDERS_SCHEMA = z.discriminatedUnion('type', [
  z.object({
    name: providerNameSchema,
    type: z.literal('digicert').describe('DigiCert DCV provider.'),
    endpoint: endpointSchema,
    credentials: credentialsSchema,
    timeout: timeoutSchema,
    proxy: proxySchema.optional(),
  }),
  z.object({
    name: providerNameSchema,
    type: z.literal('gs_mssl').describe('GlobalSign MSSL DCV provider.'),
    endpoint: endpointSchema,
    credentials: credentialsSchema,
    timeout: timeoutSchema,
    proxy: proxySchema.optional(),
    profile: profileSchema,
    defaultEmail: defaultEmailSchema,
    defaultPhone: defaultPhoneSchema,
  }),
]);

const UPDATE_DCV_PROVIDERS_SCHEMA = z.discriminatedUnion('type', [
  z.object({
    name: providerNameSchema,
    type: z.literal('digicert').describe('DigiCert DCV provider.'),
    endpoint: endpointSchema.optional(),
    credentials: credentialsSchema.optional(),
    timeout: timeoutSchema.optional(),
    proxy: proxySchema.optional(),
    clear_fields: clearFieldsSchema,
  }),
  z.object({
    name: providerNameSchema,
    type: z.literal('gs_mssl').describe('GlobalSign MSSL DCV provider.'),
    endpoint: endpointSchema.optional(),
    credentials: credentialsSchema.optional(),
    timeout: timeoutSchema.optional(),
    proxy: proxySchema.optional(),
    profile: profileSchema.optional(),
    defaultEmail: defaultEmailSchema.optional(),
    defaultPhone: defaultPhoneSchema.optional(),
    clear_fields: clearFieldsSchema,
  }),
]);

type CreateDcvProviderArgs = z.infer<typeof CREATE_DCV_PROVIDERS_SCHEMA>;
type UpdateDcvProviderArgs = z.infer<typeof UPDATE_DCV_PROVIDERS_SCHEMA>;

const GS_MSSL_KEYS = ['profile', 'defaultEmail', 'defaultPhone'] as const;

function addDefinedFields(
  target: Record<string, unknown>,
  args: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (args[key] !== undefined) target[key] = args[key];
  }
}

function buildProviderPayload(
  args: CreateDcvProviderArgs,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: args.name,
    type: args.type,
    endpoint: args.endpoint,
    credentials: args.credentials,
    timeout: args.timeout,
  };
  if (args.proxy !== undefined) body['proxy'] = args.proxy;
  addDefinedFields(body, args as Record<string, unknown>, GS_MSSL_KEYS);
  return body;
}

function buildProviderOverrides(
  args: UpdateDcvProviderArgs,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = { type: args.type };
  if (args.endpoint !== undefined) overrides['endpoint'] = args.endpoint;
  if (args.credentials !== undefined)
    overrides['credentials'] = args.credentials;
  if (args.timeout !== undefined) overrides['timeout'] = args.timeout;
  if (args.proxy !== undefined) overrides['proxy'] = args.proxy;
  addDefinedFields(overrides, args as Record<string, unknown>, GS_MSSL_KEYS);
  return overrides;
}

export function registerDcvProviderTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List DCV (Domain Control Validation) provider configurations (the CA-side ' +
      'integrations that issue DCV challenges).',
    getDescription: 'Get a single DCV provider configuration by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a DCV (Domain Control Validation) provider: the public-CA-side ' +
      'integration that performs domain-control validation for public ' +
      'certificates (digicert or gs_mssl). This is DCV - distinct from a PKI ' +
      'connector, which issues certificates. credentials must reference an ' +
      'existing credentials object with the DCV target.',
    mandatoryFields: ['name', 'type', 'endpoint', 'credentials', 'timeout'],
    inputSchema: CREATE_DCV_PROVIDERS_SCHEMA as never,
    buildPayload: (args) => buildProviderPayload(args as CreateDcvProviderArgs),
  });

  registerUpdateTool(server, client, SPEC, {
    description:
      'Update an existing DCV provider configuration. The submitted type must ' +
      'match the stored one.',
    inputSchema: UPDATE_DCV_PROVIDERS_SCHEMA as never,
    buildOverrides: (args) =>
      buildProviderOverrides(args as UpdateDcvProviderArgs),
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a DCV provider configuration.',
    deleteConstraints:
      'Cannot be deleted while referenced by a DCV policy (InvalidReferenceException).',
  });
}
