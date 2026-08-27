/**
 * MCP 2026-07-28 conformance edges beyond tests/unit/mcp-conformance.test.ts.
 *
 * Same methodology as the matrix: every expectation here was measured against
 * a running server before it was written, and where the SDK's behaviour
 * deviates from the specification (see the missing-version-header case) the
 * measured value is the asserted one, so a change in either direction is a
 * deliberate decision rather than a silent drift.
 *
 * Coverage added here:
 *  - the required Mcp-Name header (absence, not just mismatch)
 *  - stray Mcp-Param-* headers on a server that designates none
 *  - header/envelope protocol-version asymmetry in both directions
 *  - Origin validation and CORS preflight through the production stack
 *  - concurrency permits released when a client disconnects mid-request
 *  - the stdio transport speaking the stateless envelope from a real child
 *    process (the only committed coverage of stdio's modern path)
 */
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  META,
  V,
  bodyWithoutClientInfo as body,
  buildRequestInit,
  createHarnesses,
  headers,
  mockFetch,
  bothHarnesses as runBothHarnesses,
  startExpressServer,
} from './support/mcp-harness.js';

const { Client } = await import('@modelcontextprotocol/client');
const { StdioClientTransport, getDefaultEnvironment } =
  await import('@modelcontextprotocol/client/stdio');

// -- constants --------------------------------------------------------------

const KNOWN_URI = 'horizon://knowledge/architecture';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// -- harnesses --------------------------------------------------------------

const EDGE_HARNESS_OPTIONS = {
  defaultAccept: 'application/json, text/event-stream',
};

let harnesses: Awaited<ReturnType<typeof createHarnesses>> = [];

beforeAll(async () => {
  harnesses = await createHarnesses(EDGE_HARNESS_OPTIONS);
  return async () => {
    for (const h of harnesses) await h.close();
  };
}, 60000);

const bothHarnesses = (
  check: Parameters<typeof runBothHarnesses>[1],
): Promise<void> => runBothHarnesses(harnesses, check);

// -- required Mcp-Name header -----------------------------------------------

describe('required Mcp-Name header', () => {
  it('rejects tools/call without Mcp-Name with -32020', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', { name: 'whoami', arguments: {} }),
        headers: headers('tools/call'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
      expect(r.json.error.data.mismatch.header).toBe('(missing)');
    });
  }, 30000);

  it('rejects resources/read without Mcp-Name with -32020', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('resources/read', { uri: KNOWN_URI }),
        headers: headers('resources/read'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
      expect(r.json.error.data.mismatch.header).toBe('(missing)');
    });
  }, 30000);
});

// -- custom parameter headers -----------------------------------------------

describe('custom parameter headers', () => {
  it('ignores a stray Mcp-Param header when no tool designates one', async () => {
    // No tool in this server carries an x-mcp-header annotation, so a stray
    // Mcp-Param-* header is unrecognized and must be ignored, not validated.
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: { ...headers('tools/list'), 'Mcp-Param-Region': 'us-west1' },
      });
      expect(r.status).toBe(200);
      expect(r.json.result.tools.length).toBeGreaterThan(50);
    });
  }, 30000);
});

// -- header/envelope version asymmetry --------------------------------------

describe('header and envelope version asymmetry', () => {
  it('rejects a version header without the envelope key as -32602', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: { _meta: { [META.capabilities]: {} } },
        },
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32602);
      expect(r.json.error.data.envelope.missing).toEqual([META.version]);
    });
  }, 30000);

  it('accepts a complete envelope without the version header in-process', async () => {
    const harness = harnesses.find((h) => h.name === 'in-process');
    if (!harness) throw new Error('in-process harness not found');
    const r = await harness.send({
      body: body('tools/list'),
      headers: { 'Mcp-Method': 'tools/list' },
    });
    // The 2026-07-28 transport spec says a modern-only server MUST reject a
    // request missing the MCP-Protocol-Version header (Server Validation),
    // but SDK 2.0.0 accepts it when the body envelope is complete; this test
    // pins the measured lenience so an SDK change in either direction is
    // caught deliberately.
    expect(r.status).toBe(200);
    expect(r.json.result.tools.length).toBeGreaterThan(50);
  }, 30000);

  it('rejects a complete envelope without the version header in Express', async () => {
    const harness = harnesses.find((h) => h.name === 'express');
    if (!harness) throw new Error('express harness not found');
    const r = await harness.send({
      body: body('tools/list'),
      headers: { 'Mcp-Method': 'tools/list' },
    });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(-32020);
    expect(r.json.error.data.mismatch.header).toBe('(missing)');
  }, 30000);
});

// -- origin validation ------------------------------------------------------

