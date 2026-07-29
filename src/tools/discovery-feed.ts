/**
 * Discovery feed tools for Horizon MCP Server.
 *
 * 4 tools covering the discovery feed lifecycle: start a feed session,
 * feed certificates, register events, and end the session.
 *
 * The discovery feed API lets external scanners push certificate data
 * into a Horizon discovery campaign programmatically.
 *
 * Note: In most cases, the horizon-cli agent handles feed sessions
 * automatically during netscan, localscan, netimport, and other
 * discovery workflows. These tools are for manual/programmatic feed
 * scenarios. See horizon://knowledge/discovery-workflows for CLI usage.
 *
 * Knowledge resources:
 *   - horizon://knowledge/discovery (concepts, data structures, search patterns)
 *   - horizon://knowledge/discovery-workflows (CLI commands for all scan types)
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../client/http.js';
import { encodePathSegment } from './helpers.js';
import { registerTool } from './register.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FEED_BASE = '/api/v1/discovery/feed';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDiscoveryFeedTools(
  server: McpServer,
  client: HorizonClient,
): void {
  // =======================================================================
  // Start feed session
  // =======================================================================

  registerTool(
    server,
    'start_discovery_feed_session',
    {
      description:
        'Start a discovery feed session for a campaign.\n\n' +
        "Store the returned 'id' field - you will need it to end the session. " +
        'If you lose this value, use list_discovery_campaigns to check campaign ' +
        'status, or use Horizon UI to clean up.',
      inputSchema: z.object({
        campaign_name: z
          .string()
          .describe('Name of the discovery campaign to feed into.'),
      }),
    },
    async ({ campaign_name }) => {
      const result = await client.get<Record<string, unknown>>(
        `${FEED_BASE}/${encodePathSegment(campaign_name)}`,
      );
      const sessionId = (result['id'] as string | undefined) ?? '';
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              content:
                `Feed session started for campaign '${campaign_name}'. ` +
                `Session ID: ${sessionId}. ` +
                'Store this ID to end the session later.',
              data: result,
            }),
          },
        ],
      };
    },
  );

  // =======================================================================
  // Feed certificate
  // =======================================================================

  registerTool(
    server,
    'feed_discovery_certificate',
    {
      description:
        'Feed a discovered certificate into an active feed session.\n\n' +
        'The hostDiscoveryData describes where the certificate was found. ' +
        'See horizon://knowledge/discovery for field details.',
      inputSchema: z.object({
        session_id: z
          .string()
          .describe('Session ID obtained from start_discovery_feed_session.'),
        campaign_name: z
          .string()
          .describe('Name of the discovery campaign (must match the session).'),
        certificate: z.string().describe('PEM-encoded certificate string.'),
        ip: z
          .string()
          .describe(
            'IP address of the host where the certificate was discovered.',
          ),
        hostnames: z
          .array(z.string())
          .optional()
          .describe('DNS hostnames of the host (e.g. ["web01.example.com"]).'),
        tls_ports: z
          .array(
            z
              .object({
                port: z.number().int(),
                version: z.string().optional(),
              })
              .passthrough(),
          )
          .optional()
          .describe(
            'TLS ports serving the cert (e.g. [{"port": 443, "version": "TLSv1.3"}]).',
          ),
        sources: z
          .array(z.string())
          .optional()
          .describe('Discovery source identifiers (e.g. ["netscan"]).'),
        paths: z
          .array(z.string())
          .optional()
          .describe('File paths where cert was found (localscan only).'),
        usages: z
          .array(z.string())
          .optional()
          .describe('Service bindings (localscan only).'),
        operating_systems: z
          .array(z.string())
          .optional()
          .describe('OS detected on the host (localscan only).'),
      }),
    },
    async ({
      session_id,
      campaign_name,
      certificate,
      ip,
      hostnames,
      tls_ports,
      sources,
      paths,
      usages,
      operating_systems,
    }) => {
      const hostData: Record<string, unknown> = { ip };
      if (hostnames !== undefined) hostData['hostnames'] = hostnames;
      if (tls_ports !== undefined) hostData['tlsPorts'] = tls_ports;
      if (sources !== undefined) hostData['sources'] = sources;
      if (paths !== undefined) hostData['paths'] = paths;
      if (usages !== undefined) hostData['usages'] = usages;
      if (operating_systems !== undefined)
        hostData['operatingSystems'] = operating_systems;

      const payload: Record<string, unknown> = {
        sessionId: session_id,
        campaign: campaign_name,
        certificate,
        hostDiscoveryData: hostData,
      };
      const result = await client.post<Record<string, unknown>>(
        FEED_BASE,
        payload,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              content: 'Certificate fed to discovery session.',
              data: result,
            }),
          },
        ],
      };
    },
  );

  // =======================================================================
  // Register event
  // =======================================================================

  registerTool(
    server,
    'register_discovery_event',
    {
      description:
        'Register an arbitrary discovery event in an active feed session.\n\n',
      inputSchema: z.object({
        session_id: z
          .string()
          .describe('Session ID obtained from start_discovery_feed_session.'),
        data: z
          .record(z.string(), z.unknown())
          .describe('Event data object - contents depend on the event type.'),
      }),
    },
    async ({ session_id, data }) => {
      const payload: Record<string, unknown> = {
        sessionId: session_id,
        ...data,
      };
      const result = await client.put<Record<string, unknown>>(
        FEED_BASE,
        payload,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              content: 'Discovery event registered.',
              data: result,
            }),
          },
        ],
      };
    },
  );

  // =======================================================================
  // End feed session
  // =======================================================================

  registerTool(
    server,
    'end_discovery_feed_session',
    {
      description: 'End a discovery feed session.\n\n',
      inputSchema: z.object({
        campaign_name: z.string().describe('Name of the discovery campaign.'),
        session_id: z
          .string()
          .describe('Session ID obtained from start_discovery_feed_session.'),
      }),
    },
    async ({ campaign_name, session_id }) => {
      await client.delete(
        `${FEED_BASE}/${encodePathSegment(campaign_name)}/${encodePathSegment(session_id)}`,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              content: `Feed session '${session_id}' ended for campaign '${campaign_name}'.`,
            }),
          },
        ],
      };
    },
  );
}
