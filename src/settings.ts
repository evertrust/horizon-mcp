import { z } from 'zod';

// Case-insensitive enum: lowercases the env value before matching, so
// HORIZON_TRANSPORT=HTTP and =http both resolve to 'http'. An unknown value
// fails the parse (fail closed), never silently falls back.
const transportSchema = z
  .string()
  .default('stdio')
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(['stdio', 'http']));

const httpAuthModeSchema = z
  .string()
  .default('service')
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(['service', 'api-key', 'mtls']));

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
  httpAuthMode: httpAuthModeSchema,
  sessionIdleTtl: z.coerce.number().int().positive().default(300),
  sessionAbsTtl: z.coerce.number().int().positive().default(3600),
  maxSessions: z.coerce.number().int().positive().default(256),
  maxInflightToolcalls: z.coerce.number().int().positive().default(8),
  maxBodyBytes: z.coerce.number().int().positive().default(1048576),
  sseMaxDuration: z.coerce.number().int().positive().default(3600),
  rateLimitRps: z.coerce.number().int().nonnegative().default(20),
  initRateLimit: z.coerce.number().int().nonnegative().default(5),

  // -- Inbound mTLS (only when HORIZON_HTTP_AUTH_MODE=mtls) ----------------
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
