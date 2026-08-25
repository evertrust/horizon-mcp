/**
 * Certificate Profile configuration tools (polymorphic / "poly").
 *
 * 6 tools: list / get / create / update / delete / describe_certificate_profile_schema.
 * Contract: docs/audit/certificate_profiles.contract.json (+
 * certificate_profiles.schema.json), traced to
 * CertificateProfileApiV1Controller.scala / CertificateProfile.scala /
 * CertificateProfileCodec.scala.
 *
 * Polymorphic giant: one body shape per `module` (11 documented subtypes:
 * acme, acme-external, est, scep, wcce, webra, crmp, intune, intunepkcs, jamf,
 * monitored). Because the per-subtype structure is large and varies, create /
 * update take the typed mandatory params (module discriminator + name + enabled
 * + the four mandatory nested policy objects) plus a validated `config` record
 * for everything else; describe_certificate_profile_schema surfaces the full
 * resolved JSON Schema so the model never guesses the structure.
 *
 * Route: /api/v1/certificate/profiles. Update PUTs the COLLECTION root
 * (body-keyed full-replace, target resolved from body `name`); the wrapper does
 * GET-strip-merge so omitted fields are preserved. stripFields = [_id, tenant]
 * (audited). name and module are immutable after creation.
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
  registerUpdateTool,
} from './_scaffold.js';
import { certificateProfileRequestSchema } from './schemas/certificate-profiles.schema.js';

const SPEC: ConfigSpec = {
  noun: 'certificate_profile',
  nounPlural: 'certificate_profiles',
  label: 'certificate profile',
  routeCollection: '/api/v1/certificate/profiles',
  routeItem: '/api/v1/certificate/profiles/{name}',
  idField: 'name',
  immutableKeys: ['name', 'module'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

/** The 11 documented `module` discriminators (lowercase). */
const MODULES = [
  'acme',
  'acme-external',
  'est',
  'scep',
  'wcce',
  'webra',
  'crmp',
  'intune',
  'intunepkcs',
  'jamf',
  'monitored',
] as const;

const TERMS_OF_SERVICE_MODULES = ['webra', 'scep', 'est'] as const;

const SUBTYPES = [
  'AcmeProfile',
  'AcmeExternalProfile',
  'EstProfile',
  'ScepProfile',
  'WcceProfile',
  'WebRAProfile',
  'CrmpProfile',
  'IntuneProfile',
  'IntunePKCSProfile',
  'JamfProfile',
  'MonitoredProfile',
] as const;

/**
 * Top-level mandatory keys common to (nearly) every subtype, per the audited
 * contract `mandatoryFields`. assertConfigBody enforces these are present on the
 * merged body. Subtype-specific mandatory fields (e.g. pkiConnector, ca,
 * authorizationMode) are validated by Horizon and surfaced as precise errors.
 */
const MANDATORY_KEYS = [
  'module',
  'name',
  'enabled',
  'authorizationLevels',
  'requestsPolicy',
  'selfPermissions',
  'cryptoPolicy',
] as const;

/** Snake_case input names the user types for the mandatory fields. */
const MANDATORY_INPUT_FIELDS = [
  'module',
  'name',
  'enabled',
  'authorization_levels',
  'requests_policy',
  'self_permissions',
  'crypto_policy',
] as const;

/** Union of every top-level property key across all 11 subtypes (53 keys). */
const KNOWN_KEYS = [
  'acmeUrl',
  'authorizationLevels',
  'authorizationMethods',
  'authorizationMode',
  'authorizeEmptyContact',
  'authorizeShortName',
  'authorizedCas',
  'autoRenewalPolicy',
  'ca',
  'caps',
  'certificateTemplate',
  'constraints',
  'cryptoPolicy',
  'csrDataMapping',
  'dataFieldIdentifier',
  'defaultContacts',
  'description',
  'deviceIdField',
  'deviceIdSeparator',
  'displayName',
  'dnWhitelist',
  'dsFlow',
  'enabled',
  'encryptionAlgorithm',
  'enrollAuthorizedCas',
  'exchangeCertificate',
  'gradingPolicies',
  'http01Port',
  'maxCertificatePerHolderPolicy',
  'maxDnsName',
  'meta',
  'mode',
  'module',
  'name',
  'passwordPolicy',
  'pkiConnector',
  'postPKIOperation',
  'proxy',
  'renewalAuthorizedCas',
  'renewalPeriod',
  'requestsPolicy',
  'requireEAB',
  'requireTermsOfService',
  'scepRA',
  'selfPermissions',
  'thirdPartyConnector',
  'thirdPartyDiscoverySync',
  'termsOfService',
  'timeout',
  'tlsAlpn01Port',
  'triggers',
  'validationRuleset',
  'verifyRetryCount',
  'verifyRetryDelay',
] as const;

const objectRecord = z.record(z.string(), z.unknown());

