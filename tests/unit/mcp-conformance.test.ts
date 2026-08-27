/**
 * MCP 2026-07-28 protocol conformance matrix.
 *
 * Every expectation here was measured against a running server before it was
 * written, not inferred from the specification. Where the SDK's behaviour is
 * surprising (see the base64 sentinel and the JSON-RPC-layer resource errors)
 * the surprising value is the asserted one.
 *
 * The matrix runs twice: once in-process through `handler.fetch`, and once
 * through the production Express stack. Both are required. Phase 2 of this
 * migration hit a bug class where the parsed body never reached the SDK, and
 * that is invisible in-process because it only manifests once express.json()
 * has already consumed the stream.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  META,
  V,
  body,
  createHarnesses,
  envelope,
  headers,
  bothHarnesses as runBothHarnesses,
} from './support/mcp-harness.js';

/** A knowledge resource that is always registered. */
const KNOWN_URI = 'horizon://knowledge/architecture';

let harnesses: Awaited<ReturnType<typeof createHarnesses>> = [];

beforeAll(async () => {
  harnesses = await createHarnesses();
  return async () => {
    for (const h of harnesses) await h.close();
  };
}, 60000);

const bothHarnesses = (
  check: Parameters<typeof runBothHarnesses>[1],
): Promise<void> => runBothHarnesses(harnesses, check);

describe('cacheable operations carry hints, resultType, and serverInfo', () => {
  const cases = [
    { method: 'server/discover', ttlMs: 3_600_000 },
    { method: 'tools/list', ttlMs: 3_600_000 },
    { method: 'resources/list', ttlMs: 3_600_000 },
    { method: 'resources/templates/list', ttlMs: 3_600_000 },
  ];

  for (const c of cases) {
    it(`${c.method} advertises ttlMs ${c.ttlMs} and public scope`, async () => {
      await bothHarnesses(async (send) => {
        const r = await send({
          body: body(c.method),
          headers: headers(c.method),
        });
        expect(r.status, `${c.method} status`).toBe(200);
        const result = r.json?.result;
        expect(result, `${c.method} result`).toBeDefined();
        expect(result.resultType).toBe('complete');
        expect(result.ttlMs).toBe(c.ttlMs);
        expect(result.cacheScope).toBe('public');
        expect(result._meta?.[META.serverInfo]?.name).toBeTruthy();
      });
    }, 30000);
  }

  it('resources/read caches for a day', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('resources/read', { uri: KNOWN_URI }),
        headers: headers('resources/read', KNOWN_URI),
      });
      expect(r.status).toBe(200);
      expect(r.json.result.resultType).toBe('complete');
      expect(r.json.result.ttlMs).toBe(86_400_000);
      expect(r.json.result.cacheScope).toBe('public');
    });
  }, 30000);

  it('tools/call carries resultType but no cache hints', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', { name: 'whoami', arguments: {} }),
        headers: headers('tools/call', 'whoami'),
      });
      expect(r.status).toBe(200);
      const result = r.json.result;
      expect(result.resultType).toBe('complete');
      expect(result._meta?.[META.serverInfo]).toBeDefined();
      // A tool call is not a cacheable operation, so it must not be labelled
      // as one. A stray ttlMs here would let a proxy replay a mutation.
      expect(result).not.toHaveProperty('ttlMs');
      expect(result).not.toHaveProperty('cacheScope');
    });
  }, 30000);
});

describe('_meta envelope validation', () => {
  it('rejects a missing clientCapabilities with -32602', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              [META.version]: V,
              [META.clientInfo]: { name: 'c', version: '1' },
            },
          },
        },
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32602);
      expect(r.json.error.message).toContain('Invalid _meta envelope');
      expect(r.json.error.data.envelope).toEqual({
        key: META.capabilities,
        problem: 'missing',
      });
    });
  }, 30000);

  it('accepts a missing clientInfo, which is optional', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: { _meta: { [META.version]: V, [META.capabilities]: {} } },
        },
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(200);
      expect(r.json.result.tools.length).toBeGreaterThan(50);
    });
  }, 30000);

  it('rejects a request naming no protocol version at all', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: { jsonrpc: '2.0', id: 1, method: 'server/discover' },
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32022);
      expect(r.json.error.data.supported).toEqual([V]);
    });
  }, 30000);
});

describe('version negotiation is modern-only', () => {
  for (const old of ['2025-11-25', '2025-06-18']) {
    it(`rejects ${old} with -32022 listing what is supported`, async () => {
      await bothHarnesses(async (send) => {
        const r = await send({
          body: body('tools/list', {}, { [META.version]: old }),
          headers: { 'MCP-Protocol-Version': old, 'Mcp-Method': 'tools/list' },
        });
        expect(r.status).toBe(400);
        expect(r.json.error.code).toBe(-32022);
        expect(r.json.error.data.supported).toEqual([V]);
        expect(r.json.error.data.requested).toBe(old);
      });
    }, 30000);
  }

  it('rejects the removed initialize handshake', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'legacy', version: '1' },
          },
        },
      });
      // Rejected on the version, not on the method: a 2025 client never gets
      // far enough for `initialize` to be reported as unknown.
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32022);
    });
  }, 30000);
});

