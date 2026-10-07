import type { Client } from '@modelcontextprotocol/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HorizonError } from '../../src/client/errors.js';
import { registerLifecycleTools } from '../../src/tools/lifecycle.js';
import {
  type MockClient,
  parseToolResult,
  resetMocks,
  setupServerAndClient,
} from './support/tool-harness.js';

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
};

const ROUTE = '/api/v1/challenge/submit';
const CERTIFICATE_PEM =
  '-----BEGIN CERTIFICATE-----\nMIIBexample\n-----END CERTIFICATE-----';
const PKCS12_B64 = 'MIIKexamplePkcs12Base64Payload==';

describe('submit_webra_challenge', () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient([
      (server, mc) => {
        registerLifecycleTools(server, mc as any);
      },
    ]);
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  it('is registered as a non-destructive mutation that says Horizon 2.11+', async () => {
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === 'submit_webra_challenge',
    );
    expect(tool).toBeTruthy();
    expect(tool!.description).toContain('Horizon 2.11+');
    expect(tool!.annotations?.readOnlyHint).toBe(false);
    expect(tool!.annotations?.destructiveHint).toBe(false);
  });

  it('submit_request and approve_request point to the challenge in password.value', async () => {
    const tools = (await client.listTools()).tools;
    for (const name of ['submit_request', 'approve_request']) {
      const description = tools.find((t) => t.name === name)!.description!;
      expect(description).toContain('password.value');
      expect(description).toContain('submit_webra_challenge');
    }
  });

  it('returns the PKCS#12 unredacted in centralized mode', async () => {
    mockClient.post.mockResolvedValueOnce({
      certificate: CERTIFICATE_PEM,
      pkcs12: PKCS12_B64,
    });

    const result = await client.callTool({
      name: 'submit_webra_challenge',
      arguments: {
        profile: 'webra-challenge',
        challenge: 'one-time-challenge',
        template: { keyType: 'rsa-2048' },
      },
    });

    expect(mockClient.post).toHaveBeenCalledWith(ROUTE, {
      profile: 'webra-challenge',
      challenge: 'one-time-challenge',
      template: { keyType: 'rsa-2048' },
    });
    expect((result as ToolResult).isError).not.toBe(true);
    expect(parseToolResult(result)).toEqual({
      certificate: CERTIFICATE_PEM,
      pkcs12: PKCS12_B64,
    });
  });

  it('sends a CSR in decentralized mode and returns only the certificate', async () => {
    mockClient.post.mockResolvedValueOnce({ certificate: CERTIFICATE_PEM });
    const csr =
      '-----BEGIN CERTIFICATE REQUEST-----\nMIIexample\n-----END CERTIFICATE REQUEST-----';

    const result = await client.callTool({
      name: 'submit_webra_challenge',
      arguments: {
        profile: 'webra-challenge',
        challenge: 'one-time-challenge',
        template: { csr },
      },
    });

    expect(mockClient.post.mock.calls[0]![1]).toEqual({
      profile: 'webra-challenge',
      challenge: 'one-time-challenge',
      template: { csr },
    });
    expect(parseToolResult(result)).toEqual({ certificate: CERTIFICATE_PEM });
  });

  it('surfaces WEBRA-ENROLL-015 for a consumed or invalid challenge', async () => {
    mockClient.post.mockRejectedValueOnce(
      new HorizonError(400, {
        errorCode: 'WEBRA-ENROLL-015',
        message: 'Invalid challenge',
      }),
    );

    const result = await client.callTool({
      name: 'submit_webra_challenge',
      arguments: {
        profile: 'webra-challenge',
        challenge: 'already-used',
        template: { keyType: 'rsa-2048' },
      },
    });

    expect((result as ToolResult).isError).toBe(true);
    expect((result as ToolResult).content[0]!.text).toContain(
      '[WEBRA-ENROLL-015]',
    );
    expect((result as ToolResult).content[0]!.text).toContain(
      'Invalid challenge',
    );
  });

  it('rejects a call without a template before any request', async () => {
    const result = await client.callTool({
      name: 'submit_webra_challenge',
      arguments: { profile: 'webra-challenge', challenge: 'one-time' },
    });

    expect((result as ToolResult).isError).toBe(true);
    expect(mockClient.post).not.toHaveBeenCalled();
  });
});
