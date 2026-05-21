/**
 * Natural language to HQL translation tool (barrel module).
 *
 * 1 tool: translate_to_hql
 *
 * Translates natural language descriptions into syntactically valid
 * Horizon Query Language expressions (HCQL, HRQL, HEQL, or HDQL).
 *
 * Implementation is split per query language under ./translate/.
 *
 * Knowledge resources:
 *   - horizon://knowledge/query-languages
 */
export type { Condition, QueryType } from './translate/types.js';
export { detectIntent } from './translate/intent.js';
export { extractHcql } from './translate/hcql.js';
export { extractHrql } from './translate/hrql.js';
export { extractHeql } from './translate/heql.js';
export { extractHdql } from './translate/hdql.js';
export { EXTRACTORS } from './translate/extractors.js';
export { registerTranslateTools } from './translate/register.js';
