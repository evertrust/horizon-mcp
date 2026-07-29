/**
 * Query language validation and introspection tools.
 *
 * 5 tools covering the four Horizon query languages (HCQL, HRQL, HEQL, HDQL)
 * plus a local field-metadata tool for discovering available fields and syntax.
 *
 * Knowledge resources:
 *   - horizon://knowledge/query-languages
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { registerTool } from '../register.js';

// ---------------------------------------------------------------------------
// Field metadata - pre-built from known Horizon source fields
// ---------------------------------------------------------------------------

interface FieldEntry {
  readonly name: string;
  readonly type: string;
  readonly note?: string;
}

const COMMON_DATE_FORMATS = [
  'now',
  'today',
  'YYYY',
  'YYYY-MM',
  'YYYY-MM-DD',
  'YYYY-MM-DDTHH',
  'YYYY-MM-DDTHH:mm',
  'YYYY-MM-DDTHH:mm:ss',
  '30d (relative, unquoted - days)',
  '24h (relative, unquoted - hours)',
  '5m (relative, unquoted - minutes)',
  '60s (relative, unquoted - seconds)',
  '-30d (negative relative - 30 days in the past)',
] as const;

const COMMON_COMBINATORS = [
  'and (&&)',
  'or (||)',
  'not',
  'parentheses',
] as const;

const HCQL_FIELDS: readonly FieldEntry[] = [
  { name: 'dn', type: 'string' },
  { name: 'serial', type: 'string' },
  { name: 'issuer', type: 'string' },
  { name: 'profile', type: 'string' },
  { name: 'module', type: 'string' },
  { name: 'owner', type: 'string' },
  { name: 'team', type: 'string' },
  { name: 'san', type: 'string' },
  { name: 'holderid', type: 'string' },
  { name: 'contactemail', type: 'string' },
  { name: 'keytype', type: 'string' },
  { name: 'primarykeytype', type: 'string' },
  { name: 'alternatekeytype', type: 'string' },
  { name: 'signingalgorithm', type: 'string' },
  { name: 'thumbprint', type: 'string' },
  { name: 'publickeythumbprint', type: 'string' },
  { name: 'valid.from', type: 'date' },
  { name: 'valid.until', type: 'date' },
  { name: 'revocation.date', type: 'date' },
  { name: 'revocation.reason', type: 'string' },
  { name: 'purge.date', type: 'date' },
  { name: 'id', type: 'id' },
  { name: 'grade', type: 'grade' },
  { name: 'grade.*', type: 'grade' },
  { name: 'trigger.results', type: 'special' },
  { name: 'label.*', type: 'string' },
  {
    name: 'metadata.<key>',
    type: 'string',
    note:
      'restricted keys: pki_connector, scep_transid, certeurope_id, ' +
      'digicert_id, digicert_order_id, entrust_id, fcms_id, gsatlas_id, ' +
      'gs_order_id, metapki_id, eviden_idca_id, nameshield_id, ' +
      'renewed_certificate_id, previous_certificate_id, ' +
      'automation_policy, contact_email',
  },
  { name: 'discoverydata.ip', type: 'string' },
  { name: 'discoverydata.tls.version', type: 'string' },
  { name: 'discoverydata.hostnames', type: 'string' },
  { name: 'discoverydata.operatingsystems', type: 'string' },
  { name: 'discoverydata.sources', type: 'string' },
  { name: 'discoverydata.tls.port', type: 'number' },
  { name: 'discoveryinfo.campaign', type: 'string' },
  { name: 'thirdparty.connector', type: 'string' },
  { name: 'thirdparty.id', type: 'string' },
  { name: 'thirdparty.fingerprint', type: 'string' },
];

const HCQL_SPECIAL_CONDITIONS = [
  'status is [not] expired|revoked|valid',
  'certificate is [not] archived|escrowed|trusted|selfsigned|discovered',
  'certificatetype is [not] hybrid|legacy|pqc|unknown',
  'trigger.results has [no] success|failure|warning',
] as const;

const HCQL_GROUPBY_FIELDS = [
  'profile',
  'module',
  'keytype',
  'owner',
  'team',
] as const;

const HRQL_FIELDS: readonly FieldEntry[] = [
  { name: 'id', type: 'id' },
  { name: 'module', type: 'string' },
  { name: 'workflow', type: 'string' },
  { name: 'profile', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'requester', type: 'string' },
  { name: 'approver', type: 'string' },
  { name: 'team', type: 'string' },
  { name: 'owner', type: 'string' },
  { name: 'contact', type: 'string' },
  { name: 'dn', type: 'string' },
  { name: 'holderid', type: 'string' },
  { name: 'comment.requester', type: 'string' },
  { name: 'comment.approver', type: 'string' },
  { name: 'registration.date', type: 'date' },
  { name: 'modification.date', type: 'date' },
  { name: 'expiration.date', type: 'date' },
  { name: 'label.*', type: 'string' },
];

const HRQL_SPECIAL_CONDITIONS = ['request is [not] valid|expired'] as const;

const HEQL_FIELDS: readonly FieldEntry[] = [
  { name: 'id', type: 'id' },
  { name: 'code', type: 'string' },
  { name: 'node', type: 'string' },
  { name: 'module', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'timestamp', type: 'date' },
  { name: 'purge.date', type: 'date' },
  { name: 'detail.*', type: 'string' },
];

const HDQL_FIELDS: readonly FieldEntry[] = [
  { name: 'id', type: 'id' },
  { name: 'code', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'campaign', type: 'string' },
  { name: 'hostname', type: 'string' },
  { name: 'ip', type: 'string' },
  { name: 'port', type: 'number' },
  { name: 'source', type: 'string' },
  { name: 'actorid', type: 'string' },
  { name: 'certificateid', type: 'id' },
  { name: 'sessionid', type: 'id' },
  { name: 'error.code', type: 'string' },
  { name: 'error.message', type: 'string' },
  { name: 'client.version', type: 'string' },
  { name: 'client.ip', type: 'string' },
  { name: 'client.id', type: 'string' },
  { name: 'timestamp', type: 'date' },
];

// ---------------------------------------------------------------------------
// Query metadata - keyed by query language type
// ---------------------------------------------------------------------------

interface QueryMetadata {
  readonly query_type: string;
  readonly description: string;
  readonly fields: readonly FieldEntry[];
  readonly special_conditions: readonly string[];
  readonly date_formats: readonly string[];
  readonly combinators: readonly string[];
  readonly supports_aggregate: boolean;
  readonly groupby_fields: readonly string[];
  readonly examples: readonly string[];
}

export const QUERY_METADATA: Readonly<Record<string, QueryMetadata>> = {
  hcql: {
    query_type: 'hcql',
    description: 'Horizon Certificate Query Language - search certificates',
    fields: HCQL_FIELDS,
    special_conditions: [...HCQL_SPECIAL_CONDITIONS],
    date_formats: [...COMMON_DATE_FORMATS],
    combinators: [...COMMON_COMBINATORS],
    supports_aggregate: true,
    groupby_fields: [...HCQL_GROUPBY_FIELDS],
    examples: [
      'dn matches ".*example.com" and status is valid',
      'valid.until before 30d and profile equals "MyProfile"',
      'contactemail equals "admin@example.com" and keytype contains "rsa"',
    ],
  },
  hrql: {
    query_type: 'hrql',
    description: 'Horizon Request Query Language - search workflow requests',
    fields: HRQL_FIELDS,
    special_conditions: [...HRQL_SPECIAL_CONDITIONS],
    date_formats: [...COMMON_DATE_FORMATS],
    combinators: [...COMMON_COMBINATORS],
    supports_aggregate: true,
    groupby_fields: [
      'profile',
      'module',
      'workflow',
      'status',
      'requester',
      'team',
    ],
    examples: [
      'workflow equals "enroll" and status equals "pending"',
      'requester equals "admin" and registration.date after 7d',
    ],
  },
  heql: {
    query_type: 'heql',
    description: 'Horizon Event Query Language - search audit events',
    fields: HEQL_FIELDS,
    special_conditions: [],
    date_formats: [...COMMON_DATE_FORMATS],
    combinators: [...COMMON_COMBINATORS],
    supports_aggregate: false,
    groupby_fields: [],
    examples: [
      'code equals "LIFECYCLE-ENROLL" and timestamp after -24h',
      'detail.actorId equals "admin" and detail.certificateDn matches ".*example.com"',
    ],
  },
  hdql: {
    query_type: 'hdql',
    description: 'Horizon Discovery Query Language - search discovery events',
    fields: HDQL_FIELDS,
    special_conditions: [],
    date_formats: [...COMMON_DATE_FORMATS],
    combinators: [...COMMON_COMBINATORS],
    supports_aggregate: false,
    groupby_fields: [],
    examples: [
      'hostname matches ".*example.com"',
      'campaign equals "weekly-scan" and timestamp after 7d',
    ],
  },
};

const VALID_QUERY_TYPES = Object.keys(QUERY_METADATA).sort();

// ---------------------------------------------------------------------------
// Search endpoints used for validation (pageSize=1 probe)
// ---------------------------------------------------------------------------

const SEARCH_ENDPOINTS: Readonly<Record<string, string>> = {
  hcql: '/api/v1/certificates/search',
  hrql: '/api/v1/requests/search',
  heql: '/api/v1/events/search',
  hdql: '/api/v1/discovery/events/search',
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerQueryTools(
  server: McpServer,
  client: HorizonClient,
): void {
  /**
   * Validate a query by executing a minimal search (pageSize=1).
   * If the query is syntactically invalid, Horizon returns a parse error.
   * On success, returns a confirmation with match info.
   */
  async function validateQuery(
    queryType: string,
    query: string,
  ): Promise<{ content: [{ type: 'text'; text: string }] }> {
    const endpoint = SEARCH_ENDPOINTS[queryType]!;
    try {
      const result = await client.post<Record<string, unknown>>(endpoint, {
        query,
        pageSize: 1,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              valid: true,
              query_type: queryType.toUpperCase(),
              query,
              count: result['count'] ?? null,
              has_more: result['hasMore'] ?? null,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              valid: false,
              query_type: queryType.toUpperCase(),
              query,
              error: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
      };
    }
  }

  registerTool(
    server,
    'validate_hql',
    {
      description:
        'Validate a Horizon query (HCQL/HRQL/HEQL/HDQL) by running a minimal ' +
        'search (pageSize=1). Returns {valid, query_type, count?, has_more?, ' +
        'error?}. Field names must be lowercase. ' +
        'Full reference: horizon://knowledge/query-languages.',
      inputSchema: z.object({
        dialect: z
          .enum(['hcql', 'hrql', 'heql', 'hdql'])
          .describe(
            'Query dialect: hcql (certificates), hrql (requests), heql ' +
              '(events), hdql (discovery events).',
          ),
        query: z.string().describe('Query expression to validate.'),
      }),
    },
    async ({ dialect, query }) => validateQuery(dialect, query),
  );

  // Thin aliases - kept for backward compatibility. Same handler, shorter
  // wire footprint. New code should use validate_hql with a dialect.
  const ALIASES: Array<readonly [string, 'hcql' | 'hrql' | 'heql' | 'hdql']> = [
    ['validate_hcql', 'hcql'],
    ['validate_hrql', 'hrql'],
    ['validate_heql', 'heql'],
    ['validate_hdql', 'hdql'],
  ];
  for (const [name, dialect] of ALIASES) {
    registerTool(
      server,
      name,
      {
        description: `Alias of validate_hql with dialect="${dialect}". Prefer validate_hql.`,
        inputSchema: z.object({
          query: z
            .string()
            .describe(`${dialect.toUpperCase()} query to validate.`),
        }),
      },
      async ({ query }) => validateQuery(dialect, query),
    );
  }

  registerTool(
    server,
    'describe_query_fields',
    {
      description:
        'Discover available fields and syntax for Horizon query languages.\n\n' +
        'Returns field metadata, supported operators, date formats, and ' +
        'example queries for the specified query language type. This is a ' +
        'local tool that does not make any API calls.',
      inputSchema: z.object({
        query_type: z
          .string()
          .describe('Query language type - one of: hcql, hrql, heql, hdql.'),
      }),
    },
    async ({ query_type }) => {
      const normalized = query_type.trim().toLowerCase();
      const metadata = QUERY_METADATA[normalized];

      if (!metadata) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Unknown query type '${query_type}'.`,
                valid_types: VALID_QUERY_TYPES,
                hint:
                  'Use one of: hcql (certificates), hrql (requests), ' +
                  'heql (events), hdql (discovery).',
              }),
            },
          ],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(metadata) }],
      };
    },
  );
}
