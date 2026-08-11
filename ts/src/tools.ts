import { AuthState, BASE } from "./auth.ts";
import { DATA_TYPES, findType, categories, type DataTypeInfo } from "./types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const enc = (s: string) => encodeURIComponent(s);

function simplifyPoint(obj: any) {
  delete obj.dataSource; delete obj.createTime; delete obj.updateTime;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) delete obj[k];
  }
}

function simplify(v: any) {
  for (const key of ["dataPoints", "rollupDataPoints"]) {
    if (Array.isArray(v[key])) { v[key].forEach((p: any) => simplifyPoint(p)); return; }
  }
  simplifyPoint(v);
}

function paginationHint(v: any) {
  if (v.nextPageToken) v._hint = "More data available. Pass nextPageToken to fetch the next page.";
}

function buildFilter(dataType: string, since: string, until?: string): string {
  const snake = dataType.replace(/-/g, "_");
  const civil = (s: string) => s.slice(0, 10);
  let f: string;
  if (dataType === "sleep") f = `sleep.interval.end_time >= "${since}"`;
  else if (["exercise","hydration-log","nutrition-log","irregular-rhythm-notification"].includes(dataType))
    f = `${snake}.interval.civil_start_time >= "${civil(since)}"`;
  else if (dataType.startsWith("daily-"))
    f = `${snake}.date >= "${civil(since)}"`;
  else if (["heart-rate","weight","height","body-fat","blood-glucose","core-body-temperature","heart-rate-variability","oxygen-saturation","respiratory-rate-sleep-summary","vo2-max","run-vo2-max"].includes(dataType))
    f = `${snake}.sample_time.physical_time >= "${since}"`;
  else if (dataType === "electrocardiogram")
    f = `electrocardiogram.interval.start_time >= "${since}"`;
  else f = `${snake}.interval.start_time >= "${since}"`;

  if (until) {
    if (dataType === "sleep") f += ` AND sleep.interval.end_time < "${until}"`;
    else if (["exercise","hydration-log","nutrition-log","irregular-rhythm-notification"].includes(dataType))
      f += ` AND ${snake}.interval.civil_start_time < "${civil(until)}"`;
    else if (dataType.startsWith("daily-")) f += ` AND ${snake}.date < "${civil(until)}"`;
    else if (["heart-rate","weight","height","body-fat","blood-glucose","core-body-temperature","heart-rate-variability","oxygen-saturation","respiratory-rate-sleep-summary","vo2-max","run-vo2-max"].includes(dataType))
      f += ` AND ${snake}.sample_time.physical_time < "${until}"`;
    else if (dataType !== "electrocardiogram") f += ` AND ${snake}.interval.start_time < "${until}"`;
  }
  return f;
}

function dateObj(d: Date) { return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }; }
function parseDate(s: string): Date {
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) throw new Error(`Invalid date '${s}': expected YYYY-MM-DD`);
  return d;
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmt(d: Date) { return d.toISOString().slice(0, 10); }
function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
const num = (v: any): number => typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || 0 : 0;

// ─── Tool result type ────────────────────────────────────────────────────────

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (v: any): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }] });
const err = (msg: string): ToolResult => ({ content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true });

