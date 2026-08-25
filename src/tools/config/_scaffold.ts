/**
 * Shared scaffolding for Horizon configuration-object CRUD tools.
 *
 * Each config object lives in its own file under `src/tools/config/` and
 * declares its Zod input schemas + payload mapping, then calls the register
 * helpers here to wire the create/read/update/delete tools. The scaffold owns
 * the boilerplate that is identical across objects:
 *   - response envelopes (buildMutateResponse / buildListResponse)
 *   - the GET-strip-merge-PUT update cycle with EXPLICIT strip fields (the
 *     audited per-object strip set, never the stale global STRIP_FIELDS map)
 *   - the delete safety echo (deleteGuard)
 *   - "never assume" guidance: mandatory fields are required Zod params and the
 *     description tells the model to ask the user rather than infer.
 *
 * Two object shapes are supported:
 *   - FLAT / fully-typed: every field is a typed Zod param (preferred whenever
 *     the resolved request schema is tractable, even for single-subtype objects).
 *   - COMPLEX / polymorphic: a `describe_<noun>_schema` tool surfaces the audited
 *     structure, and create/update take typed mandatory params + a validated
 *     `config` body (assertConfigBody) so the model never guesses (used only for
 *     genuinely polymorphic giants like certificate profiles and PKI connectors).
 *
 * All contracts here are derived from the source-grounded audit under
 * `docs/audit/<object>.contract.json` + `<object>.schema.json`.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { HorizonError } from '../../client/errors.js';
import type { HorizonClient } from '../../client/http.js';
import {
  buildListResponse,
  buildMutateResponse,
  deleteGuard,
  encodePathSegment,
} from '../helpers.js';
import { registerTool } from '../register.js';

export const MAX_LIST_ITEMS = 50;

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface ConfigSpec {
  /** Singular noun for tool names + messages, e.g. "http_proxy". */
  readonly noun: string;
  /** Plural noun for the list tool name, e.g. "http_proxies". */
  readonly nounPlural: string;
  /** Human label, e.g. "HTTP proxy". */
  readonly label: string;
  /** Collection route, e.g. "/api/v1/proxy/httpproxies". */
  readonly routeCollection: string;
  /** Item route template, e.g. "/api/v1/proxy/httpproxies/{name}". Omit for singletons. */
  readonly routeItem?: string;
  /** Primary-key field name (usually "name"). Omit for singletons. */
  readonly idField?: string;
  /** Immutable keys (primary key + any server-immutable fields). */
  readonly immutableKeys: readonly string[];
  /** Server-populated fields to strip before a PUT (the audited strip set). */
  readonly stripFields: readonly string[];
  /**
   * When true the update PUT targets the COLLECTION route (Horizon's body-keyed
   * full-replace pattern). When false it targets the item route.
   */
  readonly putOnCollection: boolean;
  /** Optional knowledge-resource reference for the description footer. */
  readonly knowledgeRef?: string;
}

function refFooter(spec: ConfigSpec): string {
  return spec.knowledgeRef ? `\n\nRef: ${spec.knowledgeRef}.` : '';
}

/** Resolve the item path for a given id, encoding the id segment. */
function itemPath(spec: ConfigSpec, id: string): string {
  if (!spec.routeItem) {
    throw new HorizonError(500, {
      errorCode: 'CONFIG-NO-ITEM-ROUTE',
      message: `${spec.label} has no item route (singleton).`,
    });
  }
  // Item routes carry exactly one `{...}` placeholder. Fail loudly rather than
  // leaving an unencoded placeholder in the URL if a multi-segment route is
  // ever wired here (those build their paths explicitly, e.g. switch_team).
  const placeholders = spec.routeItem.match(/\{[^}]+\}/g) ?? [];
  if (placeholders.length !== 1) {
    throw new HorizonError(500, {
      errorCode: 'CONFIG-ITEM-ROUTE',
      message: `${spec.label} item route must have exactly one path placeholder.`,
    });
  }
  return spec.routeItem.replace(/\{[^}]+\}/, encodePathSegment(id));
}

