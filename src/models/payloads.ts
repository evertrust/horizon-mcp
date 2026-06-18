import { HorizonError } from '../client/errors.js';
import type { HorizonClient } from '../client/http.js';
import { getLogger } from '../logging.js';

const logger = getLogger('horizon_mcp.payloads');

// ---------------------------------------------------------------------------
// STRIP_FIELDS - server-populated fields to remove per domain
// ---------------------------------------------------------------------------

export const STRIP_FIELDS: Record<string, ReadonlySet<string>> = {
  profile: new Set([
    '_id',
    'id',
    'createdAt',
    'updatedAt',
    'lastModifiedBy',
    'statistics',
    'status',
    'certificateCount',
  ]),
  ca: new Set([
    '_id',
    'id',
    'createdAt',
    'updatedAt',
    'certificate',
    'crlCache',
    'statistics',
  ]),
  connector: new Set([
    '_id',
    'id',
    'createdAt',
    'updatedAt',
    'status',
    'lastSync',
  ]),
  trigger: new Set([
    '_id',
    'id',
    'createdAt',
    'updatedAt',
    'lastRun',
    'statistics',
  ]),
  label: new Set(['_id', 'id', 'createdAt', 'updatedAt']),
  proxy: new Set(['_id', 'id', 'createdAt', 'updatedAt']),
  datasource: new Set(['_id', 'id', 'createdAt', 'updatedAt', 'lastTest']),
  role: new Set(['_id', 'id', 'createdAt', 'updatedAt']),
  team: new Set([
    '_id',
    'id',
    'createdAt',
    'updatedAt',
    'statistics',
    'memberCount',
  ]),
  idp: new Set(['_id', 'id', 'createdAt', 'updatedAt']),
  grading_policy: new Set(['_id', 'id', 'createdAt', 'updatedAt']),
  grading_ruleset: new Set(['_id', 'id', 'createdAt', 'updatedAt']),
  password_policy: new Set(['_id', 'id', 'createdAt', 'updatedAt']),
  principal: new Set(['_id', 'id', 'createdAt', 'updatedAt', 'lastLogin']),
  discovery_campaign: new Set(['_id']),
  automation_policy: new Set(['_id']),
  execution_policy: new Set(['_id']),
  wcce_forest: new Set(['_id']),
  local_identity: new Set(['_id', 'hash', 'resetUUID', 'resetExpiration']),
  scheduled_task: new Set(['_id']),
};

export const BASELINE_STRIP = new Set(['_id', 'id', 'createdAt', 'updatedAt']);

export const MAX_PREFLIGHT_CALLS = 5;

// ---------------------------------------------------------------------------
// toUpdatePayload - merge logic
// ---------------------------------------------------------------------------

export function toUpdatePayload(
  response: Record<string, unknown>,
  opts: {
    overrides?: Record<string, unknown>;
    clearFields?: string[];
    domain?: string;
  } = {},
): Record<string, unknown> {
  const strip = STRIP_FIELDS[opts.domain ?? 'profile'] ?? BASELINE_STRIP;

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(response)) {
    if (!strip.has(k)) {
      payload[k] = v;
    }
  }

  for (const field of opts.clearFields ?? []) {
    payload[field] = null;
  }

  for (const [key, value] of Object.entries(opts.overrides ?? {})) {
    if (value !== undefined && value !== null) {
      payload[key] = value;
    }
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Dependency extractors
// ---------------------------------------------------------------------------

type DepTuple = [name: string, path: string];

export function extractPkiConnector(value: unknown): DepTuple[] {
  if (typeof value === 'string' && value) {
    return [[value, `/api/v1/pki/connectors/${encodeURIComponent(value)}`]];
  }
  return [];
}

export function extractCredential(value: unknown): DepTuple[] {
  const names: string[] = [];
  if (typeof value === 'string' && value) {
    names.push(value);
  } else if (Array.isArray(value)) {
    for (const n of value) {
      if (typeof n === 'string' && n) names.push(n);
    }
  }
  return names.map((n) => [
    n,
    `/api/v1/security/credentials/${encodeURIComponent(n)}`,
  ]);
}

export function extractTriggersFromHooks(value: unknown): DepTuple[] {
  if (typeof value !== 'object' || value === null) return [];
  const names = new Set<string>();
  for (const hookList of Object.values(value as Record<string, unknown>)) {
    if (!Array.isArray(hookList)) continue;
    for (const entry of hookList) {
      if (typeof entry === 'string' && entry) {
        names.add(entry);
      } else if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>)['name'] === 'string'
      ) {
        names.add((entry as Record<string, unknown>)['name'] as string);
      }
    }
  }
  return [...names]
    .sort()
    .map((n) => [n, `/api/v1/triggers/${encodeURIComponent(n)}`]);
}

