/**
 * Team configuration tools (RBAC teams; flat, fully-typed).
 *
 * 5 CRUD tools: list / get / create / update / delete.
 * Plus membership subroutes: list / add / remove_team_members.
 * Plus switch_team: rename a team's identity by replacing one with another.
 *
 * Contract: docs/audit/teams.contract.json (+ teams.schema.json), traced to
 * Team.scala / TeamService.scala / TeamApiV1Controller.scala. The audit tags
 * teams "complex" but the request schema is tractable, so every field is a
 * typed Zod param (snake_case input -> exact camelCase API key).
 *
 * Route: /api/v1/security/teams. Update PUTs the COLLECTION root (body-keyed
 * full-replace); the wrapper does GET-merge so omitted fields are preserved.
 * Strip server-populated fields (_id, scim) before PUT.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  buildMutateResponse,
  deleteGuard,
  encodePathSegment,
} from '../helpers.js';
import { registerTool } from '../register.js';
import {
  type ConfigSpec,
  registerCreateTool,
  registerDeleteTool,
  registerMembershipTools,
  registerReadTools,
  registerUpdateTool,
} from './_scaffold.js';

const SPEC: ConfigSpec = {
  noun: 'team',
  nounPlural: 'teams',
  label: 'team',
  routeCollection: '/api/v1/security/teams',
  routeItem: '/api/v1/security/teams/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id', 'scim'],
  putOnCollection: true,
};

const WEBHOOK_TYPES = ['slack', 'teams'] as const;

const localizedSchema = z
  .array(z.object({ lang: z.string(), value: z.string() }))
  .describe(
    "Array of localized strings, e.g. [{lang: 'en', value: 'PKI Operations'}].",
  );

const webhookSchema = z
  .object({
    type: z
      .enum(WEBHOOK_TYPES)
      .describe('Webhook type: slack (also Mattermost) or teams.'),
    url: z.string().describe('Webhook URL of the corporate channel.'),
  })
  .describe(
    "Webhook of the team's corporate channel (Teams, Slack, Mattermost).",
  );

const contactSchema = z
  .string()
  .describe(
    'Generic contact e-mail of the team. Server-validated as a valid e-mail.',
  );

const managersSchema = z
  .array(z.string())
  .describe(
    'Principal identifiers of the team managers. Each must reference an existing principal.',
  );

const descriptionSchema = localizedSchema.describe(
  'Localized description of the team.',
);
const displayNameSchema = localizedSchema.describe(
  'Localized human-friendly display name (can change after creation).',
);

function buildTeamBody(args: {
  name?: string;
  description?: { lang: string; value: string }[];
  contact?: string;
  webhook?: { type: string; url: string };
  managers?: string[];
  display_name?: { lang: string; value: string }[];
}): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (args.name !== undefined) o['name'] = args.name;
  if (args.description !== undefined) o['description'] = args.description;
  if (args.contact !== undefined) o['contact'] = args.contact;
  if (args.webhook !== undefined) o['webhook'] = args.webhook;
  if (args.managers !== undefined) o['managers'] = args.managers;
  if (args.display_name !== undefined) o['displayName'] = args.display_name;
  return o;
}

const CREATE_TEAMS_SCHEMA = z.object({
  name: z
    .string()
    .describe(
      'Team name. Immutable primary key, server-validated against regex [0-9a-zA-Z-_]+ (no dots or spaces).',
    ),
  description: descriptionSchema.optional(),
  contact: contactSchema.optional(),
  webhook: webhookSchema.optional(),
  managers: managersSchema.optional(),
  display_name: displayNameSchema.optional(),
});

const UPDATE_TEAMS_SCHEMA = z.object({
  name: z.string().describe('Team name to update (immutable key).'),
  description: descriptionSchema.optional(),
  contact: contactSchema.optional(),
  webhook: webhookSchema.optional(),
  managers: managersSchema.optional(),
  display_name: displayNameSchema.optional(),
  clear_fields: z
    .array(z.string())
    .optional()
    .describe(
      'Top-level fields to explicitly null, e.g. ["webhook","contact"].',
    ),
});

export function registerTeamTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: 'List RBAC teams.',
    getDescription: 'Get a single team by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create an RBAC team. Teams own certificates, requests, profiles and ' +
      'scheduled tasks, and group principals for authorization.',
    mandatoryFields: ['name'],
    inputSchema: CREATE_TEAMS_SCHEMA,
    buildPayload: (args) => buildTeamBody(args),
  });

  registerUpdateTool(server, client, SPEC, {
    description: 'Update an existing team.',
    inputSchema: UPDATE_TEAMS_SCHEMA,
    buildOverrides: (args) => {
      const { name: _name, ...rest } = args;
      return buildTeamBody(rest);
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete a team.',
    deleteConstraints:
      'Blocked (400 Team005) if the team is referenced by a SCIM profile ' +
      'mapping or an OIDC identity-provider claim mapping. On success cascades: ' +
      'unsets team on certificates, requests, profiles and scheduled tasks, and ' +
      'removes the team from principals.',
  });

  registerMembershipTools(server, client, {
    noun: 'team',
    label: 'team',
    routeBase: '/api/v1/security/teams',
  });

  registerTool(
    server,
    'switch_team',
    {
      description:
        'Switch a team identity: replace an existing team (previous_team) with ' +
        'another (new_team) via PATCH /api/v1/security/teams/{previousTeam}/{newTeam}. ' +
        'Team names are immutable primary keys, so this re-homes the previous ' +
        "team's members and ownership to new_team - a destructive identity change.\n" +
        'Safety tier: mutating-destructive\n' +
        'MANDATORY: previous_team and new_team. Ask the user for both - never infer ' +
        'them. Pass expected_previous_team equal to previous_team to confirm.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: z.object({
        previous_team: z
          .string()
          .min(1)
          .describe('Existing team name to switch away from.'),
        new_team: z.string().min(1).describe('Team name to switch to.'),
        expected_previous_team: z
          .string()
          .describe(
            'Must exactly match previous_team as a safeguard against accidental switches.',
          ),
      }),
    },
    async ({ previous_team, new_team, expected_previous_team }) => {
      deleteGuard(previous_team, expected_previous_team, 'previous_team');
      const path =
        `/api/v1/security/teams/${encodePathSegment(previous_team)}` +
        `/${encodePathSegment(new_team)}`;
      const result = await client.patch<Record<string, unknown>>(path, {});
      return {
        content: [
          {
            type: 'text' as const,
            text: buildMutateResponse({
              action: 'switched',
              kind: 'team',
              name: new_team,
              data: {
                previous_team,
                new_team,
                result: result ?? null,
              },
            }),
          },
        ],
      };
    },
  );
}
