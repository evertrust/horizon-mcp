import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllResources } from '../../src/resources/index.js';
import {
  CURATED_KNOWLEDGE_FILES,
  KNOWLEDGE_DIR,
  KNOWLEDGE_FILES,
  createMockClient,
  registerAllTools,
} from './support/golden-harness.js';

describe('Knowledge resource accessibility', () => {
  it.each(KNOWLEDGE_FILES)(
    'knowledge file %s exists and has >50 lines',
    (filename) => {
      const filePath = join(KNOWLEDGE_DIR, filename);
      expect(
        existsSync(filePath),
        `Knowledge file not found: ${filePath}`,
      ).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      const lineCount = content.split('\n').length;
      expect(
        lineCount,
        `${filename} has only ${lineCount} lines (expected >50)`,
      ).toBeGreaterThan(50);
    },
  );

  it.each(CURATED_KNOWLEDGE_FILES)(
    'curated knowledge file %s exists and is non-empty',
    (filename) => {
      const filePath = join(KNOWLEDGE_DIR, filename);
      expect(
        existsSync(filePath),
        `Curated knowledge file not found: ${filePath}`,
      ).toBe(true);
      const content = readFileSync(filePath, 'utf-8').trim();
      expect(content.length, `${filename} must not be empty`).toBeGreaterThan(
        50,
      );
    },
  );
});

// ===================================================================
// Tool description -> knowledge URI cross-references
// (ported from test_golden.py TestToolDescriptionKnowledgeReferences)
// ===================================================================

describe('Tool description -> knowledge URI references', () => {
  let toolsByName: Map<string, { description?: string }>;

  beforeAll(async () => {
    const server = new McpServer({ name: 'test-xref', version: '0.0.0' });
    const mockClient = createMockClient();
    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'test-xref-client',
      version: '0.0.0',
    });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const result = await client.listTools();
    toolsByName = new Map(
      result.tools.map((t) => [t.name, { description: t.description }]),
    );
  });

  it('profile tools reference horizon://knowledge/profiles', () => {
    for (const name of ['list_profiles', 'get_profile']) {
      const desc = toolsByName.get(name)?.description ?? '';
      expect(desc, `${name} description`).toContain(
        'horizon://knowledge/profiles',
      );
    }
  });

  it('lifecycle search tools reference horizon://knowledge/query-languages', () => {
    for (const name of [
      'search_certificates',
      'search_requests',
      'search_events',
    ]) {
      const desc = toolsByName.get(name)?.description ?? '';
      expect(desc, `${name} description`).toContain(
        'horizon://knowledge/query-languages',
      );
    }
  });

  it('workflow tools reference horizon://knowledge/workflows', () => {
    for (const name of ['get_request_template', 'submit_request']) {
      const desc = toolsByName.get(name)?.description ?? '';
      expect(desc, `${name} description`).toContain(
        'horizon://knowledge/workflows',
      );
    }
  });

  it('computation tools reference horizon://knowledge/computation-and-data-flow', () => {
    const desc =
      toolsByName.get('simulate_computation_rule')?.description ?? '';
    expect(desc).toContain('horizon://knowledge/computation-and-data-flow');
  });

  it('trigger tools reference horizon://knowledge/rest-notifications', () => {
    for (const name of [
      'list_triggers',
      'get_trigger',
      'create_rest_notification',
      'delete_trigger',
      'simulate_trigger',
    ]) {
      const desc = toolsByName.get(name)?.description ?? '';
      expect(desc, `${name} description`).toContain(
        'horizon://knowledge/rest-notifications',
      );
    }
  });

  it('datasource tools reference horizon://knowledge/datasources', () => {
    for (const name of [
      'list_datasources',
      'get_datasource',
      'create_dns_datasource',
      'create_ldap_datasource',
      'create_rest_datasource',
      'update_datasource',
      'delete_datasource',
      'test_datasource',
    ]) {
      const desc = toolsByName.get(name)?.description ?? '';
      expect(desc, `${name} description`).toContain(
        'horizon://knowledge/datasources',
      );
    }
  });
});

// ===================================================================
// Knowledge field alignment
// (ported from test_golden.py TestKnowledgeFieldAlignment)
// ===================================================================

