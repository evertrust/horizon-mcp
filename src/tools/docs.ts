import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
    {
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
    },
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
    {
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
    },
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
    {
      description:
        'Return the full indexed content of a specific documentation page.\n\n' +
        'Always call search_docs or search_api_docs first and pass one of their page_id values here. Do not guess or fabricate page IDs. If the page is not the one you need, go back to search and refine the query instead of guessing another page_id.',
      inputSchema: z.object({
        page_id: z
          .string()
          .describe(
            'Exact page_id returned by search_docs or search_api_docs.',
          ),
      }),
    },
    async ({ page_id }) => {
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
              content: buildDocPageContent(page),
            }),
          },
        ],
      };
    },
  );
}
