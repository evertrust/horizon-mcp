import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAllResources } from '../../src/resources/index.js';
import { registerComputationTools } from '../../src/tools/assist/computation.js';
import { registerCryptoTools } from '../../src/tools/assist/crypto.js';
import { registerQueryTools } from '../../src/tools/assist/query.js';
import { registerSystemTools } from '../../src/tools/assist/system.js';
import { registerTranslateTools } from '../../src/tools/assist/translate.js';
import { registerConfigTools } from '../../src/tools/config/index.js';
import { registerDashboardTools } from '../../src/tools/dashboards.js';
import { registerDatasourceTools } from '../../src/tools/datasources.js';
import { registerDiscoveryEventTools } from '../../src/tools/discovery-events.js';
import { registerDiscoveryFeedTools } from '../../src/tools/discovery-feed.js';
import { registerDiscoveryTools } from '../../src/tools/discovery.js';
import { registerDocsTools } from '../../src/tools/docs.js';
import { registerLifecycleTools } from '../../src/tools/lifecycle.js';
import { registerProfileTools } from '../../src/tools/profiles.js';
import { registerReportTools } from '../../src/tools/reports.js';
import { registerTriggerTools } from '../../src/tools/triggers.js';
import {
  E2E_CONFIGURED,
  callTool,
  readResource,
  setupE2EStack,
} from '../e2e/setup.js';

export {
  E2E_CONFIGURED as SCENARIO_E2E_READY,
  callTool,
  readResource,
  setupE2EStack,
};

export interface ListedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface ListedResource {
  readonly uri: string;
  readonly description?: string;
}

type ScenarioMetadata = {
  readonly tools: ListedTool[];
  readonly resources: ListedResource[];
};

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'show',
  'the',
  'to',
  'using',
  'what',
  'with',
]);

function createMockClient(): unknown {
  return {
    get: async () => ({}),
    post: async () => ({}),
    put: async () => ({}),
    patch: async () => ({}),
    delete: async () => null,
    getBytes: async () => new ArrayBuffer(0),
    getText: async () => '',
    postText: async () => '',
    postMultipart: async () => ({}),
    request: async () => new Response(),
    close: async () => {},
    fetchCsrfToken: async () => undefined,
    exportTimeout: 120000,
    principalName: undefined,
    horizonVersion: undefined,
  };
}

function registerAllTools(server: McpServer, mockClient: unknown): void {
  const client = mockClient as Parameters<typeof registerProfileTools>[1];
  registerProfileTools(server, client);
  registerLifecycleTools(server, client);
  registerDashboardTools(server, client);
  registerDiscoveryTools(server, client);
  registerDiscoveryEventTools(server, client);
  registerDiscoveryFeedTools(server, client);
  registerDatasourceTools(server, client);
  registerReportTools(server, client);
  registerTriggerTools(server, client);
  registerDocsTools(server, client);
  registerSystemTools(server, client);
  registerQueryTools(server, client);
  registerCryptoTools(server, client);
  registerComputationTools(server, client);
  registerTranslateTools(server, client);
  registerConfigTools(server, client);
}

let metadataPromise: Promise<ScenarioMetadata> | undefined;