// ---------------------------------------------------------------------------
// Description note builders ("never assume")
// ---------------------------------------------------------------------------

export function immutableNote(spec: ConfigSpec): string {
  const key = spec.idField ?? 'name';
  return (
    `IMPORTANT: ${key} is an immutable primary key and cannot be changed after ` +
    `creation. Always ask the user for it before creating - never invent or infer it.`
  );
}

export function mandatoryNote(fields: readonly string[]): string {
  if (fields.length === 0) return '';
  return (
    `MANDATORY fields: ${fields.join(', ')}. If the user has not supplied one of ` +
    `these, DO NOT infer or default it - ask the user for the value.`
  );
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

// ---------------------------------------------------------------------------
// GET-strip-merge-PUT with explicit strip set
// ---------------------------------------------------------------------------

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export async function getStripMergePutExplicit(
  client: HorizonClient,
  getPath: string,
  putPath: string,
  stripFields: readonly string[],
  overrides: Record<string, unknown>,
  clearFields?: string[],
  immutable?: { immutableKeys?: readonly string[]; idField?: string },
  normalizeCurrent?: (
    current: Record<string, unknown>,
  ) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const current = await client.get<Record<string, unknown>>(getPath);
  // The update is a full-replace seeded from this GET; bail if it is not a
  // single object (e.g. a wrapped/array response) rather than spreading array
  // indices or wrapper keys into the PUT body.
  if (
    current === null ||
    typeof current !== 'object' ||
    Array.isArray(current)
  ) {
    throw new HorizonError(502, {
      errorCode: 'CONFIG-BAD-GET',
      message: `Expected a single object from ${getPath} before update.`,
    });
  }
  // Reject attempts to CHANGE an immutable discriminator (e.g. a certificate
  // profile module or a connector type). Re-sending the stored value is allowed
  // - many polymorphic update tools must echo the discriminator into the PUT -
  // so we only reject when an override actually differs from the GET result.
  const idField = immutable?.idField ?? 'name';
  const changed = (immutable?.immutableKeys ?? []).filter(
    (k) =>
      k !== idField &&
      overrides[k] !== undefined &&
      current[k] !== undefined &&
      !sameValue(overrides[k], current[k]),
  );
  if (changed.length > 0) {
    throw new HorizonError(422, {
      errorCode: 'CONFIG-IMMUTABLE-OVERRIDE',
      message: `Cannot change immutable field(s) on update: ${changed.join(', ')}.`,
      remediation:
        'Remove these fields - they are fixed at creation. Recreate the object to change them.',
    });
  }
  const normalizedCurrent = normalizeCurrent?.(current) ?? current;
  const strip = new Set(stripFields);
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(normalizedCurrent)) {
    if (!strip.has(k)) payload[k] = v;
  }
  for (const f of clearFields ?? []) payload[f] = null;
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) payload[k] = v;
  }
  return client.put<Record<string, unknown>>(putPath, payload);
}

export function normalizeItems(data: unknown): Record<string, unknown>[] {
  if (data === null || typeof data !== 'object') return [];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const obj = data as Record<string, unknown>;
  if ('items' in obj) {
    return Array.isArray(obj['items'])
      ? (obj['items'] as Record<string, unknown>[])
      : [];
  }
  if (Object.keys(obj).length === 0) return [];
  return [obj];
}

// ---------------------------------------------------------------------------
// Read tools (list + get)
// ---------------------------------------------------------------------------

/**
 * Tool configs are rebuilt on every `registerXxxTools` call, and under MCP
 * 2026-07-28 the server factory runs once per HTTP request. Building the Zod
 * schemas is 64% of that cost, so cache each config the first time its spec is
 * seen and reuse it for every later instance. Safe because a config depends
 * only on its `spec`, which is an immutable module-scope constant, and because
 * nothing downstream mutates the object. Only the handler closures, which
 * capture the per-request `HorizonClient`, are rebuilt.
 */
