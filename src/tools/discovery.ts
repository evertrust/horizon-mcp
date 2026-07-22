/**
 * Discovery campaign management tools for Horizon MCP Server.
 *
 * 6 tools covering the full discovery campaign lifecycle:
 *   - list_discovery_campaigns: list with optional name filtering
 *   - get_discovery_campaign: fetch a single campaign by name
 *   - create_discovery_campaign: create a new campaign
 *   - update_discovery_campaign: GET-strip-merge-PUT update
 *   - delete_discovery_campaign: delete with safety echo
 *   - flush_discovery_campaign: flush (purge events) with safety echo
 *
 * Knowledge resources:
 *   - horizon://knowledge/discovery (concepts, data structures, search patterns)
 *   - horizon://knowledge/discovery-workflows (CLI commands for all scan types)
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { HorizonError } from '../client/errors.js';
import type { HorizonClient } from '../client/http.js';
import { normalizeItems } from './datasources/shared.js';
import {
  applyNameFilter,
  buildListResponse,
  buildMutateResponse,
  deleteGuard,
  encodePathSegment,
  getStripMergePut,
} from './helpers.js';
import { registerTool } from './register.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAMPAIGN_BASE = '/api/v1/discovery/campaigns';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// Zod schema covers the access level enum and required sections at the MCP
// boundary, so no extra runtime validator is needed beyond name shape.
const authorizationLevelSectionSchema = z
  .object({
    accessLevel: z.enum(['everyone', 'authenticated', 'authorized']),
    enforcedIdentityProviders: z.array(z.string()).optional(),
  })
  .passthrough();

const authorizationLevelsSchema = z
  .object({
    search: authorizationLevelSectionSchema,
    feed: authorizationLevelSectionSchema,
  })
  .passthrough();

function validateName(name: string): void {
  if (name.includes('.')) {
    throw new HorizonError(422, {
      message: `Invalid campaign name '${name}'.`,
      remediation:
        'Campaign names cannot contain dots (DotlessNameIdentifier).',
    });
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDiscoveryTools(
  server: McpServer,
  client: HorizonClient,
): void {
  // =======================================================================
  // Read-only (2 tools)
  // =======================================================================

  registerTool(
    server,
    'list_discovery_campaigns',
    {
      description:
        'List discovery campaigns with optional name filtering.\n\n' +
        'Client-side filtering is applied after fetching all campaigns. ' +
        'Use name_contains for substring search.',
      inputSchema: z.object({
        max_items: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(50)
          .describe('Maximum items to return (default 50).'),
        name_contains: z
          .string()
          .optional()
          .describe('Case-insensitive substring filter on campaign name.'),
      }),
    },
    async ({ max_items, name_contains }) => {
      const data = await client.get<unknown>(CAMPAIGN_BASE);
      let items = normalizeItems(data);
      items = applyNameFilter(items, name_contains);
      return {
        content: [
          {
            type: 'text' as const,
            text: buildListResponse(items, max_items, 'discovery_campaign'),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'get_discovery_campaign',
    {
      description: 'Get a single discovery campaign by name.\n\n',
      inputSchema: z.object({
        name: z.string().describe('Exact campaign name.'),
      }),
    },
    async ({ name }) => {
      const result = await client.get(
        `${CAMPAIGN_BASE}/${encodePathSegment(name)}`,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // =======================================================================
  // Mutating-safe (2 tools)
  // =======================================================================

  registerTool(
    server,
    'create_discovery_campaign',
    {
      description:
        'Create a new discovery campaign.\n\n' +
        'After creating the campaign, the actual scan is performed by the ' +
        'horizon-cli agent installed on a host with network access to the ' +
        'targets. See horizon://knowledge/discovery-workflows for all CLI ' +
        'commands: netscan (network scan), localscan (filesystem scan), ' +
        'netimport (cloud/appliance import), importscan (third-party tools), ' +
        'and localimport (folder/CSV bulk import for PKI migrations).\n\n' +
        'Prerequisites: Grading policies must exist if referenced (use list_grading_policies). ' +
        'Identity providers in authorization_levels must exist (use list_identity_providers).\n' +
        '(manual feed workflow), search_discovery_events (view results).\n\n' +
        'Campaign names cannot contain dots (DotlessNameIdentifier).\n\n' +
        "authorization_levels must contain 'search' and 'feed' sections, each with:\n" +
        '  - accessLevel (required): "everyone", "authenticated", or "authorized"\n' +
        '  - enforcedIdentityProviders (optional): list of identity provider names',
      inputSchema: z.object({
        name: z.string().describe('Unique campaign name (no dots allowed).'),
        authorization_levels: authorizationLevelsSchema.describe(
          'Access control for search and feed operations. Required shape: {"search": {"accessLevel": "authenticated"}, "feed": {"accessLevel": "authorized"}}. ' +
            'Valid accessLevel values: "everyone", "authenticated", "authorized". ' +
            'Optional per-section: "enforcedIdentityProviders": ["idp-name"].',
        ),
        event_on_success: z
          .boolean()
          .default(true)
          .describe('Generate events on successful scans (default true).'),
        event_on_warning: z
          .boolean()
          .default(true)
          .describe('Generate events on scan warnings (default true).'),
        event_on_failure: z
          .boolean()
          .default(true)
          .describe('Generate events on scan failures (default true).'),
        enabled: z
          .boolean()
          .default(true)
          .describe('Whether the campaign is active (default true).'),
        description: z
          .string()
          .optional()
          .describe('Optional human-readable description.'),
        hosts: z
          .array(z.string())
          .optional()
          .describe('Optional list of hosts/IP ranges to scan.'),
        ports: z
          .array(z.number().int())
          .optional()
          .describe('Optional list of ports to scan.'),
        grading_policies: z
          .array(z.string())
          .optional()
          .describe('Optional list of grading policy names to apply.'),
      }),
    },
    async ({
      name,
      authorization_levels,
      event_on_success,
      event_on_warning,
      event_on_failure,
      enabled,
      description,
      hosts,
      ports,
      grading_policies,
    }) => {
      validateName(name);

      const payload: Record<string, unknown> = {
        name,
        authorizationLevels: authorization_levels,
        eventOnSuccess: event_on_success,
        eventOnWarning: event_on_warning,
        eventOnFailure: event_on_failure,
        enabled,
      };
      if (description !== undefined) payload['description'] = description;
      if (hosts !== undefined) payload['hosts'] = hosts;
      if (ports !== undefined) payload['ports'] = ports.map((p) => String(p));
      if (grading_policies !== undefined)
        payload['gradingPolicies'] = grading_policies;

      const result = await client.post<Record<string, unknown>>(
        CAMPAIGN_BASE,
        payload,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: buildMutateResponse({
              action: 'created',
              kind: 'discovery_campaign',
              name,
              data: result,
            }),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'update_discovery_campaign',
    {
      description:
        'Update an existing discovery campaign (GET -> strip -> merge -> PUT).\n\n' +
        'Uses the GET-strip-merge-PUT pattern: fetches the current state, ' +
        'strips server-populated fields, merges your overrides, and PUTs ' +
        'the result back.',
      inputSchema: z.object({
        name: z.string().describe('Campaign name to update.'),
        authorization_levels: authorizationLevelsSchema
          .optional()
          .describe('New access control configuration.'),
        event_on_success: z
          .boolean()
          .optional()
          .describe('Whether to generate events on success.'),
        event_on_warning: z
          .boolean()
          .optional()
          .describe('Whether to generate events on warnings.'),
        event_on_failure: z
          .boolean()
          .optional()
          .describe('Whether to generate events on failures.'),
        enabled: z
          .boolean()
          .optional()
          .describe('Whether the campaign is active.'),
        description: z.string().optional().describe('New description.'),
        hosts: z
          .array(z.string())
          .optional()
          .describe('New list of hosts/IP ranges.'),
        ports: z
          .array(z.number().int())
          .optional()
          .describe('New list of ports.'),
        grading_policies: z
          .array(z.string())
          .optional()
          .describe('New list of grading policy names.'),
        clear_fields: z
          .array(z.string())
          .optional()
          .describe('Top-level field names to explicitly set to null.'),
      }),
    },
    async ({
      name,
      authorization_levels,
      event_on_success,
      event_on_warning,
      event_on_failure,
      enabled,
      description,
      hosts,
      ports,
      grading_policies,
      clear_fields,
    }) => {
      const overrides: Record<string, unknown> = {};
      if (authorization_levels !== undefined)
        overrides['authorizationLevels'] = authorization_levels;
      if (event_on_success !== undefined)
        overrides['eventOnSuccess'] = event_on_success;
      if (event_on_warning !== undefined)
        overrides['eventOnWarning'] = event_on_warning;
      if (event_on_failure !== undefined)
        overrides['eventOnFailure'] = event_on_failure;
      if (enabled !== undefined) overrides['enabled'] = enabled;
      if (description !== undefined) overrides['description'] = description;
      if (hosts !== undefined) overrides['hosts'] = hosts;
      if (ports !== undefined) overrides['ports'] = ports.map((p) => String(p));
      if (grading_policies !== undefined)
        overrides['gradingPolicies'] = grading_policies;

      const result = await getStripMergePut(
        client,
        `${CAMPAIGN_BASE}/${encodePathSegment(name)}`,
        CAMPAIGN_BASE,
        'discovery_campaign',
        overrides,
        clear_fields,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: buildMutateResponse({
              action: 'updated',
              kind: 'discovery_campaign',
              name,
              data: result,
            }),
          },
        ],
      };
    },
  );

  // =======================================================================
  // Mutating-destructive (2 tools)
  // =======================================================================

  registerTool(
    server,
    'delete_discovery_campaign',
    {
      description:
        'Delete a discovery campaign. Requires name confirmation.\n\n',
      inputSchema: z.object({
        name: z.string().describe('Campaign name to delete.'),
        expected_name: z
          .string()
          .describe('Must exactly match name as a deletion safeguard.'),
      }),
    },
    async ({ name, expected_name }) => {
      deleteGuard(name, expected_name);
      await client.delete(`${CAMPAIGN_BASE}/${encodePathSegment(name)}`);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              deleted: true,
              name,
              kind: 'discovery_campaign',
            }),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'flush_discovery_campaign',
    {
      description:
        'Flush (purge all events from) a discovery campaign. Requires name confirmation.\n\n' +
        'Sends a PATCH to purge all discovery events associated with the ' +
        'campaign. This is irreversible.',
      inputSchema: z.object({
        name: z.string().describe('Campaign name to flush.'),
        expected_name: z
          .string()
          .describe('Must exactly match name as a flush safeguard.'),
      }),
    },
    async ({ name, expected_name }) => {
      deleteGuard(name, expected_name);
      await client.patch(`${CAMPAIGN_BASE}/${encodePathSegment(name)}`, {});
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              flushed: true,
              name,
              kind: 'discovery_campaign',
            }),
          },
        ],
      };
    },
  );
}
