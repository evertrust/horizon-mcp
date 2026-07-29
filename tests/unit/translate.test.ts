/**
 * Tests for the natural language to HQL translation tool.
 *
 * Covers:
 *   1. Intent detection (query type auto-detection)
 *   2. HCQL condition extraction (statuses, properties, key types, dates, fields, grades)
 *   3. HRQL condition extraction (workflows, statuses, dates)
 *   4. HEQL condition extraction (event codes, dates)
 *   5. HDQL condition extraction (ports, IPs, hostnames, campaigns)
 *   6. Full tool invocation with mock client via MCP protocol
 *   7. Query validity (well-formed HQL from showcase inputs)
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  EXTRACTORS,
  detectIntent,
  extractHcql,
  extractHdql,
  extractHeql,
  extractHrql,
  registerTranslateTools,
} from '../../src/tools/assist/translate.js';
import type { Condition } from '../../src/tools/assist/translate.js';

// ---------------------------------------------------------------------------
// Helper: extract fragment strings from conditions
// ---------------------------------------------------------------------------

function fragments(conditions: readonly Condition[]): string[] {
  return conditions.map((c) => c.fragment);
}

// ---------------------------------------------------------------------------
// 1. Intent detection
// ---------------------------------------------------------------------------

describe('Intent detection', () => {
  it('detects certificates as hcql', () => {
    const { queryType, confidence } = detectIntent('find expired certificates');
    expect(queryType).toBe('hcql');
    expect(confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('detects requests as hrql', () => {
    const { queryType } = detectIntent('pending enrollment requests');
    expect(queryType).toBe('hrql');
  });

  it('detects events as heql', () => {
    const { queryType } = detectIntent('audit events from last week');
    expect(queryType).toBe('heql');
  });

  it('detects discovery as hdql', () => {
    const { queryType } = detectIntent('discovery scans on port 443');
    expect(queryType).toBe('hdql');
  });

  it('defaults ambiguous input to hcql with low confidence', () => {
    const { queryType, confidence } = detectIntent('show me everything');
    expect(queryType).toBe('hcql');
    expect(confidence).toBeLessThan(0.5);
  });

  it('gives high confidence on strong signal', () => {
    const { queryType, confidence } = detectIntent(
      'list all revoked certificates with grade worse than C',
    );
    expect(queryType).toBe('hcql');
    expect(confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ---------------------------------------------------------------------------
// 2. HCQL condition extraction
// ---------------------------------------------------------------------------

describe('HCQL extraction', () => {
  it('extracts expired status', () => {
    expect(fragments(extractHcql('expired certificates'))).toContain(
      'status is expired',
    );
  });

  it('extracts not-revoked status', () => {
    expect(fragments(extractHcql('not revoked certificates'))).toContain(
      'status is not revoked',
    );
  });

  it('extracts valid status', () => {
    expect(fragments(extractHcql('valid certificates'))).toContain(
      'status is valid',
    );
  });

  it('extracts selfsigned property', () => {
    expect(fragments(extractHcql('self-signed certificates'))).toContain(
      'certificate is selfsigned',
    );
  });

  it('extracts not-selfsigned property', () => {
    expect(fragments(extractHcql('not self-signed certificates'))).toContain(
      'certificate is not selfsigned',
    );
  });

  it('extracts discovered property', () => {
    expect(fragments(extractHcql('discovered certificates'))).toContain(
      'certificate is discovered',
    );
  });

  it('extracts RSA key type', () => {
    expect(fragments(extractHcql('RSA certificates'))).toContain(
      'keytype contains "rsa"',
    );
  });

  it('extracts ECDSA key type', () => {
    expect(fragments(extractHcql('ECDSA certificates'))).toContain(
      'keytype contains "ec"',
    );
  });

  it('extracts expiring in N days', () => {
    expect(
      fragments(extractHcql('certificates expiring in 30 days')),
    ).toContain('valid.until before 30d');
  });

  it('extracts expiring soon as 30d default', () => {
    expect(fragments(extractHcql('certificates expiring soon'))).toContain(
      'valid.until before 30d',
    );
  });

  it('extracts next 7 days', () => {
    expect(
      fragments(extractHcql('certificates expiring in the next 7 days')),
    ).toContain('valid.until before 7d');
  });

  it('extracts last 24 hours', () => {
    expect(
      fragments(extractHcql('certificates issued in the last 24 hours')),
    ).toContain('valid.from after -24h');
  });

  it('extracts profile field', () => {
    expect(
      fragments(extractHcql('certificates from profile WebRA-Prod')),
    ).toContain('profile equals "WebRA-Prod"');
  });

  it('extracts team field', () => {
    expect(
      fragments(extractHcql('certificates from team platform-team')),
    ).toContain('team equals "platform-team"');
  });

  it('extracts owner field', () => {
    expect(
      fragments(extractHcql('certificates where owner is admin@corp.io')),
    ).toContain('owner equals "admin@corp.io"');
  });

  it('extracts grade worse than', () => {
    expect(
      fragments(extractHcql('certificates with grade worse than B')),
    ).toContain('grade strictly lower than B');
  });

  it('extracts grade better than', () => {
    expect(
      fragments(extractHcql('certificates with grade better than C')),
    ).toContain('grade strictly greater than C');
  });

  it('extracts trigger failure', () => {
    expect(
      fragments(extractHcql('certificates with failed triggers')),
    ).toContain('trigger.results has failure');
  });

  it('extracts hybrid certificate type', () => {
    expect(fragments(extractHcql('hybrid certificates'))).toContain(
      'certificatetype is hybrid',
    );
  });

  it('handles composite query with multiple conditions', () => {
    const f = fragments(
      extractHcql(
        'expired RSA certificates from team alpha expiring in 30 days',
      ),
    );
    expect(f).toContain('status is expired');
    expect(f).toContain('keytype contains "rsa"');
    expect(f).toContain('team equals "alpha"');
  });

  it('converts weeks to days', () => {
    expect(
      fragments(extractHcql('certificates expiring in the next 2 weeks')),
    ).toContain('valid.until before 14d');
  });

  it('converts months to days', () => {
    expect(
      fragments(extractHcql('certificates issued in the last 3 months')),
    ).toContain('valid.from after -90d');
  });
});

// ---------------------------------------------------------------------------
// 3. HRQL condition extraction
// ---------------------------------------------------------------------------

describe('HRQL extraction', () => {
  it('extracts enrollment workflow and pending status', () => {
    const f = fragments(extractHrql('pending enrollment requests'));
    expect(f).toContain('workflow equals "enroll"');
    expect(f).toContain('status equals "pending"');
  });

  it('extracts denied status', () => {
    expect(fragments(extractHrql('denied requests'))).toContain(
      'status equals "denied"',
    );
  });

  it('extracts revocation workflow with date', () => {
    const f = fragments(extractHrql('revocation requests from last 7 days'));
    expect(f).toContain('workflow equals "revoke"');
    expect(f).toContain('registration.date after -7d');
  });

  it('extracts profile field', () => {
    expect(fragments(extractHrql('requests for profile ACME-Prod'))).toContain(
      'profile equals "ACME-Prod"',
    );
  });

  it('extracts requester field', () => {
    expect(
      fragments(extractHrql('requests where requester is admin')),
    ).toContain('requester equals "admin"');
  });
});

// ---------------------------------------------------------------------------
// 4. HEQL condition extraction
// ---------------------------------------------------------------------------

describe('HEQL extraction', () => {
  it('extracts enrollment event code', () => {
    expect(fragments(extractHeql('enrollment events'))).toContain(
      'code equals "LIFECYCLE-ENROLL"',
    );
  });

  it('extracts last 24h timestamp', () => {
    expect(fragments(extractHeql('events in the last 24 hours'))).toContain(
      'timestamp after -24h',
    );
  });

  it('extracts revocation event code', () => {
    expect(
      fragments(extractHeql('revocation events from last 7 days')),
    ).toContain('code equals "LIFECYCLE-REVOKE"');
  });

  it('extracts ACME module filter', () => {
    expect(fragments(extractHeql('ACME events from last 24 hours'))).toContain(
      'module equals "ACME"',
    );
  });

  it('extracts ACME enrollment with certificate detail', () => {
    const f = fragments(
      extractHeql(
        'find me all the events related to the acme enrollment of certificate toto.local',
      ),
    );
    expect(f).toContain('module equals "ACME"');
    expect(f).toContain('detail.certificateDn contains "toto.local"');
  });

  it('extracts SCEP module filter', () => {
    expect(fragments(extractHeql('SCEP enrollment events'))).toContain(
      'module equals "SCEP"',
    );
  });

  it('extracts EST module filter', () => {
    expect(fragments(extractHeql('EST enrollment events'))).toContain(
      'module equals "EST"',
    );
  });

  it('extracts ACME revocation module filter', () => {
    expect(fragments(extractHeql('ACME revocation events'))).toContain(
      'module equals "ACME"',
    );
  });

  it('extracts authentication event code', () => {
    expect(fragments(extractHeql('authentication events'))).toContain(
      'code equals "SEC-AUTHENTICATION"',
    );
  });

  it('extracts trigger event code', () => {
    expect(fragments(extractHeql('trigger events'))).toContain(
      'code contains "TRIGGER"',
    );
  });

  it('extracts request approval event code', () => {
    expect(fragments(extractHeql('request approval events'))).toContain(
      'code equals "REQUEST-APPROVE"',
    );
  });

  it('extracts actor detail', () => {
    expect(
      fragments(extractHeql('events by admin@corp.io in the last 7 days')),
    ).toContain('detail.actorId equals "admin@corp.io"');
  });
});

// ---------------------------------------------------------------------------
// 5. HDQL condition extraction
// ---------------------------------------------------------------------------

describe('HDQL extraction', () => {
  it('extracts port', () => {
    expect(fragments(extractHdql('scans on port 443'))).toContain(
      'port equals 443',
    );
  });

  it('extracts IP address', () => {
    expect(fragments(extractHdql('scans for 192.168.1.1'))).toContain(
      'ip equals "192.168.1.1"',
    );
  });

  it('extracts hostname', () => {
    expect(fragments(extractHdql('discovery on host example.com'))).toContain(
      'hostname equals "example.com"',
    );
  });

  it('converts hostname glob to regex', () => {
    expect(fragments(extractHdql('discovery on host *.example.com'))).toContain(
      'hostname matches ".*\\.example\\.com"',
    );
  });

  it('extracts campaign', () => {
    expect(fragments(extractHdql('discovery campaign weekly-scan'))).toContain(
      'campaign equals "weekly-scan"',
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Full tool invocation via MCP protocol
// ---------------------------------------------------------------------------

describe('Tool invocation via MCP', () => {
  let mcpClient: Client;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const server = new McpServer({ name: 'translate-test', version: '0.0.0' });

    mockPost = vi.fn().mockResolvedValue({ count: 42, hasMore: true });

    const horizonClient: any = {
      get: vi.fn(),
      post: mockPost,
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      getBytes: vi.fn(),
      getText: vi.fn(),
      postText: vi.fn(),
      postMultipart: vi.fn(),
      request: vi.fn(),
      close: vi.fn(),
      fetchCsrfToken: vi.fn(),
      exportTimeout: 120000,
      principalName: undefined,
      horizonVersion: undefined,
    };

    registerTranslateTools(server, horizonClient);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    mcpClient = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([
      mcpClient.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  it('produces full translation with validation', async () => {
    const result = await mcpClient.callTool({
      name: 'translate_to_hql',
      arguments: {
        natural_language: 'expired RSA certificates from team alpha',
      },
    });

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const data = JSON.parse(text);

    expect(data.query_type).toBe('hcql');
    expect(data.query).toBeTruthy();
    expect(data.query).toContain('status is expired');
    expect(data.query).toContain('keytype contains "rsa"');
    expect(data.confidence).toBeGreaterThanOrEqual(0.5);
    expect(data.explanation.length).toBeGreaterThanOrEqual(2);
    expect(data.validation.valid).toBe(true);
    expect(data.validation.count).toBe(42);
  });

  it('produces translation without validation', async () => {
    const result = await mcpClient.callTool({
      name: 'translate_to_hql',
      arguments: {
        natural_language: 'pending enrollment requests',
        validate: false,
      },
    });

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const data = JSON.parse(text);

    expect(data.query_type).toBe('hrql');
    expect(data.query).toContain('workflow equals "enroll"');
    expect(data.query).toContain('status equals "pending"');
    expect(data).not.toHaveProperty('validation');
  });

  it('respects forced target_type', async () => {
    const result = await mcpClient.callTool({
      name: 'translate_to_hql',
      arguments: {
        natural_language: 'expired items from last week',
        target_type: 'hrql',
        validate: false,
      },
    });

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const data = JSON.parse(text);

    expect(data.query_type).toBe('hrql');
  });

  it('returns error for invalid target_type', async () => {
    const result = await mcpClient.callTool({
      name: 'translate_to_hql',
      arguments: {
        natural_language: 'anything',
        target_type: 'invalid',
        validate: false,
      },
    });

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const data = JSON.parse(text);

    expect(data).toHaveProperty('error');
    expect(data).toHaveProperty('valid_types');
  });

  it('returns field reference when no conditions extracted', async () => {
    const result = await mcpClient.callTool({
      name: 'translate_to_hql',
      arguments: {
        natural_language: 'show me everything',
        validate: false,
      },
    });

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const data = JSON.parse(text);

    expect(data.query).toBeNull();
    expect(data).toHaveProperty('field_reference');
    expect(data).toHaveProperty('message');
  });

  it('captures validation failure gracefully', async () => {
    // Override post to throw for this specific test
    mockPost.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await mcpClient.callTool({
      name: 'translate_to_hql',
      arguments: {
        natural_language: 'expired certificates',
      },
    });

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const data = JSON.parse(text);

    expect(data.query).toBe('status is expired');
    expect(data.validation.valid).toBe(false);
    expect(data.validation.error).toContain('Connection refused');
  });
});

// ---------------------------------------------------------------------------
// 7. Query validity - all produced fragments are well-formed HQL
// ---------------------------------------------------------------------------

describe('Query validity', () => {
  const SHOWCASE_INPUTS = [
    'expired RSA certificates from team-alpha',
    'self-signed certificates expiring in the next 30 days',
    'discovered certificates with grade worse than B',
    'valid ECDSA certificates from profile WebRA-Prod',
    'certificates with failed triggers from last 7 days',
    'pending enrollment requests for the ACME profile',
    'denied revocation requests from last month',
    'audit events in the last 24 hours',
    'enrollment events from last 7 days',
    'discovery scans on port 443',
    'discovery on host *.example.com',
  ];

  it.each(SHOWCASE_INPUTS)(
    'produces at least one condition for: %s',
    (nlInput) => {
      const { queryType } = detectIntent(nlInput);
      const conditions = EXTRACTORS[queryType](nlInput);
      expect(
        conditions.length,
        `No conditions extracted from: ${nlInput}`,
      ).toBeGreaterThan(0);
    },
  );

  it.each(SHOWCASE_INPUTS)(
    'produces valid HQL fragments for: %s',
    (nlInput) => {
      const { queryType } = detectIntent(nlInput);
      const conditions = EXTRACTORS[queryType](nlInput);
      const query = conditions.map((c) => c.fragment).join(' and ');

      // Balanced quotes
      expect(
        query.split('"').length % 2,
        `Unbalanced quotes in: ${query}`,
      ).toBe(1);

      // No double spaces
      expect(query).not.toContain('  ');

      // No leading/trailing whitespace
      expect(query).toBe(query.trim());
    },
  );
});

// ---------------------------------------------------------------------------
// 8. ReDoS guard - oversized input is rejected fast
// ---------------------------------------------------------------------------

describe('Oversized input guard', () => {
  let mcpClient: Client;

  beforeAll(async () => {
    const server = new McpServer({
      name: 'translate-redos-test',
      version: '0.0.0',
    });

    const horizonClient: any = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      getBytes: vi.fn(),
      getText: vi.fn(),
      postText: vi.fn(),
      postMultipart: vi.fn(),
      request: vi.fn(),
      close: vi.fn(),
      fetchCsrfToken: vi.fn(),
      exportTimeout: 120000,
      principalName: undefined,
      horizonVersion: undefined,
    };

    registerTranslateTools(server, horizonClient);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    mcpClient = new Client({ name: 'redos-test-client', version: '0.0.0' });
    await Promise.all([
      mcpClient.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  it('rejects oversized input fast (under 50 ms)', async () => {
    // 5000 bytes of "cert " repeated - well above the 4096-byte cap and
    // crafted to look like input the cert pattern would scan.
    const oversized = 'cert '.repeat(1000);
    expect(oversized.length).toBeGreaterThan(4096);

    const start = performance.now();
    const result = await mcpClient.callTool({
      name: 'translate_to_hql',
      arguments: { natural_language: oversized, validate: false },
    });
    const elapsedMs = performance.now() - start;

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const data = JSON.parse(text);

    expect(data).toHaveProperty('error');
    expect(String(data.error)).toMatch(/exceeds 4096-byte limit/);
    expect(
      elapsedMs,
      `oversized input took ${elapsedMs}ms, expected <50ms`,
    ).toBeLessThan(50);
  });
});
