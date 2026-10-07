/**
 * WebRA challenge tool (Horizon 2.11+).
 *
 * 1 MCP tool:
 *   - submit_webra_challenge
 *
 * POST /api/v1/challenge/submit consumes a one-time WebRA challenge and
 * enrolls the certificate it authorizes. The response is returned as is:
 * in centralized mode it holds the only copy of the PKCS#12, so it must not
 * go through the mutation formatter, which redacts `pkcs12`. The HTTP client
 * logs only the method, path and status, never the body.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { registerTool } from '../register.js';

const SUBMIT_WEBRA_CHALLENGE_CONFIG = {
  description:
    'Consume a one-time WebRA challenge and enroll the certificate it ' +
    'authorizes (Horizon 2.11+). The challenge comes from an enroll request ' +
    'on a WebRA profile whose authorizationMode is "challenge": it is in the ' +
    '`password.value` field of the submit_request response, or of the ' +
    'approve_request response when the request was pending. The challenge is ' +
    'single-use, time-limited, and bound to its profile. An expired, consumed ' +
    'or wrong-profile challenge fails with WEBRA-ENROLL-015. The enrollment ' +
    'is synchronous and returns `certificate` (PEM). In centralized mode ' +
    '(template.keyType) the response also returns `pkcs12` (DER Base64), ' +
    'encrypted with the challenge as its password. Horizon does not keep it: ' +
    'give it to the user at once, because it cannot be retrieved again. Do ' +
    'not repeat the challenge or the PKCS#12 in later messages.',
  inputSchema: z.object({
    profile: z
      .string()
      .describe('Name of the WebRA profile the challenge was issued on.'),
    challenge: z
      .string()
      .describe('The one-time challenge. It is consumed by this call.'),
    template: z
      .record(z.string(), z.unknown())
      .describe(
        'User data for the certificate:\n' +
          '- keyType: key type for centralized generation, e.g. "rsa-2048". ' +
          'Mutually exclusive with csr.\n' +
          '- csr: PEM CSR for decentralized enrollment. Mutually exclusive ' +
          'with keyType.\n' +
          '- subject, sans, extensions: accepted only when the profile ' +
          'certificate template is empty. Otherwise the identity comes from ' +
          'the challenge request.\n' +
          '- metadata: only the automation_policy metadata, set to a policy ' +
          'authorized on the profile.',
      ),
  }),
};

export function registerChallengeTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'submit_webra_challenge',
    SUBMIT_WEBRA_CHALLENGE_CONFIG,
    async ({ profile, challenge, template }) => {
      const result = await client.post<Record<string, unknown>>(
        '/api/v1/challenge/submit',
        { profile, challenge, template },
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
