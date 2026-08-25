import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

import { buildHttpConfig } from '../../src/http/config.js';
import { startHttpServer } from '../../src/http/server.js';
import { loadSettings } from '../../src/settings.js';

const warningMessage = (version: string) =>
  `HTTP mode is running under Bun ${version}: Bun's node:http server does not report client disconnects once the request body has been consumed, so cancellation of in-flight Horizon calls and early permit release on disconnect are inert until the response completes; run HTTP mode under Node`;

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
  return { lines, restore: () => spy.mockRestore() };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function startServer(): ReturnType<typeof startHttpServer> {
  const port = await freePort();
  const env = {
    HORIZON_TRANSPORT: 'http',
    HORIZON_HTTP_AUTH_METHODS: 'api-key',
    HORIZON_URL: 'https://horizon.test',
    HORIZON_HTTP_HOST: '127.0.0.1',
    HORIZON_HTTP_PORT: String(port),
    HORIZON_TRUSTED_HOSTS: `127.0.0.1:${port}`,
    HORIZON_VERIFY_SSL: 'false',
  };
  const settings = loadSettings(env);
  const config = buildHttpConfig(settings, env);
  return startHttpServer(settings, config);
}

function warningsFrom(lines: string[]): Record<string, unknown>[] {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry['level'] === 'WARNING');
}

describe('HTTP server runtime warning', () => {
  it('warns exactly once when HTTP mode runs under Bun', async () => {
    const existingBun = Object.getOwnPropertyDescriptor(
      process.versions,
      'bun',
    );
    if (!existingBun) {
      Object.defineProperty(process.versions, 'bun', {
        value: '1.3.14',
        configurable: true,
        enumerable: true,
      });
    }
    const bunVersion = process.versions.bun;
    const { lines, restore } = captureStderr();
    let handle: Awaited<ReturnType<typeof startHttpServer>> | undefined;
    try {
      handle = await startServer();
      const warnings = warningsFrom(lines);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        logger: 'horizon_mcp.http',
        msg: warningMessage(bunVersion!),
      });
    } finally {
      await handle?.close();
      restore();
      if (!existingBun) delete process.versions.bun;
    }
  });

  it('does not warn when HTTP mode runs under Node', async () => {
    const existingBun = Object.getOwnPropertyDescriptor(
      process.versions,
      'bun',
    );
    if (existingBun?.configurable) delete process.versions.bun;
    const { lines, restore } = captureStderr();
    let handle: Awaited<ReturnType<typeof startHttpServer>> | undefined;
    try {
      handle = await startServer();
      expect(warningsFrom(lines)).toHaveLength(0);
    } finally {
      await handle?.close();
      restore();
      if (existingBun) {
        Object.defineProperty(process.versions, 'bun', existingBun);
      }
    }
  });
});
