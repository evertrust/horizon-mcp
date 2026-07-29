/**
 * Service account configuration tools (READ-ONLY).
 *
 * 2 tools: list / get. Service accounts are a deliberately read-only surface in
 * this MCP server: they are part of the identity / access boundary that is not
 * exposed for mutation by an LLM. These tools let a model inspect service-account
 * configuration - including the 2.10 federated-authentication `trustConfig`
 * (e.g. dynamic_jwks / static JWKS trust), validation rules, permissions and
 * roles - without being able to create, update or delete them.
 *
 * Source: models/security/serviceaccount/ServiceAccount.scala +
 * TrustConfig.scala + ServiceAccountApiV1Controller.scala.
 * Route: /api/v1/security/service-accounts, item /{name}.
 */
import type { McpServer } from '@modelcontextprotocol/server';

import type { HorizonClient } from '../../client/http.js';
import { type ConfigSpec, registerReadTools } from './_scaffold.js';

const SPEC: ConfigSpec = {
  noun: 'service_account',
  nounPlural: 'service_accounts',
  label: 'service account',
  routeCollection: '/api/v1/security/service-accounts',
  routeItem: '/api/v1/security/service-accounts/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: false,
};

export function registerServiceAccountTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List service accounts. READ-ONLY: service accounts are part of the ' +
      'identity/access surface and cannot be created, updated or deleted via ' +
      'this MCP server. Each entry exposes its federated-auth trustConfig ' +
      '(e.g. dynamic_jwks JWKS trust), validationRules, permissions and roles.',
    getDescription:
      'Get a single service account by name, including its trustConfig (JWKS / ' +
      'federated authentication), validationRules, permissions and roles.',
  });
}
