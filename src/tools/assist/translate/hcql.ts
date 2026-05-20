/**
 * HCQL (Horizon Certificate Query Language) condition extractor.
 */
import { extractDateConditions, extractFieldValues } from './shared.js';
import { type Condition, condition } from './types.js';

export function extractHcql(text: string): Condition[] {
  const conditions: Condition[] = [];
  const lower = text.toLowerCase();

  // --- Status ---
  const statusMap: [string, string][] = [
    ['expired', 'expired?'],
    ['revoked', 'revoked?'],
    ['valid', 'valid'],
  ];
  for (const [status, pat] of statusMap) {
    if (new RegExp(`\\bnot?\\s+${pat}\\b`).test(lower)) {
      conditions.push(
        condition(`status is not ${status}`, `non-${status} certificates`),
      );
    } else if (new RegExp(`\\b${pat}\\b`).test(lower)) {
      // Avoid matching "valid.until" as a status reference
      if (status === 'valid' && /valid\.\w+/.test(lower)) {
        continue;
      }
      conditions.push(
        condition(`status is ${status}`, `${status} certificates`),
      );
    }
  }

  // --- Certificate properties ---
  const props: [string, string][] = [
    ['selfsigned', 'self[- ]?signed'],
    ['archived', 'archived?'],
    ['discovered', 'discovered?'],
    ['escrowed', 'escrowed?'],
    ['trusted', 'trusted'],
  ];
  for (const [prop, pat] of props) {
    if (new RegExp(`\\bnot?\\s+${pat}\\b`).test(lower)) {
      conditions.push(condition(`certificate is not ${prop}`, `not ${prop}`));
    } else if (new RegExp(`\\b${pat}\\b`).test(lower)) {
      conditions.push(
        condition(`certificate is ${prop}`, `${prop} certificates`),
      );
    }
  }

  // --- Certificate type ---
  for (const ctype of ['hybrid', 'legacy', 'pqc'] as const) {
    if (new RegExp(`\\b${ctype}\\b`).test(lower)) {
      conditions.push(
        condition(`certificatetype is ${ctype}`, `${ctype} certificate type`),
      );
    }
  }

  // --- Key type ---
  const keyTypes: [string, string][] = [
    ['rsa', 'rsa'],
    ['ec', 'ecdsa|elliptic\\s+curve'],
    ['eddsa', 'eddsa|ed25519|edwards'],
  ];
  for (const [kt, pat] of keyTypes) {
    if (new RegExp(`\\b(?:${pat})\\b`).test(lower)) {
      conditions.push(
        condition(`keytype contains "${kt}"`, `${kt.toUpperCase()} key type`),
      );
      break;
    }
  }

  // --- Grade ---
  let m = lower.match(/grade\s+(?:worse|lower|below)\s+(?:than\s+)?([a-f])\b/);
  if (m) {
    conditions.push(
      condition(
        `grade strictly lower than ${m[1]!.toUpperCase()}`,
        `grade worse than ${m[1]!.toUpperCase()}`,
      ),
    );
  }
  m = lower.match(/grade\s+(?:better|higher|above)\s+(?:than\s+)?([a-f])\b/);
  if (m) {
    conditions.push(
      condition(
        `grade strictly greater than ${m[1]!.toUpperCase()}`,
        `grade better than ${m[1]!.toUpperCase()}`,
      ),
    );
  }

  // --- Trigger results ---
  if (/trigger.*fail|failed?\s+trigger/.test(lower)) {
    conditions.push(
      condition('trigger.results has failure', 'failed triggers'),
    );
  } else if (/trigger.*warn/.test(lower)) {
    conditions.push(
      condition('trigger.results has warning', 'trigger warnings'),
    );
  }

  // --- Dates ---
  extractDateConditions(lower, conditions, 'hcql');

  // --- Field-value pairs ---
  extractFieldValues(text, conditions, 'hcql');

  return conditions;
}
