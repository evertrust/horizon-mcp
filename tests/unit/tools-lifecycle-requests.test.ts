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

  describe('get_request_template', () => {
    it('sends include_terms_of_service in the query string, not the POST body', async () => {
      await client.callTool({
        name: 'get_request_template',
        arguments: {
          workflow: 'enroll',
          profile: 'webra-enrollment',
          module: 'webra',
          include_terms_of_service: true,
        },
      });

      const [url, body] = mockClient.post.mock.calls[0]!;
      expect(url).toBe('/api/v1/requests/template?termsOfService=true');
      expect(body).toEqual({
        workflow: 'enroll',
        profile: 'webra-enrollment',
        module: 'webra',
      });
      expect(body).not.toHaveProperty('termsOfService');
    });
  });

  describe('submit_request', () => {
    it('enrolls with template', async () => {
      mockClient.post.mockResolvedValueOnce({
        id: 'req-001',
        workflow: 'enroll',
        status: 'pending',
      });
      const template = {
        subject: [{ element: 'cn.1', type: 'CN', value: 'server.local' }],
        sans: [{ type: 'DNSNAME', value: ['server.local'] }],
        labels: [{ label: 'env', value: 'prod' }],
        keyType: 'rsa-3072',
      };

      const result = await client.callTool({
        name: 'submit_request',
        arguments: {
          workflow: 'enroll',
          profile: 'my-profile',
          module: 'webra',
          template,
          password: 'changeit',
        },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledOnce();
      const callArgs = mockClient.post.mock.calls[0]!;
      expect(callArgs[0]).toBe('/api/v1/requests/submit');
      const payload = callArgs[1] as Record<string, unknown>;
      expect(payload['workflow']).toBe('enroll');
      expect(payload['profile']).toBe('my-profile');
      expect(payload['module']).toBe('webra');
      expect(payload['password']).toBe('changeit');
      const tpl = payload['template'] as Record<string, unknown>;
      expect(tpl['keyType']).toBe('rsa-3072');
      const sans = tpl['sans'] as Array<Record<string, unknown>>;
      expect(sans[0]!['value']).toEqual(['server.local']);
      const labels = tpl['labels'] as Array<Record<string, unknown>>;
      expect(labels[0]!['label']).toBe('env');
      expect(parsed['id']).toBe('req-001');
    });

    it('revokes without template', async () => {
      mockClient.post.mockResolvedValueOnce({
        id: 'req-002',
        workflow: 'revoke',
      });

      await client.callTool({
        name: 'submit_request',
        arguments: {
          workflow: 'revoke',
          profile: 'my-profile',
          module: 'webra',
          certificate_id: 'cert-abc',
        },
      });

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload['workflow']).toBe('revoke');
      expect(payload['certificateId']).toBe('cert-abc');
      expect(payload['template']).toBeUndefined();
      expect(payload['password']).toBeUndefined();
    });

    it('explicit params override data', async () => {
      mockClient.post.mockResolvedValueOnce({ id: 'req-003' });

      await client.callTool({
        name: 'submit_request',
        arguments: {
          workflow: 'enroll',
          profile: 'p',
          module: 'webra',
          template: { keyType: 'rsa-3072' },
          data: { template: { keyType: 'rsa-2048' }, extra: 'field' },
        },
      });

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      const tpl = payload['template'] as Record<string, unknown>;
      expect(tpl['keyType']).toBe('rsa-3072');
      expect(payload['extra']).toBe('field');
    });
  });

  describe('approve_request', () => {
    it('approves with permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        profile: 'my-profile',
        permissions: { approve: true, cancel: true },
      });
      mockClient.post.mockResolvedValueOnce({
        id: 'req-001',
        status: 'approved',
      });

      const result = await client.callTool({
        name: 'approve_request',
        arguments: { request_id: 'req-001' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith('/api/v1/requests/req-001');
      expect(mockClient.post).toHaveBeenCalledOnce();
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload).toEqual({ id: 'req-001', workflow: 'enroll' });
      expect(parsed['status']).toBe('approved');
    });

    it('blocks without permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        profile: 'my-profile',
        permissions: { approve: false, cancel: true },
      });

      const result = await client.callTool({
        name: 'approve_request',
        arguments: { request_id: 'req-001' },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain('Permission denied');
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('blocks non-pending request', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'approved',
        permissions: { approve: true, cancel: false },
      });

      const result = await client.callTool({
        name: 'approve_request',
        arguments: { request_id: 'req-001' },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBe(
        "Request status 'approved' cannot be approved. Only pending requests can be approved.",
      );
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('deny_request', () => {
    it('denies with permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        permissions: { approve: true, cancel: true },
      });
      mockClient.post.mockResolvedValueOnce({
        id: 'req-002',
        status: 'denied',
      });

      const result = await client.callTool({
        name: 'deny_request',
        arguments: { request_id: 'req-002' },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload).toEqual({ id: 'req-002', workflow: 'enroll' });
      expect(parsed['status']).toBe('denied');
    });

    it('blocks without permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        permissions: { approve: false, cancel: true },
      });

      const result = await client.callTool({
        name: 'deny_request',
        arguments: { request_id: 'req-002' },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain('Permission denied');
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('describes an invalid state with the denied participle', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'completed',
        permissions: { approve: true, cancel: true },
      });

      const result = await client.callTool({
        name: 'deny_request',
        arguments: { request_id: 'req-002' },
      });

      expect(parseToolResult(result)['error']).toBe(
        "Request status 'completed' cannot be denied. Only pending or in_progress requests can be denied.",
      );
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('cancel_request', () => {
    it('cancels with permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        permissions: { approve: false, cancel: true },
      });
      mockClient.post.mockResolvedValueOnce({
        id: 'req-003',
        status: 'cancelled',
      });

      const result = await client.callTool({
        name: 'cancel_request',
        arguments: { request_id: 'req-003' },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload).toEqual({ id: 'req-003', workflow: 'enroll' });
      expect(parsed['status']).toBe('cancelled');
    });

    it('blocks without permission', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'pending',
        permissions: { approve: true, cancel: false },
      });

      const result = await client.callTool({
        name: 'cancel_request',
        arguments: { request_id: 'req-003' },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain('Permission denied');
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('describes an invalid state with the cancelled participle', async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status: 'completed',
        permissions: { approve: true, cancel: true },
      });

      const result = await client.callTool({
        name: 'cancel_request',
        arguments: { request_id: 'req-003' },
      });

      expect(parseToolResult(result)['error']).toBe(
        "Request status 'completed' cannot be cancelled. Only pending or in_progress requests can be cancelled.",
      );
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe.each([
    {
      name: 'approve_request',
      status: 'pending',
      endpoint: '/api/v1/requests/approve',
      allowed: true,
    },
    {
      name: 'approve_request',
      status: 'in_progress',
      endpoint: '/api/v1/requests/approve',
      allowed: false,
    },
    {
      name: 'deny_request',
      status: 'pending',
      endpoint: '/api/v1/requests/deny',
      allowed: true,
    },
    {
      name: 'deny_request',
      status: 'in_progress',
      endpoint: '/api/v1/requests/deny',
      allowed: true,
    },
    {
      name: 'cancel_request',
      status: 'pending',
      endpoint: '/api/v1/requests/cancel',
      allowed: true,
    },
    {
      name: 'cancel_request',
      status: 'in_progress',
      endpoint: '/api/v1/requests/cancel',
      allowed: true,
    },
  ])('$name request state $status', ({ name, status, endpoint, allowed }) => {
    it(`${allowed ? 'allows' : 'blocks'} the action`, async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: 'enroll',
        status,
        permissions: { approve: true, cancel: true },
      });
      mockClient.post.mockResolvedValueOnce({ status: 'handled' });

      const result = await client.callTool({
        name,
        arguments: { request_id: 'async-request' },
      });

      if (!allowed) {
        expect(String(parseToolResult(result)['error'])).toContain('pending');
        expect(mockClient.post).not.toHaveBeenCalled();
        return;
      }

      expect(mockClient.post).toHaveBeenCalledWith(endpoint, {
        id: 'async-request',
        workflow: 'enroll',
      });
      expect(parseToolResult(result)['status']).toBe('handled');
    });
  });

  // ==========================================================================
  // Cross-tool pagination contract
  //
  // The CTO reported "pagination returned the same page" on a real-world
  // Horizon instance. Every paginated search tool must behave identically so
  // a fix (or regression) in one tool is provably reflected in all of them.
  // This parametrised block asserts the contract per-tool without relying
  // on domain-specific field shapes.
  // ==========================================================================
  describe.each([
    {
      name: 'search_certificates',
      endpoint: '/api/v1/certificates/search',
      args: { query: 'status is valid' },
    },
    {
      name: 'search_requests',
      endpoint: '/api/v1/requests/search',
      args: { query: 'status equals "pending"' },
    },
    {
      name: 'search_events',
      endpoint: '/api/v1/events/search',
      args: { query: 'timestamp after -7d' },
    },
  ])('$name pagination contract', ({ name, endpoint, args }) => {
    it('sends distinct 1-based pageIndex for each page_index walked', async () => {
      mockClient.post
        .mockResolvedValueOnce({ results: [{ _id: 'a' }], count: 500 })
        .mockResolvedValueOnce({ results: [{ _id: 'b' }], count: 500 })
        .mockResolvedValueOnce({ results: [{ _id: 'c' }], count: 500 });

      for (const idx of [0, 1, 2]) {
        await client.callTool({
          name,
          arguments: { ...args, page_index: idx, page_size: 100 },
        });
      }

      const calls = mockClient.post.mock.calls.filter((c) => c[0] === endpoint);
      expect(calls.length).toBeGreaterThanOrEqual(3);
      const sent = calls
        .slice(-3)
        .map((c) => (c[1] as Record<string, unknown>)['pageIndex']);
      expect(sent).toEqual([1, 2, 3]);
    });

    it('returns a standardized pagination envelope', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: Array.from({ length: 50 }, (_, i) => ({ _id: `r${i}` })),
        count: 250,
      });

      const result = await client.callTool({
        name,
        arguments: { ...args, page_index: 0, page_size: 50 },
      });
      const parsed = parseToolResult(result);

      expect(parsed).toHaveProperty('results');
      expect(parsed['page_index']).toBe(0);
      expect(parsed['page_size']).toBe(50);
      expect(parsed['total']).toBe(250);
      expect(parsed['has_more']).toBe(true);
      expect(parsed['next_page_index']).toBe(1);
      // Legacy camelCase fields should NOT be present -- they confused
      // models when echoed alongside snake_case inputs.
      expect(parsed).not.toHaveProperty('pageIndex');
      expect(parsed).not.toHaveProperty('pageSize');
      expect(parsed).not.toHaveProperty('hasMore');
    });

    it('next_page_index is null when has_more is false', async () => {
      mockClient.post.mockResolvedValueOnce({
        results: [{ _id: 'tail' }],
        count: 1,
      });

      const result = await client.callTool({
        name,
        arguments: { ...args, page_index: 0, page_size: 100 },
      });
      const parsed = parseToolResult(result);

      expect(parsed['has_more']).toBe(false);
      expect(parsed['next_page_index']).toBeNull();
    });

    it('defaults with_count=true so total is requested', async () => {
      mockClient.post.mockResolvedValueOnce({ results: [], count: 0 });
      await client.callTool({ name, arguments: args });
      const last = mockClient.post.mock.calls.at(-1)!;
      const payload = last[1] as Record<string, unknown>;
      expect(payload['withCount']).toBe(true);
    });
  });

  // ==========================================================================
  // Domain-specific truncation guard rails
  //
  // Cert/request searches truncate large fields and point the model at
  // get_certificate for the full value. Event searches must NOT do this
  // because (a) event payloads are the primary output, and (b) the hint
  // would send the model to the wrong recovery tool (should be get_event,
  // not get_certificate).
  // ==========================================================================
});
