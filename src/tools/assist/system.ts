import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { encodePathSegment } from '../helpers.js';
import { registerTool } from '../register.js';

const WHOAMI_IDENTITY_SCHEMA = z.looseObject({
  identifier: z.string(),
  identityProviderType: z.string(),
  identityProviderName: z.string().nullish(),
  email: z.string().nullish(),
  name: z.string().nullish(),
  certificate: z.string().nullish(),
});

const WHOAMI_OUTPUT_SCHEMA = z.looseObject({
  identity: WHOAMI_IDENTITY_SCHEMA,
  permissions: z.array(
    z.looseObject({
      value: z.string(),
      filter: z.string().nullish(),
    }),
  ),
  roles: z.array(z.string()).nullish(),
  teams: z.array(z.string()).nullish(),
  preferences: z.looseObject({}).nullish(),
  customDashboards: z.array(z.unknown()).nullish(),
  teamInfos: z.array(z.unknown()).nullish(),
  // Injected by HorizonClient from the undocumented whoami field.
  _horizonVersion: z.string().nullish(),
});

const GET_LICENSE_INFO_OUTPUT_SCHEMA = z.looseObject({
  isValid: z.boolean().nullish(),
  version: z.string().nullish(),
  expiration: z.number().nullish(),
  buildTime: z.number().nullish(),
  count: z.number().nullish(),
  dcvCount: z.number().nullish(),
  // Horizon 2.10 returns module entitlements as objects ({ module, items });
  // older instances returned bare module-name strings. Accept either.
  modules: z
    .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
    .nullish(),
  libraries: z.array(z.record(z.string(), z.unknown())).nullish(),
  releaseChannel: z.string().nullish(),
  // Legacy / forward-compatible fields kept permissive.
  expiry: z.string().nullish(),
  features: z.record(z.string(), z.unknown()).nullish(),
});

const WHOAMI_CONFIG = {
  description:
    "Return the authenticated principal's identity and permissions. " +
    'For service accounts, the identifier is ' +
    '`<name>-<sha256(jwt).take(16)>`, or ' +
    '`<name>-<hash16>-<mapped-value>` when `identifierMapping` is configured. ' +
    'The hash segment is always present, so the identity changes when the JWT rotates; ' +
    'identifierMapping adds claim-derived context and does not create a stable identity. ' +
    'Use team-based ownership for anything that must survive token rotation. ' +
    'For ownership queries combine the identifier and team list: ' +
    '`owner equals "<id>" or team in ("<t1>", ...)`. ' +
    'See horizon://knowledge/server-rules and horizon://knowledge/rbac.',
  // Horizon serializes absent collections/values as `null` rather than
  // omitting them (e.g. a principal in no teams gets `teams: null`). The
  // raw response is piped straight into structuredContent, so every field
  // must accept null (.nullish() = nullable + optional) or the MCP output
  // validation rejects the whole whoami response before the client reads it.
  outputSchema: WHOAMI_OUTPUT_SCHEMA,
};

const GET_LICENSE_INFO_CONFIG = {
  description:
    'Return Horizon license info: modules, expiry, quotas, feature flags.',
  // Raw license response is piped straight into structuredContent. Horizon
  // may serialize absent fields as `null` (and the shape drifts across
  // versions), so every field is .nullish() to keep output validation from
  // rejecting an otherwise-valid response.
  outputSchema: GET_LICENSE_INFO_OUTPUT_SCHEMA,
};

const EXPLAIN_GRADING_POLICY_CONFIG = {
  description:
    'Explain a grading policy and optionally explain how a certificate scores against it.\n\n' +
    'Fetches the full grading policy definition (criteria, thresholds, ' +
    'grade mapping). If a certificate PEM is provided, also calls ' +
    "Horizon's certificate-explain endpoint and returns the resulting " +
    'grade analysis with per-rule breakdown.',
  inputSchema: z.object({
    policy_name: z.string().describe('Name of the grading policy to inspect.'),
    certificate_pem: z
      .string()
      .optional()
      .describe(
        'Optional PEM-encoded certificate to evaluate against the policy.',
      ),
  }),
};

const EXPLAIN_GRADING_RULESET_CONFIG = {
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
};

export function registerSystemTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(server, 'whoami', WHOAMI_CONFIG, async () => {
    const result = (await client.get(
      '/api/v1/security/principals/self',
    )) as Record<string, unknown>;
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  });

  registerTool(
    server,
    'get_license_info',
    GET_LICENSE_INFO_CONFIG,
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
    EXPLAIN_GRADING_POLICY_CONFIG,
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
    EXPLAIN_GRADING_RULESET_CONFIG,
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
