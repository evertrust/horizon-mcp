/**
 * test_datasource tool: live test of a datasource definition against a
 * context dictionary without persisting anything.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { registerTool } from '../register.js';
import { DS_BASE, dsAttributeSchema, validateDsType } from './shared.js';

export function registerTestDatasourceTool(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'test_datasource',
    {
      description:
        'Test a datasource configuration against a context dictionary.\n\n Ref: horizon://knowledge/datasources.' +
        'Sends the datasource definition and an optional context dictionary to ' +
        'Horizon for a one-off test execution. Useful for validating datasource\n' +
        'configuration before creating or after modifying it.\n\n' +
        'For DNS: returns resolved records (A, AAAA, CNAME, PTR, TXT).\n' +
        'For LDAP: returns matched attributes and computed DN/filter.\n' +
        'For REST: returns response code, headers, body, and extracted attributes.\n\n' +
        'Typical workflow:\n' +
        '    1. Call test_datasource with your planned configuration\n' +
        '    2. Check the result: status should be "success"\n' +
        '    3. If successful, proceed to create_dns/ldap/rest_datasource\n' +
        '    4. If failed, adjust configuration and test again\n\n' +
        'Example - Test DNS CNAME lookup:\n' +
        '    ds_type="dns", name="test-cname",\n' +
        '    lookup="{{hostname}}", record_types=["cname"],\n' +
        '    context={"hostname": "app.corp.local"}\n' +
        '    -> Expect: status="success", dictionary contains cname record\n\n' +
        'Example - Test LDAP user lookup:\n' +
        '    ds_type="ldap", name="test-ldap",\n' +
        '    hostname="ldaps://ldap.corp.local", credentials="ldap-creds",\n' +
        '    base_dn="DC=corp,DC=local", filter="(sAMAccountName={{user}})",\n' +
        '    secure=True,\n' +
        '    context={"user": "jdoe"}\n' +
        '    -> Expect: status="success", dictionary contains user attributes\n\n' +
        '    create_rest_datasource (create after testing),\n' +
        '    simulate_datasource_flow (test full flow pipeline with chaining).',
      inputSchema: z.object({
        ds_type: z
          .string()
          .describe('Datasource type: "dns", "ldap", or "rest".'),
        name: z.string().describe('Datasource name (for identification).'),
        context: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Key-value pairs to resolve TemplateString variables. ' +
              'Example: {"hostname": "web01.corp.local"}.',
          ),
        lookup: z.string().optional().describe('(DNS) Hostname to look up.'),
        host: z.string().optional().describe('(DNS) DNS server IP.'),
        port: z.number().int().optional().describe('(DNS/LDAP) Port number.'),
        timeout: z.string().optional().describe('Timeout in duration format.'),
        record_types: z
          .array(z.string())
          .optional()
          .describe('(DNS) Record types to query.'),
        hostname: z.string().optional().describe('(LDAP) LDAP server URL.'),
        credentials: z
          .string()
          .optional()
          .describe('(LDAP/REST) Credentials name.'),
        base_dn: z
          .string()
          .optional()
          .describe('(LDAP) Base DN TemplateString.'),
        filter: z
          .string()
          .optional()
          .describe('(LDAP) Search filter TemplateString.'),
        secure: z.boolean().optional().describe('(LDAP) Use LDAPS.'),
        attributes: dsAttributeSchema,
        limit: z.number().int().optional().describe('(LDAP) Max results.'),
        method: z.string().optional().describe('(REST) HTTP method.'),
        url: z
          .string()
          .optional()
          .describe('(REST) Endpoint URL TemplateString.'),
        authentication_type: z
          .string()
          .optional()
          .describe('(REST) Auth type.'),
        headers: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional()
          .describe('(REST) HTTP headers.'),
        payload_type: z.string().optional().describe('(REST) Payload format.'),
        payload: z
          .string()
          .optional()
          .describe('(REST) Request body TemplateString.'),
        expected_http_codes: z
          .array(z.number().int())
          .optional()
          .describe('(REST) Success HTTP codes.'),
      }),
    },
    async ({
      ds_type,
      name,
      context,
      lookup,
      host,
      port,
      timeout,
      record_types,
      hostname,
      credentials,
      base_dn,
      filter,
      secure,
      attributes,
      limit,
      method,
      url,
      authentication_type,
      headers,
      payload_type,
      payload,
      expected_http_codes,
    }) => {
      const typeErr = validateDsType(ds_type);
      if (typeErr !== undefined) {
        return { content: [{ type: 'text' as const, text: typeErr }] };
      }

      const ds: Record<string, unknown> = { type: ds_type, name };

      if (ds_type === 'dns') {
        if (!lookup) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'lookup is required for DNS datasource tests.',
                }),
              },
            ],
          };
        }
        ds['lookup'] = lookup;
        if (host !== undefined) ds['host'] = host;
        if (port !== undefined) ds['port'] = port;
        if (timeout !== undefined) ds['timeout'] = timeout;
        if (record_types !== undefined) ds['recordTypes'] = record_types;
      } else if (ds_type === 'ldap') {
        if (!hostname || !credentials || !base_dn || !filter) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error:
                    'hostname, credentials, base_dn, and filter are all required for LDAP tests.',
                }),
              },
            ],
          };
        }
        ds['hostname'] = hostname;
        ds['credentials'] = credentials;
        ds['baseDn'] = base_dn;
        ds['filter'] = filter;
        ds['secure'] = secure ?? false;
        if (port !== undefined) ds['port'] = port;
        if (timeout !== undefined) ds['timeout'] = timeout;
        if (attributes !== undefined) ds['attributes'] = attributes;
        if (limit !== undefined) ds['limit'] = limit;
      } else if (ds_type === 'rest') {
        if (!method || !url || !authentication_type) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error:
                    'method, url, and authentication_type are all required for REST tests.',
                }),
              },
            ],
          };
        }
        ds['method'] = method;
        ds['url'] = url;
        ds['authenticationType'] = authentication_type;
        if (timeout !== undefined) ds['timeout'] = timeout;
        if (expected_http_codes !== undefined) {
          ds['expectedHttpCodes'] = expected_http_codes;
        }
        if (credentials !== undefined) ds['credentials'] = credentials;
        if (headers !== undefined) ds['headers'] = headers;
        if (payload_type !== undefined) ds['payloadType'] = payload_type;
        if (payload !== undefined) ds['payload'] = payload;
        if (attributes !== undefined) ds['attributes'] = attributes;
      }

      const body: Record<string, unknown> = { ds };
      if (context !== undefined) {
        body['context'] = Object.entries(context).map(([key, value]) => ({
          key,
          value,
        }));
      }

      const result = await client.patch(DS_BASE, body);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
