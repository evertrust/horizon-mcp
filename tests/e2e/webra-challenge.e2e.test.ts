/**
 * Live-QA E2E coverage for the Horizon 2.11 WebRA challenge flow:
 *   1. submit_request enrolls on a WebRA profile in "challenge" authorization
 *      mode and returns the one-time challenge in password.value.
 *   2. submit_webra_challenge consumes it and returns the certificate and, in
 *      centralized mode, the PKCS#12.
 *   3. A second submission of the same challenge fails with WEBRA-ENROLL-015.
 *
 * The profile comes from HORIZON_E2E_WEBRA_CHALLENGE_PROFILE, or else from the
 * first enabled WebRA profile in "challenge" mode on the instance. The suite
 * skips when there is none (for example on Horizon 2.10). The challenge and the
 * PKCS#12 are never logged. The issued certificate is revoked in teardown.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

const commonName = `${E2E_PREFIX}-challenge.example.com`;

async function findChallengeProfiles(): Promise<string[]> {
  const configured = process.env['HORIZON_E2E_WEBRA_CHALLENGE_PROFILE'];
  if (configured) return [configured];
  const profiles = await getHorizonClient().get<Array<Record<string, unknown>>>(
    '/api/v1/certificate/profiles',
  );
  return profiles
    .filter(
      (p) =>
        p['module'] === 'webra' &&
        p['authorizationMode'] === 'challenge' &&
        p['enabled'] === true,
    )
    .map((p) => String(p['name']));
}

/** Enroll on the first profile that returns a challenge. */
async function enrollForChallenge(
  candidates: string[],
): Promise<{ profile: string; challenge: string } | undefined> {
  for (const profile of candidates) {
    try {
      const request = await callTool('submit_request', {
        workflow: 'enroll',
        module: 'webra',
        profile,
        template: {
          subject: [{ element: 'cn.1', type: 'CN', value: commonName }],
        },
      });
      const password = request['password'] as
        | Record<string, unknown>
        | undefined;
      if (typeof password?.['value'] === 'string') {
        return { profile, challenge: password['value'] };
      }
    } catch {
      /* this profile needs more fields: try the next one */
    }
  }
  return undefined;
}

async function revokeIssuedCertificate(): Promise<void> {
  const search = await callTool('search_certificates', {
    query: `dn contains "${commonName}"`,
    page_size: 5,
  });
  const results = (search['results'] ?? []) as Array<Record<string, unknown>>;
  for (const certificate of results) {
    const request = await callTool('submit_request', {
      workflow: 'revoke',
      module: 'webra',
      profile: String(certificate['profile']),
      certificate_id: String(certificate['_id']),
      template: { revocationReason: 'cessationofoperation' },
    });
    if (request['status'] === 'pending') {
      await callTool('approve_request', { request_id: String(request['_id']) });
    }
  }
}

describe.skipIf(!E2E_CONFIGURED)('WebRA challenge E2E (live QA)', () => {
  setupE2EStack();

  let enrolled: { profile: string; challenge: string } | undefined;

  beforeAll(async () => {
    enrolled = await enrollForChallenge(await findChallengeProfiles());
    if (!enrolled) {
      console.warn(
        '[webra-challenge] Skipping: no WebRA profile in challenge mode returned a challenge.',
      );
    }
  });

  afterAll(async () => {
    if (!enrolled) return;
    try {
      await revokeIssuedCertificate();
    } catch (err) {
      // Best effort: never fail the suite on teardown.
      console.warn(
        `[webra-challenge] Could not revoke ${commonName}: ${(err as Error).message}`,
      );
    }
  });

  it('consumes the challenge and returns the certificate and PKCS#12', async (ctx) => {
    if (!enrolled) ctx.skip();
    const result = await callTool('submit_webra_challenge', {
      profile: enrolled!.profile,
      challenge: enrolled!.challenge,
      template: { keyType: 'rsa-2048' },
    });
    expect(String(result['certificate'])).toContain('BEGIN CERTIFICATE');
    const pkcs12 = result['pkcs12'];
    expect(typeof pkcs12).toBe('string');
    expect((pkcs12 as string).length).toBeGreaterThan(0);
  });

  it('rejects a second use of the same challenge with WEBRA-ENROLL-015', async (ctx) => {
    if (!enrolled) ctx.skip();
    let message = '';
    try {
      await callTool('submit_webra_challenge', {
        profile: enrolled!.profile,
        challenge: enrolled!.challenge,
        template: { keyType: 'rsa-2048' },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      message = (err as ToolError).message;
    }
    expect(message).toContain('WEBRA-ENROLL-015');
  });
});
