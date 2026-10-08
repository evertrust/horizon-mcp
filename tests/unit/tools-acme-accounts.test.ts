/**
 * ACME account and order tool unit tests (Horizon 2.11+).
 *
 * Verifies routes, request bodies (pagination, HAQL query, status change),
 * the delete echo guard, annotations, and Zod validation errors.
 */
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerAcmeTools } from '../../src/tools/acme/index.js';
import {
  type MockClient,
  parseToolResult,
  setupServerAndClient,
} from './support/tool-harness.js';

const ACCOUNT_ID = '6448d56b310000400063f014';

const ACCOUNT_FIXTURE = {
  _id: ACCOUNT_ID,
  jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
  keyThumbprint: 'thumbprint',
  status: 'valid',
  contact: ['mailto:admin@example.com'],
  termsOfServiceAgreed: true,
  createdAt: 1767225600000,
};

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]!.text;
}

describe('ACME account and order tools', () => {
  let client: Client;
  let mc: MockClient;

  beforeEach(async () => {
    ({ client, mockClient: mc } = await setupServerAndClient([
      registerAcmeTools as never,
    ]));
  });

  it('registers 13 ACME tools with the 2.11 note', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);
    for (const tool of tools) {
      expect(tool.description, tool.name).toContain('Horizon 2.11+');
    }
  });

  it('marks status changes and deletes as destructive', async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    for (const name of [
      'update_acme_account_status',
      'delete_acme_account',
      'update_acme_eab_status',
      'delete_acme_eab',
    ]) {
      expect(byName.get(name)?.destructiveHint, name).toBe(true);
      expect(byName.get(name)?.readOnlyHint, name).toBe(false);
    }
    for (const name of ['search_acme_accounts', 'list_acme_orders']) {
      expect(byName.get(name)?.readOnlyHint, name).toBe(true);
    }
  });

  describe('search_acme_accounts', () => {
    it('posts the HAQL query and converts the 0-based page_index', async () => {
      mc.post.mockResolvedValueOnce({
        results: [ACCOUNT_FIXTURE],
        pageIndex: 1,
        pageSize: 10,
        count: 1,
        hasMore: false,
      });
      const result = await client.callTool({
        name: 'search_acme_accounts',
        arguments: {
          query: 'status equals "valid"',
          page_size: 10,
          sorted_by: 'createdAt:desc',
        },
      });
      expect(mc.post).toHaveBeenCalledWith('/api/v1/acme/accounts/search', {
        query: 'status equals "valid"',
        pageIndex: 1,
        pageSize: 10,
        sortedBy: [{ element: 'createdAt', order: 'Desc' }],
        withCount: true,
      });
      const body = parseToolResult(result);
      expect(body['results']).toEqual([ACCOUNT_FIXTURE]);
      expect(body['total']).toBe(1);
      expect(body['has_more']).toBe(false);
      expect(result.structuredContent).toEqual(body);
    });

    it('omits the query when none is given', async () => {
      await client.callTool({
        name: 'search_acme_accounts',
        arguments: { page_index: 2, with_count: false },
      });
      expect(mc.post).toHaveBeenCalledWith('/api/v1/acme/accounts/search', {
        pageIndex: 3,
        pageSize: 25,
      });
    });

    it('rejects a page size above 100', async () => {
      const result = await client.callTool({
        name: 'search_acme_accounts',
        arguments: { page_size: 101 },
      });
      expect(isError(result)).toBe(true);
      expect(mc.post).not.toHaveBeenCalled();
    });
  });

  it('get_acme_account encodes the account ID', async () => {
    mc.get.mockResolvedValueOnce(ACCOUNT_FIXTURE);
    const result = await client.callTool({
      name: 'get_acme_account',
      arguments: { account_id: 'a/b' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/acme/accounts/a%2Fb');
    expect(parseToolResult(result)).toEqual(ACCOUNT_FIXTURE);
  });

  describe('update_acme_account_status', () => {
    it('sends the compromise parameters', async () => {
      mc.post.mockResolvedValueOnce({
        ...ACCOUNT_FIXTURE,
        status: 'compromised_pending',
      });
      const result = await client.callTool({
        name: 'update_acme_account_status',
        arguments: {
          account_id: ACCOUNT_ID,
          status: 'compromised',
          compromised_at: 1767225600000,
          compromission_reason: 'keycompromise',
        },
      });
      expect(mc.post).toHaveBeenCalledWith(
        `/api/v1/acme/accounts/${ACCOUNT_ID}/status`,
        {
          status: 'compromised',
          compromisedAt: 1767225600000,
          compromissionReason: 'keycompromise',
        },
      );
      expect(parseToolResult(result)['status']).toBe('compromised_pending');
    });

    it('sends only the status for a simple change', async () => {
      await client.callTool({
        name: 'update_acme_account_status',
        arguments: { account_id: ACCOUNT_ID, status: 'suspended' },
      });
      expect(mc.post).toHaveBeenCalledWith(
        `/api/v1/acme/accounts/${ACCOUNT_ID}/status`,
        { status: 'suspended' },
      );
    });

    it('rejects a server-only status', async () => {
      const result = await client.callTool({
        name: 'update_acme_account_status',
        arguments: { account_id: ACCOUNT_ID, status: 'compromised_pending' },
      });
      expect(isError(result)).toBe(true);
      expect(mc.post).not.toHaveBeenCalled();
    });

    it('rejects an unknown revocation reason', async () => {
      const result = await client.callTool({
        name: 'update_acme_account_status',
        arguments: {
          account_id: ACCOUNT_ID,
          status: 'compromised',
          compromission_reason: 'stolen',
        },
      });
      expect(isError(result)).toBe(true);
      expect(mc.post).not.toHaveBeenCalled();
    });
  });

  describe('delete_acme_account', () => {
    it('deletes when the confirmation matches', async () => {
      const result = await client.callTool({
        name: 'delete_acme_account',
        arguments: { account_id: ACCOUNT_ID, expected_account_id: ACCOUNT_ID },
      });
      expect(mc.delete).toHaveBeenCalledWith(
        `/api/v1/acme/accounts/${ACCOUNT_ID}`,
      );
      expect(parseToolResult(result)).toEqual({
        deleted: true,
        account_id: ACCOUNT_ID,
        kind: 'acme_account',
      });
    });

    it('refuses when the confirmation differs', async () => {
      const result = await client.callTool({
        name: 'delete_acme_account',
        arguments: { account_id: ACCOUNT_ID, expected_account_id: 'other' },
      });
      expect(isError(result)).toBe(true);
      expect(textOf(result)).toContain('SAFETY-ECHO');
      expect(mc.delete).not.toHaveBeenCalled();
    });
  });

  describe('list_acme_orders', () => {
    it('posts the pagination body to the account route', async () => {
      mc.post.mockResolvedValueOnce({
        results: [{ _id: 'order-1', status: 'valid' }],
        pageIndex: 1,
        pageSize: 25,
        count: 3,
        hasMore: true,
      });
      const result = await client.callTool({
        name: 'list_acme_orders',
        arguments: { account_id: ACCOUNT_ID },
      });
      // The first page of the tool (page_index 0) is page 1 for the API.
      expect(mc.post).toHaveBeenCalledWith(
        `/api/v1/acme/orders/account/${ACCOUNT_ID}`,
        { pageIndex: 1, pageSize: 25, withCount: true },
      );
      const body = parseToolResult(result);
      expect(body['has_more']).toBe(true);
      expect(body['next_page_index']).toBe(1);
    });

    it('returns an empty page for an account without orders', async () => {
      // The client returns {} for a 204 No Content response.
      mc.post.mockResolvedValueOnce({});
      const result = await client.callTool({
        name: 'list_acme_orders',
        arguments: { account_id: ACCOUNT_ID, with_count: false },
      });
      const body = parseToolResult(result);
      expect(body['results']).toEqual([]);
      expect(body['has_more']).toBe(false);
    });

    it('requires an account ID', async () => {
      const result = await client.callTool({
        name: 'list_acme_orders',
        arguments: {},
      });
      expect(isError(result)).toBe(true);
    });
  });

  it('get_acme_order reads the order route', async () => {
    mc.get.mockResolvedValueOnce({ _id: 'order-1', status: 'pending' });
    const result = await client.callTool({
      name: 'get_acme_order',
      arguments: { order_id: 'order-1' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/acme/orders/order-1');
    expect(parseToolResult(result)['status']).toBe('pending');
  });
});
