import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../client/http.js';
import {
  API_DOC_PAGES,
  COMPANION_DOC_PAGES,
  PRODUCT_DOC_PAGES,
  getDocPageById,
  getLatestIndexedVersion,
} from '../docs/catalog.js';
import { searchDocPages } from '../docs/search.js';
import type { DocPage, DocProduct } from '../docs/types.js';
import { resolveDocVersion } from '../docs/versioning.js';
import {
  getKnowledgeSectionSlugs,
  getKnowledgeTopicSlugs,
  resolveKnowledge,
} from '../resources/catalog.js';
import { registerTool } from './register.js';

const SEARCH_MAX_RESULTS = 10;
const NON_API_PRODUCTS: DocProduct[] = [
  'horizon',
  'adcs-connector',
  'horizon-cli',
  'horizon-issuer',
  'winhorizon',
  'horizon-ansible',
  'terraform-provider-horizon',
];

const PRODUCT_ALIASES: Record<string, DocProduct> = {
  adcs: 'adcs-connector',
  'adcs-connector': 'adcs-connector',
  ansible: 'horizon-ansible',
  'horizon-ansible': 'horizon-ansible',
  'horizon ansible': 'horizon-ansible',
  horizon: 'horizon',
  'horizon-cli': 'horizon-cli',
  issuer: 'horizon-issuer',
  'horizon-issuer': 'horizon-issuer',
  terraform: 'terraform-provider-horizon',
  'terraform-provider-horizon': 'terraform-provider-horizon',
  winhorizon: 'winhorizon',
};

const SEARCH_DOCS_CONFIG = {
  description:
    'Search the indexed product documentation for Horizon, ADCS Connector, Horizon CLI, Horizon Issuer, WinHorizon, the Horizon Ansible collection, and the Horizon Terraform provider.\n\n' +
    'Use when: the user asks how to install, configure, integrate, troubleshoot, or operate one of those products. Call this first, then call get_doc_page with one of the returned page_id values. Do not invent page IDs.\n\n' +
    'Do not use when: the user asks about HTTP endpoints, request payloads, response payloads, or route semantics. Use search_api_docs for API-reference questions instead.\n\n' +
    'For Horizon docs, the tool resolves the connected instance version from the live Horizon API when possible. If the configured user cannot read that version, the tool returns a warning and falls back to the latest indexed Horizon docs.',
  inputSchema: z.object({
    query: z.string().describe('What documentation you need to find.'),
    product: z
      .string()
      .optional()
      .describe(
        'Optional product filter. Supported values: horizon, adcs-connector, horizon-cli, horizon-issuer, winhorizon, horizon-ansible, terraform-provider-horizon.',
      ),
    version: z
      .string()
      .optional()
      .describe(
        'Optional explicit docs version. Only set this when the user explicitly requests a specific version.',
      ),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(SEARCH_MAX_RESULTS)
      .default(5)
      .describe('Maximum number of results to return (1-10).'),
  }),
};

const SEARCH_API_DOCS_CONFIG = {
  description:
    'Search the indexed Horizon API reference and return exact API reference pages with the HTTP method and route.\n\n' +
    'Use when: the user asks about endpoints, HTTP methods, request or response payloads, fields, authentication, or route semantics. Call this first, then call get_doc_page with one of the returned page_id values. Do not invent page IDs.\n\n' +
    'Do not use when: the user asks about product installation, configuration walkthroughs, or operational guidance. Use search_docs for product documentation instead.\n\n' +
    'The tool resolves the connected Horizon version from the live Horizon API when possible. If the configured user cannot read that version, the tool returns a warning and falls back to the latest indexed Horizon API docs.',
  inputSchema: z.object({
    query: z.string().describe('What Horizon API reference page you need.'),
    version: z
      .string()
      .optional()
      .describe(
        'Optional explicit Horizon API docs version. Only set this when the user explicitly asks for one.',
      ),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(SEARCH_MAX_RESULTS)
      .default(5)
      .describe('Maximum number of results to return (1-10).'),
  }),
};

