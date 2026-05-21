/**
 * Registration of the translate_to_hql MCP tool.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../../client/http.js';
import { registerTool } from '../../register.js';
import { QUERY_METADATA } from '../query.js';
import { EXTRACTORS } from './extractors.js';
import { detectIntent } from './intent.js';
import {
  MAX_TRANSLATE_INPUT_BYTES,
  QUERY_TYPES,
  type QueryType,
} from './types.js';

const SEARCH_ENDPOINTS: Readonly<Record<QueryType, string>> = {
  hcql: '/api/v1/certificates/search',
  hrql: '/api/v1/requests/search',
  heql: '/api/v1/events/search',
  hdql: '/api/v1/discovery/events/search',
};

const TYPE_LABELS: Readonly<Record<QueryType, string>> = {
  hcql: 'HCQL (Horizon Certificate Query Language)',
  hrql: 'HRQL (Horizon Request Query Language)',
  heql: 'HEQL (Horizon Event Query Language)',
  hdql: 'HDQL (Horizon Discovery Query Language)',
};

function isQueryType(s: string): s is QueryType {
  return s in EXTRACTORS;
}

export function registerTranslateTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'translate_to_hql',
    {
      description:
        'Translate natural language into a Horizon Query Language expression.\n\n' +
        'Takes a plain-English description and produces a syntactically valid ' +
        'HQL query. Auto-detects the appropriate query type (HCQL for ' +
        'certificates, HRQL for requests, HEQL for events, HDQL for discovery) ' +
        'unless *target_type* is specified.\n\n' +
        'The generated query is optionally validated against the live Horizon ' +
        'instance to confirm syntactic correctness and report match counts.',
      inputSchema: z.object({
        natural_language: z
          .string()
          .describe(
            'Plain-English description of what to search for.\n' +
              'Examples:\n' +
              '- "expired RSA certificates from team-alpha"\n' +
              '- "pending enrollment requests for the ACME profile"\n' +
              '- "audit events in the last 24 hours"\n' +
              '- "discovery scans on port 443"',
          ),
        target_type: z
          .string()
          .optional()
          .describe(
            'Force a specific query type (hcql, hrql, heql, hdql). ' +
              'If omitted the type is auto-detected from the input.',
          ),
        validate: z
          .boolean()
          .default(true)
          .describe(
            'Whether to validate the query against Horizon ' +
              '(default true). Set to false for offline usage.',
          ),
      }),
    },
    async ({ natural_language, target_type, validate }) => {
      // --- Phase 0: cap input length to bound regex work (ReDoS guard) ---
      const inputBytes = Buffer.byteLength(natural_language, 'utf8');
      if (inputBytes > MAX_TRANSLATE_INPUT_BYTES) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  `Input exceeds ${MAX_TRANSLATE_INPUT_BYTES}-byte limit ` +
                  `(got ${inputBytes} bytes). Please shorten your query.`,
              }),
            },
          ],
        };
      }

      // --- Phase 1: detect query type ---
      let qt: QueryType;
      let intentConfidence: number;

      if (target_type !== undefined) {
        const normalized = target_type.trim().toLowerCase();
        if (!isQueryType(normalized)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Unknown query type '${target_type}'.`,
                  valid_types: QUERY_TYPES.slice().sort(),
                }),
              },
            ],
          };
        }
        qt = normalized;
        intentConfidence = 1.0;
      } else {
        const detected = detectIntent(natural_language);
        qt = detected.queryType;
        intentConfidence = detected.confidence;
      }

      // --- Phase 2: extract conditions ---
      const conditions = EXTRACTORS[qt](natural_language);

      if (conditions.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                query_type: qt,
                type_label: TYPE_LABELS[qt],
                query: null,
                confidence: Math.round(intentConfidence * 0.5 * 100) / 100,
                message:
                  'Could not extract specific search conditions from the input. ' +
                  'Use the field reference below to construct the query manually, ' +
                  'or rephrase with specific field names, values, or date ranges.',
                field_reference: QUERY_METADATA[qt],
              }),
            },
          ],
        };
      }

      // --- Phase 3: assemble query ---
      const query = conditions.map((c) => c.fragment).join(' and ');
      const avgConf =
        conditions.reduce((sum, c) => sum + c.confidence, 0) /
        conditions.length;
      const overall =
        Math.round(Math.min(intentConfidence, avgConf) * 100) / 100;

      const result: Record<string, unknown> = {
        query_type: qt,
        type_label: TYPE_LABELS[qt],
        query,
        confidence: overall,
        explanation: conditions.map((c) => ({
          fragment: c.fragment,
          reason: c.reason,
        })),
      };

      // --- Phase 4: validate against live Horizon ---
      if (validate) {
        try {
          const endpoint = SEARCH_ENDPOINTS[qt];
          const resp = await client.post<Record<string, unknown>>(endpoint, {
            query,
            pageSize: 1,
          });
          result['validation'] = {
            valid: true,
            count: resp['count'] ?? null,
            has_more: resp['hasMore'] ?? null,
          };
        } catch (err) {
          result['validation'] = {
            valid: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
}
