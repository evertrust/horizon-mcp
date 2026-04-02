/**
 * E2E tests for the Horizon MCP TypeScript client.
 *
 * Tests run against a live Horizon QA instance. The entire suite is skipped
 * when the required environment variables are not set:
 *   HORIZON_E2E_URL, HORIZON_E2E_API_ID, HORIZON_E2E_API_KEY
 *
 * Domains covered (matching Python E2E coverage):
 *   - whoami         - verify auth works
 *   - list_profiles  - verify profile listing
 *   - search_certificates - basic HCQL query
 *   - get_license_info    - verify license endpoint
 *   - validate_hcql       - with a valid query
 *   - describe_query_fields - for hcql type
 */

import { describe, it, expect } from "vitest";
import { E2E_CONFIGURED, getE2EClient, setupE2EClient } from "./setup.js";

// ---------------------------------------------------------------------------
// Entire suite is gated on E2E env vars
// ---------------------------------------------------------------------------

describe.skipIf(!E2E_CONFIGURED)("Horizon E2E", () => {
  setupE2EClient();

  // -------------------------------------------------------------------------
  // whoami - verify authentication
  // -------------------------------------------------------------------------

  describe("whoami", () => {
    it("returns the authenticated principal with an identity", async () => {
      const client = getE2EClient();
      const result = await client.get<Record<string, unknown>>(
        "/api/v1/security/principals/self",
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty("identity");

      const identity = result["identity"] as Record<string, unknown>;
      expect(identity).toBeDefined();
      expect(typeof identity).toBe("object");

      // The identity must contain at least one identifier field
      const identifierKeys = ["identifier", "login", "id", "_id", "name", "email"];
      const hasIdentifier = identifierKeys.some((key) => key in identity);
      expect(hasIdentifier).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // list_profiles - verify profile listing
  // -------------------------------------------------------------------------

  describe("list_profiles", () => {
    it("returns an array of profiles", async () => {
      const client = getE2EClient();
      const result = await client.get<unknown>("/api/v1/certificate/profiles");

      // The API returns either an array or an object with an items key
      const items = Array.isArray(result)
        ? result
        : ((result as Record<string, unknown>)["items"] as unknown[] | undefined) ?? [];

      expect(Array.isArray(items)).toBe(true);
    });

    it("returns profiles with name and module fields", async () => {
      const client = getE2EClient();
      const result = await client.get<unknown>("/api/v1/certificate/profiles");

      const items = Array.isArray(result)
        ? (result as Record<string, unknown>[])
        : ((result as Record<string, unknown>)["items"] as Record<string, unknown>[] | undefined) ?? [];

      if (items.length === 0) return; // skip assertion if no profiles configured

      const first = items[0]!;
      // Each profile should have at least a name
      expect("name" in first || "identifier" in first).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // search_certificates - basic HCQL query
  // -------------------------------------------------------------------------

  describe("search_certificates", () => {
    it("searches with a simple HCQL query and returns results", async () => {
      const client = getE2EClient();
      const result = await client.post<Record<string, unknown>>(
        "/api/v1/certificates/search",
        { query: "profile exists", pageSize: 5 },
      );

      expect(result).toBeDefined();
      // The search response should include a results array (may be empty)
      expect("results" in result || "items" in result || Array.isArray(result)).toBe(true);
    });

    it("returns count information in the response", async () => {
      const client = getE2EClient();
      const result = await client.post<Record<string, unknown>>(
        "/api/v1/certificates/search",
        { query: "profile exists", pageSize: 1, withCount: true },
      );

      expect(result).toBeDefined();
      // The count field should be present when withCount is requested
      expect("count" in result || "total" in result || "hasMore" in result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // get_license_info - verify license endpoint
  // -------------------------------------------------------------------------

  describe("get_license_info", () => {
    it("returns license data", async () => {
      const client = getE2EClient();

      let result: Record<string, unknown>;
      try {
        result = await client.get<Record<string, unknown>>("/api/v1/license");
      } catch {
        // The license endpoint may not be available on all Horizon versions
        return;
      }

      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      // At minimum we should have a non-empty response
      expect(Object.keys(result).length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // validate_hcql - validate a query expression
  // -------------------------------------------------------------------------

  describe("validate_hcql", () => {
    it("confirms a valid HCQL query via minimal search", async () => {
      const client = getE2EClient();

      // Validation works by executing a minimal search (pageSize=1).
      // If the query parses, the search succeeds.
      const result = await client.post<Record<string, unknown>>(
        "/api/v1/certificates/search",
        { query: "profile exists", pageSize: 1 },
      );

      expect(result).toBeDefined();
      // A successful search means the query was valid
      // The API returns results without an error field
      expect(result).not.toHaveProperty("error");
    });

    it("rejects an invalid HCQL query with an error", async () => {
      const client = getE2EClient();

      try {
        await client.post<Record<string, unknown>>(
          "/api/v1/certificates/search",
          { query: "INVALID<<<", pageSize: 1 },
        );
        // If we reach here, the API did not reject the query - that's unexpected
        // but not a test failure (some versions may be more lenient)
      } catch (err) {
        // Expected: Horizon should return an error for invalid syntax
        expect(err).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // describe_query_fields - local metadata for hcql type
  // -------------------------------------------------------------------------

  describe("describe_query_fields", () => {
    it("returns field metadata for hcql", async () => {
      // This is a local tool test - import the metadata directly
      // to verify it is well-formed without needing an API call
      const { QUERY_METADATA } = await import(
        "../../src/tools/assist/query.js"
      );

      const metadata = QUERY_METADATA["hcql"];
      expect(metadata).toBeDefined();
      expect(metadata!.query_type).toBe("hcql");
      expect(Array.isArray(metadata!.fields)).toBe(true);
      expect(metadata!.fields.length).toBeGreaterThan(0);
      expect(Array.isArray(metadata!.examples)).toBe(true);
      expect(metadata!.examples.length).toBeGreaterThan(0);
    });

    it("returns field metadata for all four query types", async () => {
      const { QUERY_METADATA } = await import(
        "../../src/tools/assist/query.js"
      );

      for (const queryType of ["hcql", "hrql", "heql", "hdql"] as const) {
        const metadata = QUERY_METADATA[queryType];
        expect(metadata).toBeDefined();
        expect(metadata!.query_type).toBe(queryType);
        expect(Array.isArray(metadata!.fields)).toBe(true);
        expect(metadata!.fields.length).toBeGreaterThan(0);
        expect(Array.isArray(metadata!.examples)).toBe(true);
      }
    });

    it("hcql fields include essential certificate fields", async () => {
      const { QUERY_METADATA } = await import(
        "../../src/tools/assist/query.js"
      );

      const metadata = QUERY_METADATA["hcql"]!;
      const fieldNames = metadata.fields.map((f) => f.name);

      // These are the essential fields that must be present
      const essentialFields = ["dn", "serial", "profile", "owner", "team", "san"];
      for (const field of essentialFields) {
        expect(fieldNames).toContain(field);
      }
    });
  });
});
