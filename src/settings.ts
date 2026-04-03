import { z } from 'zod';

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
  loginTimeout: z.coerce.number().int().positive().default(300),
  timeout: z.coerce.number().int().positive().default(30),
  exportTimeout: z.coerce.number().int().positive().default(120),
  logLevel: z.string().default('INFO'),
  testedVersions: z.array(z.string()).default(['2.8']),
  warnVersions: z.array(z.string()).default(['2.7', '2.9']),
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
