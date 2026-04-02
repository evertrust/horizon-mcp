/**
 * Phase 1 representative lifecycle tools: search_certificates, get_certificate.
 * Full 17-tool module will be completed in Phase 2.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HorizonClient } from "../client/http.js";
import {
  CERT_PRESETS,
  buildSearchPayload,
  truncateRecord,
} from "./helpers.js";

export function registerLifecycleTools(
  server: McpServer,
  client: HorizonClient,
): void {
  server.registerTool(
    "search_certificates",
    {
      description:
        "Search certificates using HCQL query language.\n\n" +
        "IMPORTANT - HCQL is NOT SQL. Use these operators (not =, <, >, LIKE):\n" +
        '  String: field equals "value" | field matches "regex" | field contains "sub" | field in ("a","b")\n' +
        '  Multi-regex: field within ["regex1", "regex2"]\n' +
        "  Date: field before \"2025-06-01\" | field after 30d\n" +
        "  Grade: grade greater than C | grade strictly lower than B\n" +
        "  Status: status is valid | status is not revoked\n" +
        "  Logic: and, or, not, parentheses\n\n" +
        "Date formats: \"2025-06-01\", now, today, 30d, 24h, -30d (relative durations are unquoted)\n" +
        "Supported units: d/days, h/hours, m/minutes, s/seconds (NO weeks or months)\n\n" +
        "Examples (all field names are lowercase - NEVER camelCase):\n" +
        '  module equals "webra" and status is valid\n' +
        '  status is valid and valid.until before 360d and profile equals "TLS-Internal"\n' +
        '  dn matches ".*example\\\\.com" and keytype equals "RSA"\n\n' +
        "Full reference: horizon://knowledge/query-languages\n\n" +
        "IMPORTANT - HCQL vs API field names differ:\n" +
        "  - HCQL query fields are lowercase: contactemail, keytype\n" +
        "  - API fields/sorted_by are camelCase: contactEmail, keyType\n" +
        "  - HCQL date: valid.until, valid.from\n" +
        "  - API date: notAfter, notBefore\n\n" +
        "Presets (return fields):\n" +
        "  - compact (default): dn, serial, profile, module, notAfter, keyType, owner, team\n" +
        "  - diagnostic: adds revocationReason, triggerResults, discoverydata.*, contactemail\n" +
        "  - compliance: adds grade, grade.*, signingalgorithm, keytype, notBefore\n\n" +
        "IMPORTANT - Ownership queries: call whoami first to get identifier + teams.\n" +
        "See also: whoami, get_certificate, aggregate_certificates, export_certificates_csv.",
      inputSchema: z.object({
        query: z.string().describe("HCQL query expression."),
        preset: z
          .enum(["compact", "diagnostic", "compliance"])
          .default("compact")
          .describe("Preset field set (overridden by fields if provided)."),
        fields: z
          .array(z.string())
          .optional()
          .describe("Custom field list (overrides preset)."),
        page_index: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Page index (0-based)."),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe("Results per page (max 100)."),
        sorted_by: z
          .string()
          .optional()
          .describe("Sort field, e.g. 'notAfter' or 'notAfter:Desc'."),
        with_count: z
          .boolean()
          .default(false)
          .describe("Include total count in response."),
      }),
    },
    async ({
      query,
      preset,
      fields,
      page_index,
      page_size,
      sorted_by,
      with_count,
    }) => {
      const effectiveFields =
        fields ?? CERT_PRESETS[preset] ?? CERT_PRESETS["compact"]!;
      const payload = buildSearchPayload(
        query,
        effectiveFields,
        page_index,
        page_size,
        sorted_by,
        with_count,
      );
      const result = await client.post<Record<string, unknown>>(
        "/api/v1/certificates/search",
        payload,
      );

      let records = (result["results"] ??
        result["items"] ??
        []) as Record<string, unknown>[];
      if (Array.isArray(records)) {
        records = records.map(truncateRecord);
      }

      const response: Record<string, unknown> = { results: records };
      if ("count" in result) response["count"] = result["count"];
      if ("hasMore" in result) response["hasMore"] = result["hasMore"];
      response["pageIndex"] = page_index;
      response["pageSize"] = Math.min(page_size, 100);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response) }],
      };
    },
  );

  server.registerTool(
    "get_certificate",
    {
      description:
        "Get full certificate details by ID.\n\n" +
        "Safety tier: read-only\n\n" +
        "Returns complete untruncated data including all fields, SANs, " +
        "extensions, labels, metadata, and discovery data.",
      inputSchema: z.object({
        certificate_id: z.string().describe("Certificate ID."),
      }),
    },
    async ({ certificate_id }) => {
      const result = await client.get(
        `/api/v1/certificates/${certificate_id}`,
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}
