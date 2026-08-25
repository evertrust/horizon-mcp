import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../client/http.js';
import { buildSortedBy, encodePathSegment, toApiPageIndex } from './helpers.js';
import { registerTool } from './register.js';

const RENEWAL_POLICY_SCHEMA = z.object({
  cron: z.string(),
  renewalPeriod: z.string(),
});

const POLICY_STATUS_SCHEMA = z.object({
  name: z.string(),
  provider: z.string(),
  provisioner: z.string(),
  filter: z.string().nullable().optional(),
  enabled: z.boolean(),
  renewalPolicy: RENEWAL_POLICY_SCHEMA.nullable().optional(),
  runnable: z.boolean(),
});

const DOMAIN_STATUS_SCHEMA = z.object({
  domain: z.string(),
  isActive: z.boolean(),
  dcvStatus: z
    .enum(['not_validated', 'validated', 'expired'])
    .nullable()
    .optional(),
  dcvExpiration: z.number().int().nullable().optional(),
  dcvMethod: z.string().nullable().optional(),
  executionStatus: z
    .enum([
      'initialized',
      'succeeded',
      'left_over',
      'error',
      'get_challenge_error',
      'challenge_publication_error',
      'dcv_validation_error',
    ])
    .nullable()
    .optional(),
});

const DCV_POLICY_STATUS_SCHEMA = z.object({
  name: z.string(),
  enabled: z.boolean(),
  renewalPeriod: z.string().nullable().optional(),
  executionTimeout: z.string(),
  retryDelay: z.string(),
  runnable: z.boolean(),
  status: z.enum(['scheduled', 'disabled', 'running', 'queued', 'enabled']),
  startedAt: z.number().int().nullable().optional(),
  executionTimeoutAt: z.number().int().nullable().optional(),
  nextCheckAt: z.number().int().nullable().optional(),
  domainsStatus: z.object({
    error: z.string().nullable().optional(),
    domains: z.array(DOMAIN_STATUS_SCHEMA),
  }),
});

const DCV_EVENT_SCHEMA = z.object({
  status: z.enum(['started', 'success', 'failure', 'retrying', 'blocked']),
  timestamp: z.string(),
  domain: z.string(),
  policy: z.string(),
  attempt: z.number().int().optional(),
  lastError: z.string().nullable().optional(),
  msg: z.string().optional(),
  removeAt: z.string(),
});

const DCV_EVENTS_RESPONSE_SCHEMA = z.object({
  results: z.array(DCV_EVENT_SCHEMA),
  pageIndex: z.number().int(),
  pageSize: z.number().int(),
  count: z.number().int().nullable().optional(),
  hasMore: z.boolean(),
});

const LIST_DCV_POLICY_STATUS_CONFIG = {
  description:
    'List DCV policy lifecycle status. An empty Horizon response is returned as an empty array. Full guidance: horizon://knowledge/dcv.',
  outputSchema: z.array(POLICY_STATUS_SCHEMA),
};

const GET_DCV_POLICY_STATUS_CONFIG = {
  description:
    'Get the full lifecycle status for one DCV policy, including scheduled or active domain validation runs. Full guidance: horizon://knowledge/dcv.',
  inputSchema: z.object({
    name: z.string().describe('DCV policy name.'),
  }),
  outputSchema: DCV_POLICY_STATUS_SCHEMA,
};

const RUN_DCV_POLICY_CONFIG = {
  description:
    'Queue a DCV policy run for every eligible domain. This starts a real validation operation. Full guidance: horizon://knowledge/dcv.',
  inputSchema: z.object({
    name: z.string().describe('DCV policy name.'),
  }),
};

const RUN_DCV_DOMAIN_CONFIG = {
  description:
    'Queue DCV for one domain in a policy. This starts a real validation operation. Full guidance: horizon://knowledge/dcv.',
  inputSchema: z.object({
    name: z.string().describe('DCV policy name.'),
    domain: z.string().describe('Domain to validate.'),
  }),
};

const CANCEL_DCV_RUN_CONFIG = {
  description:
    'Cancel the current run of a DCV policy. This cancels the whole policy run, including its domains. Full guidance: horizon://knowledge/dcv.',
  inputSchema: z.object({
    name: z.string().describe('DCV policy name.'),
  }),
};

const LIST_DCV_EVENTS_CONFIG = {
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
  outputSchema: DCV_EVENTS_RESPONSE_SCHEMA,
};

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function policyPath(name: string): string {
  return `/api/v1/dcv/lifecycle/policies/${encodePathSegment(name)}`;
}

export function registerDcvLifecycleTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'list_dcv_policy_status',
    LIST_DCV_POLICY_STATUS_CONFIG,
    async () => {
      const result = await client.get<unknown>(
        '/api/v1/dcv/lifecycle/policies',
      );
      const policies = Array.isArray(result) ? result : [];
      return textResult(policies);
    },
  );

  registerTool(
    server,
    'get_dcv_policy_status',
    GET_DCV_POLICY_STATUS_CONFIG,
    async ({ name }) => textResult(await client.get(policyPath(name))),
  );

  registerTool(
    server,
    'run_dcv_policy',
    RUN_DCV_POLICY_CONFIG,
    async ({ name }) => {
      await client.post(`${policyPath(name)}/run`);
      return textResult({ status: 'started', policy: name });
    },
  );

  registerTool(
    server,
    'run_dcv_domain',
    RUN_DCV_DOMAIN_CONFIG,
    async ({ name, domain }) => {
      await client.post(`${policyPath(name)}/run/${encodePathSegment(domain)}`);
      return textResult({ status: 'started', policy: name, domain });
    },
  );

  registerTool(
    server,
    'cancel_dcv_run',
    CANCEL_DCV_RUN_CONFIG,
    async ({ name }) => {
      await client.post(`${policyPath(name)}/cancel`);
      return textResult({ status: 'cancelled', policy: name });
    },
  );

  registerTool(
    server,
    'list_dcv_events',
    LIST_DCV_EVENTS_CONFIG,
    async ({
      policy,
      domain,
      sorted_by,
      page_index,
      page_size,
      with_count,
    }) => {
      const path = domain
        ? `/api/v1/dcv/lifecycle/events/${encodePathSegment(policy)}/${encodePathSegment(domain)}`
        : `/api/v1/dcv/lifecycle/events/${encodePathSegment(policy)}`;
      const body: Record<string, unknown> = {};
      const sortedBy = buildSortedBy(sorted_by);
      if (sortedBy !== undefined) body['sortedBy'] = sortedBy;
      if (page_index !== undefined) {
        body['pageIndex'] = toApiPageIndex(page_index);
      }
      if (page_size !== undefined) body['pageSize'] = page_size;
      if (with_count !== undefined) body['withCount'] = with_count;
      return textResult(await client.post(path, body));
    },
  );
}
