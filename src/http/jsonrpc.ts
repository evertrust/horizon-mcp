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
export function methodsOf(body: unknown): string[] {
  return messagesOf(body)
    .map((m) => (typeof m?.method === 'string' ? m.method : ''))
    .filter((m) => m.length > 0);
}

/** The id of the first message, or null. */
export function firstId(body: unknown): JsonRpcId {
  const msg = messagesOf(body)[0];
  if (msg && (typeof msg.id === 'string' || typeof msg.id === 'number')) {
    return msg.id;
  }
  return null;
}

/**
 * A no-session POST must carry exactly one `initialize` message. Reject empty
 * bodies, batches, and any non-initialize first message.
 */
export function validateInitialize(
  body: unknown,
): { ok: true } | { ok: false; reason: string } {
  const msgs = messagesOf(body);
  if (msgs.length === 0) return { ok: false, reason: 'empty request body' };
  if (msgs.length > 1) {
    return { ok: false, reason: 'a batch cannot open a session' };
  }
  if (msgs[0]?.method !== 'initialize') {
    return { ok: false, reason: 'first message must be initialize' };
  }
  return { ok: true };
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
