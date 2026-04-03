/**
 * Tier 2 - Full MCP loop tests via Claude Code.
 *
 * These tests send prompts to `claude -p` with the MCP server attached and
 * verify that Claude actually executes tools against the live Horizon instance
 * and produces meaningful results.
 *
 * Skipped when ANTHROPIC_API_KEY or HORIZON_E2E_* env vars are not set.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import {
  LLM_EVAL_READY,
  askClaude,
  cleanupMcpConfig,
  skipReason,
} from './setup.js';

const PREFIX = `e2e-llm-${randomUUID().slice(0, 6)}`;

// ---------------------------------------------------------------------------
// Helper: check if response contains any of the given keywords
// ---------------------------------------------------------------------------

function containsAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

// ---------------------------------------------------------------------------
// Full MCP loop tests
// ---------------------------------------------------------------------------

describe.skipIf(!LLM_EVAL_READY)(
  `MCP loop (${skipReason() || 'enabled'})`,
  () => {
    afterAll(() => cleanupMcpConfig());

    // -----------------------------------------------------------------------
    // Core tool flows
    // -----------------------------------------------------------------------

    it('search flow - finds certificates via HCQL', async () => {
      const result = await askClaude(
        'Find certificates expiring in the next 7 days. ' +
          'Show me the search results.',
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(
        containsAny(result.text, [
          'certificate',
          'expir',
          'search',
          'found',
          'result',
          'valid.until',
        ]),
      ).toBe(true);
    }, 180_000);

    it('dashboard flow - creates and deletes a dashboard', async () => {
      const dashName = `${PREFIX}-dash`;
      const result = await askClaude(
        `Create a dashboard named '${dashName}' and add a donut chart ` +
          'showing certificate status distribution. ' +
          `Then delete the dashboard '${dashName}' when done.`,
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(
        containsAny(result.text, [
          'dashboard',
          'created',
          'chart',
          dashName.toLowerCase(),
        ]),
      ).toBe(true);
    }, 180_000);

    it('discovery flow - creates and deletes a campaign', async () => {
      const campaignName = `${PREFIX}-campaign`;
      const result = await askClaude(
        `Create a TLS scan discovery campaign named '${campaignName}' ` +
          'targeting 127.0.0.1:443. ' +
          `Then delete the campaign '${campaignName}' when done.`,
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(
        containsAny(result.text, [
          'campaign',
          'created',
          'discovery',
          campaignName.toLowerCase(),
        ]),
      ).toBe(true);
    }, 180_000);

    it('explain flow - describes enrollment workflows', async () => {
      const result = await askClaude(
        'Explain certificate enrollment workflows in Horizon. ' +
          'What are the different ways to enroll a certificate?',
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(result.text.length).toBeGreaterThan(100);
      expect(
        containsAny(result.text, [
          'workflow',
          'enroll',
          'webra',
          'acme',
          'request',
          'profile',
          'scep',
          'est',
        ]),
      ).toBe(true);
    }, 180_000);

    // -----------------------------------------------------------------------
    // Datasource tools (full MCP loop against live Horizon)
    // -----------------------------------------------------------------------

    it('DNS datasource lifecycle - create, test, delete', async () => {
      const dsName = `${PREFIX}-dns`;
      const result = await askClaude(
        `Create a DNS datasource named '${dsName}' that looks up CNAME records ` +
          'for a hostname provided as {{hostname}}. Use record types cname only. ' +
          'Then test it with hostname=www.microsoft.com. ' +
          `Finally, delete the datasource '${dsName}' when done. ` +
          'Show me the test results.',
        { timeout: 180_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(
        containsAny(result.text, [
          'created',
          'datasource',
          dsName.toLowerCase(),
          'cname',
          'success',
          'test',
        ]),
      ).toBe(true);
    }, 240_000);

    it('REST datasource test - tests against public JSON API', async () => {
      const result = await askClaude(
        "Test a REST datasource (don't create it, just test it) with these settings: " +
          'type rest, name test-httpbin, method GET, ' +
          'url https://httpbin.org/json, authenticationType noauth, ' +
          'timeout 10s, expected HTTP codes [200]. ' +
          'Show me what dictionary entries the JSON response produces.',
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(
        containsAny(result.text, [
          'slideshow',
          'dictionary',
          'success',
          'title',
          'author',
        ]),
      ).toBe(true);
    }, 180_000);

    it('datasource list - lists existing datasources', async () => {
      const result = await askClaude(
        'List all configured external datasources on this Horizon instance. ' +
          'Show me their names and types.',
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(
        containsAny(result.text, ['dns', 'ldap', 'rest', 'datasource']),
      ).toBe(true);
    }, 180_000);

    // -----------------------------------------------------------------------
    // Knowledge reasoning (LLM generates correct answers from docs)
    // -----------------------------------------------------------------------

    it('validation rule syntax - generates correct JSON', async () => {
      const result = await askClaude(
        'Write a validation ruleset with 2 rules: ' +
          '1) all DNS SANs must end with .corp.local ' +
          '2) the requesting client IP must be in the 10.0.0.0/8 range. ' +
          'Both rules must pass. Show me the exact JSON.',
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('threshold');
      // Should NOT contain camelCase syntax errors
      expect(result.text.replace('ends with', '')).not.toContain('endswith');
    }, 180_000);

    it('validation module support - identifies correct modules', async () => {
      const result = await askClaude(
        'Which Horizon profile modules support auto-validation rules? ' +
          'List them with their supported authorization modes. ' +
          'Also tell me which modules do NOT support them.',
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('webra');
      expect(containsAny(result.text, ['scep', 'est'])).toBe(true);
      expect(result.text).toContain('acme');
    }, 180_000);

    it('datasource chaining - understands OAuth flow pattern', async () => {
      const result = await askClaude(
        'I need to call an external REST API that requires OAuth ' +
          'client_credentials authentication. The API token endpoint returns ' +
          'a JSON with an access_token field. How would I set up datasources ' +
          'and a dsFlow in Horizon to first get the token, then call the API ' +
          'using that token? Explain the pattern.',
        { timeout: 180_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(result.text.length).toBeGreaterThan(200);
      expect(
        containsAny(result.text, [
          'chain',
          'first',
          'token',
          'bearer',
          'ds.1',
          'ds.2',
          'access_token',
          'dsflow',
        ]),
      ).toBe(true);
    }, 240_000);

    // -----------------------------------------------------------------------
    // REST notifications (knowledge + tool loop)
    // -----------------------------------------------------------------------

    it('REST notification lifecycle - create, list, delete', async () => {
      const notifName = `${PREFIX}-rest-notif`;
      const result = await askClaude(
        `Create a REST notification named '${notifName}' that fires on ` +
          'on_enroll and POSTs to https://httpbin.org/post with JSON body ' +
          'containing the certificate serial ({{certificate.serial}}) and CN ' +
          '({{certificate.subject.cn.1}}). Use no authentication, expect ' +
          'HTTP 200, timeout 30 seconds. ' +
          `Then list triggers and confirm '${notifName}' exists. ` +
          `Finally, delete the trigger '${notifName}'.`,
        { timeout: 180_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(
        containsAny(result.text, [
          'created',
          'trigger',
          notifName.toLowerCase(),
          'deleted',
          'rest',
        ]),
      ).toBe(true);
    }, 240_000);

    it('REST notification deployment knowledge - designs correct JSON', async () => {
      const result = await askClaude(
        'I need to deploy certificates to our internal load balancer whenever ' +
          'a certificate is enrolled. The load balancer has a REST API at ' +
          'https://lb.internal/api/certs that accepts POST with JSON body ' +
          "containing 'domain', 'pem', and 'serial' fields. It uses bearer " +
          'token auth. Show me the exact JSON to create this REST notification.',
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(result.text).toContain('rest');
      expect(
        containsAny(result.text, [
          'sequence',
          'on_enroll',
          'bearer',
          'certificate.pem',
        ]),
      ).toBe(true);
    }, 180_000);

    it('REST notification OAuth chaining - designs multi-step sequence', async () => {
      const result = await askClaude(
        'How do I build a REST notification that first obtains an OAuth ' +
          'token from https://auth.example.com/token using client credentials, ' +
          'then uses that token to push the certificate PEM and private key to ' +
          'https://api.example.com/certificates? The auth endpoint returns JSON ' +
          'with an access_token field. Show me the complete multi-step sequence.',
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(result.text.length).toBeGreaterThan(200);
      expect(
        containsAny(result.text, [
          'rest.response.1',
          'access_token',
          'sequence',
        ]),
      ).toBe(true);
    }, 180_000);

    it('REST notification dictionary - identifies correct template variables', async () => {
      const result = await askClaude(
        'What template variables can I use in a REST notification payload? ' +
          'Specifically for a notification on the on_renew event, I need to ' +
          "include the new certificate's PEM, the old certificate's serial, " +
          "and the certificate's first DNS SAN. Show me the exact keys to use.",
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(
        containsAny(result.text, ['certificate.pem', 'previous.certificate']),
      ).toBe(true);
      expect(containsAny(result.text, ['san.dnsname.1', 'san.dnsname'])).toBe(
        true,
      );
    }, 180_000);

    it('dictionary entries - identifies protocol-specific entries', async () => {
      const result = await askClaude(
        'What dictionary entries are available during SCEP enrollment ' +
          'that are NOT available during WebRA enrollment? ' +
          "And vice versa - what does WebRA have that SCEP doesn't?",
        { timeout: 120_000 },
      );

      expect(result.exitCode).toBe(0);
      expect(result.text.length).toBeGreaterThan(100);
      expect(
        containsAny(result.text, ['scep.enroll', 'webra.enroll', 'principal']),
      ).toBe(true);
    }, 180_000);
  },
);
