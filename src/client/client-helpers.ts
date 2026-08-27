import { HorizonError } from './errors.js';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export const RETRYABLE_ENDPOINTS = new Set<string>();

const CONNECTION_CAUSE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export interface VersionCompatibilityLog {
  level: 'warning';
  message: string;
}

export function positiveSeconds(
  name: string,
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Invalid ${name}: expected a positive finite number, received ${value}`,
    );
  }
  return value;
}

function getCauseCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'cause' in err) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object' && 'code' in cause) {
      return (cause as { code?: string }).code;
    }
  }
  return undefined;
}

export function isConnectionError(err: unknown): boolean {
  const causeCode = getCauseCode(err);
  return (
    (causeCode !== undefined && CONNECTION_CAUSE_CODES.has(causeCode)) ||
    (causeCode === undefined &&
      err instanceof TypeError &&
      String(err).includes('fetch'))
  );
}

export function connectionCauseCode(err: unknown): string | undefined {
  return getCauseCode(err);
}

export async function readJsonBounded<T>(
  resp: Response,
  path: string,
): Promise<T | Record<string, never>> {
  const contentLength = resp.headers.get('content-length');
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new HorizonError(0, {
        message: `Response from ${path} exceeds ${MAX_RESPONSE_BYTES} bytes (Content-Length: ${declared})`,
        remediation:
          'Use a paginated endpoint or narrow the query to reduce payload size.',
      });
    }
  }

  const text = await resp.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new HorizonError(0, {
      message: `Response from ${path} exceeds ${MAX_RESPONSE_BYTES} bytes (received: ${text.length})`,
      remediation:
        'Use a paginated endpoint or narrow the query to reduce payload size.',
    });
  }
  if (!text) return {} as Record<string, never>;
  return JSON.parse(text) as T;
}

export function versionCompatibilityLog(
  version: string,
  testedVersions: readonly string[],
  warnVersions: readonly string[],
): VersionCompatibilityLog | null {
  const match = version.match(/^(\d+\.\d+)/);
  if (!match) return null;
  const majorMinor = match[1]!;

  if (testedVersions.includes(majorMinor)) return null;
  if (warnVersions.includes(majorMinor)) {
    return {
      level: 'warning',
      message: `Horizon version ${version} - partially tested, some features may not work as expected`,
    };
  }
  return {
    level: 'warning',
    message: `Horizon version ${version} - untested, proceed with caution`,
  };
}
