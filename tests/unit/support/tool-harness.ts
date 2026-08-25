import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { vi } from 'vitest';

export function createMockClient() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(null),
    getBytes: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    getText: vi.fn().mockResolvedValue(''),
    postText: vi.fn().mockResolvedValue(''),
    postMultipart: vi.fn().mockResolvedValue({}),
    request: vi.fn().mockResolvedValue(new Response()),
    close: vi.fn().mockResolvedValue(undefined),
    fetchCsrfToken: vi.fn().mockResolvedValue(undefined),
    exportTimeout: 120,
    principalName: undefined,
    horizonVersion: undefined,
  };
}

export type MockClient = ReturnType<typeof createMockClient>;

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export function parseToolResult(result: unknown): Record<string, unknown> {
  const toolResult = result as ToolResult;
  return JSON.parse(toolResult.content[0]!.text) as Record<string, unknown>;
}

export function resetMocks(mockClient: MockClient): void {
  mockClient.get.mockReset().mockResolvedValue({});
  mockClient.post.mockReset().mockResolvedValue({});
  mockClient.put.mockReset().mockResolvedValue({});
  mockClient.patch.mockReset().mockResolvedValue({});
  mockClient.delete.mockReset().mockResolvedValue(null);
  mockClient.getBytes.mockReset().mockResolvedValue(new ArrayBuffer(0));
  mockClient.getText.mockReset().mockResolvedValue('');
  mockClient.postText.mockReset().mockResolvedValue('');
  mockClient.postMultipart.mockReset().mockResolvedValue({});
  mockClient.request.mockReset().mockResolvedValue(new Response());
}

export type ToolRegistrar = (server: McpServer, client: MockClient) => void;

export async function setupServerAndClient(
  registrars: ToolRegistrar[],
): Promise<{ client: Client; mockClient: MockClient }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const mockClient = createMockClient();
  for (const register of registrars) register(server, mockClient);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, mockClient };
}
