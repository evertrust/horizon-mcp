import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

import type {
  DocPage,
  DocPageCatalog,
  DocProduct,
  DocVersionCatalog,
  DocVersionEntry,
} from '../../src/docs/types.js';

const OUTPUT_DIR = resolve(process.cwd(), 'src/generated/docs');
const DOCS_ROOT = 'https://docs.evertrust.fr';
const SITEMAP_INDEX_URL = `${DOCS_ROOT}/sitemap.xml`;
const ANSIBLE_ROOT = 'https://evertrust.github.io/horizon-ansible';
const TERRAFORM_PROVIDER_API =
  'https://registry.terraform.io/v1/providers/EverTrust/horizon';

const ANTORA_COMPONENTS = new Set([
  'horizon',
  'adcs-connector',
  'horizon-cli',
  'horizon-issuer',
  'winhorizon',
]);

const EXTRACTED_TEXT_REDACTIONS: ReadonlyArray<{
  pattern: RegExp;
  replacement: string;
}> = [
  {
    pattern:
      /https:\/\/hooks\.slack(?:-gov)?\.com\/services\/[A-Za-z0-9/_-]+/gi,
    replacement: 'https://hooks.slack.com/services/<redacted>',
  },
  {
    pattern:
      /https:\/\/(?:[\w-]+\.)?(?:webhook\.office\.com|outlook\.office\.com)\/webhook\/[^\s<>"')]+/gi,
    replacement: 'https://outlook.office.com/webhook/<redacted>',
  },
];

const SCRIPT_TAG_RE = /<script\b[\s\S]*?<\/script\b[^>]*>/gi;
const STYLE_TAG_RE = /<style\b[\s\S]*?<\/style\b[^>]*>/gi;

interface DecodeEntitiesOptions {
  readonly decodeAngles?: boolean;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left
    .split('.')
    .map((segment) => Number.parseInt(segment, 10));
  const rightParts = right
    .split('.')
    .map((segment) => Number.parseInt(segment, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

function decodeEntities(
  text: string,
  options: DecodeEntitiesOptions = {},
): string {
  const decodeAngles = options.decodeAngles ?? false;

  return text.replace(
    /&#(\d+);|&#x([0-9a-f]+);|&(nbsp|amp|lt|gt|quot|#39);/gi,
    (entity, decimal, hex, named) => {
      if (decimal) {
        const decoded = String.fromCodePoint(Number.parseInt(decimal, 10));
        if (!decodeAngles && (decoded === '<' || decoded === '>')) {
          return entity;
        }
        return decoded;
      }

      if (hex) {
        const decoded = String.fromCodePoint(Number.parseInt(hex, 16));
        if (!decodeAngles && (decoded === '<' || decoded === '>')) {
          return entity;
        }
        return decoded;
      }

      switch ((named ?? '').toLowerCase()) {
        case 'nbsp':
          return ' ';
        case 'amp':
          return '&';
        case 'quot':
          return '"';
        case '#39':
          return "'";
        case 'lt':
          return decodeAngles ? '<' : entity;
        case 'gt':
          return decodeAngles ? '>' : entity;
        default:
          return entity;
      }
    },
  );
}

function stripTags(html: string): string {
  const stripped = decodeEntities(
    html
      .replace(SCRIPT_TAG_RE, ' ')
      .replace(STYLE_TAG_RE, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
    { decodeAngles: false },
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return sanitizeExtractedText(stripped);
}

function extractFirstMatch(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  return match?.[1]?.trim();
}

function extractTitle(html: string): string {
  const raw =
    extractFirstMatch(html, /<title>([\s\S]*?)<\/title>/i) ?? 'Untitled';
  return decodeEntities(raw.replace(/\s*::\s*EVERTRUST documentation$/, ''), {
    decodeAngles: false,
  });
}

function extractCanonicalUrl(url: string, html: string): string {
  return (
    extractFirstMatch(html, /<link rel="canonical" href="([^"]+)"/i) ?? url
  );
}

function extractBreadcrumbs(html: string): string[] {
  const block =
    extractFirstMatch(
      html,
      /<nav class="breadcrumbs"[\s\S]*?>([\s\S]*?)<\/nav>/i,
    ) ??
    extractFirstMatch(html, /<ul class="wy-breadcrumbs">([\s\S]*?)<\/ul>/i) ??
    '';

  const parts = [...block.matchAll(/>([^<>]+)</g)]
    .map((match) =>
      decodeEntities(match[1] ?? '', { decodeAngles: false }).trim(),
    )
    .filter(
      (part) =>
        part.length > 0 &&
        part !== 'Edit on GitHub' &&
        part !== '/' &&
        !part.startsWith('Page source'),
    );

  return [...new Set(parts)];
}

function extractAntoraArticle(html: string): string {
  return (
    extractFirstMatch(html, /<article class="doc">([\s\S]*?)<\/article>/i) ??
    extractFirstMatch(html, /<main class="article">([\s\S]*?)<\/main>/i) ??
    ''
  );
}

function extractSphinxArticle(html: string): string {
  return (
    extractFirstMatch(
      html,
      /<div role="main" class="document"[\s\S]*?>([\s\S]*?)<footer/i,
    ) ??
    extractFirstMatch(html, /<body[\s\S]*?>([\s\S]*?)<\/body>/i) ??
    ''
  );
}

function extractSummary(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 240);
}

function extractFrontMatterValue(
  markdown: string,
  key: string,
): string | undefined {
  const match = markdown.match(
    new RegExp(
      `^---\\n[\\s\\S]*?^${key}:\\s*"?(.+?)"?\\s*$[\\s\\S]*?^---\\n`,
      'm',
    ),
  );
  return match?.[1]?.trim();
}

function extractMarkdownTitle(markdown: string): string | undefined {
  const cleaned = cleanMarkdownContent(markdown);
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      continue;
    }
    if (/^#\s+generated by /i.test(trimmed)) {
      continue;
    }
    const heading = trimmed.match(/^#\s+(.+)$/);
    if (heading?.[1]) {
      return heading[1].trim();
    }
  }
  return undefined;
}

function cleanMarkdownContent(markdown: string): string {
  return sanitizeExtractedText(
    markdown
      .replace(/^---\n[\s\S]*?\n---\n/, '')
      .replace(/^#\s+generated by .+\n+/im, '')
      .trim(),
  );
}

function sanitizeExtractedText(text: string): string {
  return EXTRACTED_TEXT_REDACTIONS.reduce(
    (value, rule) => value.replace(rule.pattern, rule.replacement),
    text,
  );
}

function buildKeywords(parts: readonly string[]): string[] {
  return [
    ...new Set(
      parts.flatMap((part) => part.toLowerCase().split(/[^a-z0-9/_-]+/)),
    ),
  ].filter((part) => part.length > 1);
}

function buildPageId(
  product: DocProduct,
  version: string,
  slug: string,
): string {
  return `${product}:${version}:${slug.replace(/\//g, ':')}`;
}

function buildDocVersionCatalog(
  productPages: readonly DocPage[],
  apiPages: readonly DocPage[],
  companionPages: readonly DocPage[],
): DocVersionCatalog {
  const entries = new Map<DocProduct, Set<string>>();
  for (const page of [...productPages, ...apiPages, ...companionPages]) {
    const versions = entries.get(page.product) ?? new Set<string>();
    versions.add(page.version);
    entries.set(page.product, versions);
  }

  const products: Record<string, DocVersionEntry> = {};
  for (const [product, versionsSet] of entries) {
    const versions = [...versionsSet].sort(compareVersions);
    products[product] = {
      product,
      latest: versions.at(-1) ?? 'unknown',
      versions,
      defaultPolicy:
        product === 'horizon' || product === 'horizon-api'
          ? 'connected-instance'
          : 'latest-indexed',
      provenance:
        product === 'terraform-provider-horizon'
          ? 'Terraform Registry provider metadata'
          : product === 'horizon-ansible'
            ? 'Horizon Ansible published documentation'
            : 'Official Evertrust documentation sitemap',
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    products,
  };
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) =>
    decodeEntities(match[1] ?? '', { decodeAngles: false }),
  );
}

function classifyAntoraProduct(
  component: string,
  path: string,
): {
  product: DocProduct;
  kind: 'product' | 'api' | 'companion';
} | null {
  if (!ANTORA_COMPONENTS.has(component)) {
    return null;
  }

  if (component === 'horizon' && path.includes('/api-ref/')) {
    return { product: 'horizon-api', kind: 'api' };
  }
  if (component === 'horizon') {
    return { product: 'horizon', kind: 'product' };
  }

  return {
    product: component as Exclude<DocProduct, 'horizon' | 'horizon-api'>,
    kind: 'companion',
  };
}

function parseAntoraPageInfo(url: string): {
  component: string;
  version: string;
  section: string;
  slug: string;
} | null {
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  const [component, version, section, ...rest] = parts;
  if (!component || !version) {
    return null;
  }
  const slug =
    `${section ?? 'index'}/${rest.join('/').replace(/\.html$/, '')}`.replace(
      /\/$/,
      '',
    );

  return {
    component,
    version,
    section: section ?? 'overview',
    slug: slug || 'index',
  };
}

function extractApiMethodAndPath(html: string): {
  method?: string;
  apiPath?: string;
} {
  const match = html.match(
    /<div class="uppercase[^"]*">([^<]+)<\/div>\s*<a class="[^"]*">([^<]+)<\/a>/i,
  );

  return {
    method: match?.[1]?.trim().toUpperCase(),
    apiPath: match?.[2]?.trim(),
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]!, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

async function collectAntoraPages(): Promise<{
  productPages: DocPage[];
  apiPages: DocPage[];
  companionPages: DocPage[];
}> {
  const sitemapIndex = await fetchText(SITEMAP_INDEX_URL);
  const sitemapUrls = parseSitemapLocs(sitemapIndex).filter((url) =>
    /(sitemap-horizon\.xml|sitemap-adcs-connector\.xml|sitemap-horizon-cli\.xml|sitemap-horizon-issuer\.xml|sitemap-winhorizon\.xml)$/.test(
      url,
    ),
  );

  const pageUrls = (
    await Promise.all(
      sitemapUrls.map(async (sitemapUrl) =>
        parseSitemapLocs(await fetchText(sitemapUrl)),
      ),
    )
  )
    .flat()
    .filter((url) => url.includes('.html'))
    .sort();

  const pages = await mapWithConcurrency(pageUrls, 8, async (pageUrl) => {
    const info = parseAntoraPageInfo(pageUrl);
    if (!info) {
      throw new Error(`Could not parse Antora page info from ${pageUrl}`);
    }

    const classification = classifyAntoraProduct(info.component, pageUrl);
    if (!classification) {
      throw new Error(
        `Unsupported Antora component ${info.component} for ${pageUrl}`,
      );
    }

    const html = await fetchText(pageUrl);
    const canonicalUrl = extractCanonicalUrl(pageUrl, html);
    const content = stripTags(extractAntoraArticle(html));
    const summary = extractSummary(content);
    const breadcrumbs = extractBreadcrumbs(html);
    const { method, apiPath } = extractApiMethodAndPath(html);
    const extractedTitle = extractTitle(html);
    const title =
      extractedTitle !== 'Untitled'
        ? extractedTitle
        : (breadcrumbs.at(-1) ?? content.split('\n')[0] ?? 'Untitled');
    const keywordSource = [title, info.section, info.slug, ...breadcrumbs];

    return {
      page_id: buildPageId(classification.product, info.version, info.slug),
      product: classification.product,
      kind: classification.kind,
      source: 'antora',
      version: info.version,
      title,
      section: info.section,
      slug: info.slug,
      url: pageUrl,
      canonical_url: canonicalUrl,
      breadcrumbs,
      summary,
      content,
      keywords: buildKeywords(keywordSource),
      method,
      api_path: apiPath,
    } satisfies DocPage;
  });

  return {
    productPages: pages.filter((page) => page.kind === 'product'),
    apiPages: pages.filter((page) => page.kind === 'api'),
    companionPages: pages.filter((page) => page.kind === 'companion'),
  };
}

function parseAnsibleSearchIndex(script: string): {
  docnames: string[];
  titles: string[];
} {
  let payload:
    | {
        docnames?: string[];
        titles?: string[];
      }
    | undefined;

  const sandbox = {
    Search: {
      setIndex(value: unknown) {
        payload = value as { docnames?: string[]; titles?: string[] };
      },
    },
  };

  vm.runInNewContext(script, sandbox, { timeout: 5000 });

  return {
    docnames: payload?.docnames ?? [],
    titles: payload?.titles ?? [],
  };
}

async function collectAnsiblePages(): Promise<DocPage[]> {
  const indexHtml = await fetchText(`${ANSIBLE_ROOT}/`);
  const version =
    extractFirstMatch(indexHtml, /version ([0-9]+\.[0-9]+\.[0-9]+)/i) ??
    'unknown';
  const searchIndex = parseAnsibleSearchIndex(
    await fetchText(`${ANSIBLE_ROOT}/searchindex.js`),
  );

  const pages = await mapWithConcurrency(
    searchIndex.docnames,
    6,
    async (docname, index) => {
      const url =
        docname === 'index'
          ? `${ANSIBLE_ROOT}/`
          : `${ANSIBLE_ROOT}/${docname}.html`;
      const html = await fetchText(url);
      const title = searchIndex.titles[index] ?? extractTitle(html);
      const content = stripTags(extractSphinxArticle(html));
      const breadcrumbs = extractBreadcrumbs(html);
      const slug = docname.replace(/\.html$/, '');
      const section = slug.includes('/') ? slug.split('/')[0]! : 'overview';

      return {
        page_id: buildPageId('horizon-ansible', version, slug),
        product: 'horizon-ansible',
        kind: 'companion',
        source: 'sphinx',
        version,
        title,
        section,
        slug,
        url,
        canonical_url: url,
        breadcrumbs,
        summary: extractSummary(content),
        content,
        keywords: buildKeywords([title, section, slug, ...breadcrumbs]),
      } satisfies DocPage;
    },
  );

  return pages;
}

async function collectTerraformPages(): Promise<DocPage[]> {
  const response = await fetch(TERRAFORM_PROVIDER_API);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Terraform provider metadata: ${response.status}`,
    );
  }

  const provider = (await response.json()) as {
    docs?: Array<{
      category?: string;
      path?: string;
      slug?: string;
      title?: string;
    }>;
    source?: string;
    tag?: string;
    version?: string;
  };

  const version = provider.version ?? 'unknown';
  const tag = provider.tag ?? `v${version}`;
  const source =
    provider.source ??
    'https://github.com/EverTrust/terraform-provider-horizon';
  const rawPrefix = source
    .replace('https://github.com/', 'https://raw.githubusercontent.com/')
    .replace(/\/+$/, '');

  return mapWithConcurrency(provider.docs ?? [], 4, async (doc) => {
    const rawPath = doc.path ?? '';
    const rawUrl = `${rawPrefix}/${tag}/${rawPath}`;
    const markdown = await fetchText(rawUrl);
    const pageTitle =
      extractFrontMatterValue(markdown, 'page_title')?.replace(
        /\s+-\s+terraform-provider-horizon$/i,
        '',
      ) ?? doc.title;
    const title =
      pageTitle ?? extractMarkdownTitle(markdown) ?? 'Terraform provider';
    const slug =
      doc.slug ?? rawPath.replace(/^docs\//, '').replace(/\.md$/, '');
    const section = doc.category ?? 'overview';
    const url =
      slug === 'overview' || slug === 'index'
        ? 'https://registry.terraform.io/providers/EverTrust/horizon/latest/docs'
        : `https://registry.terraform.io/providers/EverTrust/horizon/latest/docs/${slug}`;

    return {
      page_id: buildPageId('terraform-provider-horizon', version, slug),
      product: 'terraform-provider-horizon',
      kind: 'companion',
      source: 'terraform-registry',
      version,
      title,
      section,
      slug,
      url,
      canonical_url: url,
      breadcrumbs: ['Terraform Provider', section, title],
      summary: extractSummary(cleanMarkdownContent(markdown)),
      content: cleanMarkdownContent(markdown),
      keywords: buildKeywords([
        title,
        section,
        slug,
        doc.title ?? '',
        pageTitle ?? '',
      ]),
    } satisfies DocPage;
  });
}

export async function buildDocsArtifacts(): Promise<{
  productCatalog: DocPageCatalog;
  apiCatalog: DocPageCatalog;
  companionCatalog: DocPageCatalog;
  versionCatalog: DocVersionCatalog;
}> {
  const generatedAt = new Date().toISOString();
  const antora = await collectAntoraPages();
  const ansiblePages = await collectAnsiblePages();
  const terraformPages = await collectTerraformPages();
  const companionPages = [
    ...antora.companionPages,
    ...ansiblePages,
    ...terraformPages,
  ].sort((left, right) => left.page_id.localeCompare(right.page_id));
  const productPages = [...antora.productPages].sort((left, right) =>
    left.page_id.localeCompare(right.page_id),
  );
  const apiPages = [...antora.apiPages].sort((left, right) =>
    left.page_id.localeCompare(right.page_id),
  );

  return {
    productCatalog: {
      generatedAt,
      pageCount: productPages.length,
      pages: productPages,
    },
    apiCatalog: {
      generatedAt,
      pageCount: apiPages.length,
      pages: apiPages,
    },
    companionCatalog: {
      generatedAt,
      pageCount: companionPages.length,
      pages: companionPages,
    },
    versionCatalog: buildDocVersionCatalog(
      productPages,
      apiPages,
      companionPages,
    ),
  };
}

export async function writeDocsArtifacts(): Promise<void> {
  const artifacts = await buildDocsArtifacts();
  writeJson(
    join(OUTPUT_DIR, 'product-doc-pages.json'),
    artifacts.productCatalog,
  );
  writeJson(join(OUTPUT_DIR, 'api-doc-pages.json'), artifacts.apiCatalog);
  writeJson(
    join(OUTPUT_DIR, 'companion-doc-pages.json'),
    artifacts.companionCatalog,
  );
  writeJson(join(OUTPUT_DIR, 'doc-versions.json'), artifacts.versionCatalog);
}

function normalizeArtifact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeArtifact(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === 'generatedAt' ? '<generatedAt>' : normalizeArtifact(entry),
      ]),
    );
  }
  return value;
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeArtifact(left)) ===
    JSON.stringify(normalizeArtifact(right))
  );
}

export async function diffDocsArtifacts(): Promise<string[]> {
  const artifacts = await buildDocsArtifacts();
  const expected: Array<[string, unknown]> = [
    ['product-doc-pages.json', artifacts.productCatalog],
    ['api-doc-pages.json', artifacts.apiCatalog],
    ['companion-doc-pages.json', artifacts.companionCatalog],
    ['doc-versions.json', artifacts.versionCatalog],
  ];

  const diffs: string[] = [];
  for (const [filename, generated] of expected) {
    const path = join(OUTPUT_DIR, filename);
    let existing: unknown;
    try {
      existing = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
      diffs.push(`${filename}: missing`);
      continue;
    }

    if (!jsonEquals(existing, generated)) {
      diffs.push(`${filename}: differs`);
    }
  }

  return diffs;
}
