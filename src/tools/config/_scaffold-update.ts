/**
 * Update-tool helpers for the configuration scaffold: the update options,
 * the clear_fields checks and plan, and the update tool config.
 */
import { z } from 'zod';

import { HorizonError } from '../../client/errors.js';
import type { ConfigSpec } from './_scaffold.js';

function withoutKeys(
  data: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([k]) => !keys.includes(k)),
  );
}

export type NormalizeCurrent = (
  current: Record<string, unknown>,
) => Record<string, unknown>;

export type UpdateOpts<S extends z.ZodObject<z.ZodRawShape>> = {
  description: string;
  inputSchema: S;
  buildOverrides: (args: z.infer<S>) => Record<string, unknown>;
  preValidate?: (args: z.infer<S>) => string | undefined;
  /** Normalizes a GET-only representation before the merged PUT. */
  normalizeCurrent?: NormalizeCurrent;
  validateMergedBody?: (body: Record<string, unknown>) => void;
  /**
   * Leave clear_fields out of the PUT body instead of sending null, for
   * APIs whose fields are not nullable. buildOverrides can still set a
   * value for a cleared field (for example [] for a list).
   */
  omitClearedFields?: boolean;
};

/**
 * clear_fields resets a field in the full-replace PUT body. Never allow
 * clearing an immutable key or a server-managed (stripped) field.
 */
export function assertClearable(
  spec: ConfigSpec,
  clearFields: readonly string[],
) {
  const forbidden = new Set<string>([
    ...spec.stripFields,
    ...spec.immutableKeys,
  ]);
  const bad = clearFields.filter((f) => forbidden.has(f));
  if (bad.length > 0) {
    throw new HorizonError(422, {
      errorCode: 'CONFIG-CLEAR-FORBIDDEN',
      message: `clear_fields may not target immutable or server-managed fields: ${bad.join(', ')}.`,
      remediation: 'Remove these from clear_fields - they cannot be nulled.',
    });
  }
}

/**
 * How the merge applies clear_fields: as nulls (default), or by dropping the
 * fields from the stored object when omitClearedFields is set.
 */
export function planClear(
  clearFields: string[] | undefined,
  omitClearedFields: boolean | undefined,
  normalizeCurrent: NormalizeCurrent | undefined,
): { nullFields?: string[]; normalizeCurrent?: NormalizeCurrent } {
  if (omitClearedFields !== true || !clearFields || clearFields.length === 0) {
    return { nullFields: clearFields, normalizeCurrent };
  }
  return {
    normalizeCurrent: (current) =>
      withoutKeys(normalizeCurrent?.(current) ?? current, clearFields),
  };
}

/**
 * Tool config for update_<noun>. `specNotes` is the immutable-field note and
 * the knowledge-reference footer of the spec.
 */
export function buildUpdateConfig<S extends z.ZodObject<z.ZodRawShape>>(
  opts: UpdateOpts<S>,
  specNotes: string,
) {
  return {
    description:
      `${opts.description}\nSafety tier: mutating-destructive\n` +
      `Update is GET -> strip server fields -> merge -> PUT (full-replace). Stored ` +
      `fields not mentioned in the call are preserved by the merge; use clear_fields ` +
      `to reset a field. ${specNotes}`,
    inputSchema: opts.inputSchema,
    // Config update is a full-replace PUT that can reset omitted fields and
    // overwrite permissions, so it is destructive despite the update_ prefix
    // the classifier treats as non-destructive by default.
    annotations: { destructiveHint: true },
  };
}
