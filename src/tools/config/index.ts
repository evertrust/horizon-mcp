/**
 * Configuration-object CRUD tools registrar.
 *
 * Wires every config-object tool family (one file per object under
 * `src/tools/config/`) into the MCP server. Each family is generated from a
 * source-grounded contract under `docs/audit/<object>.contract.json`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { HorizonClient } from '../../client/http.js';
import { registerArchiveTools } from './archives.js';
import { registerAutomationPolicyTools } from './automation-policies.js';
import { registerCaTools } from './cas.js';
import { registerCertificateGradingPolicyTools } from './certificate-grading-policies.js';
import { registerCertificateGradingRulesetTools } from './certificate-grading-rulesets.js';
import { registerCertificateLabelTools } from './certificate-labels.js';
import { registerCertificateProfileTools } from './certificate-profiles.js';
import { registerDcvPolicyTools } from './dcv-policies.js';
import { registerDcvProviderTools } from './dcv-providers.js';
import { registerDcvProvisionerTools } from './dcv-provisioners.js';
import { registerExecutionPolicyTools } from './execution-policies.js';
import { registerHttpProxyTools } from './http-proxies.js';
import { registerIdentityProviderTools } from './identity-providers.js';
import { registerPasswordPolicyTools } from './password-policies.js';
import { registerPkiConnectorTools } from './pki-connectors.js';
import { registerPkiQueueTools } from './pki-queues.js';
import { registerRoleTools } from './roles.js';
import { registerScheduledTaskTools } from './scheduled-tasks.js';
import { registerServiceAccountTools } from './service-accounts.js';
import { registerStorageTools } from './storages.js';
import { registerSystemConfigTools } from './system-configuration.js';
import { registerTeamTools } from './teams.js';
import { registerTermsOfServiceTools } from './terms-of-service.js';
import { registerThirdpartyConnectorTools } from './thirdparty-connectors.js';
import { registerTriggerCrudTools } from './triggers.js';
import { registerWcceForestTools } from './wcce-forests.js';

export function registerConfigTools(
  server: McpServer,
  client: HorizonClient,
): void {
  // Certificate & PKI
  registerCaTools(server, client);
  registerCertificateProfileTools(server, client);
  registerCertificateLabelTools(server, client);
  registerCertificateGradingPolicyTools(server, client);
  registerCertificateGradingRulesetTools(server, client);
  registerPkiConnectorTools(server, client);
  registerPkiQueueTools(server, client);

  // RBAC
  registerRoleTools(server, client);
  registerTeamTools(server, client);
  registerPasswordPolicyTools(server, client);

  // Automation & integrations
  registerAutomationPolicyTools(server, client);
  registerExecutionPolicyTools(server, client);
  registerThirdpartyConnectorTools(server, client);
  registerTriggerCrudTools(server, client);
  registerHttpProxyTools(server, client);
  registerWcceForestTools(server, client);

  // System & operations
  registerStorageTools(server, client);
  registerSystemConfigTools(server, client);
  registerScheduledTaskTools(server, client);
  registerArchiveTools(server, client);
  registerTermsOfServiceTools(server, client);

  // DCV automation (Horizon 2.10)
  registerDcvProviderTools(server, client);
  registerDcvProvisionerTools(server, client);
  registerDcvPolicyTools(server, client);

  // Identity & access (READ-ONLY surface)
  registerServiceAccountTools(server, client);
  registerIdentityProviderTools(server, client);
}
