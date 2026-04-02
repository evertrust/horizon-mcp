/**
 * E2E test fixture - creates a full MCP server + client stack that exercises
 * the complete path: MCP protocol -> tool handler -> HorizonClient -> Horizon API.
 *
 * Environment variables required:
 *   HORIZON_E2E_URL      - Base URL of the Horizon QA instance
 *   HORIZON_E2E_API_ID   - API key identifier
 *   HORIZON_E2E_API_KEY  - API key secret
 */

import { afterAll, beforeAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { HorizonClient } from "../../src/client/http.js";
import { ApiKeyAuthProvider } from "../../src/auth/apikey.js";
import { registerAllResources } from "../../src/resources/index.js";
import { registerProfileTools } from "../../src/tools/profiles.js";
import { registerLifecycleTools } from "../../src/tools/lifecycle.js";
import { registerDashboardTools } from "../../src/tools/dashboards.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";
import { registerDiscoveryEventTools } from "../../src/tools/discovery-events.js";
import { registerDiscoveryFeedTools } from "../../src/tools/discovery-feed.js";
import { registerDatasourceTools } from "../../src/tools/datasources.js";
import { registerReportTools } from "../../src/tools/reports.js";
import { registerTriggerTools } from "../../src/tools/triggers.js";
import { registerSystemTools } from "../../src/tools/assist/system.js";
import { registerQueryTools } from "../../src/tools/assist/query.js";
import { registerCryptoTools } from "../../src/tools/assist/crypto.js";
import { registerComputationTools } from "../../src/tools/assist/computation.js";
import { registerTranslateTools } from "../../src/tools/assist/translate.js";

// ---------------------------------------------------------------------------
// Environment gating
// ---------------------------------------------------------------------------

export const E2E_URL = process.env["HORIZON_E2E_URL"] ?? "";
export const E2E_API_ID = process.env["HORIZON_E2E_API_ID"] ?? "";
export const E2E_API_KEY = process.env["HORIZON_E2E_API_KEY"] ?? "";

export const E2E_CONFIGURED = Boolean(E2E_URL && E2E_API_ID && E2E_API_KEY);

// ---------------------------------------------------------------------------
// Unique prefix for test-created resources (cleanup-safe, no dots)
// ---------------------------------------------------------------------------

const hex8 = Math.random().toString(16).slice(2, 10);
export const E2E_PREFIX = `e2e-${hex8}`;

// ---------------------------------------------------------------------------
// Server instructions (matches src/index.ts)
// ---------------------------------------------------------------------------

const SERVER_INSTRUCTIONS =
  "Production MCP server for Evertrust Horizon CLM - " +
  "certificate lifecycle management, configuration, RBAC, and discovery.";

// ---------------------------------------------------------------------------
// Shared MCP Client + HorizonClient - created once per test suite
// ---------------------------------------------------------------------------

let mcpClient: Client | undefined;
let horizonClient: HorizonClient | undefined;

export function getMcpClient(): Client {
  if (!mcpClient) {
    throw new Error(
      "MCP client not initialized - call setupE2EStack() in a beforeAll block",
    );
  }
  return mcpClient;
}

export function getHorizonClient(): HorizonClient {
  if (!horizonClient) {
    throw new Error(
      "Horizon client not initialized - call setupE2EStack() in a beforeAll block",
    );
  }
  return horizonClient;
}

// ---------------------------------------------------------------------------
// Custom error for tool-level failures returned via MCP protocol
// ---------------------------------------------------------------------------

export class ToolError extends Error {
  constructor(
    public readonly toolName: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

// ---------------------------------------------------------------------------
// Tool / resource call helpers
// ---------------------------------------------------------------------------

/**
 * Invoke an MCP tool through the full protocol stack and return parsed JSON.
 *
 * Throws ToolError when:
 *   - The MCP response has isError=true (tool handler threw)
 *   - The parsed JSON contains an "error" key
 *
 * @param opts.timeout - MCP request timeout in ms (default 60000)
 */
export async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  opts?: { timeout?: number },
): Promise<Record<string, unknown>> {
  const client = getMcpClient();
  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    opts?.timeout ? { timeout: opts.timeout } : undefined,
  );

  const content = result.content as Array<{ type: string; text?: string }>;
  if (!content || content.length === 0) {
    throw new ToolError(name, `Tool '${name}' returned empty content`);
  }

  const textItem = content.find((c) => c.type === "text");
  if (!textItem?.text) {
    throw new ToolError(name, `Tool '${name}' returned no text content`);
  }

  // When the tool handler throws, the MCP SDK sets isError=true
  if (result.isError) {
    throw new ToolError(name, textItem.text);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(textItem.text) as Record<string, unknown>;
  } catch {
    return { raw: textItem.text };
  }

  if (data["error"]) {
    throw new ToolError(
      name,
      `Tool '${name}' returned error: ${JSON.stringify(data)}`,
    );
  }

  return data;
}

/**
 * Invoke an MCP tool and return the raw text response (no JSON parsing,
 * no error-key assertion). Used when the tool returns an error envelope
 * that we want to inspect directly.
 *
 * Unlike callTool, this does NOT throw on isError - the caller inspects
 * the response manually.
 *
 * @param opts.timeout - MCP request timeout in ms (default 60000)
 */
export async function callToolRaw(
  name: string,
  args: Record<string, unknown> = {},
  opts?: { timeout?: number },
): Promise<string> {
  const client = getMcpClient();
  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    opts?.timeout ? { timeout: opts.timeout } : undefined,
  );

  const content = result.content as Array<{ type: string; text?: string }>;
  if (!content || content.length === 0) {
    throw new Error(`Tool '${name}' returned empty content`);
  }

  const textItem = content.find((c) => c.type === "text");
  if (!textItem?.text) {
    throw new Error(`Tool '${name}' returned no text content`);
  }

  return textItem.text;
}

