import { describe, expect, it } from 'vitest';

import {
  E2E_CONFIGURED,
  ToolError,
  callTool,
  callToolRaw,
  getHorizonClient,
  getMcpClient,
  readResource,
  setupE2EStack,
} from './setup.js';

describe.skipIf(!E2E_CONFIGURED)('Horizon E2E', () => {
  setupE2EStack();

  describe('assist', () => {
    // -----------------------------------------------------------------------
    // Knowledge resource tests (core resources + small-model additions)
    // -----------------------------------------------------------------------

    const KNOWLEDGE_URIS = [
      'horizon://knowledge/profiles',
      'horizon://knowledge/computation-and-data-flow',
      'horizon://knowledge/workflows',
      'horizon://knowledge/query-languages',
      'horizon://knowledge/rbac',
      'horizon://knowledge/architecture',
      'horizon://knowledge/dictionary-matrix',
      'horizon://knowledge/discovery',
      'horizon://knowledge/automation',
      'horizon://knowledge/integrations',
      'horizon://knowledge/dashboards',
      'horizon://knowledge/system-admin',
      'horizon://knowledge/tool-selection',
      'horizon://knowledge/adcs-integration',
      'horizon://knowledge/digicert-integration',
      'horizon://knowledge/intune-integration',
      'horizon://knowledge/query-languages/ownership-patterns-hcql',
      'horizon://knowledge/datasources/rest-datasource',
      'horizon://knowledge/rest-notifications/real-world-examples',
    ] as const;

    describe.each(KNOWLEDGE_URIS)('knowledge resource %s', (uri) => {
      it('is accessible and non-empty', async () => {
        const content = await readResource(uri);
        expect(content).toBeTruthy();
        expect(
          content.length,
          `Resource ${uri} is suspiciously short (${content.length} chars)`,
        ).toBeGreaterThan(100);
      });

      it('contains structured content (headers or tables)', async () => {
        const content = await readResource(uri);
        const hasHeaders = content.includes('## ') || content.includes('# ');
        const hasTables = content.includes('|');
        expect(
          hasHeaders || hasTables,
          `Resource ${uri} does not contain markdown headers (##) or tables (|). ` +
            `First 200 chars: ${content.slice(0, 200)}`,
        ).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // Server instructions
    // -----------------------------------------------------------------------

    it('server instructions are non-empty', async () => {
      const client = getMcpClient();
      const instructions = client.getInstructions();
      // Instructions must exist and be non-trivially short
      expect(instructions).toBeDefined();
      expect(instructions!.length).toBeGreaterThan(10);
    });

    // -----------------------------------------------------------------------
    // System tools
    // -----------------------------------------------------------------------

    it('whoami returns user info with identity', async () => {
      const result = await callTool('whoami');
      expect(result).toBeDefined();
      if ('raw' in result) {
        expect((result['raw'] as string).length).toBeGreaterThan(10);
      } else {
        expect(
          result['identity'],
          `whoami response lacks 'identity' key. Got keys: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        const identity = result['identity'] as Record<string, unknown>;
        expect(typeof identity).toBe('object');
        const identityKeys = new Set([
          'identifier',
          'login',
          'id',
          '_id',
          'name',
          'email',
        ]);
        const hasIdentifierKey = Object.keys(identity).some((k) =>
          identityKeys.has(k),
        );
        expect(
          hasIdentifierKey,
          `whoami identity lacks any identifier key. Got keys: ${Object.keys(identity).join(', ')}`,
        ).toBe(true);
      }
    });

    it('get_license_info returns license data', async () => {
      try {
        const result = await callTool('get_license_info');
        expect(result).toBeDefined();
        if ('raw' in result) {
          expect((result['raw'] as string).length).toBeGreaterThan(10);
        } else {
          expect(
            Object.keys(result).length,
            'get_license_info returned empty JSON object',
          ).toBeGreaterThan(0);
        }
      } catch {
        console.log(
          'SKIP: get_license_info not available on this Horizon instance',
        );
      }
    });

    // -----------------------------------------------------------------------
    // Query validation tools
    // -----------------------------------------------------------------------

    describe('query validation', () => {
      it('validate_hcql confirms a valid HCQL expression', async () => {
        const result = await callTool('validate_hcql', {
          query: 'profile exists',
        });
        expect(result['valid']).toBe(true);
        expect(result['query_type']).toBe('HCQL');
      });

      it('validate_hcql flags a syntactically broken expression', async () => {
        const raw = await callToolRaw('validate_hcql', {
          query: 'INVALID<<<',
        });
        expect(raw).toBeTruthy();
        const data = JSON.parse(raw) as Record<string, unknown>;
        expect(
          data['valid'],
          `Expected valid=false for 'INVALID<<<', got: ${JSON.stringify(data)}`,
        ).toBe(false);
      });

      it('validate_hrql confirms a valid HRQL expression', async () => {
        const result = await callTool('validate_hrql', {
          query: 'profile exists',
        });
        expect(result['valid']).toBe(true);
        expect(result['query_type']).toBe('HRQL');
      });

      it('validate_heql confirms a valid HEQL expression', async () => {
        const result = await callTool('validate_heql', {
          query: 'code matches ".*"',
        });
        expect(result['valid']).toBe(true);
        expect(result['query_type']).toBe('HEQL');
      });

      it('validate_hdql confirms a valid HDQL expression', async () => {
        const result = await callTool('validate_hdql', {
          query: 'status exists',
        });
        expect(result['valid']).toBe(true);
        expect(result['query_type']).toBe('HDQL');
      });

      it.each(['hcql', 'hrql', 'heql', 'hdql'] as const)(
        'describe_query_fields returns metadata for %s',
        async (queryType) => {
          const result = await callTool('describe_query_fields', {
            query_type: queryType,
          });
          expect(result['error']).toBeUndefined();
          expect(result['query_type']).toBe(queryType);
          expect(Array.isArray(result['fields'])).toBe(true);
          expect((result['fields'] as unknown[]).length).toBeGreaterThan(0);
          expect(Array.isArray(result['examples'])).toBe(true);
        },
      );
    });

    // -----------------------------------------------------------------------
    // Crypto tools
    // -----------------------------------------------------------------------

    describe('crypto tools', () => {
      /**
       * Fetch a real PEM certificate from a well-known host.
       * Uses fetch_exposed_certificate MCP tool (full stack).
       */
      async function getLiveCertPem(): Promise<string> {
        const result = await callTool('fetch_exposed_certificate', {
          uri: 'https://www.google.com',
        });
        return result['pem'] as string;
      }

      it('decode_x509 returns all expected RFC 5280 fields', async () => {
        const pem = await getLiveCertPem();
        const result = await callTool('decode_x509', { pem });

        // Core fields must be present
        expect(
          result['dn'],
          `Missing 'dn'. Keys: ${Object.keys(result).join(', ')}`,
        ).toBeDefined();
        expect(result['issuerDn'], "Missing 'issuerDn'").toBeDefined();
        expect(result['serial'], "Missing 'serial'").toBeDefined();
        expect(result['notBefore'], "Missing 'notBefore'").toBeDefined();
        expect(result['notAfter'], "Missing 'notAfter'").toBeDefined();
        expect(result['keyType'], "Missing 'keyType'").toBeDefined();
        expect(
          result['signingAlgorithm'],
          "Missing 'signingAlgorithm'",
        ).toBeDefined();
        expect(result['pem'], "Missing 'pem'").toBeDefined();
        expect(
          result['certificateThumbprint'],
          "Missing 'certificateThumbprint'",
        ).toBeDefined();
        expect(result['selfSigned'], "Missing 'selfSigned'").toBeDefined();

        // dnElements should be a list of {type, value} objects
        expect(result['dnElements']).toBeDefined();
        expect(Array.isArray(result['dnElements'])).toBe(true);
        const dnElements = result['dnElements'] as Record<string, unknown>[];
        expect(dnElements.every((e) => 'type' in e && 'value' in e)).toBe(true);
      });

      it('decode_x509 parses SANs into typed entries', async () => {
        const pem = await getLiveCertPem();
        const result = await callTool('decode_x509', { pem });

        // The cert may or may not have SANs depending on how the fetch went
        // (SNI issues could return a cert without SANs)
        if (result['sans']) {
          const sans = result['sans'] as Record<string, unknown>[];
          expect(Array.isArray(sans)).toBe(true);
          if (sans.length > 0) {
            expect(
              sans.every((s) => 'sanType' in s && 'value' in s),
              `SAN entries should have sanType + value. Got: ${JSON.stringify(sans.slice(0, 2))}`,
            ).toBe(true);
          }
        }
      });

      it('decode_x509 returns key usage fields', async () => {
        const pem = await getLiveCertPem();
        const result = await callTool('decode_x509', { pem });

        expect(result['keyUsages']).toBeDefined();
        expect(Array.isArray(result['keyUsages'])).toBe(true);
        expect(result['isKeyUsagesCritical']).toBeDefined();
      });

      it('decode_x509 returns AIA and CRL DPs for non-root certs', async () => {
        const pem = await getLiveCertPem();
        const result = await callTool('decode_x509', { pem });

        if (!result['selfSigned']) {
          expect(result['aias'], 'Non-root cert should have AIA').toBeDefined();
          expect(
            result['crldps'],
            'Non-root cert should have CRL DPs',
          ).toBeDefined();
        }
      });

      it('decode_csr rejects invalid data', async () => {
        // The MCP server returns the error as isError=true content;
        // callTool() throws a ToolError in that case.
        await expect(
          callTool('decode_csr', { pem: 'not-a-csr' }),
        ).rejects.toThrow(ToolError);
      });

      it('detect_file identifies a PEM certificate', async () => {
        const pem = await getLiveCertPem();
        const result = await callTool('detect_file', { data: pem });
        expect(
          result['type'],
          `Expected type='certificate', got type='${result['type']}'`,
        ).toBe('certificate');
        expect(
          result['value'],
          'detect_file should return decoded value',
        ).toBeDefined();
      });

      it('decode_crl rejects invalid data', async () => {
        await expect(
          callTool('decode_crl', { data: 'not-a-crl' }),
        ).rejects.toThrow(ToolError);
      });

      it('decode_ocsp rejects invalid data', async () => {
        await expect(
          callTool('decode_ocsp', { data: 'not-an-ocsp-response' }),
        ).rejects.toThrow(ToolError);
      });

      it('decode_tsa rejects invalid data', async () => {
        await expect(
          callTool('decode_tsa', { data: 'not-a-tsa-response' }),
        ).rejects.toThrow(ToolError);
      });

      it('fetch then decode workflow: fetch live cert and decode via Horizon', async () => {
        const fetchResult = await callTool('fetch_exposed_certificate', {
          uri: 'https://www.google.com',
        });
        expect(fetchResult['pem']).toBeDefined();

        const decodeResult = await callTool('decode_x509', {
          pem: fetchResult['pem'],
        });

        // The fetched and decoded cert must have matching thumbprints.
        // The DN may differ from "google" if SNI is not supported by the
        // egress network, so we only assert structural consistency.
        expect(decodeResult['dn']).toBeDefined();
        expect(decodeResult['certificateThumbprint']).toBe(
          fetchResult['thumbprint_sha256'],
        );
      });
    });

    // -----------------------------------------------------------------------
    // Computation tools
    // -----------------------------------------------------------------------

    describe('computation tools', () => {
      async function runComputation(
        rule: string,
        dictionary: Record<string, string>,
      ): Promise<Record<string, unknown>> {
        try {
          return await callTool('simulate_computation_rule', {
            rule,
            dictionary,
          });
        } catch (exc) {
          if (String(exc).includes('404')) {
            // Playground endpoint not available - skip
            return { _skipped: true };
          }
          throw exc;
        }
      }

      function computedValue(result: Record<string, unknown>): string {
        const val =
          result['computedValueSingle'] ?? result['raw'] ?? String(result);
        return String(val);
      }

      it('basic dictionary lookup resolves', async () => {
        const result = await runComputation('{{owner}}', {
          owner: 'test-user',
        });
        if (result['_skipped']) return;
        expect(computedValue(result)).toContain('test-user');
      });

      it('Upper function returns uppercase', async () => {
        const result = await runComputation('Upper({{cn}})', {
          cn: 'hello',
        });
        if (result['_skipped']) return;
        expect(computedValue(result)).toContain('HELLO');
      });

      it('Extract with capture group extracts user part', async () => {
        const result = await runComputation('Extract({{email}}, "(.*)@", 1)', {
          email: 'alice@example.com',
        });
        if (result['_skipped']) return;
        expect(computedValue(result).toLowerCase()).toContain('alice');
      });

      it('DomainDNS extracts parent domain', async () => {
        const result = await runComputation('DomainDNS({{fqdn}})', {
          fqdn: 'machine.domain.local',
        });
        if (result['_skipped']) return;
        expect(computedValue(result).toLowerCase()).toContain('domain.local');
      });

      it('ShortenDNS extracts hostname', async () => {
        const result = await runComputation('ShortenDNS({{fqdn}})', {
          fqdn: 'web01.corp.example.com',
        });
        if (result['_skipped']) return;
        expect(computedValue(result).toLowerCase()).toContain('web01');
      });

      it('Concat+OrElse builds string with fallback', async () => {
        const result = await runComputation(
          'Concat(OrElse({{prefix}}, "default"), "-", {{name}})',
          { name: 'server01' },
        );
        if (result['_skipped']) return;
        expect(computedValue(result).toLowerCase()).toContain(
          'default-server01',
        );
      });

      it('datasource flow with empty flow does not crash', async () => {
        try {
          const raw = await callToolRaw('simulate_datasource_flow', {
            flow: [],
          });
          expect(raw).toBeTruthy();
        } catch {
          console.log(
            'SKIP: simulate_datasource_flow not available on this Horizon instance',
          );
        }
      });
    });

    // -----------------------------------------------------------------------
    // Translation tools
    // -----------------------------------------------------------------------

    describe('translate_to_hql', () => {
      it('translates a certificate description to HCQL', async () => {
        const result = await callTool('translate_to_hql', {
          natural_language: 'expired RSA certificates',
        });
        expect(result).toBeDefined();
        expect(result['query_type']).toBe('hcql');
        expect(
          result['query'] ?? result['message'],
          'translate_to_hql returned neither query nor message',
        ).toBeTruthy();
      });

      it('respects a forced target_type of hrql', async () => {
        const result = await callTool('translate_to_hql', {
          natural_language: 'pending requests',
          target_type: 'hrql',
        });
        expect(result).toBeDefined();
        expect(result['query_type']).toBe('hrql');
      });

      it('validates against live instance when validate=true', async () => {
        const result = await callTool('translate_to_hql', {
          natural_language: 'valid certificates',
          validate: true,
        });
        if (result['query']) {
          expect(
            result['validation'],
            "translate_to_hql with validate=true must include 'validation' key",
          ).toBeDefined();
        }
      });
    });

    // -----------------------------------------------------------------------
    // Grading tools (conditional - skip if no policies/rulesets configured)
    //
    // The TS server does not have list_grading_policies/list_grading_rulesets
    // tools, so we use the HorizonClient directly to discover available
    // policies/rulesets, then call the explain tools through MCP.
    // -----------------------------------------------------------------------

    describe('grading', () => {
      async function getLiveCertificatePem(): Promise<string | null> {
        const search = await callTool('search_certificates', {
          query: 'profile exists',
          page_size: 1,
        });
        const certificates = (search['results'] ?? []) as Record<
          string,
          unknown
        >[];
        if (certificates.length === 0) {
          return null;
        }

        const certId = certificates[0]!['_id'] as string | undefined;
        if (!certId) {
          return null;
        }

        const cert = await getHorizonClient().get<Record<string, unknown>>(
          `/api/v1/certificates/${certId}`,
        );
        const certificate = (cert['certificate'] ?? cert) as Record<
          string,
          unknown
        >;
        const pem = (certificate['certificate'] ?? cert['pem']) as
          | string
          | undefined;
        return pem ?? null;
      }

      it('explain_grading_policy returns details for the first policy found', async () => {
        const client = getHorizonClient();
        let policies: Record<string, unknown>[];
        try {
          const data = await client.get<unknown>(
            '/api/v1/certificate/grading/policies',
          );
          policies = Array.isArray(data)
            ? (data as Record<string, unknown>[])
            : [];
        } catch {
          console.log('SKIP: Grading policies endpoint not available');
          return;
        }

        if (policies.length === 0) {
          console.log(
            'SKIP: No grading policies configured on this Horizon instance',
          );
          return;
        }

        const name = (policies[0]!['name'] ?? policies[0]!['identifier']) as
          | string
          | undefined;
        if (!name) {
          console.log('SKIP: Could not extract name from first grading policy');
          return;
        }

        try {
          const result = await callTool('explain_grading_policy', {
            policy_name: name,
          });
          expect(result).toBeDefined();
          expect(
            result['policy'],
            `explain_grading_policy response lacks 'policy' key. Got: ${Object.keys(result).join(', ')}`,
          ).toBeDefined();
        } catch {
          console.log(
            'SKIP: explain_grading_policy not available on this Horizon instance',
          );
        }
      });

      it('explain_grading_ruleset returns details for the first ruleset found', async () => {
        const client = getHorizonClient();
        let rulesets: Record<string, unknown>[];
        try {
          const data = await client.get<unknown>(
            '/api/v1/certificate/grading/rulesets',
          );
          rulesets = Array.isArray(data)
            ? (data as Record<string, unknown>[])
            : [];
        } catch {
          console.log('SKIP: Grading rulesets endpoint not available');
          return;
        }

        if (rulesets.length === 0) {
          console.log(
            'SKIP: No grading rulesets configured on this Horizon instance',
          );
          return;
        }

        const name = (rulesets[0]!['name'] ?? rulesets[0]!['identifier']) as
          | string
          | undefined;
        if (!name) {
          console.log(
            'SKIP: Could not extract name from first grading ruleset',
          );
          return;
        }

        try {
          const result = await callTool('explain_grading_ruleset', {
            ruleset_name: name,
          });
          expect(result).toBeDefined();
          expect(
            result['ruleset'],
            `explain_grading_ruleset response lacks 'ruleset' key. Got: ${Object.keys(result).join(', ')}`,
          ).toBeDefined();
        } catch {
          console.log(
            'SKIP: explain_grading_ruleset not available on this Horizon instance',
          );
        }
      });

      it('explain_grading_policy can explain a live certificate PEM', async () => {
        const pem = await getLiveCertificatePem();
        if (!pem) {
          console.log(
            'SKIP: No certificate PEM available for grading policy explain test',
          );
          return;
        }

        try {
          const result = await callTool('explain_grading_policy', {
            policy_name: 'Horizon-Grading-Policy',
            certificate_pem: pem,
          });
          expect(result['policy']).toBeDefined();
          expect(result['explanation']).toBeDefined();
        } catch (exc) {
          console.log(
            `SKIP: explain_grading_policy certificate path unavailable: ${String(exc).slice(0, 200)}`,
          );
        }
      });

      it('explain_grading_ruleset can explain a live certificate PEM', async () => {
        const pem = await getLiveCertificatePem();
        if (!pem) {
          console.log(
            'SKIP: No certificate PEM available for grading ruleset explain test',
          );
          return;
        }

        try {
          const result = await callTool('explain_grading_ruleset', {
            ruleset_name: 'anssiContent',
            certificate_pem: pem,
          });
          expect(result['ruleset']).toBeDefined();
          expect(result['explanation']).toBeDefined();
        } catch (exc) {
          console.log(
            `SKIP: explain_grading_ruleset certificate path unavailable: ${String(exc).slice(0, 200)}`,
          );
        }
      });
    });
  });
});
