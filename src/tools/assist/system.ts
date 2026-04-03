import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';

export function registerSystemTools(
  server: McpServer,
  client: HorizonClient,
): void {
  server.registerTool(
    'whoami',
    {
      description:
        "Return the authenticated principal's identity and permissions.\n\n" +
        'Safety tier: read-only\n\n' +
        'Fetches the current authenticated principal information from ' +
        'Horizon, including identifier, roles, teams, and permissions. ' +
        'Useful for verifying connectivity and understanding what the ' +
        'current API key or session can access.\n\n' +
        "IMPORTANT - Ownership queries: When searching for 'my certificates' " +
        "or 'certificates I own', use both the identifier AND team list from " +
        'this response to build the HCQL query:\n' +
        '  owner equals "<identifier>" or team in ("<team1>", "<team2>", ...)\n' +
        'This captures both direct ownership and indirect team-based ownership. ' +
        'See horizon://knowledge/query-languages for full ownership patterns.\n\n' +
        'See also: search_certificates (use identifier + teams for ownership queries).',
    },
    async () => {
      const result = await client.get('/api/v1/security/principals/self');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'get_license_info',
    {
      description:
        'Return Horizon license information.\n\n' +
        'Safety tier: read-only\n\n' +
        'Fetches license details including licensed modules, expiry date, ' +
        'certificate quotas, and feature flags. Useful for understanding ' +
        'what capabilities are available on this Horizon instance.',
    },
    async () => {
      const result = await client.get('/api/v1/license');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'explain_grading_policy',
    {
      description:
        'Explain a grading policy and optionally evaluate a certificate against it.\n\n' +
        'Safety tier: read-only\n\n' +
        'Fetches the full grading policy definition (criteria, thresholds, ' +
        'grade mapping). If a certificate PEM is provided, also evaluates ' +
        'the certificate against the policy and returns the resulting grade ' +
        'with per-rule breakdown.',
      inputSchema: z.object({
        policy_name: z
          .string()
          .describe('Name of the grading policy to inspect.'),
        certificate_pem: z
          .string()
          .optional()
          .describe(
            'Optional PEM-encoded certificate to evaluate against the policy.',
          ),
      }),
    },
    async ({ policy_name, certificate_pem }) => {
      const encodedName = encodeURIComponent(policy_name);
      const policy = await client.get(
        `/api/v1/grading/policies/${encodedName}`,
      );

      const response: Record<string, unknown> = { policy };

      if (certificate_pem !== undefined) {
        const evaluation = await client.post(
          `/api/v1/grading/policies/${encodedName}/evaluate`,
          { pem: certificate_pem },
        );
        response['evaluation'] = evaluation;
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  server.registerTool(
    'explain_grading_ruleset',
    {
      description:
        'Explain a grading ruleset and optionally evaluate a certificate against it.\n\n' +
        'Safety tier: read-only\n\n' +
        'Fetches the full grading ruleset definition (individual rules, ' +
        'conditions, weights). If a certificate PEM is provided, also ' +
        'evaluates the certificate against the ruleset and returns the ' +
        'per-rule pass/fail breakdown.',
      inputSchema: z.object({
        ruleset_name: z
          .string()
          .describe('Name of the grading ruleset to inspect.'),
        certificate_pem: z
          .string()
          .optional()
          .describe(
            'Optional PEM-encoded certificate to evaluate against the ruleset.',
          ),
      }),
    },
    async ({ ruleset_name, certificate_pem }) => {
      const encodedName = encodeURIComponent(ruleset_name);
      const ruleset = await client.get(
        `/api/v1/grading/rulesets/${encodedName}`,
      );

      const response: Record<string, unknown> = { ruleset };

      if (certificate_pem !== undefined) {
        const evaluation = await client.post(
          `/api/v1/grading/rulesets/${encodedName}/evaluate`,
          { pem: certificate_pem },
        );
        response['evaluation'] = evaluation;
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );
}
