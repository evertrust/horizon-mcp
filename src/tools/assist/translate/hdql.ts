/**
 * HDQL (Horizon Discovery Query Language) condition extractor.
 */
import {
  extractDateConditions,
  extractFieldValues,
  globToRegex,
} from './shared.js';
import { type Condition, condition } from './types.js';

export function extractHdql(text: string): Condition[] {
  const conditions: Condition[] = [];
  const lower = text.toLowerCase();

  // --- Port ---
  let m = lower.match(/\bport\s+(\d+)\b/);
  if (m) {
    conditions.push(condition(`port equals ${m[1]}`, `port ${m[1]}`));
  }

  // --- IP ---
  m = lower.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?)\b/);
  if (m) {
    conditions.push(condition(`ip equals "${m[1]}"`, `IP ${m[1]}`));
  }

  // --- Hostname ---
  m = lower.match(
    /(?:host(?:name)?|domain|server)\s+(?:is\s+|named?\s+)?["']?([\w.*-]+\.[\w.*-]+)["']?/,
  );
  if (m) {
    const hostname = m[1]!;
    if (hostname.includes('*')) {
      const regex = globToRegex(hostname);
      conditions.push(
        condition(
          `hostname matches "${regex}"`,
          `hostname matching ${hostname}`,
        ),
      );
    } else {
      conditions.push(
        condition(`hostname equals "${hostname}"`, `hostname ${hostname}`),
      );
    }
  }

  // --- Campaign ---
  m = lower.match(/campaign\s+(?:named?\s+)?["']?([\w-]+)["']?/);
  if (m) {
    conditions.push(
      condition(`campaign equals "${m[1]}"`, `campaign '${m[1]}'`),
    );
  }

  extractDateConditions(lower, conditions, 'hdql');
  extractFieldValues(text, conditions, 'hdql');
  return conditions;
}
