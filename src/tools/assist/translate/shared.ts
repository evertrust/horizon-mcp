/**
 * Shared helpers used by all per-language extractors:
 *   - date condition extraction
 *   - field/value extraction
 *   - operator selection / glob-to-regex helpers
 */
import { type Condition, type QueryType, condition } from './types.js';

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

export function extractDateConditions(
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

export function globToRegex(glob: string): string {
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

export function extractFieldValues(
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
