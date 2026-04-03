/**
 * Lifecycle tools: certificates, requests, events, aggregation.
 *
 * 17 MCP tools covering the full Horizon certificate lifecycle:
 *   - Certificate search (2): search_certificates, export_certificates_csv
 *   - Certificate operations (2): get_certificate, download_certificate
 *   - Request management (8): get_request_template, submit_request,
 *     approve_request, deny_request, cancel_request, search_requests,
 *     get_request, export_requests_csv
 *   - Event audit (3): search_events, get_event, export_events_csv
 *   - Aggregation (2): aggregate_certificates, aggregate_requests
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { HorizonError } from '../client/errors.js';
import type { HorizonClient } from '../client/http.js';
import {
  CERT_PRESETS,
  CSV_TIMEOUT,
  REQUEST_PRESETS,
  buildExportPayload,
  buildSearchPayload,
  buildSortedBy,
  csvTruncationMetadata,
  preflightRequestAction,
  truncateRecord,
} from './helpers.js';

export function registerLifecycleTools(
  server: McpServer,
  client: HorizonClient,
): void {
  server.registerTool(
    'search_certificates',
    {
      description:
        'Search certificates using HCQL query language.\n\n' +
        'Safety tier: read-only\n\n' +
        'IMPORTANT - HCQL is NOT SQL. Use these operators (not =, <, >, LIKE):\n' +
        '  String: field equals "value" | field matches "regex" | field contains "sub" | field in ("a","b")\n' +
        '  Multi-regex: field within ["regex1", "regex2"]\n' +
        '  Date: field before "2025-06-01" | field after 30d\n' +
        '  Grade: grade greater than C | grade strictly lower than B\n' +
        '  Status: status is valid | status is not revoked\n' +
        '  Logic: and, or, not, parentheses\n\n' +
        'Date formats: "2025-06-01", now, today, 30d, 24h, -30d (relative durations are unquoted)\n' +
        'Supported units: d/days, h/hours, m/minutes, s/seconds (NO weeks or months)\n\n' +
        'Examples (all field names are lowercase - NEVER camelCase):\n' +
        '  module equals "webra" and status is valid\n' +
        '  status is valid and valid.until before 360d and profile equals "TLS-Internal"\n' +
        '  dn matches ".*example\\\\.com" and keytype equals "RSA"\n' +
        '  contactemail equals "user@example.com" or owner equals "user@example.com"\n' +
        '  san contains "example" and status is not revoked\n\n' +
        'Full reference: horizon://knowledge/query-languages\n\n' +
        'IMPORTANT - HCQL vs API field names differ:\n' +
        '  - HCQL query fields are lowercase: contactemail, keytype, signingalgorithm\n' +
        '  - API fields/sorted_by are camelCase: contactEmail, keyType, signingAlgorithm\n' +
        '  - HCQL date fields: valid.until, valid.from\n' +
        '  - API date fields: notAfter, notBefore\n' +
        "  - sorted_by format: 'element' or 'element:Desc' (e.g. 'notAfter:Asc')\n" +
        '  - Sortable elements (API names): _id, module, profile, owner, team,\n' +
        '    discoveredTrusted, thumbprint, selfSigned, publicKeyThumbprint, dn,\n' +
        '    serial, issuer, notBefore, notAfter, revocationDate, revocationReason,\n' +
        '    keyType, signingAlgorithm, holderId, contactEmail, grades, escrowed, removeAt\n\n' +
        'Presets (return fields):\n' +
        '  - compact (default): dn, serial, profile, module, notAfter, keyType, owner, team\n' +
        '  - diagnostic: adds revocationReason, triggerResults, discoverydata.*, contactemail\n' +
        '  - compliance: adds grade, grade.*, signingalgorithm, keytype, notBefore, notAfter\n\n' +
        'The fields parameter overrides the preset if provided.\n\n' +
        'IMPORTANT - Ownership queries: When user asks for "my certificates",\n' +
        'call whoami first to get identifier + teams, then query BOTH:\n' +
        '  owner equals "<id>" or team in ("<team1>", "<team2>", ...)\n' +
        'Full reference: horizon://knowledge/query-languages (Ownership Patterns section).\n\n' +
        'See also: whoami (get identity + teams for ownership queries),\n' +
        '    get_certificate (full details by ID), aggregate_certificates (group-by analytics),\n' +
        '    export_certificates_csv (bulk CSV export).',
      inputSchema: z.object({
        query: z.string().describe('HCQL query expression.'),
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
          .describe('Page index (0-based).'),
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
          .describe("Sort field, e.g. 'notAfter' or 'notAfter:Desc'."),
        with_count: z
          .boolean()
          .default(false)
          .describe('Include total count in response.'),
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
        fields ?? CERT_PRESETS[preset] ?? CERT_PRESETS['compact']!;
      const payload = buildSearchPayload(
        query,
        effectiveFields,
        page_index,
        page_size,
        sorted_by,
        with_count,
      );
      const result = await client.post<Record<string, unknown>>(
        '/api/v1/certificates/search',
        payload,
      );

      let records = (result['results'] ?? result['items'] ?? []) as Record<
        string,
        unknown
      >[];
      if (Array.isArray(records)) {
        records = records.map(truncateRecord);
      }

      const response: Record<string, unknown> = { results: records };
      if ('count' in result) response['count'] = result['count'];
      if ('hasMore' in result) response['hasMore'] = result['hasMore'];
      response['pageIndex'] = page_index;
      response['pageSize'] = Math.min(page_size, 100);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  server.registerTool(
    'get_certificate',
    {
      description:
        'Get full certificate details by ID.\n\n' +
        'Safety tier: read-only\n\n' +
        'Returns complete untruncated data including all fields, SANs, ' +
        'extensions, labels, metadata, and discovery data.',
      inputSchema: z.object({
        certificate_id: z.string().describe('Certificate ID.'),
      }),
    },
    async ({ certificate_id }) => {
      const result = await client.get(`/api/v1/certificates/${certificate_id}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // ===================================================================
  // Certificate CSV Export
  // ===================================================================

  server.registerTool(
    'export_certificates_csv',
    {
      description:
        'Export certificates matching an HCQL query as CSV (bounded export helper).\n\n' +
        'Safety tier: read-only\n\n' +
        'Returns up to 1000 rows. For full exports use Horizon UI.\n\n' +
        "HCQL syntax - use 'equals', 'before', 'after', NOT =, <, >.\n" +
        'IMPORTANT: HCQL field names are ALL LOWERCASE (keytype, contactemail - NOT keyType, contactEmail).\n' +
        'Example: status is valid and valid.until before 30d\n' +
        'Full reference: horizon://knowledge/query-languages',
      inputSchema: z.object({
        query: z.string().describe('HCQL query expression.'),
        fields: z
          .array(z.string())
          .optional()
          .describe('Fields to include in the CSV export.'),
        sorted_by: z
          .string()
          .optional()
          .describe("Sort field, e.g. 'notAfter' or 'notAfter:Desc'."),
      }),
    },
    async ({ query, fields, sorted_by }) => {
      const payload = buildExportPayload(query, fields, sorted_by);
      const csvText = await client.postText(
        '/api/v1/certificates/csv',
        payload,
        { timeout: CSV_TIMEOUT },
      );
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

  // ===================================================================
  // Download Certificate (PEM only)
  // ===================================================================

  server.registerTool(
    'download_certificate',
    {
      description:
        'Download a certificate in PEM format.\n\n' +
        'Safety tier: read-only\n\n' +
        'Only PEM format is available from the certificate object.\n\n' +
        'IMPORTANT - PKCS#12 / PFX retrieval: The PKCS#12 bundle (certificate +\n' +
        'private key) is NOT stored on the certificate object. For centralized\n' +
        'enrollment (server-side key generation), the PKCS#12 is returned in the\n' +
        '**enrollment request response**. To retrieve it:\n' +
        '1. Use search_requests to find the enrollment request for this certificate\n' +
        '2. Use get_request to fetch the request - the response contains the\n' +
        '   PKCS#12 (base64-encoded) in the pkcs12 or keyStore field\n' +
        'This only works for centralized enrollments where a password was\n' +
        'provided at submission time via submit_request(password=...).',
      inputSchema: z.object({
        certificate_id: z.string().describe('Certificate ID.'),
        format: z
          .string()
          .default('pem')
          .describe("Output format (only 'pem' is supported via the API)."),
      }),
    },
    async ({ certificate_id, format }) => {
      const fmt = format.toLowerCase();
      if (fmt !== 'pem') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  `Only PEM format is available via the API. ` +
                  `For ${fmt.toUpperCase()} format, use the Horizon UI.`,
              }),
            },
          ],
        };
      }

      const cert = await client.get<Record<string, unknown>>(
        `/api/v1/certificates/${certificate_id}`,
      );

      const pem = cert['certificate'] ?? cert['pem'] ?? cert['certificatePEM'];
      if (!pem) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  'Certificate PEM not found in response. ' +
                  'The certificate may not have PEM data available.',
                available_fields: Object.keys(cert),
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              format: 'pem',
              content: pem,
              certificate_id,
            }),
          },
        ],
      };
    },
  );

  // ===================================================================
  // Requests (8)
  // ===================================================================

  server.registerTool(
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

  server.registerTool(
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
      const payload: Record<string, unknown> = {
        workflow,
        profile,
        module,
      };
      if (data) {
        Object.assign(payload, data);
      }
      // Explicit params override anything from data
      if (template !== undefined) payload['template'] = template;
      if (password !== undefined) payload['password'] = password;
      if (certificate_id !== undefined)
        payload['certificateId'] = certificate_id;

      const result = await client.post<Record<string, unknown>>(
        '/api/v1/requests/submit',
        payload,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
        '    export_requests_csv (bulk CSV export).',
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
          .describe('Page index (0-based).'),
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
          .describe("Sort field, e.g. 'registrationDate:Desc'."),
        with_count: z
          .boolean()
          .default(false)
          .describe('Include total count in response.'),
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

      let records = (result['results'] ?? result['items'] ?? []) as Record<
        string,
        unknown
      >[];
      if (Array.isArray(records)) {
        records = records.map(truncateRecord);
      }

      const response: Record<string, unknown> = { results: records };
      if ('count' in result) response['count'] = result['count'];
      if ('hasMore' in result) response['hasMore'] = result['hasMore'];
      response['pageIndex'] = page_index;
      response['pageSize'] = Math.min(page_size, 100);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  server.registerTool(
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
      const result = await client.get(`/api/v1/requests/${request_id}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
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

  // ===================================================================
  // Events (3)
  // ===================================================================

  server.registerTool(
    'search_events',
    {
      description:
        'Search audit events using HEQL query language.\n\n' +
        'Safety tier: read-only\n\n' +
        "HEQL syntax - use 'equals', 'before', 'after', NOT =, <, >.\n" +
        'IMPORTANT: HEQL field names are ALL LOWERCASE (code, timestamp, detail.* - NOT eventType, eventDate).\n' +
        'Examples:\n' +
        '  code equals "LIFECYCLE-ENROLL" and status equals "failure" and timestamp after -24h\n' +
        '  module equals "ACME" and detail.actorId equals "admin@example.com"\n' +
        'Full reference: horizon://knowledge/query-languages\n\n' +
        "sorted_by format: 'element' or 'element:Desc'.\n" +
        'Sortable elements: _id, code, module, node, timestamp, removeAt, status\n\n' +
        'Results are paginated. Events capture all certificate lifecycle actions\n' +
        'including enrollments, revocations, approvals, and configuration changes.',
      inputSchema: z.object({
        query: z.string().describe('HEQL query expression.'),
        page_index: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Page index (0-based).'),
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
          .describe("Sort field, e.g. 'timestamp:Desc'."),
      }),
    },
    async ({ query, page_index, page_size, sorted_by }) => {
      const cappedPageSize = Math.min(page_size, 100);
      const payload: Record<string, unknown> = {
        query,
        pageIndex: page_index,
        pageSize: cappedPageSize,
      };
      const sorted = buildSortedBy(sorted_by);
      if (sorted) payload['sortedBy'] = sorted;

      const result = await client.post<Record<string, unknown>>(
        '/api/v1/events/search',
        payload,
      );

      const records = (result['results'] ?? result['items'] ?? []) as Record<
        string,
        unknown
      >[];
      const response: Record<string, unknown> = { results: records };
      if ('count' in result) response['count'] = result['count'];
      if ('hasMore' in result) response['hasMore'] = result['hasMore'];
      response['pageIndex'] = page_index;
      response['pageSize'] = cappedPageSize;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  server.registerTool(
    'get_event',
    {
      description:
        'Get full details of an audit event by ID.\n\n' +
        'Safety tier: read-only\n\n' +
        'Returns the complete event record including actor, action, target\n' +
        'object, timestamp, and any associated metadata.',
      inputSchema: z.object({
        event_id: z.string().describe('Event ID.'),
      }),
    },
    async ({ event_id }) => {
      const result = await client.get(`/api/v1/events/${event_id}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'export_events_csv',
    {
      description:
        'Export audit events matching an HEQL query as CSV (bounded export helper).\n\n' +
        'Safety tier: read-only\n\n' +
        'Returns up to 1000 rows. For full exports use Horizon UI.\n' +
        "HEQL syntax - use 'equals', 'before', 'after', NOT =, <, >.\n" +
        'IMPORTANT: HEQL field names are ALL LOWERCASE (code, timestamp - NOT eventType, eventDate).\n' +
        'Full reference: horizon://knowledge/query-languages',
      inputSchema: z.object({
        query: z.string().describe('HEQL query expression.'),
        fields: z
          .array(z.string())
          .optional()
          .describe('Fields to include in the CSV export.'),
        sorted_by: z
          .string()
          .optional()
          .describe("Sort field, e.g. 'timestamp:Desc'."),
      }),
    },
    async ({ query, fields, sorted_by }) => {
      const payload = buildExportPayload(query, fields, sorted_by);
      const csvText = await client.postText('/api/v1/events/csv', payload, {
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

  // ===================================================================
  // Aggregation (2)
  // ===================================================================

  server.registerTool(
    'aggregate_certificates',
    {
      description:
        'Aggregate certificates by groupBy dimensions using HCQL query.\n\n' +
        'Safety tier: read-only\n\n' +
        'Returns counts grouped by the specified fields - ideal for\n' +
        "dashboarding, reporting, and distribution analysis (e.g. 'how many\n" +
        "valid certs per profile?', 'key type distribution?').\n\n" +
        "HCQL syntax - use 'equals', 'matches', 'before', 'after', NOT =/</>.\\n" +
        'IMPORTANT - TWO different naming contexts:\n' +
        '  - query field names are ALL LOWERCASE: keytype, contactemail, signingalgorithm\n' +
        '  - groupBy field names are camelCase: keyType, signingAlgorithm, holderId\n' +
        'Full reference: horizon://knowledge/query-languages\n\n' +
        'Example (note lowercase query vs camelCase groupBy):\n' +
        '  query="status is valid and keytype contains \\"rsa\\"",\n' +
        '  group_by=["keyType", "profile"]\n\n' +
        'Valid groupBy fields (camelCase): profile, module, keyType, team, issuer, status,\n' +
        'expired, revoked, graded, signingAlgorithm, selfSigned,\n' +
        'discoveredTrusted, holderId, dn, certificateType,\n' +
        'publicKeyThumbprint, revocationReason,\n' +
        'notAfter.day/month/year, notBefore.day/month/year,\n' +
        'revocationDate.day/month/year, label.*, metadata.*, grade.*\n\n' +
        "NOTE: 'owner' is NOT valid for certificate aggregation (use holderId).",
      inputSchema: z.object({
        query: z
          .string()
          .describe('HCQL filter expression (ALL LOWERCASE field names).'),
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
        '/api/v1/certificates/aggregate',
        payload,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
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
