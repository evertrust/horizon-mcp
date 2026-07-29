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
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  CERT_PRESETS,
  CSV_EXPORT_OUTPUT_SCHEMA,
  CSV_TIMEOUT,
  SEARCH_RESPONSE_OUTPUT_SCHEMA,
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
        'Search certificates with HCQL. Lowercase fields only. Operators: ' +
        'equals, matches, contains, in, within, before, after, greater than, ' +
        'is, is not, and/or/not. Full reference: horizon://knowledge/query-languages. ' +
        'Ownership: call whoami first, then `owner equals "<id>" or team in (...)`. ' +
        'Presets: compact (default), diagnostic, compliance. ' +
        'Pagination: page_index is 0-based; next call uses next_page_index from ' +
        'the previous response; stop when has_more is false. Always pass sorted_by ' +
        'for stable ordering across pages.',
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
      outputSchema: SEARCH_RESPONSE_OUTPUT_SCHEMA,
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
        structuredContent: response,
      };
    },
  );

  registerTool(
    server,
    'get_certificate',
    {
      description:
        'Get full certificate details by ID.\n\n' +
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
        'Export certificates matching an HCQL query as CSV (max 1000 rows; ' +
        'use Horizon UI for full exports). HCQL query fields are lowercase; the ' +
        'CSV `fields` columns are camelCase (see the fields param). ' +
        'Full reference: horizon://knowledge/query-languages.',
      inputSchema: z.object({
        query: z.string().describe('HCQL query expression.'),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            'CSV columns to include, as camelCase API column names (SearchResult ' +
              'columns) - NOT the lowercase HCQL query fields. Examples: dn, ' +
              'serial, contactEmail, autoRenew, module, profile, notAfter. Prefix ' +
              'families: label.<key>, metadata.<key>, grade.<policy>, ' +
              'team.displayname.<lang>. Invalid names return a Horizon 500 that ' +
              'lists the usable columns.',
          ),
        sorted_by: z
          .string()
          .optional()
          .describe("Sort field, e.g. 'notAfter' or 'notAfter:Desc'."),
      }),
      outputSchema: CSV_EXPORT_OUTPUT_SCHEMA,
    },
    async ({ query, fields, sorted_by }) => {
      const payload = buildExportPayload(query, fields, sorted_by);
      const csvText = await client.postText(
        '/api/v1/certificates/csv',
        payload,
        { timeout: CSV_TIMEOUT },
      );
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

  // ===================================================================
  // Download Certificate (PEM only)
  // ===================================================================

  registerTool(
    server,
    'download_certificate',
    {
      description:
        'Download a certificate as PEM. Returned as an embedded resource ' +
        '(application/x-pem-file). The PKCS#12 bundle is not on the certificate ' +
        'object; for centralized enrollment or recover requests retrieve it via ' +
        'search_requests + get_request (pkcs12 / keyStore field).',
      inputSchema: z.object({
        certificate_id: z.string().describe('Certificate ID.'),
        format: z
          .enum(['pem'])
          .default('pem')
          .describe("Output format (only 'pem' is supported via the API)."),
      }),
    },
    async ({ certificate_id }) => {
      const cert = await client.get<Record<string, unknown>>(
        `/api/v1/certificates/${encodePathSegment(certificate_id)}`,
      );

      // Horizon 2.10 wraps the GET response as { certificate: {...}, permissions:
      // [...] } with the PEM string at certificate.certificate. Older shapes
      // returned the certificate fields (and PEM) at the top level. Unwrap to the
      // object that actually carries the PEM before extracting it.
      const inner =
        cert['certificate'] !== null && typeof cert['certificate'] === 'object'
          ? (cert['certificate'] as Record<string, unknown>)
          : cert;
      const pem =
        inner['certificate'] ?? inner['pem'] ?? inner['certificatePEM'];
      if (!pem) {
        return {
          isError: true as const,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  'Certificate PEM not found in response. ' +
                  'The certificate may not have PEM data available.',
                available_fields: Object.keys(inner),
              }),
            },
          ],
        };
      }

      const pemText = String(pem);
      const resourceUri = `horizon://certificate/${encodePathSegment(certificate_id)}.pem`;
      return {
        content: [
          {
            // text first for backward compat with clients that read content[0]
            type: 'text' as const,
            text: JSON.stringify({
              format: 'pem',
              content: pemText,
              certificate_id,
              uri: resourceUri,
            }),
          },
          {
            type: 'resource' as const,
            resource: {
              uri: resourceUri,
              mimeType: 'application/x-pem-file',
              text: pemText,
            },
          },
        ],
        structuredContent: {
          certificate_id,
          format: 'pem',
          uri: resourceUri,
        },
      };
    },
  );

  registerTool(
    server,
    'aggregate_certificates',
    {
      description:
        'Aggregate certificates by groupBy dimensions using HCQL. ' +
        'Query field names are lowercase; groupBy field names are camelCase ' +
        '(profile, module, keyType, signingAlgorithm, holderId, status, ' +
        'notAfter.day/month/year, label.*, metadata.*, grade.*). ' +
        'Note: owner is not valid for certificate aggregation (use holderId). ' +
        'Full reference: horizon://knowledge/query-languages.',
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
