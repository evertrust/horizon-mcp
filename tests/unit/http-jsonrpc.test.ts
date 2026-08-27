import { describe, expect, it } from 'vitest';

import { firstId, jsonRpcErrorBody } from '../../src/http/jsonrpc.js';

describe('firstId input normalization', () => {
  it('reads an id from a single object', () => {
    expect(firstId({ id: 7, method: 'x' })).toBe(7);
  });
  it('reads the first id in a batch', () => {
    expect(
      firstId([
        { id: 'a', method: 'a' },
        { id: 'b', method: 'b' },
      ]),
    ).toBe('a');
  });
  it('treats null and undefined as empty', () => {
    expect(firstId(undefined)).toBeNull();
    expect(firstId(null)).toBeNull();
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
