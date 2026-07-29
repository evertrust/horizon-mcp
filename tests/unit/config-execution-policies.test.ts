/**
 * Execution policy config-tool unit tests.
 *
 * Verifies the flat/typed execution_policies object: tool registration,
 * snake_case -> camelCase payload mapping (authorized_periods/forbidden_periods
 * and nested date_range/week_days/time_range), mandatory-field enforcement,
 * the GET-strip-merge-PUT update cycle (PUT on collection root, _id stripped),
 * and the delete safety echo.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerExecutionPolicyTools } from '../../src/tools/config/execution-policies.js';

function createMockClient() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(null),
    deleteWithBody: vi.fn().mockResolvedValue(null),
    getBytes: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    getText: vi.fn().mockResolvedValue(''),
    postText: vi.fn().mockResolvedValue(''),
    postMultipart: vi.fn().mockResolvedValue({}),
    request: vi.fn().mockResolvedValue(new Response()),
    close: vi.fn().mockResolvedValue(undefined),
    fetchCsrfToken: vi.fn().mockResolvedValue(undefined),
    exportTimeout: 120000,
    principalName: undefined,
    horizonVersion: undefined,
  };
}
type MockClient = ReturnType<typeof createMockClient>;

function parse(result: unknown): Record<string, unknown> {
  const r = result as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}
function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

async function setup(): Promise<{ client: Client; mc: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mc = createMockClient();
  registerExecutionPolicyTools(
    server,
    mc as unknown as Parameters<typeof registerExecutionPolicyTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('execution_policy tools registration', () => {
  it('registers the expected list/get/create/update/delete tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_execution_policies',
      'get_execution_policy',
      'create_execution_policy',
      'update_execution_policy',
      'delete_execution_policy',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('create_execution_policy (mandatory + snake_case -> camelCase mapping)', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs the collection with name only when no periods supplied', async () => {
    mc.post.mockResolvedValueOnce({ name: 'ep1' });
    const res = await client.callTool({
      name: 'create_execution_policy',
      arguments: { name: 'ep1' },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/automation/executions', {
      name: 'ep1',
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('maps period inputs to the exact camelCase API keys', async () => {
    mc.post.mockResolvedValueOnce({ name: 'ep1' });
    await client.callTool({
      name: 'create_execution_policy',
      arguments: {
        name: 'ep1',
        description: 'business hours only',
        authorized_periods: [
          {
            date_range: { start: '2026-01-01', end: '2026-12-31' },
            weeks: [1, 2, 3],
            week_days: ['MONDAY', 'TUESDAY'],
            time_range: { start: '08:00:00', end: '18:00:00' },
          },
        ],
        forbidden_periods: [{ week_days: ['SATURDAY', 'SUNDAY'] }],
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/automation/executions', {
      name: 'ep1',
      description: 'business hours only',
      authorizedPeriods: [
        {
          dateRange: { start: '2026-01-01', end: '2026-12-31' },
          weeks: [1, 2, 3],
          weekDays: ['MONDAY', 'TUESDAY'],
          timeRange: { start: '08:00:00', end: '18:00:00' },
        },
      ],
      forbiddenPeriods: [{ weekDays: ['SATURDAY', 'SUNDAY'] }],
    });
  });

  it('rejects a missing mandatory field (name) via schema validation', async () => {
    const res = await client.callTool({
      name: 'create_execution_policy',
      arguments: { description: 'no name' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an invalid week_days enum value', async () => {
    const res = await client.callTool({
      name: 'create_execution_policy',
      arguments: {
        name: 'ep1',
        authorized_periods: [{ week_days: ['FUNDAY'] }],
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_execution_policy (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips _id, merges overrides, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      name: 'ep1',
      description: 'old',
      authorizedPeriods: [{ weekDays: ['MONDAY'] }],
    });
    mc.put.mockResolvedValueOnce({ name: 'ep1', description: 'new' });
    await client.callTool({
      name: 'update_execution_policy',
      arguments: { name: 'ep1', description: 'new' },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/automation/executions/ep1');
    const [putPath, putBody] = mc.put.mock.calls[0]!;
    expect(putPath).toBe('/api/v1/automation/executions');
    expect(putBody).not.toHaveProperty('_id');
    expect(putBody).toMatchObject({
      name: 'ep1',
      description: 'new',
      authorizedPeriods: [{ weekDays: ['MONDAY'] }],
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      name: 'ep1',
      description: 'd',
      authorizedPeriods: [{ weekDays: ['MONDAY'] }],
    });
    await client.callTool({
      name: 'update_execution_policy',
      arguments: { name: 'ep1', clear_fields: ['description'] },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['description']).toBeNull();
  });
});

describe('delete_execution_policy safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_execution_policy',
      arguments: { name: 'ep1', expected_name: 'ep1' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/automation/executions/ep1');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_execution_policy',
      arguments: { name: 'ep1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
