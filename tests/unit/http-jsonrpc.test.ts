import { describe, expect, it } from 'vitest';

import {
  firstId,
  jsonRpcErrorBody,
  messagesOf,
  methodsOf,
  validateInitialize,
} from '../../src/http/jsonrpc.js';

describe('messagesOf', () => {
  it('wraps a single object', () => {
    expect(messagesOf({ method: 'x' })).toEqual([{ method: 'x' }]);
  });
  it('passes an array through', () => {
    expect(messagesOf([{ method: 'a' }, { method: 'b' }])).toHaveLength(2);
  });
  it('treats null/undefined as empty', () => {
    expect(messagesOf(undefined)).toEqual([]);
    expect(messagesOf(null)).toEqual([]);
  });
});

describe('methodsOf', () => {
  it('extracts methods, ignoring non-method entries', () => {
    expect(methodsOf([{ method: 'tools/call' }, { id: 1 }])).toEqual([
      'tools/call',
    ]);
  });
});

describe('firstId', () => {
  it('returns the first message id', () => {
    expect(firstId({ id: 7, method: 'initialize' })).toBe(7);
  });
  it('returns null when there is no id', () => {
    expect(firstId({ method: 'x' })).toBeNull();
  });
});

describe('validateInitialize', () => {
  it('accepts a single initialize message', () => {
    expect(validateInitialize({ method: 'initialize', id: 1 }).ok).toBe(true);
  });
  it('rejects an empty body', () => {
    expect(validateInitialize(undefined).ok).toBe(false);
  });
  it('rejects a batch', () => {
    expect(
      validateInitialize([
        { method: 'initialize', id: 1 },
        { method: 'initialize', id: 2 },
      ]).ok,
    ).toBe(false);
  });
  it('rejects a first message that is not initialize', () => {
    expect(validateInitialize({ method: 'tools/list', id: 1 }).ok).toBe(false);
  });
});

describe('jsonRpcErrorBody', () => {
  it('builds a JSON-RPC error envelope echoing the id', () => {
    expect(jsonRpcErrorBody(5, -32600, 'bad')).toEqual({
      jsonrpc: '2.0',
      id: 5,
      error: { code: -32600, message: 'bad' },
    });
  });
  it('defaults a missing id to null', () => {
    expect(jsonRpcErrorBody(undefined, -32600, 'bad').id).toBeNull();
  });
});
