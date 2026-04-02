import { describe, it, expect } from "vitest";
import {
  deleteGuard,
  applyNameFilter,
  buildListResponse,
  buildSortedBy,
  buildSearchPayload,
  truncateRecord,
  csvTruncationMetadata,
} from "../../src/tools/helpers.js";
import { HorizonError } from "../../src/client/errors.js";

describe("deleteGuard", () => {
  it("passes silently when names match exactly", () => {
    expect(() => deleteGuard("my-profile", "my-profile")).not.toThrow();
  });

  it("throws HorizonError with SAFETY-ECHO when names differ", () => {
    expect(() => deleteGuard("wrong-name", "actual-name")).toThrow(
      HorizonError,
    );
  });

  it("includes expected and actual names in the error message", () => {
    try {
      deleteGuard("wrong", "correct");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HorizonError);
      const horizonErr = err as HorizonError;
      expect(horizonErr.errorCode).toBe("SAFETY-ECHO");
      expect(horizonErr.message).toContain("expected_name='correct'");
      expect(horizonErr.message).toContain("name='wrong'");
    }
  });

  it("uses custom label in error message", () => {
    try {
      deleteGuard("wrong", "correct", "identifier");
      expect.fail("should have thrown");
    } catch (err) {
      const horizonErr = err as HorizonError;
      expect(horizonErr.message).toContain("expected_identifier='correct'");
      expect(horizonErr.message).toContain("identifier='wrong'");
    }
  });

  it("is case-sensitive", () => {
    expect(() => deleteGuard("MyProfile", "myprofile")).toThrow(HorizonError);
  });
});

describe("applyNameFilter", () => {
  const items = [
    { name: "Production CA" },
    { name: "Staging CA" },
    { name: "dev-internal" },
    { name: "PRODUCTION-BACKUP" },
  ];

  it("returns all items when nameContains is undefined", () => {
    const result = applyNameFilter(items);
    expect(result).toEqual(items);
  });

  it("filters by case-insensitive substring match", () => {
    const result = applyNameFilter(items, "production");
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("Production CA");
    expect(result[1]!.name).toBe("PRODUCTION-BACKUP");
  });

  it("handles partial matches", () => {
    const result = applyNameFilter(items, "CA");
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("Production CA");
    expect(result[1]!.name).toBe("Staging CA");
  });

  it("returns empty array when nothing matches", () => {
    const result = applyNameFilter(items, "nonexistent");
    expect(result).toHaveLength(0);
  });

  it("skips items where name is not a string", () => {
    const mixed = [
      { name: "valid" },
      { name: 123 },
      { id: "no-name" },
    ] as Record<string, unknown>[];
    const result = applyNameFilter(mixed, "valid");
    expect(result).toHaveLength(1);
  });

  it("is a no-op when nameContains is empty string", () => {
    // empty string is falsy, so should return all
    const result = applyNameFilter(items, "");
    expect(result).toEqual(items);
  });
});

describe("buildListResponse", () => {
  it("returns all items when under maxItems limit", () => {
    const items = [{ name: "a" }, { name: "b" }];
    const result = JSON.parse(buildListResponse(items, 10, "profile"));

    expect(result.items).toHaveLength(2);
    expect(result.count).toBe(2);
    expect(result.total_available).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.kind).toBe("profile");
  });

  it("truncates when items exceed maxItems", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ name: `item-${i}` }));
    const result = JSON.parse(buildListResponse(items, 3, "certificate"));

    expect(result.items).toHaveLength(3);
    expect(result.count).toBe(3);
    expect(result.total_available).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("handles empty items array", () => {
    const result = JSON.parse(buildListResponse([], 10, "trigger"));

    expect(result.items).toHaveLength(0);
    expect(result.count).toBe(0);
    expect(result.total_available).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("sets truncated to false when items equal maxItems", () => {
    const items = [{ name: "a" }, { name: "b" }, { name: "c" }];
    const result = JSON.parse(buildListResponse(items, 3, "role"));

    expect(result.truncated).toBe(false);
    expect(result.count).toBe(3);
  });
});

describe("buildSortedBy", () => {
  it("returns undefined when sortedBy is undefined", () => {
    expect(buildSortedBy(undefined)).toBeUndefined();
  });

  it("returns undefined when sortedBy is empty string", () => {
    expect(buildSortedBy("")).toBeUndefined();
  });

  it("parses bare field name with default Asc order", () => {
    const result = buildSortedBy("notAfter");
    expect(result).toEqual([{ element: "notAfter", order: "Asc" }]);
  });

  it("parses field:Asc explicitly", () => {
    const result = buildSortedBy("dn:Asc");
    expect(result).toEqual([{ element: "dn", order: "Asc" }]);
  });

  it("parses field:Desc", () => {
    const result = buildSortedBy("notAfter:Desc");
    expect(result).toEqual([{ element: "notAfter", order: "Desc" }]);
  });

  it("capitalizes lowercase order", () => {
    const result = buildSortedBy("serial:desc");
    expect(result).toEqual([{ element: "serial", order: "Desc" }]);
  });

  it("falls back to Asc for invalid order values", () => {
    const result = buildSortedBy("field:InvalidOrder");
    expect(result).toEqual([{ element: "field", order: "Asc" }]);
  });

  it("trims whitespace from element and order", () => {
    const result = buildSortedBy(" dn : Desc ");
    expect(result).toEqual([{ element: "dn", order: "Desc" }]);
  });
});

