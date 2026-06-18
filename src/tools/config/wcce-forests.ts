/**
 * WCCE forest mapping configuration tools (typed).
 *
 * 5 tools: list / get / create / update / delete.
 * Contract: docs/audit/wcce_forests.contract.json (+ wcce_forests.schema.json),
 * traced to WcceForestMapping.scala / WcceTemplateMapping.scala /
 * WcceForestMappingApiV1Controller.scala.
 *
 * Primary key is `forest` (NOT name). The item route /api/v1/wcce/forests/{name}
 * binds {name} to the `forest` value (GET/DELETE). Update PUTs the COLLECTION
 * root (body-keyed full-replace, located by `forest`); the wrapper does
 * GET-merge so omitted fields are preserved.
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
  noun: 'wcce_forest',
  nounPlural: 'wcce_forests',
  label: 'WCCE forest mapping',
  routeCollection: '/api/v1/wcce/forests',
  routeItem: '/api/v1/wcce/forests/{name}',
  idField: 'forest',
  immutableKeys: ['forest'],
  stripFields: ['_id'],
  putOnCollection: true,
};

const ENROLLMENT_MODES = ['entity', 'eobo', 'trust_request'] as const;
const TEMPLATE_VERSIONS = ['v1', 'v2'] as const;

/** Snake_case input shape for a single template->profile mapping. */
const templateMappingSchema = z.object({
  template: z
    .string()
    .describe(
      'Microsoft certificate template name. Regex [0-9a-zA-Z-_ ] (spaces allowed). Must be unique within the array.',
    ),
  profile: z
    .string()
    .describe(
      'Name of an existing Horizon certificate profile. Must exist and belong to the WCCE module.',
    ),
  enrollment_mode: z
    .enum(ENROLLMENT_MODES)
    .describe(
      'Enrollment mode: entity, eobo (on-behalf-of), or trust_request.',
    ),
  eobo_trusted_cas: z
    .array(z.string())
    .optional()
    .describe('Trusted CA names used in eobo (on-behalf-of) mode.'),
  template_version: z
    .enum(TEMPLATE_VERSIONS)
    .optional()
    .describe(
      'Microsoft template version (default v1). Available from Horizon 2.8.1.',
    ),
});

type TemplateMappingInput = z.infer<typeof templateMappingSchema>;

/** Map a snake_case template mapping input to the API camelCase object. */
function buildTemplateMapping(
  m: TemplateMappingInput,
): Record<string, unknown> {
  const o: Record<string, unknown> = {
    template: m.template,
    profile: m.profile,
    enrollmentMode: m.enrollment_mode,
  };
  if (m.eobo_trusted_cas !== undefined)
    o['eoboTrustedCas'] = m.eobo_trusted_cas;
  if (m.template_version !== undefined)
    o['templateVersion'] = m.template_version;
  return o;
}

function buildForestBody(args: {
  forest?: string;
  template_mappings?: TemplateMappingInput[];
}): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (args.forest !== undefined) o['forest'] = args.forest;
  if (args.template_mappings !== undefined)
    o['templateMappings'] = args.template_mappings.map(buildTemplateMapping);
  return o;
}

const templateMappingsDescribe =
  'Array of template->profile mappings (may be empty). Each: template, profile, enrollment_mode (required); eobo_trusted_cas, template_version (optional).';

export function registerWcceForestTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List WCCE forest mappings. These configure the INBOUND MS-WCCE protocol ' +
      '(Windows/AD clients enrolling AGAINST Horizon, e.g. auto-enrollment / ' +
      'certreq), mapping the certificate templates of an AD forest to Horizon ' +
      'profiles. NOT how Horizon connects to an ADCS CA - to issue certificates ' +
      'from Active Directory Certificate Services, use a PKI connector ' +
      '(create_pki_connector, type "evtadcs" or legacy "msadcs").',
    getDescription: 'Get a single WCCE forest mapping by forest name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a WCCE forest mapping for the INBOUND MS-WCCE protocol: it maps the ' +
      'certificate templates of an Active Directory forest to Horizon profiles ' +
      'so Windows/AD clients can enroll AGAINST Horizon. This is NOT how Horizon ' +
      'connects to an ADCS CA - issuing from Active Directory Certificate ' +
      'Services uses a PKI connector (create_pki_connector, type "evtadcs" or ' +
      'legacy "msadcs"), never a WCCE forest mapping.',
    mandatoryFields: ['forest', 'template_mappings'],
    inputSchema: z.object({
      forest: z
        .string()
        .describe(
          'AD forest name. Immutable primary key, server-validated against regex [0-9a-zA-Z-_.]+.',
        ),
      template_mappings: z
        .array(templateMappingSchema)
        .describe(templateMappingsDescribe),
    }),
    buildPayload: (args) => buildForestBody(args),
  });

  registerUpdateTool(server, client, SPEC, {
    description:
      'Update an existing WCCE forest mapping. Located by forest; PUT full-replace.',
    inputSchema: z.object({
      forest: z
        .string()
        .describe('Forest name to update (immutable key, locates the record).'),
      template_mappings: z
        .array(templateMappingSchema)
        .optional()
        .describe(templateMappingsDescribe),
      clear_fields: z
        .array(z.string())
        .optional()
        .describe('Top-level fields to explicitly null.'),
    }),
    buildOverrides: ({ template_mappings }) =>
      buildForestBody({ template_mappings }),
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a WCCE forest mapping by forest name.',
    deleteConstraints:
      'Cannot be deleted while the forest is referenced by an MSAD third-party ' +
      '(RACS) connector of type MSAD (WCCE-FOREST-006).',
  });
}
