import apiCatalogJson from '../generated/docs/api-doc-pages.json';
import companionCatalogJson from '../generated/docs/companion-doc-pages.json';
import versionsJson from '../generated/docs/doc-versions.json';
import productCatalogJson from '../generated/docs/product-doc-pages.json';
import type {
  DocPage,
  DocPageCatalog,
  DocProduct,
  DocVersionCatalog,
} from './types.js';

const PRODUCT_CATALOG = productCatalogJson as DocPageCatalog;
const API_CATALOG = apiCatalogJson as DocPageCatalog;
const COMPANION_CATALOG = companionCatalogJson as DocPageCatalog;
const VERSION_CATALOG = versionsJson as DocVersionCatalog;

export const PRODUCT_DOC_PAGES: DocPage[] = PRODUCT_CATALOG.pages;
export const API_DOC_PAGES: DocPage[] = API_CATALOG.pages;
export const COMPANION_DOC_PAGES: DocPage[] = COMPANION_CATALOG.pages;
export const DOC_VERSION_CATALOG = VERSION_CATALOG;

const ALL_DOC_PAGES = [
  ...PRODUCT_DOC_PAGES,
  ...API_DOC_PAGES,
  ...COMPANION_DOC_PAGES,
];

const PAGE_BY_ID = new Map(ALL_DOC_PAGES.map((page) => [page.page_id, page]));

export function getAllDocPages(): DocPage[] {
  return ALL_DOC_PAGES;
}

export function getDocPageById(pageId: string): DocPage | undefined {
  return PAGE_BY_ID.get(pageId);
}

export function getDocPagesForProducts(
  products: readonly DocProduct[],
): DocPage[] {
  const allowed = new Set(products);
  return ALL_DOC_PAGES.filter((page) => allowed.has(page.product));
}

export function getAvailableVersions(product: DocProduct): string[] {
  const entry = DOC_VERSION_CATALOG.products[product];
  return entry?.versions ?? [];
}

export function getLatestIndexedVersion(
  product: DocProduct,
): string | undefined {
  return DOC_VERSION_CATALOG.products[product]?.latest;
}