const AUTO_RENEWAL_POLICY_SCHEMA = z
  .object({
    default: z
      .boolean()
      .describe('Default auto-renew value for new certificates.'),
    editable: z
      .boolean()
      .describe('Whether a certificate auto-renew value can be changed.'),
  })
  .describe(
    'WebRA auto-renewal policy. Server-side transitions: adding the policy ' +
      'where none existed bulk-sets existing certificates to the new default; ' +
      "removing it disables auto-renew on all the profile's certificates; " +
      'changing an existing policy does not bulk-rewrite existing flags.',
  );

function assertTypedAutoRenewalPolicy(
  config: Record<string, unknown> | undefined,
): void {
  if (config?.['autoRenewalPolicy'] !== undefined) {
    throw new Error(
      'Pass autoRenewalPolicy through the typed auto_renewal_policy field, not config.',
    );
  }
}

function assertTypedTermsOfService(
  config: Record<string, unknown> | undefined,
): void {
  if (config?.['termsOfService'] !== undefined) {
    throw new Error(
      'Pass termsOfService through the typed terms_of_service field, not config.',
    );
  }
}

function assertTermsOfServiceModule(body: Record<string, unknown>): void {
  const module = body['module'] as (typeof TERMS_OF_SERVICE_MODULES)[number];
  if (
    body['termsOfService'] !== undefined &&
    !TERMS_OF_SERVICE_MODULES.includes(module)
  ) {
    throw new Error(
      'terms_of_service is accepted only for profile modules: webra, scep, est.',
    );
  }
}

/**
 * Merge the typed mandatory params (snake_case -> camelCase) and the free-form
 * `config` record into a single body, then assert mandatory/known/enum rules.
 */
function buildProfileBody(args: {
  module?: string;
  name?: string;
  enabled?: boolean;
  authorization_levels?: Record<string, unknown>;
  requests_policy?: Record<string, unknown>;
  self_permissions?: Record<string, unknown>;
  crypto_policy?: Record<string, unknown>;
  auto_renewal_policy?: { default: boolean; editable: boolean };
  terms_of_service?: string;
  config?: Record<string, unknown>;
}): Record<string, unknown> {
  assertTypedAutoRenewalPolicy(args.config);
  assertTypedTermsOfService(args.config);
  const body: Record<string, unknown> = { ...(args.config ?? {}) };
  if (args.module !== undefined) body['module'] = args.module;
  if (args.name !== undefined) body['name'] = args.name;
  if (args.enabled !== undefined) body['enabled'] = args.enabled;
  if (args.authorization_levels !== undefined)
    body['authorizationLevels'] = args.authorization_levels;
  if (args.requests_policy !== undefined)
    body['requestsPolicy'] = args.requests_policy;
  if (args.self_permissions !== undefined)
    body['selfPermissions'] = args.self_permissions;
  if (args.crypto_policy !== undefined)
    body['cryptoPolicy'] = args.crypto_policy;
  if (args.auto_renewal_policy !== undefined)
    body['autoRenewalPolicy'] = args.auto_renewal_policy;
  if (args.terms_of_service !== undefined)
    body['termsOfService'] = args.terms_of_service;
  return body;
}

function assertProfileBody(body: Record<string, unknown>): void {
  assertConfigBody(body, {
    requiredKeys: MANDATORY_KEYS,
    knownKeys: KNOWN_KEYS,
    enums: { module: MODULES },
  });
  assertTermsOfServiceModule(body);
}

/**
 * Update is a partial GET-strip-merge-PUT: mandatory fields come from the stored
 * profile, so we do NOT require them on the override body. We still validate the
 * supplied keys (unknown top-level fields, bad `module` enum) so an LLM typo in
 * `config` is rejected before it is merged into the PUT.
 */
function assertProfileUpdateBody(body: Record<string, unknown>): void {
  assertConfigBody(body, {
    requiredKeys: [],
    knownKeys: KNOWN_KEYS,
    enums: { module: MODULES },
  });
}

const CREATE_CERTIFICATE_PROFILES_SCHEMA = z.object({
  module: z
    .enum(MODULES)
    .describe(
      'Profile protocol/subtype discriminator (lowercase). Immutable after creation.',
    ),
  name: z
    .string()
    .describe(
      'Profile name. Immutable primary key. Ask the user - never invent it.',
    ),
  enabled: z.boolean().describe('Whether the profile is enabled.'),
  authorization_levels: objectRecord.describe(
    'CertificateProfileAuthorizationLevels object (per-action access levels). ' +
      'See describe_certificate_profile_schema for the structure.',
  ),
  requests_policy: objectRecord.describe(
    'RequestsPolicy object (per-action request lifetimes).',
  ),
  self_permissions: objectRecord.describe(
    'CertificateProfileSelfPermissions object (self-service flags).',
  ),
  crypto_policy: objectRecord.describe(
    'Crypto policy object (key types, escrow, P12 handling).',
  ),
  auto_renewal_policy: AUTO_RENEWAL_POLICY_SCHEMA.optional(),
  terms_of_service: z
    .string()
    .optional()
    .describe(
      'Name of a Terms of Service object for webra, scep, or est profiles only. ' +
        'This is not ACME requireTermsOfService. Manage the referenced object ' +
        'with create_terms_of_service/update_terms_of_service; deletion is ' +
        'guarded while a profile references it.',
    ),
  config: objectRecord
    .optional()
    .describe(
      'All other subtype-specific top-level fields (e.g. pkiConnector, ca, ' +
        'mode, scepRA, caps, authorizationMode, certificateTemplate, ' +
        'displayName, triggers, gradingPolicies). Keys must be the exact ' +
        'camelCase API names from describe_certificate_profile_schema. Pass ' +
        'autoRenewalPolicy through auto_renewal_policy and termsOfService through ' +
        'terms_of_service, not config.',
    ),
});

