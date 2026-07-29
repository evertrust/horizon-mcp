/**
 * System Configuration tools (complex / polymorphic).
 *
 * 5 tools: describe / list / get / create / update (NO delete - the API has no
 * DELETE endpoint; entries can only be overwritten via upsert).
 * Contract: docs/audit/system_configuration.contract.json (+
 * system_configuration.schema.json), traced to SystemConfigurationEntry.scala /
 * SystemConfigurationApiV1Controller.scala / SystemConfigurationService.scala.
 *
 * The body is a discriminated union keyed on `type`
 * (license | internal_monitor | interface_customization | storage). `type` is
 * the effective primary key (unique index `type_idx`) AND immutable. The single
 * PUT /api/v1/system/configuration is an UPSERT (replaceOne by type = FULL
 * REPLACE). The wrapper does GET-strip-merge so omitted fields are preserved on
 * update. stripFields = [_id, tenant] (audited).
 *
 * Polymorphic shape: describe_system_config_schema surfaces the exact structure;
 * create/update take the required `type` discriminator + typed top-level params
 * + a free-form `config` record, merge them into the body, run assertConfigBody,
 * then POST (create) / GET-strip-merge-PUT on the collection root (update).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  type ConfigSpec,
  assertConfigBody,
  registerDescribeSchemaTool,
  registerReadTools,
  registerUpdateTool,
} from './_scaffold.js';
import { systemConfigurationRequestSchema } from './schemas/system-configuration.schema.js';

const SPEC: ConfigSpec = {
  noun: 'system_config',
  nounPlural: 'system_configs',
  label: 'System Configuration',
  routeCollection: '/api/v1/system/configuration',
  routeItem: '/api/v1/system/configuration/{type}',
  idField: 'type',
  immutableKeys: ['type'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

const SUBTYPES = [
  'license',
  'internal_monitor',
  'interface_customization',
  'storage',
] as const;

const ANNOUNCEMENT_LEVELS = ['info', 'warning', 'danger'] as const;

// Union of every top-level property across all subtypes (the discriminated
// union's combined property set). Used as the assertConfigBody known-key set.
const KNOWN_KEYS = [
  'type',
  // license
  'triggers',
  // internal_monitor
  'cron',
  // interface_customization
  'logo',
  'headerStart',
  'headerEnd',
  'announcements',
  // storage
  'archiveStorage',
  'magicLinkReportStorage',
] as const;

const typeSchema = z
  .enum(SUBTYPES)
  .describe(
    'Configuration subtype discriminator. Effective immutable primary key ' +
      '(unique per tenant). One of: license, internal_monitor, ' +
      'interface_customization, storage.',
  );

const cronSchema = z
  .string()
  .describe(
    '[internal_monitor only] MANDATORY Quartz cron expression for internal ' +
      'monitor checks, e.g. "0 0 0 ? * * *". No default - invalid expressions ' +
      'are rejected with HTTP 400.',
  );

const triggersSchema = z
  .object({
    onLicenseExpiration: z
      .array(z.string())
      .optional()
      .describe(
        'Trigger names to run on ON_LICENSE_EXPIRATION. Each must reference an existing runnable trigger.',
      ),
    onLicenseUsage: z
      .array(z.string())
      .optional()
      .describe(
        'Trigger names to run on ON_LICENSE_USAGE. Each must reference an existing runnable trigger.',
      ),
  })
  .describe('[license only] Triggers to execute on license events.');

const announcementsSchema = z
  .array(
    z.object({
      level: z
        .enum(ANNOUNCEMENT_LEVELS)
        .describe('Announcement severity: info, warning, or danger.'),
      content: z
        .array(z.object({ lang: z.string(), value: z.string() }))
        .min(1)
        .describe(
          'Localized contents, e.g. [{lang:"en",value:"..."}]. Server requires at least one element.',
        ),
    }),
  )
  .describe(
    '[interface_customization only] Announcements shown to all users (default empty).',
  );

const optionalStrings = {
  logo: z
    .string()
    .describe('[interface_customization only] Base64-encoded logo.'),
  headerStart: z
    .string()
    .describe(
      '[interface_customization only] HTML color code for the left side of the banner gradient.',
    ),
  headerEnd: z
    .string()
    .describe(
      '[interface_customization only] HTML color code for the right side of the banner gradient.',
    ),
  archiveStorage: z
    .string()
    .describe(
      '[storage only] Name of an existing system storage for archive file storage.',
    ),
  magicLinkReportStorage: z
    .string()
    .describe(
      '[storage only] Name of an existing system storage for magic link report storage.',
    ),
};

const configSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    'Free-form bag of any remaining subtype-specific fields. Merged into the ' +
      'body under any typed params. Call describe_system_config_schema for the ' +
      'exact structure of each subtype - never guess.',
  );

interface SystemConfigArgs {
  type: (typeof SUBTYPES)[number];
  cron?: string;
  triggers?: Record<string, unknown>;
  logo?: string;
  headerStart?: string;
  headerEnd?: string;
  announcements?: unknown[];
  archiveStorage?: string;
  magicLinkReportStorage?: string;
  config?: Record<string, unknown>;
}

/** Merge typed top-level params + the free-form config bag into one body. */
function buildSystemConfigBody(
  args: SystemConfigArgs,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...(args.config ?? {}) };
  body['type'] = args.type;
  if (args.cron !== undefined) body['cron'] = args.cron;
  if (args.triggers !== undefined) body['triggers'] = args.triggers;
  if (args.logo !== undefined) body['logo'] = args.logo;
  if (args.headerStart !== undefined) body['headerStart'] = args.headerStart;
  if (args.headerEnd !== undefined) body['headerEnd'] = args.headerEnd;
  if (args.announcements !== undefined)
    body['announcements'] = args.announcements;
  if (args.archiveStorage !== undefined)
    body['archiveStorage'] = args.archiveStorage;
  if (args.magicLinkReportStorage !== undefined)
    body['magicLinkReportStorage'] = args.magicLinkReportStorage;
  return body;
}

