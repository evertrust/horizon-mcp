import { connect } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import {
  CredentialCache,
  apiIdOf,
  currentRequestSignal,
  expectAbortedWithin,
  makeClient,
  openListenStream,
  signalOf,
  startApiKeyServer,
} from './support/http-server-fixture.js';
import { mockFetch } from './support/mcp-harness.js';

describe('HTTP server integration (request reception timeout)', () => {
  const env = {
    HORIZON_SSE_MAX_DURATION: '5',
    HORIZON_EXPORT_TIMEOUT: '1',
  };
  const serverOptions = {
    requestTimeoutMs: 200,
    connectionsCheckingIntervalMs: 50,
  };

  it('closes a trickled request body within the receive deadline', async () => {
    const ctx = await startApiKeyServer(env, serverOptions);
    const socket = connect(ctx.handle.port, '127.0.0.1');
    let trickle: ReturnType<typeof setInterval> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      socket.on('error', () => undefined);
      socket.write(
        [
          'POST /mcp HTTP/1.1',
          `Host: 127.0.0.1:${ctx.handle.port}`,
          'Content-Type: application/json',
          'Content-Length: 64',
          '',
          '',
        ].join('\r\n'),
      );

      const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
      let bodyIndex = 0;
      const firstBodyAt = Date.now();
      socket.write(body[bodyIndex++]!);
      trickle = setInterval(() => {
        if (!socket.destroyed) {
          socket.write(body[bodyIndex++ % body.length]!);
        }
      }, 100);

      // With requestTimeout disabled, neither event fires and the watchdog wins.
      const elapsed = await new Promise<number>((resolve, reject) => {
        const closed = () => {
          clearTimeout(watchdog);
          socket.off('close', closed);
          socket.off('end', closed);
          resolve(Date.now() - firstBodyAt);
        };
        const watchdog = setTimeout(() => {
          socket.off('close', closed);
          socket.off('end', closed);
          reject(new Error('socket remained open past the receive deadline'));
        }, 1500);
        socket.once('close', closed);
        socket.once('end', closed);
      });

      expect(elapsed).toBeLessThan(1500);
    } finally {
      if (trickle) clearInterval(trickle);
      socket.destroy();
      await ctx.handle.close();
    }
  }, 10000);

  it('keeps a fully received subscriptions/listen response open', async () => {
    const ctx = await startApiKeyServer(env, serverOptions);
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let reading: Promise<void> | undefined;
    let streamEnded = false;
    try {
      const response = await openListenStream(ctx.base, controller.signal, 1);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      expect(response.body).not.toBeNull();

      reader = response.body!.getReader();
      reading = (async () => {
        try {
          for (;;) {
            const { done } = await reader!.read();
            if (done) {
              streamEnded = true;
              return;
            }
          }
        } catch {
          streamEnded = true;
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(streamEnded).toBe(false);
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      await reading?.catch(() => undefined);
      await ctx.handle.close();
    }
  }, 10000);
});

describe('HTTP server integration (api-key mode)', () => {
  it('rejects requests beyond the global concurrency cap', async () => {
    const ctx = await startApiKeyServer({
      HORIZON_MAX_CONCURRENT_REQUESTS: '1',
      HORIZON_IP_RATE_LIMIT: '0',
      HORIZON_RATE_LIMIT_RPS: '0',
    });
    // Make Horizon slow so the requests genuinely overlap; with an instant
    // upstream they would complete one after another and never contend.
    const original = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: unknown, init: unknown) => {
      await new Promise((r) => setTimeout(r, 60));
      return original(url, init);
    });
    try {
      const send = () =>
        fetch(ctx.base, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'X-API-ID': 'alice',
            'X-API-KEY': 'k',
            'MCP-Protocol-Version': '2026-07-28',
            'Mcp-Method': 'tools/list',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        });

      const results = await Promise.all(
        Array.from({ length: 12 }, () => send()),
      );
      const statuses = results.map((r) => r.status);
      // With a cap of 1 in-flight request, a burst of 12 must shed some load
      // rather than build 12 concurrent server instances.
      expect(statuses.some((s) => s === 503 || s === 429)).toBe(true);
    } finally {
      mockFetch.mockImplementation(original);
      await ctx.handle.close();
    }
  }, 30000);

  it('releases concurrency permits when a client disconnects during credential validation', async () => {
    const ctx = await startApiKeyServer({
      HORIZON_MAX_CONCURRENT_REQUESTS: '1',
      HORIZON_IP_RATE_LIMIT: '0',
      HORIZON_RATE_LIMIT_RPS: '0',
      HORIZON_SSE_MAX_DURATION: '2',
      HORIZON_EXPORT_TIMEOUT: '1',
    });
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const firstCredential = 'disconnecting-client';
    const secondCredential = 'next-client';
    const original = mockFetch.getMockImplementation()!;
    let markValidationStarted = () => {};
    const validationStarted = new Promise<void>((resolve) => {
      markValidationStarted = resolve;
    });
    let releaseValidation = () => {};
    const validationRelease = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    let validationSignal: AbortSignal | undefined;
    mockFetch.mockImplementation(async (url: unknown, init: unknown) => {
      if (
        String(url).includes('/api/v1/security/principals/self') &&
        apiIdOf(init) === firstCredential
      ) {
        validationSignal = signalOf(init);
        markValidationStarted();
        await validationRelease;
      }
      return original(url, init);
    });

    const send = (apiId: string, apiKey: string, signal?: AbortSignal) =>
      fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': apiId,
          'X-API-KEY': apiKey,
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
        signal,
      });

    const controller = new AbortController();
    const requestA = send(firstCredential, 'key-one', controller.signal).catch(
      () => undefined,
    );
    try {
      await validationStarted;
      controller.abort();
      expect(validationSignal).toBeDefined();
      await expectAbortedWithin(validationSignal!);
      await new Promise((r) => setTimeout(r, 100));
      const responseB = await send(secondCredential, 'key-two');
      expect(responseB.status).toBe(200);
      releaseValidation();
      await requestA;
      await new Promise((r) => setTimeout(r, 2600));
      const deadlineWarnings = writeSpy.mock.calls.filter(([chunk]) => {
        const line = String(chunk);
        return (
          line.includes('"level":"WARNING"') &&
          line.includes('"logger":"horizon_mcp.http"') &&
          line.includes('response exceeded')
        );
      });
      expect(deadlineWarnings).toHaveLength(0);
    } finally {
      releaseValidation();
      await requestA;
      mockFetch.mockImplementation(original);
      writeSpy.mockRestore();
      await ctx.handle.close();
    }
  }, 30000);

  it('keeps shared credential validation alive while another waiter remains', async () => {
    const ctx = await startApiKeyServer({
      HORIZON_IP_RATE_LIMIT: '0',
      HORIZON_RATE_LIMIT_RPS: '0',
    });
    const credential = 'shared-validation-client';
    const original = mockFetch.getMockImplementation()!;
    let markValidationStarted = () => {};
    const validationStarted = new Promise<void>((resolve) => {
      markValidationStarted = resolve;
    });
    let releaseValidation = () => {};
    const validationRelease = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    let validationSignal: AbortSignal | undefined;
    let validationProbes = 0;
    let markSecondWaiter = () => {};
    const secondWaiter = new Promise<void>((resolve) => {
      markSecondWaiter = resolve;
    });
    let cacheGets = 0;
    let firstCallerSignal: AbortSignal | undefined;
    const originalGet = CredentialCache.prototype.get;
    const getSpy = vi
      .spyOn(CredentialCache.prototype, 'get')
      .mockImplementation(function (...args) {
        const result = originalGet.apply(this, args);
        const material = args[1];
        if (material.kind === 'api-key' && material.apiId === credential) {
          cacheGets += 1;
          if (cacheGets === 1) firstCallerSignal = currentRequestSignal();
          if (cacheGets === 2) markSecondWaiter();
        }
        return result;
      });
    mockFetch.mockImplementation(async (url: unknown, init: unknown) => {
      if (
        String(url).includes('/api/v1/security/principals/self') &&
        apiIdOf(init) === credential
      ) {
        validationProbes += 1;
        validationSignal = signalOf(init);
        markValidationStarted();
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(validationSignal!.reason);
          if (validationSignal!.aborted) {
            reject(validationSignal!.reason);
            return;
          }
          validationSignal!.addEventListener('abort', onAbort, { once: true });
          void validationRelease.then(() => {
            validationSignal!.removeEventListener('abort', onAbort);
            resolve();
          });
        });
      }
      return original(url, init);
    });

    const send = (id: number, signal: AbortSignal) =>
      fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': credential,
          'X-API-KEY': 'shared-key',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
        signal,
      });

    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstRequest = send(1, firstController.signal).catch(() => undefined);
    let secondRequest: Promise<Response> | undefined;
    try {
      await validationStarted;
      secondRequest = send(2, secondController.signal);
      await secondWaiter;
      firstController.abort();
      await firstRequest;
      expect(firstCallerSignal).toBeDefined();
      await expectAbortedWithin(firstCallerSignal!);

      expect(validationSignal).toBeDefined();
      expect(validationSignal!.aborted).toBe(false);
      releaseValidation();

      const secondResponse = await secondRequest;
      expect(secondResponse.status).toBe(200);
      expect(validationProbes).toBe(1);
    } finally {
      releaseValidation();
      firstController.abort();
      secondController.abort();
      await Promise.allSettled([
        firstRequest,
        ...(secondRequest ? [secondRequest] : []),
      ]);
      mockFetch.mockImplementation(original);
      getSpy.mockRestore();
      await ctx.handle.close();
    }
  }, 30000);

  it('cancels an upstream tool call when the client disconnects', async () => {
    const ctx = await startApiKeyServer({
      HORIZON_IP_RATE_LIMIT: '0',
      HORIZON_RATE_LIMIT_RPS: '0',
    });
    const credential = 'disconnecting-tool-client';
    const original = mockFetch.getMockImplementation()!;
    const send = (
      id: number,
      method: 'tools/list' | 'tools/call',
      signal?: AbortSignal,
    ) =>
      fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': credential,
          'X-API-KEY': 'key',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': method,
          ...(method === 'tools/call' ? { 'Mcp-Name': 'whoami' } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params: {
            ...(method === 'tools/call'
              ? { name: 'whoami', arguments: {} }
              : {}),
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': {
                name: 'cancellation-test',
                version: '1.0.0',
              },
            },
          },
        }),
        signal,
      });

    const warm = await send(1, 'tools/list');
    expect(warm.status).toBe(200);

    let markToolCallStarted = () => {};
    const toolCallStarted = new Promise<void>((resolve) => {
      markToolCallStarted = resolve;
    });
    let releaseToolCall = () => {};
    const toolCallRelease = new Promise<void>((resolve) => {
      releaseToolCall = resolve;
    });
    let toolCallSignal: AbortSignal | undefined;
    mockFetch.mockImplementation(async (url: unknown, init: unknown) => {
      if (
        String(url).includes('/api/v1/security/principals/self') &&
        apiIdOf(init) === credential
      ) {
        toolCallSignal = signalOf(init);
        markToolCallStarted();
        await toolCallRelease;
      }
      return original(url, init);
    });

    const controller = new AbortController();
    const request = send(2, 'tools/call', controller.signal).catch(
      () => undefined,
    );
    try {
      await toolCallStarted;
      controller.abort();
      expect(toolCallSignal).toBeDefined();
      await expectAbortedWithin(toolCallSignal!);
    } finally {
      releaseToolCall();
      await request;
      mockFetch.mockImplementation(original);
      await ctx.handle.close();
    }
  }, 30000);
});

