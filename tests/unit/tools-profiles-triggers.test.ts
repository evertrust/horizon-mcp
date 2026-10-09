import type { Client } from '@modelcontextprotocol/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerProfileTools } from '../../src/tools/profiles.js';
import { configureToolRegistration } from '../../src/tools/register.js';
import { registerTriggerTools } from '../../src/tools/triggers.js';
import {
  type MockClient,
  parseToolResult,
  resetMocks,
  setupServerAndClient,
} from './support/tool-harness.js';

// ===========================================================================
// 1. PROFILE TOOLS
// ===========================================================================

describe('Profile tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient([
      (server, mc) => {
        registerProfileTools(server, mc as any);
      },
    ]);
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('list_profiles', () => {
    it('returns profiles', async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: 'WebRA-Prod', module: 'webra' },
        { name: 'ACME-Staging', module: 'acme' },
      ]);

      const result = await client.callTool({
        name: 'list_profiles',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/certificate/profiles',
      );
      expect(parsed['count']).toBe(2);
      expect(parsed['kind']).toBe('profile');
    });

    it('filters by module', async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: 'WebRA-Prod', module: 'webra' },
        { name: 'ACME-Staging', module: 'acme' },
        { name: 'WebRA-Dev', module: 'webra' },
      ]);

      const result = await client.callTool({
        name: 'list_profiles',
        arguments: { module: 'webra' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(2);
      const items = parsed['items'] as Array<Record<string, unknown>>;
      expect(items.every((i) => i['module'] === 'webra')).toBe(true);
    });

    it('unwraps an {items: [...]} envelope response', async () => {
      mockClient.get.mockResolvedValueOnce({
        items: [
          { name: 'WebRA-Prod', module: 'webra' },
          { name: 'ACME-Staging', module: 'acme' },
        ],
      });

      const result = await client.callTool({
        name: 'list_profiles',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(2);
      expect(parsed['kind']).toBe('profile');
    });

    it('wraps a single bare object response in a one-item list', async () => {
      mockClient.get.mockResolvedValueOnce({
        name: 'WebRA-Prod',
        module: 'webra',
      });

      const result = await client.callTool({
        name: 'list_profiles',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(1);
      const items = parsed['items'] as Array<Record<string, unknown>>;
      expect(items[0]!['name']).toBe('WebRA-Prod');
    });

    it.each([
      ['an empty bare array', []],
      ['an envelope with an empty items array', { items: [] }],
      ['an object with the collection field absent', {}],
    ])('returns no profiles for %s', async (_description, upstreamResponse) => {
      mockClient.get.mockResolvedValueOnce(upstreamResponse);

      const result = await client.callTool({
        name: 'list_profiles',
        arguments: {},
      });

      expect(parseToolResult(result)).toEqual({
        items: [],
        count: 0,
        total_available: 0,
        truncated: false,
        kind: 'profile',
      });
    });
  });
});

// ===========================================================================
// 1b. TRIGGER TOOLS (normalizeItems wiring)
// ===========================================================================

describe('Trigger tools', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient([
      (server, mc) => {
        registerTriggerTools(server, mc as any);
      },
    ]);
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe('list_triggers', () => {
    it('accepts a netscaler filter and returns only matching triggers', async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: 'deploy-netscaler', type: 'netscaler' },
        { name: 'notify-email', type: 'email' },
      ]);

      const result = await client.callTool({
        name: 'list_triggers',
        arguments: { trigger_type: 'netscaler' },
      });

      expect(result.isError).not.toBe(true);
      expect(parseToolResult(result)['items']).toEqual([
        { name: 'deploy-netscaler', type: 'netscaler' },
      ]);
    });

    it.each(['fortigate', 'fortimanager', 'panos_firewall', 'panos_panorama'])(
      'accepts a Horizon 2.11 %s filter',
      async (type) => {
        mockClient.get.mockResolvedValueOnce([
          { name: 'deploy-net', type },
          { name: 'notify-email', type: 'email' },
        ]);

        const result = await client.callTool({
          name: 'list_triggers',
          arguments: { trigger_type: type },
        });

        expect(result.isError).not.toBe(true);
        expect(parseToolResult(result)['items']).toEqual([
          { name: 'deploy-net', type },
        ]);
      },
    );

    it('returns triggers from a bare array response', async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: 'deploy-rest', type: 'rest' },
        { name: 'notify-email', type: 'email' },
      ]);

      const result = await client.callTool({
        name: 'list_triggers',
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith('/api/v1/triggers');
      expect(parsed['count']).toBe(2);
      expect(parsed['kind']).toBe('trigger');
    });

    it('unwraps an {items: [...]} envelope response', async () => {
      mockClient.get.mockResolvedValueOnce({
        items: [
          { name: 'deploy-rest', type: 'rest' },
          { name: 'notify-email', type: 'email' },
        ],
      });

      const result = await client.callTool({
        name: 'list_triggers',
        arguments: { trigger_type: 'rest' },
      });
      const parsed = parseToolResult(result);

      expect(parsed['count']).toBe(1);
      const items = parsed['items'] as Array<Record<string, unknown>>;
      expect(items[0]!['name']).toBe('deploy-rest');
    });
  });

  describe('simulate_trigger', () => {
    it('is unavailable in read-only mode and makes no upstream call', async () => {
      const { client: readOnlyClient, mockClient: mc } =
        await setupServerAndClient([
          (server, mc) => {
            configureToolRegistration(server, { readOnly: true });
            registerTriggerTools(server, mc as any);
          },
        ]);
      expect(
        (await readOnlyClient.listTools()).tools.map((tool) => tool.name),
      ).not.toContain('simulate_trigger');
      await expect(
        readOnlyClient.callTool({
          name: 'simulate_trigger',
          arguments: { name: 'notify-email' },
        }),
      ).rejects.toThrow('not found');
      expect(mc.get).not.toHaveBeenCalled();
      expect(mc.patch).not.toHaveBeenCalled();
      await readOnlyClient.close();
    });

    it('advertises notification side effects', async () => {
      const tool = (await client.listTools()).tools.find(
        (tool) => tool.name === 'simulate_trigger',
      );
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      });
    });

    it('fetches the named trigger and sends the full body under trigger', async () => {
      const trigger = {
        _id: 'trigger-id',
        name: 'deploy-rest',
        type: 'rest',
        events: ['on_enroll'],
        sequence: [
          {
            method: 'POST',
            url: 'https://example.com/deploy',
            authenticationType: 'noauth',
            expectedHttpCodes: [200],
            timeout: '30 seconds',
          },
        ],
      };
      mockClient.get.mockResolvedValue(trigger);
      mockClient.patch.mockResolvedValue({
        status: 'success',
        message: 'Rest notification successfully sent',
      });

      for (let call = 0; call < 2; call++) {
        const result = await client.callTool({
          name: 'simulate_trigger',
          arguments: { name: 'deploy-rest' },
        });
        expect(result.isError).not.toBe(true);
      }
      expect(mockClient.patch).toHaveBeenCalledTimes(2);

      expect(mockClient.get).toHaveBeenCalledWith(
        '/api/v1/triggers/deploy-rest',
      );
      expect(mockClient.patch).toHaveBeenCalledWith('/api/v1/triggers', {
        trigger,
      });
    });
  });
});

// ===========================================================================
// 2. LIFECYCLE TOOLS
