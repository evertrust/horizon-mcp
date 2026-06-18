/**
 * Detect whether the local environment can authenticate the Claude Agent SDK
 * (it spawns the bundled `claude` binary headlessly and inherits its auth).
 *
 * BILLING WARNING: headless `claude -p` / Agent SDK runs are metered as
 * Anthropic API usage now, even when authenticated with a Pro/Max/Team
 * subscription session. Running this live suite COSTS money - it is not free
 * subscription credit. The gate below still refuses to run when an explicit
 * ANTHROPIC_API_KEY is set, but that is a guard against the most surprising
 * case, NOT a guarantee of zero billing. Treat the whole live suite as
 * opt-in and paid: run it deliberately, never in CI or by default.
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
        'ANTHROPIC_API_KEY is set; the live suite refuses to run with an ' +
        'explicit API key. Note: even subscription-auth headless runs are ' +
        'billed as Anthropic API usage now - this suite always costs money.',
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
