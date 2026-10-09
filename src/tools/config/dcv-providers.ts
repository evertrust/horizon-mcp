/**
 * DCV (Domain Control Validation) provider configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * New in Horizon 2.10. A DCV provider is the CA-side integration that issues and
 * tracks DCV challenges. The configuration is discriminated by `type`; Horizon
 * 2.10 supports "digicert"; "gs_mssl" and "sectigo" require Horizon 2.11+.
 * The schemas are discriminated by type because GlobalSign MSSL and Sectigo
 * require additional fields.
 *
 * "_id" and "tenant" are ignored on input. Required: name, type, endpoint,
 * credentials, timeout. gs_mssl additionally requires profile, defaultEmail,
 * and defaultPhone. sectigo additionally requires dcvMethod. timeout is
 * mandatory for all types; proxy is optional.
 *
 * Route: /api/v1/dcv/providers. Update PUTs the COLLECTION root (body-keyed
 * full-replace); the wrapper does GET-merge so omitted fields are preserved.
 * Cannot be deleted while referenced by a DCV policy.
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
  noun: 'dcv_provider',
  nounPlural: 'dcv_providers',
  label: 'DCV provider',
  routeCollection: '/api/v1/dcv/providers',
  routeItem: '/api/v1/dcv/providers/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id', 'type'],
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
const gsMsslCredentialsSchema = z
  .string()
  .describe(
    'Name of an existing login/password credentials object for GlobalSign MSSL.',
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
const sectigoCredentialsSchema = z
  .string()
  .describe(
    'Name of an existing login/password credentials object that holds the ' +
      'Sectigo Certificate Manager API client: the OAuth client id as login ' +
      'and the client secret as password.',
  );
const sectigoEndpointSchema = z
  .string()
  .describe(
    'Sectigo Certificate Manager (SCM) API base URL, e.g. ' +
      '"https://admin.enterprise.sectigo.com".',
  );
const oauthTokenEndpointSchema = z
  .string()
  .describe(
    'OAuth token endpoint used to get a bearer token for the SCM API. ' +
      'Optional. Default: "https://auth.sso.sectigo.com/auth/realms/apiclients/protocol/openid-connect/token".',
  );
const dcvMethodSchema = z
  .enum(['cname', 'txt'])
  .describe(
    'DNS method used to validate a domain. It is a fallback: a domain that ' +
      'already has a CNAME or TXT validation is validated again with its own ' +
      'method.',
  );
const organizationIdSchema = z
  .number()
  .int()
  .describe(
    'Optional Sectigo organization or department id. It limits the domain ' +
      'listing. When unset, all domains of the customer account are listed.',
  );
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
    type: z
      .literal('gs_mssl')
      .describe('GlobalSign MSSL DCV provider (Horizon 2.11+).'),
    endpoint: endpointSchema,
    credentials: gsMsslCredentialsSchema,
    timeout: timeoutSchema,
    proxy: proxySchema.optional(),
    profile: profileSchema,
    defaultEmail: defaultEmailSchema,
    defaultPhone: defaultPhoneSchema,
  }),
  z.object({
    name: providerNameSchema,
    type: z
      .literal('sectigo')
      .describe('Sectigo DCV provider (Horizon 2.11+).'),
    endpoint: sectigoEndpointSchema,
    credentials: sectigoCredentialsSchema,
    timeout: timeoutSchema,
    dcvMethod: dcvMethodSchema,
    oauthTokenEndpoint: oauthTokenEndpointSchema.optional(),
    organizationId: organizationIdSchema.optional(),
    proxy: proxySchema.optional(),
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
    type: z
      .literal('gs_mssl')
      .describe('GlobalSign MSSL DCV provider (Horizon 2.11+).'),
    endpoint: endpointSchema.optional(),
    credentials: gsMsslCredentialsSchema.optional(),
    timeout: timeoutSchema.optional(),
    proxy: proxySchema.optional(),
    profile: profileSchema.optional(),
    defaultEmail: defaultEmailSchema.optional(),
    defaultPhone: defaultPhoneSchema.optional(),
    clear_fields: clearFieldsSchema,
  }),
  z.object({
    name: providerNameSchema,
    type: z
      .literal('sectigo')
      .describe('Sectigo DCV provider (Horizon 2.11+).'),
    endpoint: sectigoEndpointSchema.optional(),
    credentials: sectigoCredentialsSchema.optional(),
    timeout: timeoutSchema.optional(),
    dcvMethod: dcvMethodSchema.optional(),
    oauthTokenEndpoint: oauthTokenEndpointSchema.optional(),
    organizationId: organizationIdSchema.optional(),
    proxy: proxySchema.optional(),
    clear_fields: clearFieldsSchema,
  }),
]);

type CreateDcvProviderArgs = z.infer<typeof CREATE_DCV_PROVIDERS_SCHEMA>;
type UpdateDcvProviderArgs = z.infer<typeof UPDATE_DCV_PROVIDERS_SCHEMA>;

const SUBTYPE_KEYS = [
  'profile',
  'defaultEmail',
  'defaultPhone',
  'dcvMethod',
  'oauthTokenEndpoint',
  'organizationId',
] as const;

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
  addDefinedFields(body, args as Record<string, unknown>, SUBTYPE_KEYS);
  return body;
}

function buildProviderOverrides(
  args: UpdateDcvProviderArgs,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(
      ([key, value]) =>
        key !== 'name' && key !== 'clear_fields' && value !== undefined,
    ),
  );
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
      'certificates (digicert, or gs_mssl and sectigo on Horizon 2.11+). This is DCV - distinct from a PKI ' +
      'connector, which issues certificates. credentials must reference an ' +
      'existing credentials object with the DCV target.',
    mandatoryFields: ['name', 'type', 'endpoint', 'credentials', 'timeout'],
    inputSchema: CREATE_DCV_PROVIDERS_SCHEMA as never,
    buildPayload: (args) => buildProviderPayload(args as CreateDcvProviderArgs),
  });

  registerUpdateTool(server, client, SPEC, {
    description:
      'Update an existing DCV provider configuration. The submitted type must ' +
      'match the stored one. gs_mssl and sectigo require Horizon 2.11+.',
    inputSchema: UPDATE_DCV_PROVIDERS_SCHEMA as never,
    buildOverrides: (args) =>
      buildProviderOverrides(args as UpdateDcvProviderArgs),
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a DCV provider configuration.',
    deleteConstraints: 'Cannot be deleted while referenced by a DCV policy.',
  });
}
