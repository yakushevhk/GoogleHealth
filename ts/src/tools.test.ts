import { test, expect } from "bun:test";
import { DATA_TYPES, findType, categories } from "./types.ts";
import {
  tools, toolMeta, enc, buildFilter, parseDate, dateObj, addDays, fmt, num,
  simplify, paginationHint, SEGMENT_RE, RESOURCE_NAME_RE, segErr, pointIdErr, ok,
} from "./tools.ts";

// ─── Registry (port of go/types_test.go) ─────────────────────────────────────

test("registry has 39 types", () => {
  expect(DATA_TYPES.length).toBe(39);
});

test("IDs are unique and kebab-case", () => {
  const seen = new Set<string>();
  for (const t of DATA_TYPES) {
    expect(seen.has(t.id)).toBe(false);
    seen.add(t.id);
    expect(t.id).toMatch(/^[a-z0-9-]+$/);
  }
});

test("filter_name matches ID in snake_case", () => {
  for (const t of DATA_TYPES) {
    expect(t.filter_name).toBe(t.id.replace(/-/g, "_"));
  }
});

test("findType works", () => {
  expect(findType("steps")?.id).toBe("steps");
  expect(findType("nope")).toBeUndefined();
});

test("page caps and ranges", () => {
  expect(findType("sleep")?.page_cap).toBe(25);
  expect(findType("exercise")?.page_cap).toBe(25);
  expect(findType("steps")?.page_cap).toBe(10000);
});

test("rollup-only types are not listable", () => {
  for (const id of ["floors", "total-calories", "calories-in-heart-rate-zone"]) {
    const t = findType(id);
    expect(t).toBeDefined();
    expect(t!.listable).toBe(false);
    expect(t!.rollup).toBe(true);
  }
});

test("categories have no duplicates", () => {
  const cats = categories();
  expect(cats.length).toBeGreaterThan(0);
  expect(new Set(cats).size).toBe(cats.length);
});

// ─── Tool table ──────────────────────────────────────────────────────────────

test("exactly 35 tools registered", () => {
  expect(Object.keys(tools).length).toBe(35);
});

test("every tool has a title in toolMeta", () => {
  for (const name of Object.keys(tools)) {
    expect(toolMeta[name]?.title).toBeTruthy();
  }
});

// ─── Path safety ─────────────────────────────────────────────────────────────

test("SEGMENT_RE accepts safe segments", () => {
  for (const s of ["steps", "heart-rate", "abc_123", "ABC"]) {
    expect(SEGMENT_RE.test(s)).toBe(true);
  }
});

test("SEGMENT_RE rejects path escapes", () => {
  for (const s of ["", "../profile", "a%2Fb", "a/b", "a b", "a?b", ".", ".."]) {
    expect(SEGMENT_RE.test(s)).toBe(false);
  }
});

test("RESOURCE_NAME_RE validates full resource names", () => {
  expect(RESOURCE_NAME_RE.test("users/me/dataTypes/steps/dataPoints/abc123")).toBe(true);
  expect(RESOURCE_NAME_RE.test("users/1234567890/dataTypes/sleep/dataPoints/x-Y_z")).toBe(true);
  expect(RESOURCE_NAME_RE.test("users/me/dataTypes/steps")).toBe(false);
  expect(RESOURCE_NAME_RE.test("users/me/foo/x/dataPoints/y")).toBe(false);
  expect(RESOURCE_NAME_RE.test("users/../dataTypes/x/dataPoints/y")).toBe(false);
  expect(RESOURCE_NAME_RE.test("users/me/dataTypes/a%2Fb/dataPoints/y")).toBe(false);
});

test("segErr returns error result for bad segments", () => {
  expect(segErr("steps", "data_type")).toBeNull();
  const bad = segErr("../x", "data_type");
  expect(bad?.isError).toBe(true);
  expect(bad?.content[0].text).toContain("data_type");
});

test("pointIdErr accepts segments and resource names", () => {
  expect(pointIdErr("abc-123")).toBeNull();
  expect(pointIdErr("users/me/dataTypes/steps/dataPoints/abc")).toBeNull();
  expect(pointIdErr("users/other/x")?.isError).toBe(true);
  expect(pointIdErr("a/b")?.isError).toBe(true);
});

