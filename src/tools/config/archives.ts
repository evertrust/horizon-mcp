/**
 * Archive configuration tools (polymorphic / "complex").
 *
 * 4 tools: list / get / create / delete + describe_archive_schema. There is NO
 * update tool: the item route /api/v1/archives/{name} supports only GET and
 * DELETE, and an archive is a one-shot create-and-delete job (POST also
 * immediately starts archiving).
 * Contract: docs/audit/archives.contract.json (+ archives.schema.json), traced
 * to ArchiveApiV1Controller.scala / Archives.scala / ArchiveType.scala.
 *
 * Polymorphic: a oneOf over two subtypes discriminated by `type`
 * (certificate -> CertificateArchive, event -> EventArchive). Because the
 * editable shape diverges by subtype, create takes the common typed mandatory
 * params (name, type, filename) + a validated `config` body carrying the
 * subtype-specific fields. The body is merged, checked with assertConfigBody
 * against the resolved subtype's required/known keys, then POSTed.
 *
 * Route: /api/v1/archives:
 *   - type=certificate -> requires archiveKeys; optional filter (HCQL).
 *   - type=event        -> requires before (epoch ms).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  type ConfigSpec,
  assertConfigBody,
  registerCreateTool,
  registerDeleteTool,
  registerDescribeSchemaTool,
  registerReadTools,
} from './_scaffold.js';
import { archiveRequestSchema } from './schemas/archives.schema.js';

const SPEC: ConfigSpec = {
  noun: 'archive',
  nounPlural: 'archives',
  label: 'archive',
  routeCollection: '/api/v1/archives',
  routeItem: '/api/v1/archives/{name}',
  idField: 'name',
  immutableKeys: [
    'name',
    'type',
    'filename',
    'filter',
    'before',
    'archiveKeys',
  ],
  stripFields: [
    '_id',
    'status',
    'count',
    'error',
    'createdAt',
    'purgeAt',
    'tenant',
  ],
  putOnCollection: true,
};

const ARCHIVE_TYPES = ['certificate', 'event'] as const;

const SCHEMA_VERSION = '2026-06-04';
const SUBTYPES = ['CertificateArchive', 'EventArchive'] as const;

// Per-subtype required keys (from the resolved schema `required` arrays).
const REQUIRED_CERTIFICATE = [
  'name',
  'type',
  'filename',
  'archiveKeys',
] as const;
const REQUIRED_EVENT = ['name', 'type', 'filename', 'before'] as const;

// Per-subtype known top-level keys (from the resolved schema `properties`).
const KNOWN_CERTIFICATE = [...REQUIRED_CERTIFICATE, 'filter'] as const;
const KNOWN_EVENT = [...REQUIRED_EVENT] as const;

const ENUMS: Record<string, readonly string[]> = {
  type: ARCHIVE_TYPES,
};

/**
 * Merge the typed mandatory params + caller config into one body, then validate
 * it against the resolved subtype's required/known keys. Throws
 * HorizonError(422) on a missing mandatory field (e.g. archiveKeys for
 * certificate, before for event), an unknown top-level field, or a bad enum so
 * the model can self-correct before the network call.
 */
function buildArchiveBody(args: {
  name: string;
  type: (typeof ARCHIVE_TYPES)[number];
  filename: string;
  config?: Record<string, unknown>;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...(args.config ?? {}),
    name: args.name,
    type: args.type,
    filename: args.filename,
  };

  if (args.type === 'certificate') {
    assertConfigBody(body, {
      requiredKeys: REQUIRED_CERTIFICATE,
      knownKeys: KNOWN_CERTIFICATE,
      enums: ENUMS,
    });
  } else {
    assertConfigBody(body, {
      requiredKeys: REQUIRED_EVENT,
      knownKeys: KNOWN_EVENT,
      enums: ENUMS,
    });
  }
  return body;
}

const nameSchema = z
  .string()
  .describe(
    'Archive name. Immutable primary key, must be unique (ARCHIVE-004 if it already exists).',
  );
const typeSchema = z
  .enum(ARCHIVE_TYPES)
  .describe(
    "Archive subtype discriminator: 'certificate' (CertificateArchive) or 'event' (EventArchive).",
  );
const filenameSchema = z
  .string()
  .describe(
    'Output Parquet file name. Must be unique across archives and must not already exist on the configured storage backend.',
  );
const configSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Subtype-specific fields, camelCase API keys (not snake_case). Call ' +
      'describe_archive_schema FIRST to see the exact required/optional fields ' +
      'for the chosen type. type=certificate: archiveKeys (REQUIRED boolean - ' +
      'whether escrowed private keys are included) + optional filter (HCQL). ' +
      'type=event: before (REQUIRED epoch milliseconds; events strictly before ' +
      'this instant are archived). Do NOT include name/type/filename here - pass ' +
      'those as their own parameters.',
  );

export function registerArchiveTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerDescribeSchemaTool(server, {
    noun: SPEC.noun,
    label: SPEC.label,
    discriminatorField: 'type',
    subtypes: SUBTYPES,
    mandatoryFields: ['name', 'type', 'filename'],
    jsonSchema: archiveRequestSchema,
    schemaVersion: SCHEMA_VERSION,
  });

  registerReadTools(server, client, SPEC, {
    listDescription: 'List archives.',
    getDescription: 'Get a single archive by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create an archive and immediately start the archiving job. Polymorphic: ' +
      'call describe_archive_schema first to learn the required `config` fields ' +
      'for the chosen type. type=certificate archives certificates matching an ' +
      'HCQL filter (requires CLM or PKI license); type=event archives events ' +
      'before a given instant (requires CLM, PKI or DCV license). ' +
      'Create-and-delete only: there is no update.',
    mandatoryFields: ['name', 'type', 'filename'],
    inputSchema: z.object({
      name: nameSchema,
      type: typeSchema,
      filename: filenameSchema,
      config: configSchema.optional(),
    }),
    buildPayload: (args) => buildArchiveBody(args),
  });

  registerDeleteTool(server, client, SPEC, {
    description:
      'Delete an archive (and its stored file when stored on GridFS).',
    deleteConstraints:
      'Returns ARCHIVE-005 "Referenced archive" if at least one certificate or ' +
      'event still references the archive. Returns 404 ARCHIVE-003 if not found.',
  });
}
