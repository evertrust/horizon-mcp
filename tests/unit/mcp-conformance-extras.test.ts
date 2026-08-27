import { beforeAll, describe, expect, it } from 'vitest';

import {
  META,
  V,
  body,
  createHarnesses,
  headers,
  bothHarnesses as runBothHarnesses,
} from './support/mcp-harness.js';

let harnesses: Awaited<ReturnType<typeof createHarnesses>> = [];

beforeAll(async () => {
  harnesses = await createHarnesses();
  return async () => {
    for (const harness of harnesses) await harness.close();
  };
}, 60000);

const bothHarnesses = (
  check: Parameters<typeof runBothHarnesses>[1],
): Promise<void> => runBothHarnesses(harnesses, check);

describe('Streamable HTTP 2026-07-28 extras', () => {
  it('echoes the JSON-RPC id on a protocol error', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          id: 42,
          method: 'tools/list',
          params: {
            _meta: {
              [META.version]: '1900-01-01',
              [META.capabilities]: {},
            },
          },
        },
        headers: {
          'MCP-Protocol-Version': '1900-01-01',
          'Mcp-Method': 'tools/list',
        },
      });
      expect(r.status).toBe(400);
      expect(r.json.id).toBe(42);
      expect(r.json.error.code).toBe(-32022);
      expect(r.json.error.data.supported).toEqual([V]);
    });
  }, 30000);

  it('accepts a progressToken on tools/call without changing resultType', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body(
          'tools/call',
          { name: 'whoami', arguments: {} },
          { progressToken: 'prog-1' },
        ),
        headers: headers('tools/call', 'whoami'),
      });
      expect(r.status).toBe(200);
      expect(r.json.error).toBeUndefined();
      expect(r.json.result.resultType).toBe('complete');
      expect(r.json.result).not.toHaveProperty('inputRequests');
      expect(r.headers.get('content-type')).toContain('application/json');
    });
  }, 30000);

  it('returns whoami as complete, never input_required', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', { name: 'whoami', arguments: {} }),
        headers: headers('tools/call', 'whoami'),
      });
      expect(r.status).toBe(200);
      expect(r.json.result.resultType).toBe('complete');
      expect(r.json.result).not.toHaveProperty('inputRequests');
      expect(r.json.result.isError).toBeFalsy();
      const blob = JSON.stringify(r.json.result);
      expect(blob).toContain('alice');
    });
  }, 30000);

  it('omits nextCursor on a complete tools/list page', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('tools/list'),
      });
      expect(r.json.result.resultType).toBe('complete');
      expect(r.json.result.nextCursor).toBeFalsy();
    });
  }, 30000);

  it('advertises instructions and no unused 2026 capabilities', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('server/discover'),
        headers: headers('server/discover'),
      });
      const result = r.json.result;
      expect(result.instructions).toContain('whoami');
      const caps = result.capabilities;
      const unused = (cap: unknown) =>
        cap === undefined ||
        cap === null ||
        (typeof cap === 'object' && Object.keys(cap as object).length === 0);
      expect(unused(caps.prompts)).toBe(true);
      expect(unused(caps.completions)).toBe(true);
      expect(unused(caps.sampling)).toBe(true);
      expect(unused(caps.elicitation)).toBe(true);
      expect(unused(caps.extensions)).toBe(true);
      expect(caps.logging).toBeUndefined();
    });
  }, 30000);

  it('publishes outputSchema on whoami', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('tools/list'),
      });
      const whoami = (
        r.json.result.tools as Array<{
          name: string;
          outputSchema?: { type?: string };
          title?: string;
        }>
      ).find((t) => t.name === 'whoami');
      expect(whoami).toBeDefined();
      expect(whoami?.outputSchema).toMatchObject({ type: 'object' });
      expect(whoami?.title).toBe('Who am I');
    });
  }, 30000);

  it('treats MCP-Protocol-Version as case-insensitive', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: { 'mcp-protocol-version': V, 'mcp-method': 'tools/list' },
      });
      expect(r.status).toBe(200);
      expect(r.json.result.tools.length).toBeGreaterThan(50);
    });
  }, 30000);

  it('serves two overlapping stateless requests independently', async () => {
    await bothHarnesses(async (send) => {
      const [a, b] = await Promise.all([
        send({ body: body('tools/list'), headers: headers('tools/list') }),
        send({
          body: body('server/discover'),
          headers: headers('server/discover'),
        }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.json.result.tools.length).toBeGreaterThan(50);
      expect(b.json.result.supportedVersions).toEqual([V]);
    });
  }, 30000);

  it('still answers JSON when the client omits Accept', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(200);
      expect(r.json.result.tools.length).toBeGreaterThan(50);
    });
  }, 30000);
});
