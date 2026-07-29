/**
 * Shared constants, schemas, validation, and helpers for the datasource tools.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DS_BASE = '/api/v1/datasources';
export const MAX_LIST_ITEMS = 50;

export const VALID_DS_TYPES = new Set(['dns', 'ldap', 'rest']);
export const VALID_RECORD_TYPES = new Set(['a', 'aaaa', 'cname', 'ptr', 'txt']);
export const VALID_AUTH_TYPES = new Set([
  'noauth',
  'basic',
  'x509',
  'bearer',
  'custom',
]);

// ---------------------------------------------------------------------------
// Zod schemas for reuse
// ---------------------------------------------------------------------------

export const localizedNameSchema = z
  .array(z.object({ lang: z.string(), value: z.string() }))
  .optional()
  .describe("Localized display names, e.g. [{lang: 'en', value: 'My DS'}].");

export const dsAttributeSchema = z
  .array(
    z.object({
      key: z.string(),
      multi: z.boolean(),
      selected: z.boolean(),
    }),
  )
  .optional()
  .describe('Attributes to return. Each: {key, multi, selected}.');

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateDsType(dsType: string): string | undefined {
  if (!VALID_DS_TYPES.has(dsType)) {
    return JSON.stringify({
      error: `Invalid datasource type '${dsType}'.`,
      valid_types: [...VALID_DS_TYPES].sort(),
    });
  }
  return undefined;
}

export function validateRecordTypes(recordTypes: string[]): string | undefined {
  const invalid = recordTypes.filter((rt) => !VALID_RECORD_TYPES.has(rt));
  if (invalid.length > 0) {
    return JSON.stringify({
      error: `Invalid DNS record type(s): ${JSON.stringify(invalid.sort())}.`,
      valid_types: [...VALID_RECORD_TYPES].sort(),
    });
  }
  return undefined;
}

export function validateAuthType(authType: string): string | undefined {
  if (!VALID_AUTH_TYPES.has(authType)) {
    return JSON.stringify({
      error: `Invalid authentication type '${authType}'.`,
      valid_types: [...VALID_AUTH_TYPES].sort(),
    });
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeItems(data: unknown): Record<string, unknown>[] {
  if (data === null || typeof data !== 'object') return [];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const obj = data as Record<string, unknown>;
  if ('items' in obj) {
    return Array.isArray(obj['items'])
      ? (obj['items'] as Record<string, unknown>[])
      : [];
  }
  if (Object.keys(obj).length === 0) return [];
  return [obj];
}

export function applyTypeFilter(
  items: Record<string, unknown>[],
  dsType?: string,
): Record<string, unknown>[] {
  if (!dsType) return items;
  return items.filter((it) => it['type'] === dsType);
}