describe('HTTP server integration (graceful shutdown)', () => {
  it('resolves close() promptly despite a lingering idle keep-alive socket', async () => {
    const ctx = await startApiKeyServer();
    const sock = connect(ctx.handle.port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      sock.once('connect', () => resolve());
      sock.once('error', reject);
    });
    try {
      const start = Date.now();
      await ctx.handle.close();
      // Without closeAllConnections()/timeout, close() would hang on the idle
      // socket until SIGKILL; the bounded drain keeps it well under the cap.
      expect(Date.now() - start).toBeLessThan(2000);
    } finally {
      sock.destroy();
    }
  }, 20000);

  it('closes cached Horizon credentials on shutdown', async () => {
    const ctx = await startApiKeyServer();
    const { client, transport } = makeClient(ctx.base, 'alice', 'k');
    await client.connect(transport);
    await client.listTools();
    await transport.close().catch(() => undefined);

    const result = await Promise.race([
      ctx.handle.close().then(() => 'closed'),
      new Promise<'timed-out'>((resolve) =>
        setTimeout(() => resolve('timed-out'), 5000),
      ),
    ]);
    expect(result).toBe('closed');
  }, 20000);
});

describe('HTTP server integration (listen concurrency)', () => {
  it('admits two listen streams per credential by default and rejects a third', async () => {
    const ctx = await startApiKeyServer();
    const controllers = [
      new AbortController(),
      new AbortController(),
      new AbortController(),
    ];
    try {
      const first = await openListenStream(ctx.base, controllers[0]!.signal, 1);
      expect(first.status).toBe(200);
      expect(first.headers.get('content-type')).toContain('text/event-stream');
      expect(first.body).not.toBeNull();

      const second = await openListenStream(
        ctx.base,
        controllers[1]!.signal,
        2,
      );
      expect(second.status).toBe(200);
      expect(second.headers.get('content-type')).toContain('text/event-stream');
      expect(second.body).not.toBeNull();

      const third = await openListenStream(ctx.base, controllers[2]!.signal, 3);
      expect(third.status).toBe(429);
    } finally {
      controllers.forEach((controller) => controller.abort());
      await ctx.handle.close();
    }
  }, 20000);

  it('keeps tools/list available while a listen stream is open', async () => {
    const ctx = await startApiKeyServer({
      HORIZON_MAX_CONCURRENT_REQUESTS: '1',
      HORIZON_SSE_MAX_DURATION: '5',
      HORIZON_EXPORT_TIMEOUT: '1',
    });
    const controller = new AbortController();
    try {
      const listen = await openListenStream(ctx.base, controller.signal, 1);
      expect(listen.status).toBe(200);
      expect(listen.headers.get('content-type')).toContain('text/event-stream');
      expect(listen.body).not.toBeNull();

      const tools = await fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-ID': 'alice',
          'X-API-KEY': 'k',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
      expect(tools.status).toBe(200);
    } finally {
      controller.abort();
      await ctx.handle.close();
    }
  }, 20000);
});

