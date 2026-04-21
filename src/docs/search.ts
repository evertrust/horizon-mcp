import type { DocPage, DocProduct, DocSearchResult } from './types.js';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'use',
  'with',
]);

const QUERY_ALIASES: Record<string, string[]> = {
  ad: ['active', 'directory'],
  adcs: ['active', 'directory', 'certificate', 'services', 'connector'],
  ansible: ['playbook', 'collection', 'module'],
  api: ['endpoint', 'route', 'http'],
  digicert: ['certificate', 'authority', 'connector'],
  install: ['installation', 'introduction', 'initial', 'configuration'],
  intune: ['pkcs', 'scep', 'winhorizon'],
  issuer: ['signing', 'issuing'],
  terraform: ['provider', 'resource'],
  winhorizon: ['windows', 'client', 'intune'],
};

const OVERVIEW_QUERY_TOKENS = new Set([
  'configure',
  'configuration',
  'getting',
  'install',
  'installation',
  'introduction',
  'overview',
  'setup',
  'start',
  'started',
]);
const OVERVIEW_SLUGS = new Set(['index', 'introduction', 'overview']);

function scorePhrase(text: string, query: string, weight: number): number {
  const normalizedText = normalize(text);
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return 0;
  }
  if (normalizedText === normalizedQuery) {
    return weight * 2;
  }
  if (normalizedText.includes(normalizedQuery)) {
    return weight;
  }
  return 0;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function expandTokens(tokens: readonly string[]): string[] {
  const expanded = new Set<string>(tokens);
  for (const token of tokens) {
    for (const alias of QUERY_ALIASES[token] ?? []) {
      expanded.add(alias);
    }
  }
  return [...expanded];
}

function findSnippet(content: string, tokens: readonly string[]): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }

  const haystack = compact.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    index = haystack.indexOf(token.toLowerCase());
    if (index >= 0) {
      break;
    }
  }

  if (index < 0) {
    return compact.slice(0, 220);
  }

  const start = Math.max(0, index - 70);
  const end = Math.min(compact.length, index + 150);
  return compact.slice(start, end).trim();
}

function scoreText(
  text: string,
  tokens: readonly string[],
  weight: number,
): number {
  const normalized = normalize(text);
  let score = 0;
  for (const token of tokens) {
    if (normalized === token) {
      score += weight * 3;
      continue;
    }
    if (normalized.includes(token)) {
      score += weight;
    }
  }
  return score;
}

function scorePage(
  page: DocPage,
  query: string,
  tokens: readonly string[],
  productFilter?: DocProduct,
): number {
  const normalizedQuery = normalize(query);
  let score = 0;

  score += scorePhrase(page.title, query, 90);
  score += scorePhrase(page.section, query, 40);
  score += scorePhrase(page.slug, query, 50);
  score += scorePhrase(page.summary, query, 24);
  score += scorePhrase(page.breadcrumbs.join(' '), query, 30);
  score += scorePhrase(page.keywords.join(' '), query, 22);

  if (normalize(page.title).includes(normalizedQuery)) {
    score += 120;
  }
  if (normalize(page.url).includes(normalizedQuery)) {
    score += 40;
  }
  if (page.api_path && page.api_path.toLowerCase().includes(normalizedQuery)) {
    score += 70;
  }
  if (page.method && page.method.toLowerCase() === normalizedQuery) {
    score += 50;
  }
  if (productFilter && page.product === productFilter) {
    score += 20;
  }
  if (
    tokens.some((token) => OVERVIEW_QUERY_TOKENS.has(token)) &&
    (OVERVIEW_SLUGS.has(page.slug) ||
      page.slug.endsWith('/introduction') ||
      page.slug.endsWith('/initial-config') ||
      page.section === 'overview')
  ) {
    score += 45;
  }
  if (
    page.product === 'horizon-ansible' &&
    page.slug === 'index' &&
    (tokens.includes('collection') ||
      tokens.includes('ansible') ||
      tokens.some((token) => OVERVIEW_QUERY_TOKENS.has(token)))
  ) {
    score += 140;
  }

  score += scoreText(page.title, tokens, 30);
  score += scoreText(page.section, tokens, 16);
  score += scoreText(page.slug, tokens, 18);
  score += scoreText(page.summary, tokens, 12);
  score += scoreText(page.breadcrumbs.join(' '), tokens, 14);
  score += scoreText(page.keywords.join(' '), tokens, 10);
  score += scoreText(page.content.slice(0, 8000), tokens, 4);

  return score;
}

export function searchDocPages(params: {
  pages: readonly DocPage[];
  query: string;
  product?: DocProduct;
  version?: string;
  maxResults: number;
}): DocSearchResult[] {
  const baseTokens = tokenize(params.query);
  const tokens = expandTokens(
    baseTokens.length > 0 ? baseTokens : [params.query],
  );

  const ranked = params.pages
    .filter((page) => !params.version || page.version === params.version)
    .map((page) => ({
      page,
      score: scorePage(page, params.query, tokens, params.product),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.page.title.localeCompare(right.page.title);
    })
    .slice(0, params.maxResults);

  return ranked.map(({ page, score }) => ({
    page_id: page.page_id,
    title: page.title,
    product: page.product,
    version: page.version,
    section: page.section,
    url: page.url,
    snippet: findSnippet(page.content || page.summary, tokens),
    breadcrumbs: page.breadcrumbs,
    method: page.method,
    path: page.api_path,
    score,
  }));
}