const GET_DOC_PAGE_CONFIG = {
  description:
    'Return the indexed content of a specific documentation page.\n\n' +
    'Always call search_docs or search_api_docs first and pass one of their page_id values here. Do not guess or fabricate page IDs. If the page is not the one you need, go back to search and refine the query instead of guessing another page_id.\n\n' +
    'Long pages are returned in windows bounded by max_chars. When the content exceeds the window the response carries a truncation notice with total_chars and next_offset; call the tool again with that offset to continue.',
  inputSchema: z.object({
    page_id: z
      .string()
      .describe('Exact page_id returned by search_docs or search_api_docs.'),
    max_chars: z
      .number()
      .int()
      .positive()
      .max(50000)
      .default(20000)
      .describe(
        'Maximum number of content characters to return in this window (1-50000, default 20000).',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Character offset into the page content to start from. Use next_offset from a prior truncated response to continue.',
      ),
  }),
};

const READ_KNOWLEDGE_CONFIG = {
  description:
    'Return the embedded Horizon knowledge base content for a topic as tool output.\n\n' +
    'Use when: a horizon://knowledge/* resource is referenced but the client cannot read MCP resources. This exposes the same guidance (server rules, query languages, workflows, integration recipes, ...) through a tool call instead.\n\n' +
    'Pass a topic slug (the segment after horizon://knowledge/). Optionally pass a section slug to fetch a single section of a long topic. Call with no valid topic to get the list of valid topics in the error.\n\n' +
    'Long topics are returned in windows bounded by max_chars. When the content exceeds the window the response carries a truncation notice with total_chars and next_offset; call again with that offset to continue.',
  inputSchema: z.object({
    topic: z
      .string()
      .describe(
        'Knowledge topic slug, e.g. server-rules, query-languages, tool-selection. This is the segment after horizon://knowledge/.',
      ),
    section: z
      .string()
      .optional()
      .describe(
        'Optional section slug within the topic (only some topics are split into sections).',
      ),
    max_chars: z
      .number()
      .int()
      .positive()
      .max(50000)
      .default(20000)
      .describe(
        'Maximum number of content characters to return in this window (1-50000, default 20000).',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Character offset into the content to start from. Use next_offset from a prior truncated response to continue.',
      ),
  }),
};

function normalizeProduct(input?: string): DocProduct | undefined {
  if (!input) {
    return undefined;
  }
  return PRODUCT_ALIASES[input.trim().toLowerCase()];
}

function selectProductPages(
  product?: DocProduct,
  resolvedHorizonVersion?: string,
): DocPage[] {
  const horizonPages = resolvedHorizonVersion
    ? PRODUCT_DOC_PAGES.filter(
        (page) =>
          page.product === 'horizon' && page.version === resolvedHorizonVersion,
      )
    : PRODUCT_DOC_PAGES.filter((page) => page.product === 'horizon');

  const otherProductPages = PRODUCT_DOC_PAGES.filter((page) => {
    if (page.product === 'horizon') {
      return false;
    }
    if (product) {
      return true;
    }
    return page.version === getLatestIndexedVersion(page.product);
  });

  const companionPages = COMPANION_DOC_PAGES.filter((page) => {
    if (product) {
      return true;
    }
    return page.version === getLatestIndexedVersion(page.product);
  });

  const pages = [...horizonPages, ...otherProductPages, ...companionPages];

  return product ? pages.filter((page) => page.product === product) : pages;
}

type ContentTruncation =
  | {
      truncated: true;
      total_chars: number;
      offset: number;
      returned_chars: number;
      next_offset: number;
    }
  | { truncated: false; total_chars: number };

/**
 * Window long content by `maxChars` starting at `offset`, returning the slice
 * plus a truncation notice with `next_offset` for continuation. Shared by
 * get_doc_page and read_knowledge.
 */
function windowContent(
  full: string,
  offset: number,
  maxChars: number,
): { content: string; truncation: ContentTruncation } {
  const totalChars = full.length;
  const content = full.slice(offset, offset + maxChars);
  const endOffset = offset + content.length;
  const truncated = endOffset < totalChars;

  return {
    content,
    truncation: truncated
      ? {
          truncated: true,
          total_chars: totalChars,
          offset,
          returned_chars: content.length,
          next_offset: endOffset,
        }
      : { truncated: false, total_chars: totalChars },
  };
}

function buildDocPageContent(page: DocPage): string {
  const sections = [
    page.method && page.api_path ? `${page.method} ${page.api_path}` : null,
    page.title,
    page.summary,
    page.content,
  ].filter((section): section is string => Boolean(section && section.trim()));

  return sections.join('\n\n');
}

