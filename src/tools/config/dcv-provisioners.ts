/**
 * DCV (Domain Control Validation) provisioner configuration tools (flat,
 * fully-typed, discriminated by `type` with per-type required fields).
 *
 * 5 tools: list / get / create / update / delete.
 * New in Horizon 2.10. A DCV provisioner writes DNS challenge records to a DNS
 * backend. Discriminated by `type` over 5 backends:
 *   - cloudflare, powerdns, efficientip: require endpoint + credentials
 *   - efficientip: also requires dnsName (optional dnsView)
 *   - azuredns: requires tenantId + subscriptionId + resourceGroupName
 *               (endpoint + credentials optional; optional authorityHost)
 *   - route53: endpoint + credentials optional (optional region, roleArn)
 * Common required: name, type, ttl, timeout. Common optional: proxy,
 * delegationZone, zoneIdMappings.
 *
 * Source: models/dcv/DCVProvisionerConfig.scala + DCVProvisionerType.scala +
 * implementation/{cloudflare,powerdns,efficientip,azuredns,route53}/*.scala.
 * Formats ignore "_id"/"tenant"; timeout is mandatory (isTimeoutMandatory).
 *
 * Route: /api/v1/dcv/provisioners. Update PUTs the COLLECTION root (body-keyed
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
  noun: 'dcv_provisioner',
  nounPlural: 'dcv_provisioners',
  label: 'DCV provisioner',
  routeCollection: '/api/v1/dcv/provisioners',
  routeItem: '/api/v1/dcv/provisioners/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

const PROVISIONER_TYPES = [
  'cloudflare',
  'powerdns',
  'efficientip',
  'azuredns',
  'route53',
] as const;
type ProvisionerType = (typeof PROVISIONER_TYPES)[number];

const zoneIdMappingSchema = z.object({
  regex: z.string().describe('Domain-matching regular expression.'),
  zoneId: z.string().describe('DNS zone id to use for matching domains.'),
});

const fields = {
  name: z
    .string()
    .describe(
      'Provisioner name. Immutable primary key (the update lookup key).',
    ),
  type: z
    .enum(PROVISIONER_TYPES)
    .describe(
      'DNS backend type. Drives which fields are required: cloudflare/powerdns/' +
        'efficientip need endpoint+credentials; efficientip also dnsName; azuredns ' +
        'needs tenantId+subscriptionId+resourceGroupName; route53 needs none extra.',
    ),
  ttl: z
    .string()
    .describe('DNS record TTL as a duration string, e.g. "60 seconds".'),
  timeout: z
    .string()
    .describe(
      'Request timeout as a duration string, e.g. "30 seconds". Mandatory.',
    ),
  endpoint: z.string().describe('DNS backend API base URL.'),
  credentials: z
    .string()
    .describe('Name of an existing credentials object (DCV target).'),
  proxy: z
    .string()
    .describe('Optional name of an existing HTTP proxy configuration.'),
  delegationZone: z
    .string()
    .describe('Optional DNS delegation (acme-dns) zone.'),
  zoneIdMappings: z
    .array(zoneIdMappingSchema)
    .describe('Optional regex -> DNS zone id mappings.'),
  // azuredns
  tenantId: z.string().describe('Azure tenant id (azuredns).'),
  subscriptionId: z.string().describe('Azure subscription id (azuredns).'),
  resourceGroupName: z
    .string()
    .describe('Azure resource group name (azuredns).'),
  authorityHost: z
    .string()
    .describe('Optional Azure authority host URL (azuredns).'),
  // efficientip
  dnsName: z.string().describe('EfficientIP DNS server name (efficientip).'),
  dnsView: z.string().describe('Optional EfficientIP DNS view (efficientip).'),
  // route53
  region: z.string().describe('Optional AWS region (route53).'),
  roleArn: z.string().describe('Optional AWS role ARN to assume (route53).'),
};

/**
 * Per-type required-field check (create). Returns a JSON error string naming the
 * missing fields, or undefined when the body satisfies the chosen subtype.
 */
function missingForType(
  type: ProvisionerType,
  has: (f: string) => boolean,
): string[] {
  const missing: string[] = [];
  if (type === 'cloudflare' || type === 'powerdns' || type === 'efficientip') {
    if (!has('endpoint')) missing.push('endpoint');
    if (!has('credentials')) missing.push('credentials');
  }
  if (type === 'efficientip' && !has('dnsName')) missing.push('dnsName');
  if (type === 'azuredns') {
    for (const f of ['tenantId', 'subscriptionId', 'resourceGroupName']) {
      if (!has(f)) missing.push(f);
    }
  }
  return missing;
}

const OPTIONAL_KEYS = [
  'endpoint',
  'credentials',
  'proxy',
  'delegationZone',
  'zoneIdMappings',
  'tenantId',
  'subscriptionId',
  'resourceGroupName',
  'authorityHost',
  'dnsName',
  'dnsView',
  'region',
  'roleArn',
] as const;

function buildBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: args['name'],
    type: args['type'],
    ttl: args['ttl'],
    timeout: args['timeout'],
  };
  for (const k of OPTIONAL_KEYS) {
    if (args[k] !== undefined) body[k] = args[k];
  }
  return body;
}

const CREATE_DCV_PROVISIONERS_SCHEMA = z.object({
  name: fields.name,
  type: fields.type,
  ttl: fields.ttl,
  timeout: fields.timeout,
  endpoint: fields.endpoint.optional(),
  credentials: fields.credentials.optional(),
  proxy: fields.proxy.optional(),
  delegationZone: fields.delegationZone.optional(),
  zoneIdMappings: fields.zoneIdMappings.optional(),
  tenantId: fields.tenantId.optional(),
  subscriptionId: fields.subscriptionId.optional(),
  resourceGroupName: fields.resourceGroupName.optional(),
  authorityHost: fields.authorityHost.optional(),
  dnsName: fields.dnsName.optional(),
  dnsView: fields.dnsView.optional(),
  region: fields.region.optional(),
  roleArn: fields.roleArn.optional(),
});

const UPDATE_DCV_PROVISIONERS_SCHEMA = z.object({
  name: fields.name,
  type: fields.type,
  ttl: fields.ttl.optional(),
  timeout: fields.timeout.optional(),
  endpoint: fields.endpoint.optional(),
  credentials: fields.credentials.optional(),
  proxy: fields.proxy.optional(),
  delegationZone: fields.delegationZone.optional(),
  zoneIdMappings: fields.zoneIdMappings.optional(),
  tenantId: fields.tenantId.optional(),
  subscriptionId: fields.subscriptionId.optional(),
  resourceGroupName: fields.resourceGroupName.optional(),
  authorityHost: fields.authorityHost.optional(),
  dnsName: fields.dnsName.optional(),
  dnsView: fields.dnsView.optional(),
  region: fields.region.optional(),
  roleArn: fields.roleArn.optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe('Top-level fields to explicitly null, e.g. ["proxy"].'),
});

const CREATE_DCV_PROVISIONER_OPTS = {
  description:
    'Create a DCV (Domain Control Validation) provisioner that writes DNS ' +
    'challenge records to a DNS backend (cloudflare/powerdns/efficientip/' +
    'azuredns/route53). Note: azuredns writes DNS validation records - it is ' +
    'NOT Azure Key Vault certificate publishing (that is a third-party ' +
    'connector, type akv). Required fields depend on type (see the type field ' +
    'description).',
  mandatoryFields: ['name', 'type', 'ttl', 'timeout'],
  inputSchema: CREATE_DCV_PROVISIONERS_SCHEMA,
  preValidate: (args: z.infer<typeof CREATE_DCV_PROVISIONERS_SCHEMA>) => {
    const missing = missingForType(
      args.type,
      (f) => (args as Record<string, unknown>)[f] !== undefined,
    );
    if (missing.length > 0) {
      return JSON.stringify({
        error: `Missing mandatory field(s) for type=${args.type}: ${missing.join(', ')}. Ask the user for these - do not infer them.`,
      });
    }
    return undefined;
  },
  buildPayload: (args: z.infer<typeof CREATE_DCV_PROVISIONERS_SCHEMA>) =>
    buildBody(args as Record<string, unknown>),
};

const UPDATE_DCV_PROVISIONER_OPTS = {
  description:
    'Update an existing DCV provisioner. The submitted type must match the ' +
    'stored one. Only supplied fields change (GET-merge full-replace).',
  inputSchema: UPDATE_DCV_PROVISIONERS_SCHEMA,
  buildOverrides: (args: z.infer<typeof UPDATE_DCV_PROVISIONERS_SCHEMA>) => {
    const o: Record<string, unknown> = { type: args.type };
    if (args.ttl !== undefined) o['ttl'] = args.ttl;
    if (args.timeout !== undefined) o['timeout'] = args.timeout;
    for (const k of OPTIONAL_KEYS) {
      const v = (args as Record<string, unknown>)[k];
      if (v !== undefined) o[k] = v;
    }
    return o;
  },
};

export function registerDcvProvisionerTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List DCV (Domain Control Validation) provisioner configurations (the DNS ' +
      'backends that write challenge records: cloudflare, powerdns, efficientip, ' +
      'azuredns, route53).',
    getDescription: 'Get a single DCV provisioner configuration by name.',
  });

  registerCreateTool(server, client, SPEC, CREATE_DCV_PROVISIONER_OPTS);

  registerUpdateTool(server, client, SPEC, UPDATE_DCV_PROVISIONER_OPTS);

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a DCV provisioner configuration.',
    deleteConstraints:
      'Cannot be deleted while referenced by a DCV policy (InvalidReferenceException).',
  });
}
