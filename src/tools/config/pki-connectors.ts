/**
 * PKI connector configuration tools (complex / polymorphic).
 *
 * 6 tools: describe-schema / list / get / create / update / delete.
 * Contract: docs/audit/pki_connectors.contract.json (+ pki_connectors.schema.json),
 * traced to PKIConnectorApiV1Controller.scala / ConnectorConfig.scala /
 * PKIConnectorType.scala.
 *
 * The request body is a polymorphic union discriminated by the lowercase 'type'
 * field (22 subtypes). Because the per-subtype shape is large and varies wildly,
 * create/update take the two common mandatory params (name + type) as typed Zod
 * fields plus a validated `config` object holding the subtype-specific keys. The
 * model is expected to call describe_pki_connector_schema first to learn the
 * exact structure for its chosen subtype, then never guess.
 *
 * Route: /api/v1/pki/connectors. Update PUTs the COLLECTION root (body-keyed
 * full-replace, target identified by 'name'); the wrapper does GET-merge so
 * omitted fields are preserved. Subtype (type) cannot change after creation.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { HorizonError } from '../../client/errors.js';
import type { HorizonClient } from '../../client/http.js';
import {
  type ConfigSpec,
  assertConfigBody,
  registerCreateTool,
  registerDeleteTool,
  registerDescribeSchemaTool,
  registerReadTools,
  registerUpdateTool,
} from './_scaffold.js';
import { pkiConnectorRequestSchema } from './schemas/pki-connectors.schema.js';

const SPEC: ConfigSpec = {
  noun: 'pki_connector',
  nounPlural: 'pki_connectors',
  label: 'PKI connector',
  routeCollection: '/api/v1/pki/connectors',
  routeItem: '/api/v1/pki/connectors/{name}',
  idField: 'name',
  immutableKeys: ['name', 'type'],
  stripFields: ['_id', 'status', 'tenant', 'account', 'accountUrl'],
  putOnCollection: true,
};

/** Discriminator literals (lowercase). Subtype === connector kind. */
const CONNECTOR_TYPES = [
  'stream',
  'acmeenroll',
  'acmerevoke',
  'evtadcs',
  'awsacmpca',
  'certeurope',
  'cmp',
  'digicert',
  'ejbca',
  'ejbca_rest',
  'idca',
  'integrated',
  'fcms',
  'gcp',
  'gsatlas',
  'gsmssl',
  'otpki',
  'metapki',
  'nameshield',
  'nexuscm',
  'sectigo',
  'swisssign',
] as const;

const ASYNC_CONNECTOR_TYPES = [
  'digicert',
  'acmeenroll',
  'integrated',
  'gsmssl',
  'gsatlas',
  'awsacmpca',
  'certeurope',
  'sectigo',
  'nameshield',
] as const;

const ASYNC_CONNECTOR_TYPE_SET = new Set<string>(ASYNC_CONNECTOR_TYPES);
const POSITIVE_FINITE_DURATION =
  /^(0*[1-9][0-9]*) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$/;

const SCHEMA_VERSION = 'pki_connectors.request.json';

/**
 * Union of every subtype's top-level property keys (from the resolved schema).
 * Used by assertConfigBody to reject obviously unknown top-level fields. Deep
 * per-subtype validation is delegated to Horizon (precise server errors).
 */
const KNOWN_KEYS = [
  'name',
  'type',
  'proxy',
  'queue',
  'timeout',
  'authenticationCredentials',
  'customConnectorDataMapping',
  'retryInterval',
  'endPoint',
  'template',
  'ca',
  'loginCredentials',
  'acmeDirectoryUrl',
  'eab',
  'eabMacAlgorithm',
  'accountKeyType',
  'accountEmail',
  'rotateAccount',
  'domainDictionaryProvider',
  'dnsChallengeProvider',
  'caConfig',
  'profile',
  'domain',
  'enrollmentCredentials',
  'region',
  'caArn',
  'accessCredentials',
  'templateArn',
  'roleArn',
  'validDays',
  'signingHash',
  'certificateUsage',
  'caPolicyOid',
  'offerId',
  'organizationId',
  'revReason',
  'issuerCADN',
  'issuerCACert',
  'signerCredentials',
  'emailMap',
  'sanDnsMap',
  'cnMap',
  'profileMap',
  'issuerMap',
  'legacyCMPStyle',
  'baseUrl',
  'productId',
  'apiCredentials',
  'caCertId',
  'skipApproval',
  'caName',
  'eeProfile',
  'caKey',
  'caCert',
  'crlPath',
  'crlLifetime',
  'certType',
  'signAlg',
  'crtLifetime',
  'crtBackDate',
  'checkPop',
  'asyncParams',
  'cryptoType',
  'templateId',
  'defaultOwner',
  'authenticationDomainId',
  'ownerGroups',
  'deleteOnRevoke',
  'hashAlgorithm',
  'endpointType',
  'domainId',
  'certificateValidity',
  'defaultEmail',
  'defaultPhone',
  'sanEmailMap',
  'uidMap',
  'zone',
  'zoneLabel',
  'endPointIssuingCA',
  'workflow',
  'profilCle',
  'formPorteurName',
  'environment',
  'customerId',
  'procedure',
  'customerUri',
  'mpkiCredentials',
  'productUuid',
] as const;

const configSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Subtype-specific fields as a flat object, using the EXACT camelCase keys ' +
      'from describe_pki_connector_schema for the chosen `type` (e.g. {endPoint, ' +
      'template, ca, loginCredentials} for stream). Do NOT include name/type ' +
      'here. Call describe_pki_connector_schema first - never guess the keys.',
  );

