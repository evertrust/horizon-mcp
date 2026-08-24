import { z } from 'zod';

import { parseHttpAuthMethods } from './http/auth-methods.js';

// Case-insensitive enum: lowercases the env value before matching, so
// HORIZON_TRANSPORT=HTTP and =http both resolve to 'http'. An unknown value
// fails the parse (fail closed), never silently falls back.
const transportSchema = z
  .string()
  .default('stdio')
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(['stdio', 'http']));

const httpAuthMethodsSchema = z
  .string()
  .default('api-key')
  .transform(parseHttpAuthMethods);

// Comma-separated env list -> trimmed, non-empty string array.
const csvListSchema = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

// Optional comma list: undefined when the env var is absent (or empties out),
// otherwise a trimmed non-empty string array. Undefined means "no filter".
const optionalCsvListSchema = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const items = v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return items.length > 0 ? items : undefined;
  });

const settingsSchema = z.object({
  url: z.string().default('https://localhost'),
  apiId: z.string().default(''),
  apiKey: z.string().default(''),
  authMode: z.string().default(''), // deprecated - log warning if set
  clientCert: z.string().default(''),
  clientKey: z.string().default(''),
  clientKeyPassword: z.string().default(''),
  clientPfx: z.string().default(''),
  clientPfxPassword: z.string().default(''),
  verifySsl: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false' && v !== '0'),
  timeout: z.coerce.number().int().positive().default(30),
  exportTimeout: z.coerce.number().int().positive().default(120),
  logLevel: z.string().default('INFO'),
  testedVersions: z.array(z.string()).default(['2.8']),
  warnVersions: z.array(z.string()).default(['2.7', '2.9']),

  // -- Toolset gating -----------------------------------------------------
  // `enabledToolsets` (HORIZON_ENABLED_TOOLSETS) selects which tool domains to
  // register; undefined means all. `readOnly` (HORIZON_READ_ONLY) drops every
  // mutating tool at registration time when enabled.
  enabledToolsets: optionalCsvListSchema,
  readOnly: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true' || v === '1'),

  // -- Streamable HTTP transport ------------------------------------------
  // All HTTP-mode settings. `transport` selects stdio (default) vs http.
  // Cross-field validation (host defaults, mtls topology, header names) lives
  // in src/http/config.ts and only runs when transport === 'http'.
  transport: transportSchema,
  httpHost: z.string().default('127.0.0.1'),
  httpPort: z.coerce.number().int().positive().default(8080),
  httpPath: z.string().default('/mcp'),
  publicUrl: z.string().default(''),
  trustedHosts: csvListSchema,
  trustedOrigins: csvListSchema,
  httpAuthMethods: httpAuthMethodsSchema,
  // Removed in favour of the plural whitelist. Kept in the parsed shape so
  // HTTP startup can fail with an actionable migration error instead of
  // silently ignoring an old HORIZON_HTTP_AUTH_MODE deployment variable.
  httpAuthMode: z.string().default(''),
  // MCP 2026-07-28 has no protocol sessions, so the session knobs below are
  // gone. They are kept in the parsed shape so HTTP startup fails with an
  // actionable migration error naming the replacement instead of silently
  // ignoring an existing deployment's variables.
  sessionIdleTtl: z.string().default(''),
  sessionAbsTtl: z.string().default(''),
  maxSessions: z.string().default(''),
  initRateLimit: z.string().default(''),

  // Bounds simultaneous in-flight non-listen requests. Serving is now
  // per-request: each one builds its own MCP server instance, so this is what
  // caps peak heap. At the measured ~1.3 MiB marginal cost per instance the
  // default is comfortable for a 1 GiB container.
  maxConcurrentRequests: z.coerce
    .number()
    .int()
    .positive()
    .max(256)
    .default(32),
  maxListenStreamsGlobal: z.coerce.number().int().min(1).max(64).default(8),
  // Validated Horizon credentials are cached across requests; without this
  // every request would re-validate against Horizon over the network.
  credentialCacheMax: z.coerce.number().int().positive().max(512).default(64),
  credentialCacheTtl: z.coerce.number().int().min(30).max(3600).default(300),

  maxInflightToolcalls: z.coerce.number().int().positive().default(8),
  maxListenStreams: z.coerce.number().int().min(1).max(16).default(2),
  maxBodyBytes: z.coerce.number().int().positive().default(1048576),
  sseMaxDuration: z.coerce.number().int().min(1).max(86400).default(3600),
  sseKeepAlive: z.coerce.number().int().min(1).max(60).default(15),
  rateLimitRps: z.coerce.number().int().nonnegative().default(20),
  ipRateLimit: z.coerce.number().int().nonnegative().default(600),
  validationRateLimit: z.coerce.number().int().min(0).max(100).default(5),

  // -- Inbound mTLS (when HORIZON_HTTP_AUTH_METHODS includes mtls) ----------
  httpTlsCert: z.string().default(''),
  httpTlsKey: z.string().default(''),
  inboundCertHeader: z.string().default(''),
  trustedProxy: z.string().default(''),
  forwardCertHeader: z.string().default('SSL_CLIENT_CERT'),
});

export type HorizonSettings = z.infer<typeof settingsSchema>;

/**
 * Convert SCREAMING_SNAKE_CASE to camelCase.
 * e.g. "CLIENT_PFX_PASSWORD" -> "clientPfxPassword"
 */
function snakeToCamel(key: string): string {
  return key
    .toLowerCase()
    .replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

/**
 * Read HORIZON_* environment variables and parse into validated settings.
 * Strips the HORIZON_ prefix and converts SCREAMING_SNAKE to camelCase.
 */
export function loadSettings(
  env: Record<string, string | undefined> = process.env,
): HorizonSettings {
  const prefix = 'HORIZON_';
  const raw: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(prefix) && value !== undefined) {
      const stripped = key.slice(prefix.length);
      raw[snakeToCamel(stripped)] = value;
    }
  }

  const result = settingsSchema.parse(raw);

  // Normalize: strip trailing slash from URL
  return { ...result, url: result.url.replace(/\/+$/, '') };
}