describe('headers and body must agree, all -32020', () => {
  it('detects a method mismatch', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('resources/list'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
      expect(r.json.error.data.mismatch.header).toBe('resources/list');
    });
  }, 30000);

  it('detects an Mcp-Name mismatch on tools/call', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', { name: 'whoami', arguments: {} }),
        headers: headers('tools/call', 'wrongname'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
      expect(r.json.error.data.mismatch.header).toBe('wrongname');
    });
  }, 30000);

  it('rejects an absent Mcp-Method header', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: { 'MCP-Protocol-Version': V },
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
      expect(r.json.error.data.mismatch.header).toBe('(missing)');
    });
  }, 30000);

  it('treats a header/body version disagreement as a mismatch, not a version error', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: {
          'MCP-Protocol-Version': '2025-11-25',
          'Mcp-Method': 'tools/list',
        },
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
    });
  }, 30000);
});

describe('Mcp-Name base64 sentinel', () => {
  const encoded = `=?base64?${Buffer.from(KNOWN_URI, 'utf8').toString('base64')}?=`;

  it('decodes the sentinel before comparing', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('resources/read', { uri: KNOWN_URI }),
        headers: headers('resources/read', encoded),
      });
      expect(r.status).toBe(200);
    });
  }, 30000);

  it('accepts the plain unencoded URI too', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('resources/read', { uri: KNOWN_URI }),
        headers: headers('resources/read', KNOWN_URI),
      });
      expect(r.status).toBe(200);
    });
  }, 30000);

  it('does NOT decode an RFC 2047 encoded-word', async () => {
    // The sentinel is literally `=?base64?...?=`. An RFC 2047 charset form is
    // not a sentinel and must be compared literally. This case exists so a
    // future SDK that silently broadens the decoding is caught here rather
    // than in production.
    const rfc2047 = `=?utf-8?B?${Buffer.from(KNOWN_URI, 'utf8').toString('base64')}?=`;
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('resources/read', { uri: KNOWN_URI }),
        headers: headers('resources/read', rfc2047),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32020);
    });
  }, 30000);
});

describe('surfaces removed in 2026-07-28 are gone', () => {
  const removed = [
    'ping',
    'logging/setLevel',
    'resources/subscribe',
    'resources/unsubscribe',
    'sampling/createMessage',
    'elicitation/create',
    'roots/list',
    'tasks/list',
    'notifications/initialized',
    'nonexistent/method',
  ];

  for (const method of removed) {
    it(`${method} answers 404 / -32601`, async () => {
      await bothHarnesses(async (send) => {
        const r = await send({
          body: body(method),
          headers: headers(method),
        });
        expect(r.status).toBe(404);
        expect(r.json.error.code).toBe(-32601);
      });
    }, 30000);
  }

  it('prompts/list is unsupported: no prompts capability is registered', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('prompts/list'),
        headers: headers('prompts/list'),
      });
      expect(r.status).toBe(404);
      expect(r.json.error.code).toBe(-32601);
    });
  }, 30000);
});

describe('transport', () => {
  for (const method of ['GET', 'DELETE', 'PUT', 'PATCH']) {
    it(`answers 405 to ${method}`, async () => {
      await bothHarnesses(async (send) => {
        const r = await send({ method, headers: headers('tools/list') });
        expect(r.status).toBe(405);
      });
    }, 30000);
  }

  it('answers 415 to a non-JSON Content-Type', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('tools/list'),
        contentType: 'text/plain',
      });
      expect(r.status).toBe(415);
    });
  }, 30000);

  it('answers 415 when Content-Type is absent', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: headers('tools/list'),
        contentType: null,
      });
      expect(r.status).toBe(415);
    });
  }, 30000);

  it('answers -32700 to malformed JSON', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: '{not json',
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32700);
    });
  }, 30000);

  it('rejects a JSON-RPC batch', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: [body('tools/list'), body('tools/list')],
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe(-32600);
      expect(r.json.error.message.toLowerCase()).toContain('batch');
    });
  }, 30000);

  it('answers 202 with no body to a notification', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: {
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { _meta: envelope() },
        },
        headers: headers('notifications/cancelled'),
      });
      expect(r.status).toBe(202);
      expect(r.text).toBe('');
    });
  }, 30000);

  it('ignores session headers and never mints one', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list'),
        headers: {
          ...headers('tools/list'),
          'Mcp-Session-Id': 'abc',
          'Last-Event-ID': '5',
        },
      });
      expect(r.status).toBe(200);
      expect(r.headers.get('mcp-session-id')).toBeNull();
    });
  }, 30000);
});

