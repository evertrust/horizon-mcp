/**
 * Shared types and constants for the translate_to_hql tool.
 */

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

export interface Condition {
  readonly fragment: string;
  readonly reason: string;
  readonly confidence: number;
}

export function condition(
  fragment: string,
  reason: string,
  confidence = 0.9,
): Condition {
  return { fragment, reason, confidence };
}

export type QueryType = 'hcql' | 'hrql' | 'heql' | 'hdql';

export const QUERY_TYPES: readonly QueryType[] = [
  'hcql',
  'hrql',
  'heql',
  'hdql',
];

// ReDoS guard: cap natural-language input so worst-case regex work is bounded.
// Combined with non-nested character classes in the extractors, this keeps
// the translator under a few milliseconds even for adversarial inputs.
export const MAX_TRANSLATE_INPUT_BYTES = 4096;