const nameSchema = z
  .string()
  .describe(
    'Connector name. Immutable primary key, server-validated against regex [0-9a-zA-Z-_.]+.',
  );
const typeSchema = z
  .enum(CONNECTOR_TYPES)
  .describe(
    'Connector subtype discriminator (lowercase). Determines which fields are ' +
      'required in `config`. Cannot change after creation.',
  );

/** Merge the typed mandatory params with the subtype config into one body. */
function mergeBody(
  name: string,
  type: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...config, name, type };
  assertConfigBody(body, {
    requiredKeys: ['name', 'type'],
    knownKeys: KNOWN_KEYS,
    enums: { type: CONNECTOR_TYPES },
  });
  validateRetryInterval(type, config);
  return body;
}

function validateRetryInterval(
  type: string,
  config: Record<string, unknown>,
): void {
  const retryInterval = config['retryInterval'];
  if (retryInterval === undefined) return;

  if (!ASYNC_CONNECTOR_TYPE_SET.has(type)) {
    throw new HorizonError(422, {
      errorCode: 'PKI-CONNECTOR-RETRY-INTERVAL-TYPE',
      message:
        'retryInterval is supported only for asynchronous PKI connector types: ' +
        `${ASYNC_CONNECTOR_TYPES.join(', ')}.`,
      remediation:
        'Remove retryInterval, or use it only with an asynchronous PKI connector.',
    });
  }

  if (
    typeof retryInterval !== 'string' ||
    !POSITIVE_FINITE_DURATION.test(retryInterval)
  ) {
    throw new HorizonError(422, {
      errorCode: 'PKI-CONNECTOR-RETRY-INTERVAL-FORMAT',
      message:
        'retryInterval must be a positive FiniteDuration string, for example "6 seconds".',
      remediation:
        'Use a positive integer with ms, seconds, minutes, hours, or days.',
    });
  }
}

const CREATE_PKI_CONNECTORS_SCHEMA = z.object({
  name: nameSchema,
  type: typeSchema,
  config: configSchema.optional(),
});

const UPDATE_PKI_CONNECTORS_SCHEMA = z.object({
  name: nameSchema,
  type: typeSchema,
  config: configSchema.optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe('Top-level fields to explicitly null, e.g. ["proxy"].'),
});

const CREATE_PKI_CONNECTOR_OPTS = {
  description:
    'Create a PKI connector: the backend Horizon uses to ISSUE/revoke ' +
    'certificates FROM an external CA. This is NOT publishing certs TO a ' +
    'system (use a third-party connector) and NOT the inbound device ' +
    'enrollment protocol (use a certificate profile). Polymorphic: the `type` discriminator ' +
    'selects the subtype (stream, acmeenroll, awsacmpca, digicert, ejbca, ' +
    'integrated, ...). Active Directory Certificate Services (ADCS / Microsoft ' +
    'CA) is a PKI connector: use type "evtadcs" (EverTrust ADCS connector) or ' +
    'legacy "msadcs" - NOT a WCCE forest mapping. Call ' +
    'describe_pki_connector_schema for the chosen type first to learn the ' +
    'exact required `config` fields - never guess.',
  mandatoryFields: ['name', 'type'],
  inputSchema: CREATE_PKI_CONNECTORS_SCHEMA,
  buildPayload: ({
    name,
    type,
    config,
  }: z.infer<typeof CREATE_PKI_CONNECTORS_SCHEMA>) =>
    mergeBody(name, type, config ?? {}),
  nextSteps:
    'A PKI connector is inert until a certificate profile issues through it. ' +
    'Ask the user which certificate profile(s) should use it, then set each ' +
    "profile's `pkiConnector` to this connector name via " +
    'update_certificate_profile (config field "pkiConnector"). Do not infer ' +
    'the profiles - ask the user.',
};

const UPDATE_PKI_CONNECTOR_OPTS = {
  description:
    'Update an existing PKI connector. The subtype (type) cannot change. ' +
    'Full-replace: omitted optional fields revert to defaults, so pass the ' +
    'complete `config` for the subtype (call describe_pki_connector_schema).',
  inputSchema: UPDATE_PKI_CONNECTORS_SCHEMA,
  buildOverrides: ({
    name,
    type,
    config,
  }: z.infer<typeof UPDATE_PKI_CONNECTORS_SCHEMA>) =>
    mergeBody(name, type, config ?? {}),
};

const PKI_CONNECTOR_DESCRIBE_INFO = {
  noun: 'pki_connector',
  label: 'PKI connector',
  discriminatorField: 'type',
  subtypes: CONNECTOR_TYPES,
  mandatoryFields: ['name', 'type'],
  jsonSchema: pkiConnectorRequestSchema,
  schemaVersion: SCHEMA_VERSION,
};

export function registerPkiConnectorTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerDescribeSchemaTool(server, PKI_CONNECTOR_DESCRIBE_INFO);

  registerReadTools(server, client, SPEC, {
    listDescription: 'List PKI connector configurations.',
    getDescription: 'Get a single PKI connector configuration by name.',
  });

  registerCreateTool(server, client, SPEC, CREATE_PKI_CONNECTOR_OPTS);

  registerUpdateTool(server, client, SPEC, UPDATE_PKI_CONNECTOR_OPTS);

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a PKI connector configuration.',
    deleteConstraints:
      'Cannot be deleted while referenced by any certificate profile ' +
      '(pkiConnector) - returns PkiConnector005. Returns PkiConnector003 if not found.',
  });
}
