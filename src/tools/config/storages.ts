/**
 * Storage backend configuration tools (S3; fully typed despite the "complex"
 * audit tag - only the s3 subtype exists today).
 *
 * 5 tools: list / get / create / update / delete.
 * Contract: docs/audit/storages.contract.json (+ storages.schema.json), traced
 * to S3StorageBackendConfig.scala. NOTE: the Scala Format makes forcePathStyle,
 * bucket, checksumMode and partBufferSize REQUIRED (no case-class default),
 * even though the hand-authored OpenAPI omits checksumMode from its required
 * array - so they are mandatory here. timeout is server-enforced mandatory
 * (isTimeoutMandatory=true).
 *
 * Route: /api/v1/system/storages. Update PUTs the COLLECTION root (body-keyed
 * full-replace); the wrapper does GET-merge so omitted fields are preserved.
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
  noun: 'storage',
  nounPlural: 'storages',
  label: 'storage backend',
  routeCollection: '/api/v1/system/storages',
  routeItem: '/api/v1/system/storages/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id'],
  putOnCollection: true,
};

const CHECKSUM_MODES = ['when_supported', 'when_required'] as const;

const optionalStrings = {
  credentials: z
    .string()
    .describe(
      'Name of an existing `password` credentials object (STORAGE target) holding AWS keys. Must pre-exist.',
    ),
  role_arn: z.string().describe('AWS Role ARN to impersonate.'),
  region: z.string().describe('AWS region (else read from environment).'),
  proxy: z
    .string()
    .describe('Name of an existing HTTP proxy object for the S3 connection.'),
  endpoint: z.string().describe('Custom S3 endpoint URL.'),
  description: z.string().describe('Free-text description.'),
};

function buildStorageBody(args: {
  name?: string;
  timeout?: string;
  force_path_style?: boolean;
  bucket?: string;
  checksum_mode?: string;
  part_buffer_size?: string;
  credentials?: string;
  role_arn?: string;
  region?: string;
  proxy?: string;
  endpoint?: string;
  description?: string;
}): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (args.name !== undefined) o['name'] = args.name;
  if (args.timeout !== undefined) o['timeout'] = args.timeout;
  if (args.force_path_style !== undefined)
    o['forcePathStyle'] = args.force_path_style;
  if (args.bucket !== undefined) o['bucket'] = args.bucket;
  if (args.checksum_mode !== undefined) o['checksumMode'] = args.checksum_mode;
  if (args.part_buffer_size !== undefined)
    o['partBufferSize'] = args.part_buffer_size;
  if (args.credentials !== undefined) o['credentials'] = args.credentials;
  if (args.role_arn !== undefined) o['roleArn'] = args.role_arn;
  if (args.region !== undefined) o['region'] = args.region;
  if (args.proxy !== undefined) o['proxy'] = args.proxy;
  if (args.endpoint !== undefined) o['endpoint'] = args.endpoint;
  if (args.description !== undefined) o['description'] = args.description;
  return o;
}

const CREATE_STORAGES_SCHEMA = z.object({
  name: z
    .string()
    .describe('Storage name. Immutable primary key, regex [0-9a-zA-Z-_.]+.'),
  timeout: z
    .string()
    .describe('S3 connection timeout, e.g. "30s". Mandatory, must be > 0.'),
  force_path_style: z.boolean().describe('Force S3 path-style requests.'),
  bucket: z.string().describe('S3 bucket to store items into.'),
  checksum_mode: z.enum(CHECKSUM_MODES).describe('S3 checksum mode.'),
  part_buffer_size: z
    .string()
    .describe(
      'Multipart upload buffer size, e.g. "9MB". Must resolve to < 2GB.',
    ),
  credentials: optionalStrings.credentials.optional(),
  role_arn: optionalStrings.role_arn.optional(),
  region: optionalStrings.region.optional(),
  proxy: optionalStrings.proxy.optional(),
  endpoint: optionalStrings.endpoint.optional(),
  description: optionalStrings.description.optional(),
});

const UPDATE_STORAGES_SCHEMA = z.object({
  name: z.string().describe('Storage name to update (immutable key).'),
  timeout: z.string().optional(),
  force_path_style: z.boolean().optional(),
  bucket: z.string().optional(),
  checksum_mode: z.enum(CHECKSUM_MODES).optional(),
  part_buffer_size: z.string().optional(),
  credentials: optionalStrings.credentials.optional(),
  role_arn: optionalStrings.role_arn.optional(),
  region: optionalStrings.region.optional(),
  proxy: optionalStrings.proxy.optional(),
  endpoint: optionalStrings.endpoint.optional(),
  description: optionalStrings.description.optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe(
      'Top-level fields to explicitly null, e.g. ["credentials","proxy"].',
    ),
});

export function registerStorageTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: 'List storage backend configurations.',
    getDescription: 'Get a single storage backend configuration by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create an S3-compatible OBJECT STORAGE backend for archives and ' +
      'magic-link reports. This is data storage - NOT AWS certificate issuance ' +
      '(awsacmpca PKI connector) or AWS certificate publishing (aws third-party ' +
      'connector).',
    mandatoryFields: [
      'name',
      'timeout',
      'force_path_style',
      'bucket',
      'checksum_mode',
      'part_buffer_size',
    ],
    inputSchema: CREATE_STORAGES_SCHEMA,
    buildPayload: (args) => ({ type: 's3', ...buildStorageBody(args) }),
  });

  registerUpdateTool(server, client, SPEC, {
    description: 'Update an existing S3 storage backend configuration.',
    inputSchema: UPDATE_STORAGES_SCHEMA,
    buildOverrides: (args) => {
      const { name: _name, ...rest } = args;
      return buildStorageBody(rest);
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete an S3 storage backend configuration.',
    deleteConstraints:
      'Cannot be deleted while referenced by the system configuration as ' +
      'archiveStorage or magicLinkReportStorage (Storage005).',
  });
}
