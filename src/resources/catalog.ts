import adcsIntegrationContent from './knowledge/adcs_integration.md';
import architectureContent from './knowledge/architecture.md';
import automationContent from './knowledge/automation.md';
import computationContent from './knowledge/computation_and_data_flow.md';
import dashboardsContent from './knowledge/dashboards.md';
import datasourcesContent from './knowledge/datasources.md';
import dictionaryMatrixContent from './knowledge/dictionary_matrix.md';
import digicertIntegrationContent from './knowledge/digicert_integration.md';
import discoveryContent from './knowledge/discovery.md';
import discoveryWorkflowsContent from './knowledge/discovery_workflows.md';
import integrationsContent from './knowledge/integrations.md';
import intuneIntegrationContent from './knowledge/intune_integration.md';
import profilesContent from './knowledge/profiles.md';
import queryLanguagesContent from './knowledge/query_languages.md';
import rbacContent from './knowledge/rbac.md';
import restNotificationsContent from './knowledge/rest_notifications.md';
import serverRulesContent from './knowledge/server_rules.md';
import systemAdminContent from './knowledge/system_admin.md';
import toolSelectionContent from './knowledge/tool_selection.md';
import validationRulesContent from './knowledge/validation_rules.md';
import workflowsContent from './knowledge/workflows.md';

export type ResourceAudience = 'user' | 'assistant';

export interface ResourceEntry {
  readonly name: string;
  readonly uri: string;
  readonly description: string;
  readonly content: string;
  readonly splitSections?: boolean;
  /** Priority 0..1 - clients use this to rank context inclusion. */
  readonly priority?: number;
  /** Intended audience(s); defaults to ["assistant"]. */
  readonly audience?: readonly ResourceAudience[];
  /** When true, omit from the default `resources/list` to keep the list short. */
  readonly listed?: boolean;
}

const CORE_RESOURCES: readonly ResourceEntry[] = [
  {
    name: 'profiles',
    uri: 'horizon://knowledge/profiles',
    description: 'Certificate profile configuration guide',
    content: profilesContent,
  },
  {
    name: 'computation-and-data-flow',
    uri: 'horizon://knowledge/computation-and-data-flow',
    description: 'Computation rules and data flow engine',
    content: computationContent,
  },
  {
    name: 'workflows',
    uri: 'horizon://knowledge/workflows',
    description: 'Certificate lifecycle workflow reference',
    content: workflowsContent,
  },
  {
    name: 'query-languages',
    uri: 'horizon://knowledge/query-languages',
    description: 'HCQL/HRQL/HEQL/HDQL query syntax',
    content: queryLanguagesContent,
    splitSections: true,
    priority: 0.95,
  },
  {
    name: 'rbac',
    uri: 'horizon://knowledge/rbac',
    description: 'Role-based access control configuration',
    content: rbacContent,
  },
  {
    name: 'architecture',
    uri: 'horizon://knowledge/architecture',
    description: 'Horizon architecture overview',
    content: architectureContent,
  },
  {
    name: 'dictionary-matrix',
    uri: 'horizon://knowledge/dictionary-matrix',
    description: 'Certificate field dictionary and matrix',
    content: dictionaryMatrixContent,
  },
  {
    name: 'discovery',
    uri: 'horizon://knowledge/discovery',
    description: 'Certificate discovery campaigns and scanning',
    content: discoveryContent,
  },
  {
    name: 'automation',
    uri: 'horizon://knowledge/automation',
    description: 'Automation triggers and hooks',
    content: automationContent,
  },
  {
    name: 'integrations',
    uri: 'horizon://knowledge/integrations',
    description: 'Third-party integrations guide',
    content: integrationsContent,
    splitSections: true,
  },
  {
    name: 'dashboards',
    uri: 'horizon://knowledge/dashboards',
    description: 'Dashboard and saved query configuration',
    content: dashboardsContent,
  },
  {
    name: 'system-admin',
    uri: 'horizon://knowledge/system-admin',
    description: 'System administration guide',
    content: systemAdminContent,
  },
  {
    name: 'discovery-workflows',
    uri: 'horizon://knowledge/discovery-workflows',
    description: 'Discovery workflow configuration',
    content: discoveryWorkflowsContent,
    splitSections: true,
  },
  {
    name: 'datasources',
    uri: 'horizon://knowledge/datasources',
    description: 'Data source configuration (DNS/LDAP/REST)',
    content: datasourcesContent,
    splitSections: true,
  },
  {
    name: 'validation-rules',
    uri: 'horizon://knowledge/validation-rules',
    description: 'Validation rules configuration',
    content: validationRulesContent,
    splitSections: true,
  },
  {
    name: 'rest-notifications',
    uri: 'horizon://knowledge/rest-notifications',
    description: 'REST notification trigger configuration',
    content: restNotificationsContent,
    splitSections: true,
  },
  {
    name: 'server-rules',
    uri: 'horizon://knowledge/server-rules',
    description: 'Operating rules and conventions for the MCP server',
    content: serverRulesContent,
    priority: 0.9,
  },
] as const;