const UPDATE_CERTIFICATE_PROFILES_SCHEMA = z.object({
  name: z.string().describe('Profile name to update (immutable lookup key).'),
  enabled: z.boolean().optional().describe('Whether the profile is enabled.'),
  authorization_levels: objectRecord
    .optional()
    .describe('CertificateProfileAuthorizationLevels object.'),
  requests_policy: objectRecord.optional().describe('RequestsPolicy object.'),
  self_permissions: objectRecord
    .optional()
    .describe('CertificateProfileSelfPermissions object.'),
  crypto_policy: objectRecord.optional().describe('Crypto policy object.'),
  auto_renewal_policy: AUTO_RENEWAL_POLICY_SCHEMA.optional(),
  terms_of_service: z
    .string()
    .optional()
    .describe(
      'Name of a Terms of Service object for webra, scep, or est profiles only. ' +
        'This is not ACME requireTermsOfService. Manage the referenced object ' +
        'with create_terms_of_service/update_terms_of_service; deletion is ' +
        'guarded while a profile references it.',
    ),
  config: objectRecord
    .optional()
    .describe(
      'Other subtype-specific top-level fields to override (exact camelCase ' +
        'API names from describe_certificate_profile_schema). Pass ' +
        'autoRenewalPolicy through auto_renewal_policy and termsOfService through ' +
        'terms_of_service, not config. module is immutable.',
    ),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe(
      'Top-level fields to explicitly null, e.g. ["proxy","gradingPolicies"].',
    ),
});

const CERTIFICATE_PROFILE_DESCRIBE_INFO = {
  noun: SPEC.noun,
  label: SPEC.label,
  discriminatorField: 'module',
  subtypes: SUBTYPES,
  mandatoryFields: MANDATORY_INPUT_FIELDS,
  jsonSchema: certificateProfileRequestSchema,
  schemaVersion: '2020-12',
  knowledgeRef: 'horizon://knowledge/certificate-profiles',
};

export function registerCertificateProfileTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerDescribeSchemaTool(server, CERTIFICATE_PROFILE_DESCRIBE_INFO);

  registerReadTools(server, client, SPEC, {
    listDescription:
      'List certificate profiles (enrollment/management policies).',
    getDescription: 'Get a single certificate profile by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a certificate profile: the enrollment policy and inbound PROTOCOL ' +
      'clients use to enroll AGAINST Horizon (the `module` is the protocol/MDM: ' +
      'acme/est/scep/wcce/intune/jamf/webra...). This is NOT a backend CA that ' +
      'issues certs (use a PKI connector, create_pki_connector) and NOT a target ' +
      'to publish certs to (use a third-party connector, ' +
      'create_thirdparty_connector). Polymorphic by `module` (one of: ' +
      `${MODULES.join(', ')}). Call describe_certificate_profile_schema FIRST to ` +
      'see the exact required structure for the chosen module, then pass the ' +
      'subtype-specific fields in `config`.',
    mandatoryFields: MANDATORY_INPUT_FIELDS,
    inputSchema: CREATE_CERTIFICATE_PROFILES_SCHEMA,
    buildPayload: (args) => {
      const body = buildProfileBody(args);
      assertProfileBody(body);
      return body;
    },
  });

  registerUpdateTool(server, client, SPEC, {
    description:
      'Update an existing certificate profile (full-replace of the body). ' +
      'module cannot change. Call describe_certificate_profile_schema FIRST.',
    inputSchema: UPDATE_CERTIFICATE_PROFILES_SCHEMA,
    buildOverrides: (args) => {
      const { name: _name, clear_fields: _clear, ...rest } = args;
      const body = buildProfileBody(rest);
      assertProfileUpdateBody(body);
      return body;
    },
    validateMergedBody: assertTermsOfServiceModule,
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a certificate profile.',
    deleteConstraints:
      'Cascades deletion of associated role permissions, principal permissions, ' +
      'referenced requests, and third-party scheduled tasks. Fails with ' +
      'CertificateProfile006 (403) on an invalid reference.',
  });
}