describe("buildSearchPayload", () => {
  it("builds basic payload with query and pagination", () => {
    const payload = buildSearchPayload("*", undefined, 0, 50);

    expect(payload.query).toBe("*");
    expect(payload.pageIndex).toBe(0);
    expect(payload.pageSize).toBe(50);
    expect(payload).not.toHaveProperty("fields");
    expect(payload).not.toHaveProperty("sortedBy");
    expect(payload).not.toHaveProperty("withCount");
  });

  it("caps pageSize at 100", () => {
    const payload = buildSearchPayload("*", undefined, 0, 200);
    expect(payload.pageSize).toBe(100);
  });

  it("leaves pageSize unchanged when under 100", () => {
    const payload = buildSearchPayload("*", undefined, 0, 50);
    expect(payload.pageSize).toBe(50);
  });

  it("allows pageSize of exactly 100", () => {
    const payload = buildSearchPayload("*", undefined, 0, 100);
    expect(payload.pageSize).toBe(100);
  });

  it("includes fields when provided", () => {
    const fields = ["dn", "serial", "profile"];
    const payload = buildSearchPayload("*", fields, 0, 50);
    expect(payload.fields).toEqual(fields);
  });

  it("omits fields when array is empty", () => {
    const payload = buildSearchPayload("*", [], 0, 50);
    expect(payload).not.toHaveProperty("fields");
  });

  it("includes sortedBy when provided", () => {
    const payload = buildSearchPayload("*", undefined, 0, 50, "notAfter:Desc");
    expect(payload.sortedBy).toEqual([
      { element: "notAfter", order: "Desc" },
    ]);
  });

  it("includes withCount when true", () => {
    const payload = buildSearchPayload("*", undefined, 0, 50, undefined, true);
    expect(payload.withCount).toBe(true);
  });

  it("omits withCount when false (default)", () => {
    const payload = buildSearchPayload("*", undefined, 0, 50);
    expect(payload).not.toHaveProperty("withCount");
  });
});

describe("truncateRecord", () => {
  it("passes through short strings unchanged", () => {
    const record = { name: "short value", serial: "ABC123" };
    const result = truncateRecord(record);
    expect(result).toEqual(record);
  });

  it("truncates strings exceeding 500 characters", () => {
    const longString = "a".repeat(600);
    const result = truncateRecord({ field: longString });
    const truncated = result.field as string;

    expect(truncated).toContain("a".repeat(500));
    expect(truncated).toContain("<truncated");
    expect(truncated.length).toBeLessThan(600);
  });

  it("preserves strings at exactly 500 characters", () => {
    const exact = "b".repeat(500);
    const result = truncateRecord({ field: exact });
    expect(result.field).toBe(exact);
  });

  it("truncates arrays exceeding 20 elements", () => {
    const bigArray = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const result = truncateRecord({ list: bigArray });
    const truncated = result.list as string[];

    // 20 items + 1 truncation message
    expect(truncated).toHaveLength(21);
    expect(truncated[20]).toContain("<truncated: 30 total");
  });

  it("preserves arrays at exactly 20 elements", () => {
    const exactArray = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const result = truncateRecord({ list: exactArray });
    expect(result.list).toEqual(exactArray);
  });

  it("replaces oversized nested objects with placeholder", () => {
    // Create an object that serializes to more than 2048 bytes
    const nested: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      nested[`key${i}`] = "x".repeat(30);
    }
    const result = truncateRecord({ data: nested });
    expect(result.data).toBe("<oversized: use get_certificate>");
  });

  it("passes through small nested objects with recursive truncation", () => {
    const nested = { inner: "short", count: 42 };
    const result = truncateRecord({ data: nested });
    expect(result.data).toEqual({ inner: "short", count: 42 });
  });

  it("passes through numbers and booleans unchanged", () => {
    const result = truncateRecord({ count: 42, active: true });
    expect(result).toEqual({ count: 42, active: true });
  });

  it("passes through null values unchanged", () => {
    const result = truncateRecord({ field: null });
    expect(result).toEqual({ field: null });
  });

  it("recursively truncates strings inside arrays", () => {
    const longString = "z".repeat(600);
    const result = truncateRecord({ list: [longString] });
    const arr = result.list as string[];
    expect(arr[0]).toContain("<truncated");
  });
});

describe("csvTruncationMetadata", () => {
  it("counts data rows excluding header", () => {
    const csv = "col1,col2\nval1,val2\nval3,val4\n";
    const meta = csvTruncationMetadata(csv);

    expect(meta.returned_rows).toBe(2);
    expect(meta.truncated).toBe(false);
    expect(meta.max_rows).toBe(1000);
  });

  it("marks truncated as true when row count reaches 1000", () => {
    const header = "col1,col2";
    const rows = Array.from({ length: 1000 }, (_, i) => `val${i},data${i}`);
    const csv = [header, ...rows].join("\n");
    const meta = csvTruncationMetadata(csv);

    expect(meta.returned_rows).toBe(1000);
    expect(meta.truncated).toBe(true);
  });

  it("marks truncated as false when rows are below 1000", () => {
    const header = "col1,col2";
    const rows = Array.from({ length: 999 }, (_, i) => `val${i},data${i}`);
    const csv = [header, ...rows].join("\n");
    const meta = csvTruncationMetadata(csv);

    expect(meta.returned_rows).toBe(999);
    expect(meta.truncated).toBe(false);
  });

  it("returns 0 rows for header-only CSV", () => {
    const csv = "col1,col2\n";
    const meta = csvTruncationMetadata(csv);

    expect(meta.returned_rows).toBe(0);
  });

  it("returns 0 rows for empty string", () => {
    const meta = csvTruncationMetadata("");

    expect(meta.returned_rows).toBe(0);
    expect(meta.truncated).toBe(false);
  });
});
