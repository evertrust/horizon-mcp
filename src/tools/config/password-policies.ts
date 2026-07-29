/**
 * Password policy configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * Contract: docs/audit/password_policies.contract.json (+ schema), traced to
 * PasswordPolicyApiV1Controller / PasswordPolicy.scala / PasswordPolicyService.
 *
 * Route: /api/v1/security/passwordpolicies. Update PUTs the COLLECTION root
 * (body-keyed full-replace, target located by the body `name` field, NO path
 * param); the wrapper does GET-merge so omitted fields are preserved. `_id` is
 * RESPONSE-ONLY and is stripped before the PUT.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  type ConfigSpec,
  registerCreateTool,
  registerDeleteTool,
  registerReadTools,
  registerUpdateTool,
} from './_scaffold.js';

const SPEC: ConfigSpec = {
  noun: 'password_policy',
  nounPlural: 'password_policies',
  label: 'password policy',
  routeCollection: '/api/v1/security/passwordpolicies',
  routeItem: '/api/v1/security/passwordpolicies/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id'],
  putOnCollection: true,
};

const nameSchema = z
  .string()
  .describe(
    'Password policy name. Immutable primary key. Reserved names "Horizon-Default" and "Horizon-Default-User" cannot be created, edited, or deleted.',
  );
const minCharSchema = z
  .number()
  .int()
  .min(0)
  .describe('Minimum number of characters. Must be >= 0.');
const maxCharSchema = z
  .number()
  .int()
  .min(1)
  .describe(
    'Maximum number of characters. If present must be > 0, and minUpChar+minLoChar+minDiChar+minSpChar must be <= maxChar. Omit for unbounded length.',
  );
const minUpCharSchema = z
  .number()
  .int()
  .min(0)
  .describe(
    'Minimum uppercase characters. Must be >= 0. Counts as a character class.',
  );
const minLoCharSchema = z
  .number()
  .int()
  .min(0)
  .describe(
    'Minimum lowercase characters. Must be >= 0. Counts as a character class.',
  );
const minDiCharSchema = z
  .number()
  .int()
  .min(0)
  .describe('Minimum digits. Must be >= 0. Counts as a character class.');
const spCharSchema = z
  .string()
  .describe(
    'Allowed special characters. Must not be blank when min_sp_char is set; cannot contain "," or ";". Defaults server-side to "+-._" when min_sp_char is set but this is omitted.',
  );
const minSpCharSchema = z
  .number()
  .int()
  .min(0)
  .describe(
    'Minimum special characters. Must be >= 0. Counts as a character class.',
  );

function buildPasswordPolicyBody(args: {
  name?: string;
  min_char?: number;
  max_char?: number;
  min_up_char?: number;
  min_lo_char?: number;
  min_di_char?: number;
  sp_char?: string;
  min_sp_char?: number;
}): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (args.name !== undefined) o['name'] = args.name;
  if (args.min_char !== undefined) o['minChar'] = args.min_char;
  if (args.max_char !== undefined) o['maxChar'] = args.max_char;
  if (args.min_up_char !== undefined) o['minUpChar'] = args.min_up_char;
  if (args.min_lo_char !== undefined) o['minLoChar'] = args.min_lo_char;
  if (args.min_di_char !== undefined) o['minDiChar'] = args.min_di_char;
  if (args.sp_char !== undefined) o['spChar'] = args.sp_char;
  if (args.min_sp_char !== undefined) o['minSpChar'] = args.min_sp_char;
  return o;
}

const CREATE_PASSWORD_POLICIES_SCHEMA = z.object({
  name: nameSchema,
  min_char: minCharSchema,
  max_char: maxCharSchema.optional(),
  min_up_char: minUpCharSchema.optional(),
  min_lo_char: minLoCharSchema.optional(),
  min_di_char: minDiCharSchema.optional(),
  sp_char: spCharSchema.optional(),
  min_sp_char: minSpCharSchema.optional(),
});

const UPDATE_PASSWORD_POLICIES_SCHEMA = z.object({
  name: z.string().describe('Password policy name to update (immutable key).'),
  min_char: minCharSchema.optional(),
  max_char: maxCharSchema.optional(),
  min_up_char: minUpCharSchema.optional(),
  min_lo_char: minLoCharSchema.optional(),
  min_di_char: minDiCharSchema.optional(),
  sp_char: spCharSchema.optional(),
  min_sp_char: minSpCharSchema.optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe(
      'Top-level fields to explicitly null, e.g. ["maxChar","spChar"].',
    ),
});

export function registerPasswordPolicyTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: 'List password policy configurations.',
    getDescription: 'Get a single password policy configuration by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create a password policy used for PKCS#12 passwords (certificate profile ' +
      'cryptoPolicy), EST/SCEP enrollment passwords, and local identity-provider ' +
      'passwords. At least one character class (min_up_char, min_lo_char, ' +
      'min_di_char, or min_sp_char) must be supplied.',
    mandatoryFields: ['name', 'min_char'],
    inputSchema: CREATE_PASSWORD_POLICIES_SCHEMA,
    buildPayload: (args) => buildPasswordPolicyBody(args),
  });

  registerUpdateTool(server, client, SPEC, {
    description: 'Update an existing password policy configuration.',
    inputSchema: UPDATE_PASSWORD_POLICIES_SCHEMA,
    buildOverrides: (args) => {
      const { name: _name, ...rest } = args;
      return buildPasswordPolicyBody(rest);
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a password policy configuration.',
    deleteConstraints:
      'Cannot delete reserved names ("Horizon-Default", "Horizon-Default-User"). ' +
      'Cannot delete while referenced by a certificate profile ' +
      'cryptoPolicy.p12passwordPolicy, an EST/SCEP profile passwordPolicy, or the ' +
      'local identity provider passwordPolicy (PasswordPolicy005).',
  });
}
