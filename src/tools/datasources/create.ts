/**
 * Datasource creation tools (one per type).
 *
 * 3 MCP tools:
 *   - create_dns_datasource
 *   - create_ldap_datasource
 *   - create_rest_datasource
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { buildMutateResponse } from '../helpers.js';
import { registerTool } from '../register.js';
import {
  DS_BASE,
  dsAttributeSchema,
  localizedNameSchema,
  validateAuthType,
  validateRecordTypes,
} from './shared.js';

export function registerCreateDatasourceTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'create_dns_datasource',
    {
      description:
        'Create a DNS datasource for hostname lookups during enrollment.\n\n Ref: horizon://knowledge/datasources.' +
        'Safety tier: mutating-safe\n' +
        'DNS datasources query DNS servers and return record data (A, AAAA, ' +
        'CNAME, PTR, TXT) used in computation/validation rules via ' +
        'ds.<flowIndex>.<resultIndex>.<recordType> entries.\n\n' +
        'IMPORTANT: Datasource names are IMMUTABLE after creation. Always ask\n' +
        'the user for the name before creating.\n\n' +
        'The lookup field is a TemplateString that supports {{key}} syntax for\n' +
        'dynamic DNS queries. For example: "{{csr.san.dnsname.1}}" will look up\n' +
        'the first DNS SAN from the CSR.\n\n' +
        'Typical workflow:\n' +
        '    1. Use test_datasource first to validate your DNS config works\n' +
        '    2. Call this tool to create the datasource\n' +
        "    3. Add the datasource to a profile's dsFlow (via profile configuration)\n" +
        '    4. Use ds.<flowIndex>.<resultIndex>.<recordType> in computation\n' +
        '       rules or validation rule conditions\n\n' +
        'When to use DNS datasources:\n' +
        '    - Validate that a SAN hostname has a specific CNAME target\n' +
        '    - Check if a hostname resolves (A/AAAA records exist)\n' +
        '    - Look up TXT records for domain ownership verification\n' +
        '    - Reverse-lookup IP addresses via PTR records\n\n' +
        'Example - CNAME validation for PaaS deployment:\n' +
        '    name="san-cname-check"\n' +
        '    lookup="{{csr.san.dnsname.1}}"\n' +
        '    record_types=["cname"]\n' +
        '    -> After creation, add to profile dsFlow with input mapping:\n' +
        '       {"hostname": "{{csr.san.dnsname.1}}"}\n' +
        '    -> Reference in validation rule: {{ds.1.1.cname}} matches ".*\\.paas\\.internal$"\n\n' +
        '    simulate_datasource_flow (test entire flow pipeline),\n' +
        '    list_datasources (verify creation).',
      inputSchema: z.object({
        name: z
          .string()
          .describe('Unique datasource name (immutable primary key).'),
        lookup: z
          .string()
          .describe(
            'DNS hostname to look up - supports {{key}} TemplateString syntax.',
          ),
        display_name: localizedNameSchema,
        description: z
          .string()
          .optional()
          .describe('Human-readable description.'),
        host: z
          .string()
          .optional()
          .describe(
            "DNS server IP address. Omit for Horizon's default resolver.",
          ),
        port: z
          .number()
          .int()
          .default(53)
          .describe('DNS server port (default 53).'),
        timeout: z
          .string()
          .default('10 seconds')
          .describe('Query timeout in duration format (default "10 seconds").'),
        record_types: z
          .array(z.string())
          .optional()
          .describe(
            'DNS record types to return: "a", "aaaa", "cname", "ptr", "txt". Omit for all.',
          ),
      }),
    },
    async ({
      name,
      lookup,
      display_name,
      description,
      host,
      port,
      timeout,
      record_types,
    }) => {
      if (record_types !== undefined) {
        const err = validateRecordTypes(record_types);
        if (err !== undefined) {
          return { content: [{ type: 'text' as const, text: err }] };
        }
      }

      const payload: Record<string, unknown> = {
        type: 'dns',
        name,
        lookup,
        port,
        timeout,
      };
      if (display_name !== undefined) payload['displayName'] = display_name;
      if (description !== undefined) payload['description'] = description;
      if (host !== undefined) payload['host'] = host;
      if (record_types !== undefined) payload['recordTypes'] = record_types;

      const result = await client.post<Record<string, unknown>>(
        DS_BASE,
        payload,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: buildMutateResponse({
              action: 'created',
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
    'create_ldap_datasource',
    {
      description:
        'Create an LDAP datasource for directory lookups during enrollment.\n\n Ref: horizon://knowledge/datasources.' +
        'Safety tier: mutating-safe\n' +
        'LDAP datasources query directory servers (AD, OpenLDAP, etc.) and return ' +
        'user/object attributes via ds.<flowIndex>.<resultIndex>.<attribute> entries.\n\n' +
        'IMPORTANT: Datasource names are IMMUTABLE after creation. Always ask\n' +
        'the user for the name before creating.\n\n' +
        'Prerequisites: The referenced credentials object must already exist in\n' +
        'Horizon (type: PasswordCredentials with LDAP bind DN + password).\n\n' +
        'The baseDn and filter fields support TemplateString syntax with {{key}}\n' +
        'for dynamic LDAP queries. Example filter: "(sAMAccountName={{username}})".\n\n' +
        'Special LDAP attributes are auto-decoded:\n' +
        '    - objectSid, objectGuid: decoded from binary\n' +
        '    - userCertificate: parsed as X.509 PEM + subject elements\n' +
        '    - dn: parsed into subject components (cn, o, ou, etc.)\n\n' +
        'Typical workflow:\n' +
        '    1. Ensure the PasswordCredentials for LDAP bind already exist\n' +
        '    2. Use test_datasource first to validate LDAP connectivity and filter\n' +
        '    3. Call this tool to create the datasource\n' +
        "    4. Add the datasource to a profile's dsFlow\n" +
        '    5. Use ds.<flowIndex>.<resultIndex>.<attribute> in computation rules\n' +
        '       or validation rule conditions\n\n' +
        'When to use LDAP datasources:\n' +
        '    - Enrich certificates with user attributes (department, email, manager)\n' +
        '    - Validate user group membership before auto-approving enrollment\n' +
        '    - Look up computer objects for server certificate enrichment\n' +
        '    - Resolve AD attributes for certificate naming policies\n\n' +
        'Example - Active Directory user enrichment:\n' +
        '    name="corp-ad"\n' +
        '    hostname="ldaps://dc01.corp.local"\n' +
        '    credentials="ad-bind-creds"\n' +
        '    base_dn="OU=Users,DC=corp,DC=local"\n' +
        '    filter="(sAMAccountName={{principal.identifier}})"\n' +
        '    secure=True\n' +
        '    timeout="10s"\n' +
        '    limit=1\n' +
        '    attributes=[\n' +
        '        {"key": "department", "multi": false, "selected": true},\n' +
        '        {"key": "mail", "multi": false, "selected": true},\n' +
        '        {"key": "memberOf", "multi": true, "selected": true}\n' +
        '    ]\n\n' +
        '    simulate_datasource_flow (test full flow pipeline),\n' +
        '    list_datasources (verify creation).',
      inputSchema: z.object({
        name: z
          .string()
          .describe('Unique datasource name (immutable primary key).'),
        hostname: z
          .string()
          .describe('LDAP server URL (e.g. "ldaps://ldap.corp.example.com").'),
        credentials: z
          .string()
          .describe('Name of existing PasswordCredentials for LDAP bind.'),
        base_dn: z
          .string()
          .describe(
            'LDAP search base DN - supports {{key}} TemplateString syntax.',
          ),
        filter: z
          .string()
          .describe(
            'LDAP search filter - supports {{key}} TemplateString syntax.',
          ),
        secure: z.boolean().describe('Use secure LDAP (LDAPS).'),
        timeout: z
          .string()
          .describe(
            'Query timeout in duration format (e.g. "10s", "30 seconds").',
          ),
        display_name: localizedNameSchema,
        description: z
          .string()
          .optional()
          .describe('Human-readable description.'),
        port: z
          .number()
          .int()
          .optional()
          .describe('LDAP port. Default: 389 (LDAP) or 636 (LDAPS).'),
        disable_hostname_validation: z
          .boolean()
          .default(false)
          .describe('Skip hostname validation on TLS (default false).'),
        attributes: dsAttributeSchema,
        limit: z
          .number()
          .int()
          .optional()
          .describe('Maximum number of LDAP results to return.'),
        follow_referrals: z
          .boolean()
          .optional()
          .describe('Enable LDAP referral traversal.'),
        proxy: z
          .string()
          .optional()
          .describe('Name of an existing HTTP proxy object.'),
      }),
    },
    async ({
      name,
      hostname,
      credentials,
      base_dn,
      filter,
      secure,
      timeout,
      display_name,
      description,
      port,
      disable_hostname_validation,
      attributes,
      limit,
      follow_referrals,
      proxy,
    }) => {
      const payload: Record<string, unknown> = {
        type: 'ldap',
        name,
        hostname,
        credentials,
        baseDn: base_dn,
        filter,
        secure,
        timeout,
      };
      if (display_name !== undefined) payload['displayName'] = display_name;
      if (description !== undefined) payload['description'] = description;
      if (port !== undefined) payload['port'] = port;
      if (disable_hostname_validation) {
        payload['disableHostnameValidation'] = true;
      }
      if (attributes !== undefined) payload['attributes'] = attributes;
      if (limit !== undefined) payload['limit'] = limit;
      if (follow_referrals !== undefined) {
        payload['followReferrals'] = follow_referrals;
      }
      if (proxy !== undefined) payload['proxy'] = proxy;

      const result = await client.post<Record<string, unknown>>(
        DS_BASE,
        payload,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: buildMutateResponse({
              action: 'created',
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
    'create_rest_datasource',
    {
      description:
        'Create a REST datasource for HTTP API lookups during enrollment.\n\n Ref: horizon://knowledge/datasources.' +
        'Safety tier: mutating-safe\n' +
        'REST datasources call HTTP APIs and return parsed response data via ' +
        'ds.<flowIndex>.<resultIndex>.<attribute> entries.\n\n' +
        'IMPORTANT: Datasource names are IMMUTABLE after creation. Always ask\n' +
        'the user for the name before creating.\n\n' +
        "Prerequisites: When authenticationType is not 'noauth', the referenced\n" +
        'credentials object must already exist in Horizon.\n\n' +
        'The url, headers, and payload fields support TemplateString syntax\n' +
        'with {{key}} for dynamic values.\n\n' +
        'Typical workflow:\n' +
        '    1. Ensure credentials exist (unless using noauth)\n' +
        '    2. Use test_datasource first to validate the API call works\n' +
        '    3. Call this tool to create the datasource\n' +
        "    4. Add the datasource to a profile's dsFlow\n" +
        '    5. Use ds.<flowIndex>.<resultIndex>.<attribute> in computation rules\n\n' +
        'When to use REST datasources:\n' +
        '    - Query a CMDB API for host ownership information\n' +
        '    - Call an internal service to validate hostnames or domains\n' +
        '    - Fetch user metadata from an HR system API\n' +
        '    - Integrate with any HTTP-based external data source\n\n' +
        'Example - CMDB host ownership lookup:\n' +
        '    name="cmdb-lookup"\n' +
        '    method="GET"\n' +
        '    url="https://cmdb.corp.local/api/v1/hosts/{{csr.san.dnsname.1}}"\n' +
        '    authentication_type="bearer"\n' +
        '    credentials="cmdb-api-token"\n' +
        '    timeout="10s"\n' +
        '    expected_http_codes=[200]\n' +
        '    attributes=[{"key": "owner", "multi": false, "selected": true}]\n\n' +
        '    simulate_datasource_flow (test full flow pipeline),\n' +
        '    list_datasources (verify creation).',
      inputSchema: z.object({
        name: z
          .string()
          .describe('Unique datasource name (immutable primary key).'),
        method: z
          .string()
          .describe('HTTP method (GET, POST, PUT, DELETE, etc.).'),
        url: z
          .string()
          .describe('Endpoint URL - supports {{key}} TemplateString syntax.'),
        authentication_type: z
          .string()
          .describe(
            'Auth scheme: "noauth", "basic", "x509", "bearer", or "custom".',
          ),
        timeout: z
          .string()
          .describe('Request timeout in duration format (e.g. "10s").'),
        expected_http_codes: z
          .array(z.number().int())
          .describe('HTTP status codes indicating success (e.g. [200, 201]).'),
        display_name: localizedNameSchema,
        description: z
          .string()
          .optional()
          .describe('Human-readable description.'),
        credentials: z
          .string()
          .optional()
          .describe(
            'Name of existing credentials. Required when authentication_type is not "noauth".',
          ),
        headers: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional()
          .describe('Custom HTTP headers as [{name, value}].'),
        payload_type: z
          .string()
          .optional()
          .describe('Payload format hint (e.g. "json").'),
        payload: z
          .string()
          .optional()
          .describe('Request body - supports {{key}} TemplateString syntax.'),
        proxy: z
          .string()
          .optional()
          .describe('Name of an existing HTTP proxy object.'),
        attributes: dsAttributeSchema,
      }),
    },
    async ({
      name,
      method,
      url,
      authentication_type,
      timeout,
      expected_http_codes,
      display_name,
      description,
      credentials,
      headers,
      payload_type,
      payload,
      proxy,
      attributes,
    }) => {
      const authErr = validateAuthType(authentication_type);
      if (authErr !== undefined) {
        return { content: [{ type: 'text' as const, text: authErr }] };
      }

      if (authentication_type !== 'noauth' && !credentials) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  "credentials is required when authentication_type is not 'noauth'.",
                hint: 'Provide the name of an existing credentials object.',
              }),
            },
          ],
        };
      }

      if (expected_http_codes.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  'expected_http_codes must contain at least one HTTP status code.',
                hint: 'Common values: [200], [200, 201], [200, 204].',
              }),
            },
          ],
        };
      }

      const body: Record<string, unknown> = {
        type: 'rest',
        name,
        method,
        url,
        authenticationType: authentication_type,
        timeout,
        expectedHttpCodes: expected_http_codes,
      };
      if (display_name !== undefined) body['displayName'] = display_name;
      if (description !== undefined) body['description'] = description;
      if (credentials !== undefined) body['credentials'] = credentials;
      if (headers !== undefined) body['headers'] = headers;
      if (payload_type !== undefined) body['payloadType'] = payload_type;
      if (payload !== undefined) body['payload'] = payload;
      if (proxy !== undefined) body['proxy'] = proxy;
      if (attributes !== undefined) body['attributes'] = attributes;

      const result = await client.post<Record<string, unknown>>(DS_BASE, body);
      return {
        content: [
          {
            type: 'text' as const,
            text: buildMutateResponse({
              action: 'created',
              kind: 'datasource',
              name,
              data: result,
            }),
          },
        ],
      };
    },
  );
}
