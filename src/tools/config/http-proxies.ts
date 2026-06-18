/**
 * HTTP proxy configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * Contract: docs/audit/http_proxies.contract.json (OpenAPI HttpProxy + Scala
 * HttpProxyApiV1Controller / HttpProxy.scala / WithHost.scala).
 *
 * Route: /api/v1/proxy/httpproxies. Update PUTs the COLLECTION root (body-keyed
 * full-replace); the wrapper does GET-merge so omitted fields are preserved.
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
  noun: 'http_proxy',
  nounPlural: 'http_proxies',
  label: 'HTTP proxy',
  routeCollection: '/api/v1/proxy/httpproxies',
  routeItem: '/api/v1/proxy/httpproxies/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id'],
  putOnCollection: true,
};

const nameSchema = z
  .string()
  .describe(
    'Proxy name. Immutable primary key, server-validated against regex [0-9a-zA-Z-_.]+.',
  );
const hostSchema = z
  .string()
  .describe('Proxy host: a hostname, IPv4, or IPv6 address.');
const portSchema = z
  .number()
  .int()
  .min(1)
  .max(65535)
  .describe('Proxy port (1-65535).');
const credentialsSchema = z
  .string()
  .describe(
    'Name of an existing `password` credentials object (PROXY target) for Basic auth. Must pre-exist.',
  );

export function registerHttpProxyTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: 'List HTTP proxy configurations.',
    getDescription: 'Get a single HTTP proxy configuration by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create an HTTP proxy configuration used for outbound HTTP by CAs, PKI ' +
      'connectors, third-party connectors, datasources, identity providers, ' +
      'certificate profiles (ACME), and triggers.',
    mandatoryFields: ['name', 'host', 'port'],
    inputSchema: z.object({
      name: nameSchema,
      host: hostSchema,
      port: portSchema,
      credentials: credentialsSchema.optional(),
    }),
    buildPayload: ({ name, host, port, credentials }) => {
      const body: Record<string, unknown> = { name, host, port };
      if (credentials !== undefined) body['credentials'] = credentials;
      return body;
    },
  });

  registerUpdateTool(server, client, SPEC, {
    description: 'Update an existing HTTP proxy configuration.',
    inputSchema: z.object({
      name: z.string().describe('Proxy name to update (immutable key).'),
      host: hostSchema.optional(),
      port: portSchema.optional(),
      credentials: credentialsSchema.optional(),
      clear_fields: z
        .array(z.string())
        .optional()
        .describe('Top-level fields to explicitly null, e.g. ["credentials"].'),
    }),
    buildOverrides: ({ host, port, credentials }) => {
      const o: Record<string, unknown> = {};
      if (host !== undefined) o['host'] = host;
      if (port !== undefined) o['port'] = port;
      if (credentials !== undefined) o['credentials'] = credentials;
      return o;
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete an HTTP proxy configuration.',
    deleteConstraints:
      'Cannot be deleted while referenced by a CA, PKI connector, third-party ' +
      'connector, datasource, identity provider, certificate profile, trigger, ' +
      'or service account (HTTP-PROXY-005).',
  });
}
