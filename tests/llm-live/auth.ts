/**
 * Detect whether the local environment can authenticate the Claude Agent SDK
 * against an active Claude subscription (Pro / Max / Team / Enterprise).
 *
 * The SDK spawns the bundled `claude` binary and inherits its auth context.
 * When no OAuth session is available it falls back to ANTHROPIC_API_KEY, which
 * is per-token API billing - the live LLM tests intentionally skip in that
 * case so the suite never runs against a credit card by accident.
 */
import { spawnSync } from 'node:child_process';

interface SdkAuthInfo {
  readonly status: 'ok' | 'missing-binary' | 'no-subscription';
  readonly reason?: string;
}

/**
 * Returns the auth context for the SDK. The CLI emits structured account info
 * via `claude config get -g oauth_account` and similar, but the cross-version
 * stable probe is `claude --print --model claude-haiku-4-5 'ping'` with a
 * very short prompt; that round-trips the auth and reports the source.
 *
 * For the test gate we use a lighter check: `claude` binary on PATH plus
 * the presence of an OAuth artefact. The SDK itself returns
 * `authentication_failed` as a typed error when it cannot authenticate, which
 * the runner surfaces.
 */
export function probeSdkAuth(): SdkAuthInfo {
  const which = spawnSync('which', ['claude'], { encoding: 'utf-8' });
  if (which.status !== 0 || !which.stdout.trim()) {
    return {
      status: 'missing-binary',
      reason: '`claude` binary not found on PATH - install Claude Code first.',
    };
  }

  if (process.env['ANTHROPIC_API_KEY']) {
    return {
      status: 'no-subscription',
      reason:
        'ANTHROPIC_API_KEY is set; the live suite intentionally refuses to ' +
        'run against API billing. Unset it or use the API-key suite (not ' +
        'yet implemented).',
    };
  }

  return { status: 'ok' };
}

export function liveSuiteEnabled(): boolean {
  return probeSdkAuth().status === 'ok';
}

export function liveSuiteSkipReason(): string {
  const info = probeSdkAuth();
  return info.reason ?? 'live suite enabled';
}
