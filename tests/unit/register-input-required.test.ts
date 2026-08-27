import { McpServer, inputRequired } from '@modelcontextprotocol/server';
import type {
  InputRequiredResult,
  ServerContext,
} from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import { registerTool } from '../../src/tools/register.js';

describe('registerTool input_required passthrough', () => {
  it('returns an InputRequiredResult without rewriting it', async () => {
    const server = new McpServer({ name: 'register-test', version: '0.0.0' });
    const expected: InputRequiredResult = inputRequired({
      requestState: 'opaque-state',
    });
    const registered = registerTool(
      server,
      'request_more_input',
      { description: 'Requests more input for the test.' },
      () => expected,
    );
    const result = await (
      registered as unknown as {
        executor: (
          args: unknown,
          extra: ServerContext,
        ) => Promise<InputRequiredResult>;
      }
    ).executor({}, {
      mcpReq: { signal: undefined },
    } as unknown as ServerContext);

    expect(result).toBe(expected);
    expect(result.resultType).toBe('input_required');
    expect(result).not.toHaveProperty('isError');
    expect(result).not.toHaveProperty('content');
  });
});