function apiErr(e: string): ToolResult {
  const lower = e.toLowerCase();
  const steps = (msg: string, s: string[]) => ({ content: [{ type: "text" as const, text: JSON.stringify({ error: msg, next_steps: s }, null, 2) }], isError: true });
  if (e.includes("HTTP 403") || lower.includes("forbidden") || lower.includes("permission")) return steps(e, ["Check OAuth scopes include the required permission", "Run oauth_health.py to re-authorize"]);
  if (lower.includes("filter")) return steps(e, ["Call describe_data_type for the correct filter syntax", "Use start_time/end_time params instead of manual filter"]);
  if (e.includes("HTTP 404") || lower.includes("not found")) return steps(e, ["Call list_data_types to see all 39 supported types", "Check the type ID is kebab-case (e.g. heart-rate, not heartRate)"]);
  if (e.includes("HTTP 400")) return steps(e, ["Check the request body format", "Call describe_data_type for field names"]);
  return err(e);
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

type Handler = (auth: AuthState, args: any) => Promise<ToolResult>;

export const tools: Record<string, { description: string; inputSchema: any; handler: Handler }> = {};

function reg(name: string, description: string, inputSchema: any, handler: Handler) {
  tools[name] = { description, inputSchema, handler };
}

// ─── Tool metadata (title + annotations) ────────────────────────────────────

export const toolMeta: Record<string, { title: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }> = {
  list_data_types: { title: "List Data Types", annotations: { readOnlyHint: true } },
  describe_data_type: { title: "Describe Data Type", annotations: { readOnlyHint: true } },
  list_data_points: { title: "List Data Points", annotations: { readOnlyHint: true } },
  get_data_point: { title: "Get Data Point", annotations: { readOnlyHint: true } },
  reconcile_data_points: { title: "Reconcile Data Points", annotations: { readOnlyHint: true } },
  sync_data_points: { title: "Sync Data Points (Incremental Sync)", annotations: { readOnlyHint: true } },
  rollup_data_points: { title: "RollUp Data Points", annotations: { readOnlyHint: true } },
  daily_rollup_data_points: { title: "Daily RollUp Data Points", annotations: { readOnlyHint: true } },
  create_data_point: { title: "Create Data Point", annotations: { readOnlyHint: false, destructiveHint: false } },
  add_weight_sample: { title: "Add Weight Sample", annotations: { readOnlyHint: false } },
  add_hydration_log: { title: "Add Hydration Log", annotations: { readOnlyHint: false } },
  add_sleep_session: { title: "Add Sleep Session", annotations: { readOnlyHint: false } },
  add_exercise_session: { title: "Add Exercise Session", annotations: { readOnlyHint: false } },
  add_nutrition_log: { title: "Add Nutrition Log", annotations: { readOnlyHint: false } },
  compare_health_periods: { title: "Compare Health Periods", annotations: { readOnlyHint: true } },
  get_hrv_recovery_trend: { title: "Get HRV & Recovery Trend", annotations: { readOnlyHint: true } },
  get_temperature_summary: { title: "Get Temperature Summary", annotations: { readOnlyHint: true } },
  patch_data_point: { title: "Patch Data Point", annotations: { readOnlyHint: false, destructiveHint: false } },
  delete_data_point: { title: "Delete Data Point", annotations: { readOnlyHint: false, destructiveHint: true } },
  batch_delete_data_points: { title: "Batch Delete Data Points", annotations: { readOnlyHint: false, destructiveHint: true } },
  export_exercise_tcx: { title: "Export Exercise TCX", annotations: { readOnlyHint: true } },
  get_profile: { title: "Get Profile", annotations: { readOnlyHint: true } },
  update_profile: { title: "Update Profile", annotations: { readOnlyHint: false } },
  get_settings: { title: "Get Settings", annotations: { readOnlyHint: true } },
  update_settings: { title: "Update Settings", annotations: { readOnlyHint: false } },
  get_identity: { title: "Get Identity", annotations: { readOnlyHint: true } },
  get_irn_profile: { title: "Get IRN Profile", annotations: { readOnlyHint: true } },
  list_paired_devices: { title: "List Paired Devices", annotations: { readOnlyHint: true } },
  get_paired_device: { title: "Get Paired Device", annotations: { readOnlyHint: true } },
  clear_cache: { title: "Clear Response Cache", annotations: { readOnlyHint: false } },
  summary: { title: "Daily Summary", annotations: { readOnlyHint: true } },
  today: { title: "Today Summary", annotations: { readOnlyHint: true } },
  yesterday: { title: "Yesterday Summary", annotations: { readOnlyHint: true } },
  get_trends: { title: "Get Health Trends", annotations: { readOnlyHint: true } },
  delete_by_filter: { title: "Delete Data Points by Filter", annotations: { readOnlyHint: false, destructiveHint: true } },
};

// Discovery
reg("list_data_types", "List all 39 supported Google Health API v4 data types with their categories, supported operations, and key fields. Use this to discover what data is available before calling other tools.", {
  type: "object", properties: { category: { type: "string", description: "Optional category filter" } },
}, async (_auth, { category }) => {
  const cat = (category || "").toLowerCase().trim();
  const matches = DATA_TYPES.filter((t) => !cat || t.category === cat);
  if (cat && matches.length === 0) return err(`Unknown category '${cat}'. Valid: ${categories().join(", ")}`);
  return ok({ count: matches.length, total: DATA_TYPES.length, categories: categories(), data_types: matches });
});

reg("describe_data_type", "Get detailed information about a specific data type: supported operations, filter syntax, page limits, rollup range, key response fields, and gotchas.", {
  type: "object", properties: { data_type: { type: "string" } }, required: ["data_type"],
}, async (_auth, { data_type }) => {
  const info = findType(data_type?.trim());
  if (!info) return err(`Unknown data type '${data_type}'. Use list_data_types to see all 39 valid kebab-case IDs.`);
  const labels: Record<string, string> = {
    interval_start: "interval.start_time (RFC3339)", interval_civil_start: "interval.civil_start_time (date)",
    interval_end: "interval.end_time / civil_end_time", sample_physical: "sample_time.physical_time (RFC3339)",
    sample_civil: "sample_time.civil_time (date)", daily: "date (YYYY-MM-DD)", none: "none (no time filter)",
  };
  const suffixes: Record<string, string> = {
    interval_start: "interval.start_time", interval_civil_start: "interval.civil_start_time",
    interval_end: "interval.end_time", sample_physical: "sample_time.physical_time",
    sample_civil: "sample_time.civil_time", daily: "date",
  };
  const suffix = suffixes[info.time_field];
  const filterField = suffix ? `${info.filter_name}.${suffix}` : null;
  const sample = (info.time_field === "daily" || info.time_field === "interval_civil_start") ? "2026-07-01" : "2026-07-01T00:00:00Z";
  return ok({ ...info, time_field_label: labels[info.time_field] || info.time_field, filter_field: filterField, filter_example: filterField ? `${filterField} >= "${sample}"` : null });
});

// Data
reg("list_data_points", "List data points for any Google Health data type. Filter syntax depends on record type: Interval types use '{type}.interval.start_time >= \"RFC3339\" AND {type}.interval.start_time < \"RFC3339\"'; Sample types use '{type}.sample_time.physical_time >= \"RFC3339\"'; Daily types use '{type}.date >= \"YYYY-MM-DD\"'; Sleep uses 'sleep.interval.end_time'; Exercise/hydration-log/nutrition-log/irregular-rhythm-notification use '{type}.interval.civil_start_time >= \"YYYY-MM-DD\"'; ECG uses 'electrocardiogram.interval.start_time >= \"RFC3339\"' (only >=). In filters use snake_case (heart_rate), in data_type use kebab-case (heart-rate). Types without list support: floors, calories-in-heart-rate-zone, total-calories (use rollup instead). food and food-measurement-unit do not support filters. TIP: Use list_data_types to discover available types. Use dailyRollUp for steps/distance/floors totals (list returns intervals without values).", {
  type: "object", properties: {
    data_type: { type: "string" }, filter: { type: "string" }, start_time: { type: "string" },
    end_time: { type: "string" }, page_size: { type: "number" }, page_token: { type: "string" }, raw: { type: "boolean" },
  }, required: ["data_type"],
}, async (auth, a) => {
  let url = `${BASE}/dataTypes/${a.data_type}/dataPoints`;
  const params: string[] = [];
  const f = a.filter || (a.start_time ? buildFilter(a.data_type, a.start_time, a.end_time) : "");
  if (f) params.push(`filter=${enc(f)}`);
  if (a.page_size) params.push(`pageSize=${a.page_size}`);
  if (a.page_token) params.push(`pageToken=${enc(a.page_token)}`);
  if (params.length) url += "?" + params.join("&");
  try {
    const v = await auth.apiGet(url);
    paginationHint(v); if (!a.raw) simplify(v);
    return ok(v);
  } catch (e: any) { return apiErr(e.message); }
});

reg("get_data_point", "Get a single data point by its ID.", {
  type: "object", properties: { data_type: { type: "string" }, data_point_id: { type: "string" }, raw: { type: "boolean" } },
  required: ["data_type", "data_point_id"],
}, async (auth, a) => {
  const url = a.data_point_id.startsWith("users/")
    ? `https://health.googleapis.com/v4/${a.data_point_id}`
    : `${BASE}/dataTypes/${a.data_type}/dataPoints/${a.data_point_id}`;
  try { const v = await auth.apiGet(url); if (!a.raw) simplify(v); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("reconcile_data_points", "Reconcile (deduplicate/merge) data points for a data type. Same filter syntax as list. Supports dataSourceFamily filter. This is a read-only operation (GET request).", {
  type: "object", properties: { data_type: { type: "string" }, filter: { type: "string" }, page_size: { type: "number" }, page_token: { type: "string" }, data_source_family: { type: "string" }, raw: { type: "boolean" } },
  required: ["data_type"],
}, async (auth, a) => {
  let url = `${BASE}/dataTypes/${a.data_type}/dataPoints:reconcile`;
  const params: string[] = [];
  if (a.filter) params.push(`filter=${enc(a.filter)}`);
  if (a.page_size) params.push(`pageSize=${a.page_size}`);
  if (a.page_token) params.push(`pageToken=${enc(a.page_token)}`);
  if (a.data_source_family) params.push(`dataSourceFamily=${enc(a.data_source_family)}`);
  if (params.length) url += "?" + params.join("&");
  try { const v = await auth.apiGet(url); paginationHint(v); if (!a.raw) simplify(v); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("sync_data_points", "Perform incremental synchronization (Delta Sync) for a data type using the reconcile endpoint. Automatically builds time filter for data created or updated after `since_time`. This is a read-only operation.", {
  type: "object", properties: { data_type: { type: "string" }, since_time: { type: "string" }, until_time: { type: "string" }, page_size: { type: "number" }, page_token: { type: "string" }, data_source_family: { type: "string" }, raw: { type: "boolean" } },
  required: ["data_type", "since_time"],
}, async (auth, a) => {
  const f = buildFilter(a.data_type, a.since_time, a.until_time);
  let url = `${BASE}/dataTypes/${a.data_type}/dataPoints:reconcile?filter=${enc(f)}`;
  if (a.page_size) url += `&pageSize=${a.page_size}`;
  if (a.page_token) url += `&pageToken=${enc(a.page_token)}`;
  if (a.data_source_family) url += `&dataSourceFamily=${enc(a.data_source_family)}`;
  try { const v = await auth.apiGet(url); paginationHint(v); if (!a.raw) simplify(v); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("rollup_data_points", "Aggregate data points into time buckets. Body: range (Interval with startTime/endTime RFC3339), windowSize (duration e.g. '3600s', '86400s'). Max range: 14 days for heart-rate/active-minutes/total-calories/calories-in-heart-rate-zone, 90 days for others. Response field: rollupDataPoints. Note: heart-rate, active-minutes, total-calories, calories-in-heart-rate-zone have a 14-day range limit.", {
  type: "object", properties: { data_type: { type: "string" }, start_time: { type: "string" }, end_time: { type: "string" }, window_size: { type: "string" }, page_size: { type: "number" }, page_token: { type: "string" }, data_source_family: { type: "string" }, raw: { type: "boolean" } },
  required: ["data_type", "start_time", "end_time", "window_size"],
}, async (auth, a) => {
  const body: any = { range: { startTime: a.start_time, endTime: a.end_time }, windowSize: a.window_size };
  if (a.page_size) body.pageSize = a.page_size;
  if (a.page_token) body.pageToken = a.page_token;
  if (a.data_source_family) body.dataSourceFamily = a.data_source_family;
  try { const v = await auth.apiPost(`${BASE}/dataTypes/${a.data_type}/dataPoints:rollUp`, body); paginationHint(v); if (!a.raw) simplify(v); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("daily_rollup_data_points", "Aggregate data points into daily buckets using civil (local) time. Range uses date objects: start/end with year/month/day. Response field: rollupDataPoints with civilStartTime/civilEndTime. Note: heart-rate, active-minutes, total-calories, calories-in-heart-rate-zone have a 14-day range limit.", {
  type: "object", properties: { data_type: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" }, window_size_days: { type: "number" }, page_size: { type: "number" }, page_token: { type: "string" }, data_source_family: { type: "string" }, raw: { type: "boolean" } },
  required: ["data_type", "start_date", "end_date"],
}, async (auth, a) => {
  try {
    const start = parseDate(a.start_date), end = parseDate(a.end_date);
    const body: any = { range: { start: { date: dateObj(start) }, end: { date: dateObj(end) } } };
    if (a.window_size_days) body.windowSizeDays = a.window_size_days;
    if (a.page_size) body.pageSize = a.page_size;
    if (a.page_token) body.pageToken = a.page_token;
    if (a.data_source_family) body.dataSourceFamily = a.data_source_family;
    const v = await auth.apiPost(`${BASE}/dataTypes/${a.data_type}/dataPoints:dailyRollUp`, body);
    paginationHint(v); if (!a.raw) simplify(v);
    return ok(v);
  } catch (e: any) { return e.message.includes("Invalid date") ? err(e.message) : apiErr(e.message); }
});

// Write
reg("create_data_point", "Create a new data point. Supported types: sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log. Provide the DataPoint body as a JSON object. Example for weight: {\"weight\":{\"sampleTime\":{\"physicalTime\":\"2026-07-22T08:00:00Z\",\"utcOffset\":\"0s\"},\"weightGrams\":70000}}", {
  type: "object", properties: { data_type: { type: "string" }, body: { type: "object" }, dry_run: { type: "boolean" } },
  required: ["data_type", "body"],
}, async (auth, a) => {
  const url = `${BASE}/dataTypes/${a.data_type}/dataPoints`;
  if (a.dry_run) return ok({ dry_run: true, method: "POST", url, body: a.body });
  try { const v = await auth.apiPost(url, a.body); auth.cache.clear(); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("add_weight_sample", "Add a weight measurement in kg.", {
  type: "object", properties: { weight_kg: { type: "number" }, timestamp: { type: "string" }, utc_offset: { type: "string" }, dry_run: { type: "boolean" } },
  required: ["weight_kg"],
}, async (auth, a) => {
  if (a.weight_kg <= 0 || a.weight_kg > 500) return err("weight_kg must be between 0 and 500 kg");
  const ts = a.timestamp || new Date().toISOString();
  const body = { weight: { sampleTime: { physicalTime: ts, utcOffset: a.utc_offset || "0s" }, weightGrams: Math.round(a.weight_kg * 1000) } };
  const url = `${BASE}/dataTypes/weight/dataPoints`;
  if (a.dry_run) return ok({ dry_run: true, method: "POST", url, body });
  try { const v = await auth.apiPost(url, body); auth.cache.clear(); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("add_hydration_log", "Log a hydration event (time of drinking). Note: Google Health API v4 does not support recording volume.", {
  type: "object", properties: { start_time: { type: "string" }, end_time: { type: "string" }, utc_offset: { type: "string" }, dry_run: { type: "boolean" } },
}, async (auth, a) => {
  const start = a.start_time || new Date().toISOString();
  let end = a.end_time || start;
  if (start === end) end = new Date(new Date(start).getTime() + 60000).toISOString();
  const off = a.utc_offset || "0s";
  const body = { hydrationLog: { interval: { startTime: start, startUtcOffset: off, endTime: end, endUtcOffset: off } } };
  const url = `${BASE}/dataTypes/hydration-log/dataPoints`;
  if (a.dry_run) return ok({ dry_run: true, method: "POST", url, body });
  try { const v = await auth.apiPost(url, body); auth.cache.clear(); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("add_sleep_session", "Log a sleep session specifying start and end times. The API does not support titles/notes on sleep sessions.", {
  type: "object", properties: { start_time: { type: "string" }, end_time: { type: "string" }, utc_offset: { type: "string" }, dry_run: { type: "boolean" } },
  required: ["start_time", "end_time"],
}, async (auth, a) => {
  if (new Date(a.start_time) >= new Date(a.end_time)) return err("end_time must be after start_time");
  const off = a.utc_offset || "0s";
  const body = { sleep: { interval: { startTime: a.start_time, startUtcOffset: off, endTime: a.end_time, endUtcOffset: off } } };
  const url = `${BASE}/dataTypes/sleep/dataPoints`;
  if (a.dry_run) return ok({ dry_run: true, method: "POST", url, body });
  try { const v = await auth.apiPost(url, body); auth.cache.clear(); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("add_exercise_session", "Log an exercise session (workout). Exercise types: RUNNING, WALKING, CYCLING, STRENGTH_TRAINING, SWIMMING, YOGA, TREADMILL, HIIT, etc. The API does not support titles/notes on exercise sessions.", {
  type: "object", properties: { exercise_type: { type: "string" }, start_time: { type: "string" }, end_time: { type: "string" }, utc_offset: { type: "string" }, dry_run: { type: "boolean" } },
  required: ["exercise_type", "start_time", "end_time"],
}, async (auth, a) => {
  if (new Date(a.start_time) >= new Date(a.end_time)) return err("end_time must be after start_time");
  const off = a.utc_offset || "0s";
  const body = { exercise: { exerciseType: a.exercise_type.toUpperCase(), interval: { startTime: a.start_time, startUtcOffset: off, endTime: a.end_time, endUtcOffset: off } } };
  const url = `${BASE}/dataTypes/exercise/dataPoints`;
  if (a.dry_run) return ok({ dry_run: true, method: "POST", url, body });
  try { const v = await auth.apiPost(url, body); auth.cache.clear(); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("add_nutrition_log", "Log a meal by type and time. The API only supports mealType and interval; nutrient details and food names are not supported.", {
  type: "object", properties: { meal_type: { type: "string" }, start_time: { type: "string" }, end_time: { type: "string" }, utc_offset: { type: "string" }, dry_run: { type: "boolean" } },
  required: ["meal_type"],
}, async (auth, a) => {
  const valid = ["BREAKFAST","LUNCH","DINNER","SNACK"];
  if (!valid.includes(a.meal_type?.toUpperCase())) return err("meal_type must be one of: BREAKFAST, LUNCH, DINNER, SNACK");
  const start = a.start_time || new Date().toISOString();
  let end = a.end_time || start;
  if (start === end) end = new Date(new Date(start).getTime() + 1800000).toISOString();
  const off = a.utc_offset || "0s";
  const body = { nutritionLog: { mealType: a.meal_type.toUpperCase(), interval: { startTime: start, startUtcOffset: off, endTime: end, endUtcOffset: off } } };
  const url = `${BASE}/dataTypes/nutrition-log/dataPoints`;
  if (a.dry_run) return ok({ dry_run: true, method: "POST", url, body });
  try { const v = await auth.apiPost(url, body); auth.cache.clear(); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("patch_data_point", "Update an existing data point. Provide data type, data point ID, and the fields to update as a JSON object.", {
  type: "object", properties: { data_type: { type: "string" }, data_point_id: { type: "string" }, body: { type: "object" } },
  required: ["data_type", "data_point_id", "body"],
}, async (auth, a) => {
  const url = a.data_point_id.startsWith("users/")
    ? `https://health.googleapis.com/v4/${a.data_point_id}`
    : `${BASE}/dataTypes/${a.data_type}/dataPoints/${a.data_point_id}`;
  try { const v = await auth.apiPatch(url, a.body); auth.cache.clear(); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

// Delete
reg("delete_data_point", "Delete a single data point by its data type and data point ID.", {
  type: "object", properties: { data_type: { type: "string" }, data_point_id: { type: "string" } },
  required: ["data_type", "data_point_id"],
}, async (auth, a) => {
  const name = a.data_point_id.startsWith("users/") ? a.data_point_id : `users/me/dataTypes/${a.data_type}/dataPoints/${a.data_point_id}`;
  try { const v = await auth.apiPost(`${BASE}/dataTypes/${a.data_type}/dataPoints:batchDelete`, { names: [name] }); auth.cache.clear(); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("batch_delete_data_points", "Delete multiple data points by their full resource names. Max 10000 per request. Supported types: sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log.", {
  type: "object", properties: { data_type: { type: "string" }, names: { type: "array", items: { type: "string" } } },
  required: ["data_type", "names"],
}, async (auth, a) => {
  try { const v = await auth.apiPost(`${BASE}/dataTypes/${a.data_type}/dataPoints:batchDelete`, { names: a.names }); auth.cache.clear(); return ok(v); }
  catch (e: any) { return apiErr(e.message); }
});

reg("delete_by_filter", "Delete all data points matching a filter. Use with caution - this is destructive.", {
  type: "object", properties: { data_type: { type: "string" }, filter: { type: "string" }, max_count: { type: "number" } },
  required: ["data_type", "filter"],
}, async (auth, a) => {
  const maxCount = Math.min(Math.max(a.max_count || 100, 1), 10000);
  const names: string[] = [];
  let pageToken: string | undefined;
  while (true) {
    const ps = ["sleep","exercise"].includes(a.data_type) ? 25 : 100;
    let url = `${BASE}/dataTypes/${a.data_type}/dataPoints?filter=${enc(a.filter)}&pageSize=${ps}`;
    if (pageToken) url += `&pageToken=${enc(pageToken)}`;
    let v: any;
    try { v = await auth.apiGet(url); } catch (e: any) { return apiErr(e.message); }
    for (const p of v.dataPoints || []) { if (p.name) { names.push(p.name); if (names.length >= maxCount) break; } }
    if (names.length >= maxCount || !v.nextPageToken) break;
    pageToken = v.nextPageToken;
  }
  if (!names.length) return ok({ deleted_count: 0, message: "No data points matched the filter" });
  let deleted = 0;
  for (let i = 0; i < names.length; i += 10000) {
    const chunk = names.slice(i, i + 10000);
    try { await auth.apiPost(`${BASE}/dataTypes/${a.data_type}/dataPoints:batchDelete`, { names: chunk }); deleted += chunk.length; }
    catch (e: any) { return ok({ deleted_count: deleted, error: `Batch delete failed after ${deleted}: ${e.message}` }); }
  }
  auth.cache.clear();
  return ok({ deleted_count: deleted, data_type: a.data_type, filter: a.filter });
});

// Export
reg("export_exercise_tcx", "Export an exercise data point as TCX (Training Center XML). Requires both activity_and_fitness.readonly and location.readonly scopes. Add ?alt=media for raw TCX download.", {
  type: "object", properties: { data_point_id: { type: "string" }, partial_data: { type: "boolean" } },
  required: ["data_point_id"],
}, async (auth, a) => {
  let url = `${BASE}/dataTypes/exercise/dataPoints/${a.data_point_id}:exportExerciseTcx?alt=media`;
  if (a.partial_data) url += "&partialData=true";
  try { return ok(await auth.apiGet(url)); } catch (e: any) { return apiErr(e.message); }
});

// Profile & devices
for (const [name, path, desc] of [
  ["get_profile", "profile", "Get the user's Google Health profile (name, birthdate, gender, etc)."],
  ["get_settings", "settings", "Get the user's Google Health settings (units, preferences)."],
  ["get_identity", "identity", "Get the user's Google Health identity information."],
  ["get_irn_profile", "irnProfile", "Get the user's Irregular Rhythm Notification profile."],
  ["list_paired_devices", "pairedDevices", "List all devices paired with the user's Google Health account."],
] as const) {
  reg(name, desc, { type: "object", properties: {} }, async (auth) => {
    try { return ok(await auth.apiGet(`${BASE}/${path}`)); } catch (e: any) { return apiErr(e.message); }
  });
}

reg("get_paired_device", "Get details of a specific paired device.", {
  type: "object", properties: { device_id: { type: "string" } }, required: ["device_id"],
}, async (auth, a) => {
  try { return ok(await auth.apiGet(`${BASE}/pairedDevices/${a.device_id}`)); } catch (e: any) { return apiErr(e.message); }
});

reg("update_profile", "Update the user's Google Health profile fields. Provide fields as a JSON object.", {
  type: "object", properties: { body: { type: "object" } }, required: ["body"],
}, async (auth, a) => {
  try { return ok(await auth.apiPatch(`${BASE}/profile`, a.body)); } catch (e: any) { return apiErr(e.message); }
});

reg("update_settings", "Update the user's Google Health settings. Provide fields as a JSON object.", {
  type: "object", properties: { body: { type: "object" } }, required: ["body"],
}, async (auth, a) => {
  try { return ok(await auth.apiPatch(`${BASE}/settings`, a.body)); } catch (e: any) { return apiErr(e.message); }
});

// Analytics
reg("clear_cache", "Clear in-memory response cache to force fresh live API fetches on subsequent queries.", { type: "object", properties: {} }, async (auth) => {
  auth.cache.clear();
  return ok({ success: true, message: "In-memory response cache cleared" });
});

reg("get_temperature_summary", "Get core body temperature and daily sleep temperature derivations for a period.", {
  type: "object", properties: { start_date: { type: "string" }, end_date: { type: "string" } },
  required: ["start_date", "end_date"],
}, async (auth, a) => {
  try {
    const start = parseDate(a.start_date), endExcl = fmt(addDays(parseDate(a.end_date), 1));
    const [core, sleepTemp] = await Promise.all([
      auth.apiGet(`${BASE}/dataTypes/core-body-temperature/dataPoints?filter=${enc(`core_body_temperature.sample_time.physical_time >= "${a.start_date}T00:00:00Z" AND core_body_temperature.sample_time.physical_time < "${endExcl}T00:00:00Z"`)}&pageSize=100`).catch(() => null),
      auth.apiGet(`${BASE}/dataTypes/daily-sleep-temperature-derivations/dataPoints?filter=${enc(`daily_sleep_temperature_derivations.date >= "${a.start_date}" AND daily_sleep_temperature_derivations.date < "${endExcl}"`)}&pageSize=100`).catch(() => null),
    ]);
    return ok({ period: { start_date: a.start_date, end_date: a.end_date }, core_body_temperature: core, daily_sleep_temperature_derivations: sleepTemp });
  } catch (e: any) { return e.message.includes("Invalid date") ? err(e.message) : apiErr(e.message); }
});

reg("get_trends", "Get daily time series for a health metric over a date range. Returns per-day aggregated values. Only works with dailyRollUp-compatible types. Use list_data_types to check.", {
  type: "object", properties: { data_type: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" } },
  required: ["data_type", "start_date", "end_date"],
}, async (auth, a) => {
  try {
    const start = parseDate(a.start_date), end = parseDate(a.end_date);
    if (start > end) return err("end_date must be on or after start_date");
    const body = { range: { start: { date: dateObj(start) }, end: { date: dateObj(addDays(end, 1)) } }, windowSizeDays: 1 };
    const v = await auth.apiPost(`${BASE}/dataTypes/${a.data_type}/dataPoints:dailyRollUp`, body);
    const camel = a.data_type.replace(/-/g, "_").replace(/_([a-z])/g, (_: any, c: string) => c.toUpperCase());
    const series = (v.rollupDataPoints || []).map((p: any) => ({
      date: p.civilStartTime?.date ? `${p.civilStartTime.date.year}-${String(p.civilStartTime.date.month).padStart(2,"0")}-${String(p.civilStartTime.date.day).padStart(2,"0")}` : "",
      value: p[camel],
    }));
    return ok({ data_type: a.data_type, start_date: a.start_date, end_date: a.end_date, days: series.length, series });
  } catch (e: any) { return e.message.includes("Invalid date") ? err(e.message) : apiErr(e.message); }
});

reg("compare_health_periods", "Compare health metrics (steps, active calories, etc.) between two date ranges (Period A vs Period B).", {
  type: "object", properties: { period_a_start: { type: "string" }, period_a_end: { type: "string" }, period_b_start: { type: "string" }, period_b_end: { type: "string" } },
  required: ["period_a_start", "period_a_end", "period_b_start", "period_b_end"],
}, async (auth, a) => {
  try {
    const [sa, sb] = await Promise.all([
      periodSummary(auth, parseDate(a.period_a_start), parseDate(a.period_a_end)),
      periodSummary(auth, parseDate(a.period_b_start), parseDate(a.period_b_end)),
    ]);
    const keys = ["avg_daily_steps","avg_daily_active_calories_kcal","avg_daily_total_calories_kcal","avg_daily_distance_km","avg_daily_floors","avg_heart_rate_bpm","avg_sleep_minutes","avg_deep_sleep_minutes","avg_rem_sleep_minutes","avg_awake_minutes","avg_sleep_efficiency_pct","avg_hrv_ms","avg_resting_hr_bpm"];
    const delta: any = {};
    for (const k of keys) {
      const va = num(sa[k]), vb = num(sb[k]), diff = vb - va;
      delta[k] = { period_a: va, period_b: vb, diff: round2(diff), percentage_change: `${(va ? (diff/va)*100 : 0).toFixed(1)}%` };
    }
    return ok({ period_a: { start: a.period_a_start, end: a.period_a_end, metrics: sa }, period_b: { start: a.period_b_start, end: a.period_b_end, metrics: sb }, comparison_delta: delta });
  } catch (e: any) { return e.message.includes("Invalid date") ? err(e.message) : apiErr(e.message); }
});

async function periodSummary(auth: AuthState, start: Date, end: Date): Promise<any> {
  const ss = fmt(start), es = fmt(addDays(end, 1));
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const metrics = [["steps","countSum"],["active-energy-burned","kcalSum"],["total-calories","kcalSum"],["distance","millimetersSum"],["floors","countSum"],["heart-rate","beatsPerMinuteAvg"]];
  const rollups = await Promise.all(metrics.map(([dt]) =>
    auth.apiPost(`${BASE}/dataTypes/${dt}/dataPoints:dailyRollUp`, { range: { start: { date: dateObj(start) }, end: { date: dateObj(addDays(end, 1)) } } }).catch(() => null)
  ));
  const sum = (i: number, path: string) => (rollups[i]?.rollupDataPoints || []).reduce((s: number, p: any) => s + num(getPath(p, path)), 0);
  const avg = (i: number, path: string) => { const pts = rollups[i]?.rollupDataPoints || []; const vals = pts.map((p: any) => num(getPath(p, path))).filter((v: number) => v > 0); return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0; };

  // Sleep
  let sleepPts: any[] = [];
  try {
    let pt: string | undefined;
    while (true) {
      let url = `${BASE}/dataTypes/sleep/dataPoints?filter=${enc(`sleep.interval.civil_end_time >= "${ss}" AND sleep.interval.civil_end_time < "${es}"`)}&pageSize=25`;
      if (pt) url += `&pageToken=${enc(pt)}`;
      const v = await auth.apiGet(url);
      sleepPts.push(...(v.dataPoints || []));
      if (!v.nextPageToken) break;
      pt = v.nextPageToken;
    }
  } catch {}

  let totalSleep = 0, sessions = 0, deep = 0, rem = 0, awake = 0, inPeriod = 0;
  for (const p of sleepPts) {
    const s = p.sleep?.summary;
    if (!s) continue;
    sessions++;
    totalSleep += num(s.minutesAsleep);
    inPeriod += num(s.minutesInSleepPeriod);
    awake += num(s.minutesAwake);
    for (const st of s.stagesSummary || []) { if (st.type === "DEEP") deep += num(st.minutes); if (st.type === "REM") rem += num(st.minutes); }
  }

  // HRV + RHR
  const [hrvResp, rhrResp] = await Promise.all([
    auth.apiGet(`${BASE}/dataTypes/daily-heart-rate-variability/dataPoints?filter=${enc(`daily_heart_rate_variability.date >= "${ss}" AND daily_heart_rate_variability.date < "${es}"`)}&pageSize=100`).catch(() => null),
    auth.apiGet(`${BASE}/dataTypes/daily-resting-heart-rate/dataPoints?filter=${enc(`daily_resting_heart_rate.date >= "${ss}" AND daily_resting_heart_rate.date < "${es}"`)}&pageSize=100`).catch(() => null),
  ]);
  const hrvVals = (hrvResp?.dataPoints || []).map((p: any) => num(p.dailyHeartRateVariability?.averageHeartRateVariabilityMilliseconds)).filter((v: number) => v > 0);
  const rhrVals = (rhrResp?.dataPoints || []).map((p: any) => num(p.dailyRestingHeartRate?.beatsPerMinute)).filter((v: number) => v > 0);
  const avgArr = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

  return {
    days_count: days,
    total_steps: sum(0, "steps.countSum"), avg_daily_steps: Math.round(sum(0, "steps.countSum") / days),
    total_active_calories_kcal: round1(sum(1, "activeEnergyBurned.kcalSum")), avg_daily_active_calories_kcal: round1(sum(1, "activeEnergyBurned.kcalSum") / days),
    total_calories_kcal: round1(sum(2, "totalCalories.kcalSum")), avg_daily_total_calories_kcal: round1(sum(2, "totalCalories.kcalSum") / days),
    total_distance_km: round2(sum(3, "distance.millimetersSum") / 1e6), avg_daily_distance_km: round2(sum(3, "distance.millimetersSum") / 1e6 / days),
    total_floors: sum(4, "floors.countSum"), avg_daily_floors: Math.round(sum(4, "floors.countSum") / days),
    avg_heart_rate_bpm: round1(avg(5, "heartRate.beatsPerMinuteAvg")),
    sleep_sessions: sessions, total_sleep_minutes: totalSleep,
    avg_sleep_minutes: sessions ? Math.round(totalSleep / sessions) : 0,
    avg_deep_sleep_minutes: sessions ? Math.round(deep / sessions) : 0,
    avg_rem_sleep_minutes: sessions ? Math.round(rem / sessions) : 0,
    avg_awake_minutes: sessions ? Math.round(awake / sessions) : 0,
    avg_sleep_efficiency_pct: inPeriod ? round1(totalSleep / inPeriod * 100) : 0,
    avg_hrv_ms: round1(avgArr(hrvVals)), avg_resting_hr_bpm: round1(avgArr(rhrVals)),
  };
}

function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

reg("get_hrv_recovery_trend", "Analyze HRV (Heart Rate Variability) and resting heart rate trends over past N days to evaluate physical recovery status.", {
  type: "object", properties: { days: { type: "number" }, end_date: { type: "string" } },
}, async (auth, a) => {
  const daysCount = Math.min(Math.max(a.days || 14, 1), 90);
  const end = a.end_date ? parseDate(a.end_date) : new Date();
  const start = addDays(end, -(daysCount - 1));
  const endExcl = fmt(addDays(end, 1));
  const [hrvResp, rhrResp] = await Promise.all([
    auth.apiGet(`${BASE}/dataTypes/daily-heart-rate-variability/dataPoints?filter=${enc(`daily_heart_rate_variability.date >= "${fmt(start)}" AND daily_heart_rate_variability.date < "${endExcl}"`)}&pageSize=100`).catch(() => null),
    auth.apiGet(`${BASE}/dataTypes/daily-resting-heart-rate/dataPoints?filter=${enc(`daily_resting_heart_rate.date >= "${fmt(start)}" AND daily_resting_heart_rate.date < "${endExcl}"`)}&pageSize=100`).catch(() => null),
  ]);

  const hrvDaily: any[] = [], rhrDaily: any[] = [];
  for (const p of hrvResp?.dataPoints || []) {
    const h = p.dailyHeartRateVariability;
    const v = num(h?.averageHeartRateVariabilityMilliseconds);
    if (!v) continue;
    const d = h?.date;
    hrvDaily.push({ date: d ? `${d.year}-${String(d.month).padStart(2,"0")}-${String(d.day).padStart(2,"0")}` : "", avg_hrv_ms: v, entropy: h?.entropy ?? null, deep_sleep_hrv_ms: h?.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds ?? null, non_rem_hr_bpm: h?.nonRemHeartRateBeatsPerMinute ?? null });
  }
  for (const p of rhrResp?.dataPoints || []) {
    const r = p.dailyRestingHeartRate;
    const v = num(r?.beatsPerMinute);
    if (!v) continue;
    const d = r?.date;
    rhrDaily.push({ date: d ? `${d.year}-${String(d.month).padStart(2,"0")}-${String(d.day).padStart(2,"0")}` : "", bpm: v, calculation_method: r?.dailyRestingHeartRateMetadata?.calculationMethod ?? null });
  }

  hrvDaily.sort((a, b) => a.date.localeCompare(b.date));
  rhrDaily.sort((a, b) => a.date.localeCompare(b.date));
  const hrvVals = hrvDaily.map((d) => d.avg_hrv_ms);
  const rhrVals = rhrDaily.map((d) => d.bpm);
  const avgA = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const hrvAvg = avgA(hrvVals), rhrAvg = avgA(rhrVals);

  let readiness: string, blHrv = 0, blRhr = 0, curHrv = hrvAvg, curRhr = rhrAvg, blLabel: string;
  if (hrvDaily.length >= 4) {
    const blEnd = hrvDaily.length - 3;
    blLabel = `first ${blEnd} days`;
    blHrv = avgA(hrvDaily.slice(0, blEnd).map((d) => d.avg_hrv_ms));
    blRhr = rhrDaily.length >= 4 ? avgA(rhrDaily.slice(0, rhrDaily.length - 3).map((d) => d.bpm)) : avgA(rhrVals);
    curHrv = avgA(hrvDaily.slice(blEnd).map((d) => d.avg_hrv_ms));
    curRhr = avgA(rhrDaily.slice(-3).map((d) => d.bpm));
    readiness = curHrv >= blHrv * 0.95 && (!blRhr || curRhr <= blRhr * 1.05) ? "HIGH" : curHrv >= blHrv * 0.85 ? "MODERATE" : "LOW / RECOVERY NEEDED";
  } else {
    blLabel = "first 7 days";
    readiness = hrvAvg > 50 && rhrAvg > 0 && rhrAvg < 65 ? "HIGH" : hrvAvg > 30 ? "MODERATE" : "LOW / RECOVERY NEEDED";
  }

  return ok({
    period: { start_date: fmt(start), end_date: fmt(end), days: daysCount },
    hrv_metrics: { sample_count: hrvVals.length, avg_hrv_ms: round1(hrvAvg), min_hrv_ms: hrvVals.length ? Math.min(...hrvVals) : 0, max_hrv_ms: hrvVals.length ? Math.max(...hrvVals) : 0 },
    resting_hr_metrics: { sample_count: rhrVals.length, avg_bpm: round1(rhrAvg), min_bpm: rhrVals.length ? Math.min(...rhrVals) : 0, max_bpm: rhrVals.length ? Math.max(...rhrVals) : 0 },
    baseline: { period: blLabel, hrv_avg_ms: round1(blHrv), rhr_avg_bpm: round1(blRhr), data_sufficient: hrvDaily.length >= 4 },
    current: { period: "last 3 days", hrv_avg_ms: round1(curHrv), rhr_avg_bpm: round1(curRhr) },
    daily_hrv: hrvDaily, daily_rhr: rhrDaily, readiness_assessment: readiness,
  });
});

// Summary
const ROLLUP_SPECS: [string, string, string][] = [
  ["steps","steps","steps"],["heart-rate","heartRate","heart_rate"],["active-energy-burned","activeEnergyBurned","active_calories"],
  ["total-calories","totalCalories","total_calories"],["distance","distance","distance"],["active-minutes","activeMinutes","active_minutes"],
  ["active-zone-minutes","activeZoneMinutes","active_zone_minutes"],["floors","floors","floors"],
  ["time-in-heart-rate-zone","timeInHeartRateZone","time_in_heart_rate_zone"],["calories-in-heart-rate-zone","caloriesInHeartRateZone","calories_in_heart_rate_zone"],
  ["altitude","altitude","altitude"],["swim-lengths-data","swimLengthsData","swim_lengths"],["weight","weight","weight_rollup"],
  ["body-fat","bodyFat","body_fat"],["blood-glucose","bloodGlucose","blood_glucose"],["core-body-temperature","coreBodyTemperature","core_body_temperature"],
  ["run-vo2-max","runVo2Max","run_vo2_max"],["sedentary-period","sedentaryPeriod","sedentary_period"],["nutrition-log","nutritionLog","nutrition_log"],["hydration-log","hydrationLog","hydration_log"],
];
const DAILY_SPECS: [string, string, string, string][] = [
  ["daily-resting-heart-rate","daily_resting_heart_rate","dailyRestingHeartRate","resting_heart_rate"],
  ["daily-heart-rate-variability","daily_heart_rate_variability","dailyHeartRateVariability","heart_rate_variability"],
  ["daily-oxygen-saturation","daily_oxygen_saturation","dailyOxygenSaturation","oxygen_saturation"],
  ["daily-respiratory-rate","daily_respiratory_rate","dailyRespiratoryRate","respiratory_rate"],
  ["daily-sleep-temperature-derivations","daily_sleep_temperature_derivations","dailySleepTemperatureDerivations","sleep_temperature"],
  ["daily-vo2-max","daily_vo2_max","dailyVo2Max","daily_vo2_max"],
  ["daily-heart-rate-zones","daily_heart_rate_zones","dailyHeartRateZones","daily_heart_rate_zones"],
];
const SAMPLE_SPECS: [string, string, string, string][] = [
  ["vo2-max","vo2_max","vo2Max","vo2_max"],["heart-rate-variability","heart_rate_variability","heartRateVariability","hrv_sample"],
  ["oxygen-saturation","oxygen_saturation","oxygenSaturation","spo2_sample"],["respiratory-rate-sleep-summary","respiratory_rate_sleep_summary","respiratoryRateSleepSummary","respiratory_rate_sleep"],
];

async function buildDailySummary(auth: AuthState, date: Date): Promise<any> {
  const ds = fmt(date), ns = fmt(addDays(date, 1));
  const summary: any = { date: ds };
  const errors: string[] = [];
  const body = { range: { start: { date: dateObj(date) }, end: { date: dateObj(addDays(date, 1)) } }, windowSizeDays: 1 };

  const tasks: Promise<void>[] = [];
  const CONCURRENCY = 10;
  let idx = 0;
  const allTasks: (() => Promise<void>)[] = [];

  for (const [dt, field, key] of ROLLUP_SPECS) {
    allTasks.push(async () => {
      try { const v = await auth.apiPost(`${BASE}/dataTypes/${dt}/dataPoints:dailyRollUp`, body); summary[key] = v.rollupDataPoints?.[0]?.[field] ?? null; }
      catch (e: any) { errors.push(`${dt}: ${e.message}`); }
    });
  }
  for (const [dt, ff, df, key] of DAILY_SPECS) {
    allTasks.push(async () => {
      try { const v = await auth.apiGet(`${BASE}/dataTypes/${dt}/dataPoints?filter=${enc(`${ff}.date >= "${ds}" AND ${ff}.date < "${ns}"`)}&pageSize=1`); summary[key] = v.dataPoints?.[0]?.[df] ?? null; }
      catch (e: any) { errors.push(`${dt}: ${e.message}`); }
    });
  }
  for (const [dt, ff, df, key] of SAMPLE_SPECS) {
    allTasks.push(async () => {
      try { const v = await auth.apiGet(`${BASE}/dataTypes/${dt}/dataPoints?filter=${enc(`${ff}.sample_time.civil_time >= "${ds}" AND ${ff}.sample_time.civil_time < "${ns}"`)}&pageSize=1`); summary[key] = v.dataPoints?.[0]?.[df] ?? null; }
      catch (e: any) { errors.push(`${dt}: ${e.message}`); }
    });
  }
  // Sleep
  allTasks.push(async () => {
    try {
      const v = await auth.apiGet(`${BASE}/dataTypes/sleep/dataPoints?filter=${enc(`sleep.interval.civil_end_time >= "${ds}" AND sleep.interval.civil_end_time < "${ns}"`)}&pageSize=5`);
      const sleeps = (v.dataPoints || []).map((p: any) => p.sleep).filter(Boolean).map((s: any) => ({ start: s.interval?.startTime, end: s.interval?.endTime, type: s.type, stages: s.stages, summary: s.summary, metadata: s.metadata }));
      if (sleeps.length) summary.sleep = sleeps;
    } catch (e: any) { errors.push(`sleep: ${e.message}`); }
  });
  // Exercise
  allTasks.push(async () => {
    try {
      const v = await auth.apiGet(`${BASE}/dataTypes/exercise/dataPoints?filter=${enc(`exercise.interval.civil_start_time >= "${ds}" AND exercise.interval.civil_start_time < "${ns}"`)}&pageSize=25`);
      const ex = (v.dataPoints || []).map((p: any) => p.exercise).filter(Boolean).map((e: any) => ({ type: e.exerciseType, name: e.displayName, start: e.interval?.startTime, end: e.interval?.endTime, duration: e.activeDuration, metrics: e.metricsSummary }));
      if (ex.length) summary.exercise = ex;
    } catch (e: any) { errors.push(`exercise: ${e.message}`); }
  });
  // Activity levels
  allTasks.push(async () => {
    try {
      const v = await auth.apiGet(`${BASE}/dataTypes/activity-level/dataPoints?filter=${enc(`activity_level.interval.start_time >= "${ds}T00:00:00Z" AND activity_level.interval.start_time < "${ns}T00:00:00Z"`)}&pageSize=50`);
      const levels = (v.dataPoints || []).map((p: any) => p.activityLevel).filter(Boolean);
      if (levels.length) summary.activity_levels = levels;
    } catch (e: any) { errors.push(`activity-level: ${e.message}`); }
  });

  // Run with concurrency limit
  const queue = [...allTasks];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) { const task = queue.shift(); if (task) await task(); }
  });
  await Promise.all(workers);

  if (errors.length) summary._errors = errors;
  return summary;
}

async function dailySummary(auth: AuthState, date: Date): Promise<ToolResult> {
  const key = `summary:${fmt(date)}`;
  const cached = auth.cache.get(key);
  if (cached) return ok({ ...cached, _cached: true });
  const summary = await buildDailySummary(auth, date);
  auth.cache.set(key, summary);
  return ok(summary);
}

reg("summary", "Full health summary for any date: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, VO2max, nutrition, hydration, sedentary periods, activity levels. `today` and `yesterday` are shortcuts for this tool. Per-metric fetch failures, if any, are listed in `_errors`.", {
  type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD (defaults to today)" } },
}, async (auth, a) => {
  const date = a.date ? parseDate(a.date) : new Date();
  return dailySummary(auth, date);
});

reg("today", "Get a full health summary for today: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, sedentary periods.", { type: "object", properties: {} }, async (auth) => dailySummary(auth, new Date()));
reg("yesterday", "Get a full health summary for yesterday: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, sedentary periods.", { type: "object", properties: {} }, async (auth) => dailySummary(auth, addDays(new Date(), -1)));
