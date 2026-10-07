/**
 * ACME External Account Binding tool unit tests (Horizon 2.11+).
 *
 * Verifies routes and bodies, that create and renew return the MAC key once
 * with a one-time-secret warning and never write it to the logs, the
 * GET-merge update, status changes, and the delete echo guard.
 */
import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAcmeTools } from '../../src/tools/acme/index.js';
import {
  type MockClient,
  parseToolResult,
  setupServerAndClient,
} from './support/tool-harness.js';

const MAC_KEY = 'bWFjLWtleS1leGFtcGxlLXZhbHVlLWZvci11bml0LXRlc3Rz';
const MAC_KEY_ID = 'kid-example-0001';

const EAB_FIXTURE = {
  _id: '6448d56b310000400063f014',
  name: 'web-servers-eab',
  description: 'Web servers',
  status: 'valid',
  createdAt: 1767225600000,
  eabPolicy: 'web-servers',
  identifierConstraint: '.*\\.example\\.com',
  allowedProfiles: ['acme-web'],
  validationMethods: ['http-01'],
  numberOfKeyRegeneration: 0,
  macKeyAlgorithm: 'HS256',
};

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]!.text;
}

describe('ACME EAB tools', () => {
  let client: Client;
  let mc: MockClient;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    ({ client, mockClient: mc } = await setupServerAndClient([
      registerAcmeTools as never,
    ]));
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  function loggedText(): string {
    return stderr.mock.calls.map((call) => String(call[0])).join('\n');
  }

  it('search_acme_eabs posts the HEABQL query', async () => {
    mc.post.mockResolvedValueOnce({
      results: [EAB_FIXTURE],
      pageIndex: 1,
      pageSize: 25,
      hasMore: false,
    });
    const result = await client.callTool({
      name: 'search_acme_eabs',
      arguments: { query: 'eab.policy equals "web-servers"' },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/acme/eab/search', {
      query: 'eab.policy equals "web-servers"',
      pageIndex: 1,
      pageSize: 25,
      withCount: true,
    });
    expect(parseToolResult(result)['results']).toEqual([EAB_FIXTURE]);
  });

  it('get_acme_eab reads the EAB by name', async () => {
    mc.get.mockResolvedValueOnce(EAB_FIXTURE);
    await client.callTool({
      name: 'get_acme_eab',
      arguments: { name: 'web servers' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/acme/eab/web%20servers');
  });

  describe('create_acme_eab', () => {
    it('returns the MAC key once with a warning and does not log it', async () => {
      mc.post.mockResolvedValueOnce({
        ...EAB_FIXTURE,
        macKey: MAC_KEY,
        macKeyId: MAC_KEY_ID,
      });
      const result = await client.callTool({
        name: 'create_acme_eab',
        arguments: {
          name: 'web-servers-eab',
          eab_policy: 'web-servers',
          mac_key_algorithm: 'HS256',
          eab_validity_duration: '365 days',
          description: 'Web servers',
          identifier_constraint: '.*\\.example\\.com',
          allowed_profiles: ['acme-web'],
          validation_methods: ['http-01'],
          email_constraint: '.*@example\\.com',
        },
      });
      expect(mc.post).toHaveBeenCalledWith('/api/v1/acme/eab', {
        name: 'web-servers-eab',
        eabPolicy: 'web-servers',
        macKeyAlgorithm: 'HS256',
        eabValidityDuration: '365 days',
        description: 'Web servers',
        identifierConstraint: '.*\\.example\\.com',
        allowedProfiles: ['acme-web'],
        validationMethods: ['http-01'],
        emailConstraint: '.*@example\\.com',
      });
      const body = parseToolResult(result);
      expect(body['status']).toBe('created');
      expect(body['warning']).toContain('will not show them again');
      const data = body['data'] as Record<string, unknown>;
      expect(data['macKey']).toBe(MAC_KEY);
      expect(data['macKeyId']).toBe(MAC_KEY_ID);
      expect(loggedText()).not.toContain(MAC_KEY);
    });

    it('requires eab_policy and mac_key_algorithm', async () => {
      const result = await client.callTool({
        name: 'create_acme_eab',
        arguments: { name: 'web-servers-eab' },
      });
      expect(isError(result)).toBe(true);
      expect(mc.post).not.toHaveBeenCalled();
    });

    it('rejects a malformed validity duration', async () => {
      const result = await client.callTool({
        name: 'create_acme_eab',
        arguments: {
          name: 'web-servers-eab',
          eab_policy: 'web-servers',
          mac_key_algorithm: 'HS256',
          eab_validity_duration: 'one year',
        },
      });
      expect(isError(result)).toBe(true);
      expect(mc.post).not.toHaveBeenCalled();
    });

    it('rejects an unknown validation method', async () => {
      const result = await client.callTool({
        name: 'create_acme_eab',
        arguments: {
          name: 'web-servers-eab',
          eab_policy: 'web-servers',
          mac_key_algorithm: 'HS256',
          validation_methods: ['email-01'],
        },
      });
      expect(isError(result)).toBe(true);
    });
  });

  describe('renew_acme_eab', () => {
    it('returns the new MAC key once with a warning', async () => {
      mc.post.mockResolvedValueOnce({
        ...EAB_FIXTURE,
        numberOfKeyRegeneration: 1,
        macKey: MAC_KEY,
        macKeyId: MAC_KEY_ID,
      });
      const result = await client.callTool({
        name: 'renew_acme_eab',
        arguments: { name: 'web-servers-eab', mac_key_algorithm: 'HS512' },
      });
      expect(mc.post).toHaveBeenCalledWith(
        '/api/v1/acme/eab/web-servers-eab/renew',
        { macKeyAlgorithm: 'HS512' },
      );
      const body = parseToolResult(result);
      expect(body['status']).toBe('renewed');
      expect(body['warning']).toContain('one-time secrets');
      expect((body['data'] as Record<string, unknown>)['macKey']).toBe(MAC_KEY);
      expect(loggedText()).not.toContain(MAC_KEY);
    });

    it('sends an empty body when no option is given', async () => {
      await client.callTool({
        name: 'renew_acme_eab',
        arguments: { name: 'web-servers-eab' },
      });
      expect(mc.post).toHaveBeenCalledWith(
        '/api/v1/acme/eab/web-servers-eab/renew',
        {},
      );
    });

    it('sends the validity duration', async () => {
      await client.callTool({
        name: 'renew_acme_eab',
        arguments: { name: 'web-servers-eab', eab_validity_duration: '90d' },
      });
      expect(mc.post).toHaveBeenCalledWith(
        '/api/v1/acme/eab/web-servers-eab/renew',
        { eabValidityDuration: '90d' },
      );
    });
  });

  describe('update_acme_eab', () => {
    it('keeps every stored field when only the policy changes', async () => {
      mc.get.mockResolvedValueOnce(EAB_FIXTURE);
      await client.callTool({
        name: 'update_acme_eab',
        arguments: { name: 'web-servers-eab', eab_policy: 'web-servers-v2' },
      });
      expect(mc.put).toHaveBeenCalledWith('/api/v1/acme/eab', {
        name: 'web-servers-eab',
        description: 'Web servers',
        eabPolicy: 'web-servers-v2',
        identifierConstraint: '.*\\.example\\.com',
        allowedProfiles: ['acme-web'],
        validationMethods: ['http-01'],
      });
    });

    it('merges the stored fields with the changes', async () => {
      mc.get.mockResolvedValueOnce(EAB_FIXTURE);
      mc.put.mockResolvedValueOnce({ ...EAB_FIXTURE, allowedProfiles: [] });
      const result = await client.callTool({
        name: 'update_acme_eab',
        arguments: {
          name: 'web-servers-eab',
          allowed_profiles: [],
          clear_fields: ['description'],
        },
      });
      expect(mc.get).toHaveBeenCalledWith('/api/v1/acme/eab/web-servers-eab');
      expect(mc.put).toHaveBeenCalledWith('/api/v1/acme/eab', {
        name: 'web-servers-eab',
        description: null,
        eabPolicy: 'web-servers',
        identifierConstraint: '.*\\.example\\.com',
        allowedProfiles: [],
        validationMethods: ['http-01'],
      });
      expect(parseToolResult(result)['status']).toBe('updated');
    });

    it('rejects clearing a field that is not a text field', async () => {
      const result = await client.callTool({
        name: 'update_acme_eab',
        arguments: { name: 'web-servers-eab', clear_fields: ['eabPolicy'] },
      });
      expect(isError(result)).toBe(true);
      expect(mc.put).not.toHaveBeenCalled();
    });
  });

  describe('update_acme_eab_status', () => {
    it('posts the status change', async () => {
      mc.post.mockResolvedValueOnce({ ...EAB_FIXTURE, status: 'suspended' });
      const result = await client.callTool({
        name: 'update_acme_eab_status',
        arguments: { name: 'web-servers-eab', status: 'suspended' },
      });
      expect(mc.post).toHaveBeenCalledWith(
        '/api/v1/acme/eab/web-servers-eab/status',
        { status: 'suspended' },
      );
      expect(parseToolResult(result)['status']).toBe('suspended');
    });

    it('rejects an unknown status', async () => {
      const result = await client.callTool({
        name: 'update_acme_eab_status',
        arguments: { name: 'web-servers-eab', status: 'revoked' },
      });
      expect(isError(result)).toBe(true);
    });
  });

  describe('delete_acme_eab', () => {
    it('deletes when the confirmation matches', async () => {
      const result = await client.callTool({
        name: 'delete_acme_eab',
        arguments: {
          name: 'web-servers-eab',
          expected_name: 'web-servers-eab',
        },
      });
      expect(mc.delete).toHaveBeenCalledWith(
        '/api/v1/acme/eab/web-servers-eab',
      );
      expect(parseToolResult(result)['deleted']).toBe(true);
    });

    it('refuses when the confirmation differs', async () => {
      const result = await client.callTool({
        name: 'delete_acme_eab',
        arguments: { name: 'web-servers-eab', expected_name: 'other' },
      });
      expect(isError(result)).toBe(true);
      expect(textOf(result)).toContain('SAFETY-ECHO');
      expect(mc.delete).not.toHaveBeenCalled();
    });
  });
});