function buildListConfig(spec: ConfigSpec, listDescription: string) {
  return {
    description: `${listDescription}\nSafety tier: read-only${refFooter(spec)}`,
    inputSchema: z.object({
      max_items: z
        .number()
        .int()
        .positive()
        .max(100)
        .default(MAX_LIST_ITEMS)
        .describe('Maximum items to return (default 50).'),
      name_contains: z
        .string()
        .optional()
        .describe(
          `Case-insensitive substring filter on ${spec.idField ?? 'name'}.`,
        ),
    }),
  };
}

function buildGetConfig(
  spec: ConfigSpec,
  idField: string,
  getDescription?: string,
) {
  return {
    description:
      `${getDescription ?? `Get a single ${spec.label} by ${idField}.`}` +
      `\nSafety tier: read-only${refFooter(spec)}`,
    inputSchema: z.object({
      [idField]: z.string().describe(`Exact ${spec.label} ${idField}.`),
    }),
  };
}

interface ReadConfigs {
  list: ReturnType<typeof buildListConfig>;
  get?: ReturnType<typeof buildGetConfig>;
}

const readToolConfigs = new WeakMap<ConfigSpec, ReadConfigs>();

function readConfigsFor(
  spec: ConfigSpec,
  opts: { listDescription: string; getDescription?: string },
): ReadConfigs {
  const cached = readToolConfigs.get(spec);
  if (cached) return cached;

  const built: ReadConfigs = {
    list: buildListConfig(spec, opts.listDescription),
  };
  if (spec.routeItem && spec.idField) {
    built.get = buildGetConfig(spec, spec.idField, opts.getDescription);
  }

  readToolConfigs.set(spec, built);
  return built;
}

