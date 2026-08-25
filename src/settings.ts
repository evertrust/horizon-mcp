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

export type OAuthAuthMethod = 'client_secret_basic' | 'client_secret_post';

export interface OAuthIssuerSettings {
  readonly tokenUrl: string;
  readonly authMethod: OAuthAuthMethod;
}

export type OAuthIssuerMap = Readonly<Record<string, OAuthIssuerSettings>>;

const MAX_OAUTH_ISSUERS_LENGTH = 65_536;
const OAUTH_AUTH_METHODS: ReadonlySet<string> = new Set([
  'client_secret_basic',
  'client_secret_post',
]);

function isAbsoluteHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseOAuthIssuerEntry(
  issuer: string,
  rawEntry: unknown,
): OAuthIssuerSettings {
  if (!isAbsoluteHttpsUrl(issuer)) {
    throw new Error(
      `HORIZON_OAUTH_ISSUERS issuer "${issuer}" must be an absolute HTTPS URL`,
    );
  }
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
    throw new Error(
      `HORIZON_OAUTH_ISSUERS issuer "${issuer}" must map to an object`,
    );
  }
  const entry = rawEntry as Record<string, unknown>;
  if (!isAbsoluteHttpsUrl(entry['tokenUrl'])) {
    throw new Error(
      `HORIZON_OAUTH_ISSUERS issuer "${issuer}" has tokenUrl that must be an absolute HTTPS URL`,
    );
  }
  if (!OAUTH_AUTH_METHODS.has(String(entry['authMethod']))) {
    throw new Error(
      `HORIZON_OAUTH_ISSUERS issuer "${issuer}" has unsupported authMethod "${String(entry['authMethod'])}"; expected client_secret_basic or client_secret_post`,
    );
  }
  const extraKey = Object.keys(entry).find(
    (key) => key !== 'tokenUrl' && key !== 'authMethod',
  );
  if (extraKey !== undefined) {
    throw new Error(
      `HORIZON_OAUTH_ISSUERS issuer "${issuer}" has unsupported key "${extraKey}"`,
    );
  }
  return Object.freeze({
    tokenUrl: entry['tokenUrl'],
    authMethod: entry['authMethod'] as OAuthAuthMethod,
  });
}

function parseOAuthIssuers(raw: string): OAuthIssuerMap {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('HORIZON_OAUTH_ISSUERS must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'HORIZON_OAUTH_ISSUERS must be a JSON object keyed by issuer URL',
    );
  }

  const issuers: Record<string, OAuthIssuerSettings> = {};
  for (const [issuer, entry] of Object.entries(value)) {
    issuers[issuer] = parseOAuthIssuerEntry(issuer, entry);
  }
  return Object.freeze(issuers);
}

const oauthIssuersSchema = z
  .string()
  .max(
    MAX_OAUTH_ISSUERS_LENGTH,
    'HORIZON_OAUTH_ISSUERS must not exceed 65,536 characters',
  )
  .optional()
  .transform((value) =>
    value === undefined ? undefined : parseOAuthIssuers(value),
  );

const settingsSchema = z
  .object({
    url: z.string().default('https://localhost'),
    apiId: z.string().default(''),
    apiKey: z.string().default(''),
    serviceAccount: z.string().max(255).default(''),
    apiToken: z.string().max(16_384).default(''),
    oauthClientId: z.string().max(512).default(''),
    oauthClientSecret: z.string().max(4096).default(''),
    oauthScope: z.string().max(2048).default(''),
    oauthAudience: z.string().max(2048).default(''),
    oauthIssuers: oauthIssuersSchema,
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
  })
  .superRefine((settings, ctx) => {
    if (settings.transport !== 'stdio') return;

    const addIssue = (message: string, path: string) => {
      ctx.addIssue({ code: 'custom', message, path: [path] });
    };
    const requirePartner = (
      present: string,
      partner: string,
      presentName: string,
      partnerName: string,
    ) => {
      if (Boolean(present) !== Boolean(partner)) {
        const missing = present ? partnerName : presentName;
        addIssue(`${missing} is required`, missing.slice('HORIZON_'.length));
      }
    };

    requirePartner(
      settings.apiId,
      settings.apiKey,
      'HORIZON_API_ID',
      'HORIZON_API_KEY',
    );
    requirePartner(
      settings.serviceAccount,
      settings.apiToken,
      'HORIZON_SERVICE_ACCOUNT',
      'HORIZON_API_TOKEN',
    );
    requirePartner(
      settings.clientCert,
      settings.clientKey,
      'HORIZON_CLIENT_CERT',
      'HORIZON_CLIENT_KEY',
    );
    requirePartner(
      settings.oauthClientId,
      settings.oauthClientSecret,
      'HORIZON_OAUTH_CLIENT_ID',
      'HORIZON_OAUTH_CLIENT_SECRET',
    );

    const hasServiceCredential = Boolean(
      settings.serviceAccount && settings.apiToken,
    );
    const hasOauthClient = Boolean(
      settings.oauthClientId && settings.oauthClientSecret,
    );
    const hasOauthMetadata = Boolean(
      settings.oauthClientId ||
      settings.oauthClientSecret ||
      settings.oauthScope ||
      settings.oauthAudience,
    );
    if (hasOauthMetadata && !hasServiceCredential) {
      addIssue(
        'OAuth renewal settings require HORIZON_SERVICE_ACCOUNT and HORIZON_API_TOKEN',
        'oauthClientId',
      );
    }
    if ((settings.oauthScope || settings.oauthAudience) && !hasOauthClient) {
      addIssue(
        'HORIZON_OAUTH_SCOPE and HORIZON_OAUTH_AUDIENCE require HORIZON_OAUTH_CLIENT_ID and HORIZON_OAUTH_CLIENT_SECRET',
        settings.oauthScope ? 'oauthScope' : 'oauthAudience',
      );
    }
    if (
      settings.clientKeyPassword &&
      !(settings.clientCert && settings.clientKey)
    ) {
      addIssue(
        'HORIZON_CLIENT_KEY_PASSWORD requires HORIZON_CLIENT_CERT and HORIZON_CLIENT_KEY',
        'clientKeyPassword',
      );
    }
    if (settings.clientPfxPassword && !settings.clientPfx) {
      addIssue(
        'HORIZON_CLIENT_PFX_PASSWORD requires HORIZON_CLIENT_PFX',
        'clientPfxPassword',
      );
    }
    if (settings.clientCert && settings.clientPfx) {
      addIssue(
        'Set HORIZON_CLIENT_CERT or HORIZON_CLIENT_PFX, not both',
        'clientCert',
      );
    }

    const completeMethods = [
      Boolean(settings.apiId && settings.apiKey),
      hasServiceCredential,
      Boolean(
        (settings.clientCert && settings.clientKey) || settings.clientPfx,
      ),
    ].filter(Boolean).length;
    if (completeMethods !== 1) {
      addIssue(
        'Exactly one complete stdio authentication method must be configured: HORIZON_API_ID with HORIZON_API_KEY, HORIZON_SERVICE_ACCOUNT with HORIZON_API_TOKEN, or mTLS using HORIZON_CLIENT_CERT with HORIZON_CLIENT_KEY or HORIZON_CLIENT_PFX',
        'transport',
      );
    }
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
