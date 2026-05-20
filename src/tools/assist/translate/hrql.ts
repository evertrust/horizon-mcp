/**
 * HRQL (Horizon Request Query Language) condition extractor.
 */
import { extractDateConditions, extractFieldValues } from './shared.js';
import { type Condition, condition } from './types.js';

export function extractHrql(text: string): Condition[] {
  const conditions: Condition[] = [];
  const lower = text.toLowerCase();

  // --- Workflow type ---
  const wfMap: [string, string][] = [
    ['enroll', 'enroll'],
    ['revoke', 'revok|revocation'],
    ['renew', 'renew'],
    ['update', 'updat'],
    ['recover', 'recover'],
    ['migrate', 'migrat'],
    ['import', 'import'],
  ];
  for (const [wf, pat] of wfMap) {
    if (new RegExp(`\\b${pat}`).test(lower)) {
      conditions.push(condition(`workflow equals "${wf}"`, `${wf} workflow`));
      break;
    }
  }

  // --- Request status ---
  const statusMap: [string, string][] = [
    ['pending', 'pending'],
    ['approved', 'approved?'],
    ['denied', 'denied?|rejected?'],
    ['cancelled', 'cancell?ed'],
  ];
  for (const [status, pat] of statusMap) {
    if (new RegExp(`\\b${pat}\\b`).test(lower)) {
      conditions.push(
        condition(`status equals "${status}"`, `${status} requests`),
      );
      break;
    }
  }

  extractDateConditions(lower, conditions, 'hrql');
  extractFieldValues(text, conditions, 'hrql');
  return conditions;
}
