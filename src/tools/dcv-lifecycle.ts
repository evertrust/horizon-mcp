import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../client/http.js';
import { buildSortedBy, encodePathSegment, toApiPageIndex } from './helpers.js';
import { registerTool } from './register.js';

function textResult(value: unknown) {
  const text = JSON.stringify(value) ?? 'null';
  return {
    content: [{ type: 'text' as const, text }],
  };
}

function policyPath(name: string): string {
  return `/api/v1/dcv/lifecycle/policies/${encodePathSegment(name)}`;
}

function registerDcvStatusTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'list_dcv_policy_status',
    {
      description:
        'List DCV policy lifecycle status. An empty Horizon response is returned as an empty array. Full guidance: horizon://knowledge/dcv.',
    },
    async () => {
      const result = await client.get<unknown>(
        '/api/v1/dcv/lifecycle/policies',
      );
      return textResult(Array.isArray(result) ? result : []);
    },
  );

  registerTool(
    server,
    'get_dcv_policy_status',
    {
      description:
        'Get the full lifecycle status for one DCV policy, including scheduled or active domain validation runs. Full guidance: horizon://knowledge/dcv.',
      inputSchema: z.object({
        name: z.string().describe('DCV policy name.'),
      }),
    },
    async ({ name }) => textResult(await client.get(policyPath(name))),
  );
}

function registerDcvActionTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'run_dcv_policy',
    {
      description:
        'Queue a DCV policy run for every eligible domain. This starts a real validation operation. Full guidance: horizon://knowledge/dcv.',
      inputSchema: z.object({
        name: z.string().describe('DCV policy name.'),
      }),
    },
    async ({ name }) => {
      await client.post(`${policyPath(name)}/run`);
      return textResult({ status: 'started', policy: name });
    },
  );
}

function registerDcvDomainTool(server: McpServer, client: HorizonClient): void {
  registerTool(
    server,
    'run_dcv_domain',
    {
      description:
        'Queue DCV for one domain in a policy. This starts a real validation operation. Full guidance: horizon://knowledge/dcv.',
      inputSchema: z.object({
        name: z.string().describe('DCV policy name.'),
        domain: z.string().describe('Domain to validate.'),
      }),
    },
    async ({ name, domain }) => {
      await client.post(`${policyPath(name)}/run/${encodePathSegment(domain)}`);
      return textResult({ status: 'started', policy: name, domain });
    },
  );
}

function registerCancelDcvRunTool(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'cancel_dcv_run',
    {
      description:
        'Cancel the current run of a DCV policy. This cancels the whole policy run, including its domains. Full guidance: horizon://knowledge/dcv.',
      inputSchema: z.object({
        name: z.string().describe('DCV policy name.'),
      }),
    },
    async ({ name }) => {
      await client.post(`${policyPath(name)}/cancel`);
      return textResult({ status: 'cancelled', policy: name });
    },
  );
}

function buildDcvEventsRequest(options: {
  policy: string;
  domain?: string;
  sorted_by?: string;
  page_index?: number;
  page_size?: number;
  with_count?: boolean;
}): { path: string; body: Record<string, unknown> } {
  const path = options.domain
    ? `/api/v1/dcv/lifecycle/events/${encodePathSegment(options.policy)}/${encodePathSegment(options.domain)}`
    : `/api/v1/dcv/lifecycle/events/${encodePathSegment(options.policy)}`;
  const body: Record<string, unknown> = {};
  const sortedBy = buildSortedBy(options.sorted_by);
  if (sortedBy !== undefined) body['sortedBy'] = sortedBy;
  if (options.page_index !== undefined) {
    body['pageIndex'] = toApiPageIndex(options.page_index);
  }
  if (options.page_size !== undefined) body['pageSize'] = options.page_size;
  if (options.with_count !== undefined) body['withCount'] = options.with_count;
  return { path, body };
}

function registerDcvEventTool(server: McpServer, client: HorizonClient): void {
  registerTool(
    server,
    'list_dcv_events',
    {
      description:
        'List DCV lifecycle events for a policy, optionally narrowed to one domain. removeAt is the event retention deadline. Full guidance: horizon://knowledge/dcv.',
      inputSchema: z.object({
        policy: z.string().describe('DCV policy name.'),
        domain: z.string().optional().describe('Optional domain to filter to.'),
        sorted_by: z
          .string()
          .optional()
          .describe("Sort expression, for example 'timestamp:Desc'."),
        page_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based page index.'),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Results per page, maximum 100.'),
        with_count: z
          .boolean()
          .optional()
          .describe('Include the total event count.'),
      }),
    },
    async (options) => {
      const { path, body } = buildDcvEventsRequest(options);
      return textResult(await client.post(path, body));
    },
  );
}

export function registerDcvLifecycleTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerDcvStatusTools(server, client);
  registerDcvActionTools(server, client);
  registerDcvDomainTool(server, client);
  registerCancelDcvRunTool(server, client);
  registerDcvEventTool(server, client);
}
