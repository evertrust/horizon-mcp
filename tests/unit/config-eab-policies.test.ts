/**
 * ACME EAB policy config-tool unit tests (Horizon 2.11+).
 *
 * Verifies the POST /list handler (including the empty 204 response), the
 * create payload, GET-merge-PUT update on the collection root, and the delete
 * echo guard.
 */
import type { Client } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerEabPolicyTools } from '../../src/tools/config/eab-policies.js';
import {
  type MockClient,
  parseToolResult,
  setupServerAndClient,
} from './support/tool-harness.js';

const POLICY = {
  _id: '6448d56b310000400063f014',
  name: 'web-servers',
  identifierConstraint: '.*\\.example\\.com',
  allowedProfiles: ['acme-web'],
  validationMethods: ['http-01'],
};

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

describe('EAB policy tools', () => {
  let client: Client;
  let mc: MockClient;

  beforeEach(async () => {
    ({ client, mockClient: mc } = await setupServerAndClient([
      registerEabPolicyTools as never,
    ]));
  });

  it('registers the five EAB policy tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'create_eab_policy',
      'delete_eab_policy',
      'get_eab_policy',
      'list_eab_policies',
      'update_eab_policy',
    ]);
  });

  describe('list_eab_policies', () => {
    it('posts an empty body to the list route', async () => {
      mc.post.mockResolvedValueOnce([POLICY]);
      const result = await client.callTool({
        name: 'list_eab_policies',
        arguments: {},
      });
      expect(mc.post).toHaveBeenCalledWith(
        '/api/v1/acme/eab-policies/list',
        {},
      );
      expect(mc.get).not.toHaveBeenCalled();
      const body = parseToolResult(result);
      expect(body['items']).toEqual([POLICY]);
      expect(body['kind']).toBe('eab_policy');
    });

    it('returns an empty list for a 204 response', async () => {
      mc.post.mockResolvedValueOnce({});
      const result = await client.callTool({
        name: 'list_eab_policies',
        arguments: {},
      });
      expect(parseToolResult(result)['items']).toEqual([]);
    });
  });

  it('get_eab_policy reads the item route', async () => {
    mc.get.mockResolvedValueOnce(POLICY);
    await client.callTool({
      name: 'get_eab_policy',
      arguments: { name: 'web-servers' },
    });
    expect(mc.get).toHaveBeenCalledWith(
      '/api/v1/acme/eab-policies/web-servers',
    );
  });

  describe('create_eab_policy', () => {
    it('maps the inputs to the API fields', async () => {
      mc.post.mockResolvedValueOnce(POLICY);
      const result = await client.callTool({
        name: 'create_eab_policy',
        arguments: {
          name: 'web-servers',
          identifier_constraint: '.*\\.example\\.com',
          allowed_profiles: ['acme-web'],
          validation_methods: ['http-01'],
          email_constraint: '.*@example\\.com',
        },
      });
      expect(mc.post).toHaveBeenCalledWith('/api/v1/acme/eab-policies', {
        name: 'web-servers',
        identifierConstraint: '.*\\.example\\.com',
        allowedProfiles: ['acme-web'],
        validationMethods: ['http-01'],
        emailConstraint: '.*@example\\.com',
      });
      expect(parseToolResult(result)['status']).toBe('created');
    });

    it('rejects an unknown validation method', async () => {
      const result = await client.callTool({
        name: 'create_eab_policy',
        arguments: { name: 'web-servers', validation_methods: ['email-01'] },
      });
      expect(isError(result)).toBe(true);
      expect(mc.post).not.toHaveBeenCalled();
    });
  });

  it('update_eab_policy merges and puts on the collection root', async () => {
    mc.get.mockResolvedValueOnce(POLICY);
    mc.put.mockResolvedValueOnce({ ...POLICY, validationMethods: ['dns-01'] });
    await client.callTool({
      name: 'update_eab_policy',
      arguments: { name: 'web-servers', validation_methods: ['dns-01'] },
    });
    expect(mc.put).toHaveBeenCalledWith('/api/v1/acme/eab-policies', {
      name: 'web-servers',
      identifierConstraint: '.*\\.example\\.com',
      allowedProfiles: ['acme-web'],
      validationMethods: ['dns-01'],
    });
  });

  it('delete_eab_policy requires the name echo', async () => {
    const refused = await client.callTool({
      name: 'delete_eab_policy',
      arguments: { name: 'web-servers', expected_name: 'other' },
    });
    expect(isError(refused)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();

    await client.callTool({
      name: 'delete_eab_policy',
      arguments: { name: 'web-servers', expected_name: 'web-servers' },
    });
    expect(mc.delete).toHaveBeenCalledWith(
      '/api/v1/acme/eab-policies/web-servers',
    );
  });
});
