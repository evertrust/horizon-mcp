import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { getAllResources } from '../../src/resources/catalog.js';
import { registerAllResources } from '../../src/resources/index.js';

/** Recompute the deterministic, content-derived timestamp the module emits. */
function expectedContentTimestampIso(): string {
  const digest = createHash('sha256')
    .update(
      getAllResources()
        .map((r) => `${r.uri} ${r.content}`)
        .join(''),
    )
    .digest();
  return new Date(digest.readUIntBE(0, 5)).toISOString();
}

/** Register resources on a fresh server and list them over the MCP protocol. */
async function listRegisteredResources() {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerAllResources(server);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  const result = await client.listResources();
  await client.close();
  return result.resources;
}

describe('resource lastModified annotation', () => {
  it('is content-derived and stable across restarts, not process start time', async () => {
    const expected = expectedContentTimestampIso();

    const resources = await listRegisteredResources();
    const sample = resources.find(
      (r) => r.uri === 'horizon://knowledge/query-languages',
    );
    expect(
      sample,
      'expected query-languages resource to be listed',
    ).toBeDefined();

    const lastModified = (sample!.annotations as { lastModified?: string })
      .lastModified;

    // Flows through the MCP schema (a valid ISO datetime) and equals the
    // deterministic content digest, NOT a per-process wall-clock value.
    expect(lastModified).toBe(expected);

    // Guard against regression to `new Date().toISOString()`: the emitted
    // value must not be near the current wall-clock time.
    const nowMs = Date.now();
    const emittedMs = Date.parse(lastModified!);
    expect(Math.abs(nowMs - emittedMs)).toBeGreaterThan(60_000);
  });

  it('emits an identical lastModified across independent registrations', async () => {
    const [first, second] = await Promise.all([
      listRegisteredResources(),
      listRegisteredResources(),
    ]);

    const pick = (rs: typeof first) =>
      (
        rs.find((r) => r.uri === 'horizon://knowledge/query-languages')!
          .annotations as { lastModified?: string }
      ).lastModified;

    expect(pick(first)).toBe(pick(second));
  });
});
