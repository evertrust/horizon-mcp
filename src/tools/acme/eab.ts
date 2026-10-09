/** ACME External Account Binding (EAB) tools (Horizon 2.11+). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  buildSearchResponse,
  deleteGuard,
  encodePathSegment,
} from '../helpers.js';
import { registerTool } from '../register.js';
import {
  ACME_VERSION_NOTE,
  MAC_KEY_ALGORITHMS,
  ONE_TIME_SECRET_WARNING,
  PAGINATION_NOTE,
  PAGINATION_SHAPE,
  VALIDATION_METHODS,
  buildPagedBody,
  buildStatusBody,
  compromisedAtSchema,
  compromissionReasonSchema,
  finiteDurationSchema,
  text,
} from './common.js';

const EAB_ROUTE = '/api/v1/acme/eab';
const UPDATE_FIELDS = {
  description: 'description',
  eab_policy: 'eabPolicy',
  identifier_constraint: 'identifierConstraint',
  allowed_profiles: 'allowedProfiles',
  validation_methods: 'validationMethods',
  email_constraint: 'emailConstraint',
} as const;
type UpdateInput = keyof typeof UPDATE_FIELDS;

const CLEARABLE_FIELDS = [
  'description',
  'identifierConstraint',
  'allowedProfiles',
  'validationMethods',
  'emailConstraint',
] as const;
const LIST_FIELDS: readonly string[] = ['allowedProfiles', 'validationMethods'];
const EAB_STATUSES = [
  'valid',
  'disabled',
  'suspended',
  'deactivated',
  'compromised',
] as const;
const nameSchema = z.string().min(1).describe('EAB name.');

const constraintShape = {
  description: z.string().optional().describe('Free-text description.'),
  identifier_constraint: z
    .string()
    .optional()
    .describe('Regular expression that every order identifier must match.'),
  allowed_profiles: z
    .array(z.string())
    .optional()
    .describe('ACME profiles the bound accounts may use.'),
  validation_methods: z
    .array(z.enum(VALIDATION_METHODS))
    .optional()
    .describe('Allowed challenge types.'),
  email_constraint: z
    .string()
    .optional()
    .describe(
      'Regular expression that every account contact email must match.',
    ),
};

const macKeyAlgorithmSchema = z
  .enum(MAC_KEY_ALGORITHMS)
  .describe('MAC key algorithm.');
const validityDurationSchema = finiteDurationSchema
  .optional()
  .describe('EAB validity duration, for example "365 days".');

const SEARCH_ACME_EABS_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} Search ACME External Account Bindings (EABs) with ` +
    'HEABQL. Fields: id, name, status, mackey.algorithm, expiration.date, ' +
    'created.at, eab.policy, validation.methods. Example: eab.policy equals ' +
    '"web-servers" and status equals "valid". Call describe_query_fields with ' +
    'query_type "heabql" for operators. Omit query to list all EABs. ' +
    `${PAGINATION_NOTE}\nSafety tier: read-only`,
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('HEABQL query. Omit to match every EAB.'),
    ...PAGINATION_SHAPE,
  }),
};

const GET_ACME_EAB_CONFIG = {
  description: `${ACME_VERSION_NOTE} Get one ACME EAB by name. The MAC key is never returned here.\nSafety tier: read-only`,
  inputSchema: z.object({ name: nameSchema }),
};

const CREATE_ACME_EAB_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} Create an ACME External Account Binding. The ` +
    'response holds macKey and macKeyId ONCE: give them to the user ' +
    'immediately. Horizon will not show them again.\nSafety tier: mutating-safe\n' +
    'IMPORTANT: name is a unique identifier; it cannot change after creation. Always ask the user for it ' +
    'before creating - never invent or infer it.\nMANDATORY fields: name, ' +
    'eab_policy, mac_key_algorithm. If the user has not supplied one of these, ' +
    'DO NOT infer or default it - ask the user.',
  inputSchema: z.object({
    name: nameSchema,
    eab_policy: z
      .string()
      .min(1)
      .describe('Name of an existing EAB policy (see list_eab_policies).'),
    mac_key_algorithm: macKeyAlgorithmSchema,
    eab_validity_duration: validityDurationSchema,
    ...constraintShape,
  }),
};

const UPDATE_ACME_EAB_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} Update the metadata and constraints of an ACME EAB. ` +
    'Use update_acme_eab_status to change the status and renew_acme_eab for a ' +
    'new MAC key. The tool reads the EAB first; fields you omit keep their ' +
    'stored value. Use clear_fields to remove a constraint: a text field is ' +
    'left out and a list becomes empty.\nSafety tier: mutating-destructive',
  inputSchema: z.object({
    name: nameSchema,
    eab_policy: z.string().min(1).optional().describe('EAB policy name.'),
    ...constraintShape,
    clear_fields: z
      .array(z.enum(CLEARABLE_FIELDS))
      .optional()
      .describe('Fields to remove. Text fields are left out, lists become [].'),
  }),
  annotations: { destructiveHint: true },
};

const UPDATE_ACME_EAB_STATUS_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} Change the status of an ACME EAB. deactivated ` +
    'deactivates all ACME accounts bound to the EAB. compromised is ' +
    'irreversible: Horizon compromises all bound accounts and revokes ' +
    'their certificates issued after compromised_at, with compromission_reason. ' +
    'Confirm the EAB and the status with the user before you call this tool.\n' +
    'Safety tier: mutating-destructive',
  inputSchema: z.object({
    name: nameSchema,
    status: z.enum(EAB_STATUSES).describe('New EAB status.'),
    compromised_at: compromisedAtSchema,
    compromission_reason: compromissionReasonSchema,
  }),
  annotations: { destructiveHint: true, idempotentHint: false },
};

const RENEW_ACME_EAB_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} Renew an ACME EAB: Horizon generates a new MAC key ` +
    'and keeps the MAC key ID. The previous MAC key stops working: new ' +
    'registrations with it are rejected. ACME accounts already bound to the ' +
    'EAB are not affected. If you omit eab_validity_duration, the renewed EAB ' +
    'has no expiry, even if it had one before. Confirm with the user before ' +
    'you call this tool. The response holds the new macKey and macKeyId ONCE: ' +
    'give them to the user immediately. Horizon will not show them again.\n' +
    'Safety tier: mutating-destructive',
  inputSchema: z.object({
    name: nameSchema,
    mac_key_algorithm: macKeyAlgorithmSchema.optional(),
    eab_validity_duration: finiteDurationSchema
      .optional()
      .describe(
        'New EAB validity duration, for example "365 days". If you omit it, the renewed EAB has no expiry.',
      ),
  }),
  annotations: { destructiveHint: true, idempotentHint: false },
};

const DELETE_ACME_EAB_CONFIG = {
  description:
    `${ACME_VERSION_NOTE} Delete an ACME EAB. Horizon refuses the deletion ` +
    'while an ACME account with status valid, deactivated, or suspended is ' +
    'bound to it (EAB-003). Requires name confirmation via expected_name.\n' +
    'Safety tier: mutating-destructive',
  inputSchema: z.object({
    name: nameSchema,
    expected_name: z
      .string()
      .describe('Must exactly match name as a deletion safeguard.'),
  }),
};

function eabPath(name: string): string {
  return `${EAB_ROUTE}/${encodePathSegment(name)}`;
}

function mapFields(
  args: Partial<Record<UpdateInput, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    (Object.keys(UPDATE_FIELDS) as UpdateInput[])
      .filter((key) => args[key] !== undefined)
      .map((key) => [UPDATE_FIELDS[key], args[key]]),
  );
}

function oneTimeSecretResult(
  action: 'created' | 'renewed',
  name: string,
  data: unknown,
) {
  return text(
    JSON.stringify({
      status: action,
      kind: 'acme_eab',
      name,
      warning: ONE_TIME_SECRET_WARNING,
      data,
    }),
  );
}

function buildEabUpdateBody(
  current: Record<string, unknown>,
  args: Partial<Record<UpdateInput, unknown>> & { name: string },
  cleared: readonly string[],
): Record<string, unknown> {
  const stored = Object.fromEntries(
    Object.values(UPDATE_FIELDS)
      .filter(
        (field) => current[field] !== undefined && !cleared.includes(field),
      )
      .map((field) => [field, current[field]]),
  );
  const emptiedLists = Object.fromEntries(
    cleared
      .filter((field) => LIST_FIELDS.includes(field))
      .map((field) => [field, []]),
  );
  return { ...stored, ...emptiedLists, ...mapFields(args), name: args.name };
}

function registerEabReadTools(server: McpServer, client: HorizonClient): void {
  registerTool(
    server,
    'search_acme_eabs',
    SEARCH_ACME_EABS_CONFIG,
    async (args) => {
      const result = await client.post<Record<string, unknown>>(
        `${EAB_ROUTE}/search`,
        buildPagedBody(args),
      );
      return text(
        JSON.stringify(
          buildSearchResponse(result, args.page_index, args.page_size, {
            truncate: false,
          }),
        ),
      );
    },
  );
  registerTool(server, 'get_acme_eab', GET_ACME_EAB_CONFIG, async ({ name }) =>
    text(JSON.stringify(await client.get(eabPath(name)))),
  );
}

function registerEabWriteTools(server: McpServer, client: HorizonClient): void {
  registerTool(
    server,
    'create_acme_eab',
    CREATE_ACME_EAB_CONFIG,
    async (args) => {
      const body = {
        name: args.name,
        eabPolicy: args.eab_policy,
        macKeyAlgorithm: args.mac_key_algorithm,
        ...(args.eab_validity_duration !== undefined && {
          eabValidityDuration: args.eab_validity_duration,
        }),
        ...mapFields(args),
      };
      return oneTimeSecretResult(
        'created',
        args.name,
        await client.post(EAB_ROUTE, body),
      );
    },
  );
  registerTool(
    server,
    'update_acme_eab',
    UPDATE_ACME_EAB_CONFIG,
    async ({ clear_fields, ...args }) => {
      const current = await client.get<Record<string, unknown>>(
        eabPath(args.name),
      );
      const result = await client.put(
        EAB_ROUTE,
        buildEabUpdateBody(current, args, clear_fields ?? []),
      );
      return text(
        JSON.stringify({
          status: 'updated',
          kind: 'acme_eab',
          name: args.name,
          data: result,
        }),
      );
    },
  );
}

function registerEabLifecycleTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'update_acme_eab_status',
    UPDATE_ACME_EAB_STATUS_CONFIG,
    async (args) =>
      text(
        JSON.stringify(
          await client.post(
            `${eabPath(args.name)}/status`,
            buildStatusBody(args),
          ),
        ),
      ),
  );
  registerTool(
    server,
    'renew_acme_eab',
    RENEW_ACME_EAB_CONFIG,
    async ({ name, mac_key_algorithm, eab_validity_duration }) => {
      const body = {
        ...(mac_key_algorithm !== undefined && {
          macKeyAlgorithm: mac_key_algorithm,
        }),
        ...(eab_validity_duration !== undefined && {
          eabValidityDuration: eab_validity_duration,
        }),
      };
      return oneTimeSecretResult(
        'renewed',
        name,
        await client.post(`${eabPath(name)}/renew`, body),
      );
    },
  );
  registerTool(
    server,
    'delete_acme_eab',
    DELETE_ACME_EAB_CONFIG,
    async ({ name, expected_name }) => {
      deleteGuard(name, expected_name);
      await client.delete(eabPath(name));
      return text(JSON.stringify({ deleted: true, name, kind: 'acme_eab' }));
    },
  );
}

export function registerAcmeEabTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerEabReadTools(server, client);
  registerEabWriteTools(server, client);
  registerEabLifecycleTools(server, client);
}
