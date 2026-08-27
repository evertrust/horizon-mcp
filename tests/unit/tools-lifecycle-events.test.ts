import type { Client } from '@modelcontextprotocol/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerLifecycleTools } from '../../src/tools/lifecycle.js';
import {
  type MockClient,
  parseToolResult,
  resetMocks,
  setupServerAndClient,
} from './support/tool-harness.js';

describe('Lifecycle tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient([
      (server, mockClient) => {
        registerLifecycleTools(server, mockClient as any);
      },
    ]);
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('field truncation per tool family', () => {
    const LARGE_STRING = 'a'.repeat(2000); // > MAX_STRING_LEN

    it('search_events passes large detail fields through untouched', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: [{ code: 'X', details: { blob: LARGE_STRING } }],
        count: 1,
      });

      const result = await client.callTool({
        name: 'search_events',
        arguments: { query: 'timestamp after -1h' },
      });
      const parsed = parseToolResult(result);
      const row = (parsed['results'] as Record<string, unknown>[])[0]!;
      const details = row['details'] as Record<string, unknown>;

      expect(details['blob']).toBe(LARGE_STRING);
      // Explicit guard: the cert-specific hint must never appear in an
      // event response. If someone re-enables truncation here the wrong
      // recovery tool would be suggested.
      expect(JSON.stringify(parsed)).not.toContain('get_certificate');
    });

    it('search_certificates still truncates large fields', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: [{ dn: 'CN=test', rawPem: LARGE_STRING }],
        count: 1,
      });

      const result = await client.callTool({
        name: 'search_certificates',
        arguments: { query: '*' },
      });
      const parsed = parseToolResult(result);
      const row = (parsed['results'] as Record<string, unknown>[])[0]!;

      expect(row['rawPem']).not.toBe(LARGE_STRING);
      expect(String(row['rawPem']).length).toBeLessThan(LARGE_STRING.length);
    });
  });

  // ===========================================================================
  // 3. ASSIST TOOLS
  // ===========================================================================
});
