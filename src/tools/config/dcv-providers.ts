/**
 * DCV (Domain Control Validation) provider configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * New in Horizon 2.10. A DCV provider is the CA-side integration that issues and
 * tracks DCV challenges. The configuration is discriminated by `type`; Horizon
 * 2.10 ships a single provider type, "digicert" (more are planned). Modelled flat
 * because there is currently one subtype.
 *
 * Source: models/dcv/DCVProviderConfig.scala + DCVProviderType.scala +
 * implementation/digicert/DigiCertDCVProviderConfig.scala. Format ignores
 * "_id"/"tenant". Required: name, type, endpoint, credentials, timeout (timeout
 * is mandatory: isTimeoutMandatory = true). Optional: proxy.
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

const PROVIDER_TYPES = ['digicert'] as const;

const typeSchema = z
  .enum(PROVIDER_TYPES)
  .describe('DCV provider type. Horizon 2.10 supports "digicert".');
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

const CREATE_DCV_PROVIDERS_SCHEMA = z.object({
  name: z
    .string()
    .describe('Provider name. Immutable primary key (the update lookup key).'),
  type: typeSchema,
  endpoint: endpointSchema,
  credentials: credentialsSchema,
  timeout: timeoutSchema,
  proxy: proxySchema.optional(),
});

const UPDATE_DCV_PROVIDERS_SCHEMA = z.object({
  name: z.string().describe('Provider name to update (immutable key).'),
  type: typeSchema,
  endpoint: endpointSchema.optional(),
  credentials: credentialsSchema.optional(),
  timeout: timeoutSchema.optional(),
  proxy: proxySchema.optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe('Top-level fields to explicitly null, e.g. ["proxy"].'),
});

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
      'certificates (e.g. digicert). This is DCV - distinct from a digicert PKI ' +
      'connector, which issues certificates. credentials must reference an ' +
      'existing credentials object with the DCV target.',
    mandatoryFields: ['name', 'type', 'endpoint', 'credentials', 'timeout'],
    inputSchema: CREATE_DCV_PROVIDERS_SCHEMA,
    buildPayload: (args) => {
      const body: Record<string, unknown> = {
        name: args.name,
        type: args.type,
        endpoint: args.endpoint,
        credentials: args.credentials,
        timeout: args.timeout,
      };
      if (args.proxy !== undefined) body['proxy'] = args.proxy;
      return body;
    },
  });

  registerUpdateTool(server, client, SPEC, {
    description:
      'Update an existing DCV provider configuration. The submitted type must ' +
      'match the stored one.',
    inputSchema: UPDATE_DCV_PROVIDERS_SCHEMA,
    buildOverrides: (args) => {
      const o: Record<string, unknown> = { type: args.type };
      if (args.endpoint !== undefined) o['endpoint'] = args.endpoint;
      if (args.credentials !== undefined) o['credentials'] = args.credentials;
      if (args.timeout !== undefined) o['timeout'] = args.timeout;
      if (args.proxy !== undefined) o['proxy'] = args.proxy;
      return o;
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a DCV provider configuration.',
    deleteConstraints:
      'Cannot be deleted while referenced by a DCV policy (InvalidReferenceException).',
  });
}
