/**
 * Natural language to HQL translation tool.
 *
 * 1 tool: translate_to_hql
 *
 * Translates natural language descriptions into syntactically valid
 * Horizon Query Language expressions (HCQL, HRQL, HEQL, or HDQL).
 *
 * Every query fragment is assembled from whitelisted, known-valid patterns
 * so the output is syntactically correct by construction. An optional
 * validation step confirms it against the live Horizon instance.
 *
 * Knowledge resources:
 *   - horizon://knowledge/query-languages
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { registerTool } from '../register.js';
import { QUERY_METADATA } from './query.js';

// Cap user-provided text before any regex evaluation. The extractor runs
// many RegExp matches per request against patterns with alternation and
// quantifiers, so unbounded input is a ReDoS risk. 4096 bytes is far above
// realistic natural-language query lengths.
export const MAX_TRANSLATE_INPUT_BYTES = 4096;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

export interface Condition {
  readonly fragment: string;
  readonly reason: string;
  readonly confidence: number;
}

function condition(
  fragment: string,
  reason: string,
  confidence = 0.9,
): Condition {
  return { fragment, reason, confidence };
}

// ---------------------------------------------------------------------------
// Intent detection - weighted keyword scoring
// ---------------------------------------------------------------------------

export type QueryType = 'hcql' | 'hrql' | 'heql' | 'hdql';

const INTENT_KEYWORDS: Readonly<Record<QueryType, Record<string, number>>> = {
  hcql: {
    certificate: 10,
    cert: 10,
    certs: 10,
    expir: 8,
    revok: 8,
    revocation: 8,
    issuer: 7,
    subject: 7,
    dn: 7,
    serial: 7,
    key: 4,
    rsa: 5,
    ecdsa: 5,
    eddsa: 5,
    grade: 6,
    san: 7,
    thumbprint: 7,
    selfsigned: 8,
    'self-signed': 8,
    archived: 6,
    discovered: 6,
    escrowed: 6,
    trusted: 5,
    keytype: 7,
  },
  hrql: {
    request: 10,
    requests: 10,
    enroll: 9,
    enrollment: 9,
    approv: 9,
    approval: 9,
    approved: 9,
    deny: 9,
    denied: 9,
    rejection: 9,
    pending: 8,
    workflow: 8,
    requester: 7,
    cancel: 7,
    cancelled: 7,
    submit: 7,
    submitted: 7,
  },
  heql: {
    event: 10,
    events: 10,
    audit: 10,
    log: 8,
    logs: 8,
    action: 5,
    activity: 6,
    node: 6,
  },
  hdql: {
    discover: 10,
    discovery: 10,
    scan: 9,
    netscan: 9,
    host: 8,
    hostname: 8,
    port: 7,
    tls: 8,
    campaign: 7,
    network: 6,
    ip: 6,
  },
};

// Shared keywords (weak signal - only used for tie-breaking)
const SHARED_KEYWORDS: Readonly<Record<string, number>> = {
  profile: 2,
  team: 2,
  owner: 2,
  module: 2,
};

const QUERY_TYPES: readonly QueryType[] = ['hcql', 'hrql', 'heql', 'hdql'];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectIntent(text: string): {
  queryType: QueryType;
  confidence: number;
} {
  const lower = text.toLowerCase();
  const scores: Record<QueryType, number> = {
    hcql: 0,
    hrql: 0,
    heql: 0,
    hdql: 0,
  };

  for (const qt of QUERY_TYPES) {
    const keywords = INTENT_KEYWORDS[qt];
    for (const [kw, weight] of Object.entries(keywords)) {
      if (new RegExp(`\\b${escapeRegex(kw)}\\w*\\b`).test(lower)) {
        scores[qt] += weight;
      }
    }
  }

  // Add shared keywords to all types equally (tie-break only)
  for (const [kw, weight] of Object.entries(SHARED_KEYWORDS)) {
    if (new RegExp(`\\b${escapeRegex(kw)}\\w*\\b`).test(lower)) {
      for (const qt of QUERY_TYPES) {
        scores[qt] += weight;
      }
    }
  }

  let best: QueryType = 'hcql';
  for (const qt of QUERY_TYPES) {
    if (scores[qt] > scores[best]) {
      best = qt;
    }
  }

  const total = QUERY_TYPES.reduce((sum, qt) => sum + scores[qt], 0);

  if (total === 0) {
    return { queryType: 'hcql', confidence: 0.3 }; // default fallback
  }

  let confidence = scores[best] / Math.max(total, 1);
  if (scores[best] >= 10) {
    confidence = Math.min(confidence + 0.2, 1.0);
  }
  return { queryType: best, confidence: Math.round(confidence * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toDuration(amount: number, unit: string): string {
  if (unit === 'day' || unit === 'days') return `${amount}d`;
  if (unit === 'hour' || unit === 'hours') return `${amount}h`;
  if (unit === 'minute' || unit === 'minutes') return `${amount}m`;
  if (unit === 'second' || unit === 'seconds') return `${amount}s`;
  if (unit === 'week' || unit === 'weeks') return `${amount * 7}d`;
  if (unit === 'month' || unit === 'months') return `${amount * 30}d`;
  return `${amount}d`;
}

const DEFAULT_DATE_FIELDS: Readonly<
  Record<QueryType, { future: string; past: string }>
> = {
  hcql: { future: 'valid.until', past: 'valid.from' },
  hrql: { future: 'expiration.date', past: 'registration.date' },
  heql: { future: 'timestamp', past: 'timestamp' },
  hdql: { future: 'timestamp', past: 'timestamp' },
};

function extractDateConditions(
  text: string,
  conditions: Condition[],
  queryType: QueryType,
): void {
  // "next / within / coming N units"
  let m = text.match(
    /(?:in\s+the\s+)?(?:next|within|coming)\s+(\d+)\s+(day|hour|minute|second|week|month)s?/,
  );
  if (m) {
    const dur = toDuration(parseInt(m[1]!, 10), m[2]!);
    // Context: "expiring in next 30 days" -> valid.until before 30d
    const field = /expir/.test(text)
      ? 'valid.until'
      : DEFAULT_DATE_FIELDS[queryType].future;
    conditions.push(
      condition(`${field} before ${dur}`, `within the next ${m[1]} ${m[2]}(s)`),
    );
    return;
  }

  // "last / past / previous N units"
  m = text.match(
    /(?:in\s+the\s+)?(?:last|past|previous)\s+(\d+)\s+(day|hour|minute|second|week|month)s?/,
  );
  if (m) {
    const dur = toDuration(parseInt(m[1]!, 10), m[2]!);
    let field = DEFAULT_DATE_FIELDS[queryType].past;
    if (/expir/.test(text)) {
      field = 'valid.until';
    } else if (/revok|revoc/.test(text) && queryType === 'hcql') {
      field = 'revocation.date'; // only HCQL has revocation.date
    } else if (/register|submit/.test(text)) {
      field = 'registration.date';
    }
    conditions.push(
      condition(`${field} after -${dur}`, `in the last ${m[1]} ${m[2]}(s)`),
    );
    return;
  }

  // "expiring in N days" (without explicit next/last)
  m = text.match(/expir\w*\s+(?:in\s+)?(\d+)\s+(day|hour|minute|week|month)s?/);
  if (m) {
    const dur = toDuration(parseInt(m[1]!, 10), m[2]!);
    conditions.push(
      condition(
        `valid.until before ${dur}`,
        `expiring within ${m[1]} ${m[2]}(s)`,
      ),
    );
    return;
  }

  // "expiring soon" (no number)
  if (/expir\w*\s+soon/.test(text)) {
    conditions.push(
      condition('valid.until before 30d', 'expiring soon (within 30 days)'),
    );
  }
}

function globToRegex(glob: string): string {
  return glob
    .replace(/\\/g, '\\\\')
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
}

function chooseOperator(
  value: string,
  field: string,
): { operator: string; formatted: string } {
  if (value.includes('*') || value.includes('?')) {
    return { operator: 'matches', formatted: globToRegex(value) };
  }
  if (['dn', 'issuer', 'san'].includes(field) && value.includes('.')) {
    // Use contains for simple domain-like values - cleaner than regex
    return { operator: 'contains', formatted: value };
  }
  return { operator: 'equals', formatted: value };
}

// Field-value extraction patterns: [regex, hql_field, label]
type FieldPattern = readonly [string, string, string];

const FIELD_PATTERNS: Readonly<Record<string, readonly FieldPattern[]>> = {
  hcql: [
    [
      'profile\\s+(?:named?\\s+|called\\s+|=\\s*)?["\']?([\\w][\\w.-]*)["\']?',
      'profile',
      'profile',
    ],
    [
      'team\\s+(?:named?\\s+|called\\s+|=\\s*)?["\']?([\\w][\\w.-]*)["\']?',
      'team',
      'team',
    ],
    ['owner\\s+(?:is\\s+|=\\s*)?["\']?([\\w@._-]+)["\']?', 'owner', 'owner'],
    [
      'issuer\\s+(?:is\\s+|=\\s*|contains?\\s+)?["\']?([\\w\\s.*=,-]+?)["\']?(?:\\s+and\\b|\\s*$)',
      'issuer',
      'issuer',
    ],
    [
      '(?:subject|dn)\\s+(?:match(?:es|ing)?\\s+|contains?\\s+|=\\s*)?["\']?([\\w\\s.*=,-]+?)["\']?(?:\\s+and\\b|\\s*$)',
      'dn',
      'subject/DN',
    ],
    [
      '(?:module|connector)\\s+(?:named?\\s+|=\\s*)?["\']?([\\w][\\w.-]*)["\']?',
      'module',
      'module',
    ],
    [
      '(?:san|subject\\.alt)\\w*\\s+(?:contains?\\s+|match(?:es|ing)?\\s+)?["\']?([\\w.*@-]+)["\']?',
      'san',
      'SAN',
    ],
  ],
  hrql: [
    [
      'profile\\s+(?:named?\\s+|called\\s+|=\\s*)?["\']?([\\w][\\w.-]*)["\']?',
      'profile',
      'profile',
    ],
    [
      'team\\s+(?:named?\\s+|called\\s+|=\\s*)?["\']?([\\w][\\w.-]*)["\']?',
      'team',
      'team',
    ],
    [
      'requester\\s+(?:is\\s+|=\\s*)?["\']?([\\w@._-]+)["\']?',
      'requester',
      'requester',
    ],
    ['owner\\s+(?:is\\s+|=\\s*)?["\']?([\\w@._-]+)["\']?', 'owner', 'owner'],
    [
      '(?:module|connector)\\s+(?:named?\\s+|=\\s*)?["\']?([\\w][\\w.-]*)["\']?',
      'module',
      'module',
    ],
  ],
  heql: [
    [
      '(?:module|connector)\\s+(?:named?\\s+|=\\s*)?["\']?([\\w][\\w.-]*)["\']?',
      'module',
      'module',
    ],
    [
      'node\\s+(?:named?\\s+|=\\s*)?["\']?([\\w][\\w.-]*)["\']?',
      'node',
      'node',
    ],
  ],
  hdql: [
    [
      'source\\s+(?:is\\s+|=\\s*)?["\']?([\\w][\\w.-]*)["\']?',
      'source',
      'source',
    ],
  ],
};

function extractFieldValues(
  text: string,
  conditions: Condition[],
  queryType: string,
): void {
  const patterns = FIELD_PATTERNS[queryType] ?? [];
  for (const [pattern, hqlField, label] of patterns) {
    const m = new RegExp(pattern, 'i').exec(text);
    if (m) {
      const raw = m[1]!.trim().replace(/^['"]|['"]$/g, '');
      if (!raw) continue;
      const { operator: op, formatted: val } = chooseOperator(raw, hqlField);
      conditions.push(
        condition(
          `${hqlField} ${op} "${val}"`,
          op === 'matches'
            ? `${label} matching '${raw}'`
            : `${label} is '${raw}'`,
        ),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Per-type condition extractors
// ---------------------------------------------------------------------------

export function extractHcql(text: string): Condition[] {
  const conditions: Condition[] = [];
  const lower = text.toLowerCase();

  // --- Status ---
  const statusMap: [string, string][] = [
    ['expired', 'expired?'],
    ['revoked', 'revoked?'],
    ['valid', 'valid'],
  ];
  for (const [status, pat] of statusMap) {
    if (new RegExp(`\\bnot?\\s+${pat}\\b`).test(lower)) {
      conditions.push(
        condition(`status is not ${status}`, `non-${status} certificates`),
      );
    } else if (new RegExp(`\\b${pat}\\b`).test(lower)) {
      // Avoid matching "valid.until" as a status reference
      if (status === 'valid' && /valid\.\w+/.test(lower)) {
        continue;
      }
      conditions.push(
        condition(`status is ${status}`, `${status} certificates`),
      );
    }
  }

  // --- Certificate properties ---
  const props: [string, string][] = [
    ['selfsigned', 'self[- ]?signed'],
    ['archived', 'archived?'],
    ['discovered', 'discovered?'],
    ['escrowed', 'escrowed?'],
    ['trusted', 'trusted'],
  ];
  for (const [prop, pat] of props) {
    if (new RegExp(`\\bnot?\\s+${pat}\\b`).test(lower)) {
      conditions.push(condition(`certificate is not ${prop}`, `not ${prop}`));
    } else if (new RegExp(`\\b${pat}\\b`).test(lower)) {
      conditions.push(
        condition(`certificate is ${prop}`, `${prop} certificates`),
      );
    }
  }

  // --- Certificate type ---
  for (const ctype of ['hybrid', 'legacy', 'pqc'] as const) {
    if (new RegExp(`\\b${ctype}\\b`).test(lower)) {
      conditions.push(
        condition(`certificatetype is ${ctype}`, `${ctype} certificate type`),
      );
    }
  }

  // --- Key type ---
  const keyTypes: [string, string][] = [
    ['rsa', 'rsa'],
    ['ec', 'ecdsa|elliptic\\s+curve'],
    ['eddsa', 'eddsa|ed25519|edwards'],
  ];
  for (const [kt, pat] of keyTypes) {
    if (new RegExp(`\\b(?:${pat})\\b`).test(lower)) {
      conditions.push(
        condition(`keytype contains "${kt}"`, `${kt.toUpperCase()} key type`),
      );
      break;
    }
  }

  // --- Grade ---
  let m = lower.match(/grade\s+(?:worse|lower|below)\s+(?:than\s+)?([a-f])\b/);
  if (m) {
    conditions.push(
      condition(
        `grade strictly lower than ${m[1]!.toUpperCase()}`,
        `grade worse than ${m[1]!.toUpperCase()}`,
      ),
    );
  }
  m = lower.match(/grade\s+(?:better|higher|above)\s+(?:than\s+)?([a-f])\b/);
  if (m) {
    conditions.push(
      condition(
        `grade strictly greater than ${m[1]!.toUpperCase()}`,
        `grade better than ${m[1]!.toUpperCase()}`,
      ),
    );
  }

  // --- Trigger results ---
  if (/trigger.*fail|failed?\s+trigger/.test(lower)) {
    conditions.push(
      condition('trigger.results has failure', 'failed triggers'),
    );
  } else if (/trigger.*warn/.test(lower)) {
    conditions.push(
      condition('trigger.results has warning', 'trigger warnings'),
    );
  }

  // --- Dates ---
  extractDateConditions(lower, conditions, 'hcql');

  // --- Field-value pairs ---
  extractFieldValues(text, conditions, 'hcql');

  return conditions;
}

export function extractHrql(text: string): Condition[] {
  const conditions: Condition[] = [];
  const lower = text.toLowerCase();

  // --- Workflow type ---
  const wfMap: [string, string][] = [
    ['enroll', 'enroll'],
    ['revoke', 'revok|revocation'],
    ['renew', 'renew'],
    ['update', 'updat'],
    ['recover', 'recover'],
    ['migrate', 'migrat'],
    ['import', 'import'],
  ];
  for (const [wf, pat] of wfMap) {
    if (new RegExp(`\\b${pat}`).test(lower)) {
      conditions.push(condition(`workflow equals "${wf}"`, `${wf} workflow`));
      break;
    }
  }

  // --- Request status ---
  const statusMap: [string, string][] = [
    ['pending', 'pending'],
    ['approved', 'approved?'],
    ['denied', 'denied?|rejected?'],
    ['cancelled', 'cancell?ed'],
  ];
  for (const [status, pat] of statusMap) {
    if (new RegExp(`\\b${pat}\\b`).test(lower)) {
      conditions.push(
        condition(`status equals "${status}"`, `${status} requests`),
      );
      break;
    }
  }

  extractDateConditions(lower, conditions, 'hrql');
  extractFieldValues(text, conditions, 'hrql');
  return conditions;
}

export function extractHeql(text: string): Condition[] {
  const conditions: Condition[] = [];
  const lower = text.toLowerCase();

  // --- Module filter (protocol / subsystem) ---
  const moduleMap: [string, string, string][] = [
    ['\\bacme\\b', 'ACME', 'ACME'],
    ['\\bscep\\b', 'SCEP', 'SCEP'],
    ['\\best\\b', 'EST', 'EST'],
    ['\\bwcce\\b', 'WCCE', 'WCCE'],
    ['\\bcrmp\\b', 'CRMP', 'CRMP'],
    ['\\bwebra\\b', 'WEBRA', 'WebRA'],
    ['\\bintune\\b', 'INTUNE', 'Intune'],
    ['\\bjamf\\b', 'JAMF', 'Jamf'],
  ];

  let moduleFound = false;
  for (const [pat, moduleVal, label] of moduleMap) {
    if (new RegExp(pat).test(lower)) {
      conditions.push(
        condition(`module equals "${moduleVal}"`, `${label} events`),
      );
      moduleFound = true;
      break;
    }
  }

  // --- Event code filter (only when no module detected) ---
  if (!moduleFound) {
    const codeMap: [string, string, string][] = [
      // --- Lifecycle events ---
      ['\\benroll', 'LIFECYCLE-ENROLL', 'enrollment'],
      ['\\brevok|revocation', 'LIFECYCLE-REVOKE', 'revocation'],
      ['\\brenew', 'LIFECYCLE-RENEW', 'renewal'],
      ['\\bupdat', 'LIFECYCLE-UPDATE', 'update'],
      ['\\brecover', 'LIFECYCLE-RECOVER', 'recovery'],
      ['\\bmigrat', 'LIFECYCLE-MIGRATE', 'migration'],
      ['\\bimport', 'LIFECYCLE-IMPORT', 'import'],
      ['\\bescrow', 'LIFECYCLE-ESCROW', 'key escrow'],
      // --- Request events ---
      [
        '\\brequest.*submit|submit.*request',
        'REQUEST-SUBMIT',
        'request submission',
      ],
      [
        '\\brequest.*approv|approv.*request',
        'REQUEST-APPROVE',
        'request approval',
      ],
      [
        '\\brequest.*deny|deny.*request|denied',
        'REQUEST-DENY',
        'request denial',
      ],
      [
        '\\brequest.*cancel|cancel.*request',
        'REQUEST-CANCEL',
        'request cancellation',
      ],
      // --- Security events ---
      ['\\bauthenticat', 'SEC-AUTHENTICATION', 'authentication'],
      ['\\brole', 'SEC-ROLE', 'role management'],
      ['\\bteam', 'SEC-TEAM', 'team management'],
      // --- Trigger events ---
      ['\\btrigger.*email|email.*trigger', 'TRIGGER-EMAIL', 'email trigger'],
      ['\\btrigger.*push|push.*trigger', 'TRIGGER-PUSH', 'certificate push'],
      ['\\btrigger', 'TRIGGER', 'trigger'],
      // --- Config events ---
      ['\\bconfig.*add|config.*creat', 'CONF-ADD', 'configuration addition'],
      [
        '\\bconfig.*delet|config.*remov',
        'CONF-DELETE',
        'configuration deletion',
      ],
      ['\\bconfig.*updat|config.*modif', 'CONF-UPDATE', 'configuration update'],
      // --- Infrastructure events ---
      ['\\bservice.*start|start.*service', 'SERVICE-START', 'service start'],
      ['\\bservice.*stop|stop.*service', 'SERVICE-STOP', 'service stop'],
      ['\\blicen', 'LICENSE', 'license'],
      ['\\bgrad', 'GRADING', 'grading'],
      ['\\barchiv', 'ARCHIVE', 'archive'],
      ['\\bsync', 'SYNC', 'synchronization'],
      ['\\bdiscovery', 'DISCOVERY', 'discovery'],
      ['\\bbootstrap', 'BOOTSTRAP', 'bootstrap'],
    ];

    for (const [pat, code, label] of codeMap) {
      if (new RegExp(pat).test(lower)) {
        if (code.includes('-')) {
          conditions.push(
            condition(`code equals "${code}"`, `${label} events`),
          );
        } else {
          conditions.push(
            condition(`code contains "${code}"`, `${label} events`),
          );
        }
        break;
      }
    }
  }

  // --- HEQL detail.* fields ---
  // Certificate references -> detail.certificateDn
  // Use a single bounded character class instead of `[\w][\w.*-]*(?:\.[\w.*-]+)*`
  // to avoid the nested-quantifier shape that allows catastrophic backtracking
  // when adjacent dots overlap the outer and inner groups. Combined with the
  // MAX_TRANSLATE_INPUT_BYTES cap this bounds worst-case regex work.
  const certPattern =
    /(?:certificate|cert)\s+(?:named?\s+|called\s+|for\s+)?["']?([\w][\w.*-]{0,127})["']?/;
  let m = certPattern.exec(lower);
  if (m) {
    // Preserve original case from the input text
    const origM = new RegExp(certPattern.source, 'i').exec(text);
    const val = origM ? origM[1]! : m[1]!;
    conditions.push(
      condition(
        `detail.certificateDn contains "${val}"`,
        `certificate matching '${val}'`,
      ),
    );
  }

  // Actor/user references -> detail.actorId
  m = new RegExp(
    '(?:actor|user|by)\\s+(?:is\\s+)?["\']?([\\w@._-]+)["\']?',
    'i',
  ).exec(text);
  if (m) {
    const val = m[1]!.replace(/^['"]|['"]$/g, '');
    if (!['is', 'the', 'a', 'an', 'all'].includes(val)) {
      conditions.push(
        condition(`detail.actorId equals "${val}"`, `actor '${val}'`),
      );
    }
  }

  extractDateConditions(lower, conditions, 'heql');
  extractFieldValues(text, conditions, 'heql');
  return conditions;
}

export function extractHdql(text: string): Condition[] {
  const conditions: Condition[] = [];
  const lower = text.toLowerCase();

  // --- Port ---
  let m = lower.match(/\bport\s+(\d+)\b/);
  if (m) {
    conditions.push(condition(`port equals ${m[1]}`, `port ${m[1]}`));
  }

  // --- IP ---
  m = lower.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?)\b/);
  if (m) {
    conditions.push(condition(`ip equals "${m[1]}"`, `IP ${m[1]}`));
  }

  // --- Hostname ---
  m = lower.match(
    /(?:host(?:name)?|domain|server)\s+(?:is\s+|named?\s+)?["']?([\w.*-]+\.[\w.*-]+)["']?/,
  );
  if (m) {
    const hostname = m[1]!;
    if (hostname.includes('*')) {
      const regex = globToRegex(hostname);
      conditions.push(
        condition(
          `hostname matches "${regex}"`,
          `hostname matching ${hostname}`,
        ),
      );
    } else {
      conditions.push(
        condition(`hostname equals "${hostname}"`, `hostname ${hostname}`),
      );
    }
  }

  // --- Campaign ---
  m = lower.match(/campaign\s+(?:named?\s+)?["']?([\w-]+)["']?/);
  if (m) {
    conditions.push(
      condition(`campaign equals "${m[1]}"`, `campaign '${m[1]}'`),
    );
  }

  extractDateConditions(lower, conditions, 'hdql');
  extractFieldValues(text, conditions, 'hdql');
  return conditions;
}

// ---------------------------------------------------------------------------
// Assembler + validator
// ---------------------------------------------------------------------------

export const EXTRACTORS: Readonly<
  Record<QueryType, (text: string) => Condition[]>
> = {
  hcql: extractHcql,
  hrql: extractHrql,
  heql: extractHeql,
  hdql: extractHdql,
};

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

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

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
        'Safety tier: read-only\n' +
        'Knowledge: horizon://knowledge/query-languages\n\n' +
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
