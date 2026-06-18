/**
 * Certificate Authority configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * Contract: docs/audit/cas.contract.json (+ cas.schema.json), traced to
 * CertificateAuthorityApiV1Controller.scala / CertificateAuthority.scala /
 * OutdatedRevocationStatusPolicy.scala.
 *
 * Route: /api/v1/cas. Update PUTs the COLLECTION root (body-keyed full-replace);
 * the body 'name' is the lookup key. The wrapper does GET-strip-merge so omitted
 * fields are preserved. stripFields = [_id, tenant] (audited). NOTE: 'certificate'
 * is REQUIRED on both create AND update (the request schema parses it), but on
 * update the server force-overrides it with the previously stored certificate -
 * we still send it because the schema requires it.
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
  noun: 'ca',
  nounPlural: 'cas',
  label: 'Certificate Authority',
  routeCollection: '/api/v1/cas',
  routeItem: '/api/v1/cas/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

const OUTDATED_REVOCATION_STATUS_POLICIES = [
  'revoked',
  'unknown',
  'lastavailablestatus',
] as const;

const optionalFields = {
  subject_key_identifier: z
    .string()
    .describe(
      'Server-populated from the certificate on upsert; any submitted value is ' +
        'overwritten. Read-only in practice - usually leave unset.',
    ),
  responder_url: z.string().describe('OCSP responder URL.'),
  crl_url: z
    .string()
    .describe(
      'CRL distribution URL. Server-validated: must start with http:// or ldap://.',
    ),
  refresh: z
    .string()
    .describe(
      'FiniteDuration, e.g. "1h". CRL refresh interval. Must not exceed ca.maximumRefresh.',
    ),
  timeout: z
    .string()
    .describe(
      'FiniteDuration, e.g. "30s". OCSP/CRL fetch timeout. Must not exceed ca.maximumTimeout.',
    ),
  proxy: z
    .string()
    .describe(
      'Name of an existing HTTP proxy configuration to use. Must pre-exist.',
    ),
  cache_time_to_idle: z
    .string()
    .describe('FiniteDuration. Cache time-to-idle for revocation status.'),
  downloadable: z
    .boolean()
    .describe('Whether the CA certificate is downloadable.'),
  identifier_mapping: z
    .string()
    .describe(
      'TemplateString. Principal identifier mapping for client auth. Default {{certificate.dn}}.',
    ),
  name_mapping: z
    .string()
    .describe(
      'TemplateString. Principal name mapping for client auth. Default {{certificate.subject.cn.1}}.',
    ),
  email_mapping: z
    .string()
    .describe(
      'TemplateString. Principal email mapping for client auth. Default {{certificate.san.rfc822name.1}}.',
    ),
};

function buildCaBody(args: {
  name?: string;
  certificate?: string;
  trusted_for_client_authentication?: boolean;
  trusted_for_server_authentication?: boolean;
  outdated_revocation_status_policy?: string;
  public?: boolean;
  subject_key_identifier?: string;
  responder_url?: string;
  crl_url?: string;
  refresh?: string;
  timeout?: string;
  proxy?: string;
  cache_time_to_idle?: string;
  downloadable?: boolean;
  identifier_mapping?: string;
  name_mapping?: string;
  email_mapping?: string;
}): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (args.name !== undefined) o['name'] = args.name;
  if (args.certificate !== undefined) o['certificate'] = args.certificate;
  if (args.trusted_for_client_authentication !== undefined)
    o['trustedForClientAuthentication'] =
      args.trusted_for_client_authentication;
  if (args.trusted_for_server_authentication !== undefined)
    o['trustedForServerAuthentication'] =
      args.trusted_for_server_authentication;
  if (args.outdated_revocation_status_policy !== undefined)
    o['outdatedRevocationStatusPolicy'] =
      args.outdated_revocation_status_policy;
  if (args.public !== undefined) o['public'] = args.public;
  if (args.subject_key_identifier !== undefined)
    o['subjectKeyIdentifier'] = args.subject_key_identifier;
  if (args.responder_url !== undefined) o['responderUrl'] = args.responder_url;
  if (args.crl_url !== undefined) o['crlUrl'] = args.crl_url;
  if (args.refresh !== undefined) o['refresh'] = args.refresh;
  if (args.timeout !== undefined) o['timeout'] = args.timeout;
  if (args.proxy !== undefined) o['proxy'] = args.proxy;
  if (args.cache_time_to_idle !== undefined)
    o['cacheTimeToIdle'] = args.cache_time_to_idle;
  if (args.downloadable !== undefined) o['downloadable'] = args.downloadable;
  if (args.identifier_mapping !== undefined)
    o['identifierMapping'] = args.identifier_mapping;
  if (args.name_mapping !== undefined) o['nameMapping'] = args.name_mapping;
  if (args.email_mapping !== undefined) o['emailMapping'] = args.email_mapping;
  return o;
}

export function registerCaTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: 'List Certificate Authorities.',
    getDescription: 'Get a single Certificate Authority by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a Certificate Authority (trusted CA certificate used for chain ' +
      'building, client/server authentication trust, and revocation checking).',
    mandatoryFields: [
      'name',
      'certificate',
      'trusted_for_client_authentication',
      'trusted_for_server_authentication',
      'outdated_revocation_status_policy',
      'public',
    ],
    inputSchema: z.object({
      name: z
        .string()
        .describe(
          'CA name. Immutable primary key, server-validated regex [0-9a-zA-Z-_ ]+ (no leading/trailing space).',
        ),
      certificate: z
        .string()
        .describe(
          'PEM-encoded X.509 CA certificate. Must be a CA cert (basicConstraints cA=true) with a thumbprint unique across existing CAs.',
        ),
      trusted_for_client_authentication: z
        .boolean()
        .describe(
          'Whether the CA is trusted for client (mTLS) authentication.',
        ),
      trusted_for_server_authentication: z
        .boolean()
        .describe('Whether the CA is trusted for server authentication.'),
      outdated_revocation_status_policy: z
        .enum(OUTDATED_REVOCATION_STATUS_POLICIES)
        .describe('Behaviour when revocation status cannot be obtained.'),
      public: z.boolean().describe('Whether the CA is public.'),
      subject_key_identifier: optionalFields.subject_key_identifier.optional(),
      responder_url: optionalFields.responder_url.optional(),
      crl_url: optionalFields.crl_url.optional(),
      refresh: optionalFields.refresh.optional(),
      timeout: optionalFields.timeout.optional(),
      proxy: optionalFields.proxy.optional(),
      cache_time_to_idle: optionalFields.cache_time_to_idle.optional(),
      downloadable: optionalFields.downloadable.optional(),
      identifier_mapping: optionalFields.identifier_mapping.optional(),
      name_mapping: optionalFields.name_mapping.optional(),
      email_mapping: optionalFields.email_mapping.optional(),
    }),
    buildPayload: (args) => buildCaBody(args),
  });

  registerUpdateTool(server, client, SPEC, {
    description:
      'Update an existing Certificate Authority. The CA certificate itself ' +
      'cannot be changed: the server keeps the previously stored certificate ' +
      'even though the value must still be sent.',
    inputSchema: z.object({
      name: z.string().describe('CA name to update (immutable lookup key).'),
      certificate: z
        .string()
        .describe(
          'PEM-encoded X.509 CA certificate. REQUIRED by the request schema even ' +
            'on update, but IGNORED: the server keeps the previously stored certificate.',
        ),
      trusted_for_client_authentication: z
        .boolean()
        .describe(
          'Whether the CA is trusted for client auth. Cannot be set to false while ' +
            'referenced as an authorized CA by an automation policy, EST profile, or ACME-External profile.',
        ),
      trusted_for_server_authentication: z
        .boolean()
        .describe('Whether the CA is trusted for server authentication.'),
      outdated_revocation_status_policy: z
        .enum(OUTDATED_REVOCATION_STATUS_POLICIES)
        .describe('Behaviour when revocation status cannot be obtained.'),
      public: z.boolean().describe('Whether the CA is public.'),
      subject_key_identifier: optionalFields.subject_key_identifier.optional(),
      responder_url: optionalFields.responder_url.optional(),
      crl_url: optionalFields.crl_url.optional(),
      refresh: optionalFields.refresh.optional(),
      timeout: optionalFields.timeout.optional(),
      proxy: optionalFields.proxy.optional(),
      cache_time_to_idle: optionalFields.cache_time_to_idle.optional(),
      downloadable: optionalFields.downloadable.optional(),
      identifier_mapping: optionalFields.identifier_mapping.optional(),
      name_mapping: optionalFields.name_mapping.optional(),
      email_mapping: optionalFields.email_mapping.optional(),
      clear_fields: z
        .array(z.string())
        .optional()
        .describe(
          'Top-level fields to explicitly null, e.g. ["responderUrl","proxy"].',
        ),
    }),
    buildOverrides: (args) => {
      const { name: _name, ...rest } = args;
      return buildCaBody(rest);
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a Certificate Authority.',
    deleteConstraints:
      'Cannot be deleted while referenced (CA-005) by an EST profile (ca / ' +
      'enrollAuthorizedCas / renewalAuthorizedCas), an automation policy ' +
      '(trustChains or compliancePolicy.authorizedCas), or a PKI connector. ' +
      'Requires CertificateAuthority:MANAGE permission.',
  });
}
