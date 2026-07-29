export type JsonRpcId = string | number | null;

interface JsonRpcMessage {
  method?: unknown;
  id?: unknown;
}

/** Normalize a parsed JSON-RPC body (object, batch array, or empty) to a list. */
export function messagesOf(body: unknown): JsonRpcMessage[] {
  if (Array.isArray(body)) return body as JsonRpcMessage[];
  if (body === null || body === undefined) return [];
  return [body as JsonRpcMessage];
}

/** The method names present in the body (skips entries without a method). */

/** The id of the first message, or null. */
export function firstId(body: unknown): JsonRpcId {
  const msg = messagesOf(body)[0];
  if (msg && (typeof msg.id === 'string' || typeof msg.id === 'number')) {
    return msg.id;
  }
  return null;
}

export function jsonRpcErrorBody(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
): { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string } } {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}