export function registerDocsTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'search_docs',
    SEARCH_DOCS_CONFIG,
    async ({ query, product, version, max_results }) => {
      const normalizedProduct = normalizeProduct(product);
      if (product && !normalizedProduct) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Unknown product '${product}'.`,
                supported_products: NON_API_PRODUCTS,
              }),
            },
          ],
        };
      }

      if (normalizedProduct === 'horizon-api') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  'Use search_api_docs for Horizon API reference questions. search_docs is only for product documentation.',
              }),
            },
          ],
        };
      }

      const horizonVersion = await resolveDocVersion({
        client,
        product: 'horizon',
        requestedVersion: normalizedProduct === 'horizon' ? version : undefined,
      });
      const productVersion =
        normalizedProduct && normalizedProduct !== 'horizon'
          ? await resolveDocVersion({
              client,
              product: normalizedProduct,
              requestedVersion: version,
            })
          : undefined;

      const pages = selectProductPages(
        normalizedProduct,
        horizonVersion.version,
      );
      const versionFilter =
        normalizedProduct === 'horizon'
          ? horizonVersion.version
          : normalizedProduct
            ? productVersion?.version
            : undefined;

      const results = searchDocPages({
        pages,
        query,
        product: normalizedProduct,
        version: versionFilter,
        maxResults: max_results,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              query,
              product: normalizedProduct ?? null,
              resolved_horizon_version: horizonVersion.version,
              horizon_resolution_source: horizonVersion.resolution_source,
              horizon_version_confidence: horizonVersion.confidence,
              horizon_warning: horizonVersion.warning,
              resolved_product_version: productVersion?.version ?? null,
              product_resolution_source:
                productVersion?.resolution_source ?? null,
              product_version_confidence: productVersion?.confidence ?? null,
              product_warning: productVersion?.warning,
              hint:
                results.length === 0
                  ? 'No matching product documentation page found. Refine the query or set the product filter before trying again.'
                  : 'Call get_doc_page with one of the returned page_id values.',
              results,
            }),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'search_api_docs',
    SEARCH_API_DOCS_CONFIG,
    async ({ query, version, max_results }) => {
      const resolved = await resolveDocVersion({
        client,
        product: 'horizon-api',
        requestedVersion: version,
      });

      const results = searchDocPages({
        pages: API_DOC_PAGES,
        query,
        product: 'horizon-api',
        version: resolved.version,
        maxResults: max_results,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              query,
              product: 'horizon-api',
              resolved_version: resolved.version,
              resolution_source: resolved.resolution_source,
              version_confidence: resolved.confidence,
              warning: resolved.warning,
              hint:
                results.length === 0
                  ? 'No matching API reference page found. Refine the endpoint or operation wording before trying again.'
                  : 'Call get_doc_page with one of the returned page_id values.',
              results,
            }),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'get_doc_page',
    GET_DOC_PAGE_CONFIG,
    async ({ page_id, max_chars, offset }) => {
      const page = getDocPageById(page_id);
      if (!page) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Unknown page_id '${page_id}'. Call search_docs or search_api_docs first and reuse one of the returned page_id values.`,
              }),
            },
          ],
        };
      }

      const fullContent = buildDocPageContent(page);
      const { content, truncation } = windowContent(
        fullContent,
        offset,
        max_chars,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              page_id: page.page_id,
              product: page.product,
              kind: page.kind,
              version: page.version,
              title: page.title,
              section: page.section,
              url: page.url,
              breadcrumbs: page.breadcrumbs,
              summary: page.summary,
              method: page.method,
              path: page.api_path,
              content,
              truncation,
            }),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'read_knowledge',
    READ_KNOWLEDGE_CONFIG,
    async ({ topic, section, max_chars, offset }) => {
      const resource = resolveKnowledge(topic, section);
      if (!resource) {
        const validTopics = getKnowledgeTopicSlugs();
        const error = section
          ? `Unknown section '${section}' for topic '${topic}'.`
          : `Unknown knowledge topic '${topic}'.`;
        const sections = getKnowledgeSectionSlugs(topic);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error,
                valid_topics: validTopics,
                ...(section && sections.length > 0
                  ? { valid_sections: sections }
                  : {}),
              }),
            },
          ],
        };
      }

      const { content, truncation } = windowContent(
        resource.content,
        offset,
        max_chars,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              topic,
              section: section ?? null,
              uri: resource.uri,
              description: resource.description,
              content,
              truncation,
            }),
          },
        ],
      };
    },
  );
}