const CURATED_RESOURCES: readonly ResourceEntry[] = [
  {
    name: 'tool-selection',
    uri: 'horizon://knowledge/tool-selection',
    description: 'Deterministic tool selection playbook for smaller models',
    content: toolSelectionContent,
    priority: 1.0,
  },
  // Integration recipes - readable on demand but kept out of the default
  // resources/list to keep the listing short. The model can still request
  // them by URI directly.
  {
    name: 'adcs-integration',
    uri: 'horizon://knowledge/adcs-integration',
    description: 'ADCS integration recipe and verification checklist',
    content: adcsIntegrationContent,
    listed: false,
    priority: 0.5,
  },
  {
    name: 'digicert-integration',
    uri: 'horizon://knowledge/digicert-integration',
    description: 'DigiCert connector recipe and field checklist',
    content: digicertIntegrationContent,
    listed: false,
    priority: 0.5,
  },
  {
    name: 'intune-integration',
    uri: 'horizon://knowledge/intune-integration',
    description: 'Intune and Intune PKCS integration recipe',
    content: intuneIntegrationContent,
    listed: false,
    priority: 0.5,
  },
] as const;

function slugifyHeading(title: string): string {
  return title
    .toLowerCase()
    .replace(/[`"'’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type SectionCandidate = {
  readonly title: string;
  readonly body: string;
};

function splitMarkdownSections(content: string): SectionCandidate[] {
  const lines = content.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current.length > 0) {
        sections.push(current.join('\n'));
      }
      current = [line];
      continue;
    }

    if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    sections.push(current.join('\n'));
  }

  return sections
    .map((section) => {
      const [first, ...rest] = section.trim().split('\n');
      const title = first?.replace(/^## /, '').trim() ?? '';
      if (!title) return undefined;

      return {
        title,
        body: rest.join('\n').trim(),
      } satisfies SectionCandidate;
    })
    .filter((entry): entry is SectionCandidate => entry !== undefined);
}

function createSectionContent(
  resource: ResourceEntry,
  section: SectionCandidate,
): string {
  return [
    `# ${section.title}`,
    '',
    `Parent resource: ${resource.uri}`,
    `Parent topic: ${resource.description}`,
    '',
    section.body,
  ].join('\n');
}

function splitSections(resource: ResourceEntry): ResourceEntry[] {
  if (!resource.splitSections) return [];

  const sections = splitMarkdownSections(resource.content);

  return sections
    .map((section) => {
      const slug = slugifyHeading(section.title);
      if (!section.title || !slug) return undefined;

      const entry: ResourceEntry = {
        name: `${resource.name}-${slug}`,
        uri: `${resource.uri}/${slug}`,
        description: `${resource.description} - ${section.title}`,
        content: createSectionContent(resource, section),
        listed: false,
        priority: 0.3,
      };
      return entry;
    })
    .filter((entry): entry is ResourceEntry => entry !== undefined);
}

const SECTION_RESOURCES = CORE_RESOURCES.flatMap(splitSections);

export const CORE_RESOURCE_URIS = CORE_RESOURCES.map(
  (resource) => resource.uri,
);
export const CURATED_RESOURCE_URIS = CURATED_RESOURCES.map(
  (resource) => resource.uri,
);

/** Every known resource, including section URIs that are unlisted. */
export function getAllResources(): ResourceEntry[] {
  return [...CORE_RESOURCES, ...CURATED_RESOURCES, ...SECTION_RESOURCES];
}

/** Resources to advertise in `resources/list`. Skips unlisted entries. */
export function getListedResources(): ResourceEntry[] {
  return getAllResources().filter((r) => r.listed !== false);
}

/** Resolve a single resource by URI (used for both listed and unlisted). */
export function getResourceByUri(uri: string): ResourceEntry | undefined {
  return getAllResources().find((r) => r.uri === uri);
}

/** URI template that covers split-section resources. */
export const SECTION_URI_TEMPLATE = 'horizon://knowledge/{topic}/{section}';
