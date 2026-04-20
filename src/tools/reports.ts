/**
 * Report management tools for Horizon MCP Server.
 *
 * 3 tools covering report listing, CSV download, and deletion:
 *   - list_reports: list reports with optional name filter and expiry toggle
 *   - download_report: fetch raw CSV content by report UUID
 *   - delete_report: delete a report by UUID with safety echo
 *
 * CRITICAL path note:
 *   - CSV downloads use /reports/{uuid} (NO /api/v1 prefix).
 *   - API management (list / delete) uses /api/v1/reports/.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { HorizonClient } from '../client/http.js';
import { deleteGuard } from './helpers.js';
import { registerTool } from './register.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORT_API_BASE = '/api/v1/reports';
const REPORT_CSV_BASE = '/reports';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerReportTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerTool(
    server,
    'list_reports',
    {
      description:
        'List available reports, optionally filtered by name.\n\n' +
        'Safety tier: read-only\n\n' +
        'When report_name is provided the server returns all report entries ' +
        'matching that name (there can be more than one). Without a name the ' +
        'full report catalogue is returned.',
      inputSchema: z.object({
        max_items: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(50)
          .describe('Maximum items to return (default 50).'),
        report_name: z
          .string()
          .optional()
          .describe('Exact report name to filter on (server-side).'),
        expired: z
          .boolean()
          .default(false)
          .describe('Include expired reports (default false).'),
      }),
    },
    async ({ max_items, report_name, expired }) => {
      const params = new URLSearchParams({
        expired: String(expired),
      });
      const path = report_name
        ? `${REPORT_API_BASE}/${report_name}`
        : REPORT_API_BASE;

      const data = await client.get<unknown>(path, params);
      const items: Record<string, unknown>[] = Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : data
          ? [data as Record<string, unknown>]
          : [];

      const total = items.length;
      const truncated = total > max_items;
      const sliced = items.slice(0, max_items);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              items: sliced,
              count: sliced.length,
              total_available: total,
              truncated,
              kind: 'report',
            }),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'download_report',
    {
      description:
        'Download a report as CSV by its UUID.\n\n' +
        'Safety tier: read-only\n\n' +
        'CRITICAL: The CSV endpoint lives at /reports/{uuid} - there is ' +
        'NO /api/v1 prefix for this path.',
      inputSchema: z.object({
        report_uuid: z.string().describe('UUID of the report to download.'),
      }),
    },
    async ({ report_uuid }) => {
      const csvText = await client.getText(`${REPORT_CSV_BASE}/${report_uuid}`);

      const lines = csvText.trim().split('\n');
      const rowCount = lines.length > 0 ? Math.max(0, lines.length - 1) : 0;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              content: `Report ${report_uuid} downloaded (${rowCount} rows).`,
              csv: csvText,
              rows: rowCount,
            }),
          },
        ],
      };
    },
  );

  registerTool(
    server,
    'delete_report',
    {
      description:
        'STOP - This tool performs an IRREVERSIBLE destructive operation. You MUST ' +
        'ask the user for explicit confirmation before calling this tool. Do not ' +
        'proceed without a clear "yes" from the user. Present what will be ' +
        'permanently destroyed and wait.\n\n' +
        'Delete a report by UUID. Requires UUID confirmation.\n\n' +
        'Safety tier: mutating-destructive',
      inputSchema: z.object({
        report_uuid: z.string().describe('UUID of the report to delete.'),
        expected_uuid: z
          .string()
          .describe('Must exactly match report_uuid as a deletion safeguard.'),
      }),
    },
    async ({ report_uuid, expected_uuid }) => {
      deleteGuard(report_uuid, expected_uuid, 'uuid');
      await client.delete(`${REPORT_API_BASE}/${report_uuid}`);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              deleted: true,
              uuid: report_uuid,
              kind: 'report',
            }),
          },
        ],
      };
    },
  );
}
