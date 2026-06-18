/**
 * Third-party connector configuration tools (complex / polymorphic).
 *
 * 6 tools: list / get / describe_schema / create / update / delete.
 * Contract: docs/audit/thirdparty_connectors.contract.json (+
 * thirdparty_connectors.schema.json), traced to ThirdPartyConnector.scala,
 * ThirdPartyConnectorService.scala and the 11 subtype case classes.
 *
 * Polymorphic union discriminated by 'type' (11 subtypes: aws, akv, f5as3,
 * f5client, gcm, intune, intunepkcs, jamf, ldappub, msad, netscaler). Because
 * the per-subtype shape diverges wildly we use the describe + validated-body
 * pattern: create/update take the universally-mandatory typed params (type,
 * name, throttle_duration) plus a `config` object carrying the exact camelCase
 * subtype fields. The typed+config bodies are merged, asserted against the
 * resolved schema (assertConfigBody), then POSTed/PUT.
 *
 * Route: /api/v1/thirdparty/connectors. Update PUTs the COLLECTION root
 * (body-keyed full-replace); the body 'name' is the lookup key. The wrapper
 * does GET-strip-merge so omitted fields are preserved. stripFields =
 * [_id, tenant] (audited).
 *
 * Subtype rules enforced client-side (rest delegated to Horizon):
 *   - netscaler additionally requires `timeout` and `maxStoredCertificatePerHolder`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { HorizonError } from '../../client/errors.js';
import type { HorizonClient } from '../../client/http.js';
import { buildMutateResponse } from '../helpers.js';
import { registerTool } from '../register.js';
import {
  type ConfigSpec,
  assertConfigBody,
  getStripMergePutExplicit,
  registerDeleteTool,
  registerDescribeSchemaTool,
  registerReadTools,
} from './_scaffold.js';
import { thirdpartyConnectorRequestSchema } from './schemas/thirdparty-connectors.schema.js';

const SPEC: ConfigSpec = {
  noun: 'thirdparty_connector',
  nounPlural: 'thirdparty_connectors',
  label: 'third-party connector',
  routeCollection: '/api/v1/thirdparty/connectors',
  routeItem: '/api/v1/thirdparty/connectors/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id', 'type'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

const SCHEMA_VERSION = '2026-06-04';

const SUBTYPES = [
  'aws',
  'akv',
  'f5as3',
  'f5client',
  'gcm',
  'intune',
  'intunepkcs',
  'jamf',
  'ldappub',
  'msad',
  'netscaler',
] as const;
type Subtype = (typeof SUBTYPES)[number];

/** Universally-mandatory fields, supplied as typed params (camelCase keys). */
const TYPED_MANDATORY = ['type', 'name', 'throttleDuration'] as const;

/**
 * Per-subtype required keys + known keys, derived from the embedded resolved
 * schema $defs (single source of truth). The describe tool narrows to a subtype
 * with these same definitions.
 */
const DEFS = thirdpartyConnectorRequestSchema.$defs;
const SUBTYPE_DEF: Record<
  Subtype,
  { required: readonly string[]; known: readonly string[] }
> = {
  aws: {
    required: DEFS.AWSConnector.required,
    known: Object.keys(DEFS.AWSConnector.properties),
  },
  akv: {
    required: DEFS.AzureKeyVaultConnector.required,
    known: Object.keys(DEFS.AzureKeyVaultConnector.properties),
  },
  f5as3: {
    required: DEFS.F5AS3Connector.required,
    known: Object.keys(DEFS.F5AS3Connector.properties),
  },
  f5client: {
    required: DEFS.F5ClientConnector.required,
    known: Object.keys(DEFS.F5ClientConnector.properties),
  },
  gcm: {
    required: DEFS.GCMConnector.required,
    known: Object.keys(DEFS.GCMConnector.properties),
  },
  intune: {
    required: DEFS.IntuneConnector.required,
    known: Object.keys(DEFS.IntuneConnector.properties),
  },
  intunepkcs: {
    required: DEFS.IntunePKCSConnector.required,
    known: Object.keys(DEFS.IntunePKCSConnector.properties),
  },
  jamf: {
    required: DEFS.JamfConnector.required,
    known: Object.keys(DEFS.JamfConnector.properties),
  },
  ldappub: {
    required: DEFS.LDAPConnector.required,
    known: Object.keys(DEFS.LDAPConnector.properties),
  },
  msad: {
    required: DEFS.MSADConnector.required,
    known: Object.keys(DEFS.MSADConnector.properties),
  },
  netscaler: {
    required: DEFS.NetscalerConnector.required,
    known: Object.keys(DEFS.NetscalerConnector.properties),
  },
};

