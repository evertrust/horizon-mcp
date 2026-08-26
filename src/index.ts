#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createAuthProvider } from './auth/index.js';
import { mintInitialTokenAtStartup } from './auth/startup-mint.js';
import { HorizonClient } from './client/http.js';
import { buildHttpConfig } from './http/config.js';
import { startHttpServer } from './http/server.js';
import { configureLogging, getLogger } from './logging.js';
import { assertRuntimeSupportsTls } from './runtime.js';
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
  await mintInitialTokenAtStartup(auth, logger);
  const client = new HorizonClient(settings.url, auth, {
    timeout: settings.timeout,
    exportTimeout: settings.exportTimeout,
    verifySsl: settings.verifySsl,
    testedVersions: settings.testedVersions,
    warnVersions: settings.warnVersions,
  });

  // Modern-only: a 2025-era opening is answered with the
  // unsupported-protocol-version error naming the revision this server speaks,
  // and the connection stays open for a modern opening. `serveStdio` pins one
  // instance per connection, so the factory runs once here.
  const handle = serveStdio(
    () =>
      createSessionServer(client, {
        enabledToolsets: settings.enabledToolsets,
        readOnly: settings.readOnly,
      }),
    {
      legacy: 'reject',
      onerror: (err) => logger.error(`stdio transport error: ${err}`),
    },
  );

  logger.info(
    'Horizon MCP server ready (stdio) - auth will trigger on first tool call.',
  );

  installShutdown(async () => {
    await handle.close();
    await client.close();
    await auth.cleanup();
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
  assertRuntimeSupportsTls(settings);

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
