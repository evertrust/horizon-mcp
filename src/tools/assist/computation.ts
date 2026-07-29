import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { HorizonClient } from '../../client/http.js';
import { registerTool } from '../register.js';

function toMapEntries(
  values: Record<string, unknown> | undefined,
): Array<{ key: string; value: string }> | undefined {
  if (values === undefined) return undefined;
  return Object.entries(values)
    .map(([key, value]) => ({ key, value: String(value) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function toDatasourceFlow(
  flow: Array<{
    datasource: string;
    inputs: Record<string, string>;
    stopOnSuccess: boolean;
  }>,
): Array<{
  ds: string;
  inputs?: Array<{ key: string; value: string }>;
  stopOnSuccess: boolean;
}> {
  return flow.map(({ datasource, inputs, stopOnSuccess }) => {
    const normalizedInputs = Object.entries(inputs)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return {
      ds: datasource,
      inputs: normalizedInputs.length > 0 ? normalizedInputs : undefined,
      stopOnSuccess,
    };
  });
}

export function registerComputationTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'simulate_computation_rule',
    {
      description:
        'Test a computation rule or template string against a dictionary.\n\n' +
        'MANDATORY: Before writing ANY computation rule, you MUST read the ' +
        'knowledge resource horizon://knowledge/computation-and-data-flow. ' +
        'It contains the COMPLETE list of available functions, the exact syntax, ' +
        'and real-world PKI examples. DO NOT invent functions or syntax - only ' +
        'use what is documented in that resource.\n\n' +
        'Available functions (exhaustive list - no others exist):\n' +
        '  String: Upper, Lower, Trim, Substr, Concat, Extract, Replace, OrElse\n' +
        '  List: Filter, Slice, Sort, Split, Unique\n' +
        '  Parsing: ShortenDNS, DomainDNS, EmailUser, EmailDomain, SamAccountNameUser, SamAccountNameDomain\n' +
        '  Date: DateTimeFormat\n' +
        '  Access: Get, First, Last, Join, Match\n' +
        '  Encoding: URLEncode, URLDecode, EscapeJson, JsonArray, DerAsBase64, Base64, Raw\n' +
        '  Special: NULL, NOW\n\n' +
        'Syntax rules:\n' +
        '  - Dictionary lookups: {{key}} for single, [[key]] for multi\n' +
        '  - Functions wrap lookups: Upper({{cn}}), NOT {{Upper(cn)}}\n' +
        '  - Concat on arrays merges them: Concat([[a]], [[b]]) -> combined list\n' +
        '  - Concat with null returns null: use OrElse({{key}}, "") to guard\n' +
        '  - ShortenDNS extracts hostname: ShortenDNS({{fqdn}}) -> first DNS label\n' +
        '  - DomainDNS extracts domain: DomainDNS({{fqdn}}) -> parent domain\n' +
        '  - Sort alphabetically sorts a list\n' +
        '  - Unique deduplicates a list\n\n' +
        'Two expression modes:\n\n' +
        '  computation_rule (default): Full expression language with functions.\n' +
        '    Upper({{cn}}) - DomainDNS({{fqdn}}) - Sort(Unique([[sans]]))\n\n' +
        '  template_string: Text interpolation with embedded {{ }} blocks.\n' +
        '    Hello {{name}}, cert expires {{certificate.not_after}}',
      inputSchema: z.object({
        rule: z
          .string()
          .describe(
            'The expression to evaluate. For computation rules, use function calls with {{key}} for dictionary lookups.',
          ),
        dictionary: z
          .record(z.string(), z.string())
          .describe(
            'Key-value pairs available as variables during evaluation.',
          ),
        mode: z
          .enum(['computation_rule', 'template_string'])
          .default('computation_rule')
          .describe(
            'Expression type - "computation_rule" or "template_string".',
          ),
      }),
    },
    async ({ rule, dictionary, mode }) => {
      const key =
        mode === 'computation_rule' ? 'computationRule' : 'templateString';
      const result = await client.post('/api/v1/templatestring/playground', {
        [key]: rule,
        dictionary,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  registerTool(
    server,
    'simulate_datasource_flow',
    {
      description:
        'Test a datasource flow pipeline against an optional context.\n\n' +
        'Executes a datasource flow chain in test mode and returns the ' +
        'enriched dictionary. Each flow entry specifies a datasource name, ' +
        'input mappings, and an optional stop-on-success flag. The MCP ' +
        "accepts a small-model-friendly shape and translates it to Horizon's " +
        'raw `dsFlow` request body.',
      inputSchema: z.object({
        flow: z
          .array(
            z.object({
              datasource: z.string(),
              inputs: z.record(z.string(), z.string()).default({}),
              stopOnSuccess: z.boolean().default(false),
            }),
          )
          .describe('Ordered list of flow entries.'),
        context: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Optional initial context dictionary.'),
      }),
    },
    async ({ flow, context }) => {
      const body: Record<string, unknown> = { dsFlow: toDatasourceFlow(flow) };
      const normalizedContext = toMapEntries(context);
      if (normalizedContext !== undefined) body['context'] = normalizedContext;
      const result = await client.post('/api/v1/datasource/flows', body);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