describe('errors surface at the right layer', () => {
  it('reports an unknown resource as -32602 inside a 200', async () => {
    await bothHarnesses(async (send) => {
      const uri = 'horizon://knowledge/does-not-exist';
      const r = await send({
        body: body('resources/read', { uri }),
        headers: headers('resources/read', uri),
      });
      // The HTTP status is 200: the failure is at the JSON-RPC layer, not the
      // transport layer.
      expect(r.status).toBe(200);
      expect(r.json.error.code).toBe(-32602);
    });
  }, 30000);

  it('reports an unknown tool as -32602', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', { name: 'no_such_tool', arguments: {} }),
        headers: headers('tools/call', 'no_such_tool'),
      });
      expect(r.status).toBe(200);
      expect(r.json.error.code).toBe(-32602);
    });
  }, 30000);

  it('reports bad tool arguments as an isError result, not a JSON-RPC error', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/call', {
          name: 'search_certificates',
          arguments: { query: 12345 },
        }),
        headers: headers('tools/call', 'search_certificates'),
      });
      expect(r.status).toBe(200);
      expect(r.json.error).toBeUndefined();
      expect(r.json.result.isError).toBe(true);
    });
  }, 30000);
});

describe('capabilities and determinism', () => {
  it('advertises listChanged false and no logging capability', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('server/discover'),
        headers: headers('server/discover'),
      });
      expect(r.status).toBe(200);
      const caps = r.json.result.capabilities;
      expect(caps.tools.listChanged).toBe(false);
      expect(caps.resources.listChanged).toBe(false);
      // Logging is deprecated by SEP-2577 and was deliberately dropped.
      // Declaring it would install a `logging/setLevel` surface we never use.
      expect(caps).not.toHaveProperty('logging');
    });
  }, 30000);

  it('reports 2026-07-28 as the only supported revision', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('server/discover'),
        headers: headers('server/discover'),
      });
      expect(r.json.result.supportedVersions).toEqual([V]);
    });
  }, 30000);

  it('orders tools/list identically across independent server instances', async () => {
    const names = await Promise.all(
      harnesses.map(async (h) => {
        const r = await h.send({
          body: body('tools/list'),
          headers: headers('tools/list'),
        });
        return r.json.result.tools.map((t: { name: string }) => t.name);
      }),
    );
    expect(names[0]).toEqual(names[1]);
    expect(names[0]!.length).toBeGreaterThan(50);
  }, 30000);
});

describe('logging is never emitted unsolicited', () => {
  it('returns a plain result even when a logLevel is requested', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('tools/list', {}, { [META.logLevel]: 'debug' }),
        headers: headers('tools/list'),
      });
      expect(r.status).toBe(200);
      // A single JSON object, not an SSE stream carrying notifications/message.
      expect(r.headers.get('content-type')).toContain('application/json');
      expect(r.json.result).toBeDefined();
    });
  }, 30000);
});

describe('subscriptions/listen', () => {
  it('acknowledges first and grants nothing this server cannot emit', async () => {
    // The ack's `notifications` is empty because this server declares
    // tools.listChanged: false and resources.listChanged: false. That is the
    // Phase 4.2 capability decision observed from the outside: a client asking
    // for list-changed events is told, up front, that it will get none.
    for (const h of harnesses) {
      const r = await h.send({
        body: body('subscriptions/listen', {
          notifications: { toolsListChanged: true, resourcesListChanged: true },
        }),
        headers: headers('subscriptions/listen'),
        accept: 'text/event-stream',
      });
      expect(r.status, `${h.name} status`).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/event-stream');
      expect(r.headers.get('x-accel-buffering')).toBe('no');

      const firstFrame = r.text
        .split('\n')
        .find((line) => line.startsWith('data: '));
      expect(firstFrame, `${h.name} first frame`).toBeDefined();
      const frame = JSON.parse(firstFrame!.slice('data: '.length));
      expect(frame.method).toBe('notifications/subscriptions/acknowledged');
      expect(frame.params._meta[META.subscriptionId]).toBeDefined();
      expect(frame.params.notifications).toEqual({});
    }
  }, 30000);

  it('requires the notifications filter', async () => {
    await bothHarnesses(async (send) => {
      const r = await send({
        body: body('subscriptions/listen'),
        headers: headers('subscriptions/listen'),
        accept: 'text/event-stream',
      });
      expect(r.json.error.code).toBe(-32602);
      expect(r.json.error.message).toContain('notifications');
    });
  }, 30000);
});