function validateSystemConfigBody(body: Record<string, unknown>): void {
  assertConfigBody(body, {
    requiredKeys: ['type'],
    knownKeys: KNOWN_KEYS,
    enums: { type: SUBTYPES },
  });
}

export function registerSystemConfigTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerDescribeSchemaTool(server, {
    noun: 'system_config',
    label: 'System Configuration',
    discriminatorField: 'type',
    subtypes: SUBTYPES,
    mandatoryFields: ['type'],
    jsonSchema: systemConfigurationRequestSchema,
    schemaVersion: '1',
  });

  registerReadTools(server, client, SPEC, {
    listDescription:
      'List system configuration entries (one per type: license, ' +
      'internal_monitor, interface_customization, storage).',
    getDescription:
      'Get a single system configuration entry by type (license, ' +
      'internal_monitor, interface_customization, storage).',
  });

  // No create tool: the 4 system configuration entries (license,
  // internal_monitor, interface_customization, storage) are bootstrapped by the
  // server and there is no POST endpoint (POST /api/v1/system/configuration
  // returns 404 - confirmed against live QA). Entries are set/changed via the
  // PUT upsert below (update_system_config).
  registerUpdateTool(server, client, SPEC, {
    description:
      'Update (upsert) a system configuration entry. The 4 entries are ' +
      'server-bootstrapped; this PUT replaceOne by type is a FULL REPLACE, and ' +
      'the wrapper does GET-strip-merge so omitted fields are preserved. Call ' +
      'describe_system_config_schema first.',
    inputSchema: z.object({
      type: typeSchema,
      cron: cronSchema.optional(),
      triggers: triggersSchema.optional(),
      logo: optionalStrings.logo.optional(),
      headerStart: optionalStrings.headerStart.optional(),
      headerEnd: optionalStrings.headerEnd.optional(),
      announcements: announcementsSchema.optional(),
      archiveStorage: optionalStrings.archiveStorage.optional(),
      magicLinkReportStorage: optionalStrings.magicLinkReportStorage.optional(),
      config: configSchema,
      clear_fields: z
        .array(z.string())
        .optional()
        .describe(
          'Top-level fields to explicitly null, e.g. ["archiveStorage"].',
        ),
    }),
    buildOverrides: (args) => {
      const overrides = buildSystemConfigBody(args as SystemConfigArgs);
      validateSystemConfigBody(overrides);
      return overrides;
    },
  });
}
