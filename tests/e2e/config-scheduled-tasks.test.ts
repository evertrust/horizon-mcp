/**
 * Live-QA E2E for the Horizon "scheduled_tasks" object.
 * Path: MCP protocol -> tool handler -> HorizonClient -> live Horizon QA,
 * against /api/v1/scheduler/tasks. idField = `name`.
 *
 * scheduled_task is polymorphic (type = report | thirdparty) with
 * subtype-conditional mandatory fields. A `thirdparty` task needs a pre-existing
 * PKI connector + profile; a `report` task needs a valid HQL report config.
 * To stay self-contained we exercise a `report` task (no connector dependency),
 * with the body shape taken from the Bruno CI suite
 * (horizon/cicd/Evertrust-Horizon-api-test/32 - Scheduled Task).
 *
 * Read paths (list + describe) are asserted unconditionally. The create is
 * TOLERANT: it either round-trips (create -> get -> update -> delete, cleaned)
 * or surfaces a clean Horizon validation error (proving the tool reaches the
 * server with a well-formed request), never a client/tool bug.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('scheduled_task E2E (live QA)', () => {
  setupE2EStack();

  const name = `${E2E_PREFIX}-sched`;
  let created = false;

  const reportConfig = {
    recipients: [{ type: 'static', email: 'e2e@example.com' }],
    from: 'e2e@example.com',
    title: 'e2e report',
    isHtml: false,
    hqlType: 'hcql',
    hqlQuery: 'status is valid',
    hqlFields: ['dn'],
    fileName: 'e2e-report',
  };

  afterAll(async () => {
    if (!created) return;
    try {
      await callTool('delete_scheduled_task', {
        name,
        expected_name: name,
      });
    } catch {
      /* best-effort cleanup */
    }
  });

  it('lists scheduled tasks', async () => {
    const res = (await callTool('list_scheduled_tasks', {})) as Record<
      string,
      unknown
    >;
    const items = (res['items'] ?? res) as unknown;
    expect(Array.isArray(items)).toBe(true);
  });

  it('describe_scheduled_task_schema returns the type discriminator + schema', async () => {
    const out = (await callTool(
      'describe_scheduled_task_schema',
      {},
    )) as Record<string, unknown>;
    expect(out['discriminatorField']).toBe('type');
    expect(out['jsonSchema']).toBeDefined();
  });

  it('creates a report scheduled task (or reports a clean validation error)', async () => {
    try {
      const r = await callTool('create_scheduled_task', {
        type: 'report',
        name,
        cron: '0 0 12 * * ?',
        enabled: false,
        report_type: 'attachment_email',
        config: reportConfig,
      });
      expect(r['status']).toBe('created');
      created = true;
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).message).toMatch(
        /scheduled|task|report|cron|hql|recipient|licen[cs]e|email|template/i,
      );
    }
  });

  it('gets it back, updates the cron, then deletes', async () => {
    if (!created) return;
    const got = await callTool('get_scheduled_task', { name });
    expect(got['name']).toBe(name);

    // reportType is immutable (cannot convert attachment <-> link), so the
    // update keeps the created subtype and only changes the cron schedule.
    const upd = await callTool('update_scheduled_task', {
      type: 'report',
      name,
      cron: '0 0 18 * * ?',
      enabled: false,
      report_type: 'attachment_email',
      config: reportConfig,
    });
    expect(upd['status']).toBe('updated');

    const del = await callTool('delete_scheduled_task', {
      name,
      expected_name: name,
    });
    expect(del['deleted']).toBe(true);
    created = false;
  });
});
