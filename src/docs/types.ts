export const DOC_PRODUCTS = [
  'horizon',
  'horizon-api',
  'adcs-connector',
  'horizon-cli',
  'horizon-issuer',
  'winhorizon',
  'horizon-ansible',
  'terraform-provider-horizon',
] as const;

export type DocProduct = (typeof DOC_PRODUCTS)[number];

export type DocKind = 'product' | 'api' | 'companion';
export type DocSource = 'antora' | 'sphinx' | 'terraform-registry';

export interface DocPage {
  page_id: string;
  product: DocProduct;
  kind: DocKind;
  source: DocSource;
  version: string;
  title: string;
  section: string;
  slug: string;
  url: string;
  canonical_url: string;
  breadcrumbs: string[];
  summary: string;
  content: string;
  keywords: string[];
  method?: string;
  api_path?: string;
}

export interface DocPageCatalog {
  generatedAt: string;
  pageCount: number;
  pages: DocPage[];
}

export interface DocVersionEntry {
  product: DocProduct;
  latest: string;
  versions: string[];
  defaultPolicy: 'connected-instance' | 'latest-indexed';
  provenance: string;
}

export interface DocVersionCatalog {
  generatedAt: string;
  products: Record<string, DocVersionEntry>;
}

export interface ResolvedDocVersion {
  product: DocProduct;
  version: string;
  resolution_source:
    | 'explicit'
    | 'license_info'
    | 'client_state'
    | 'whoami'
    | 'latest_indexed_fallback';
  confidence: 'explicit' | 'official' | 'undocumented' | 'fallback';
  fallback: boolean;
  warning?: string;
}

export interface DocSearchResult {
  page_id: string;
  title: string;
  product: DocProduct;
  version: string;
  section: string;
  url: string;
  snippet: string;
  breadcrumbs: string[];
  method?: string;
  path?: string;
  score: number;
}
