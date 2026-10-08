/**
 * Live-QA E2E coverage for the Horizon 2.11 WebRA challenge flow:
 *   1. submit_request enrolls on a WebRA profile in "challenge" authorization
 *      mode and returns the one-time challenge in password.value.
 *   2. submit_webra_challenge consumes it. In centralized mode (keyType) the
 *      response holds the certificate and the PKCS#12. In decentralized mode
 *      (csr) it holds the certificate only.
 *   3. A second submission of the same challenge fails with WEBRA-ENROLL-015.
 *
 * Profile selection, per key generation mode:
 *   - HORIZON_E2E_WEBRA_CHALLENGE_PROFILE set: that profile only. Any
 *     enrollment error fails the test.
 *   - Not set: the enabled WebRA profiles in "challenge" mode whose
 *     cryptoPolicy allows the mode. A profile whose template does not accept
 *     the test subject (REQ-002) is passed over; any other error fails.
 * A mode is skipped only when no profile allows it (for example on Horizon
 * 2.10, which has no challenge mode).
 *
 * The decentralized case builds its CSR with the `openssl` command line. The
 * challenge and the PKCS#12 are never logged. Issued certificates are revoked
 * in teardown.
 */
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  ToolError,
  callTool,
  getHorizonClient,
  setupE2EStack,
} from './setup.js';

type KeyMode = 'centralized' | 'decentralized';

interface Candidate {
  readonly name: string;
  /** cryptoPolicy.defaultKeyType of the profile, e.g. "rsa-3072". */
  readonly keyType: string;
}

interface Enrollment extends Candidate {
  readonly challenge: string;
}

const configuredProfile = process.env['HORIZON_E2E_WEBRA_CHALLENGE_PROFILE'];

function commonName(mode: KeyMode): string {
  return `${E2E_PREFIX}-${mode}.example.com`;
}

function toCandidate(
  profile: Record<string, unknown>,
  mode: KeyMode,
): Candidate | undefined {
  const cryptoPolicy = (profile['cryptoPolicy'] ?? {}) as Record<
    string,
    unknown
  >;
  if (cryptoPolicy[mode] !== true) return undefined;
  return {
    name: String(profile['name']),
    keyType: String(cryptoPolicy['defaultKeyType'] ?? 'rsa-2048'),
  };
}

/** Challenge profiles that allow `mode`, in instance order. */
async function candidateProfiles(mode: KeyMode): Promise<Candidate[]> {
  const client = getHorizonClient();
  const profiles = configuredProfile
    ? [
        await client.get<Record<string, unknown>>(
          `/api/v1/certificate/profiles/${encodeURIComponent(configuredProfile)}`,
        ),
      ]
    : (
        await client.get<Array<Record<string, unknown>>>(
          '/api/v1/certificate/profiles',
        )
      ).filter(
        (p) =>
          p['module'] === 'webra' &&
          p['authorizationMode'] === 'challenge' &&
          p['enabled'] === true,
      );
  return profiles.flatMap((p) => toCandidate(p, mode) ?? []);
}

/** Enroll on the candidate and return the challenge from password.value. */
async function enroll(candidate: Candidate, cn: string): Promise<Enrollment> {
  const request = await callTool('submit_request', {
    workflow: 'enroll',
    module: 'webra',
    profile: candidate.name,
    template: { subject: [{ element: 'cn.1', type: 'CN', value: cn }] },
  });
  const password = request['password'] as Record<string, unknown> | undefined;
  if (typeof password?.['value'] !== 'string') {
    throw new Error(
      `Enrollment on ${candidate.name} returned no challenge in password.value (status: ${String(request['status'])})`,
    );
  }
  return { ...candidate, challenge: password['value'] };
}

/**
 * Enroll on the first candidate that accepts the test subject. Returns
 * undefined only when there is no candidate for `mode`.
 */