/**
 * Read an MCP resource by URI and return the text content.
 */
export async function readResource(uri: string): Promise<string> {
  const client = getMcpClient();
  const result = await client.readResource({ uri });

  const contents = result.contents;
  if (!contents || contents.length === 0) {
    throw new Error(`Resource '${uri}' returned empty contents`);
  }

  const item = contents[0]!;
  if ("text" in item && typeof item.text === "string") {
    return item.text;
  }

  throw new Error(`Resource '${uri}' returned non-text content`);
}

// ---------------------------------------------------------------------------
// Stack setup and teardown
// ---------------------------------------------------------------------------

function registerAllTools(server: McpServer, client: HorizonClient): void {
  registerProfileTools(server, client);
  registerLifecycleTools(server, client);
  registerDashboardTools(server, client);
  registerDiscoveryTools(server, client);
  registerDiscoveryEventTools(server, client);
  registerDiscoveryFeedTools(server, client);
  registerDatasourceTools(server, client);
  registerReportTools(server, client);
  registerTriggerTools(server, client);
  registerSystemTools(server, client);
  registerQueryTools(server, client);
  registerCryptoTools(server, client);
  registerComputationTools(server, client);
  registerTranslateTools(server, client);
}

/**
 * Create the full E2E stack: McpServer -> InMemoryTransport -> Client.
 * Call this inside the top-level `describe` block that gates on E2E_CONFIGURED.
 */
export function setupE2EStack(): void {
  beforeAll(async () => {
    // 1. Real HorizonClient against live QA
    const auth = new ApiKeyAuthProvider(E2E_API_ID, E2E_API_KEY);
    horizonClient = new HorizonClient(E2E_URL, auth, {
      timeout: 30,
      exportTimeout: 120,
      verifySsl: false,
    });

    // 2. Real McpServer with all tools and resources
    const server = new McpServer(
      { name: "e2e-test", version: "0.0.0" },
      { instructions: SERVER_INSTRUCTIONS },
    );
    registerAllResources(server);
    registerAllTools(server, horizonClient);

    // 3. Wire up via InMemoryTransport
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    mcpClient = new Client({ name: "e2e-test-client", version: "0.0.0" });
    await Promise.all([
      mcpClient.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterAll(async () => {
    if (horizonClient) {
      await horizonClient.close();
      horizonClient = undefined;
    }
    mcpClient = undefined;
  });
}