describe('Knowledge field alignment', () => {
  let toolsByName: Map<string, { inputSchema: Record<string, unknown> }>;

  beforeAll(async () => {
    const server = new McpServer({
      name: 'test-align',
      version: '0.0.0',
    });
    const mockClient = createMockClient();
    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'test-align-client',
      version: '0.0.0',
    });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const result = await client.listTools();
    toolsByName = new Map(
      result.tools.map((t) => [
        t.name,
        { inputSchema: t.inputSchema as Record<string, unknown> },
      ]),
    );
  });

  function getParamNames(toolName: string): Set<string> {
    const schema = toolsByName.get(toolName)?.inputSchema;
    if (!schema) return new Set();
    const props = (schema['properties'] as Record<string, unknown>) ?? {};
    return new Set(Object.keys(props));
  }

  it("workflows knowledge mentions workflow types and submit_request accepts 'workflow'", () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'workflows.md'),
      'utf-8',
    );
    for (const wf of [
      'enroll',
      'revoke',
      'update',
      'recover',
      'migrate',
      'renew',
    ]) {
      expect(
        knowledgeText,
        `Workflow '${wf}' not found in workflows.md`,
      ).toContain(wf);
    }
    expect(getParamNames('submit_request').has('workflow')).toBe(true);
  });

  it('rest-notifications knowledge mentions auth types and template keys', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'rest_notifications.md'),
      'utf-8',
    );
    for (const authType of ['noauth', 'basic', 'bearer', 'x509', 'custom']) {
      expect(
        knowledgeText,
        `Auth type '${authType}' not in rest_notifications.md`,
      ).toContain(authType);
    }
    for (const key of [
      'certificate.pem',
      'certificate.serial',
      'rest.response',
      'credentials.key',
    ]) {
      expect(
        knowledgeText,
        `Template key '${key}' not in rest_notifications.md`,
      ).toContain(key);
    }
  });

  it('rest-notifications knowledge documents event semantics', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'rest_notifications.md'),
      'utf-8',
    );
    for (const concept of [
      'on_approve_enroll',
      'pkcs12',
      'certificate.private_key',
      'previous.certificate',
      'fire-and-forget',
      'Dictionary Availability Matrix',
    ]) {
      expect(
        knowledgeText,
        `Event semantics concept '${concept}' not in rest_notifications.md`,
      ).toContain(concept);
    }
  });

  it('rest-notifications knowledge mentions chaining patterns', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'rest_notifications.md'),
      'utf-8',
    );
    for (const pattern of [
      'Pattern A',
      'Pattern B',
      'Pattern C',
      'OAuth',
      'Lookup',
    ]) {
      expect(
        knowledgeText,
        `Chaining pattern '${pattern}' not in rest_notifications.md`,
      ).toContain(pattern);
    }
  });

  it("query-languages knowledge mentions HCQL fields and search_certificates accepts 'query'", () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'query_languages.md'),
      'utf-8',
    );
    for (const field of ['dn', 'serial', 'profile', 'module']) {
      expect(
        knowledgeText,
        `HCQL field '${field}' not in query_languages.md`,
      ).toContain(field);
    }
    expect(getParamNames('search_certificates').has('query')).toBe(true);
  });

  it('tool-selection playbook documents docs lookup choreography', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'tool_selection.md'),
      'utf-8',
    );
    expect(knowledgeText).toContain('search_docs');
    expect(knowledgeText).toContain('search_api_docs');
    expect(knowledgeText).toContain('get_doc_page');
  });

  it('adcs integration recipe documents connector verification points', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'adcs_integration.md'),
      'utf-8',
    );
    for (const concept of ['evtadcs', 'msadcs', '4443', 'CertHash']) {
      expect(knowledgeText, `ADCS recipe missing ${concept}`).toContain(
        concept,
      );
    }
  });

  it('digicert integration recipe documents required connector fields', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'digicert_integration.md'),
      'utf-8',
    );
    for (const concept of [
      'digicert',
      'apiCredentials',
      'organizationId',
      'baseUrl',
    ]) {
      expect(knowledgeText, `DigiCert recipe missing ${concept}`).toContain(
        concept,
      );
    }
  });

  it('intune integration recipe documents azureTenant drift and both modules', () => {
    const knowledgeText = readFileSync(
      join(KNOWLEDGE_DIR, 'intune_integration.md'),
      'utf-8',
    );
    for (const concept of ['azureTenant', 'intune', 'intunepkcs']) {
      expect(knowledgeText, `Intune recipe missing ${concept}`).toContain(
        concept,
      );
    }
  });
});