describe('HTTP server integration (response lifetime cap)', () => {
  it('closes a subscriptions/listen stream at the absolute SSE deadline despite keep-alives', async () => {
    // A listen stream holds dedicated global and per-credential permits for as
    // long as it is open. The absolute cap must not be reset by writes.
    const ctx = await startApiKeyServer({
      HORIZON_SSE_MAX_DURATION: '3',
      HORIZON_SSE_KEEP_ALIVE: '1',
      HORIZON_EXPORT_TIMEOUT: '1',
    });
    try {
      const openedAt = Date.now();
      const controller = new AbortController();
      const watchdog = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(ctx.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-API-ID': 'alice',
          'X-API-KEY': 'k',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'subscriptions/listen',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'subscriptions/listen',
          params: {
            notifications: { toolsListChanged: true },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const keepAliveArrivals: number[] = [];
      let buffered = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split(/\r?\n/);
          buffered = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith(':')) keepAliveArrivals.push(Date.now());
          }
        }
      } catch {
        // A destroyed socket surfaces as a read error, which is also a close.
      }
      clearTimeout(watchdog);
      const elapsed = Date.now() - openedAt;
      expect(keepAliveArrivals.length).toBeGreaterThanOrEqual(2);
      expect(elapsed).toBeGreaterThan(2500);
      expect(elapsed).toBeLessThan(8000);
      await reader.cancel().catch(() => undefined);
    } finally {
      await ctx.handle.close();
    }
  }, 12000);
});
