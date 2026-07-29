/**
 * REST notification and trigger management tools for Horizon MCP Server.
 *
 * 6 tools covering the trigger lifecycle for custom REST connectors:
 *   - list_credentials: list stored credentials (names/types, no secrets)
 *   - list_triggers: list all triggers with optional type/name filtering
 *   - get_trigger: fetch a single trigger by name
 *   - create_rest_notification: create a REST notification with multi-step sequences
 *   - delete_trigger: delete with safety echo
 *   - simulate_trigger: test-fire a trigger without real certificate context
 *
 * Knowledge resources:
 *   - horizon://knowledge/rest-notifications
 *   - horizon://knowledge/automation
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../client/http.js';
import { normalizeItems } from './datasources/shared.js';
import {
  applyNameFilter,
  buildListResponse,
  buildMutateResponse,
  deleteGuard,
  encodePathSegment,
} from './helpers.js';
import { registerTool } from './register.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIGGER_BASE = '/api/v1/triggers';
const CRED_BASE = '/api/v1/security/credentials';
const MAX_LIST_ITEMS = 50;

const VALID_TRIGGER_TYPES = new Set([
  'email',
  'rest',
  'webhook',
  'akv',
  'aws',
  'f5client',
  'f5as3',
  'intunepkcs',
  'ldappub',
  'gcm',
]);

const VALID_AUTH_TYPES = new Set([
  'noauth',
  'basic',
  'x509',
  'bearer',
  'custom',
]);

const VALID_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
]);

const EVENTS_REQUIRING_RUN_PERIOD = new Set([
  'on_expire',
  'on_pending_enroll',
  'on_pending_revoke',
  'on_pending_update',
  'on_pending_recover',
  'on_pending_migrate',
  'on_pending_renew',
  'on_pending_import',
  'on_license_expiration',
  'on_credentials_expiration',
]);

const SENSITIVE_CREDENTIAL_FIELDS = new Set([
  'password',
  'secret',
  'store',
  'login',
]);

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateTriggerType(triggerType: string): string | undefined {
  if (!VALID_TRIGGER_TYPES.has(triggerType)) {
    return JSON.stringify({
      error: `Invalid trigger type '${triggerType}'.`,
      valid_types: [...VALID_TRIGGER_TYPES].sort(),
    });
  }
  return undefined;
}

function validateEvent(event: string): string | undefined {
  if (!event.startsWith('on_')) {
    return JSON.stringify({
      error: `Invalid event '${event}'. Events must start with 'on_'.`,
      hint: 'Examples: on_enroll, on_revoke, on_renew, on_expire, on_submit_enroll',
    });
  }
  return undefined;
}

function validateSequenceStep(
  step: Record<string, unknown>,
  index: number,
): string | undefined {
  if (!step['url']) {
    return JSON.stringify({
      error: `Sequence step ${index + 1}: 'url' is required.`,
    });
  }

  const method = step['method'];
  if (typeof method !== 'string' || !VALID_METHODS.has(method.toUpperCase())) {
    return JSON.stringify({
      error: `Sequence step ${index + 1}: invalid method '${String(method)}'.`,
      valid_methods: [...VALID_METHODS].sort(),
    });
  }

  const auth = (step['authenticationType'] as string | undefined) ?? 'noauth';
  if (!VALID_AUTH_TYPES.has(auth)) {
    return JSON.stringify({
      error: `Sequence step ${index + 1}: invalid authenticationType '${auth}'.`,
      valid_types: [...VALID_AUTH_TYPES].sort(),
    });
  }

  if (auth !== 'noauth' && !step['credentials']) {
    return JSON.stringify({
      error:
        `Sequence step ${index + 1}: 'credentials' is required ` +
        `when authenticationType is '${auth}'.`,
    });
  }

  const codes = step['expectedHttpCodes'];
  if (!Array.isArray(codes) || codes.length === 0) {
    return JSON.stringify({
      error: `Sequence step ${index + 1}: 'expectedHttpCodes' must contain at least one HTTP status code.`,
      hint: 'Common values: [200], [200, 201], [200, 201, 204].',
    });
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyTypeFilter(
  items: Record<string, unknown>[],
  filterType: string | undefined,
  typeKey: string,
): Record<string, unknown>[] {
  if (!filterType) return items;
  return items.filter((it) => it[typeKey] === filterType);
}

function stripSensitiveFields(
  items: Record<string, unknown>[],
): Record<string, unknown>[] {
  return items.map((item) => {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) {
      if (!SENSITIVE_CREDENTIAL_FIELDS.has(k)) {
        safe[k] = v;
      }
    }
    return safe;
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTriggerTools(
  server: McpServer,
  client: HorizonClient,
): void {
  // =======================================================================
  // Credentials (1 tool - read-only)
  // =======================================================================

  registerTool(
    server,
    'list_credentials',
    {
      description:
        'List stored credentials (names and types only - secrets are never exposed).\n\n' +
        'Safety tier: read-only\n' +
        'Credentials are referenced by name in REST notification steps and ' +
        'datasource configurations. Secret values (passwords, API tokens, private ' +
        'keys) are NEVER returned.\n\n',
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
          .describe('Case-insensitive substring filter on credential name.'),
        credential_type: z
          .string()
          .optional()
          .describe(
            'Filter by type: "password" (login/password), "raw" (API token), or "x509" (client certificate).',
          ),
      }),
    },
    async ({ max_items, name_contains, credential_type }) => {
      const validCredTypes = new Set(['password', 'raw', 'x509']);
      if (
        credential_type !== undefined &&
        !validCredTypes.has(credential_type)
      ) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Invalid credential type '${credential_type}'.`,
                valid_types: [...validCredTypes].sort(),
              }),
            },
          ],
        };
      }

      const data = await client.get<unknown>(CRED_BASE);
      let items = normalizeItems(data);
      items = applyTypeFilter(items, credential_type, 'type');
      items = applyNameFilter(items, name_contains);
      items = stripSensitiveFields(items);

      return {
        content: [
          {
            type: 'text' as const,
            text: buildListResponse(items, max_items, 'credential'),
          },
        ],
      };
    },
  );

  // =======================================================================
  // Read-only (2 tools)
  // =======================================================================

  registerTool(
    server,
    'list_triggers',
    {
      description:
        'List triggers (notifications and third-party connectors) with optional filtering.\n\n Ref: horizon://knowledge/rest-notifications.' +
        'Safety tier: read-only\n' +
        'Use trigger_type="rest" to list only REST notifications.\n\n',
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
          .describe('Case-insensitive substring filter on trigger name.'),
        trigger_type: z
          .string()
          .optional()
          .describe(
            'Filter by type: "rest", "email", "webhook", "akv", "aws", etc.',
          ),
      }),
    },
    async ({ max_items, name_contains, trigger_type }) => {
      if (trigger_type !== undefined) {
        const err = validateTriggerType(trigger_type);
        if (err !== undefined) {
          return { content: [{ type: 'text' as const, text: err }] };
        }
      }

      const data = await client.get<unknown>(TRIGGER_BASE);
      let items = normalizeItems(data);
      items = applyTypeFilter(items, trigger_type, 'type');
      items = applyNameFilter(items, name_contains);

      return {
        content: [
          {
            type: 'text' as const,
            text: buildListResponse(items, max_items, 'trigger'),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'get_trigger',
    {
      description:
        'Get a single trigger by name.\n\n Ref: horizon://knowledge/rest-notifications.' +
        'Safety tier: read-only\n' +
        'Returns the full trigger configuration including sequence steps, ' +
        'authentication, headers, and payload templates for REST notifications.\n\n',
      inputSchema: z.object({
        name: z.string().describe('Exact trigger name.'),
      }),
    },
    async ({ name }) => {
      const result = await client.get(
        `${TRIGGER_BASE}/${encodePathSegment(name)}`,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // =======================================================================
  // Create (1 tool)
  // =======================================================================

  registerTool(
    server,
    'create_rest_notification',
    {
      description:
        'Create a REST notification for custom certificate deployment or integration.\n\n' +
        'Safety tier: mutating-safe\n' +
        'REST notifications execute a sequence of HTTP requests when a certificate ' +
        'lifecycle event occurs. Each step can reference template variables from the ' +
        "certificate/request dictionary and from previous steps' responses.\n\n" +
        'IMPORTANT: Trigger names are IMMUTABLE after creation. Always ask the\n' +
        'user for the name before creating.\n\n' +
        'Each step in the sequence is a dict with these fields:\n' +
        '    - url (required): Target URL - supports {{variable}} template strings\n' +
        '    - method (required): HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD)\n' +
        '    - authenticationType (required): "noauth", "basic", "bearer", "x509", or "custom"\n' +
        '    - credentials (required unless noauth): Name of credential in Horizon\n' +
        '    - expectedHttpCodes (required): List of HTTP codes meaning success (e.g., [200, 201])\n' +
        '    - timeout (required): Duration string (e.g., "30 seconds")\n' +
        '    - headers: List of {name, value} dicts - values support {{variable}} templates\n' +
        '    - payloadType: "json", "text", or "none"\n' +
        '    - payload: Request body - supports {{variable}} template strings\n' +
        '    - proxy: Name of HTTP proxy in Horizon\n\n' +
        'Template variables available in URL, headers, and payload:\n' +
        '    - Certificate: {{certificate.pem}}, {{certificate.serial}}, {{certificate.subject.cn.1}},\n' +
        '      {{certificate.san.dnsname.1}}, {{certificate.thumbprint}}, {{certificate.private_key}}, etc.\n' +
        '    - Request: {{request.id}}, {{request.workflow}}, {{request.requester}}, etc.\n' +
        '    - Previous cert (on_renew only): {{previous.certificate.serial}}, etc.\n' +
        '    - Credentials (custom auth): {{credentials.key}}, {{credentials.login}}, {{credentials.password}}\n' +
        '    - Response chaining: {{rest.response.1.field}}, {{rest.response.2.field.nested}}, etc.\n' +
        '    - Computation rules: {{Upper({{certificate.subject.cn.1}})}}, {{Base64(Raw({{certificate.pem}}))}}, etc.\n\n' +
        'See horizon://knowledge/rest-notifications for the complete dictionary reference\n' +
        'and multi-step chaining patterns.\n\n' +
        'Common patterns:\n' +
        '    - Single-step deployment: POST cert PEM + key to a target API\n' +
        '    - OAuth + deploy: Step 1 gets token, step 2 uses {{rest.response.1.access_token}}\n' +
        '    - Lookup + update: Step 1 finds resource ID, step 2 updates by ID\n' +
        '    - Create + activate: Step 1 creates resource, step 2 activates it\n\n' +
        'After creating, attach the trigger to a profile using the Horizon UI or API\n' +
        'to start receiving events. See horizon://knowledge/automation for attachment.\n\n' +
        '    list_triggers (verify creation), get_trigger (inspect config),\n' +
        '    delete_trigger (remove).',
      inputSchema: z.object({
        name: z
          .string()
          .describe('Unique trigger name (immutable primary key).'),
        event: z
          .string()
          .describe(
            'Single lifecycle event to subscribe to. ' +
              'Examples: "on_enroll", "on_revoke", "on_renew", "on_expire".',
          ),
        sequence: z
          .array(z.record(z.string(), z.unknown()))
          .describe(
            'Ordered list of REST call steps. Each step: ' +
              '{url, method, authenticationType, expectedHttpCodes, timeout, ...}.',
          ),
        retries: z
          .number()
          .int()
          .default(10)
          .describe(
            'Retry count on failure with exponential backoff (default 10).',
          ),
        run_period: z
          .string()
          .optional()
          .describe(
            'Duration for periodic events (e.g. "30 days"). ' +
              'MANDATORY for on_expire, on_pending_*, on_license_expiration, ' +
              'on_credentials_expiration. FORBIDDEN for all other events.',
          ),
        run_on_renewed: z
          .boolean()
          .optional()
          .describe(
            'Whether to fire even if certificate was renewed. ' +
              'MANDATORY for on_expire only.',
          ),
        licence_usage_percent: z
          .number()
          .int()
          .optional()
          .describe(
            'Threshold 1-100 for on_license_usage. ' +
              'MANDATORY for on_license_usage only.',
          ),
        on_trigger_error: z
          .array(z.string())
          .optional()
          .describe('Names of triggers to fire if this notification fails.'),
      }),
    },
    async ({
      name,
      event,
      sequence,
      retries,
      run_period,
      run_on_renewed,
      licence_usage_percent,
      on_trigger_error,
    }) => {
      const eventErr = validateEvent(event);
      if (eventErr !== undefined) {
        return { content: [{ type: 'text' as const, text: eventErr }] };
      }

      if (sequence.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'sequence must contain at least one REST call step.',
                hint: 'See horizon://knowledge/rest-notifications for step format.',
              }),
            },
          ],
        };
      }

      for (let i = 0; i < sequence.length; i++) {
        const stepErr = validateSequenceStep(
          sequence[i] as Record<string, unknown>,
          i,
        );
        if (stepErr !== undefined) {
          return { content: [{ type: 'text' as const, text: stepErr }] };
        }
      }

      if (EVENTS_REQUIRING_RUN_PERIOD.has(event) && !run_period) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `run_period is MANDATORY for event '${event}'.`,
                hint: "Examples: '30 days', '24h', '7d'.",
              }),
            },
          ],
        };
      }

      if (event === 'on_expire' && run_on_renewed === undefined) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: "run_on_renewed is MANDATORY for event 'on_expire'.",
                hint: 'Set to true to fire even if the certificate was already renewed, false otherwise.',
              }),
            },
          ],
        };
      }

      if (event === 'on_license_usage' && licence_usage_percent === undefined) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  "licence_usage_percent is MANDATORY for event 'on_license_usage'.",
                hint: 'Integer between 1 and 100.',
              }),
            },
          ],
        };
      }

      const body: Record<string, unknown> = {
        name,
        type: 'rest',
        events: [event],
        retries,
        sequence,
      };
      if (run_period !== undefined) body['runPeriod'] = run_period;
      if (run_on_renewed !== undefined) body['runOnRenewed'] = run_on_renewed;
      if (licence_usage_percent !== undefined) {
        body['licenceUsagePercent'] = licence_usage_percent;
      }
      if (on_trigger_error !== undefined) {
        body['triggers'] = { onTriggerError: on_trigger_error };
      }

      const result = await client.post<Record<string, unknown>>(
        TRIGGER_BASE,
        body,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: buildMutateResponse({
              action: 'created',
              kind: 'trigger',
              name,
              data: result,
              nextSteps:
                'A notification fires only when bound to a certificate profile ' +
                'for specific events. Ask the user which certificate profile(s) ' +
                'and which events (enroll, revoke, renew), then add this ' +
                'notification name to each profile via update_certificate_profile ' +
                '(config.triggers.onEnroll / onRevoke / onRenew). Do not infer - ' +
                'ask the user.',
            }),
          },
        ],
      };
    },
  );

  // =======================================================================
  // Delete (1 tool)
  // =======================================================================

  registerTool(
    server,
    'delete_trigger',
    {
      description:
        'Delete a trigger. Requires name confirmation.\n\n Ref: horizon://knowledge/rest-notifications.' +
        'A trigger should be detached from all profiles before deletion.\n\n' +
        'Safety tier: mutating-destructive\n',
      inputSchema: z.object({
        name: z.string().describe('Trigger name to delete.'),
        expected_name: z
          .string()
          .describe('Must exactly match name as a deletion safeguard.'),
      }),
    },
    async ({ name, expected_name }) => {
      deleteGuard(name, expected_name);
      await client.delete(`${TRIGGER_BASE}/${encodePathSegment(name)}`);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              deleted: true,
              name,
              kind: 'trigger',
            }),
          },
        ],
      };
    },
  );

  // =======================================================================
  // Simulate (1 tool)
  // =======================================================================

  registerTool(
    server,
    'simulate_trigger',
    {
      description:
        'Test-fire an existing trigger without real certificate context.\n\n Ref: horizon://knowledge/rest-notifications.' +
        'Safety tier: read-only (executes the trigger but uses test context only)\n' +
        'Sends a PATCH request to simulate the trigger. The trigger must already ' +
        'exist. Horizon executes it with a synthetic test context and returns the ' +
        'execution result.\n\n' +
        "Use this to verify that a REST notification's sequence steps, authentication,\n" +
        'and URL/payload templates work correctly before attaching the trigger to a\n' +
        'production profile.\n\n' +
        'Note: Template variables like {{certificate.serial}} will not have real\n' +
        'values during simulation - they are filled with test/placeholder data.\n\n' +
        'Typical workflow:\n' +
        '    1. Create a REST notification with create_rest_notification\n' +
        '    2. Call simulate_trigger to verify the HTTP calls succeed\n' +
        '    3. If simulation passes, attach the trigger to a profile\n' +
        '    4. If simulation fails, inspect errors, fix config, and retry\n\n' +
        '    get_trigger (inspect current config).',
      inputSchema: z.object({
        name: z.string().describe('Name of the existing trigger to simulate.'),
      }),
    },
    async ({ name }) => {
      const trigger = await client.get<Record<string, unknown>>(
        `${TRIGGER_BASE}/${encodePathSegment(name)}`,
      );
      const result = await client.patch(TRIGGER_BASE, { trigger });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
