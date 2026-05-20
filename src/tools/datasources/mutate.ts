/**
 * Datasource update and delete tools.
 *
 * 2 MCP tools:
 *   - update_datasource
 *   - delete_datasource
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  buildMutateResponse,
  deleteGuard,
  encodePathSegment,
  getStripMergePut,
} from '../helpers.js';
import { registerTool } from '../register.js';
import {
  DS_BASE,
  dsAttributeSchema,
  localizedNameSchema,
  validateAuthType,
  validateRecordTypes,
} from './shared.js';

export function registerMutateDatasourceTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'update_datasource',
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit ' +
        'confirmation before calling this tool. Do not proceed without a clear ' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Update an existing datasource (GET -> strip -> merge -> PUT).\n\n' +
        'Safety tier: mutating-safe\n' +
        'Knowledge: horizon://knowledge/datasources\n\n' +
        'Parameters are type-specific - only set fields relevant to the datasource ' +
        'type (dns, ldap, or rest). Irrelevant fields are ignored.\n\n' +
        'IMPORTANT: The datasource name and type cannot be changed after creation.\n\n' +
        'See also: get_datasource, test_datasource.',
      inputSchema: z.object({
        name: z
          .string()
          .describe('Datasource name to update (cannot be changed).'),
        display_name: localizedNameSchema,
        description: z.string().optional().describe('New description.'),
        host: z.string().optional().describe('(DNS) New DNS server IP.'),
        port: z
          .number()
          .int()
          .optional()
          .describe('(DNS/LDAP) New port number.'),
        timeout: z
          .string()
          .optional()
          .describe('New timeout in duration format.'),
        lookup: z
          .string()
          .optional()
          .describe('(DNS) New lookup TemplateString.'),
        record_types: z
          .array(z.string())
          .optional()
          .describe('(DNS) New record type filter.'),
        hostname: z.string().optional().describe('(LDAP) New LDAP server URL.'),
        credentials: z
          .string()
          .optional()
          .describe('(LDAP/REST) New credentials name.'),
        base_dn: z
          .string()
          .optional()
          .describe('(LDAP) New base DN TemplateString.'),
        filter: z
          .string()
          .optional()
          .describe('(LDAP) New search filter TemplateString.'),
        secure: z.boolean().optional().describe('(LDAP) New secure flag.'),
        disable_hostname_validation: z
          .boolean()
          .optional()
          .describe('(LDAP) New hostname validation flag.'),
        attributes: dsAttributeSchema,
        limit: z.number().int().optional().describe('(LDAP) New result limit.'),
        follow_referrals: z
          .boolean()
          .optional()
          .describe('(LDAP) New referral traversal flag.'),
        method: z.string().optional().describe('(REST) New HTTP method.'),
        url: z
          .string()
          .optional()
          .describe('(REST) New endpoint URL TemplateString.'),
        authentication_type: z
          .string()
          .optional()
          .describe('(REST) New auth type.'),
        headers: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional()
          .describe('(REST) New HTTP headers.'),
        payload_type: z
          .string()
          .optional()
          .describe('(REST) New payload format hint.'),
        payload: z
          .string()
          .optional()
          .describe('(REST) New request body TemplateString.'),
        expected_http_codes: z
          .array(z.number().int())
          .optional()
          .describe('(REST) New success HTTP codes.'),
        proxy: z.string().optional().describe('(LDAP/REST) New proxy name.'),
        clear_fields: z
          .array(z.string())
          .optional()
          .describe('Top-level field names to explicitly set to null.'),
      }),
    },
    async ({
      name,
      display_name,
      description,
      host,
      port,
      timeout,
      lookup,
      record_types,
      hostname,
      credentials,
      base_dn,
      filter,
      secure,
      disable_hostname_validation,
      attributes,
      limit,
      follow_referrals,
      method,
      url,
      authentication_type,
      headers,
      payload_type,
      payload,
      expected_http_codes,
      proxy,
      clear_fields,
    }) => {
      if (record_types !== undefined) {
        const err = validateRecordTypes(record_types);
        if (err !== undefined) {
          return { content: [{ type: 'text' as const, text: err }] };
        }
      }
      if (authentication_type !== undefined) {
        const err = validateAuthType(authentication_type);
        if (err !== undefined) {
          return { content: [{ type: 'text' as const, text: err }] };
        }
      }

      const overrides: Record<string, unknown> = {};
      if (display_name !== undefined) overrides['displayName'] = display_name;
      if (description !== undefined) overrides['description'] = description;
      if (host !== undefined) overrides['host'] = host;
      if (port !== undefined) overrides['port'] = port;
      if (timeout !== undefined) overrides['timeout'] = timeout;
      if (lookup !== undefined) overrides['lookup'] = lookup;
      if (record_types !== undefined) overrides['recordTypes'] = record_types;
      if (hostname !== undefined) overrides['hostname'] = hostname;
      if (credentials !== undefined) overrides['credentials'] = credentials;
      if (base_dn !== undefined) overrides['baseDn'] = base_dn;
      if (filter !== undefined) overrides['filter'] = filter;
      if (secure !== undefined) overrides['secure'] = secure;
      if (disable_hostname_validation !== undefined) {
        overrides['disableHostnameValidation'] = disable_hostname_validation;
      }
      if (attributes !== undefined) overrides['attributes'] = attributes;
      if (limit !== undefined) overrides['limit'] = limit;
      if (follow_referrals !== undefined) {
        overrides['followReferrals'] = follow_referrals;
      }
      if (method !== undefined) overrides['method'] = method;
      if (url !== undefined) overrides['url'] = url;
      if (authentication_type !== undefined) {
        overrides['authenticationType'] = authentication_type;
      }
      if (headers !== undefined) overrides['headers'] = headers;
      if (payload_type !== undefined) overrides['payloadType'] = payload_type;
      if (payload !== undefined) overrides['payload'] = payload;
      if (expected_http_codes !== undefined) {
        overrides['expectedHttpCodes'] = expected_http_codes;
      }
      if (proxy !== undefined) overrides['proxy'] = proxy;

      const result = await getStripMergePut(
        client,
        `${DS_BASE}/${encodePathSegment(name)}`,
        DS_BASE,
        'datasource',
        overrides,
        clear_fields,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: buildMutateResponse({
              action: 'updated',
              kind: 'datasource',
              name,
              data: result,
            }),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'delete_datasource',
    {
      description:
        'STOP - This tool performs an IRREVERSIBLE destructive operation. You MUST ' +
        'ask the user for explicit confirmation before calling this tool. Do not ' +
        'proceed without a clear "yes" from the user. Present what will be ' +
        'permanently destroyed and wait.\n\n' +
        'Delete a datasource. Requires name confirmation.\n\n' +
        'A datasource cannot be deleted if it is still referenced by any ' +
        "profile's dsFlow.\n\n" +
        'Safety tier: mutating-destructive\n' +
        'Knowledge: horizon://knowledge/datasources\n\n' +
        'See also: get_datasource, list_datasources.',
      inputSchema: z.object({
        name: z.string().describe('Datasource name to delete.'),
        expected_name: z
          .string()
          .describe('Must exactly match name as a deletion safeguard.'),
      }),
    },
    async ({ name, expected_name }) => {
      deleteGuard(name, expected_name);
      await client.delete(`${DS_BASE}/${encodePathSegment(name)}`);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              deleted: true,
              name,
              kind: 'datasource',
            }),
          },
        ],
      };
    },
  );
}
