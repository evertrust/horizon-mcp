/**
 * Map of query type -> condition extractor function.
 */
import { extractHcql } from './hcql.js';
import { extractHdql } from './hdql.js';
import { extractHeql } from './heql.js';
import { extractHrql } from './hrql.js';
import { type Condition, type QueryType } from './types.js';

export const EXTRACTORS: Readonly<
  Record<QueryType, (text: string) => Condition[]>
> = {
  hcql: extractHcql,
  hrql: extractHrql,
  heql: extractHeql,
  hdql: extractHdql,
};
