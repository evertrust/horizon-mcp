import { getLogger } from '../logging.js';
import { currentRequestSignal } from './request-signal.js';

const logger = getLogger('horizon_mcp.client.retry');

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Retry a fetch thunk with exponential backoff.
 * Only retries on retryable status codes and connection errors.
 * Respects Retry-After header on 429 responses.
 */
export async function withRetry(
  fn: () => Promise<Response>,
  opts: RetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 10000;
  const signal = currentRequestSignal();

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal?.throwIfAborted();
    try {
      const response = await fn();

      // Check status BEFORE consuming body
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) {
        return response;
      }

      // Retryable status - compute delay
      let delayMs = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs,
      );

      // Respect Retry-After header on 429
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterSeconds)) {
            // Clamp to [0, maxDelayMs/1000] to defend against
            // pathological server responses (negative or astronomical).
            const maxRetryAfterSeconds = Math.floor(maxDelayMs / 1000);
            const clamped = Math.min(
              Math.max(retryAfterSeconds, 0),
              maxRetryAfterSeconds,
            );
            delayMs = clamped * 1000;
          } else {
            logger.warning(
              `Invalid Retry-After header '${retryAfter}' - falling back to exponential delay`,
            );
          }
        }
      }

      logger.info(
        `Retryable status ${response.status} (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`,
      );
      await sleep(delayMs, signal);
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
      lastError = err;
      if (attempt === maxAttempts) break;

      const delayMs = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs,
      );
      logger.info(
        `Connection error (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${err}`,
      );
      await sleep(delayMs, signal);
    }
  }

  throw lastError;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  signal.throwIfAborted();
  const abortSignal = signal;

  return new Promise((resolve, reject) => {
    function onAbort() {
      clearTimeout(timeout);
      abortSignal.removeEventListener('abort', onAbort);
      reject(abortSignal.reason);
    }
    const timeout = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    abortSignal.addEventListener('abort', onAbort, { once: true });
    if (abortSignal.aborted) onAbort();
  });
}
