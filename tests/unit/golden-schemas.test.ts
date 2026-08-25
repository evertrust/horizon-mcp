import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllResources } from '../../src/resources/index.js';
import {
  createMockClient,
  registerAllTools,
} from './support/golden-harness.js';

describe('Critical tool schema spot-checks', () => {
  let toolsByName: Map<string, { inputSchema: Record<string, unknown> }>;

  beforeAll(async () => {
    const server = new McpServer({
      name: 'test-schemas',
      version: '0.0.0',
    });
    const mockClient = createMockClient();
    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'test-schemas-client',
      version: '0.0.0',
    });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const result = await client.listTools();
    toolsByName = new Map(
      result.tools.map((t) => [
        t.name,
        { inputSchema: t.inputSchema as Record<string, unknown> },
      ]),
    );
  });

  function getParamNames(toolName: string): Set<string> {
    const schema = toolsByName.get(toolName)?.inputSchema;
    if (!schema) return new Set();
    const props = (schema['properties'] as Record<string, unknown>) ?? {};
    return new Set(Object.keys(props));
  }

  it('search_certificates has expected params', () => {
    const params = getParamNames('search_certificates');
    for (const expected of [
      'query',
      'preset',
      'fields',
      'page_index',
      'page_size',
      'sorted_by',
      'with_count',
    ]) {
      expect(
        params.has(expected),
        `search_certificates missing param: ${expected}`,
      ).toBe(true);
    }
  });

  it('submit_request has expected params', () => {
    const params = getParamNames('submit_request');
    for (const expected of [
      'workflow',
      'profile',
      'module',
      'template',
      'data',
    ]) {
      expect(
        params.has(expected),
        `submit_request missing param: ${expected}`,
      ).toBe(true);
    }
  });

  it('create_dns_datasource has expected params', () => {
    const params = getParamNames('create_dns_datasource');
    for (const expected of [
      'name',
      'lookup',
      'host',
      'port',
      'timeout',
      'record_types',
    ]) {
      expect(
        params.has(expected),
        `create_dns_datasource missing param: ${expected}`,
      ).toBe(true);
    }
  });

  it('create_ldap_datasource has expected params', () => {
    const params = getParamNames('create_ldap_datasource');
    for (const expected of [
      'name',
      'hostname',
      'credentials',
      'base_dn',
      'filter',
      'secure',
      'timeout',
    ]) {
      expect(
        params.has(expected),
        `create_ldap_datasource missing param: ${expected}`,
      ).toBe(true);
    }
  });

  it('create_rest_notification has expected params', () => {
    const params = getParamNames('create_rest_notification');
    for (const expected of [
      'name',
      'event',
      'sequence',
      'retries',
      'run_period',
      'run_on_renewed',
    ]) {
      expect(
        params.has(expected),
        `create_rest_notification missing param: ${expected}`,
      ).toBe(true);
    }
  });
});

// ===================================================================
// Delete tool enumeration (ported from test_safety.py)
// ===================================================================

describe('Delete tool safety-tier enumeration', () => {
  const EXPECTED_DELETE_TOOLS = [
    'delete_dashboard',
    'delete_datasource',
    'delete_discovery_campaign',
    'delete_report',
    'delete_saved_query',
    'delete_trigger',
  ].sort();

  it('only expected delete tools are registered', async () => {
    const server = new McpServer({
      name: 'test-safety',
      version: '0.0.0',
    });
    const mockClient = createMockClient();
    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'test-safety-client',
      version: '0.0.0',
    });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const result = await client.listTools();
    const deleteTools = result.tools
      .map((t) => t.name)
      .filter((n) => n.startsWith('delete_'))
      .sort();

    expect(deleteTools).toEqual(EXPECTED_DELETE_TOOLS);
  });
});
