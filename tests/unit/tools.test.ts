/**
 * Tool-layer unit tests - port of test_tools.py.
 *
 * Domains covered:
 *   Profiles    - list_profiles (read-only)
 *   Lifecycle   - search_certificates, get_certificate, download_certificate,
 *                 submit_request, approve/deny/cancel_request
 *   Assist      - whoami, decode_x509, validate_hcql, describe_query_fields
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { vi } from "vitest";

import { registerProfileTools } from "../../src/tools/profiles.js";
import { registerLifecycleTools } from "../../src/tools/lifecycle.js";
import { registerSystemTools } from "../../src/tools/assist/system.js";
import { registerQueryTools } from "../../src/tools/assist/query.js";
import { registerCryptoTools } from "../../src/tools/assist/crypto.js";

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

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function parseToolResult(result: unknown): Record<string, unknown> {
  const r = result as ToolResult;
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

async function setupServerAndClient(
  registerFn: (server: McpServer, client: MockClient) => void,
): Promise<{ client: Client; mockClient: MockClient }> {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const mc = createMockClient();
  registerFn(server, mc);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    c.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client: c, mockClient: mc };
}

// ===========================================================================
// 1. PROFILE TOOLS
// ===========================================================================

describe("Profile tools", () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerProfileTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe("list_profiles", () => {
    it("returns profiles", async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: "WebRA-Prod", module: "webra" },
        { name: "ACME-Staging", module: "acme" },
      ]);

      const result = await client.callTool({
        name: "list_profiles",
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith("/api/v1/certificate/profiles");
      expect(parsed["count"]).toBe(2);
      expect(parsed["kind"]).toBe("profile");
    });

    it("filters by module", async () => {
      mockClient.get.mockResolvedValueOnce([
        { name: "WebRA-Prod", module: "webra" },
        { name: "ACME-Staging", module: "acme" },
        { name: "WebRA-Dev", module: "webra" },
      ]);

      const result = await client.callTool({
        name: "list_profiles",
        arguments: { module: "webra" },
      });
      const parsed = parseToolResult(result);

      expect(parsed["count"]).toBe(2);
      const items = parsed["items"] as Array<Record<string, unknown>>;
      expect(items.every((i) => i["module"] === "webra")).toBe(true);
    });
  });
});

// ===========================================================================
// 2. LIFECYCLE TOOLS
// ===========================================================================

describe("Lifecycle tools", () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerLifecycleTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe("search_certificates", () => {
    it("performs basic search", async () => {
      mockClient.post.mockResolvedValueOnce({
        results: [
          { dn: "CN=test.example.com", serial: "01", profile: "WebRA" },
        ],
      });

      const result = await client.callTool({
        name: "search_certificates",
        arguments: { query: 'profile = "WebRA"' },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledOnce();
      const callArgs = mockClient.post.mock.calls[0]!;
      expect(callArgs[0]).toBe("/api/v1/certificates/search");
      const payload = callArgs[1] as Record<string, unknown>;
      expect(payload["query"]).toBe('profile = "WebRA"');
      expect(payload["fields"]).toContain("dn");
      expect(payload["fields"]).toContain("serial");
      expect(payload["pageIndex"]).toBe(0);
      expect(payload["pageSize"]).toBe(25);

      expect((parsed["results"] as unknown[]).length).toBe(1);
      expect(parsed["pageIndex"]).toBe(0);
    });

    it("custom fields override preset", async () => {
      mockClient.post.mockResolvedValueOnce({ results: [] });

      await client.callTool({
        name: "search_certificates",
        arguments: { query: "*", fields: ["dn", "grade"] },
      });

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload["fields"]).toEqual(["dn", "grade"]);
    });

    it("caps page size at max", async () => {
      // Zod schema enforces max(100). We verify with 100 to confirm the cap.
      mockClient.post.mockResolvedValueOnce({ results: [] });

      const result = await client.callTool({
        name: "search_certificates",
        arguments: { query: "*", page_size: 100 },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload["pageSize"]).toBe(100);
      expect(parsed["pageSize"]).toBe(100);
    });
  });

  describe("get_certificate", () => {
    it("returns full certificate", async () => {
      const certData = {
        dn: "CN=test.example.com",
        serial: "01AB",
        profile: "WebRA",
        extensions: { keyUsage: ["digitalSignature"] },
      };
      mockClient.get.mockResolvedValueOnce(certData);

      const result = await client.callTool({
        name: "get_certificate",
        arguments: { certificate_id: "abc-123" },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        "/api/v1/certificates/abc-123",
      );
      expect(parsed["dn"]).toBe("CN=test.example.com");
      const ext = parsed["extensions"] as Record<string, unknown>;
      expect(ext["keyUsage"]).toEqual(["digitalSignature"]);
    });
  });

  describe("download_certificate", () => {
    it("downloads PEM", async () => {
      const pem =
        "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";
      mockClient.get.mockResolvedValueOnce({
        dn: "CN=test.example.com",
        certificate: pem,
      });

      const result = await client.callTool({
        name: "download_certificate",
        arguments: { certificate_id: "abc-123", format: "pem" },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        "/api/v1/certificates/abc-123",
      );
      expect(parsed["format"]).toBe("pem");
      expect(parsed["content"]).toBe(pem);
    });

    it("rejects non-PEM format", async () => {
      const result = await client.callTool({
        name: "download_certificate",
        arguments: { certificate_id: "abc-123", format: "der" },
      });
      const parsed = parseToolResult(result);

      expect(parsed["error"]).toBeDefined();
      expect(String(parsed["error"])).toContain("Only PEM");
    });

    it("rejects invalid format", async () => {
      const result = await client.callTool({
        name: "download_certificate",
        arguments: { certificate_id: "abc-123", format: "xml" },
      });
      const parsed = parseToolResult(result);

      expect(parsed["error"]).toBeDefined();
      expect(String(parsed["error"])).toContain("Only PEM");
    });

    it("rejects JKS format", async () => {
      const result = await client.callTool({
        name: "download_certificate",
        arguments: { certificate_id: "abc-123", format: "jks" },
      });
      const parsed = parseToolResult(result);

      expect(parsed["error"]).toBeDefined();
      expect(String(parsed["error"])).toContain("Only PEM");
    });
  });

  describe("submit_request", () => {
    it("enrolls with template", async () => {
      mockClient.post.mockResolvedValueOnce({
        id: "req-001",
        workflow: "enroll",
        status: "pending",
      });
      const template = {
        subject: [
          { element: "cn.1", type: "CN", value: "server.local" },
        ],
        sans: [{ type: "DNSNAME", value: ["server.local"] }],
        labels: [{ label: "env", value: "prod" }],
        keyType: "rsa-3072",
      };

      const result = await client.callTool({
        name: "submit_request",
        arguments: {
          workflow: "enroll",
          profile: "my-profile",
          module: "webra",
          template,
          password: "changeit",
        },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledOnce();
      const callArgs = mockClient.post.mock.calls[0]!;
      expect(callArgs[0]).toBe("/api/v1/requests/submit");
      const payload = callArgs[1] as Record<string, unknown>;
      expect(payload["workflow"]).toBe("enroll");
      expect(payload["profile"]).toBe("my-profile");
      expect(payload["module"]).toBe("webra");
      expect(payload["password"]).toBe("changeit");
      const tpl = payload["template"] as Record<string, unknown>;
      expect(tpl["keyType"]).toBe("rsa-3072");
      const sans = tpl["sans"] as Array<Record<string, unknown>>;
      expect(sans[0]!["value"]).toEqual(["server.local"]);
      const labels = tpl["labels"] as Array<Record<string, unknown>>;
      expect(labels[0]!["label"]).toBe("env");
      expect(parsed["id"]).toBe("req-001");
    });

    it("revokes without template", async () => {
      mockClient.post.mockResolvedValueOnce({
        id: "req-002",
        workflow: "revoke",
      });

      await client.callTool({
        name: "submit_request",
        arguments: {
          workflow: "revoke",
          profile: "my-profile",
          module: "webra",
          certificate_id: "cert-abc",
        },
      });

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload["workflow"]).toBe("revoke");
      expect(payload["certificateId"]).toBe("cert-abc");
      expect(payload["template"]).toBeUndefined();
      expect(payload["password"]).toBeUndefined();
    });

    it("explicit params override data", async () => {
      mockClient.post.mockResolvedValueOnce({ id: "req-003" });

      await client.callTool({
        name: "submit_request",
        arguments: {
          workflow: "enroll",
          profile: "p",
          module: "webra",
          template: { keyType: "rsa-3072" },
          data: { template: { keyType: "rsa-2048" }, extra: "field" },
        },
      });

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      const tpl = payload["template"] as Record<string, unknown>;
      expect(tpl["keyType"]).toBe("rsa-3072");
      expect(payload["extra"]).toBe("field");
    });
  });

  describe("approve_request", () => {
    it("approves with permission", async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: "enroll",
        status: "pending",
        profile: "my-profile",
        permissions: { approve: true, cancel: true },
      });
      mockClient.post.mockResolvedValueOnce({
        id: "req-001",
        status: "approved",
      });

      const result = await client.callTool({
        name: "approve_request",
        arguments: { request_id: "req-001" },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith("/api/v1/requests/req-001");
      expect(mockClient.post).toHaveBeenCalledOnce();
      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload).toEqual({ id: "req-001", workflow: "enroll" });
      expect(parsed["status"]).toBe("approved");
    });

    it("blocks without permission", async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: "enroll",
        status: "pending",
        profile: "my-profile",
        permissions: { approve: false, cancel: true },
      });

      const result = await client.callTool({
        name: "approve_request",
        arguments: { request_id: "req-001" },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("Permission denied");
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("blocks non-pending request", async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: "enroll",
        status: "approved",
        permissions: { approve: true, cancel: false },
      });

      const result = await client.callTool({
        name: "approve_request",
        arguments: { request_id: "req-001" },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("pending");
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("deny_request", () => {
    it("denies with permission", async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: "enroll",
        status: "pending",
        permissions: { approve: true, cancel: true },
      });
      mockClient.post.mockResolvedValueOnce({
        id: "req-002",
        status: "denied",
      });

      const result = await client.callTool({
        name: "deny_request",
        arguments: { request_id: "req-002" },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload).toEqual({ id: "req-002", workflow: "enroll" });
      expect(parsed["status"]).toBe("denied");
    });

    it("blocks without permission", async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: "enroll",
        status: "pending",
        permissions: { approve: false, cancel: true },
      });

      const result = await client.callTool({
        name: "deny_request",
        arguments: { request_id: "req-002" },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("Permission denied");
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("cancel_request", () => {
    it("cancels with permission", async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: "enroll",
        status: "pending",
        permissions: { approve: false, cancel: true },
      });
      mockClient.post.mockResolvedValueOnce({
        id: "req-003",
        status: "cancelled",
      });

      const result = await client.callTool({
        name: "cancel_request",
        arguments: { request_id: "req-003" },
      });
      const parsed = parseToolResult(result);

      const payload = mockClient.post.mock.calls[0]![1] as Record<
        string,
        unknown
      >;
      expect(payload).toEqual({ id: "req-003", workflow: "enroll" });
      expect(parsed["status"]).toBe("cancelled");
    });

    it("blocks without permission", async () => {
      mockClient.get.mockResolvedValueOnce({
        workflow: "enroll",
        status: "pending",
        permissions: { approve: true, cancel: false },
      });

      const result = await client.callTool({
        name: "cancel_request",
        arguments: { request_id: "req-003" },
      });
      const r = result as ToolResult;
      const parsed = JSON.parse(r.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("Permission denied");
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// 3. ASSIST TOOLS
// ===========================================================================

describe("Assist tools", () => {
  let client: Client;
  let mockClient: MockClient;

  beforeAll(async () => {
    const ctx = await setupServerAndClient((server, mc) => {
      registerSystemTools(server, mc as any);
      registerQueryTools(server, mc as any);
      registerCryptoTools(server, mc as any);
    });
    client = ctx.client;
    mockClient = ctx.mockClient;
  });

  beforeEach(() => {
    resetMocks(mockClient);
  });

  describe("whoami", () => {
    it("returns principal", async () => {
      const principal = {
        identifier: "test-admin",
        name: "Test Admin",
        roles: ["admin"],
        teams: [],
        permissions: ["*"],
      };
      mockClient.get.mockResolvedValueOnce(principal);

      const result = await client.callTool({
        name: "whoami",
        arguments: {},
      });
      const parsed = parseToolResult(result);

      expect(mockClient.get).toHaveBeenCalledWith(
        "/api/v1/security/principals/self",
      );
      expect(parsed["identifier"]).toBe("test-admin");
      expect(parsed["roles"]).toEqual(["admin"]);
    });
  });

  describe("decode_x509", () => {
    it("decodes certificate", async () => {
      const decodeResult = {
        subject: { CN: "test.example.com" },
        issuer: { CN: "Test CA" },
        notAfter: "2025-12-31T23:59:59Z",
      };
      mockClient.postMultipart.mockResolvedValueOnce(decodeResult);

      const pem =
        "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";
      const result = await client.callTool({
        name: "decode_x509",
        arguments: { pem },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.postMultipart).toHaveBeenCalledOnce();
      const callArgs = mockClient.postMultipart.mock.calls[0]!;
      expect(callArgs[0]).toBe("/api/v1/rfc5280/x509");
      const subject = parsed["subject"] as Record<string, unknown>;
      expect(subject["CN"]).toBe("test.example.com");
    });
  });

  describe("validate_hcql", () => {
    it("validates valid query", async () => {
      mockClient.post.mockResolvedValueOnce({
        count: 42,
        hasMore: true,
        results: [],
      });

      const query = 'dn matches ".*example.com" and status is valid';
      const result = await client.callTool({
        name: "validate_hcql",
        arguments: { query },
      });
      const parsed = parseToolResult(result);

      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/certificates/search",
        { query, pageSize: 1 },
      );
      expect(parsed["valid"]).toBe(true);
      expect(parsed["query_type"]).toBe("HCQL");
      expect(parsed["count"]).toBe(42);
    });

    it("detects invalid query", async () => {
      mockClient.post.mockRejectedValueOnce(
        new Error("Unexpected token at position 5"),
      );

      const result = await client.callTool({
        name: "validate_hcql",
        arguments: { query: "bad %%% query" },
      });
      const parsed = parseToolResult(result);

      expect(parsed["valid"]).toBe(false);
      expect(parsed["error"]).toBeDefined();
    });
  });

  describe("describe_query_fields", () => {
    it("returns HCQL metadata", async () => {
      const result = await client.callTool({
        name: "describe_query_fields",
        arguments: { query_type: "hcql" },
      });
      const parsed = parseToolResult(result);

      expect(parsed["query_type"]).toBe("hcql");
      expect(parsed["supports_aggregate"]).toBe(true);
      const fields = parsed["fields"] as Array<Record<string, unknown>>;
      const fieldNames = fields.map((f) => f["name"]);
      expect(fieldNames).toContain("dn");
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it("returns error for unknown type", async () => {
      const result = await client.callTool({
        name: "describe_query_fields",
        arguments: { query_type: "sql" },
      });
      const parsed = parseToolResult(result);

      expect(parsed["error"]).toBeDefined();
      expect(parsed["valid_types"]).toBeDefined();
    });
  });
});
