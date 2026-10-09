import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  E2E_PREFIX,
  callTool,
  getHorizonClient,
  isHorizonAtLeast,
  setupE2EStack,
} from './setup.js';

const providerName = `${E2E_PREFIX}-dcv-sectigo`;

describe.skipIf(!E2E_CONFIGURED)('Horizon 2.11 DCV provider E2E', () => {
  setupE2EStack();

  let supports211 = false;
  let created = false;

  beforeAll(async () => {
    supports211 = await isHorizonAtLeast(2, 11);
  });

  afterAll(async () => {
    if (!created) return;
    await callTool('delete_dcv_provider', {
      name: providerName,
      expected_name: providerName,
    });
  });

  it('creates, reads, and deletes a sectigo DCV provider', async (ctx) => {
    if (!supports211) ctx.skip();
    const providers = await getHorizonClient().get<
      Array<Record<string, unknown>>
    >('/api/v1/dcv/providers');
    const credentials = providers.find(
      (provider) =>
        provider['type'] === 'gs_mssl' &&
        typeof provider['credentials'] === 'string',
    )?.['credentials'];
    if (!credentials) ctx.skip();

    const result = await callTool('create_dcv_provider', {
      name: providerName,
      type: 'sectigo',
      endpoint: 'https://sectigo.example.com',
      credentials,
      timeout: '30 seconds',
      dcvMethod: 'cname',
    });
    created = true;
    expect(result['status']).toBe('created');

    const provider = await callTool('get_dcv_provider', { name: providerName });
    expect(provider['type']).toBe('sectigo');
    expect(provider['dcvMethod']).toBe('cname');

    await callTool('delete_dcv_provider', {
      name: providerName,
      expected_name: providerName,
    });
    created = false;
  });
});
