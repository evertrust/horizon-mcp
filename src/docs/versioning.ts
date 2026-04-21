import { HorizonError } from '../client/errors.js';
import type { HorizonClient } from '../client/http.js';
import { DOC_VERSION_CATALOG, getLatestIndexedVersion } from './catalog.js';
import type { DocProduct, ResolvedDocVersion } from './types.js';

const HORIZON_PRODUCTS = new Set<DocProduct>(['horizon', 'horizon-api']);

function parseVersionParts(version: string): number[] {
  return version
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .filter((segment) => Number.isFinite(segment));
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
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

function normalizeVersion(version: string): string {
  const match = version.trim().match(/^(\d+\.\d+)/);
  return match?.[1] ?? version.trim();
}

function bestMatchingIndexedVersion(
  product: DocProduct,
  version: string,
  options?: { allowLatestFallback?: boolean },
): string | undefined {
  const available = [
    ...(DOC_VERSION_CATALOG.products[product]?.versions ?? []),
  ];
  if (available.includes(version)) {
    return version;
  }

  const normalized = normalizeVersion(version);
  const exactNormalized = available.find(
    (candidate) => normalizeVersion(candidate) === normalized,
  );
  if (exactNormalized) {
    return exactNormalized;
  }

  if (options?.allowLatestFallback === false) {
    return undefined;
  }

  const latest = [...available].sort(compareVersions).at(-1);
  return latest;
}

function buildResolvedVersion(params: {
  product: DocProduct;
  rawVersion: string;
  matchedVersion: string;
  resolution_source: ResolvedDocVersion['resolution_source'];
  confidence: ResolvedDocVersion['confidence'];
}): ResolvedDocVersion {
  const normalizedRaw = normalizeVersion(params.rawVersion);
  const warning =
    params.rawVersion === params.matchedVersion &&
    normalizedRaw === params.matchedVersion
      ? undefined
      : `Resolved ${params.product} docs version '${params.matchedVersion}' from instance version '${params.rawVersion}'.`;

  return {
    product: params.product,
    version: params.matchedVersion,
    resolution_source: params.resolution_source,
    confidence: params.confidence,
    fallback: false,
    warning,
  };
}

async function resolveInstanceVersionFromLicense(
  client: HorizonClient,
): Promise<string | undefined> {
  try {
    const license =
      await client.get<Record<string, unknown>>('/api/v1/licenses');
    const version = license['version'];
    return typeof version === 'string' ? version : undefined;
  } catch (error) {
    if (
      error instanceof HorizonError &&
      (error.statusCode === 401 || error.statusCode === 403)
    ) {
      return undefined;
    }
    return undefined;
  }
}

async function resolveInstanceVersionFromWhoami(
  client: HorizonClient,
): Promise<string | undefined> {
  try {
    const principal = await client.get<Record<string, unknown>>(
      '/api/v1/security/principals/self',
    );
    const version = principal['_horizonVersion'];
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveDocVersion(params: {
  client: HorizonClient;
  product: DocProduct;
  requestedVersion?: string;
}): Promise<ResolvedDocVersion> {
  const latest = getLatestIndexedVersion(params.product);
  if (!latest) {
    throw new Error(`No indexed documentation available for ${params.product}`);
  }

  if (params.requestedVersion) {
    const explicit = bestMatchingIndexedVersion(
      params.product,
      params.requestedVersion,
      { allowLatestFallback: false },
    );
    return {
      product: params.product,
      version: explicit ?? latest,
      resolution_source: 'explicit',
      confidence: 'explicit',
      fallback: explicit === undefined,
      warning:
        explicit === undefined
          ? `Requested version '${params.requestedVersion}' is not indexed for ${params.product}; using latest indexed version '${latest}'.`
          : undefined,
    };
  }

  if (!HORIZON_PRODUCTS.has(params.product)) {
    return {
      product: params.product,
      version: latest,
      resolution_source: 'latest_indexed_fallback',
      confidence: 'official',
      fallback: false,
    };
  }

  const licenseVersion = await resolveInstanceVersionFromLicense(params.client);
  if (licenseVersion) {
    const matchedVersion =
      bestMatchingIndexedVersion(params.product, licenseVersion) ?? latest;
    return buildResolvedVersion({
      product: params.product,
      rawVersion: licenseVersion,
      matchedVersion,
      resolution_source: 'license_info',
      confidence: 'official',
    });
  }

  if (params.client.horizonVersion) {
    const matchedVersion =
      bestMatchingIndexedVersion(
        params.product,
        params.client.horizonVersion,
      ) ?? latest;
    return {
      ...buildResolvedVersion({
        product: params.product,
        rawVersion: params.client.horizonVersion,
        matchedVersion,
        resolution_source: 'client_state',
        confidence: 'undocumented',
      }),
      warning:
        `Resolved ${params.product} docs version '${matchedVersion}' from the client's cached Horizon version. ` +
        'That cached value originates from the undocumented `_horizonVersion` field on `/api/v1/security/principals/self`.',
    };
  }

  const whoamiVersion = await resolveInstanceVersionFromWhoami(params.client);
  if (whoamiVersion) {
    const matchedVersion =
      bestMatchingIndexedVersion(params.product, whoamiVersion) ?? latest;
    return {
      ...buildResolvedVersion({
        product: params.product,
        rawVersion: whoamiVersion,
        matchedVersion,
        resolution_source: 'whoami',
        confidence: 'undocumented',
      }),
      warning:
        `Resolved ${params.product} docs version '${matchedVersion}' from the undocumented _horizonVersion field on /api/v1/security/principals/self. ` +
        'Confirm the target Horizon version manually if precise version matching matters.',
    };
  }

  return {
    product: params.product,
    version: latest,
    resolution_source: 'latest_indexed_fallback',
    confidence: 'fallback',
    fallback: true,
    warning:
      'Could not resolve the connected Horizon version from the instance, usually because the configured user cannot read `/api/v1/licenses` and `/api/v1/security/principals/self` did not expose `_horizonVersion`. Falling back to the latest indexed Horizon docs.',
  };
}
