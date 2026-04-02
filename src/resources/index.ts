import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Plain imports - tsup's loader: { ".md": "text" } handles these at build time
import profilesContent from "./knowledge/profiles.md";
import computationContent from "./knowledge/computation_and_data_flow.md";
import workflowsContent from "./knowledge/workflows.md";
import queryLanguagesContent from "./knowledge/query_languages.md";
import rbacContent from "./knowledge/rbac.md";
import architectureContent from "./knowledge/architecture.md";
import dictionaryMatrixContent from "./knowledge/dictionary_matrix.md";
import discoveryContent from "./knowledge/discovery.md";
import automationContent from "./knowledge/automation.md";
import integrationsContent from "./knowledge/integrations.md";
import dashboardsContent from "./knowledge/dashboards.md";
import systemAdminContent from "./knowledge/system_admin.md";
import discoveryWorkflowsContent from "./knowledge/discovery_workflows.md";
import datasourcesContent from "./knowledge/datasources.md";
import validationRulesContent from "./knowledge/validation_rules.md";
import restNotificationsContent from "./knowledge/rest_notifications.md";

interface ResourceEntry {
  name: string;
  uri: string;
  description: string;
  content: string;
}

const RESOURCES: ResourceEntry[] = [
  { name: "profiles", uri: "horizon://knowledge/profiles", description: "Certificate profile configuration guide", content: profilesContent },
  { name: "computation-and-data-flow", uri: "horizon://knowledge/computation-and-data-flow", description: "Computation rules and data flow engine", content: computationContent },
  { name: "workflows", uri: "horizon://knowledge/workflows", description: "Certificate lifecycle workflow reference", content: workflowsContent },
  { name: "query-languages", uri: "horizon://knowledge/query-languages", description: "HCQL/HRQL/HEQL/HDQL query syntax", content: queryLanguagesContent },
  { name: "rbac", uri: "horizon://knowledge/rbac", description: "Role-based access control configuration", content: rbacContent },
  { name: "architecture", uri: "horizon://knowledge/architecture", description: "Horizon architecture overview", content: architectureContent },
  { name: "dictionary-matrix", uri: "horizon://knowledge/dictionary-matrix", description: "Certificate field dictionary and matrix", content: dictionaryMatrixContent },
  { name: "discovery", uri: "horizon://knowledge/discovery", description: "Certificate discovery campaigns and scanning", content: discoveryContent },
  { name: "automation", uri: "horizon://knowledge/automation", description: "Automation triggers and hooks", content: automationContent },
  { name: "integrations", uri: "horizon://knowledge/integrations", description: "Third-party integrations guide", content: integrationsContent },
  { name: "dashboards", uri: "horizon://knowledge/dashboards", description: "Dashboard and saved query configuration", content: dashboardsContent },
  { name: "system-admin", uri: "horizon://knowledge/system-admin", description: "System administration guide", content: systemAdminContent },
  { name: "discovery-workflows", uri: "horizon://knowledge/discovery-workflows", description: "Discovery workflow configuration", content: discoveryWorkflowsContent },
  { name: "datasources", uri: "horizon://knowledge/datasources", description: "Data source configuration (DNS/LDAP/REST)", content: datasourcesContent },
  { name: "validation-rules", uri: "horizon://knowledge/validation-rules", description: "Validation rules configuration", content: validationRulesContent },
  // Alias: dictionary-entries -> same content as dictionary-matrix
  { name: "dictionary-entries", uri: "horizon://knowledge/dictionary-entries", description: "Certificate field dictionary entries (alias for dictionary-matrix)", content: dictionaryMatrixContent },
  { name: "rest-notifications", uri: "horizon://knowledge/rest-notifications", description: "REST notification trigger configuration", content: restNotificationsContent },
];

export function registerAllResources(server: McpServer): void {
  for (const resource of RESOURCES) {
    server.registerResource(
      resource.name,
      resource.uri,
      { description: resource.description },
      async (uri) => ({
        contents: [{ uri: uri.href, text: resource.content }],
      }),
    );
  }
}