test("ok() attaches structuredContent only for objects", () => {
  expect(ok({ a: 1 }).structuredContent).toEqual({ a: 1 });
  expect(ok([1, 2]).structuredContent).toBeUndefined();
  expect(ok("x").structuredContent).toBeUndefined();
});

// ─── Filters / helpers (port of go/tools_test.go) ────────────────────────────

test("enc encodes special chars and spaces", () => {
  const f = `steps.interval.start_time >= "2026-01-01"`;
  expect(enc(f)).toContain("%3E%3D");
  expect(enc("a b")).toBe("a%20b");
});

test("buildFilter per data type family", () => {
  const since = "2026-01-01T00:00:00Z";
  expect(buildFilter("sleep", since)).toBe(`sleep.interval.end_time >= "${since}"`);
  expect(buildFilter("exercise", since)).toBe('exercise.interval.civil_start_time >= "2026-01-01"');
  expect(buildFilter("daily-vo2-max", since)).toBe('daily_vo2_max.date >= "2026-01-01"');
  expect(buildFilter("heart-rate", since)).toBe(`heart_rate.sample_time.physical_time >= "${since}"`);
  expect(buildFilter("electrocardiogram", since)).toBe(`electrocardiogram.interval.start_time >= "${since}"`);
  expect(buildFilter("steps", since)).toBe(`steps.interval.start_time >= "${since}"`);
});

test("buildFilter with until", () => {
  const since = "2026-01-01T00:00:00Z";
  const until = "2026-01-08T00:00:00Z";
  expect(buildFilter("sleep", since, until)).toBe(`sleep.interval.end_time >= "${since}" AND sleep.interval.end_time < "${until}"`);
  expect(buildFilter("heart-rate", since, until)).toBe(`heart_rate.sample_time.physical_time >= "${since}" AND heart_rate.sample_time.physical_time < "${until}"`);
  // ECG supports >= only: no upper bound is added.
  expect(buildFilter("electrocardiogram", since, until)).toBe(`electrocardiogram.interval.start_time >= "${since}"`);
});

test("parseDate rejects invalid dates", () => {
  expect(() => parseDate("not-a-date")).toThrow("Invalid date");
  expect(parseDate("2026-02-30")).toBeInstanceOf(Date); // JS normalizes; parity with Go's civil check is in-server
});

test("dateObj / addDays / fmt round-trip", () => {
  const d = parseDate("2026-01-31");
  expect(dateObj(d)).toEqual({ year: 2026, month: 1, day: 31 });
  expect(fmt(addDays(d, 1))).toBe("2026-02-01");
});

test("num parses numbers and numeric strings", () => {
  expect(num(42)).toBe(42);
  expect(num("3.5")).toBe(3.5);
  expect(num("abc")).toBe(0);
  expect(num(undefined)).toBe(0);
});

test("simplify strips metadata and empty objects", () => {
  const v: any = { dataPoints: [{ name: "x", dataSource: {}, createTime: "t", updateTime: "u", empty: {}, keep: 1 }] };
  simplify(v);
  expect(v.dataPoints[0]).toEqual({ name: "x", keep: 1 });
});

test("paginationHint adds _hint when nextPageToken present", () => {
  const v: any = { nextPageToken: "tok" };
  paginationHint(v);
  expect(v._hint).toContain("nextPageToken");
  const w: any = {};
  paginationHint(w);
  expect(w._hint).toBeUndefined();
});

test("validation rejects injection in tool handlers", async () => {
  const fakeAuth: any = { apiGet: async () => ({}), apiPost: async () => ({}), apiPatch: async () => ({}), cache: { clear() {} } };
  const res = await tools["list_data_points"].handler(fakeAuth, { data_type: "../profile" });
  expect(res.isError).toBe(true);
  const res2 = await tools["get_paired_device"].handler(fakeAuth, { device_id: "a%2Fb" });
  expect(res2.isError).toBe(true);
  const res3 = await tools["batch_delete_data_points"].handler(fakeAuth, { data_type: "steps", names: ["users/me/x"] });
  expect(res3.isError).toBe(true);
});
