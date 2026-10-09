/** WebRA challenge tool (Horizon 2.11+). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { HorizonError, scrubSecretFromError } from '../../client/errors.js';
import type { HorizonClient } from '../../client/http.js';
import { registerTool } from '../register.js';

export function registerChallengeTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'submit_webra_challenge',
    {
      description:
        'Consume a one-time WebRA challenge and enroll the certificate it authorizes (Horizon 2.11+). The challenge comes from an enroll request on a WebRA profile whose authorizationMode is "challenge": it is in the `password.value` field of the submit_request response, or of the approve_request response when the request was pending. The challenge is single-use, time-limited, and bound to its profile. The enrollment is synchronous and returns `certificate` (PEM). In centralized mode (template.keyType) the response also returns `pkcs12` (DER Base64), encrypted with the challenge as its password. Horizon does not keep it: give it to the user at once, because it cannot be retrieved again. Do not repeat the challenge or the PKCS#12 in later messages.',
      inputSchema: z.object({
        profile: z
          .string()
          .describe('Name of the WebRA profile the challenge was issued on.'),
        challenge: z
          .string()
          .describe('The one-time challenge. It is consumed by this call.'),
        template: z
          .record(z.string(), z.unknown())
          .describe('User data for the certificate.'),
      }),
    },
    async ({ profile, challenge, template }) => {
      let result: Record<string, unknown>;
      try {
        result = await client.post<Record<string, unknown>>(
          '/api/v1/challenge/submit',
          { profile, challenge, template },
        );
      } catch (error) {
        throw error instanceof HorizonError
          ? scrubSecretFromError(error, challenge)
          : error;
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
