/**
 * Certificate label configuration tools (flat, fully typed).
 *
 * 5 tools: list / get / create / update / delete.
 * Contract: docs/audit/certificate_labels.contract.json (+ .schema.json),
 * traced to CertificateLabelApiV1Controller.scala / Label.scala /
 * LabelService.scala / DotlessNameIdentifier.scala / LocalizedString.scala.
 *
 * Route: /api/v1/certificate/labels. Update PUTs the COLLECTION root (body-keyed
 * full-replace: the name to update is taken from the request body, not the URL);
 * the wrapper does GET-merge so omitted optional fields are preserved. `name` is
 * the immutable primary key (regex [0-9a-zA-Z-_]+, NO dots). The server strips
 * `_id` on input and re-assigns it server-side, so it must never be sent.
 *
 * displayName and description are localized-string arrays ({lang, value}); both
 * are optional/nullable (omission yields None).
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
  noun: 'certificate_label',
  nounPlural: 'certificate_labels',
  label: 'certificate label',
  routeCollection: '/api/v1/certificate/labels',
  routeItem: '/api/v1/certificate/labels/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id'],
  putOnCollection: true,
};

const localizedStringSchema = z
  .array(z.object({ lang: z.string(), value: z.string() }))
  .describe(
    "Localized strings, e.g. [{lang: 'en', value: 'Business Unit'}]. lang is an " +
      'ISO 3166-1 two-letter code.',
  );

const CREATE_CERTIFICATE_LABELS_SCHEMA = z.object({
  name: z
    .string()
    .describe(
      'Technical name of the label. Immutable primary key, server-validated ' +
        'against regex [0-9a-zA-Z-_]+ (alphanumeric, hyphen, underscore; NO dots).',
    ),
  display_name: localizedStringSchema
    .optional()
    .describe('Localized display names of the label.'),
  description: localizedStringSchema
    .optional()
    .describe('Localized descriptions of the label.'),
});

const UPDATE_CERTIFICATE_LABELS_SCHEMA = z.object({
  name: z.string().describe('Label name to update (immutable key).'),
  display_name: localizedStringSchema.optional(),
  description: localizedStringSchema.optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe(
      'Top-level fields to explicitly null, e.g. ["displayName","description"].',
    ),
});

export function registerCertificateLabelTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: 'List certificate label configurations.',
    getDescription: 'Get a single certificate label configuration by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a certificate label used to tag/categorize certificates ' +
      '(referenced by certificate profiles and PKI connectors).',
    mandatoryFields: ['name'],
    inputSchema: CREATE_CERTIFICATE_LABELS_SCHEMA,
    buildPayload: ({ name, display_name, description }) => {
      const body: Record<string, unknown> = { name };
      if (display_name !== undefined) body['displayName'] = display_name;
      if (description !== undefined) body['description'] = description;
      return body;
    },
  });

  registerUpdateTool(server, client, SPEC, {
    description: 'Update an existing certificate label configuration.',
    inputSchema: UPDATE_CERTIFICATE_LABELS_SCHEMA,
    buildOverrides: ({ display_name, description }) => {
      const o: Record<string, unknown> = {};
      if (display_name !== undefined) o['displayName'] = display_name;
      if (description !== undefined) o['description'] = description;
      return o;
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a certificate label configuration.',
    deleteConstraints:
      'Cannot be deleted while referenced by any certificate profile ' +
      '(profile.certificateTemplate.labels) or PKI connector ' +
      '(e.g. Digicert custom mapping / OTPKI serviceLabel) (CertLabel005).',
  });
}