/** LDAP enums surfaced to assertConfigBody for the ldappub subtype. */
const LDAP_ENUMS: Record<string, readonly string[]> = {
  userIdentifierAttribute:
    DEFS.LDAPConnector.properties.userIdentifierAttribute.enum,
  certificateAttribute: DEFS.LDAPConnector.properties.certificateAttribute.enum,
};

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

/**
 * Merge the typed mandatory params with the free-form config object into the
 * exact API body, then validate against the resolved schema for the subtype.
 */
function buildAndAssert(
  type: Subtype,
  name: string,
  throttleDuration: string,
  config: Record<string, unknown>,
  // On update the body is a GET-strip-merge full-replace: the stored record
  // supplies the subtype fields the caller omits, so only the discriminator +
  // id are required. Create requires the full per-subtype set.
  requireFull = true,
): Record<string, unknown> {
  if (config['type'] !== undefined && config['type'] !== type) {
    throw new HorizonError(422, {
      errorCode: 'CONFIG-DISCRIMINATOR-CONFLICT',
      message: `config.type='${String(config['type'])}' conflicts with type='${type}'. Omit 'type' from config; it is set from the typed parameter.`,
    });
  }
  const body: Record<string, unknown> = {
    ...config,
    type,
    name,
    throttleDuration,
  };
  const def = SUBTYPE_DEF[type];
  assertConfigBody(body, {
    requiredKeys: requireFull ? def.required : ['type', 'name'],
    knownKeys: def.known,
    enums: type === 'ldappub' ? LDAP_ENUMS : { type: SUBTYPES },
  });
  return body;
}

const subtypeParam = z
  .enum(SUBTYPES)
  .describe(
    'Connector subtype discriminator (immutable). One of: aws, akv, f5as3, ' +
      'f5client, gcm, intune, intunepkcs, jamf, ldappub, msad, netscaler.',
  );
const nameParam = z
  .string()
  .describe(
    'Connector name. Immutable primary key (unique index name_idx); cannot change after creation.',
  );
const throttleDurationParam = z
  .string()
  .describe(
    'FiniteDuration, e.g. "5 seconds". Throttle window. Required on every subtype, must be > 0.',
  );
const configParam = z
  .record(z.string(), z.unknown())
  .describe(
    'Subtype-specific fields in their exact camelCase API keys (e.g. ' +
      'throttleParallelism, timeout, credentials, hostname, maxStoredCertificatePerHolder). ' +
      'Do NOT repeat type/name/throttleDuration here. Call describe_thirdparty_connector_schema ' +
      'with the subtype FIRST to learn the required + allowed fields - never guess.',
  );

export function registerThirdpartyConnectorTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List third-party connectors (MDM/PKI publishing targets).',
    getDescription: 'Get a single third-party connector by name.',
  });

  registerDescribeSchemaTool(server, {
    noun: SPEC.noun,
    label: SPEC.label,
    discriminatorField: 'type',
    subtypes: SUBTYPES,
    mandatoryFields: TYPED_MANDATORY,
    jsonSchema: thirdpartyConnectorRequestSchema,
    schemaVersion: SCHEMA_VERSION,
  });

  registerTool(
    server,
    `create_${SPEC.noun}`,
    {
      description:
        'Create a third-party connector: an OUTBOUND publishing target that ' +
        'pushes ALREADY-ISSUED certificates TO an external system (AWS ACM, ' +
        'Azure Key Vault, F5, Google Cert Manager, Intune/JAMF MDM, LDAP/MSAD ' +
        'directory, Netscaler). It does NOT issue certificates from a CA (use a ' +
        'PKI connector, create_pki_connector) and is NOT how a device enrolls ' +
        '(use a certificate profile, create_certificate_profile). Polymorphic ' +
        'by `type`: the ' +
        'required and allowed fields depend on the subtype. Call ' +
        'describe_thirdparty_connector_schema (optionally with the subtype) FIRST ' +
        'to learn the structure - never guess.\n' +
        'Safety tier: mutating-safe\n' +
        'IMMUTABLE: type and name cannot change after creation - ask the user for ' +
        'both, never infer them.\n' +
        'MANDATORY (all subtypes): type, name, throttle_duration. netscaler also ' +
        'requires config.timeout and config.maxStoredCertificatePerHolder. Other ' +
        'per-subtype mandatory fields are enforced from the resolved schema - do ' +
        'not infer values, ask the user.',
      inputSchema: z.object({
        type: subtypeParam,
        name: nameParam,
        throttle_duration: throttleDurationParam,
        config: configParam,
      }),
    },
    async ({ type, name, throttle_duration, config }) => {
      const body = buildAndAssert(type, name, throttle_duration, config);
      const result = await client.post<Record<string, unknown>>(
        SPEC.routeCollection,
        body,
      );
      return text(
        buildMutateResponse({
          action: 'created',
          kind: SPEC.noun,
          name,
          data: result,
          nextSteps:
            'A third-party connector only publishes when a trigger of the same ' +
            'type references it and that trigger is bound to a certificate ' +
            'profile. Ask the user which certificate profile(s) and which ' +
            'lifecycle events (enroll, revoke, renew) should publish, then ' +
            `create a trigger (create_trigger, type "${type}", ` +
            `config.connector "${name}") and bind it on each profile via ` +
            'update_certificate_profile ' +
            '(config.triggers.onEnroll / onRevoke / onRenew). Do not infer - ' +
            'ask the user.',
        }),
      );
    },
  );

  registerTool(
    server,
    `update_${SPEC.noun}`,
    {
      description:
        'Update an existing third-party connector. PUT on the collection root ' +
        '(body-keyed full-replace): the body is built from GET (current) minus ' +
        'server fields, then your typed params + config are merged over it, then ' +
        'the merged body is re-validated against the subtype schema. `type` cannot ' +
        'change. Call describe_thirdparty_connector_schema FIRST.\n' +
        'Safety tier: mutating-safe\n' +
        'MANDATORY: type, name, throttle_duration. Subtype-specific fields you ' +
        'omit are preserved from the stored connector (GET-merge); pass them in ' +
        'config only to change them.',
      inputSchema: z.object({
        type: subtypeParam,
        name: nameParam,
        throttle_duration: throttleDurationParam,
        config: configParam,
        clear_fields: z
          .array(z.string())
          .optional()
          .describe(
            'Top-level fields to explicitly null before merge, e.g. ["proxy"]. ' +
              'Only nullable fields can be cleared.',
          ),
      }),
    },
    async ({ type, name, throttle_duration, config, clear_fields }) => {
      const overrides = buildAndAssert(
        type,
        name,
        throttle_duration,
        config,
        false,
      );
      const result = await getStripMergePutExplicit(
        client,
        SPEC.routeItem!.replace('{name}', encodeURIComponent(name)),
        SPEC.routeCollection,
        SPEC.stripFields,
        overrides,
        clear_fields,
        { immutableKeys: SPEC.immutableKeys, idField: SPEC.idField },
      );
      return text(
        buildMutateResponse({
          action: 'updated',
          kind: SPEC.noun,
          name,
          data: result,
        }),
      );
    },
  );

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a third-party connector.',
    deleteConstraints:
      'Cannot be deleted (400 ThirdpartyConnector005) while referenced by an ' +
      'MDM/third-party certificate profile, a third-party scheduled task, or any ' +
      'trigger. 404 (ThirdpartyConnector003) if not found.',
  });
}
