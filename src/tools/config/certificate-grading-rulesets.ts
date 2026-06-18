/**
 * Certificate grading ruleset configuration tools (READ-ONLY).
 *
 * 2 tools: list / get. There is NO create/update/delete: the v1 API exposes
 * only the collection GET (list) and the item GET (get by name), plus an
 * explain/compute route that does not persist anything. Grading rulesets are
 * system-bootstrapped defaults persisted by GradingManagerActor /
 * HorizonBootstrapActor, never created or mutated through the API
 * (GradingRulesetService.add() is internal-only and not wired to any
 * controller route).
 *
 * Contract: docs/audit/certificate_grading_rulesets.contract.json
 * (+ certificate_grading_rulesets.schema.json), traced to
 * CertificateGradingRulesetApiV1Controller.scala / GradingRuleset.scala.
 * verbs = ["list", "get_one"].
 *
 * Route: /api/v1/certificate/grading/rulesets, item /{name}.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { HorizonClient } from '../../client/http.js';
import { type ConfigSpec, registerReadTools } from './_scaffold.js';

const SPEC: ConfigSpec = {
  noun: 'certificate_grading_ruleset',
  nounPlural: 'certificate_grading_rulesets',
  label: 'certificate grading ruleset',
  routeCollection: '/api/v1/certificate/grading/rulesets',
  routeItem: '/api/v1/certificate/grading/rulesets/{name}',
  idField: 'name',
  immutableKeys: ['name', '_id'],
  stripFields: ['tenant'],
  putOnCollection: true,
};

export function registerCertificateGradingRulesetTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerReadTools(server, client, SPEC, {
    listDescription:
      'List certificate grading rulesets. Read-only: grading rulesets are ' +
      'system-bootstrapped defaults (each ruleset has a name, optional scope, ' +
      'and a set of grading rules with conditions and scores) and cannot be ' +
      'created, updated, or deleted through the API.',
    getDescription:
      'Get a single certificate grading ruleset by name (its optional scope ' +
      'and the set of grading rules with their conditions and scores).',
  });
}
