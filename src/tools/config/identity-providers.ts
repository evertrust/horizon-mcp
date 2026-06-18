/**
 * Identity provider configuration tools (READ-ONLY).
 *
 * 2 tools: list / get. Identity providers are a deliberately read-only surface
 * in this MCP server: they are part of the identity / access boundary that is
 * not exposed for mutation by an LLM. These tools let a model inspect identity
 * provider configuration - including OpenID (OIDC) settings and the group-claim
 * / JIT-authorization mapping fields - without being able to create, update or
 * delete them.
 *
 * Source: models/security/identity/provider/* (IdentityProvider,
 * OidcIdentityProvider) + IdentityProviderApiV1Controller.scala.
 * Route: /api/v1/security/identity/providers, item /{name}.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { HorizonClient } from '../../client/http.js';
import { type ConfigSpec, registerReadTools } from './_scaffold.js';

const SPEC: ConfigSpec = {
  noun: 'identity_provider',
  nounPlural: 'identity_providers',
  label: 'identity provider',
  routeCollection: '/api/v1/security/identity/providers',
  routeItem: '/api/v1/security/identity/providers/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: false,
};

export function registerIdentityProviderTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List identity providers (Local / OpenID). READ-ONLY: identity providers ' +
      'are part of the identity/access surface and cannot be created, updated or ' +
      'deleted via this MCP server. OpenID entries expose their OIDC settings, ' +
      'claim mappings and group-claim / JIT-authorization configuration.',
    getDescription:
      'Get a single identity provider by name, including (for OpenID) its ' +
      'claim mappings and group-claim / JIT-authorization configuration.',
  });
}