export function extractGradingPolicies(value: unknown): DepTuple[] {
  const names: string[] = [];
  if (typeof value === 'string' && value) {
    names.push(value);
  } else if (Array.isArray(value)) {
    for (const n of value) {
      if (typeof n === 'string' && n) names.push(n);
    }
  }
  return names.map((n) => [
    n,
    `/api/v1/certificate/grading/policies/${encodeURIComponent(n)}`,
  ]);
}

export function extractDatasourceFlow(value: unknown): DepTuple[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'object' && entry !== null) {
      const e = entry as Record<string, unknown>;
      const ds =
        (e['ds'] as string | undefined) ??
        (e['datasource'] as string | undefined);
      if (ds) names.push(ds);
    }
  }
  return names.map((n) => [n, `/api/v1/datasources/${encodeURIComponent(n)}`]);
}

export function extractIdentityProvider(value: unknown): DepTuple[] {
  const names: string[] = [];
  if (typeof value === 'string' && value) {
    names.push(value);
  } else if (Array.isArray(value)) {
    for (const n of value) {
      if (typeof n === 'string' && n) names.push(n);
    }
  }
  return names.map((n) => [
    n,
    `/api/v1/security/identity/providers/${encodeURIComponent(n)}`,
  ]);
}

export const DEP_CHECKS: Array<{
  key: string;
  extractor: (value: unknown) => DepTuple[];
  hint: string;
}> = [
  {
    key: 'credential',
    extractor: extractCredential,
    hint: 'Credentials must be created outside this MCP server.',
  },
  {
    key: 'credentials',
    extractor: extractCredential,
    hint: 'Credentials must be created outside this MCP server.',
  },
  {
    key: 'pkiConnector',
    extractor: extractPkiConnector,
    hint: 'Create the PKI connector first via the connector management tools.',
  },
  {
    key: 'triggerHooks',
    extractor: extractTriggersFromHooks,
    hint: 'Create the referenced trigger first.',
  },
  {
    key: 'gradingPolicies',
    extractor: extractGradingPolicies,
    hint: 'Create the grading policy first.',
  },
  {
    key: 'gradingPolicy',
    extractor: extractGradingPolicies,
    hint: 'Create the grading policy first.',
  },
  {
    key: 'dsFlow',
    extractor: extractDatasourceFlow,
    hint: 'Create the referenced datasource first.',
  },
  {
    key: 'identityProvider',
    extractor: extractIdentityProvider,
    hint: 'Create the identity provider first.',
  },
  {
    key: 'identityProviders',
    extractor: extractIdentityProvider,
    hint: 'Create the identity provider first.',
  },
];

// ---------------------------------------------------------------------------
// preflightDeps - best-effort dependency validation
// ---------------------------------------------------------------------------

export async function checkOne(
  client: HorizonClient,
  name: string,
  path: string,
  hint: string,
): Promise<string | null> {
  try {
    await client.get(path);
  } catch (err) {
    if (err instanceof HorizonError) {
      if (err.statusCode === 404) {
        throw new HorizonError(422, {
          errorCode: 'PREFLIGHT-DEP',
          message: `Dependency not found: '${name}' (checked ${path}).`,
          remediation: hint,
        });
      }
      return `Could not verify dependency '${name}' (${err.statusCode}): ${err.message}`;
    }
    return `Could not verify dependency '${name}': ${err}`;
  }
  return null;
}

export async function preflightDeps(
  client: HorizonClient,
  payload: Record<string, unknown>,
  domain: string,
): Promise<string[]> {
  const checks: Array<{ name: string; path: string; hint: string }> = [];

  for (const { key, extractor, hint } of DEP_CHECKS) {
    const value = payload[key];
    if (value === undefined || value === null) continue;
    for (const [name, path] of extractor(value)) {
      checks.push({ name, path, hint });
      if (checks.length >= MAX_PREFLIGHT_CALLS) break;
    }
    if (checks.length >= MAX_PREFLIGHT_CALLS) break;
  }

  if (checks.length === 0) return [];

  logger.debug(
    `Preflight: ${checks.length} dependency check(s) for domain '${domain}'`,
  );

  const results = await Promise.allSettled(
    checks.map((c) => checkOne(client, c.name, c.path, c.hint)),
  );

  const warnings: string[] = [];
  for (const result of results) {
    if (result.status === 'rejected') {
      if (result.reason instanceof HorizonError) throw result.reason;
      warnings.push(`Preflight check failed unexpectedly: ${result.reason}`);
    } else if (result.value !== null) {
      warnings.push(result.value);
    }
  }

  return warnings;
}
