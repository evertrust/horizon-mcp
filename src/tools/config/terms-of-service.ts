/**
 * Terms of Service configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * New in Horizon 2.10: certificate enrollment workflows can require Terms of
 * Service acceptance. A ToS entry is referenced by certificate profiles.
 *
 * Source: models/tos/TermsOfService.scala + TermsOfServiceApiV1Controller.scala.
 * Format ignores "_id". Required: name, contents (a NON-EMPTY list of localized
 * markdown strings). Optional: description. contents markdown is server-validated.
 *
 * Route: /api/v1/system/terms-of-services. Update PUTs the COLLECTION root
 * (body-keyed full-replace); the wrapper does GET-merge so omitted fields are
 * preserved. Cannot be deleted while referenced by a certificate profile
 * (InvalidReferenceException).
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
  noun: 'terms_of_service',
  nounPlural: 'terms_of_services',
  label: 'Terms of Service',
  routeCollection: '/api/v1/system/terms-of-services',
  routeItem: '/api/v1/system/terms-of-services/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

const localizedString = z.object({
  lang: z.string().describe('Language code, e.g. "en", "fr".'),
  value: z.string().describe('Localized Terms of Service content (markdown).'),
});

const contentsSchema = z
  .array(localizedString)
  .min(1)
  .describe(
    'Localized Terms of Service contents, one entry per language (markdown, ' +
      'server-validated). Must contain at least one entry.',
  );

const CREATE_TERMS_OF_SERVICE_SCHEMA = z.object({
  name: z
    .string()
    .describe('ToS name. Immutable primary key (the update lookup key).'),
  contents: contentsSchema,
  description: z
    .string()
    .optional()
    .describe('Optional free-text description.'),
});

const UPDATE_TERMS_OF_SERVICE_SCHEMA = z.object({
  name: z.string().describe('ToS name to update (immutable key).'),
  contents: contentsSchema.optional(),
  description: z
    .string()
    .optional()
    .describe('Optional free-text description.'),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe('Top-level fields to explicitly null, e.g. ["description"].'),
});

export function registerTermsOfServiceTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List Terms of Service entries. A ToS entry can be required for ' +
      'acceptance during certificate enrollment (referenced by certificate profiles).',
    getDescription: 'Get a single Terms of Service entry by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a Terms of Service entry that enrollment workflows can require ' +
      'users to accept. contents holds the localized markdown text.',
    mandatoryFields: ['name', 'contents'],
    inputSchema: CREATE_TERMS_OF_SERVICE_SCHEMA,
    buildPayload: ({ name, contents, description }) => {
      const body: Record<string, unknown> = { name, contents };
      if (description !== undefined) body['description'] = description;
      return body;
    },
  });

  registerUpdateTool(server, client, SPEC, {
    description: 'Update an existing Terms of Service entry.',
    inputSchema: UPDATE_TERMS_OF_SERVICE_SCHEMA,
    buildOverrides: ({ contents, description }) => {
      const o: Record<string, unknown> = {};
      if (contents !== undefined) o['contents'] = contents;
      if (description !== undefined) o['description'] = description;
      return o;
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a Terms of Service entry.',
    deleteConstraints:
      'Cannot be deleted while referenced by a certificate profile ' +
      '(InvalidReferenceException).',
  });
}
