import type {
  McpServer,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  AnySchema,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

import { buildToolDescription } from './guidance.js';

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

type ToolConfigBase = {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};

type ToolResult = CallToolResult | Promise<CallToolResult>;

export interface RegisterToolOptions {
  /**
   * When true (default) the supplied description is passed through
   * `buildToolDescription`, which appends `Use when:` / `Do not use when:` /
   * `Before calling:` family guidance for the tool. Set to false to opt out
   * (for example if a caller has already stamped these markers manually and
   * does not want the wrapper's idempotency check to short-circuit on the
   * literal text).
   */
  readonly wrapDescription?: boolean;
}

/**
 * Register an MCP tool on the server with the project's standard description
 * wrapping.
 *
 * The `config.description` string is always passed through
 * `buildToolDescription(name, description)` before being handed to the SDK.
 * `buildToolDescription` appends per-tool guidance to the original text:
 *
 *  - `Use when: ...`      (when the model should pick this tool)
 *  - `Do not use when: ...` (when a different tool is more appropriate)
 *  - `Before calling: ...` (optional preflight guidance, where applicable)
 *
 * The wrapper is idempotent: if the description already contains both
 * `Use when:` and `Do not use when:` markers it is returned unchanged.
 *
 * Callers should NOT pre-stamp `Use when:` / `Do not use when:` text in tool
 * descriptions to avoid duplicated guidance. To skip the wrap entirely for a
 * specific call, pass `{ wrapDescription: false }` as the final argument.
 */
export function registerTool(
  server: McpServer,
  name: string,
  config: ToolConfigBase & { inputSchema?: undefined },
  cb: (extra: ToolExtra) => ToolResult,
  options?: RegisterToolOptions,
): ReturnType<McpServer['registerTool']>;

export function registerTool<InputSchema extends z.ZodTypeAny>(
  server: McpServer,
  name: string,
  config: ToolConfigBase & { inputSchema: InputSchema },
  cb: (args: z.infer<InputSchema>, extra: ToolExtra) => ToolResult,
  options?: RegisterToolOptions,
): ReturnType<McpServer['registerTool']>;

export function registerTool(
  server: McpServer,
  name: string,
  config: ToolConfigBase,
  cb:
    | ((args: unknown, extra: ToolExtra) => ToolResult)
    | ((extra: ToolExtra) => ToolResult),
  options: RegisterToolOptions = {},
) {
  const wrap = options.wrapDescription ?? true;
  const description = wrap
    ? buildToolDescription(name, config.description)
    : config.description;
  return server.registerTool(
    name,
    {
      ...config,
      description,
      inputSchema:
        config.inputSchema === undefined
          ? undefined
          : (config.inputSchema as unknown as AnySchema | ZodRawShapeCompat),
    } as never,
    cb as unknown as ToolCallback<AnySchema | ZodRawShapeCompat>,
  );
}
