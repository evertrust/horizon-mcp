#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { createAuthProvider } from './auth/index.js';
import { HorizonClient } from './client/http.js';
import { buildHttpConfig } from './http/config.js';
import { startHttpServer } from './http/server.js';
import { configureLogging, getLogger, setMcpLoggingSink } from './logging.js';
import { assertToolsetsValid, createSessionServer } from './server-factory.js';
import { type HorizonSettings, loadSettings } from './settings.js';

const logger = getLogger('horizon_mcp.server');

function installShutdown(close: () => Promise<void>): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      let exitCode = 0;
      try {
        await close();
      } catch (err) {
        logger.error(`Error during shutdown: ${err}`);
        exitCode = 1;
      } finally {
        logger.info('Horizon MCP server shut down.');
        process.exit(exitCode);
      }
    });
  }
}

async function runStdio(settings: HorizonSettings): Promise<void> {
  const auth = createAuthProvider(settings);
  const client = new HorizonClient(settings.url, auth, {
    timeout: settings.timeout,
    exportTimeout: settings.exportTimeout,
    verifySsl: settings.verifySsl,
    testedVersions: settings.testedVersions,
    warnVersions: settings.warnVersions,
  });

  const server = createSessionServer(client, {
    enabledToolsets: settings.enabledToolsets,
    readOnly: settings.readOnly,
  });

  logger.info(
    'Horizon MCP server ready (stdio) - auth will trigger on first tool call.',
  );

  installShutdown(async () => {
    await client.close();
    await auth.cleanup();
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Forward server logs through `notifications/message` now that the transport
  // is connected. Best-effort: any failure stays local and never crashes the
  // server. (HTTP mode does NOT use this global sink - it routes per-session.)
  setMcpLoggingSink((level, payload) => {
    void Promise.resolve()
      .then(() =>
        server.server.sendLoggingMessage({
          level: level as
            | 'debug'
            | 'info'
            | 'notice'
            | 'warning'
            | 'error'
            | 'critical'
            | 'alert'
            | 'emergency',
          logger: payload.logger,
          data: { msg: payload.msg, ...(payload.extra ?? {}) },
        }),
      )
      .catch(() => {
        // transport not ready or closing -- keep the log local only
      });
  });
}

async function runHttp(settings: HorizonSettings): Promise<void> {
  // Fail-closed: throws (refusing to start) on any malformed HTTP config.
  const config = buildHttpConfig(settings);
  const handle = await startHttpServer(settings, config);

  logger.info(`Horizon MCP server ready (http) at ${handle.url}`);

  installShutdown(async () => {
    await handle.close();
  });
}

async function main(): Promise<void> {
  const settings = loadSettings();
  configureLogging(settings.logLevel);

  // Fail-closed on a misconfigured toolset list before binding any transport.
  assertToolsetsValid(settings.enabledToolsets);

  if (settings.transport === 'http') {
    await runHttp(settings);
  } else {
    await runStdio(settings);
  }
}

main().catch((err) => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});
