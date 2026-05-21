/**
 * Intent detection - weighted keyword scoring.
 */
import { QUERY_TYPES, type QueryType } from './types.js';

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
