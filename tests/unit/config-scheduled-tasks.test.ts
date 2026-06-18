/**
 * Scheduled Task config tool-layer unit tests (polymorphic / "complex").
 *
 * Verifies: tool registration (incl. describe_scheduled_task_schema), the
 * typed-discriminator + validated-config create mapping (thirdparty and report
 * subtypes -> exact camelCase API body), mandatory/discriminator enforcement via
 * assertConfigBody (post NOT called), the GET-strip-merge-PUT update cycle (PUT
 * on collection root, audited server fields stripped), the delete safety echo,
 * and that describe returns the embedded schema.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerScheduledTaskTools } from '../../src/tools/config/scheduled-tasks.js';

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
  registerScheduledTaskTools(
    server,
    mc as unknown as Parameters<typeof registerScheduledTaskTools>[1],
  );
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, mc };
}

describe('scheduled task tools registration', () => {
  it('registers the expected scheduled_task tools', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'list_scheduled_tasks',
      'get_scheduled_task',
      'create_scheduled_task',
      'update_scheduled_task',
      'delete_scheduled_task',
      'describe_scheduled_task_schema',
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe('describe_scheduled_task_schema', () => {
  it('returns the embedded request JSON schema and metadata', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_scheduled_task_schema',
      arguments: {},
    });
    const out = parse(res);
    expect(out['object']).toBe('scheduled_task');
    expect(out['discriminatorField']).toBe('type');
    expect(out['mandatoryFields']).toEqual(['type', 'name', 'cron', 'enabled']);
    const schema = out['jsonSchema'] as Record<string, unknown>;
    expect(schema['$id']).toBe(
      'https://evertrust.io/horizon/schemas/scheduled_tasks.request.json',
    );
    expect(schema).toHaveProperty('oneOf');
  });

  it('echoes the requested subtype', async () => {
    const { client } = await setup();
    const res = await client.callTool({
      name: 'describe_scheduled_task_schema',
      arguments: { subtype: 'thirdparty' },
    });
    expect(parse(res)['requestedSubtype']).toBe('thirdparty');
  });
});

describe('create_scheduled_task (typed discriminator + validated config)', () => {
  let client: Client;
  let mc: MockClient;
  beforeEach(async () => {
    ({ client, mc } = await setup());
  });

  it('POSTs a thirdparty task with the merged camelCase body', async () => {
    mc.post.mockResolvedValueOnce({ name: 't1' });
    const res = await client.callTool({
      name: 'create_scheduled_task',
      arguments: {
        type: 'thirdparty',
        name: 't1',
        cron: '0 0 * * * ?',
        enabled: true,
        config: {
          dryRun: false,
          module: 'webra',
          profile: 'prof1',
          connector: 'conn1',
          enroll: true,
          revoke: false,
          renew: true,
        },
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/scheduler/tasks', {
      type: 'thirdparty',
      name: 't1',
      cron: '0 0 * * * ?',
      enabled: true,
      dryRun: false,
      module: 'webra',
      profile: 'prof1',
      connector: 'conn1',
      enroll: true,
      revoke: false,
      renew: true,
    });
    expect(parse(res)['status']).toBe('created');
  });

  it('POSTs a report task and maps report_type -> reportType', async () => {
    mc.post.mockResolvedValueOnce({ name: 'r1' });
    await client.callTool({
      name: 'create_scheduled_task',
      arguments: {
        type: 'report',
        name: 'r1',
        cron: '0 0 8 * * ?',
        enabled: true,
        report_type: 'attachment_email',
        config: {
          from: 'reports@example.com',
          title: 'Daily report',
          isHtml: false,
          hqlType: 'hcql',
          recipients: [{ type: 'static', email: 'ops@example.com' }],
        },
      },
    });
    expect(mc.post).toHaveBeenCalledWith('/api/v1/scheduler/tasks', {
      type: 'report',
      name: 'r1',
      cron: '0 0 8 * * ?',
      enabled: true,
      reportType: 'attachment_email',
      from: 'reports@example.com',
      title: 'Daily report',
      isHtml: false,
      hqlType: 'hcql',
      recipients: [{ type: 'static', email: 'ops@example.com' }],
    });
  });

  it('rejects a thirdparty task missing a mandatory config field (connector)', async () => {
    const res = await client.callTool({
      name: 'create_scheduled_task',
      arguments: {
        type: 'thirdparty',
        name: 't1',
        cron: '0 0 * * * ?',
        enabled: true,
        config: {
          dryRun: false,
          module: 'webra',
          profile: 'prof1',
          enroll: true,
          revoke: false,
          renew: true,
        },
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects a report task missing the reportType discriminator', async () => {
    const res = await client.callTool({
      name: 'create_scheduled_task',
      arguments: {
        type: 'report',
        name: 'r1',
        cron: '0 0 8 * * ?',
        enabled: true,
        config: {
          from: 'reports@example.com',
          title: 'Daily report',
          isHtml: false,
          hqlType: 'hcql',
          recipients: [{ type: 'static', email: 'ops@example.com' }],
        },
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects a missing top-level mandatory (cron) via schema validation', async () => {
    const res = await client.callTool({
      name: 'create_scheduled_task',
      arguments: {
        type: 'thirdparty',
        name: 't1',
        enabled: true,
        config: {
          dryRun: false,
          module: 'webra',
          profile: 'prof1',
          connector: 'conn1',
          enroll: true,
          revoke: false,
          renew: true,
        },
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });

  it('rejects an unknown top-level config field', async () => {
    const res = await client.callTool({
      name: 'create_scheduled_task',
      arguments: {
        type: 'thirdparty',
        name: 't1',
        cron: '0 0 * * * ?',
        enabled: true,
        config: {
          dryRun: false,
          module: 'webra',
          profile: 'prof1',
          connector: 'conn1',
          enroll: true,
          revoke: false,
          renew: true,
          bogusField: 'x',
        },
      },
    });
    expect(isError(res)).toBe(true);
    expect(mc.post).not.toHaveBeenCalled();
  });
});

describe('update_scheduled_task (GET-strip-merge-PUT on collection root)', () => {
  it('GETs the item, strips server fields, merges, PUTs the collection', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'abc',
      tenant: 'tenant1',
      host: 'node-1',
      status: 'success',
      lastExecutionDate: 1,
      lastCompletionDate: 2,
      detail: 'ok',
      executionId: 'exec-9',
      type: 'thirdparty',
      name: 't1',
      cron: '0 0 * * * ?',
      enabled: false,
      dryRun: false,
      module: 'webra',
      profile: 'prof1',
      connector: 'conn1',
      enroll: true,
      revoke: false,
      renew: true,
    });
    mc.put.mockResolvedValueOnce({ name: 't1' });
    await client.callTool({
      name: 'update_scheduled_task',
      arguments: {
        type: 'thirdparty',
        name: 't1',
        cron: '0 0 * * * ?',
        enabled: true,
        config: {
          dryRun: false,
          module: 'webra',
          profile: 'prof1',
          connector: 'conn1',
          enroll: true,
          revoke: false,
          renew: true,
        },
      },
    });
    expect(mc.get).toHaveBeenCalledWith('/api/v1/scheduler/tasks/t1');
    const [putPath, putBody] = mc.put.mock.calls[0]! as [
      string,
      Record<string, unknown>,
    ];
    expect(putPath).toBe('/api/v1/scheduler/tasks');
    for (const stripped of [
      '_id',
      'tenant',
      'host',
      'status',
      'lastExecutionDate',
      'lastCompletionDate',
      'detail',
      'executionId',
    ]) {
      expect(putBody).not.toHaveProperty(stripped);
    }
    expect(putBody).toMatchObject({
      type: 'thirdparty',
      name: 't1',
      enabled: true,
      connector: 'conn1',
    });
  });

  it('clear_fields nulls a field explicitly', async () => {
    const { client, mc } = await setup();
    mc.get.mockResolvedValueOnce({
      _id: 'x',
      type: 'thirdparty',
      name: 't1',
      cron: '0 0 * * * ?',
      enabled: true,
      dryRun: false,
      module: 'webra',
      profile: 'prof1',
      connector: 'conn1',
      enroll: true,
      revoke: false,
      renew: true,
      description: 'old',
    });
    await client.callTool({
      name: 'update_scheduled_task',
      arguments: {
        type: 'thirdparty',
        name: 't1',
        cron: '0 0 * * * ?',
        enabled: true,
        config: {
          dryRun: false,
          module: 'webra',
          profile: 'prof1',
          connector: 'conn1',
          enroll: true,
          revoke: false,
          renew: true,
        },
        clear_fields: ['description'],
      },
    });
    const putBody = mc.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(putBody['description']).toBeNull();
  });
});

describe('delete_scheduled_task safety echo', () => {
  it('deletes when expected_name matches', async () => {
    const { client, mc } = await setup();
    await client.callTool({
      name: 'delete_scheduled_task',
      arguments: { name: 't1', expected_name: 't1' },
    });
    expect(mc.delete).toHaveBeenCalledWith('/api/v1/scheduler/tasks/t1');
  });

  it('refuses when expected_name does not match', async () => {
    const { client, mc } = await setup();
    const res = await client.callTool({
      name: 'delete_scheduled_task',
      arguments: { name: 't1', expected_name: 'WRONG' },
    });
    expect(isError(res)).toBe(true);
    expect(mc.delete).not.toHaveBeenCalled();
  });
});