export async function loadScenarioMetadata(): Promise<ScenarioMetadata> {
  if (metadataPromise) return metadataPromise;

  metadataPromise = (async () => {
    const server = new McpServer({
      name: 'scenario-eval',
      version: '0.0.0',
    });
    const mockClient = createMockClient();
    registerAllResources(server);
    registerAllTools(server, mockClient);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'scenario-eval-client',
      version: '0.0.0',
    });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const [toolResult, resourceResult] = await Promise.all([
      client.listTools(),
      client.listResources(),
    ]);

    return {
      tools: toolResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
      })),
      resources: resourceResult.resources.map((resource) => ({
        uri: resource.uri,
        description: resource.description,
      })),
    };
  })();

  return metadataPromise;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[_:/().-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function keywordBonus(question: string, candidate: string): number {
  let score = 0;
  if (question.includes('csv') && candidate.includes('export_')) score += 20;
  if (
    /(count|distribution|breakdown|group|grouped|by profile|by status)/.test(
      question,
    ) &&
    candidate.includes('aggregate_')
  ) {
    score += 34;
  }
  if (
    /(count|distribution|breakdown|group|grouped|by profile|by status)/.test(
      question,
    ) &&
    candidate.includes('search_')
  ) {
    score -= 12;
  }
  if (
    /(install|configure|configuration|integration|setup|guide|documentation|docs)/.test(
      question,
    ) &&
    candidate.includes('search_docs')
  ) {
    score += 24;
  }
  if (
    /(api|endpoint|payload|response|schema|status code|http method)/.test(
      question,
    ) &&
    candidate.includes('search_api_docs')
  ) {
    score += 24;
  }
  if (
    /(page id|page_id|read the page|fetch the page|full page)/.test(question) &&
    candidate.includes('get_doc_page')
  ) {
    score += 18;
  }
  if (/(id|uuid)\b/.test(question) && candidate.includes('get_')) score += 10;
  if (
    /request [a-f0-9-]{8,}/.test(question) &&
    candidate.includes('get_request')
  ) {
    score += 28;
  }
  if (
    /request [a-f0-9-]{8,}/.test(question) &&
    candidate.includes('search_requests')
  ) {
    score -= 10;
  }
  if (
    /(expired|expiring|certificate)/.test(question) &&
    candidate.includes('search_certificates')
  ) {
    score += 12;
  }
  if (/(request)/.test(question) && candidate.includes('get_request'))
    score += 10;
  if (
    /(live|exposed|deployed|host|https:\/\/|ldaps:\/\/|port)/.test(question) &&
    candidate.includes('fetch_exposed_certificate')
  ) {
    score += 22;
  }
  if (
    /(natural language|translate|human language)/.test(question) &&
    candidate.includes('translate_to_hql')
  ) {
    score += 18;
  }
  if (question.includes('validate') && candidate.includes('validate_hcql')) {
    score += 22;
  }
  if (
    /(simulate|debug|dry run|preview|datasource flow)/.test(question) &&
    candidate.includes('simulate_')
  ) {
    score += 18;
  }
  if (
    /(simulate|datasource flow)/.test(question) &&
    candidate.includes('simulate_datasource_flow')
  ) {
    score += 80;
  }
  if (
    /(datasource flow|cmdb api|oauth token)/.test(question) &&
    candidate.includes('datasources')
  ) {
    score += 24;
  }
  if (
    /(datasource flow|cmdb api|oauth token)/.test(question) &&
    candidate.includes('rest-datasource')
  ) {
    score += 12;
  }
  if (
    /(simulate|datasource flow)/.test(question) &&
    (candidate.includes('create_') || candidate.includes('test_datasource'))
  ) {
    score -= 80;
  }
  if (question.includes('adcs') && candidate.includes('adcs')) score += 18;
  if (question.includes('digicert') && candidate.includes('digicert'))
    score += 18;
  if (question.includes('intune') && candidate.includes('intune')) score += 18;
  if (
    /(oauth|token|rest notification|bearer)/.test(question) &&
    candidate.includes('rest-notifications')
  ) {
    score += 24;
  }
  if (
    /(oauth|token|rest notification|bearer)/.test(question) &&
    candidate.includes('real-world-examples')
  ) {
    score += 12;
  }
  // describe_<object>_schema is the documented "inspect required fields before
  // create" support tool for polymorphic config objects. Boost it when the
  // prompt is about creating/configuring an object whose noun it covers, so it
  // ranks as support alongside the matching create_ tool (otherwise the grown
  // config toolset crowds it out on shared terms like "certificate").
  const schemaName = candidate.match(/^describe_([a-z_]+?)_schema\b/);
  if (
    schemaName &&
    /\b(create|configure|set up|setup|add|new|provision)\b/.test(question) &&
    schemaName[1]
      .split('_')
      .some((noun) => noun.length > 2 && question.includes(noun))
  ) {
    score += 18;
  }
  return score;
}

function overlapScore(questionTokens: string[], haystack: string): number {
  let score = 0;
  for (const token of questionTokens) {
    if (!haystack.includes(token)) continue;
    score += token.length >= 7 ? 5 : token.length >= 5 ? 4 : 2;
  }
  return score;
}

export function rankQuestion<T>(
  question: string,
  items: readonly T[],
  toHaystack: (item: T) => string,
): Array<{ item: T; score: number }> {
  const normalizedQuestion = question.toLowerCase();
  const questionTokens = tokenize(question);

  return [...items]
    .map((item) => {
      const haystack = toHaystack(item).toLowerCase();
      const score =
        overlapScore(questionTokens, haystack) +
        keywordBonus(normalizedQuestion, haystack);
      return { item, score };
    })
    .sort((left, right) => right.score - left.score);
}

export async function rankTools(question: string) {
  const metadata = await loadScenarioMetadata();
  return rankQuestion(
    question,
    metadata.tools,
    (tool) => `${tool.name} ${tool.description ?? ''}`,
  );
}

export async function rankResources(question: string) {
  const metadata = await loadScenarioMetadata();
  return rankQuestion(
    question,
    metadata.resources,
    (resource) => `${resource.uri} ${resource.description ?? ''}`,
  );
}

export async function getToolSchemaParamNames(
  toolName: string,
): Promise<Set<string>> {
  const metadata = await loadScenarioMetadata();
  const tool = metadata.tools.find((candidate) => candidate.name === toolName);
  if (!tool?.inputSchema) return new Set();
  const properties =
    (tool.inputSchema['properties'] as Record<string, unknown>) ?? {};
  return new Set(Object.keys(properties));
}