async function enrollForMode(mode: KeyMode): Promise<Enrollment | undefined> {
  const candidates = await candidateProfiles(mode);
  if (candidates.length === 0) return undefined;
  if (configuredProfile) return enroll(candidates[0]!, commonName(mode));
  const rejected: string[] = [];
  for (const candidate of candidates) {
    try {
      return await enroll(candidate, commonName(mode));
    } catch (err) {
      const isTemplateMismatch =
        err instanceof ToolError && err.message.includes('[REQ-002]');
      if (!isTemplateMismatch) throw err;
      rejected.push(candidate.name);
    }
  }
  throw new Error(
    `No ${mode} challenge profile accepts the test subject (REQ-002 on: ${rejected.join(', ')}). ` +
      'Set HORIZON_E2E_WEBRA_CHALLENGE_PROFILE to a profile with an editable cn.1.',
  );
}

/** openssl -newkey arguments for a Horizon key type ("rsa-3072", "ec-p256"). */
function newKeyArgs(keyType: string): string[] {
  const rsa = /^rsa-(\d+)$/.exec(keyType);
  if (rsa) return ['-newkey', `rsa:${rsa[1]}`];
  const ec = /^ec-p(\d+)$/.exec(keyType);
  if (ec) {
    return ['-newkey', 'ec', '-pkeyopt', `ec_paramgen_curve:P-${ec[1]}`];
  }
  throw new Error(`No CSR recipe for key type "${keyType}"`);
}

function generateCsr(cn: string, keyType: string): string {
  return execFileSync(
    'openssl',
    [
      'req',
      '-new',
      ...newKeyArgs(keyType),
      '-nodes',
      '-keyout',
      '/dev/null',
      '-subj',
      `/CN=${cn}`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
}

async function expectChallengeConsumed(enrollment: Enrollment): Promise<void> {
  let message = '';
  try {
    await callTool('submit_webra_challenge', {
      profile: enrollment.name,
      challenge: enrollment.challenge,
      template: { keyType: enrollment.keyType },
    });
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    message = (err as ToolError).message;
  }
  expect(message).toContain('WEBRA-ENROLL-015');
}

async function revokeIssuedCertificates(): Promise<void> {
  const search = await callTool('search_certificates', {
    query: `dn contains "${E2E_PREFIX}-"`,
    page_size: 10,
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

  let issued = false;

  afterAll(async () => {
    if (!issued) return;
    try {
      await revokeIssuedCertificates();
    } catch (err) {
      // Best effort: never fail the suite on teardown.
      console.warn(
        `[webra-challenge] Could not revoke the test certificates: ${(err as Error).message}`,
      );
    }
  });

  it('centralized: returns the certificate and PKCS#12, then rejects reuse', async (ctx) => {
    const enrollment = await enrollForMode('centralized');
    if (!enrollment) {
      console.warn(
        '[webra-challenge] Skipping centralized: no challenge profile allows centralized key generation.',
      );
      ctx.skip();
    }
    issued = true;
    const result = await callTool('submit_webra_challenge', {
      profile: enrollment!.name,
      challenge: enrollment!.challenge,
      template: { keyType: enrollment!.keyType },
    });
    expect(String(result['certificate'])).toContain('BEGIN CERTIFICATE');
    const pkcs12 = result['pkcs12'];
    expect(typeof pkcs12).toBe('string');
    expect((pkcs12 as string).length).toBeGreaterThan(0);

    await expectChallengeConsumed(enrollment!);
  });

  it('decentralized: returns only the certificate for a CSR', async (ctx) => {
    const enrollment = await enrollForMode('decentralized');
    if (!enrollment) {
      console.warn(
        '[webra-challenge] Skipping decentralized: no challenge profile allows decentralized key generation.',
      );
      ctx.skip();
    }
    issued = true;
    const result = await callTool('submit_webra_challenge', {
      profile: enrollment!.name,
      challenge: enrollment!.challenge,
      template: {
        csr: generateCsr(commonName('decentralized'), enrollment!.keyType),
      },
    });
    expect(String(result['certificate'])).toContain('BEGIN CERTIFICATE');
    expect(result['pkcs12']).toBeUndefined();
  });
});
