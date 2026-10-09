import { type HorizonError, parseErrorResponse } from './errors.js';

export function parseCredentialError(
  status: number,
  body: string,
  headers: Record<string, string>,
): HorizonError {
  for (const [name, value] of Object.entries(headers)) {
    if (value && /^(x-api-key|x-api-token|authorization)$/i.test(name)) {
      body = body.replaceAll(value, '[REDACTED]');
    }
  }
  return parseErrorResponse(status, body);
}
