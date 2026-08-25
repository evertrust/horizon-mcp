import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { registerTool } from '../../src/tools/register.js';

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'schema-memo-client', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

describe('registerTool schema memoization', () => {
  it('shares advertised schemas without bypassing transformed validation', async () => {
    const inputSchema = z.object({
      value: z
        .string()
        .transform((value) => value.trim().toLowerCase())
        .refine(
          (value) => value !== 'forbidden',
          'value must not be forbidden',
        ),
    });
    const inputSpy = vi.spyOn(inputSchema['~standard'].jsonSchema, 'input');
    const receivedValues: string[] = [];

    const register = (server: McpServer): void => {
      registerTool(server, 'normalize_value', { inputSchema }, ({ value }) => {
        receivedValues.push(value);
        return { content: [{ type: 'text', text: value }] };
      });
    };

    const firstServer = new McpServer({ name: 'first', version: '0.0.0' });
    register(firstServer);
    const firstClient = await connect(firstServer);
    const firstTool = (await firstClient.listTools()).tools.find(
      (tool) => tool.name === 'normalize_value',
    );

    const secondServer = new McpServer({ name: 'second', version: '0.0.0' });
    register(secondServer);
    const secondClient = await connect(secondServer);
    const secondTool = (await secondClient.listTools()).tools.find(
      (tool) => tool.name === 'normalize_value',
    );

    expect(secondTool?.inputSchema).toEqual(firstTool?.inputSchema);

    const valid = await secondClient.callTool({
      name: 'normalize_value',
      arguments: { value: '  VALID  ' },
    });
    expect(valid.isError).not.toBe(true);
    expect(receivedValues).toEqual(['valid']);

    const rejected = await secondClient.callTool({
      name: 'normalize_value',
      arguments: { value: 'forbidden' },
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toContain('value must not be forbidden');
    expect(receivedValues).toEqual(['valid']);
    expect(inputSpy).toHaveBeenCalledTimes(1);
  });
});
