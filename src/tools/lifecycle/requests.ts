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
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { HorizonError } from '../../client/errors.js';
import type { HorizonClient } from '../../client/http.js';
import {
  CSV_TIMEOUT,
  REQUEST_PRESETS,
  buildExportPayload,
  buildSearchPayload,
  buildSearchResponse,
  csvTruncationMetadata,
  encodePathSegment,
  preflightRequestAction,
} from '../helpers.js';
import { registerTool } from '../register.js';

export function registerRequestTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'get_request_template',
    {
      description:
        'Get the request template showing which fields are required/editable.\n\n' +
        'Safety tier: read-only\n' +
        'Knowledge: horizon://knowledge/workflows\n\n' +
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
      }),
    },
    async ({ workflow, module, profile, certificate_id }) => {
      const params: Record<string, string> = { workflow };
      if (module) params['module'] = module;
      if (profile) params['profile'] = profile;
      if (certificate_id) params['certificateId'] = certificate_id;

      const result = await client.post<Record<string, unknown>>(
        '/api/v1/requests/template',
        params,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  registerTool(
    server,
    'submit_request',
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit\n' +
        'confirmation before calling this tool. Do not proceed without a clear\n' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Submit a certificate lifecycle request (enroll, renew, revoke, etc.).\n\n' +
        'Safety tier: mutating-safe\n' +
        'Knowledge: horizon://knowledge/workflows\n\n' +
        'MANDATORY WORKFLOW - follow these steps in order:\n' +
        '1. Call get_request_template(workflow, module, profile) to discover which\n' +
        '   fields are required, optional, and editable for this profile+workflow.\n' +
        '2. Examine the template response - it shows the full field structure.\n' +
        "3. ASK THE USER for all required information you don't already have.\n" +
        '4. Only call submit_request once all required fields are filled.\n\n' +
        "PERMISSION-BASED BEHAVIOR - the outcome depends on the caller's\n" +
        'permissions on the profile (see horizon://knowledge/workflows):\n\n' +
        '- If the caller has the DIRECT action permission (e.g., enrollApi\n' +
        '  for enroll, revokeApi for revoke, renewApi for renew), the\n' +
        '  operation completes immediately. The certificate is issued/revoked/\n' +
        '  renewed directly and the response contains the result.\n' +
        '- If the caller only has the REQUEST permission (e.g., enrollRequest,\n' +
        '  revokeRequest, renewRequest), the request is created in\n' +
        '  PENDING state and requires approval by an authorized operator via\n' +
        '  approve_request. The response contains the request ID.\n\n' +
        'Tell the user which outcome occurred based on the response status.\n' +
        'If the status is "pending", inform them that approval is required.\n\n' +
        'Supported modules: webra, est, scep, acme, crmp, wcce, intune, jamf.\n' +
        'For EST and SCEP, this endpoint generates the enrollment challenge/password.\n' +
        'The challenge is returned in the response and can be used by the EST/SCEP\n' +
        'client to complete enrollment through the protocol endpoint.\n\n' +
        'Workflows and what to ask the user:\n' +
        '- enroll: Subject (CN, O, OU, etc.), SANs, labels, contact email,\n' +
        '  owner, team, key type. Check get_request_template for which fields\n' +
        '  are editable vs computed vs fixed by the profile.\n' +
        '- renew: certificate_id required. Template is pre-populated from\n' +
        '  the existing cert. Ask if any fields should change.\n' +
        '- revoke: certificate_id required. Ask for revocationReason:\n' +
        '  keycompromise, cacompromise, affiliationchange, superseded,\n' +
        '  cessationofoperation, certificatehold, removefromcrl,\n' +
        '  privilegewithdrawn, aacompromise, unspecified.\n' +
        '- update: certificate_id required. Ask which metadata to change\n' +
        '  (labels, contact email, owner, team).\n' +
        '- recover: certificate_id required. For re-issuing a lost cert.\n' +
        '- migrate: certificate_id required. For moving between profiles.\n\n' +
        'Enrollment example (centralized, WebRA):\n' +
        '    workflow="enroll", profile="TLS-Internal", module="webra",\n' +
        '    template={"subject": [{"element": "cn.1", "type": "CN", "value": "server.local"}],\n' +
        '              "sans": [{"type": "DNSNAME", "value": ["server.local"]}],\n' +
        '              "labels": [{"label": "env", "value": "prod"}],\n' +
        '              "contactEmail": {"value": "admin@corp.com"},\n' +
        '              "owner": {"value": "jdoe"},\n' +
        '              "team": {"value": "infra"},\n' +
        '              "keyType": "rsa-3072"},\n' +
        '    password="changeit"\n\n' +
        'EST challenge example:\n' +
        '    workflow="enroll", profile="EST-Devices", module="est",\n' +
        '    template={"subject": [{"element": "cn.1", "type": "CN", "value": "device01"}],\n' +
        '              "contactEmail": {"value": "ops@corp.com"}},\n' +
        '    password="challenge-password"\n\n' +
        'Revoke example:\n' +
        '    workflow="revoke", profile="TLS-Internal", module="webra",\n' +
        '    certificate_id="abc123",\n' +
        '    data={"revocationReason": "keycompromise"}',
      inputSchema: z.object({
        workflow: z
          .string()
          .describe(
            'Workflow type: enroll, renew, revoke, update, recover, migrate, import.',
          ),
        profile: z.string().describe('Certificate profile name.'),
        module: z
          .string()
          .describe(
            'Profile module type (webra, est, scep, acme, crmp, etc.).',
          ),
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
    },
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
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit\n' +
        'confirmation before calling this tool. Do not proceed without a clear\n' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Approve a pending certificate lifecycle request.\n\n' +
        'Safety tier: mutating-safe\n\n' +
        'Prerequisites: Use search_requests or get_request to find the request ID.\n' +
        'Only pending requests can be approved. Permissions are checked automatically.\n\n' +
        'Checks permissions before attempting the approval. The workflow\n' +
        'type is determined automatically from the request.\n' +
        'If permission is denied, returns an error - do NOT retry.',
      inputSchema: z.object({
        request_id: z.string().describe('The request ID to approve.'),
      }),
    },
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
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit\n' +
        'confirmation before calling this tool. Do not proceed without a clear\n' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Deny a pending certificate lifecycle request.\n\n' +
        'Safety tier: mutating-safe\n\n' +
        'Prerequisites: Use search_requests or get_request to find the request ID.\n' +
        'Only pending requests can be denied. Permissions are checked automatically.\n\n' +
        'Checks permissions before attempting the denial. The workflow\n' +
        'type is determined automatically from the request.\n' +
        'If permission is denied, returns an error - do NOT retry.',
      inputSchema: z.object({
        request_id: z.string().describe('The request ID to deny.'),
      }),
    },
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
    {
      description:
        'STOP - This tool modifies data. You MUST ask the user for explicit\n' +
        'confirmation before calling this tool. Do not proceed without a clear\n' +
        '"yes" from the user. Present what you intend to do and wait.\n\n' +
        'Cancel a pending certificate lifecycle request.\n\n' +
        'Safety tier: mutating-safe\n\n' +
        'Prerequisites: Use search_requests or get_request to find the request ID.\n' +
        'Only pending requests can be cancelled. Permissions are checked automatically.\n\n' +
        'Checks permissions before attempting the cancellation. The workflow\n' +
        'type is determined automatically from the request.\n' +
        'If permission is denied, returns an error - do NOT retry.',
      inputSchema: z.object({
        request_id: z.string().describe('The request ID to cancel.'),
      }),
    },
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
    {
      description:
        'Search certificate lifecycle requests using HRQL query language.\n\n' +
        'Safety tier: read-only\n\n' +
        "HRQL syntax - use 'equals', 'before', 'after', NOT =, <, >.\n" +
        'IMPORTANT: HRQL field names are ALL LOWERCASE with dots for dates\n' +
        '(registration.date, modification.date - NOT registrationDate, lastModificationDate).\n' +
        'Examples:\n' +
        '  workflow equals "enroll" and status equals "pending"\n' +
        '  status equals "denied" and modification.date after 30d\n' +
        '  profile equals "TLS-Internal" and requester contains "admin"\n' +
        'Full reference: horizon://knowledge/query-languages\n\n' +
        'Results are paginated and field-truncated - use get_request for\n' +
        'full untruncated data on a specific request.\n\n' +
        "sorted_by format: 'element' or 'element:Desc'.\n" +
        'Sortable elements: _id, module, workflow, status, profile, requester,\n' +
        '  approver, team, owner, contact, requesterComment, approverComment,\n' +
        '  certificateId, certificate, dn, registrationDate, lastModificationDate,\n' +
        '  expirationDate, holderId, labels, metadata, releaseAt\n\n' +
        'Presets:\n' +
        '  - compact (default): workflow, status, profile, module, requester,\n' +
        '    approver, registrationDate, lastModificationDate\n' +
        '  - diagnostic: adds certificate, dn, requesterComment, approverComment\n' +
        '  - compliance: adds dn, certificateId\n\n' +
        'Usable return fields: _id, approver, approverComment, certificate,\n' +
        '  certificateId, contact, dn, expirationDate, holderId, label.<key>,\n' +
        '  labels, lastModificationDate, metadata, metadata.<key>, module,\n' +
        '  owner, profile, registrationDate, releaseAt, requester,\n' +
        '  requesterComment, status, team, workflow\n\n' +
        'See also: get_request (full details by ID), aggregate_requests (group-by analytics),\n' +
        '    export_requests_csv (bulk CSV export).\n\n' +
        'Pagination protocol (READ CAREFULLY):\n' +
        '  - page_index is 0-based. First page is page_index=0.\n' +
        '  - Response always includes has_more and next_page_index.\n' +
        '  - To fetch the next page: call again with page_index = next_page_index.\n' +
        '  - Stop when has_more=false or next_page_index=null.\n' +
        '  - Pass sorted_by for deterministic ordering across pages.\n' +
        '  - with_count=true (default) makes total available so the model\n' +
        '    knows up-front how many pages to expect.',
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
    },
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
      };
    },
  );

  registerTool(
    server,
    'get_request',
    {
      description:
        'Get full details of a certificate lifecycle request by ID.\n\n' +
        'Safety tier: read-only\n\n' +
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
    },
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
    {
      description:
        'Export requests matching an HRQL query as CSV (bounded export helper).\n\n' +
        'Safety tier: read-only\n\n' +
        'Returns up to 1000 rows. For full exports use Horizon UI.\n' +
        "HRQL syntax - use 'equals', 'before', 'after', NOT =, <, >.\n" +
        'IMPORTANT: HRQL field names are ALL LOWERCASE (registration.date, NOT registrationDate).\n' +
        'Full reference: horizon://knowledge/query-languages',
      inputSchema: z.object({
        query: z.string().describe('HRQL query expression.'),
        fields: z
          .array(z.string())
          .optional()
          .describe('Fields to include in the CSV export.'),
        sorted_by: z
          .string()
          .optional()
          .describe("Sort field, e.g. 'registrationDate:Desc'."),
      }),
    },
    async ({ query, fields, sorted_by }) => {
      const payload = buildExportPayload(query, fields, sorted_by);
      const csvText = await client.postText('/api/v1/requests/csv', payload, {
        timeout: CSV_TIMEOUT,
      });
      const metadata = csvTruncationMetadata(csvText);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ csv: csvText, ...metadata }),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'aggregate_requests',
    {
      description:
        'Aggregate requests by groupBy dimensions using HRQL query.\n\n' +
        'Safety tier: read-only\n\n' +
        'Returns counts grouped by the specified fields - ideal for\n' +
        "workflow analytics (e.g. 'pending requests by profile?',\n" +
        "'approval rate by approver?').\n\n" +
        "HRQL syntax - use 'equals', 'matches', 'before', 'after', NOT =/</>.\\n" +
        'IMPORTANT - TWO different naming contexts:\n' +
        '  - query field names are ALL LOWERCASE: registration.date, modification.date\n' +
        '  - groupBy field names are camelCase: registrationDate, lastModificationDate\n' +
        'Full reference: horizon://knowledge/query-languages\n\n' +
        'Example (note lowercase query vs camelCase groupBy):\n' +
        '  query="status equals \\"pending\\" and registration.date after 30d",\n' +
        '  group_by=["workflow", "registrationDate.month"]\n\n' +
        'Valid groupBy fields (camelCase): approver, contact, module, profile, requester,\n' +
        'status, workflow, team, owner, dn,\n' +
        'expirationDate.day/month/year,\n' +
        'lastModificationDate.day/month/year,\n' +
        'registrationDate.day/month/year, label.*, metadata.*',
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
    },
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