export function registerReadTools(
  server: McpServer,
  client: HorizonClient,
  spec: ConfigSpec,
  opts: { listDescription: string; getDescription?: string } = {
    listDescription: '',
  },
): void {
  const configs = readConfigsFor(spec, opts);

  registerTool(
    server,
    `list_${spec.nounPlural}`,
    configs.list,
    async ({ max_items, name_contains }) => {
      const data = await client.get<unknown>(spec.routeCollection);
      // Filter on this object's actual primary-key field (not always "name" -
      // system configuration keys on "type").
      const field = spec.idField ?? 'name';
      const needle = name_contains?.toLowerCase();
      const items = normalizeItems(data).filter((item) => {
        if (!needle) return true;
        const v = item[field];
        return typeof v === 'string' && v.toLowerCase().includes(needle);
      });
      return text(buildListResponse(items, max_items, spec.noun));
    },
  );

  if (configs.get && spec.idField) {
    const idField = spec.idField;
    registerTool(
      server,
      `get_${spec.noun}`,
      configs.get,
      async (args: Record<string, unknown>) => {
        const id = String(args[idField]);
        const result = await client.get(itemPath(spec, id));
        return text(JSON.stringify(result));
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Create tool
// ---------------------------------------------------------------------------

export function registerCreateTool<S extends z.ZodObject<z.ZodRawShape>>(
  server: McpServer,
  client: HorizonClient,
  spec: ConfigSpec,
  opts: {
    description: string;
    mandatoryFields: readonly string[];
    inputSchema: S;
    buildPayload: (args: z.infer<S>) => Record<string, unknown>;
    preValidate?: (args: z.infer<S>) => string | undefined;
    /** Post-creation guidance surfaced as `next_steps` in the response. */
    nextSteps?: string;
  },
): void {
  registerTool(
    server,
    `create_${spec.noun}`,
    {
      description: `${opts.description}\nSafety tier: mutating-safe\n${immutableNote(spec)}\n${mandatoryNote(
        opts.mandatoryFields,
      )}${refFooter(spec)}`,
      inputSchema: opts.inputSchema,
    },
    async (args: z.infer<S>) => {
      const err = opts.preValidate?.(args);
      if (err !== undefined) return text(err);
      const body = opts.buildPayload(args);
      const result = await client.post<Record<string, unknown>>(
        spec.routeCollection,
        body,
      );
      const name = String(
        (body as Record<string, unknown>)[spec.idField ?? 'name'] ?? '',
      );
      return text(
        buildMutateResponse({
          action: 'created',
          kind: spec.noun,
          name,
          data: result,
          nextSteps: opts.nextSteps,
        }),
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Update tool
// ---------------------------------------------------------------------------

export function registerUpdateTool<S extends z.ZodObject<z.ZodRawShape>>(
  server: McpServer,
  client: HorizonClient,
  spec: ConfigSpec,
  opts: {
    description: string;
    inputSchema: S;
    buildOverrides: (args: z.infer<S>) => Record<string, unknown>;
    preValidate?: (args: z.infer<S>) => string | undefined;
    /** Normalizes a GET-only representation before the merged PUT. */
    normalizeCurrent?: (
      current: Record<string, unknown>,
    ) => Record<string, unknown>;
  },
): void {
  const idField = spec.idField ?? 'name';
  registerTool(
    server,
    `update_${spec.noun}`,
    {
      description:
        `${opts.description}\nSafety tier: mutating-safe\n` +
        `Update is GET -> strip server fields -> merge -> PUT (full-replace: omitted ` +
        `optional fields are reset). ${immutableNote(spec)}${refFooter(spec)}`,
      inputSchema: opts.inputSchema,
      // Config update is a full-replace PUT that can reset omitted fields and
      // overwrite permissions, so it is destructive despite the update_ prefix
      // the classifier treats as non-destructive by default.
      annotations: { destructiveHint: true },
    },
    async (args: z.infer<S>) => {
      const err = opts.preValidate?.(args);
      if (err !== undefined) return text(err);
      const id = String((args as Record<string, unknown>)[idField]);
      const overrides = opts.buildOverrides(args);
      const clearFields = (args as Record<string, unknown>)['clear_fields'] as
        | string[]
        | undefined;
      // clear_fields nulls a field in the full-replace PUT body. Never allow
      // nulling an immutable key or a server-managed (stripped) field.
      if (clearFields && clearFields.length > 0) {
        const forbidden = new Set<string>([
          ...spec.stripFields,
          ...spec.immutableKeys,
        ]);
        const bad = clearFields.filter((f) => forbidden.has(f));
        if (bad.length > 0) {
          throw new HorizonError(422, {
            errorCode: 'CONFIG-CLEAR-FORBIDDEN',
            message: `clear_fields may not target immutable or server-managed fields: ${bad.join(', ')}.`,
            remediation:
              'Remove these from clear_fields - they cannot be nulled.',
          });
        }
      }
      const putPath = spec.putOnCollection
        ? spec.routeCollection
        : itemPath(spec, id);
      const result = await getStripMergePutExplicit(
        client,
        itemPath(spec, id),
        putPath,
        spec.stripFields,
        overrides,
        clearFields,
        { immutableKeys: spec.immutableKeys, idField },
        opts.normalizeCurrent,
      );
      return text(
        buildMutateResponse({
          action: 'updated',
          kind: spec.noun,
          name: id,
          data: result,
        }),
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Delete tool
// ---------------------------------------------------------------------------

function buildDeleteConfig(
  spec: ConfigSpec,
  idField: string,
  opts: { description: string; deleteConstraints?: string },
) {
  return {
    description:
      `${opts.description}\nSafety tier: mutating-destructive\n` +
      `Requires ${idField} confirmation via expected_${idField}.` +
      `${opts.deleteConstraints ? `\n${opts.deleteConstraints}` : ''}${refFooter(spec)}`,
    inputSchema: z.object({
      [idField]: z.string().describe(`${spec.label} ${idField} to delete.`),
      [`expected_${idField}`]: z
        .string()
        .describe(`Must exactly match ${idField} as a deletion safeguard.`),
    }),
  };
}

const deleteToolConfigs = new WeakMap<
  ConfigSpec,
  ReturnType<typeof buildDeleteConfig>
>();

export function registerDeleteTool(
  server: McpServer,
  client: HorizonClient,
  spec: ConfigSpec,
  opts: { description: string; deleteConstraints?: string },
): void {
  const idField = spec.idField ?? 'name';
  let config = deleteToolConfigs.get(spec);
  if (!config) {
    config = buildDeleteConfig(spec, idField, opts);
    deleteToolConfigs.set(spec, config);
  }
  registerTool(
    server,
    `delete_${spec.noun}`,
    config,
    async (args: Record<string, unknown>) => {
      const id = String(args[idField]);
      const expected = String(args[`expected_${idField}`]);
      deleteGuard(id, expected, idField);
      await client.delete(itemPath(spec, id));
      return text(
        JSON.stringify({
          deleted: true,
          [idField]: id,
          kind: spec.noun,
        }),
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Membership subroutes (roles, teams): list / add / remove members
// ---------------------------------------------------------------------------

function buildMembershipConfigs(opts: {
  noun: string;
  label: string;
  routeBase: string;
  knowledgeRef?: string;
}) {
  const foot = opts.knowledgeRef ? `\n\nRef: ${opts.knowledgeRef}.` : '';
  return {
    list: {
      description: `List the member identifiers of a ${opts.label}.\nSafety tier: read-only${foot}`,
      inputSchema: z.object({
        name: z.string().describe(`${opts.label} name.`),
      }),
    },
    add: {
      description:
        `Add member identifiers to a ${opts.label}. Non-existing identifiers are ` +
        `created server-side.\nSafety tier: mutating-safe\n` +
        `MANDATORY: name and identifiers. Ask the user for the identifiers - never infer them.${foot}`,
      inputSchema: z.object({
        name: z.string().describe(`${opts.label} name.`),
        identifiers: z
          .array(z.string())
          .min(1)
          .describe('Principal identifiers to add.'),
      }),
    },
    remove: {
      description:
        `Remove member identifiers from a ${opts.label}.\nSafety tier: mutating-destructive\n` +
        `MANDATORY: name and identifiers. Ask the user for the identifiers - never infer them.${foot}`,
      inputSchema: z.object({
        name: z.string().describe(`${opts.label} name.`),
        identifiers: z
          .array(z.string())
          .min(1)
          .describe('Principal identifiers to remove.'),
      }),
    },
  };
}

// Callers pass a fresh object literal, so key the cache on the stable noun
// rather than on identity.
const membershipConfigs = new Map<
  string,
  ReturnType<typeof buildMembershipConfigs>
>();

export function registerMembershipTools(
  server: McpServer,
  client: HorizonClient,
  opts: {
    noun: string;
    label: string;
    routeBase: string;
    knowledgeRef?: string;
  },
): void {
  let configs = membershipConfigs.get(opts.noun);
  if (!configs) {
    configs = buildMembershipConfigs(opts);
    membershipConfigs.set(opts.noun, configs);
  }
  const membersPath = (name: string) =>
    `${opts.routeBase}/${encodePathSegment(name)}/members`;

  registerTool(
    server,
    `list_${opts.noun}_members`,
    configs.list,
    async ({ name }) =>
      text(JSON.stringify(await client.get(membersPath(name)))),
  );

  registerTool(
    server,
    `add_${opts.noun}_members`,
    configs.add,
    async ({ name, identifiers }) => {
      const result = await client.post(membersPath(name), identifiers);
      return text(
        buildMutateResponse({
          action: 'members_added',
          kind: opts.noun,
          name,
          data: { identifiers, result: result ?? null },
        }),
      );
    },
  );

  registerTool(
    server,
    `remove_${opts.noun}_members`,
    configs.remove,
    async ({ name, identifiers }) => {
      await client.deleteWithBody(membersPath(name), identifiers);
      return text(
        buildMutateResponse({
          action: 'members_removed',
          kind: opts.noun,
          name,
          data: { identifiers },
        }),
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Complex / polymorphic support: describe-schema + validated config body
// ---------------------------------------------------------------------------

export interface ComplexSchemaInfo {
  readonly noun: string;
  readonly label: string;
  readonly discriminatorField?: string;
  readonly subtypes: readonly string[];
  readonly mandatoryFields: readonly string[];
  /** Embedded, fully-resolved request JSON Schema (build-time constant). */
  readonly jsonSchema: unknown;
  readonly schemaVersion: string;
  readonly knowledgeRef?: string;
}

function buildDescribeSchemaConfig(info: ComplexSchemaInfo) {
  const foot = info.knowledgeRef ? `\n\nRef: ${info.knowledgeRef}.` : '';
  return {
    description:
      `Return the exact request structure for ${info.label} (subtypes, mandatory ` +
      `fields, enums, full JSON Schema). Call this BEFORE create_${info.noun} or ` +
      `update_${info.noun} so the body matches what Horizon expects - never guess ` +
      `the structure.\nSafety tier: read-only${foot}`,
    inputSchema: z.object({
      subtype: z
        .string()
        .optional()
        .describe(
          info.discriminatorField
            ? `Optional ${info.discriminatorField} to narrow the schema to one subtype.`
            : 'Optional subtype to narrow the schema.',
        ),
    }),
  };
}

const describeSchemaConfigs = new WeakMap<
  ComplexSchemaInfo,
  ReturnType<typeof buildDescribeSchemaConfig>
>();

export function registerDescribeSchemaTool(
  server: McpServer,
  info: ComplexSchemaInfo,
): void {
  let config = describeSchemaConfigs.get(info);
  if (!config) {
    config = buildDescribeSchemaConfig(info);
    describeSchemaConfigs.set(info, config);
  }
  registerTool(
    server,
    `describe_${info.noun}_schema`,
    config,
    async ({ subtype }) =>
      text(
        JSON.stringify({
          object: info.noun,
          discriminatorField: info.discriminatorField ?? null,
          subtypes: info.subtypes,
          mandatoryFields: info.mandatoryFields,
          schemaVersion: info.schemaVersion,
          requestedSubtype: subtype ?? null,
          jsonSchema: info.jsonSchema,
        }),
      ),
  );
}

/**
 * Lightweight client-side guard for complex bodies. Confirms required keys are
 * present, top-level keys are known, and enum values are valid. Deep structural
 * validation is delegated to Horizon (which returns precise errors the tool
 * surfaces). Throws HorizonError(422) so the model can self-correct.
 */
export function assertConfigBody(
  body: Record<string, unknown>,
  rules: {
    requiredKeys: readonly string[];
    knownKeys: readonly string[];
    enums?: Record<string, readonly string[]>;
  },
): void {
  const missing = rules.requiredKeys.filter(
    (k) => body[k] === undefined || body[k] === null,
  );
  if (missing.length > 0) {
    throw new HorizonError(422, {
      errorCode: 'CONFIG-MISSING-MANDATORY',
      message: `Missing mandatory field(s): ${missing.join(', ')}.`,
      remediation:
        'Ask the user for these values - do not infer them. Call the describe ' +
        'tool to see the full required structure.',
    });
  }
  const known = new Set(rules.knownKeys);
  const unknown = Object.keys(body).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new HorizonError(422, {
      errorCode: 'CONFIG-UNKNOWN-FIELD',
      message: `Unknown top-level field(s): ${unknown.join(', ')}.`,
      remediation:
        'Remove these fields. Call the describe tool to see the allowed fields.',
    });
  }
  for (const [field, values] of Object.entries(rules.enums ?? {})) {
    const v = body[field];
    if (v === undefined) continue;
    // A present enum field must be a string in the allowed set; a non-string
    // (number/object/null) is invalid and must not slip past to Horizon.
    if (typeof v !== 'string' || !values.includes(v)) {
      throw new HorizonError(422, {
        errorCode: 'CONFIG-BAD-ENUM',
        message: `Invalid ${field}=${JSON.stringify(v)}. Allowed: ${values.join(', ')}.`,
      });
    }
  }
}
