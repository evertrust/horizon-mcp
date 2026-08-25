import type { Client } from '@modelcontextprotocol/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerCryptoTools } from '../../src/tools/assist/crypto.js';
import { registerQueryTools } from '../../src/tools/assist/query.js';
import { registerSystemTools } from '../../src/tools/assist/system.js';
import {
  type MockClient,
  parseToolResult,
  resetMocks,
  setupServerAndClient,
} from './support/tool-harness.js';

describe('Assist tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient([
      (server, mc) => {
        registerSystemTools(server, mc as any);
        registerQueryTools(server, mc as any);
        registerCryptoTools(server, mc as any);
      },
    ]);
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('whoami', () => {
    it('returns principal', async () => {
      const principal = {
        identifier: 'test-admin',
        name: 'Test Admin',
        roles: ['admin'],
        teams: [],
        permissions: ['*'],
      };
      mockClient.get.mockResolvedValueOnce(principal);

      const result = await client.callTool({
        name: 'whoami',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/security/principals/self',
      );
      expect(parsed['identifier']).toBe('test-admin');
      expect(parsed['roles']).toEqual(['admin']);
    });

    it('tolerates null collection fields (principal in no teams / no roles)', async () => {
      // Horizon serializes absent collections as `null`, not `[]` or omitted.
      // The output schema must accept null or the MCP stack rejects the whole
      // whoami response before the client can read it.
      const principal = {
        identifier: 'svc-account',
        name: 'Service Account',
        team: null,
        teams: null,
        roles: null,
        permissions: null,
      };
      mockClient.get.mockResolvedValueOnce(principal);

      const result = await client.callTool({
        name: 'whoami',
        arguments: {},
      });

      expect((result as { isError?: boolean }).isError).toBeFalsy();
      const parsed = parseToolResult(result);
      expect(parsed['identifier']).toBe('svc-account');
      expect(parsed['teams']).toBeNull();
    });
  });

  describe('decode_x509', () => {
    it('decodes certificate', async () => {
      const decodeResult = {
        subject: { CN: 'test.example.com' },
        issuer: { CN: 'Test CA' },
        notAfter: '2025-12-31T23:59:59Z',
      };
      mockClient.postMultipart.mockResolvedValueOnce(decodeResult);

      const pem =
        '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
      const result = await client.callTool({
        name: 'decode_x509',
        arguments: { pem },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.postMultipart).toHaveBeenCalledOnce();
      const callArgs = mockClient.postMultipart.mock.calls[0]!;
      expect(callArgs[0]).toBe('/api/v1/rfc5280/x509');
      const subject = parsed['subject'] as Record<string, unknown>;
      expect(subject['CN']).toBe('test.example.com');
    });
  });

  describe('validate_hcql', () => {
    it('validates valid query', async () => {
      mockClient.post.mockResolvedValueOnce({
        count: 42,
        hasMore: true,
        results: [],
      });

      const query = 'dn matches ".*example.com" and status is valid';
      const result = await client.callTool({
        name: 'validate_hcql',
        arguments: { query },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledWith(
        '/api/v1/certificates/search',
        { query, pageSize: 1 },
      );
      expect(parsed['valid']).toBe(true);
      expect(parsed['query_type']).toBe('HCQL');
      expect(parsed['count']).toBe(42);
    });

    it('detects invalid query', async () => {
      mockClient.post.mockRejectedValueOnce(
        new Error('Unexpected token at position 5'),
      );

      const result = await client.callTool({
        name: 'validate_hcql',
        arguments: { query: 'bad %%% query' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['valid']).toBe(false);
      expect(parsed['error']).toBeDefined();
    });
  });

  describe('describe_query_fields', () => {
    it('returns HCQL metadata', async () => {
      const result = await client.callTool({
        name: 'describe_query_fields',
        arguments: { query_type: 'hcql' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['query_type']).toBe('hcql');
      expect(parsed['supports_aggregate']).toBe(true);
      const fields = parsed['fields'] as Array<Record<string, unknown>>;
      const fieldNames = fields.map((f) => f['name']);
      expect(fieldNames).toContain('dn');
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it('returns error for unknown type', async () => {
      const result = await client.callTool({
        name: 'describe_query_fields',
        arguments: { query_type: 'sql' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['error']).toBeDefined();
      expect(parsed['valid_types']).toBeDefined();
    });
  });
});
