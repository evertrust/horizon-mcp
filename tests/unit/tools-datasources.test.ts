/**
 * Datasource tool-layer unit tests - port of test_datasource_tools.py.
 *
 * Coverage:
 *   8 tools: list, get, create (dns/ldap/rest), update, delete, test
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { vi } from "vitest";

import { registerDatasourceTools } from "../../src/tools/datasources.js";
import { HorizonError } from "../../src/client/errors.js";

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function createMockClient() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(null),
    getBytes: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    getText: vi.fn().mockResolvedValue(""),
    postText: vi.fn().mockResolvedValue(""),
    postMultipart: vi.fn().mockResolvedValue({}),
    request: vi.fn().mockResolvedValue(new Response()),
    close: vi.fn().mockResolvedValue(undefined),
    fetchCsrfToken: vi.fn().mockResolvedValue(undefined),
    exportTimeout: 120000,
    principalName: undefined,
    horizonVersion: undefined,
  };
}

type MockClient = ReturnType<typeof createMockClient>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseToolResult(result: unknown): Record<string, unknown> {
  const r = result as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

function resetMocks(mc: MockClient): void {
  mc.get.mockReset().mockResolvedValue({});
  mc.post.mockReset().mockResolvedValue({});
  mc.put.mockReset().mockResolvedValue({});
  mc.patch.mockReset().mockResolvedValue({});
  mc.delete.mockReset().mockResolvedValue(null);
  mc.getBytes.mockReset().mockResolvedValue(new ArrayBuffer(0));
  mc.getText.mockReset().mockResolvedValue("");
  mc.postText.mockReset().mockResolvedValue("");
  mc.postMultipart.mockReset().mockResolvedValue({});
  mc.request.mockReset().mockResolvedValue(new Response());
}

async function setupServerAndClient(): Promise<{
  client: Client;
  mockClient: MockClient;
}> {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const mc = createMockClient();
  registerDatasourceTools(server, mc as any);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    c.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client: c, mockClient: mc };
}

let client: Client;
let mockClient: MockClient;

beforeAll(async () => {
  const ctx = await setupServerAndClient();
  client = ctx.client;
  mockClient = ctx.mockClient;
});

beforeEach(() => {
  resetMocks(mockClient);
});

// ===========================================================================
// 1. LIST DATASOURCES
// ===========================================================================

describe("list_datasources", () => {
  it("returns all", async () => {
    mockClient.get.mockResolvedValueOnce([
      { name: "corp-ldap", type: "ldap" },
      { name: "dns-check", type: "dns" },
      { name: "api-lookup", type: "rest" },
    ]);
    const result = await client.callTool({
      name: "list_datasources",
      arguments: {},
    });
    const parsed = parseToolResult(result);

    expect(mockClient.get).toHaveBeenCalledWith("/api/v1/datasources");
    expect(parsed["count"]).toBe(3);
    expect(parsed["kind"]).toBe("datasource");
    expect(parsed["truncated"]).toBe(false);
  });

  it("filters by type", async () => {
    mockClient.get.mockResolvedValueOnce([
      { name: "corp-ldap", type: "ldap" },
      { name: "dns-check", type: "dns" },
    ]);
    const result = await client.callTool({
      name: "list_datasources",
      arguments: { ds_type: "dns" },
    });
    const parsed = parseToolResult(result);

    expect(parsed["count"]).toBe(1);
    const items = parsed["items"] as Array<Record<string, unknown>>;
    expect(items[0]!["name"]).toBe("dns-check");
  });

  it("filters by name", async () => {
    mockClient.get.mockResolvedValueOnce([
      { name: "corp-ldap", type: "ldap" },
      { name: "corp-dns", type: "dns" },
      { name: "api-lookup", type: "rest" },
    ]);
    const result = await client.callTool({
      name: "list_datasources",
      arguments: { name_contains: "corp" },
    });
    const parsed = parseToolResult(result);

    expect(parsed["count"]).toBe(2);
  });

  it("rejects invalid type", async () => {
    const result = await client.callTool({
      name: "list_datasources",
      arguments: { ds_type: "sql" },
    });
    const parsed = parseToolResult(result);

    expect(parsed["error"]).toBeDefined();
    expect(parsed["valid_types"]).toBeDefined();
    expect(mockClient.get).not.toHaveBeenCalled();
  });

  it("truncates results", async () => {
    mockClient.get.mockResolvedValueOnce(
      Array.from({ length: 60 }, (_, i) => ({ name: `ds-${i}`, type: "dns" })),
    );
    const result = await client.callTool({
      name: "list_datasources",
      arguments: { max_items: 5 },
    });
    const parsed = parseToolResult(result);

    expect(parsed["truncated"]).toBe(true);
    expect(parsed["count"]).toBe(5);
    expect(parsed["total_available"]).toBe(60);
  });
});

// ===========================================================================
// 2. GET DATASOURCE
// ===========================================================================

describe("get_datasource", () => {
  it("returns datasource", async () => {
    mockClient.get.mockResolvedValueOnce({
      name: "corp-ldap",
      type: "ldap",
      hostname: "ldaps://ldap.corp.local",
    });
    const result = await client.callTool({
      name: "get_datasource",
      arguments: { name: "corp-ldap" },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/v1/datasources/corp-ldap",
    );
    expect(parsed["name"]).toBe("corp-ldap");
    expect(parsed["type"]).toBe("ldap");
  });

  it("raises when not found", async () => {
    mockClient.get.mockRejectedValueOnce(
      new HorizonError(404, {
        errorCode: "DS-003",
        message: "DataSource not found",
      }),
    );

    const result = await client.callTool({
      name: "get_datasource",
      arguments: { name: "nonexistent" },
    });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// 3. CREATE DNS DATASOURCE
// ===========================================================================

describe("create_dns_datasource", () => {
  it("creates minimal DNS datasource", async () => {
    mockClient.post.mockResolvedValueOnce({
      name: "dns-check",
      type: "dns",
    });
    const result = await client.callTool({
      name: "create_dns_datasource",
      arguments: {
        name: "dns-check",
        lookup: "{{csr.san.dnsname.1}}",
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.post).toHaveBeenCalledOnce();
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload["type"]).toBe("dns");
    expect(payload["name"]).toBe("dns-check");
    expect(payload["lookup"]).toBe("{{csr.san.dnsname.1}}");
    expect(payload["port"]).toBe(53);
    expect(payload["timeout"]).toBe("10 seconds");
    expect(parsed["status"]).toBe("created");
    expect(parsed["kind"]).toBe("datasource");
  });

  it("creates full DNS datasource", async () => {
    mockClient.post.mockResolvedValueOnce({
      name: "dns-full",
      type: "dns",
    });
    await client.callTool({
      name: "create_dns_datasource",
      arguments: {
        name: "dns-full",
        lookup: "{{hostname}}",
        host: "10.0.0.53",
        port: 5353,
        timeout: "30s",
        record_types: ["a", "cname"],
        description: "Corporate DNS check",
        display_name: [{ lang: "en", value: "DNS Check" }],
      },
    });
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload["host"]).toBe("10.0.0.53");
    expect(payload["port"]).toBe(5353);
    expect(payload["timeout"]).toBe("30s");
    expect(payload["recordTypes"]).toEqual(["a", "cname"]);
    expect(payload["description"]).toBe("Corporate DNS check");
    expect(payload["displayName"]).toEqual([
      { lang: "en", value: "DNS Check" },
    ]);
  });

  it("rejects invalid record type", async () => {
    const result = await client.callTool({
      name: "create_dns_datasource",
      arguments: {
        name: "bad-dns",
        lookup: "{{hostname}}",
        record_types: ["a", "mx"],
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed["error"]).toBeDefined();
    expect(JSON.stringify(parsed)).toContain("mx");
    expect(mockClient.post).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. CREATE LDAP DATASOURCE
// ===========================================================================

describe("create_ldap_datasource", () => {
  it("creates minimal LDAP datasource", async () => {
    mockClient.post.mockResolvedValueOnce({
      name: "corp-ldap",
      type: "ldap",
    });
    const result = await client.callTool({
      name: "create_ldap_datasource",
      arguments: {
        name: "corp-ldap",
        hostname: "ldaps://ldap.corp.local",
        credentials: "ldap-bind-creds",
        base_dn: "DC=corp,DC=local",
        filter: "(sAMAccountName={{username}})",
        secure: true,
        timeout: "10s",
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.post).toHaveBeenCalledOnce();
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload["type"]).toBe("ldap");
    expect(payload["name"]).toBe("corp-ldap");
    expect(payload["hostname"]).toBe("ldaps://ldap.corp.local");
    expect(payload["credentials"]).toBe("ldap-bind-creds");
    expect(payload["baseDn"]).toBe("DC=corp,DC=local");
    expect(payload["filter"]).toBe("(sAMAccountName={{username}})");
    expect(payload["secure"]).toBe(true);
    expect(payload["timeout"]).toBe("10s");
    expect(parsed["status"]).toBe("created");
  });

  it("creates full LDAP datasource", async () => {
    mockClient.post.mockResolvedValueOnce({
      name: "corp-ldap-full",
      type: "ldap",
    });
    await client.callTool({
      name: "create_ldap_datasource",
      arguments: {
        name: "corp-ldap-full",
        hostname: "ldaps://ldap.corp.local",
        credentials: "ldap-bind-creds",
        base_dn: "DC=corp,DC=local",
        filter: "(cn={{cn}})",
        secure: true,
        timeout: "10s",
        port: 636,
        disable_hostname_validation: true,
        attributes: [{ key: "cn", multi: false, selected: true }],
        limit: 1,
        follow_referrals: true,
        proxy: "corp-proxy",
        description: "Corporate LDAP lookup",
      },
    });
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload["port"]).toBe(636);
    expect(payload["disableHostnameValidation"]).toBe(true);
    expect(payload["attributes"]).toEqual([
      { key: "cn", multi: false, selected: true },
    ]);
    expect(payload["limit"]).toBe(1);
    expect(payload["followReferrals"]).toBe(true);
    expect(payload["proxy"]).toBe("corp-proxy");
  });
});

// ===========================================================================
// 5. CREATE REST DATASOURCE
// ===========================================================================

describe("create_rest_datasource", () => {
  it("creates minimal REST datasource", async () => {
    mockClient.post.mockResolvedValueOnce({
      name: "api-lookup",
      type: "rest",
    });
    const result = await client.callTool({
      name: "create_rest_datasource",
      arguments: {
        name: "api-lookup",
        method: "GET",
        url: "https://api.example.com/v1/check/{{hostname}}",
        authentication_type: "bearer",
        credentials: "api-token",
        timeout: "10s",
        expected_http_codes: [200],
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.post).toHaveBeenCalledOnce();
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload["type"]).toBe("rest");
    expect(payload["method"]).toBe("GET");
    expect(payload["url"]).toBe(
      "https://api.example.com/v1/check/{{hostname}}",
    );
    expect(payload["authenticationType"]).toBe("bearer");
    expect(payload["credentials"]).toBe("api-token");
    expect(payload["expectedHttpCodes"]).toEqual([200]);
    expect(parsed["status"]).toBe("created");
  });

  it("rejects invalid auth type", async () => {
    const result = await client.callTool({
      name: "create_rest_datasource",
      arguments: {
        name: "bad-rest",
        method: "GET",
        url: "https://example.com",
        authentication_type: "oauth2",
        timeout: "10s",
        expected_http_codes: [200],
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed["error"]).toBeDefined();
    expect(parsed["valid_types"]).toBeDefined();
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  it("rejects missing credentials for auth type", async () => {
    const result = await client.callTool({
      name: "create_rest_datasource",
      arguments: {
        name: "bad-rest",
        method: "GET",
        url: "https://example.com",
        authentication_type: "basic",
        timeout: "10s",
        expected_http_codes: [200],
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed["error"]).toBeDefined();
    expect(String(parsed["error"])).toContain("credentials");
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  it("rejects empty expected codes", async () => {
    const result = await client.callTool({
      name: "create_rest_datasource",
      arguments: {
        name: "bad-rest",
        method: "GET",
        url: "https://example.com",
        authentication_type: "noauth",
        timeout: "10s",
        expected_http_codes: [],
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed["error"]).toBeDefined();
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  it("accepts noauth without credentials", async () => {
    mockClient.post.mockResolvedValueOnce({
      name: "public-api",
      type: "rest",
    });
    const result = await client.callTool({
      name: "create_rest_datasource",
      arguments: {
        name: "public-api",
        method: "GET",
        url: "https://api.example.com/check",
        authentication_type: "noauth",
        timeout: "10s",
        expected_http_codes: [200],
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed["status"]).toBe("created");
  });

  it("creates with full payload", async () => {
    mockClient.post.mockResolvedValueOnce({
      name: "cmdb-api",
      type: "rest",
    });
    await client.callTool({
      name: "create_rest_datasource",
      arguments: {
        name: "cmdb-api",
        method: "POST",
        url: "https://cmdb.corp.local/api/hosts",
        authentication_type: "custom",
        credentials: "cmdb-token",
        timeout: "15s",
        expected_http_codes: [200, 201],
        headers: [
          {
            name: "X-Custom-Auth",
            value: "Token {{credentials.raw}}",
          },
        ],
        payload_type: "json",
        payload: "hostname={{csr.san.dnsname.1}}",
        proxy: "corp-proxy",
        attributes: [{ key: "owner", multi: false, selected: true }],
      },
    });
    const payload = mockClient.post.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(payload["headers"]).toEqual([
      { name: "X-Custom-Auth", value: "Token {{credentials.raw}}" },
    ]);
    expect(payload["payloadType"]).toBe("json");
    expect(payload["payload"]).toBe("hostname={{csr.san.dnsname.1}}");
    expect(payload["proxy"]).toBe("corp-proxy");
  });
});

// ===========================================================================
// 6. UPDATE DATASOURCE
// ===========================================================================

describe("update_datasource", () => {
  it("updates DNS lookup", async () => {
    mockClient.get.mockResolvedValueOnce({
      _id: "abc",
      name: "dns-check",
      type: "dns",
      lookup: "{{old}}",
      port: 53,
    });
    mockClient.put.mockResolvedValueOnce({
      name: "dns-check",
      lookup: "{{new}}",
    });
    const result = await client.callTool({
      name: "update_datasource",
      arguments: { name: "dns-check", lookup: "{{new}}" },
    });
    const parsed = parseToolResult(result);

    expect(parsed["status"]).toBe("updated");
    expect(parsed["kind"]).toBe("datasource");

    // Verify GET-strip-merge-PUT cycle
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/v1/datasources/dns-check",
    );
    const putPayload = mockClient.put.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(putPayload["lookup"]).toBe("{{new}}");
    expect(putPayload["_id"]).toBeUndefined(); // stripped
  });

  it("updates LDAP filter", async () => {
    mockClient.get.mockResolvedValueOnce({
      _id: "def",
      name: "corp-ldap",
      type: "ldap",
      filter: "(cn={{old}})",
      baseDn: "DC=corp,DC=local",
    });
    mockClient.put.mockResolvedValueOnce({ name: "corp-ldap" });
    await client.callTool({
      name: "update_datasource",
      arguments: {
        name: "corp-ldap",
        filter: "(sAMAccountName={{new}})",
      },
    });
    const putPayload = mockClient.put.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(putPayload["filter"]).toBe("(sAMAccountName={{new}})");
    expect(putPayload["baseDn"]).toBe("DC=corp,DC=local"); // preserved
  });

  it("rejects invalid record types", async () => {
    const result = await client.callTool({
      name: "update_datasource",
      arguments: { name: "dns-check", record_types: ["mx"] },
    });
    const parsed = parseToolResult(result);

    expect(parsed["error"]).toBeDefined();
    expect(mockClient.get).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 7. DELETE DATASOURCE
// ===========================================================================

describe("delete_datasource", () => {
  it("deletes with matching name", async () => {
    const result = await client.callTool({
      name: "delete_datasource",
      arguments: { name: "old-ds", expected_name: "old-ds" },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.delete).toHaveBeenCalledWith(
      "/api/v1/datasources/old-ds",
    );
    expect(parsed["deleted"]).toBe(true);
    expect(parsed["kind"]).toBe("datasource");
  });

  it("raises on name mismatch", async () => {
    const result = await client.callTool({
      name: "delete_datasource",
      arguments: { name: "ds-a", expected_name: "ds-b" },
    });
    expect(result.isError).toBe(true);

    expect(mockClient.delete).not.toHaveBeenCalled();
  });

  it("propagates referenced datasource error", async () => {
    mockClient.delete.mockRejectedValueOnce(
      new HorizonError(400, {
        errorCode: "DS-005",
        message: "Referenced DataSource - cannot delete",
      }),
    );

    const result = await client.callTool({
      name: "delete_datasource",
      arguments: { name: "in-use-ds", expected_name: "in-use-ds" },
    });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// 8. TEST DATASOURCE
// ===========================================================================

describe("test_datasource", () => {
  it("tests DNS datasource", async () => {
    mockClient.patch.mockResolvedValueOnce({
      name: "dns-check",
      type: "dns",
      status: "success",
      dictionary: [{ key: "cname", value: "web01.paas.internal" }],
    });
    const result = await client.callTool({
      name: "test_datasource",
      arguments: {
        ds_type: "dns",
        name: "dns-check",
        lookup: "{{hostname}}",
        context: { hostname: "app.corp.local" },
      },
    });
    const parsed = parseToolResult(result);

    expect(mockClient.patch).toHaveBeenCalledOnce();
    const body = mockClient.patch.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    const ds = body["ds"] as Record<string, unknown>;
    expect(ds["type"]).toBe("dns");
    expect(ds["lookup"]).toBe("{{hostname}}");
    const ctx = body["context"] as Array<Record<string, string>>;
    expect(ctx).toEqual([{ key: "hostname", value: "app.corp.local" }]);
    expect(parsed["status"]).toBe("success");
  });

  it("requires lookup for DNS", async () => {
    const result = await client.callTool({
      name: "test_datasource",
      arguments: { ds_type: "dns", name: "dns-check" },
    });
    const parsed = parseToolResult(result);

    expect(parsed["error"]).toBeDefined();
    expect(mockClient.patch).not.toHaveBeenCalled();
  });

  it("tests LDAP datasource", async () => {
    mockClient.patch.mockResolvedValueOnce({
      name: "corp-ldap",
      type: "ldap",
      status: "success",
      computedDN: "DC=corp,DC=local",
      computedFilter: "(sAMAccountName=jdoe)",
      dictionary: [{ key: "department", value: "Engineering" }],
    });
    const result = await client.callTool({
      name: "test_datasource",
      arguments: {
        ds_type: "ldap",
        name: "corp-ldap",
        hostname: "ldaps://ldap.corp.local",
        credentials: "ldap-creds",
        base_dn: "DC=corp,DC=local",
        filter: "(sAMAccountName={{username}})",
        secure: true,
        context: { username: "jdoe" },
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed["status"]).toBe("success");
    expect(parsed["computedFilter"]).toBe("(sAMAccountName=jdoe)");
  });

  it("requires LDAP fields", async () => {
    const result = await client.callTool({
      name: "test_datasource",
      arguments: {
        ds_type: "ldap",
        name: "bad-ldap",
        hostname: "ldaps://ldap.corp.local",
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed["error"]).toBeDefined();
    expect(mockClient.patch).not.toHaveBeenCalled();
  });

  it("tests REST datasource", async () => {
    mockClient.patch.mockResolvedValueOnce({
      name: "api-check",
      type: "rest",
      status: "success",
      responseCode: 200,
      dictionary: [{ key: "owner", value: "team-platform" }],
    });
    const result = await client.callTool({
      name: "test_datasource",
      arguments: {
        ds_type: "rest",
        name: "api-check",
        method: "GET",
        url: "https://api.example.com/check/{{hostname}}",
        authentication_type: "noauth",
        timeout: "10s",
        expected_http_codes: [200],
        context: { hostname: "web01.corp.local" },
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed["status"]).toBe("success");
    expect(parsed["responseCode"]).toBe(200);
  });

  it("requires REST fields", async () => {
    const result = await client.callTool({
      name: "test_datasource",
      arguments: {
        ds_type: "rest",
        name: "bad-rest",
        method: "GET",
      },
    });
    const parsed = parseToolResult(result);

    expect(parsed["error"]).toBeDefined();
    expect(mockClient.patch).not.toHaveBeenCalled();
  });

  it("rejects invalid datasource type", async () => {
    const result = await client.callTool({
      name: "test_datasource",
      arguments: { ds_type: "graphql", name: "bad" },
    });
    const parsed = parseToolResult(result);

    expect(parsed["error"]).toBeDefined();
    expect(parsed["valid_types"]).toBeDefined();
  });

  it("supports DNS record types", async () => {
    mockClient.patch.mockResolvedValueOnce({
      status: "success",
      dictionary: [],
    });
    await client.callTool({
      name: "test_datasource",
      arguments: {
        ds_type: "dns",
        name: "dns-cname-only",
        lookup: "{{hostname}}",
        record_types: ["cname"],
        host: "10.0.0.53",
        context: { hostname: "app.corp.local" },
      },
    });
    const body = mockClient.patch.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    const ds = body["ds"] as Record<string, unknown>;
    expect(ds["recordTypes"]).toEqual(["cname"]);
    expect(ds["host"]).toBe("10.0.0.53");
  });
});

// ===========================================================================
// CROSS-CUTTING: HorizonError propagation
// ===========================================================================

describe("Datasource error propagation", () => {
  it("propagates already-exists on create", async () => {
    mockClient.post.mockRejectedValueOnce(
      new HorizonError(400, {
        errorCode: "DS-004",
        message: "DataSource already exists",
      }),
    );

    const result = await client.callTool({
      name: "create_dns_datasource",
      arguments: { name: "existing-ds", lookup: "{{hostname}}" },
    });
    expect(result.isError).toBe(true);
  });

  it("propagates 404 on get", async () => {
    mockClient.get.mockRejectedValueOnce(
      new HorizonError(404, {
        errorCode: "DS-003",
        message: "DataSource not found",
      }),
    );

    const result = await client.callTool({
      name: "get_datasource",
      arguments: { name: "nonexistent" },
    });
    expect(result.isError).toBe(true);
  });
});
