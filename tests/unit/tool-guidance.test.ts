import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerConfigTools } from '../../src/tools/config/index.js';
import { registerLifecycleTools } from '../../src/tools/lifecycle.js';
import { registerTriggerTools } from '../../src/tools/triggers.js';
import {
  parseToolResult,
  setupServerAndClient,
} from './support/tool-harness.js';

const DESCRIPTION_NAMES = new Set([
  'submit_request',
  'simulate_trigger',
  'set_certificate_auto_renew',
  'list_service_accounts',
  'get_service_account',
  'create_service_account',
  'update_service_account',
  'delete_service_account',
  'list_terms_of_services',
  'get_terms_of_service',
  'create_terms_of_service',
  'update_terms_of_service',
  'delete_terms_of_service',
  'list_dcv_policy_status',
  'get_dcv_policy_status',
  'run_dcv_policy',
  'run_dcv_domain',
  'cancel_dcv_run',
  'list_dcv_events',
]);

describe('Tool guidance contracts', () => {
  let client: Client;
  beforeAll(async () => {
    ({ client } = await setupServerAndClient([
      (server, mc) => registerConfigTools(server, mc as never),
      (server, mc) => registerLifecycleTools(server, mc as never),
      (server, mc) => registerTriggerTools(server, mc as never),
    ]));
  });
  afterAll(async () => {
    await client.close();
  });

  it('advertises feature versions and notification safety', async () => {
    const tools = (await client.listTools()).tools
      .filter((tool) => DESCRIPTION_NAMES.has(tool.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(tools).toHaveLength(DESCRIPTION_NAMES.size);
    expect(
      tools.map(({ name, description }) => ({ name, description })),
    ).toMatchSnapshot();
  });

  it('advertises typed credential and profile field guidance', async () => {
    const tools = (await client.listTools()).tools;
    const providers = tools
      .filter((tool) =>
        ['create_dcv_provider', 'update_dcv_provider'].includes(tool.name),
      )
      .map((tool) => ({
        name: tool.name,
        credentials: (tool.inputSchema.oneOf as any[]).find(
          (schema) => schema.properties.type.const === 'gs_mssl',
        ).properties.credentials,
      }));
    const profiles = tools
      .filter((tool) =>
        ['create_certificate_profile', 'update_certificate_profile'].includes(
          tool.name,
        ),
      )
      .map((tool) => ({
        name: tool.name,
        autoRenewal: (tool.inputSchema.properties as any).auto_renewal_policy
          .description,
        termsOfService: (tool.inputSchema.properties as any).terms_of_service
          .description,
      }));
    expect(profiles).toHaveLength(2);
    for (const profile of profiles) {
      expect(profile.autoRenewal).toContain('(Horizon 2.10+)');
    }
    expect({ providers, profiles }).toMatchSnapshot();
  });

  it('describes DCV event availability', async () => {
    const result = await client.callTool({
      name: 'describe_trigger_schema',
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const schema = parseToolResult(result)['jsonSchema'] as any;
    expect(schema.$defs.TriggerEvent.description).toMatchSnapshot();
  });
});
