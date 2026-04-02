import { getLogger } from "../logging.js";

const logger = getLogger("horizon_mcp.client.retry");

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

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterSeconds)) {
            delayMs = retryAfterSeconds * 1000;
          }
        }
      }

      logger.info(
        `Retryable status ${response.status} (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`,
      );
      await sleep(delayMs);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;

      const delayMs = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs,
      );
      logger.info(
        `Connection error (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${err}`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
