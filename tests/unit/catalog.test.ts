import { describe, expect, it } from 'vitest';

import {
  getKnowledgeSectionSlugs,
  getKnowledgeTopicSlugs,
  getListedResources,
  getResourceByUri,
} from '../../src/resources/catalog.js';

describe('ACME knowledge catalog', () => {
  it('lists the ACME topic and resolves every generated section URI', () => {
    expect(getKnowledgeTopicSlugs()).toContain('acme');
    expect(
      getListedResources().some(
        (resource) => resource.uri === 'horizon://knowledge/acme',
      ),
    ).toBe(true);

    const sections = getKnowledgeSectionSlugs('acme');
    expect(sections).toEqual([
      'overview',
      'acme-profile-options',
      'eab-policies',
      'eabs',
      'eab-statuses',
      'acme-accounts',
      'acme-account-statuses-and-compromise',
      'orders',
      'searching-haql-and-heabql',
      'error-codes',
      'which-tool-to-use',
    ]);

    for (const section of sections) {
      expect(
        getResourceByUri(`horizon://knowledge/acme/${section}`),
      ).toMatchObject({ listed: false });
    }
  });
});

describe('Knowledge configuration guidance', () => {
  it('directs validation-rule authors to profile tools without HQL operands', () => {
    const content = getResourceByUri('horizon://knowledge/profiles')?.content;

    expect(content).not.toMatch(/\b(?:dn|keytype) (?:matches|contains) /);
    expect(content).toContain('get_certificate_profile');
    expect(content).toContain('describe_certificate_profile_schema');
  });

  it('explains linked-account blocking for disabled, suspended and expired EABs', () => {
    const content = getResourceByUri('horizon://knowledge/acme')?.content;

    for (const status of ['disabled', 'suspended']) {
      const row = content
        ?.split('\n')
        .find((line) => line.startsWith(`| \`${status}\``));
      expect(row).toMatch(
        /Blocks.*new account registrations.*use of linked ACME accounts/,
      );
    }
    expect(content).toMatch(
      /expired EAB blocks\s+new account registrations and the use of linked ACME accounts/,
    );
  });

  it('identifies OIDC role/team mapping availability from Horizon 2.9', () => {
    const content = getResourceByUri(
      'horizon://knowledge/integrations',
    )?.content;

    expect(content).toContain('Horizon 2.9+');
    expect(content).toContain('Horizon 2.8 does not support role/team mapping');
  });

  it('explains that Horizon service-account authentication requires a JWT per request', () => {
    const content = getResourceByUri('horizon://knowledge/rbac')?.content;

    expect(content).toMatch(
      /Service-account authentication never creates\s+a session: each request carries a valid JWT/,
    );
  });
});
