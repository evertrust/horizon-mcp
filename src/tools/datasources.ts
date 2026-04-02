/**
 * External datasource management tools for Horizon MCP Server.
 *
 * 8 tools covering the full datasource lifecycle:
 *   - list_datasources: list all datasources with optional type/name filtering
 *   - get_datasource: fetch a single datasource by name
 *   - create_dns_datasource: create a DNS-type datasource
 *   - create_ldap_datasource: create an LDAP-type datasource
 *   - create_rest_datasource: create a REST-type datasource
 *   - update_datasource: GET-strip-merge-PUT update
 *   - delete_datasource: delete with safety echo
 *   - test_datasource: test a datasource against a context dictionary
 *
 * Knowledge resources:
 *   - horizon://knowledge/datasources
 *   - horizon://knowledge/validation-rules
 *   - horizon://knowledge/dictionary-entries
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HorizonClient } from "../client/http.js";
import {
  applyNameFilter,
  buildListResponse,
  buildMutateResponse,
  deleteGuard,
  getStripMergePut,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DS_BASE = "/api/v1/datasources";
const MAX_LIST_ITEMS = 50;

const VALID_DS_TYPES = new Set(["dns", "ldap", "rest"]);
const VALID_RECORD_TYPES = new Set(["a", "aaaa", "cname", "ptr", "txt"]);
const VALID_AUTH_TYPES = new Set([
  "noauth",
  "basic",
  "x509",
  "bearer",
  "custom",
]);

// ---------------------------------------------------------------------------
// Zod schemas for reuse
// ---------------------------------------------------------------------------

const localizedNameSchema = z
  .array(z.object({ lang: z.string(), value: z.string() }))
  .optional()
  .describe("Localized display names, e.g. [{lang: 'en', value: 'My DS'}].");

const dsAttributeSchema = z
  .array(
    z.object({
      key: z.string(),
      multi: z.boolean(),
      selected: z.boolean(),
    }),
  )
  .optional()
  .describe("Attributes to return. Each: {key, multi, selected}.");

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateDsType(dsType: string): string | undefined {
  if (!VALID_DS_TYPES.has(dsType)) {
    return JSON.stringify({
      error: `Invalid datasource type '${dsType}'.`,
      valid_types: [...VALID_DS_TYPES].sort(),
    });
  }
  return undefined;
}

function validateRecordTypes(recordTypes: string[]): string | undefined {
  const invalid = recordTypes.filter((rt) => !VALID_RECORD_TYPES.has(rt));
  if (invalid.length > 0) {
    return JSON.stringify({
      error: `Invalid DNS record type(s): ${JSON.stringify(invalid.sort())}.`,
      valid_types: [...VALID_RECORD_TYPES].sort(),
    });
  }
  return undefined;
}

function validateAuthType(authType: string): string | undefined {
  if (!VALID_AUTH_TYPES.has(authType)) {
    return JSON.stringify({
      error: `Invalid authentication type '${authType}'.`,
      valid_types: [...VALID_AUTH_TYPES].sort(),
    });
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const obj = data as Record<string, unknown>;
  return (obj["items"] as Record<string, unknown>[] | undefined) ?? [obj];
}

function applyTypeFilter(
  items: Record<string, unknown>[],
  dsType?: string,
): Record<string, unknown>[] {
  if (!dsType) return items;
  return items.filter((it) => it["type"] === dsType);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDatasourceTools(
  server: McpServer,
  client: HorizonClient,
): void {
  // =======================================================================
  // Read-only (2 tools)
  // =======================================================================

  server.registerTool(
    "list_datasources",
    {
      description:
        "List external datasources with optional filtering.\n\n" +
        "Safety tier: read-only\n" +
        "Knowledge: horizon://knowledge/datasources\n\n" +
        "See also: get_datasource, create_dns_datasource, create_ldap_datasource, " +
        "create_rest_datasource, test_datasource.",
      inputSchema: z.object({
        max_items: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(MAX_LIST_ITEMS)
          .describe("Maximum items to return (default 50)."),
        name_contains: z
          .string()
          .optional()
          .describe("Case-insensitive substring filter on datasource name."),
        ds_type: z
          .string()
          .optional()
          .describe('Filter by datasource type: "dns", "ldap", or "rest".'),
      }),
    },
    async ({ max_items, name_contains, ds_type }) => {
      if (ds_type !== undefined) {
        const err = validateDsType(ds_type);
        if (err !== undefined) {
          return { content: [{ type: "text" as const, text: err }] };
        }
      }

      const data = await client.get<unknown>(DS_BASE);
      let items = normalizeItems(data);
      items = applyTypeFilter(items, ds_type);
      items = applyNameFilter(items, name_contains);
      return {
        content: [
          {
            type: "text" as const,
            text: buildListResponse(items, max_items, "datasource"),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_datasource",
    {
      description:
        "Get a single datasource by name.\n\n" +
        "Safety tier: read-only\n" +
        "Knowledge: horizon://knowledge/datasources\n\n" +
        "See also: list_datasources, update_datasource, test_datasource, delete_datasource.",
      inputSchema: z.object({
        name: z.string().describe("Exact datasource name."),
      }),
    },
    async ({ name }) => {
      const result = await client.get(`${DS_BASE}/${name}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  // =======================================================================
  // Create tools (3 tools - one per type)
  // =======================================================================

  server.registerTool(
    "create_dns_datasource",
    {
      description:
        "STOP - This tool modifies data. You MUST ask the user for explicit " +
        "confirmation before calling this tool.\n\n" +
        "Create a DNS datasource for hostname lookups during enrollment.\n\n" +
        "Safety tier: mutating-safe\n" +
        "Knowledge: horizon://knowledge/datasources, horizon://knowledge/validation-rules\n\n" +
        "DNS datasources query DNS servers and return record data (A, AAAA, " +
        "CNAME, PTR, TXT) used in computation/validation rules via " +
        "ds.<flowIndex>.<resultIndex>.<recordType> entries.\n\n" +
        "IMPORTANT: Datasource names are IMMUTABLE after creation.\n\n" +
        "The lookup field is a TemplateString supporting {{key}} syntax for " +
        'dynamic DNS queries, e.g. "{{csr.san.dnsname.1}}".\n\n' +
        "See also: test_datasource, list_datasources.",
      inputSchema: z.object({
        name: z.string().describe("Unique datasource name (immutable primary key)."),
        lookup: z
          .string()
          .describe(
            "DNS hostname to look up - supports {{key}} TemplateString syntax.",
          ),
        display_name: localizedNameSchema,
        description: z
          .string()
          .optional()
          .describe("Human-readable description."),
        host: z
          .string()
          .optional()
          .describe("DNS server IP address. Omit for Horizon's default resolver."),
        port: z.number().int().default(53).describe("DNS server port (default 53)."),
        timeout: z
          .string()
          .default("10 seconds")
          .describe('Query timeout in duration format (default "10 seconds").'),
        record_types: z
          .array(z.string())
          .optional()
          .describe(
            'DNS record types to return: "a", "aaaa", "cname", "ptr", "txt". Omit for all.',
          ),
      }),
    },
    async ({
      name,
      lookup,
      display_name,
      description,
      host,
      port,
      timeout,
      record_types,
    }) => {
      if (record_types !== undefined) {
        const err = validateRecordTypes(record_types);
        if (err !== undefined) {
          return { content: [{ type: "text" as const, text: err }] };
        }
      }

      const payload: Record<string, unknown> = {
        type: "dns",
        name,
        lookup,
        port,
        timeout,
      };
      if (display_name !== undefined) payload["displayName"] = display_name;
      if (description !== undefined) payload["description"] = description;
      if (host !== undefined) payload["host"] = host;
      if (record_types !== undefined) payload["recordTypes"] = record_types;

      const result = await client.post<Record<string, unknown>>(
        DS_BASE,
        payload,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: buildMutateResponse({
              action: "created",
              kind: "datasource",
              name,
              data: result,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "create_ldap_datasource",
    {
      description:
        "STOP - This tool modifies data. You MUST ask the user for explicit " +
        "confirmation before calling this tool.\n\n" +
        "Create an LDAP datasource for directory lookups during enrollment.\n\n" +
        "Safety tier: mutating-safe\n" +
        "Knowledge: horizon://knowledge/datasources, horizon://knowledge/validation-rules\n\n" +
        "LDAP datasources query directory servers (AD, OpenLDAP, etc.) and return " +
        "user/object attributes via ds.<flowIndex>.<resultIndex>.<attribute> entries.\n\n" +
        "IMPORTANT: Datasource names are IMMUTABLE after creation.\n\n" +
        "Prerequisites: The referenced credentials object must already exist in Horizon.\n\n" +
        "See also: test_datasource, list_datasources.",
      inputSchema: z.object({
        name: z.string().describe("Unique datasource name (immutable primary key)."),
        hostname: z
          .string()
          .describe('LDAP server URL (e.g. "ldaps://ldap.corp.example.com").'),
        credentials: z
          .string()
          .describe("Name of existing PasswordCredentials for LDAP bind."),
        base_dn: z
          .string()
          .describe("LDAP search base DN - supports {{key}} TemplateString syntax."),
        filter: z
          .string()
          .describe("LDAP search filter - supports {{key}} TemplateString syntax."),
        secure: z
          .boolean()
          .describe("Use secure LDAP (LDAPS)."),
        timeout: z
          .string()
          .describe('Query timeout in duration format (e.g. "10s", "30 seconds").'),
        display_name: localizedNameSchema,
        description: z
          .string()
          .optional()
          .describe("Human-readable description."),
        port: z
          .number()
          .int()
          .optional()
          .describe("LDAP port. Default: 389 (LDAP) or 636 (LDAPS)."),
        disable_hostname_validation: z
          .boolean()
          .default(false)
          .describe("Skip hostname validation on TLS (default false)."),
        attributes: dsAttributeSchema,
        limit: z
          .number()
          .int()
          .optional()
          .describe("Maximum number of LDAP results to return."),
        follow_referrals: z
          .boolean()
          .optional()
          .describe("Enable LDAP referral traversal."),
        proxy: z
          .string()
          .optional()
          .describe("Name of an existing HTTP proxy object."),
      }),
    },
    async ({
      name,
      hostname,
      credentials,
      base_dn,
      filter,
      secure,
      timeout,
      display_name,
      description,
      port,
      disable_hostname_validation,
      attributes,
      limit,
      follow_referrals,
      proxy,
    }) => {
      const payload: Record<string, unknown> = {
        type: "ldap",
        name,
        hostname,
        credentials,
        baseDn: base_dn,
        filter,
        secure,
        timeout,
      };
      if (display_name !== undefined) payload["displayName"] = display_name;
      if (description !== undefined) payload["description"] = description;
      if (port !== undefined) payload["port"] = port;
      if (disable_hostname_validation) {
        payload["disableHostnameValidation"] = true;
      }
      if (attributes !== undefined) payload["attributes"] = attributes;
      if (limit !== undefined) payload["limit"] = limit;
      if (follow_referrals !== undefined) {
        payload["followReferrals"] = follow_referrals;
      }
      if (proxy !== undefined) payload["proxy"] = proxy;

      const result = await client.post<Record<string, unknown>>(
        DS_BASE,
        payload,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: buildMutateResponse({
              action: "created",
              kind: "datasource",
              name,
              data: result,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "create_rest_datasource",
    {
      description:
        "STOP - This tool modifies data. You MUST ask the user for explicit " +
        "confirmation before calling this tool.\n\n" +
        "Create a REST datasource for HTTP API lookups during enrollment.\n\n" +
        "Safety tier: mutating-safe\n" +
        "Knowledge: horizon://knowledge/datasources, horizon://knowledge/validation-rules\n\n" +
        "REST datasources call HTTP APIs and return parsed response data via " +
        "ds.<flowIndex>.<resultIndex>.<attribute> entries.\n\n" +
        "IMPORTANT: Datasource names are IMMUTABLE after creation.\n\n" +
        "Prerequisites: When authenticationType is not 'noauth', the referenced " +
        "credentials object must already exist in Horizon.\n\n" +
        "See also: test_datasource, list_datasources.",
      inputSchema: z.object({
        name: z.string().describe("Unique datasource name (immutable primary key)."),
        method: z.string().describe("HTTP method (GET, POST, PUT, DELETE, etc.)."),
        url: z
          .string()
          .describe("Endpoint URL - supports {{key}} TemplateString syntax."),
        authentication_type: z
          .string()
          .describe(
            'Auth scheme: "noauth", "basic", "x509", "bearer", or "custom".',
          ),
        timeout: z
          .string()
          .describe('Request timeout in duration format (e.g. "10s").'),
        expected_http_codes: z
          .array(z.number().int())
          .describe("HTTP status codes indicating success (e.g. [200, 201])."),
        display_name: localizedNameSchema,
        description: z
          .string()
          .optional()
          .describe("Human-readable description."),
        credentials: z
          .string()
          .optional()
          .describe(
            'Name of existing credentials. Required when authentication_type is not "noauth".',
          ),
        headers: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional()
          .describe("Custom HTTP headers as [{name, value}]."),
        payload_type: z
          .string()
          .optional()
          .describe('Payload format hint (e.g. "json").'),
        payload: z
          .string()
          .optional()
          .describe("Request body - supports {{key}} TemplateString syntax."),
        proxy: z
          .string()
          .optional()
          .describe("Name of an existing HTTP proxy object."),
        attributes: dsAttributeSchema,
      }),
    },
    async ({
      name,
      method,
      url,
      authentication_type,
      timeout,
      expected_http_codes,
      display_name,
      description,
      credentials,
      headers,
      payload_type,
      payload,
      proxy,
      attributes,
    }) => {
      const authErr = validateAuthType(authentication_type);
      if (authErr !== undefined) {
        return { content: [{ type: "text" as const, text: authErr }] };
      }

      if (authentication_type !== "noauth" && !credentials) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  "credentials is required when authentication_type is not 'noauth'.",
                hint: "Provide the name of an existing credentials object.",
              }),
            },
          ],
        };
      }

      if (expected_http_codes.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  "expected_http_codes must contain at least one HTTP status code.",
                hint: "Common values: [200], [200, 201], [200, 204].",
              }),
            },
          ],
        };
      }

      const body: Record<string, unknown> = {
        type: "rest",
        name,
        method,
        url,
        authenticationType: authentication_type,
        timeout,
        expectedHttpCodes: expected_http_codes,
      };
      if (display_name !== undefined) body["displayName"] = display_name;
      if (description !== undefined) body["description"] = description;
      if (credentials !== undefined) body["credentials"] = credentials;
      if (headers !== undefined) body["headers"] = headers;
      if (payload_type !== undefined) body["payloadType"] = payload_type;
      if (payload !== undefined) body["payload"] = payload;
      if (proxy !== undefined) body["proxy"] = proxy;
      if (attributes !== undefined) body["attributes"] = attributes;

      const result = await client.post<Record<string, unknown>>(DS_BASE, body);
      return {
        content: [
          {
            type: "text" as const,
            text: buildMutateResponse({
              action: "created",
              kind: "datasource",
              name,
              data: result,
            }),
          },
        ],
      };
    },
  );

  // =======================================================================
  // Update (1 tool)
  // =======================================================================

  server.registerTool(
    "update_datasource",
    {
      description:
        "STOP - This tool modifies data. You MUST ask the user for explicit " +
        "confirmation before calling this tool.\n\n" +
        "Update an existing datasource (GET -> strip -> merge -> PUT).\n\n" +
        "Safety tier: mutating-safe\n" +
        "Knowledge: horizon://knowledge/datasources\n\n" +
        "Parameters are type-specific - only set fields relevant to the datasource " +
        "type (dns, ldap, or rest). Irrelevant fields are ignored.\n\n" +
        "IMPORTANT: The datasource name and type cannot be changed after creation.\n\n" +
        "See also: get_datasource, test_datasource.",
      inputSchema: z.object({
        name: z
          .string()
          .describe("Datasource name to update (cannot be changed)."),
        display_name: localizedNameSchema,
        description: z.string().optional().describe("New description."),
        host: z.string().optional().describe("(DNS) New DNS server IP."),
        port: z.number().int().optional().describe("(DNS/LDAP) New port number."),
        timeout: z
          .string()
          .optional()
          .describe("New timeout in duration format."),
        lookup: z
          .string()
          .optional()
          .describe("(DNS) New lookup TemplateString."),
        record_types: z
          .array(z.string())
          .optional()
          .describe("(DNS) New record type filter."),
        hostname: z
          .string()
          .optional()
          .describe("(LDAP) New LDAP server URL."),
        credentials: z
          .string()
          .optional()
          .describe("(LDAP/REST) New credentials name."),
        base_dn: z
          .string()
          .optional()
          .describe("(LDAP) New base DN TemplateString."),
        filter: z
          .string()
          .optional()
          .describe("(LDAP) New search filter TemplateString."),
        secure: z
          .boolean()
          .optional()
          .describe("(LDAP) New secure flag."),
        disable_hostname_validation: z
          .boolean()
          .optional()
          .describe("(LDAP) New hostname validation flag."),
        attributes: dsAttributeSchema,
        limit: z
          .number()
          .int()
          .optional()
          .describe("(LDAP) New result limit."),
        follow_referrals: z
          .boolean()
          .optional()
          .describe("(LDAP) New referral traversal flag."),
        method: z.string().optional().describe("(REST) New HTTP method."),
        url: z
          .string()
          .optional()
          .describe("(REST) New endpoint URL TemplateString."),
        authentication_type: z
          .string()
          .optional()
          .describe("(REST) New auth type."),
        headers: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional()
          .describe("(REST) New HTTP headers."),
        payload_type: z
          .string()
          .optional()
          .describe("(REST) New payload format hint."),
        payload: z
          .string()
          .optional()
          .describe("(REST) New request body TemplateString."),
        expected_http_codes: z
          .array(z.number().int())
          .optional()
          .describe("(REST) New success HTTP codes."),
        proxy: z.string().optional().describe("(LDAP/REST) New proxy name."),
        clear_fields: z
          .array(z.string())
          .optional()
          .describe("Top-level field names to explicitly set to null."),
      }),
    },
    async ({
      name,
      display_name,
      description,
      host,
      port,
      timeout,
      lookup,
      record_types,
      hostname,
      credentials,
      base_dn,
      filter,
      secure,
      disable_hostname_validation,
      attributes,
      limit,
      follow_referrals,
      method,
      url,
      authentication_type,
      headers,
      payload_type,
      payload,
      expected_http_codes,
      proxy,
      clear_fields,
    }) => {
      if (record_types !== undefined) {
        const err = validateRecordTypes(record_types);
        if (err !== undefined) {
          return { content: [{ type: "text" as const, text: err }] };
        }
      }
      if (authentication_type !== undefined) {
        const err = validateAuthType(authentication_type);
        if (err !== undefined) {
          return { content: [{ type: "text" as const, text: err }] };
        }
      }

      const overrides: Record<string, unknown> = {};
      if (display_name !== undefined) overrides["displayName"] = display_name;
      if (description !== undefined) overrides["description"] = description;
      if (host !== undefined) overrides["host"] = host;
      if (port !== undefined) overrides["port"] = port;
      if (timeout !== undefined) overrides["timeout"] = timeout;
      if (lookup !== undefined) overrides["lookup"] = lookup;
      if (record_types !== undefined) overrides["recordTypes"] = record_types;
      if (hostname !== undefined) overrides["hostname"] = hostname;
      if (credentials !== undefined) overrides["credentials"] = credentials;
      if (base_dn !== undefined) overrides["baseDn"] = base_dn;
      if (filter !== undefined) overrides["filter"] = filter;
      if (secure !== undefined) overrides["secure"] = secure;
      if (disable_hostname_validation !== undefined) {
        overrides["disableHostnameValidation"] = disable_hostname_validation;
      }
      if (attributes !== undefined) overrides["attributes"] = attributes;
      if (limit !== undefined) overrides["limit"] = limit;
      if (follow_referrals !== undefined) {
        overrides["followReferrals"] = follow_referrals;
      }
      if (method !== undefined) overrides["method"] = method;
      if (url !== undefined) overrides["url"] = url;
      if (authentication_type !== undefined) {
        overrides["authenticationType"] = authentication_type;
      }
      if (headers !== undefined) overrides["headers"] = headers;
      if (payload_type !== undefined) overrides["payloadType"] = payload_type;
      if (payload !== undefined) overrides["payload"] = payload;
      if (expected_http_codes !== undefined) {
        overrides["expectedHttpCodes"] = expected_http_codes;
      }
      if (proxy !== undefined) overrides["proxy"] = proxy;

      const result = await getStripMergePut(
        client,
        `${DS_BASE}/${name}`,
        DS_BASE,
        "datasource",
        overrides,
        clear_fields,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: buildMutateResponse({
              action: "updated",
              kind: "datasource",
              name,
              data: result,
            }),
          },
        ],
      };
    },
  );

  // =======================================================================
  // Delete (1 tool)
  // =======================================================================

  server.registerTool(
    "delete_datasource",
    {
      description:
        "STOP - This tool performs an IRREVERSIBLE destructive operation. You MUST " +
        "ask the user for explicit confirmation before calling this tool.\n\n" +
        "Delete a datasource. Requires name confirmation.\n\n" +
        "A datasource cannot be deleted if it is still referenced by any " +
        "profile's dsFlow.\n\n" +
        "Safety tier: mutating-destructive\n" +
        "Knowledge: horizon://knowledge/datasources\n\n" +
        "See also: get_datasource, list_datasources.",
      inputSchema: z.object({
        name: z.string().describe("Datasource name to delete."),
        expected_name: z
          .string()
          .describe("Must exactly match name as a deletion safeguard."),
      }),
    },
    async ({ name, expected_name }) => {
      deleteGuard(name, expected_name);
      await client.delete(`${DS_BASE}/${name}`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              deleted: true,
              name,
              kind: "datasource",
            }),
          },
        ],
      };
    },
  );

  // =======================================================================
  // Test (1 tool)
  // =======================================================================

  server.registerTool(
    "test_datasource",
    {
      description:
        "Test a datasource configuration against a context dictionary.\n\n" +
        "Safety tier: read-only (performs a live query but does not persist anything)\n" +
        "Knowledge: horizon://knowledge/datasources\n\n" +
        "Sends the datasource definition and an optional context dictionary to " +
        "Horizon for a one-off test execution.\n\n" +
        "See also: create_dns_datasource, create_ldap_datasource, create_rest_datasource.",
      inputSchema: z.object({
        ds_type: z
          .string()
          .describe('Datasource type: "dns", "ldap", or "rest".'),
        name: z.string().describe("Datasource name (for identification)."),
        context: z
          .record(z.string())
          .optional()
          .describe(
            "Key-value pairs to resolve TemplateString variables. " +
            'Example: {"hostname": "web01.corp.local"}.',
          ),
        lookup: z
          .string()
          .optional()
          .describe("(DNS) Hostname to look up."),
        host: z.string().optional().describe("(DNS) DNS server IP."),
        port: z
          .number()
          .int()
          .optional()
          .describe("(DNS/LDAP) Port number."),
        timeout: z
          .string()
          .optional()
          .describe("Timeout in duration format."),
        record_types: z
          .array(z.string())
          .optional()
          .describe("(DNS) Record types to query."),
        hostname: z
          .string()
          .optional()
          .describe("(LDAP) LDAP server URL."),
        credentials: z
          .string()
          .optional()
          .describe("(LDAP/REST) Credentials name."),
        base_dn: z
          .string()
          .optional()
          .describe("(LDAP) Base DN TemplateString."),
        filter: z
          .string()
          .optional()
          .describe("(LDAP) Search filter TemplateString."),
        secure: z.boolean().optional().describe("(LDAP) Use LDAPS."),
        attributes: dsAttributeSchema,
        limit: z
          .number()
          .int()
          .optional()
          .describe("(LDAP) Max results."),
        method: z.string().optional().describe("(REST) HTTP method."),
        url: z
          .string()
          .optional()
          .describe("(REST) Endpoint URL TemplateString."),
        authentication_type: z
          .string()
          .optional()
          .describe("(REST) Auth type."),
        headers: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional()
          .describe("(REST) HTTP headers."),
        payload_type: z
          .string()
          .optional()
          .describe("(REST) Payload format."),
        payload: z
          .string()
          .optional()
          .describe("(REST) Request body TemplateString."),
        expected_http_codes: z
          .array(z.number().int())
          .optional()
          .describe("(REST) Success HTTP codes."),
      }),
    },
    async ({
      ds_type,
      name,
      context,
      lookup,
      host,
      port,
      timeout,
      record_types,
      hostname,
      credentials,
      base_dn,
      filter,
      secure,
      attributes,
      limit,
      method,
      url,
      authentication_type,
      headers,
      payload_type,
      payload,
      expected_http_codes,
    }) => {
      const typeErr = validateDsType(ds_type);
      if (typeErr !== undefined) {
        return { content: [{ type: "text" as const, text: typeErr }] };
      }

      const ds: Record<string, unknown> = { type: ds_type, name };

      if (ds_type === "dns") {
        if (!lookup) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "lookup is required for DNS datasource tests.",
                }),
              },
            ],
          };
        }
        ds["lookup"] = lookup;
        if (host !== undefined) ds["host"] = host;
        if (port !== undefined) ds["port"] = port;
        if (timeout !== undefined) ds["timeout"] = timeout;
        if (record_types !== undefined) ds["recordTypes"] = record_types;
      } else if (ds_type === "ldap") {
        if (!hostname || !credentials || !base_dn || !filter) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error:
                    "hostname, credentials, base_dn, and filter are all required for LDAP tests.",
                }),
              },
            ],
          };
        }
        ds["hostname"] = hostname;
        ds["credentials"] = credentials;
        ds["baseDn"] = base_dn;
        ds["filter"] = filter;
        ds["secure"] = secure ?? false;
        if (port !== undefined) ds["port"] = port;
        if (timeout !== undefined) ds["timeout"] = timeout;
        if (attributes !== undefined) ds["attributes"] = attributes;
        if (limit !== undefined) ds["limit"] = limit;
      } else if (ds_type === "rest") {
        if (!method || !url || !authentication_type) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error:
                    "method, url, and authentication_type are all required for REST tests.",
                }),
              },
            ],
          };
        }
        ds["method"] = method;
        ds["url"] = url;
        ds["authenticationType"] = authentication_type;
        if (timeout !== undefined) ds["timeout"] = timeout;
        if (expected_http_codes !== undefined) {
          ds["expectedHttpCodes"] = expected_http_codes;
        }
        if (credentials !== undefined) ds["credentials"] = credentials;
        if (headers !== undefined) ds["headers"] = headers;
        if (payload_type !== undefined) ds["payloadType"] = payload_type;
        if (payload !== undefined) ds["payload"] = payload;
        if (attributes !== undefined) ds["attributes"] = attributes;
      }

      const body: Record<string, unknown> = { ds };
      if (context !== undefined) {
        body["context"] = Object.entries(context).map(([key, value]) => ({
          key,
          value,
        }));
      }

      const result = await client.patch(DS_BASE, body);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}
