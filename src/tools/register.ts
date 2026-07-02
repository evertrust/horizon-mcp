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

import { HorizonError } from '../client/errors.js';
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
   * `buildToolDescription`, which appends a compact
   * `[when: ... | not: ... | pre: ...]` guidance suffix when an explicit
   * entry exists in `guidance.ts`. Set to false to opt out.
   */
  readonly wrapDescription?: boolean;
  /**
   * When true (default) thrown `HorizonError`s are converted to
   * `{ isError: true }` tool results so the model can self-correct.
   * Unknown errors still surface as JSON-RPC protocol errors.
   */
  readonly wrapErrors?: boolean;
}

// ---------------------------------------------------------------------------
// Name-prefix classification
// ---------------------------------------------------------------------------
//
// Single source of truth for the annotation hints + display title injected
// onto every tool. Mirrors the verb taxonomy already used elsewhere.
//
// readOnlyHint    -> true for queries; false for anything that mutates.
// destructiveHint -> only meaningful when readOnlyHint == false. True for
//                    delete/cancel/deny -- operations that remove or terminate.
// idempotentHint  -> only meaningful when readOnlyHint == false. True for
//                    updates that converge to the same state.
// openWorldHint   -> true for tools that reach external systems (network /
//                    third party APIs) or whose effect is observable outside
//                    Horizon. Conservative default for mutations is true.

interface Classification {
  readonly annotations: ToolAnnotations;
  readonly title: string;
}

const TITLE_OVERRIDES: Record<string, string> = {
  whoami: 'Who am I',
  get_license_info: 'License info',
  describe_query_fields: 'Describe HQL fields',
  translate_to_hql: 'Translate to HQL',
  validate_hql: 'Validate HQL',
  validate_hcql: 'Validate HCQL',
  validate_hrql: 'Validate HRQL',
  validate_heql: 'Validate HEQL',
  validate_hdql: 'Validate HDQL',
  search_docs: 'Search product docs',
  search_api_docs: 'Search API docs',
  get_doc_page: 'Get doc page',
  fetch_exposed_certificate: 'Fetch live certificate',
  detect_file: 'Detect file format',
  decode_x509: 'Decode X.509 certificate',
  decode_csr: 'Decode CSR',
  decode_crl: 'Decode CRL',
  decode_ocsp: 'Decode OCSP response',
  decode_tsa: 'Decode TSA response',
  convert_pkcs12_to_jks: 'Convert PKCS#12 to JKS',
  simulate_computation_rule: 'Simulate computation rule',
  simulate_datasource_flow: 'Simulate datasource flow',
  simulate_trigger: 'Simulate trigger',
};

function titleFromName(name: string): string {
  const override = TITLE_OVERRIDES[name];
  if (override) return override;
  return name
    .split('_')
    .map((seg) =>
      seg.length === 0 ? seg : seg[0]!.toUpperCase() + seg.slice(1),
    )
    .join(' ');
}

function classify(name: string): Classification {
  const title = titleFromName(name);

  // Open-world tools: reach outside Horizon or hit live network endpoints.
  const isOpenWorld =
    name === 'fetch_exposed_certificate' ||
    name === 'search_docs' ||
    name === 'search_api_docs' ||
    name === 'get_doc_page';

  // Read-only families
  if (
    /^(search|list|get|read|aggregate|describe|validate|simulate|decode|export|download|explain|test)_/.test(
      name,
    ) ||
    name === 'whoami' ||
    name === 'get_license_info' ||
    name === 'fetch_exposed_certificate' ||
    name === 'detect_file' ||
    name === 'convert_pkcs12_to_jks' ||
    name === 'translate_to_hql'
  ) {
    const ann: ToolAnnotations = {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: isOpenWorld,
    };
    return {
      annotations: ann,
      title,
    };
  }

  // Destructive mutations
  if (
    /^(delete|remove|cancel|deny|flush)_/.test(name) ||
    name === 'revoke_certificate'
  ) {
    return {
      annotations: {
        title,
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      title,
    };
  }

  // Idempotent mutations (updates / upserts converge to the same state)
  if (/^(update|set|upsert)_/.test(name)) {
    return {
      annotations: {
        title,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      title,
    };
  }

  // Additive mutations and everything else (create/add/submit/approve/...)
  return {
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    title,
  };
}

// ---------------------------------------------------------------------------
// isError wrapping
// ---------------------------------------------------------------------------

function horizonErrorToToolResult(err: HorizonError): CallToolResult {
  const structured: Record<string, unknown> = {
    errorCode: err.errorCode ?? null,
    statusCode: err.statusCode,
    message: err.message,
  };
  if (err.detail !== undefined) structured['detail'] = err.detail;
  if (err.remediation !== undefined)
    structured['remediation'] = err.remediation;

  return {
    isError: true,
    content: [{ type: 'text', text: err.toToolResult() }],
    structuredContent: structured,
  };
}

function wrapHandler(
  handler: (...args: unknown[]) => ToolResult,
): (...args: unknown[]) => Promise<CallToolResult> {
  return async (...args: unknown[]) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof HorizonError) return horizonErrorToToolResult(err);
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Per-server registration config (read-only gating)
// ---------------------------------------------------------------------------
//
// Keyed on the McpServer instance rather than a module global so each session
// server (HTTP builds one per session) carries its own config with no
// cross-session leakage. `configureToolRegistration` is called once by the
// server factory before any tool is registered.

interface ToolRegistrationConfig {
  readonly readOnly: boolean;
}

const registrationConfig = new WeakMap<McpServer, ToolRegistrationConfig>();

export function configureToolRegistration(
  server: McpServer,
  config: ToolRegistrationConfig,
): void {
  registrationConfig.set(server, config);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register an MCP tool on the server.
 *
 * The wrapper injects:
 *  - `annotations` defaults (readOnlyHint, destructiveHint, idempotentHint,
 *    openWorldHint, title) derived from the tool name. Explicit
 *    `config.annotations` overrides win.
 *  - Compact `[when: ... | not: ... | pre: ...]` guidance suffix when
 *    `guidance.ts` has an explicit entry for the tool.
 *  - `HorizonError` -> `{ isError: true, structuredContent: { ... } }` so the
 *    model can self-correct from API failures.
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
  const wrapDescription = options.wrapDescription ?? true;
  const wrapErrors = options.wrapErrors ?? true;
  const classification = classify(name);

  const description = wrapDescription
    ? buildToolDescription(name, config.description)
    : config.description;

  const annotations: ToolAnnotations = {
    ...classification.annotations,
    ...config.annotations,
  };
  const title = config.title ?? classification.title;

  // Read-only mode: skip registering any tool whose effective annotations do
  // not mark it read-only. The caller ignores the return value, so returning
  // undefined here is safe.
  if (
    registrationConfig.get(server)?.readOnly &&
    annotations.readOnlyHint !== true
  ) {
    return undefined as unknown as ReturnType<McpServer['registerTool']>;
  }

  const handler = wrapErrors
    ? wrapHandler(cb as (...args: unknown[]) => ToolResult)
    : (cb as (...args: unknown[]) => Promise<CallToolResult>);

  const sdkConfig: Record<string, unknown> = {
    ...config,
    title,
    description,
    annotations,
    inputSchema:
      config.inputSchema === undefined
        ? undefined
        : (config.inputSchema as unknown as AnySchema | ZodRawShapeCompat),
  };

  return server.registerTool(
    name,
    sdkConfig as never,
    handler as unknown as ToolCallback<AnySchema | ZodRawShapeCompat>,
  );
}
