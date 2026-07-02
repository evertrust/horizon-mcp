import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

import type { HorizonClient } from '../../src/client/http.js';
import {
  TOOLSET_NAMES,
  createSessionServer,
} from '../../src/server-factory.js';

function mockClient(): HorizonClient {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(null),
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
  } as unknown as HorizonClient;
}

async function connect(server: ReturnType<typeof createSessionServer>) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

describe('createSessionServer', () => {
  it('registers the full tool set, including the config CRUD tools', async () => {
    const server = createSessionServer(mockClient());
    const client = await connect(server);
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);

      // Core tools from several domains.
      expect(names).toContain('whoami');
      expect(names).toContain('search_certificates');
      expect(names).toContain('list_profiles');
      // Config CRUD tools (the suite omitted from golden's registerAllTools).
      expect(names).toContain('create_certificate_profile');
      expect(names).toContain('list_service_accounts');

      // The full surface is large; guard against a domain silently dropping.
      expect(tools.length).toBeGreaterThan(150);
    } finally {
      await client.close();
    }
  });

  it('exposes the knowledge resources (not only tools)', async () => {
    const server = createSessionServer(mockClient());
    const client = await connect(server);
    try {
      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('horizon://knowledge/server-rules');
    } finally {
      await client.close();
    }
  });
});

describe('createSessionServer toolset gating', () => {
  async function listToolNames(server: ReturnType<typeof createSessionServer>) {
    const client = await connect(server);
    try {
      const { tools } = await client.listTools();
      return tools.map((t) => t.name);
    } finally {
      await client.close();
    }
  }

  it('exposes a representative tool from every toolset by default', async () => {
    const names = await listToolNames(createSessionServer(mockClient()));

    // One representative tool per toolset name.
    expect(names).toContain('search_certificates'); // lifecycle
    expect(names).toContain('list_profiles'); // profiles
    expect(names).toContain('list_dashboards'); // dashboards
    expect(names).toContain('list_discovery_campaigns'); // discovery
    expect(names).toContain('list_datasources'); // datasources
    expect(names).toContain('list_reports'); // reports
    expect(names).toContain('list_triggers'); // triggers
    expect(names).toContain('search_docs'); // docs
    expect(names).toContain('whoami'); // assist
    expect(names).toContain('create_certificate_profile'); // config
  });

  it('registers only the selected toolsets', async () => {
    const names = await listToolNames(
      createSessionServer(mockClient(), { enabledToolsets: ['docs'] }),
    );

    expect(names).toContain('search_docs');
    expect(names).toContain('read_knowledge');
    // Tools from other domains are absent.
    expect(names).not.toContain('search_certificates');
    expect(names).not.toContain('whoami');
    expect(names).not.toContain('create_certificate_profile');
  });

  it('throws with the valid list when a toolset name is unknown', () => {
    expect(() =>
      createSessionServer(mockClient(), {
        enabledToolsets: ['docs', 'bogus'],
      }),
    ).toThrow(/bogus/);
    expect(() =>
      createSessionServer(mockClient(), { enabledToolsets: ['bogus'] }),
    ).toThrow(new RegExp(TOOLSET_NAMES.join('|')));
  });

  it('read-only mode strips mutating tools but keeps read-only tools', async () => {
    const names = await listToolNames(
      createSessionServer(mockClient(), { readOnly: true }),
    );

    // Read-only tools survive.
    expect(names).toContain('search_certificates');
    expect(names).toContain('whoami');
    expect(names).toContain('read_knowledge');
    expect(names).toContain('get_certificate');

    // Mutating tools are stripped.
    expect(names).not.toContain('create_certificate_profile');
    expect(names).not.toContain('delete_ca');
    expect(names).not.toContain('update_trigger');
    expect(names).not.toContain('submit_request');
  });
});
