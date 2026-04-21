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

export function registerTool(
  server: McpServer,
  name: string,
  config: ToolConfigBase & { inputSchema?: undefined },
  cb: (extra: ToolExtra) => ToolResult,
): ReturnType<McpServer['registerTool']>;

export function registerTool<InputSchema extends z.ZodTypeAny>(
  server: McpServer,
  name: string,
  config: ToolConfigBase & { inputSchema: InputSchema },
  cb: (args: z.infer<InputSchema>, extra: ToolExtra) => ToolResult,
): ReturnType<McpServer['registerTool']>;

export function registerTool(
  server: McpServer,
  name: string,
  config: ToolConfigBase,
  cb:
    | ((args: unknown, extra: ToolExtra) => ToolResult)
    | ((extra: ToolExtra) => ToolResult),
) {
  return server.registerTool(
    name,
    {
      ...config,
      description: buildToolDescription(name, config.description),
      inputSchema:
        config.inputSchema === undefined
          ? undefined
          : (config.inputSchema as unknown as AnySchema | ZodRawShapeCompat),
    } as never,
    cb as unknown as ToolCallback<AnySchema | ZodRawShapeCompat>,
  );
}
