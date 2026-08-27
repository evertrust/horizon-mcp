/**
 * Certificate grading policy tools (READ-ONLY).
 *
 * 2 tools: list / get. Horizon exposes NO create/update/delete request body for
 * grading policies over the REST API: only GET list, GET by name, GET/POST
 * explain and GET run (async grade trigger) exist. The built-in
 * 'Horizon-Grading-Policy' is system-bootstrapped. There is therefore no
 * create/update/delete tool here.
 *
 * Route: /api/v1/certificate/grading/policies, item /{name}.
 */
import type { McpServer } from '@modelcontextprotocol/server';

import type { HorizonClient } from '../../client/http.js';
import { type ConfigSpec, registerReadTools } from './_scaffold.js';

const SPEC: ConfigSpec = {
  noun: 'certificate_grading_policy',
  nounPlural: 'certificate_grading_policies',
  label: 'certificate grading policy',
  routeCollection: '/api/v1/certificate/grading/policies',
  routeItem: '/api/v1/certificate/grading/policies/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id'],
  stripFields: ['_id', 'tenant'],
  putOnCollection: true,
};

export function registerCertificateGradingPolicyTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List certificate grading policies. A grading policy is a weighted set of ' +
      'grading rulesets used to score certificates. READ-ONLY: grading policies ' +
      'cannot be created, updated or deleted via the API (only the built-in ' +
      "'Horizon-Grading-Policy' is provisioned server-side at bootstrap).",
    getDescription:
      'Get a single certificate grading policy by name (its weighted rulesets ' +
      'and localized descriptions).',
  });
}
