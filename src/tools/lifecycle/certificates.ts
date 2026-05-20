/**
 * Certificate lifecycle tools.
 *
 * 5 MCP tools:
 *   - search_certificates
 *   - get_certificate
 *   - export_certificates_csv
 *   - download_certificate
 *   - aggregate_certificates
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  CERT_PRESETS,
  CSV_TIMEOUT,
  buildExportPayload,
  buildSearchPayload,
  buildSearchResponse,
  csvTruncationMetadata,
  encodePathSegment,
} from '../helpers.js';
import { registerTool } from '../register.js';

export function registerCertificateTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
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
        '    export_certificates_csv (bulk CSV export).\n\n' +
        'Pagination protocol (READ CAREFULLY):\n' +
        '  - page_index is 0-based. First page is page_index=0.\n' +
        '  - Response always includes has_more (boolean) and next_page_index\n' +
        '    (0-based integer or null if no more pages).\n' +
        '  - To fetch the next page: call again with page_index = next_page_index.\n' +
        '  - Stop when has_more=false or next_page_index=null.\n' +
        '  - For deterministic ordering across pages, ALWAYS pass sorted_by;\n' +
        '    without it the server may reorder rows between requests and you\n' +
        '    will see duplicates or miss records.\n' +
        '  - with_count=true (default) surfaces total in the response so you\n' +
        '    know up-front how many pages to expect.',
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
            "Sort field, e.g. 'notAfter' or 'notAfter:Desc'. Strongly recommended when paginating.",
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

      const response = buildSearchResponse(result, page_index, page_size);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  registerTool(
    server,
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
      const result = await client.get(
        `/api/v1/certificates/${encodePathSegment(certificate_id)}`,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // ===================================================================
  // Certificate CSV Export
  // ===================================================================

  registerTool(
    server,
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

  registerTool(
    server,
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
        `/api/v1/certificates/${encodePathSegment(certificate_id)}`,
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

  registerTool(
    server,
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
}
