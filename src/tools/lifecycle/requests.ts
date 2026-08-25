/**
 * Certificate lifecycle request tools.
 *
 * 9 MCP tools:
 *   - get_request_template
 *   - submit_request
 *   - approve_request
 *   - deny_request
 *   - cancel_request
 *   - search_requests
 *   - get_request
 *   - export_requests_csv
 *   - aggregate_requests
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { HorizonError } from '../../client/errors.js';
import type { HorizonClient } from '../../client/http.js';
import {
  CSV_EXPORT_OUTPUT_SCHEMA,
  REQUEST_PRESETS,
  SEARCH_RESPONSE_OUTPUT_SCHEMA,
  buildExportPayload,
  buildSearchPayload,
  buildSearchResponse,
  csvTruncationMetadata,
  encodePathSegment,
  preflightRequestAction,
} from '../helpers.js';
import { registerTool } from '../register.js';

const GET_REQUEST_TEMPLATE_CONFIG = {
  description:
    'Get the request template showing which fields are required/editable. For ' +
    'a WebRA update, inspect template.autoRenew before changing per-certificate ' +
    'automatic renewal.\n\n Ref: horizon://knowledge/workflows.' +
    'MUST be called before submit_request. The template response tells you:\n' +
    '- Which subject fields exist and whether they are editable or computed\n' +
    '- Which SAN types are allowed\n' +
    '- Which labels are available\n' +
    '- Whether contactEmail, owner, team are editable\n' +
    '- Whether a password is required (centralized) or a CSR (decentralized)\n' +
    '- The allowed key types for centralized generation\n\n' +
    'Use the template to determine what information to ask the user for\n' +
    'before submitting. Do not guess - the template is the source of truth.',
  inputSchema: z.object({
    workflow: z
      .string()
      .describe(
        'Workflow type: enroll, renew, revoke, update, recover, migrate, import.',
      ),
    module: z
      .string()
      .optional()
      .describe('Profile module (webra, est, scep, acme, etc.).'),
    profile: z
      .string()
      .optional()
      .describe(
        'Profile name. Required for enroll to get profile-specific template.',
      ),
    certificate_id: z
      .string()
      .optional()
      .describe(
        'For renew/revoke/update/recover/migrate - the existing certificate ID.',
      ),
    include_terms_of_service: z
      .boolean()
      .optional()
      .describe(
        'Include the Terms of Service content the requester must accept. Sent ' +
          'as the termsOfService query parameter, never in the POST body.',
      ),
  }),
};

const SUBMIT_REQUEST_CONFIG = {
  description:
    'Submit a certificate lifecycle request (enroll, renew, revoke, update, ' +
    'recover, migrate). MUST call get_request_template first to learn which ' +
    'fields are required/editable for this profile+workflow, then ask the user ' +
    'for any missing values. Outcome depends on caller permissions: with the ' +
    'direct action permission (enrollApi, revokeApi, renewApi) the operation ' +
    'completes immediately; with only the request permission the request is ' +
    'created in PENDING state and needs approve_request. Surface that status ' +
    'to the user. This can perform destructive workflows (revoke); confirm ' +
    'with the user before submitting a revoke. For revoke, revocationReason is ' +
    'strongly recommended - ask the user for it; Horizon defaults to ' +
    "'unspecified' if omitted (keycompromise, cacompromise, affiliationchange, " +
    'superseded, cessationofoperation, certificatehold, removefromcrl, ' +
    'privilegewithdrawn, aacompromise, unspecified). ' +
    'Modules: webra, est, scep, acme, crmp, wcce, intune, jamf. ' +
    'EST/SCEP enroll returns the challenge password in the response. ' +
    'For a WebRA update, template.autoRenew is the generic path for changing ' +
    'per-certificate automatic renewal. Full workflow + examples: ' +
    'horizon://knowledge/workflows.',
  // submit_request can run revoke workflows, so mark it destructive even
  // though the name-prefix classifier treats it as an additive mutation.
  annotations: { destructiveHint: true },
  inputSchema: z.object({
    workflow: z
      .string()
      .describe(
        'Workflow type: enroll, renew, revoke, update, recover, migrate, import.',
      ),
    profile: z.string().describe('Certificate profile name.'),
    module: z
      .string()
      .describe('Profile module type (webra, est, scep, acme, crmp, etc.).'),
    template: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Certificate request template object. Structure:\n' +
          '- subject: list of DN elements, each as\n' +
          '  {"element": "cn.1", "type": "CN", "value": "server.example.com"}\n' +
          '- sans: list of SAN entries - values MUST be arrays:\n' +
          '  {"type": "DNSNAME", "value": ["server.example.com", "alias.example.com"]}\n' +
          '  Valid types: DNSNAME, RFC822NAME, URI, IPADDRESS, OTHERNAME,\n' +
          '  DIRECTORYNAME, REGISTEREDID\n' +
          '- labels: [{"label": "environment", "value": "production"}]\n' +
          '- contactEmail: {"value": "admin@example.com"}\n' +
          '- owner: {"value": "admin-principal"}\n' +
          '- team: {"value": "infra-team"}\n' +
          '- keyType: "rsa-2048", "rsa-3072", "ec-p256", etc.\n' +
          '- csr: PEM-encoded CSR (for decentralized key generation)\n' +
          '- extensions: optional certificate extensions',
      ),
    password: z
      .string()
      .optional()
      .describe(
        'PKCS#12 password for centralized key generation. When\n' +
          'provided, Horizon generates the key pair server-side and returns\n' +
          'the PKCS#12 in the response (base64). Also retrievable via\n' +
          'get_request. May be auto-generated by profile password policy -\n' +
          'check get_request_template.',
      ),
    certificate_id: z
      .string()
      .optional()
      .describe(
        'Certificate ID (required for renew, revoke, update, recover, migrate). ' +
          'Use search_certificates to find it.',
      ),
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional workflow-specific fields merged into the payload.\n' +
          'For revoke: {"revocationReason": "keycompromise"}.\n' +
          'For EST/SCEP with DN whitelist: {"dn": "CN=my-device"}.\n' +
          'For dry run validation: {"dryRun": true}.\n' +
          'For requester comment: {"requesterComment": "reason for request"}.',
      ),
  }),
};

const APPROVE_REQUEST_CONFIG = {
  description:
    'Approve a pending certificate lifecycle request.\n\n' +
    'Prerequisites: Use search_requests or get_request to find the request ID.\n' +
    'Only pending requests can be approved. Permissions are checked automatically.\n\n' +
    'Checks permissions before attempting the approval. The workflow\n' +
    'type is determined automatically from the request.\n' +
    'If permission is denied, returns an error - do NOT retry.',
  inputSchema: z.object({
    request_id: z.string().describe('The request ID to approve.'),
  }),
};

const DENY_REQUEST_CONFIG = {
  description:
    'Deny a pending certificate lifecycle request.\n\n' +
    'Prerequisites: Use search_requests or get_request to find the request ID.\n' +
    'Only pending requests can be denied. Permissions are checked automatically.\n\n' +
    'Checks permissions before attempting the denial. The workflow\n' +
    'type is determined automatically from the request.\n' +
    'If permission is denied, returns an error - do NOT retry.',
  inputSchema: z.object({
    request_id: z.string().describe('The request ID to deny.'),
  }),
};

const CANCEL_REQUEST_CONFIG = {
  description:
    'Cancel a pending certificate lifecycle request.\n\n' +
    'Prerequisites: Use search_requests or get_request to find the request ID.\n' +
    'Only pending requests can be cancelled. Permissions are checked automatically.\n\n' +
    'Checks permissions before attempting the cancellation. The workflow\n' +
    'type is determined automatically from the request.\n' +
    'If permission is denied, returns an error - do NOT retry.',
  inputSchema: z.object({
    request_id: z.string().describe('The request ID to cancel.'),
  }),
};

const SEARCH_REQUESTS_CONFIG = {
  description:
    'Search certificate lifecycle requests with HRQL. Lowercase fields ' +
    '(registration.date, modification.date, not registrationDate). Operators: ' +
    'equals, before, after, contains, in, and/or/not. ' +
    'Full reference: horizon://knowledge/query-languages. ' +
    'Presets: compact (default), diagnostic, compliance. ' +
    'Results are field-truncated; use get_request for the full record. ' +
    'Pagination: page_index is 0-based; use next_page_index from the previous ' +
    'response; stop when has_more is false. Pass sorted_by for stable order.',
  inputSchema: z.object({
    query: z.string().describe('HRQL query expression.'),
    preset: z
      .enum(['compact', 'diagnostic', 'compliance'])
      .default('compact')
      .describe('Preset field set (overridden by fields if provided).'),
    fields: z
      .array(z.string())
      .optional()
      .describe('Custom field list (overrides preset).'),
    page_index: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Page index (0-based). Use next_page_index from the previous response to paginate.',
      ),
    page_size: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe('Results per page (max 100).'),
    sorted_by: z
      .string()
      .optional()
      .describe(
        "Sort field, e.g. 'registrationDate:Desc'. Strongly recommended when paginating.",
      ),
    with_count: z
      .boolean()
      .default(true)
      .describe(
        'Include total matching count in response so has_more/next_page_index are reliable. Default true.',
      ),
  }),
  outputSchema: SEARCH_RESPONSE_OUTPUT_SCHEMA,
};

const GET_REQUEST_CONFIG = {
  description:
    'Get full details of a certificate lifecycle request by ID.\n\n' +
    'Returns complete untruncated data including all workflow fields,\n' +
    'certificate details, requester/approver info, and audit trail.\n\n' +
    'PKCS#12 / PFX: For centralized enrollment requests (server-side key\n' +
    'generation), the response contains the PKCS#12 bundle with the\n' +
    'certificate and private key. Look for the pkcs12 or keyStore\n' +
    'field (base64-encoded). This is the ONLY way to retrieve the private\n' +
    'key - it is NOT available on the certificate object itself.',
  inputSchema: z.object({
    request_id: z.string().describe('Request ID.'),
  }),
};

const EXPORT_REQUESTS_CSV_CONFIG = {
  description:
    'Export requests matching an HRQL query as CSV (max 1000 rows; use Horizon ' +
    'UI for full exports). HRQL query fields are lowercase (registration.date, ' +
    'not registrationDate); the CSV `fields` columns are camelCase (see the ' +
    'fields param). Full reference: horizon://knowledge/query-languages.',
  inputSchema: z.object({
    query: z.string().describe('HRQL query expression.'),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'CSV columns to include, as camelCase API column names (SearchResult ' +
          'columns) - NOT the lowercase HRQL query fields. Examples: profile, ' +
          'requestType, status, contactEmail, registrationDate. Prefix ' +
          'families: label.<key>, metadata.<key>. Invalid names return a ' +
          'Horizon 500 that lists the usable columns.',
      ),
    sorted_by: z
      .string()
      .optional()
      .describe("Sort field, e.g. 'registrationDate:Desc'."),
  }),
  outputSchema: CSV_EXPORT_OUTPUT_SCHEMA,
};

const AGGREGATE_REQUESTS_CONFIG = {
  description:
    'Aggregate requests by groupBy dimensions using HRQL. Query field names ' +
    'are lowercase (registration.date, modification.date); groupBy field ' +
    'names are camelCase (workflow, status, profile, requester, approver, ' +
    'team, owner, registrationDate.day/month/year, label.*, metadata.*). ' +
    'Full reference: horizon://knowledge/query-languages.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('HRQL filter expression (ALL LOWERCASE field names).'),
    group_by: z
      .array(z.string())
      .describe('List of field names to group by (camelCase).'),
    having: z
      .object({
        operator: z
          .enum(['gt', 'gte', 'lt', 'lte', 'eq', 'ne'])
          .describe('Comparison operator.'),
        value: z.number().describe('Threshold count value.'),
      })
      .optional()
      .describe('Optional post-aggregation filter on count.'),
    sort_order: z
      .enum(['Asc', 'Desc', 'KeyAsc', 'KeyDesc'])
      .default('Desc')
      .describe('Bucket sort order.'),
  }),
};

export function registerRequestTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'get_request_template',
    GET_REQUEST_TEMPLATE_CONFIG,
    async ({
      workflow,
      module,
      profile,
      certificate_id,
      include_terms_of_service,
    }) => {
      const params: Record<string, string> = { workflow };
      if (module) params['module'] = module;
      if (profile) params['profile'] = profile;
      if (certificate_id) params['certificateId'] = certificate_id;
      const path = include_terms_of_service
        ? '/api/v1/requests/template?termsOfService=true'
        : '/api/v1/requests/template';

      const result = await client.post<Record<string, unknown>>(path, params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  registerTool(
    server,
    'submit_request',
    SUBMIT_REQUEST_CONFIG,
    async ({
      workflow,
      profile,
      module,
      template,
      password,
      certificate_id,
      data,
    }) => {
      // Explicit params override anything from data (template/password/
      // certificateId come from typed inputs and trump same-named keys
      // inside the loose `data` bag).
      const payload: Record<string, unknown> = {
        workflow,
        profile,
        module,
        ...(data ?? {}),
        ...(template !== undefined ? { template } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(certificate_id !== undefined
          ? { certificateId: certificate_id }
          : {}),
      };

      const result = await client.post<Record<string, unknown>>(
        '/api/v1/requests/submit',
        payload,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  registerTool(
    server,
    'approve_request',
    APPROVE_REQUEST_CONFIG,
    async ({ request_id }) => {
      const preflight = await preflightRequestAction(
        client,
        'approve',
        request_id,
        'approve',
      );
      if ('error' in preflight) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(preflight) }],
        };
      }

      try {
        const result = await client.post<Record<string, unknown>>(
          '/api/v1/requests/approve',
          {
            id: request_id,
            workflow: preflight['workflow'],
          },
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        const msg =
          err instanceof HorizonError ? err.toToolResult() : String(err);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: msg }) },
          ],
        };
      }
    },
  );

  registerTool(
    server,
    'deny_request',
    DENY_REQUEST_CONFIG,
    async ({ request_id }) => {
      const preflight = await preflightRequestAction(
        client,
        'deny',
        request_id,
        'approve',
      );
      if ('error' in preflight) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(preflight) }],
        };
      }

      try {
        const result = await client.post<Record<string, unknown>>(
          '/api/v1/requests/deny',
          {
            id: request_id,
            workflow: preflight['workflow'],
          },
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        const msg =
          err instanceof HorizonError ? err.toToolResult() : String(err);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: msg }) },
          ],
        };
      }
    },
  );

  registerTool(
    server,
    'cancel_request',
    CANCEL_REQUEST_CONFIG,
    async ({ request_id }) => {
      const preflight = await preflightRequestAction(
        client,
        'cancel',
        request_id,
        'cancel',
      );
      if ('error' in preflight) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(preflight) }],
        };
      }

      try {
        const result = await client.post<Record<string, unknown>>(
          '/api/v1/requests/cancel',
          {
            id: request_id,
            workflow: preflight['workflow'],
          },
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        const msg =
          err instanceof HorizonError ? err.toToolResult() : String(err);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: msg }) },
          ],
        };
      }
    },
  );

  registerTool(
    server,
    'search_requests',
    SEARCH_REQUESTS_CONFIG,
    async ({
      query,
      preset,
      fields,
      page_index,
      page_size,
      sorted_by,
      with_count,
    }) => {
      const effectiveFields =
        fields ?? REQUEST_PRESETS[preset] ?? REQUEST_PRESETS['compact']!;
      const payload = buildSearchPayload(
        query,
        effectiveFields,
        page_index,
        page_size,
        sorted_by,
        with_count,
      );
      const result = await client.post<Record<string, unknown>>(
        '/api/v1/requests/search',
        payload,
      );

      const response = buildSearchResponse(result, page_index, page_size);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
        structuredContent: response,
      };
    },
  );

  registerTool(
    server,
    'get_request',
    GET_REQUEST_CONFIG,
    async ({ request_id }) => {
      const result = await client.get(
        `/api/v1/requests/${encodePathSegment(request_id)}`,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  registerTool(
    server,
    'export_requests_csv',
    EXPORT_REQUESTS_CSV_CONFIG,
    async ({ query, fields, sorted_by }) => {
      const payload = buildExportPayload(query, fields, sorted_by);
      const csvText = await client.postText('/api/v1/requests/csv', payload, {
        timeout: client.exportTimeout,
      });
      const metadata = csvTruncationMetadata(csvText);
      const payloadOut = { csv: csvText, ...metadata };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payloadOut),
          },
        ],
        structuredContent: payloadOut,
      };
    },
  );

  registerTool(
    server,
    'aggregate_requests',
    AGGREGATE_REQUESTS_CONFIG,
    async ({ query, group_by, having, sort_order }) => {
      const payload: Record<string, unknown> = {
        query,
        groupBy: group_by,
      };
      if (having !== undefined) payload['having'] = having;
      if (sort_order) payload['sortOrder'] = sort_order;

      const result = await client.post<Record<string, unknown>>(
        '/api/v1/requests/aggregate',
        payload,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