describe('origin validation', () => {
  let server: Awaited<ReturnType<typeof startExpressServer>>;

  beforeAll(async () => {
    server = await startExpressServer({
      HORIZON_TRUSTED_ORIGINS: 'https://app.example.com',
    });
    return async () => {
      await server.close();
    };
  }, 60000);

  it('rejects an untrusted origin with a JSON-RPC error', async () => {
    const rejected = await fetch(
      server.base,
      buildRequestInit(
        {
          body: body('tools/list'),
          headers: {
            'X-API-ID': 'alice',
            'X-API-KEY': 'k',
            ...headers('tools/list'),
            Origin: 'https://evil.example.com',
          },
        },
        EDGE_HARNESS_OPTIONS,
      ),
    );
    expect(rejected.status).toBe(403);
    const rejectedBody = (await rejected.json()) as {
      error: { code: number };
    };
    expect(rejectedBody.error.code).toBe(-32600);
  }, 30000);

  it('answers a trusted CORS preflight', async () => {
    const preflight = await fetch(
      server.base,
      buildRequestInit(
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://app.example.com',
            'Access-Control-Request-Method': 'POST',
          },
        },
        EDGE_HARNESS_OPTIONS,
      ),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'https://app.example.com',
    );
    expect(preflight.headers.get('access-control-allow-methods')).toBe(
      'POST, OPTIONS',
    );
  }, 30000);

  it('allows a trusted origin and echoes it', async () => {
    const allowed = await fetch(
      server.base,
      buildRequestInit(
        {
          body: body('tools/list'),
          headers: {
            'X-API-ID': 'alice',
            'X-API-KEY': 'k',
            ...headers('tools/list'),
            Origin: 'https://app.example.com',
          },
        },
        EDGE_HARNESS_OPTIONS,
      ),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'https://app.example.com',
    );
  }, 30000);
});

// -- disconnect releases capacity -------------------------------------------

describe('request permits are released on client disconnect', () => {
  it('serves the next request after an in-flight one is aborted', async () => {
    const server = await startExpressServer({
      HORIZON_MAX_CONCURRENT_REQUESTS: '1',
    });
    const creds = { 'X-API-ID': 'alice', 'X-API-KEY': 'k' };
    const original = mockFetch.getMockImplementation()!;
    try {
      // Warm the credential cache so admission of the slow request below is
      // instant and its permits are wired to the response before the abort.
      const warm = await fetch(
        server.base,
        buildRequestInit(
          {
            body: body('tools/list'),
            headers: { ...creds, ...headers('tools/list') },
          },
          EDGE_HARNESS_OPTIONS,
        ),
      );
      expect(warm.status).toBe(200);
      await warm.text();

      // Make Horizon slow so the tools/call genuinely occupies the single
      // global permit, then abort it mid-flight.
      mockFetch.mockImplementation(async (url: unknown, init: unknown) => {
        await sleep(10000);
        return original(url, init);
      });
      const controller = new AbortController();
      const slow = fetch(server.base, {
        ...buildRequestInit(
          {
            body: body('tools/call', { name: 'whoami', arguments: {} }),
            headers: { ...creds, ...headers('tools/call', 'whoami') },
          },
          EDGE_HARNESS_OPTIONS,
        ),
        signal: controller.signal,
      }).catch(() => undefined);
      await sleep(150);
      controller.abort();
      await slow;
      await sleep(300);
      mockFetch.mockImplementation(original);

      // Closing the response released the permit; without release-on-close
      // this would be 503 server at capacity.
      const next = await fetch(
        server.base,
        buildRequestInit(
          {
            body: body('tools/list'),
            headers: { ...creds, ...headers('tools/list') },
          },
          EDGE_HARNESS_OPTIONS,
        ),
      );
      expect(next.status).toBe(200);
    } finally {
      mockFetch.mockImplementation(original);
      await server.close();
    }
  }, 30000);
});

// -- stdio transport --------------------------------------------------------

describe('stdio transport speaks the stateless 2026-07-28 envelope', () => {
  // These spawn the same entry point users run and talk over its real
  // stdin/stdout pipes; in-memory transports cannot prove the executable's
  // `legacy: 'reject'` path. Bun loads the Markdown knowledge assets that the
  // tsx dev runner cannot. Cold starts on a loaded machine are slow, hence
  // the generous timeout and retries.
  function stdioTransport() {
    return new StdioClientTransport({
      command: 'bun',
      args: [resolve(process.cwd(), 'src/index.ts')],
      cwd: process.cwd(),
      stderr: 'pipe',
      env: {
        ...getDefaultEnvironment(),
        HORIZON_TRANSPORT: 'stdio',
        HORIZON_URL: 'https://horizon.test',
        HORIZON_API_ID: 'alice',
        HORIZON_API_KEY: 'key',
        HORIZON_LOG_LEVEL: 'ERROR',
      },
    });
  }

  it(
    'negotiates server/discover and serves the catalog with resultType',
    { timeout: 30000, retry: 2 },
    async () => {
      const transport = stdioTransport();
      const client = new Client(
        { name: 'stdio-edges', version: '1.0.0' },
        { versionNegotiation: { mode: { pin: V } } },
      );
      try {
        await client.connect(transport);
        expect(client.getNegotiatedProtocolVersion()).toBe(V);

        // The client SDK routes on resultType and strips it from the parsed
        // result, so the modern envelope is proven by the pinned negotiation
        // plus the CacheableResult fields it does surface.
        const tools = await client.listTools({ cursor: '0' });
        expect(tools.ttlMs).toBe(3_600_000);
        expect(tools.cacheScope).toBe('public');
        expect(tools.tools.length).toBeGreaterThan(50);

        const resources = await client.listResources({ cursor: '0' });
        expect(resources.ttlMs).toBe(3_600_000);
        expect(resources.cacheScope).toBe('public');
        expect(resources.resources.length).toBeGreaterThan(0);
      } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      }
    },
  );

  it(
    'rejects the removed legacy initialize handshake',
    { timeout: 30000, retry: 2 },
    async () => {
      const transport = stdioTransport();
      const client = new Client(
        { name: 'stdio-edges-legacy', version: '1.0.0' },
        { versionNegotiation: { mode: 'legacy' } },
      );
      try {
        await expect(client.connect(transport)).rejects.toThrow(
          /protocol|version|unsupported/i,
        );
      } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      }
    },
  );
});
