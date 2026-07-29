/**
 * Automation policy configuration tools (flat, fully-typed).
 *
 * 5 tools: list / get / create / update / delete.
 * Contract: docs/audit/automation_policies.contract.json (+ .schema.json),
 * traced to AutomationPolicy.scala / AutomationPolicyService.scala /
 * CompliancePolicy.scala. POST and PUT share the exact same body schema.
 *
 * Route: /api/v1/automation/policies. Update PUTs the COLLECTION root (body-keyed
 * full-replace via replaceOne on name); the wrapper does GET-merge so omitted
 * fields are preserved unless cleared. The server-generated _id is stripped.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import {
  type ConfigSpec,
  registerCreateTool,
  registerDeleteTool,
  registerReadTools,
  registerUpdateTool,
} from './_scaffold.js';

const SPEC: ConfigSpec = {
  noun: 'automation_policy',
  nounPlural: 'automation_policies',
  label: 'automation policy',
  routeCollection: '/api/v1/automation/policies',
  routeItem: '/api/v1/automation/policies/{name}',
  idField: 'name',
  immutableKeys: ['name'],
  stripFields: ['_id'],
  putOnCollection: true,
};

const compliancePolicySchema = z
  .object({
    authorized_signing_algorithms: z
      .array(z.string())
      .optional()
      .describe(
        'Optional list of authorized signing algorithm names. Free-form strings, not validated against an enum.',
      ),
    authorized_cas: z
      .array(z.string())
      .optional()
      .describe(
        'Optional list of authorized Certificate Authority names. Each CA must exist AND be trustedForClientAuthentication.',
      ),
  })
  .describe(
    'Optional compliance policy block. Both fields are optional; an empty object {} is accepted.',
  );

const profileSchema = z
  .string()
  .describe(
    'Name of an existing Certificate Profile whose module is one of est/scep/webra/acme/acme-external.',
  );
const executionPolicySchema = z
  .string()
  .describe('Name of an existing Execution Policy. Must pre-exist.');
const trustChainsSchema = z
  .array(z.string())
  .describe(
    'List of existing Certificate Authority names forming accepted trust chains.',
  );

type CompliancePolicyInput = z.infer<typeof compliancePolicySchema>;

function buildCompliancePolicy(
  input: CompliancePolicyInput,
): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (input.authorized_signing_algorithms !== undefined)
    o['authorizedSigningAlgorithms'] = input.authorized_signing_algorithms;
  if (input.authorized_cas !== undefined)
    o['authorizedCas'] = input.authorized_cas;
  return o;
}

function buildAutomationPolicyBody(args: {
  name?: string;
  profile?: string;
  execution_policy?: string;
  trust_chains?: string[];
  compliance_policy?: CompliancePolicyInput;
}): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (args.name !== undefined) o['name'] = args.name;
  if (args.profile !== undefined) o['profile'] = args.profile;
  if (args.execution_policy !== undefined)
    o['executionPolicy'] = args.execution_policy;
  if (args.trust_chains !== undefined) o['trustChains'] = args.trust_chains;
  if (args.compliance_policy !== undefined)
    o['compliancePolicy'] = buildCompliancePolicy(args.compliance_policy);
  return o;
}

export function registerAutomationPolicyTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription: 'List automation policy configurations.',
    getDescription: 'Get a single automation policy configuration by name.',
  });

  registerCreateTool(server, client, SPEC, {
    description:
      'Create an automation policy that binds an enrollment Certificate Profile ' +
      '(est/scep/webra/acme/acme-external) to optional execution, trust-chain, ' +
      'and compliance settings.',
    mandatoryFields: ['name', 'profile'],
    inputSchema: z.object({
      name: z
        .string()
        .describe(
          'Automation policy name. Immutable primary key, regex [0-9a-zA-Z-_.]+.',
        ),
      profile: profileSchema,
      execution_policy: executionPolicySchema.optional(),
      trust_chains: trustChainsSchema.optional(),
      compliance_policy: compliancePolicySchema.optional(),
    }),
    buildPayload: (args) => buildAutomationPolicyBody(args),
  });

  registerUpdateTool(server, client, SPEC, {
    description: 'Update an existing automation policy configuration.',
    inputSchema: z.object({
      name: z
        .string()
        .describe('Automation policy name to update (immutable key).'),
      profile: profileSchema.optional(),
      execution_policy: executionPolicySchema.optional(),
      trust_chains: trustChainsSchema.optional(),
      compliance_policy: compliancePolicySchema.optional(),
      clear_fields: z
        .array(z.string())
        .optional()
        .describe(
          'Top-level fields to explicitly null, e.g. ["executionPolicy","trustChains","compliancePolicy"].',
        ),
    }),
    buildOverrides: (args) => {
      const { name: _name, ...rest } = args;
      return buildAutomationPolicyBody(rest);
    },
  });

  registerDeleteTool(server, client, SPEC, {
    description: 'Delete an automation policy configuration.',
    deleteConstraints:
      'Cannot be deleted while referenced by at least one valid certificate ' +
      '(certificate metadata.automationPolicy == name) (AutomationPolicy005).',
  });
}
