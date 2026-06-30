import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

import type { HorizonClient } from '../../src/client/http.js';
import { createSessionServer } from '../../src/server-factory.js';

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
