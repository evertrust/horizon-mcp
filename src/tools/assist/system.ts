import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { encodePathSegment } from '../helpers.js';
import { registerTool } from '../register.js';

export function registerSystemTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'whoami',
    {
      description:
        "Return the authenticated principal's identity and permissions. " +
        'For ownership queries combine the identifier and team list: ' +
        '`owner equals "<id>" or team in ("<t1>", ...)`. ' +
        'See horizon://knowledge/query-languages for ownership patterns.',
      outputSchema: {
        identifier: z.string().optional(),
        name: z.string().optional(),
        team: z.string().optional(),
        teams: z.array(z.string()).optional(),
        roles: z.array(z.unknown()).optional(),
        permissions: z.unknown().optional(),
      },
    },
    async () => {
      const result = (await client.get(
        '/api/v1/security/principals/self',
      )) as Record<string, unknown>;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  registerTool(
    server,
    'get_license_info',
    {
      description:
        'Return Horizon license info: modules, expiry, quotas, feature flags.',
      outputSchema: {
        version: z.string().optional(),
        expiry: z.string().optional(),
        modules: z.array(z.string()).optional(),
        features: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async () => {
      const result = (await client.get('/api/v1/licenses')) as Record<
        string,
        unknown
      >;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  registerTool(
    server,
    'explain_grading_policy',
    {
      description:
        'Explain a grading policy and optionally explain how a certificate scores against it.\n\n' +
        'Fetches the full grading policy definition (criteria, thresholds, ' +
        'grade mapping). If a certificate PEM is provided, also calls ' +
        "Horizon's certificate-explain endpoint and returns the resulting " +
        'grade analysis with per-rule breakdown.',
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
      const encodedName = encodePathSegment(policy_name);
      const policy = await client.get(
        `/api/v1/certificate/grading/policies/${encodedName}`,
      );

      const response: Record<string, unknown> = { policy };

      if (certificate_pem !== undefined) {
        const explanation = await client.postMultipart(
          `/api/v1/certificate/grading/policies/${encodedName}/explain`,
          [
            {
              fieldName: 'x509',
              filename: 'certificate.pem',
              mimeType: 'application/x-pem-file',
              data: certificate_pem,
            },
          ],
        );
        response['explanation'] = explanation;
        // Compatibility alias for clients that already look for "evaluation".
        response['evaluation'] = explanation;
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );

  registerTool(
    server,
    'explain_grading_ruleset',
    {
      description:
        'Explain a grading ruleset and optionally explain how a certificate scores against it.\n\n' +
        'Fetches the full grading ruleset definition (individual rules, ' +
        'conditions, weights). If a certificate PEM is provided, also ' +
        "calls Horizon's certificate-explain endpoint and returns the " +
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
      const encodedName = encodePathSegment(ruleset_name);
      const ruleset = await client.get(
        `/api/v1/certificate/grading/rulesets/${encodedName}`,
      );

      const response: Record<string, unknown> = { ruleset };

      if (certificate_pem !== undefined) {
        const explanation = await client.postMultipart(
          `/api/v1/certificate/grading/rulesets/${encodedName}/explain`,
          [
            {
              fieldName: 'x509',
              filename: 'certificate.pem',
              mimeType: 'application/x-pem-file',
              data: certificate_pem,
            },
          ],
        );
        response['explanation'] = explanation;
        // Compatibility alias for clients that already look for "evaluation".
        response['evaluation'] = explanation;
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    },
  );
}
