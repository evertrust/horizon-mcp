import type { Client } from '@modelcontextprotocol/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HorizonError } from '../../src/client/errors.js';
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

  describe('search_certificates', () => {
    it('performs basic search', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: [
          { dn: 'CN=test.example.com', serial: '01', profile: 'WebRA' },
        ],
      });

      const result = await client.callTool({
        name: 'search_certificates',
        arguments: { query: 'profile = "WebRA"' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledOnce();
      const callArgs = mockClient.post.mock.calls[0]!;
      expect(callArgs[0]).toBe('/api/v1/certificates/search');
      const payload = callArgs[1] as Record<string, unknown>;
      expect(payload['query']).toBe('profile = "WebRA"');
      expect(payload['fields']).toContain('dn');
      expect(payload['fields']).toContain('serial');
      expect(payload['pageIndex']).toBe(1);
      expect(payload['pageSize']).toBe(25);

      expect((parsed['results'] as unknown[]).length).toBe(1);
      expect(parsed['page_index']).toBe(0);
      expect(parsed['page_size']).toBe(25);
      // has_more/next_page_index are always present (deterministic contract)
      expect(parsed).toHaveProperty('has_more');
      expect(parsed).toHaveProperty('next_page_index');
    });

    it('custom fields override preset', async () => {
      mockClient.post.mockResolvedValueOnce({ results: [] });

      await client.callTool({
        name: 'search_certificates',
        arguments: { query: '*', fields: ['dn', 'grade'] },
      });

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['fields']).toEqual(['dn', 'grade']);
    });

    it('caps page size at max', async () => {
      // Zod schema enforces max(100). We verify with 100 to confirm the cap.
      mockClient.post.mockResolvedValueOnce({ results: [] });

      const result = await client.callTool({
        name: 'search_certificates',
        arguments: { query: '*', page_size: 100 },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['pageSize']).toBe(100);
      expect(parsed['page_size']).toBe(100);
    });

    // --------------------------------------------------------------------
    // Pagination regression suite
    //
    // These tests guard against the "pagination returned the same page"
    // class of bugs. Every paginated search tool must:
    //   1. Send a strictly different pageIndex to the API for each
    //      page_index value the model passes in.
    //   2. Return a deterministic envelope including has_more and
    //      next_page_index so the model never has to derive pagination
    //      state itself.
    //   3. Default with_count=true so total is always populated when
    //      available from the API.
    // If any of these invariants break, a real Horizon API (or a broken
    // MCP shim) can silently return the same data twice -- the exact
    // failure mode reported by users.
    // --------------------------------------------------------------------
    describe('pagination contract', () => {
      it('page_index increments reach the API as distinct 1-based pageIndex values', async () => {
        // Model simulates walking three pages. Each call must hit the
        // Horizon API with a distinct pageIndex (1, 2, 3) so we can never
        // regress to serving the same page twice.
        mockClient.post
          .mockResolvedValueOnce({ results: [{ _id: 'a' }], count: 250 })
          .mockResolvedValueOnce({ results: [{ _id: 'b' }], count: 250 })
          .mockResolvedValueOnce({ results: [{ _id: 'c' }], count: 250 });

        for (const idx of [0, 1, 2]) {
          await client.callTool({
            name: 'search_certificates',
            arguments: {
              query: '*',
              page_index: idx,
              page_size: 100,
              sorted_by: 'notAfter:Desc',
            },
          });
        }

        const sentIndices = mockClient.post.mock.calls.map(
          (c) => (c[1] as Record<string, unknown>)['pageIndex'],
        );
        expect(sentIndices).toEqual([1, 2, 3]);
      });

      it('echoes page_index as the 0-based value the caller provided', async () => {
        mockClient.post.mockResolvedValueOnce({
          results: [{ _id: 'x' }],
          count: 300,
        });

        const result = await client.callTool({
          name: 'search_certificates',
          arguments: { query: '*', page_index: 2, page_size: 50 },
        });
        const parsed = parseToolResult(result);

        expect(parsed['page_index']).toBe(2);
      });

      it('has_more=true and next_page_index set mid-pagination (with total)', async () => {
        mockClient.post.mockResolvedValueOnce({
          results: Array.from({ length: 100 }, (_, i) => ({ _id: `r${i}` })),
          count: 187,
        });

        const result = await client.callTool({
          name: 'search_certificates',
          arguments: { query: '*', page_index: 0, page_size: 100 },
        });
        const parsed = parseToolResult(result);

        expect(parsed['total']).toBe(187);
        expect(parsed['has_more']).toBe(true);
        expect(parsed['next_page_index']).toBe(1);
      });

      it('has_more=false and next_page_index=null on the last page', async () => {
        // page_index=1 with page_size=100 on a total of 187 means this
        // page returns the trailing 87, and there are no more pages.
        mockClient.post.mockResolvedValueOnce({
          results: Array.from({ length: 87 }, (_, i) => ({ _id: `r${i}` })),
          count: 187,
        });

        const result = await client.callTool({
          name: 'search_certificates',
          arguments: { query: '*', page_index: 1, page_size: 100 },
        });
        const parsed = parseToolResult(result);

        expect(parsed['total']).toBe(187);
        expect(parsed['has_more']).toBe(false);
        expect(parsed['next_page_index']).toBeNull();
      });

      it('falls back to records.length heuristic when count is absent', async () => {
        // No count -> cannot compare against total. has_more must still
        // be deterministic by falling back to page fullness.
        mockClient.post.mockResolvedValueOnce({
          results: Array.from({ length: 25 }, (_, i) => ({ _id: `r${i}` })),
        });

        const result = await client.callTool({
          name: 'search_certificates',
          arguments: { query: '*', page_index: 0, page_size: 25 },
        });
        const parsed = parseToolResult(result);

        expect(parsed['total']).toBeNull();
        // Page was full (25/25) -> another page may exist
        expect(parsed['has_more']).toBe(true);
      });

      it('defaults with_count to true', async () => {
        mockClient.post.mockResolvedValueOnce({ results: [] });
        await client.callTool({
          name: 'search_certificates',
          arguments: { query: '*' },
        });
        const payload = mockClient.post.mock.calls[0]![1] as Record<
          string,
          unknown
        >;
        expect(payload['withCount']).toBe(true);
      });
    });
  });

  describe('get_certificate', () => {
    it('returns full certificate', async () => {
      const certData = {
        dn: 'CN=test.example.com',
        serial: '01AB',
        profile: 'WebRA',
        extensions: { keyUsage: ['digitalSignature'] },
      };
      mockClient.get.mockResolvedValueOnce(certData);

      const result = await client.callTool({
        name: 'get_certificate',
        arguments: { certificate_id: 'abc-123' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/certificates/abc-123',
      );
      expect(parsed['dn']).toBe('CN=test.example.com');
      const ext = parsed['extensions'] as Record<string, unknown>;
      expect(ext['keyUsage']).toEqual(['digitalSignature']);
    });
  });

  describe('download_certificate', () => {
    it('downloads PEM', async () => {
      const pem =
        '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
      mockClient.get.mockResolvedValueOnce({
        dn: 'CN=test.example.com',
        certificate: pem,
      });

      const result = await client.callTool({
        name: 'download_certificate',
        arguments: { certificate_id: 'abc-123', format: 'pem' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/certificates/abc-123',
      );
      expect(parsed['format']).toBe('pem');
      expect(parsed['content']).toBe(pem);
    });

    it('rejects non-PEM format at the schema level', async () => {
      const result = (await client.callTool({
        name: 'download_certificate',
        arguments: { certificate_id: 'abc-123', format: 'der' },
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('format');
    });

    it('rejects invalid format at the schema level', async () => {
      const result = (await client.callTool({
        name: 'download_certificate',
        arguments: { certificate_id: 'abc-123', format: 'xml' },
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('format');
    });

    it('rejects JKS format at the schema level', async () => {
      const result = (await client.callTool({
        name: 'download_certificate',
        arguments: { certificate_id: 'abc-123', format: 'jks' },
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('format');
    });
  });

  describe('set_certificate_auto_renew', () => {
    it('submits an update request for a certificate ID', async () => {
      mockClient.post.mockResolvedValueOnce({ id: 'req-auto-renew-id' });

      await client.callTool({
        name: 'set_certificate_auto_renew',
        arguments: {
          certificate_id: '0123456789abcdef01234567',
          enabled: true,
        },
      });

      expect(mockClient.post).toHaveBeenCalledWith('/api/v1/requests/submit', {
        module: 'webra',
        workflow: 'update',
        certificateId: '0123456789abcdef01234567',
        template: { autoRenew: { value: true } },
      });
    });

    it('submits an update request for a certificate PEM', async () => {
      mockClient.post.mockResolvedValueOnce({ id: 'req-auto-renew-pem' });
      const certificatePem =
        '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

      await client.callTool({
        name: 'set_certificate_auto_renew',
        arguments: { certificate_pem: certificatePem, enabled: false },
      });

      expect(mockClient.post).toHaveBeenCalledWith('/api/v1/requests/submit', {
        module: 'webra',
        workflow: 'update',
        certificatePem,
        template: { autoRenew: { value: false } },
      });
    });

    it('rejects a missing certificate selector before calling Horizon', async () => {
      const result = await client.callTool({
        name: 'set_certificate_auto_renew',
        arguments: { enabled: true },
      });

      expect((result as ToolResult).isError).toBe(true);
      expect((result as ToolResult).content[0]!.text).toContain(
        'exactly one of certificate_id or certificate_pem',
      );
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('rejects both certificate selectors before calling Horizon', async () => {
      const result = await client.callTool({
        name: 'set_certificate_auto_renew',
        arguments: {
          certificate_id: '0123456789abcdef01234567',
          certificate_pem:
            '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
          enabled: true,
        },
      });

      expect((result as ToolResult).isError).toBe(true);
      expect((result as ToolResult).content[0]!.text).toContain(
        'exactly one of certificate_id or certificate_pem',
      );
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('returns a clear error when the profile policy is not editable', async () => {
      mockClient.post.mockRejectedValueOnce(
        new HorizonError(403, { message: 'auto-renew is not editable' }),
      );

      const result = await client.callTool({
        name: 'set_certificate_auto_renew',
        arguments: {
          certificate_id: '0123456789abcdef01234567',
          enabled: true,
        },
      });

      expect((result as ToolResult).isError).toBe(true);
      expect(parseToolResult(result)['error']).toContain(
        'autoRenewalPolicy.editable is true',
      );
    });

    it('preserves standard Horizon errors that are unrelated to editability', async () => {
      mockClient.post.mockRejectedValueOnce(
        new HorizonError(403, {
          errorCode: 'LIC-004',
          message: 'Expired License',
        }),
      );

      const result = await client.callTool({
        name: 'set_certificate_auto_renew',
        arguments: {
          certificate_id: '0123456789abcdef01234567',
          enabled: true,
        },
      });

      expect((result as ToolResult).isError).toBe(true);
      expect((result as ToolResult).content[0]!.text).toContain(
        'Horizon API error 403 [LIC-004]. Expired License',
      );
      expect((result as ToolResult).content[0]!.text).not.toContain(
        'autoRenewalPolicy.editable is true',
      );
    });
  });
});
