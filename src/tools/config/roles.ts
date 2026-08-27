/**
 * Security role configuration tools (flat, fully-typed) + member subroutes.
 *
 * 5 CRUD tools: list / get / create / update / delete, plus 3 membership tools
 * (list / add / remove members).
 * Contract: docs/audit/roles.contract.json (+ roles.schema.json), traced to
 * Role.scala / RoleService.scala / RoleApiV1Controller.scala / Permission.scala.
 *
 * Route: /api/v1/security/roles. Update PUTs the COLLECTION root (body-keyed
 * full-replace, server looks the role up by `name`); the wrapper does GET-merge
 * so omitted fields are preserved. Server-populated `_id` and `scim` are stripped
 * before the PUT. `permissions` is an array of Permission objects, each with a
 * mandatory `value` (and an optional `filter`).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  type ConfigSpec,
  registerCreateTool,
  registerDeleteTool,
  registerMembershipTools,
  registerReadTools,
  registerUpdateTool,
} from './_scaffold.js';

const SPEC: ConfigSpec = {
  noun: 'role',
  nounPlural: 'roles',
  label: 'role',
  routeCollection: '/api/v1/security/roles',
  routeItem: '/api/v1/security/roles/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id', 'scim'],
  putOnCollection: true,
};

const nameSchema = z
  .string()
  .describe(
    'Role name. Immutable primary key, server-validated against regex ' +
      '[0-9a-zA-Z-_]+ (alphanumerics, hyphen and underscore only - no dots, no spaces).',
  );

const descriptionSchema = z
  .string()
  .describe('Free-text description of the role.');

const permissionsSchema = z
  .array(
    z.object({
      value: z
        .string()
        .describe(
          'Permission string in the Horizon format `<group>:<resource>:<scope>:<action>` ' +
            '(group is one of configuration / lifecycle / discovery). Must be non-empty. ' +
            'Referenced profiles, discovery campaigns and SCIM profiles must already exist.',
        ),
      filter: z
        .string()
        .optional()
        .describe(
          'Optional HPQL filter applied to the permission scope, e.g. label.BusinessUnit equals "BU1".',
        ),
    }),
  )
  .describe(
    'Array of Permission objects. Each element MUST include a `value`; `filter` is optional.',
  );

const CREATE_ROLES_SCHEMA = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  permissions: permissionsSchema.optional(),
});

const UPDATE_ROLES_SCHEMA = z.object({
  name: z.string().describe('Role name to update (immutable key).'),
  description: descriptionSchema.optional(),
  permissions: permissionsSchema.optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe(
      'Top-level fields to explicitly null, e.g. ["description","permissions"].',
    ),
});

const CREATE_ROLE_OPTS = {
  description:
    'Create a security role. A role bundles permissions (and optional HPQL ' +
    'filters) that are granted to its members.\n' +
    'WARNING - PRIVILEGE GRANT: permissions control access. Use ONLY the exact ' +
    'permission strings the user specified; never infer permissions or use ' +
    'broad wildcards (e.g. "*:*:*"). If the user was not explicit, ask.',
  mandatoryFields: ['name'],
  inputSchema: CREATE_ROLES_SCHEMA,
  buildPayload: ({ name, description, permissions }) => {
    const body: Record<string, unknown> = { name };
    if (description !== undefined) body['description'] = description;
    if (permissions !== undefined) body['permissions'] = permissions;
    return body;
  },
} satisfies Parameters<typeof registerCreateTool>[3];

const UPDATE_ROLE_OPTS = {
  description:
    'Update an existing security role.\n' +
    "WARNING - PRIVILEGE GRANT: update replaces the role's permissions. Use " +
    'ONLY the exact permission strings the user specified; never infer them or ' +
    'widen scope with wildcards. Note that omitting `permissions` preserves the ' +
    'current set (GET-merge), while passing it REPLACES the whole set.',
  inputSchema: UPDATE_ROLES_SCHEMA,
  buildOverrides: ({ description, permissions }) => {
    const o: Record<string, unknown> = {};
    if (description !== undefined) o['description'] = description;
    if (permissions !== undefined) o['permissions'] = permissions;
    return o;
  },
} satisfies Parameters<typeof registerUpdateTool>[3];

export function registerRoleTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: 'List security roles.',
    getDescription: 'Get a single security role by name.',
  });

  registerCreateTool(server, client, SPEC, CREATE_ROLE_OPTS);

  registerUpdateTool(server, client, SPEC, UPDATE_ROLE_OPTS);

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a security role.',
    deleteConstraints:
      'Cannot be deleted while referenced by a SCIM profile mapping, an OIDC ' +
      'identity provider claim mapping, or a service account (ROLE-005). On ' +
      'success the role is removed from all principals.',
  });

  registerMembershipTools(server, client, {
    noun: 'role',
    label: 'role',
    routeBase: '/api/v1/security/roles',
  });
}
