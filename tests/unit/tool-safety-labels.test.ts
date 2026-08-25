import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';

import type { HorizonClient } from '../../src/client/http.js';
import { createSessionServer } from '../../src/server-factory.js';

const SAFETY_TIER_PATTERN =
  /^Safety tier: (read-only|mutating-safe|mutating-destructive)$/m;

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
    exportTimeout: 120,
    principalName: undefined,
    horizonVersion: undefined,
  } as unknown as HorizonClient;
}

describe('tool safety labels', () => {
  it('agree with annotations across the full tool surface', async () => {
    const server = createSessionServer(mockClient(), { readOnly: false });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'tool-safety-labels', version: '0.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    try {
      const { tools } = await client.listTools();
      const labelledTools = tools.flatMap((tool) => {
        const tier = tool.description?.match(SAFETY_TIER_PATTERN)?.[1];
        return tier === undefined ? [] : [{ tool, tier }];
      });
      const mismatches = labelledTools.flatMap(({ tool, tier }) => {
        const annotations = tool.annotations;
        const matches =
          (tier === 'read-only' && annotations.readOnlyHint === true) ||
          (tier === 'mutating-safe' &&
            annotations.readOnlyHint === false &&
            annotations.destructiveHint === false) ||
          (tier === 'mutating-destructive' &&
            annotations.readOnlyHint === false &&
            annotations.destructiveHint === true);
        return matches ? [] : [tool.name];
      });

      expect(labelledTools.length).toBeGreaterThanOrEqual(40);
      expect(
        mismatches,
        `Safety-tier annotation mismatches: ${mismatches.join(', ')}`,
      ).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
