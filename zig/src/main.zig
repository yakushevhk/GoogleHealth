//! Google Health MCP Server — Zig implementation
//! MCP JSON-RPC 2.0 over stdio (raw POSIX fd). 39 data types, 15 core tools.
//! OAuth2 token refresh + HTTPS via std.http.Client on std.Io.Threaded.

const std = @import("std");
const json = std.json;
const posix = std.posix;
const Allocator = std.mem.Allocator;

// Raw write(2) — posix.write removed in Zig 0.16
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn time(t: ?*i64) i64;
extern "c" fn usleep(usec: c_uint) c_int;

fn fdWrite(fd: c_int, data: []const u8) void {
    _ = write(fd, data.ptr, data.len);
}

fn nowSecs() i64 {
    return time(null);
}

fn sleepMs(ms: u64) void {
    _ = usleep(@intCast(ms * 1000));
}

const BASE = "https://health.googleapis.com/v4/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const RETRY_COUNT = 3;

// ─── Data Type Registry (39 types) ──────────────────────────────────────────

const DataType = struct {
    id: []const u8,
    filter_name: []const u8,
    category: []const u8,
    listable: bool,
    rollup: bool,
    daily_rollup: bool,
    writable: bool,
    time_field: []const u8,
    page_cap: u32,
    rollup_range_days: u32,
    description: []const u8,
};

fn filterName(comptime id: []const u8) []const u8 {
    comptime {
        @setEvalBranchQuota(100_000);
        var buf: [id.len]u8 = undefined;
        for (id, 0..) |c, i| buf[i] = if (c == '-') '_' else c;
        const out = buf;
        return &out;
    }
}

fn timeFieldSuffix(tf: []const u8) []const u8 {
    const eql = std.mem.eql;
    if (eql(u8, tf, "interval_start")) return "interval.start_time";
    if (eql(u8, tf, "interval_civil_start")) return "interval.civil_start_time";
    if (eql(u8, tf, "interval_end")) return "interval.end_time";
    if (eql(u8, tf, "sample_physical")) return "sample_time.physical_time";
    if (eql(u8, tf, "daily")) return "date";
    return "";
}

fn mkType(comptime id: []const u8, cat: []const u8, tf: []const u8, listable: bool, rollup: bool, dr: bool, writable: bool, cap: u32, range_days: u32, desc: []const u8) DataType {
    return .{ .id = id, .filter_name = filterName(id), .category = cat, .listable = listable, .rollup = rollup, .daily_rollup = dr, .writable = writable, .time_field = tf, .page_cap = cap, .rollup_range_days = range_days, .description = desc };
}

const DATA_TYPES = [_]DataType{
    mkType("steps", "activity", "interval_start", true, true, true, false, 10000, 90, "Step counts over time intervals."),
    mkType("active-energy-burned", "activity", "interval_start", true, true, true, false, 10000, 90, "Active calories burned."),
    mkType("distance", "activity", "interval_start", true, true, true, false, 10000, 90, "Distance (millimeters)."),
    mkType("active-minutes", "activity", "interval_start", true, true, true, false, 10000, 14, "Active minutes."),
    mkType("active-zone-minutes", "activity", "interval_start", true, true, true, false, 10000, 90, "Zone minutes."),
    mkType("activity-level", "activity", "interval_start", true, true, true, false, 10000, 90, "Activity levels."),
    mkType("altitude", "activity", "interval_start", true, true, true, false, 10000, 90, "Altitude (meters)."),
    mkType("sedentary-period", "activity", "interval_start", true, true, true, false, 10000, 90, "Sedentary periods."),
    mkType("swim-lengths-data", "activity", "interval_start", true, true, true, false, 10000, 90, "Swim lengths."),
    mkType("time-in-heart-rate-zone", "activity", "interval_start", true, true, true, false, 10000, 90, "Time in HR zones."),
    mkType("heart-rate", "cardiac", "sample_physical", true, true, true, false, 10000, 14, "Heart rate (BPM)."),
    mkType("weight", "body", "sample_physical", true, true, true, true, 10000, 90, "Weight (kg)."),
    mkType("height", "body", "sample_physical", true, false, false, false, 10000, 90, "Height (meters)."),
    mkType("body-fat", "body", "sample_physical", true, true, true, false, 10000, 90, "Body fat %."),
    mkType("blood-glucose", "nutrition", "sample_physical", true, true, true, false, 10000, 90, "Blood glucose."),
    mkType("core-body-temperature", "temperature", "sample_physical", true, true, true, false, 10000, 90, "Core temp (C)."),
    mkType("heart-rate-variability", "cardiac", "sample_physical", true, false, false, false, 10000, 90, "HRV (RMSSD ms)."),
    mkType("oxygen-saturation", "oxygen", "sample_physical", true, false, false, false, 10000, 90, "SpO2 %."),
    mkType("respiratory-rate-sleep-summary", "respiratory", "sample_physical", true, false, false, false, 10000, 90, "Resp rate sleep."),
    mkType("vo2-max", "activity", "sample_physical", true, false, false, false, 10000, 90, "VO2 max."),
    mkType("run-vo2-max", "activity", "sample_physical", true, true, true, false, 10000, 90, "Run VO2 max."),
    mkType("daily-resting-heart-rate", "cardiac", "daily", true, false, false, false, 10000, 90, "Daily resting HR."),
    mkType("daily-heart-rate-variability", "cardiac", "daily", true, false, false, false, 10000, 90, "Daily HRV."),
    mkType("daily-heart-rate-zones", "cardiac", "daily", true, false, false, false, 10000, 90, "Daily HR zones."),
    mkType("daily-oxygen-saturation", "oxygen", "daily", true, false, false, false, 10000, 90, "Daily SpO2."),
    mkType("daily-respiratory-rate", "respiratory", "daily", true, false, false, false, 10000, 90, "Daily resp rate."),
    mkType("daily-sleep-temperature-derivations", "sleep", "daily", true, false, false, false, 10000, 90, "Sleep temp."),
    mkType("daily-vo2-max", "activity", "daily", true, false, false, false, 10000, 90, "Daily VO2 max."),
    mkType("sleep", "sleep", "interval_end", true, false, false, true, 25, 90, "Sleep sessions."),
    mkType("exercise", "activity", "interval_civil_start", true, false, false, true, 25, 90, "Exercise sessions."),
    mkType("hydration-log", "nutrition", "interval_civil_start", true, true, true, true, 10000, 90, "Hydration events."),
    mkType("nutrition-log", "nutrition", "interval_civil_start", true, true, true, true, 10000, 90, "Meal events."),
    mkType("irregular-rhythm-notification", "clinical", "interval_civil_start", true, false, false, false, 10000, 90, "AFib notifications."),
    mkType("electrocardiogram", "clinical", "interval_start", true, false, false, false, 10000, 90, "ECG recordings."),
    mkType("food", "nutrition", "none", true, false, false, false, 10000, 90, "Food catalog."),
    mkType("food-measurement-unit", "nutrition", "none", true, false, false, false, 10000, 90, "Food units."),
    mkType("floors", "activity", "interval_start", false, true, true, false, 10000, 90, "Floors climbed."),
    mkType("total-calories", "nutrition", "interval_start", false, true, true, false, 10000, 14, "Total calories."),
    mkType("calories-in-heart-rate-zone", "cardiac", "interval_start", false, true, true, false, 10000, 14, "Calories per zone."),
};

// ─── Tool registry ───────────────────────────────────────────────────────────

const ToolDef = struct { name: []const u8, description: []const u8 };

const TOOLS = [_]ToolDef{
    .{ .name = "list_data_types", .description = "List all 39 supported Google Health API v4 data types." },
    .{ .name = "describe_data_type", .description = "Get detailed info about a data type." },
    .{ .name = "list_data_points", .description = "List data points with AIP-160 filters." },
    .{ .name = "get_data_point", .description = "Get a single data point by ID." },
    .{ .name = "get_profile", .description = "Get user profile." },
    .{ .name = "get_settings", .description = "Get user settings." },
    .{ .name = "get_identity", .description = "Get user identity." },
    .{ .name = "list_paired_devices", .description = "List paired devices." },
    .{ .name = "get_irn_profile", .description = "Get IRN profile." },
    .{ .name = "clear_cache", .description = "Clear response cache." },
    .{ .name = "today", .description = "Full health summary for today." },
    .{ .name = "yesterday", .description = "Full health summary for yesterday." },
    .{ .name = "summary", .description = "Full health summary for a date." },
    .{ .name = "add_weight_sample", .description = "Add weight in kg." },
    .{ .name = "export_exercise_tcx", .description = "Export exercise as TCX." },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn getEnv(name: [*:0]const u8) ?[:0]const u8 {
    const ptr = std.c.getenv(name) orelse return null;
    return std.mem.sliceTo(ptr, 0);
}

fn isSegment(s: []const u8) bool {
    if (s.len == 0 or s.len > 256) return false;
    for (s) |c| {
        const ok = (c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or
            (c >= '0' and c <= '9') or c == '-' or c == '_';
        if (!ok) return false;
    }
    return true;
}

fn urlEncode(alloc: Allocator, src: []const u8) ![]u8 {
    var buf: std.ArrayList(u8) = .empty;
    const hex = "0123456789ABCDEF";
    for (src) |c| {
        const safe = (c >= 'A' and c <= 'Z') or (c >= 'a' and c <= 'z') or
            (c >= '0' and c <= '9') or c == '-' or c == '_' or c == '.' or c == '~';
        if (safe) {
            try buf.append(alloc, c);
        } else {
            try buf.append(alloc, '%');
            try buf.append(alloc, hex[c >> 4]);
            try buf.append(alloc, hex[c & 0xf]);
        }
    }
    return buf.toOwnedSlice(alloc);
}

fn rfc3339Now(alloc: Allocator) ![]u8 {
    const ts: u64 = @intCast(nowSecs());
    const epoch_secs = std.time.epoch.EpochSeconds{ .secs = ts };
    const epoch_day = epoch_secs.getEpochDay();
    const year_day = epoch_day.calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_secs = epoch_secs.getDaySeconds();
    return std.fmt.allocPrint(alloc, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}Z", .{
        year_day.year, month_day.month.numeric(), month_day.day_index + 1,
        day_secs.getHoursIntoDay(), day_secs.getMinutesIntoHour(), day_secs.getSecondsIntoMinute(),
    });
}

// ─── Auth / HTTP ─────────────────────────────────────────────────────────────

const Auth = struct {
    long_alloc: Allocator, // survives across requests
    client: std.http.Client,
    client_id: []const u8,
    client_secret: []const u8,
    refresh_token: []const u8,
    access_token: ?[]u8 = null,
    expires_at: i64 = 0,
};

fn refreshToken(auth: *Auth, req_alloc: Allocator) ?[]const u8 {
    const body = std.fmt.allocPrint(auth.long_alloc, "client_id={s}&client_secret={s}&refresh_token={s}&grant_type=refresh_token", .{ auth.client_id, auth.client_secret, auth.refresh_token }) catch return null;
    defer auth.long_alloc.free(body);

    var aw: std.Io.Writer.Allocating = .init(req_alloc);
    defer aw.deinit();
    const headers = [_]std.http.Header{
        .{ .name = "content-type", .value = "application/x-www-form-urlencoded" },
    };
    const res = auth.client.fetch(.{
        .location = .{ .url = TOKEN_URL },
        .method = .POST,
        .payload = body,
        .extra_headers = &headers,
        .response_writer = &aw.writer,
    }) catch return null;
    if (@intFromEnum(res.status) >= 300) return null;

    const parsed = json.parseFromSlice(json.Value, req_alloc, aw.written(), .{}) catch return null;
    defer parsed.deinit();
    const token = parsed.value.object.get("access_token") orelse return null;
    if (token != .string) return null;
    const expires: i64 = blk: {
        const e = parsed.value.object.get("expires_in") orelse break :blk 3600;
        break :blk switch (e) {
            .integer => |v| v,
            .float => |v| @intFromFloat(v),
            else => 3600,
        };
    };

    if (auth.access_token) |old| auth.long_alloc.free(old);
    auth.access_token = auth.long_alloc.dupe(u8, token.string) catch return null;
    auth.expires_at = nowSecs() + expires;
    return auth.access_token;
}

fn getToken(auth: *Auth, req_alloc: Allocator) ?[]const u8 {
    if (auth.access_token != null and nowSecs() + 60 < auth.expires_at) {
        return auth.access_token;
    }
    return refreshToken(auth, req_alloc);
}

const delays_ms = [_]u64{ 500, 1500, 4000 };

fn doRequest(auth: *Auth, req_alloc: Allocator, method: std.http.Method, url: []const u8, payload: ?[]const u8) ?[]u8 {
    var attempt: usize = 0;
    while (attempt <= RETRY_COUNT) : (attempt += 1) {
        const token = getToken(auth, req_alloc) orelse {
            if (attempt < RETRY_COUNT) {
                sleepMs(delays_ms[attempt]);
                continue;
            }
            return null;
        };

        const auth_header = std.fmt.allocPrint(req_alloc, "Bearer {s}", .{token}) catch return null;
        var headers_buf: [2]std.http.Header = undefined;
        var headers_len: usize = 1;
        headers_buf[0] = .{ .name = "authorization", .value = auth_header };
        if (payload != null) {
            headers_buf[1] = .{ .name = "content-type", .value = "application/json" };
            headers_len = 2;
        }

        var aw: std.Io.Writer.Allocating = .init(req_alloc);
        defer aw.deinit();
        const res = auth.client.fetch(.{
            .location = .{ .url = url },
            .method = method,
            .payload = payload,
            .extra_headers = headers_buf[0..headers_len],
            .response_writer = &aw.writer,
        }) catch {
            if (attempt < RETRY_COUNT) {
                sleepMs(delays_ms[attempt]);
                continue;
            }
            return null;
        };

        const code = @intFromEnum(res.status);
        if (code == 401) {
            if (auth.access_token) |old| {
                auth.long_alloc.free(old);
                auth.access_token = null;
            }
            auth.expires_at = 0;
            if (refreshToken(auth, req_alloc) == null) return null;
            continue;
        }
        if (code >= 200 and code < 300) {
            return req_alloc.dupe(u8, aw.written()) catch null;
        }
        if ((code == 429 or code >= 500) and attempt < RETRY_COUNT) {
            sleepMs(delays_ms[attempt]);
            continue;
        }
        return null;
    }
    return null;
}

fn apiGet(auth: *Auth, req_alloc: Allocator, url: []const u8) ?[]u8 {
    return doRequest(auth, req_alloc, .GET, url, null);
}

fn apiPost(auth: *Auth, req_alloc: Allocator, url: []const u8, body: []const u8) ?[]u8 {
    return doRequest(auth, req_alloc, .POST, url, body);
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

fn handleListDataTypes(alloc: Allocator) ![]u8 {
    var buf: std.ArrayList(u8) = .empty;
    try buf.appendSlice(alloc, "{\"count\":39,\"total\":39,\"data_types\":[");
    for (DATA_TYPES, 0..) |t, i| {
        if (i > 0) try buf.appendSlice(alloc, ",");
        const entry = try std.fmt.allocPrint(alloc, "{{\"id\":\"{s}\",\"filter_name\":\"{s}\",\"category\":\"{s}\",\"listable\":{},\"rollup\":{},\"daily_rollup\":{},\"writable\":{},\"time_field\":\"{s}\",\"page_cap\":{d},\"rollup_range_days\":{d},\"description\":\"{s}\"}}", .{ t.id, t.filter_name, t.category, t.listable, t.rollup, t.daily_rollup, t.writable, t.time_field, t.page_cap, t.rollup_range_days, t.description });
        try buf.appendSlice(alloc, entry);
    }
    try buf.appendSlice(alloc, "]}");
    return buf.toOwnedSlice(alloc);
}

fn handleDescribeDataType(alloc: Allocator, type_id: []const u8) ![]u8 {
    for (DATA_TYPES) |t| {
        if (std.mem.eql(u8, t.id, type_id)) {
            const suffix = timeFieldSuffix(t.time_field);
            if (suffix.len > 0) {
                const ff = try std.fmt.allocPrint(alloc, "{s}.{s}", .{ t.filter_name, suffix });
                return try std.fmt.allocPrint(alloc, "{{\"id\":\"{s}\",\"filter_name\":\"{s}\",\"category\":\"{s}\",\"listable\":{},\"rollup\":{},\"daily_rollup\":{},\"writable\":{},\"time_field\":\"{s}\",\"page_cap\":{d},\"rollup_range_days\":{d},\"description\":\"{s}\",\"filter_field\":\"{s}\"}}", .{ t.id, t.filter_name, t.category, t.listable, t.rollup, t.daily_rollup, t.writable, t.time_field, t.page_cap, t.rollup_range_days, t.description, ff });
            }
            return try std.fmt.allocPrint(alloc, "{{\"id\":\"{s}\",\"filter_name\":\"{s}\",\"category\":\"{s}\",\"listable\":{},\"rollup\":{},\"daily_rollup\":{},\"writable\":{},\"time_field\":\"{s}\",\"page_cap\":{d},\"rollup_range_days\":{d},\"description\":\"{s}\"}}", .{ t.id, t.filter_name, t.category, t.listable, t.rollup, t.daily_rollup, t.writable, t.time_field, t.page_cap, t.rollup_range_days, t.description });
        }
    }
    return try alloc.dupe(u8, "{\"error\":\"Unknown data type. Use list_data_types.\"}");
}

fn handleApiGet(auth: ?*Auth, alloc: Allocator, path: []const u8) ![]u8 {
    const a = auth orelse return alloc.dupe(u8, "{\"error\":\"GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not configured\"}");
    const url = try std.fmt.allocPrint(alloc, "{s}/{s}", .{ BASE, path });
    return apiGet(a, alloc, url) orelse try alloc.dupe(u8, "{\"error\":\"API request failed\"}");
}

fn handleListDataPoints(auth: ?*Auth, alloc: Allocator, args: ?json.Value) ![]u8 {
    const dt = getStr(args, "data_type") orelse return alloc.dupe(u8, "{\"error\":\"Missing data_type\"}");
    if (!isSegment(dt)) return alloc.dupe(u8, "{\"error\":\"Invalid data_type\"}");

    var url = try std.fmt.allocPrint(alloc, "{s}/dataTypes/{s}/dataPoints", .{ BASE, dt });
    if (getStr(args, "filter")) |filter| {
        const encoded = try urlEncode(alloc, filter);
        url = try std.fmt.allocPrint(alloc, "{s}?filter={s}", .{ url, encoded });
    }
    const a = auth orelse return alloc.dupe(u8, "{\"error\":\"GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not configured\"}");
    return apiGet(a, alloc, url) orelse try alloc.dupe(u8, "{\"error\":\"API request failed\"}");
}

fn handleGetDataPoint(auth: ?*Auth, alloc: Allocator, args: ?json.Value) ![]u8 {
    const dt = getStr(args, "data_type") orelse return alloc.dupe(u8, "{\"error\":\"Missing data_type\"}");
    const id = getStr(args, "data_point_id") orelse return alloc.dupe(u8, "{\"error\":\"Missing data_point_id\"}");
    if (!isSegment(dt) or !isSegment(id)) return alloc.dupe(u8, "{\"error\":\"Invalid data_type or data_point_id\"}");
    const path = try std.fmt.allocPrint(alloc, "dataTypes/{s}/dataPoints/{s}", .{ dt, id });
    return handleApiGet(auth, alloc, path);
}

fn handleExportTcx(auth: ?*Auth, alloc: Allocator, args: ?json.Value) ![]u8 {
    const id = getStr(args, "data_point_id") orelse return alloc.dupe(u8, "{\"error\":\"Missing data_point_id\"}");
    if (!isSegment(id)) return alloc.dupe(u8, "{\"error\":\"Invalid data_point_id\"}");
    const path = try std.fmt.allocPrint(alloc, "dataTypes/exercise/dataPoints/{s}:exportExerciseTcx?alt=media", .{id});
    return handleApiGet(auth, alloc, path);
}

fn handleAddWeight(auth: ?*Auth, alloc: Allocator, args: ?json.Value) ![]u8 {
    const kg = getNum(args, "weight_kg") orelse return alloc.dupe(u8, "{\"error\":\"Missing weight_kg\"}");
    if (kg <= 0 or kg > 500) return alloc.dupe(u8, "{\"error\":\"weight_kg must be between 0 and 500 kg\"}");
    const grams: i64 = @intFromFloat(kg * 1000 + 0.5);
    const ts = try rfc3339Now(alloc);
    const body = try std.fmt.allocPrint(alloc, "{{\"weight\":{{\"sampleTime\":{{\"physicalTime\":\"{s}\",\"utcOffset\":\"0s\"}},\"weightGrams\":{d}}}}}", .{ ts, grams });
    const url = try std.fmt.allocPrint(alloc, "{s}/dataTypes/weight/dataPoints", .{BASE});
    const a = auth orelse return alloc.dupe(u8, "{\"error\":\"GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not configured\"}");
    return apiPost(a, alloc, url, body) orelse try alloc.dupe(u8, "{\"error\":\"API request failed\"}");
}

fn getStr(args: ?json.Value, key: []const u8) ?[]const u8 {
    const a = args orelse return null;
    if (a != .object) return null;
    const v = a.object.get(key) orelse return null;
    if (v != .string) return null;
    return v.string;
}

fn getNum(args: ?json.Value, key: []const u8) ?f64 {
    const a = args orelse return null;
    if (a != .object) return null;
    const v = a.object.get(key) orelse return null;
    return switch (v) {
        .integer => |i| @floatFromInt(i),
        .float => |f| f,
        else => null,
    };
}

fn dispatchTool(auth: ?*Auth, alloc: Allocator, name: []const u8, args: ?json.Value) ![]u8 {
    const eql = std.mem.eql;
    if (eql(u8, name, "list_data_types")) return handleListDataTypes(alloc);
    if (eql(u8, name, "describe_data_type")) {
        const id = getStr(args, "data_type") orelse return alloc.dupe(u8, "{\"error\":\"Missing data_type\"}");
        return handleDescribeDataType(alloc, id);
    }
    if (eql(u8, name, "list_data_points")) return handleListDataPoints(auth, alloc, args);
    if (eql(u8, name, "get_data_point")) return handleGetDataPoint(auth, alloc, args);
    if (eql(u8, name, "get_profile")) return handleApiGet(auth, alloc, "profile");
    if (eql(u8, name, "get_settings")) return handleApiGet(auth, alloc, "settings");
    if (eql(u8, name, "get_identity")) return handleApiGet(auth, alloc, "identity");
    if (eql(u8, name, "list_paired_devices")) return handleApiGet(auth, alloc, "pairedDevices");
    if (eql(u8, name, "get_irn_profile")) return handleApiGet(auth, alloc, "irnProfile");
    if (eql(u8, name, "clear_cache")) return alloc.dupe(u8, "{\"success\":true,\"message\":\"Cache cleared\"}");
    if (eql(u8, name, "add_weight_sample")) return handleAddWeight(auth, alloc, args);
    if (eql(u8, name, "export_exercise_tcx")) return handleExportTcx(auth, alloc, args);
    if (eql(u8, name, "today") or eql(u8, name, "yesterday") or eql(u8, name, "summary")) {
        return alloc.dupe(u8, "{\"info\":\"Daily summary requires multiple parallel API calls. Use Rust/Go/Python for full implementation.\"}");
    }
    return std.fmt.allocPrint(alloc, "{{\"error\":\"Unknown tool: {s}\"}}", .{name});
}

// ─── MCP JSON-RPC handler ────────────────────────────────────────────────────

fn handleRequest(auth: ?*Auth, allocator: Allocator, line: []const u8) ![]u8 {
    const parsed = json.parseFromSlice(json.Value, allocator, line, .{}) catch {
        return try allocator.dupe(u8, "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32700,\"message\":\"Parse error\"}}");
    };
    defer parsed.deinit();

    const root = parsed.value;
    const method_val = root.object.get("method") orelse {
        return try allocator.dupe(u8, "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32600,\"message\":\"Missing method\"}}");
    };
    const method = method_val.string;
    const params = root.object.get("params");

    var id_buf: [64]u8 = undefined;
    var id_str: []const u8 = "null";
    if (root.object.get("id")) |id_val| {
        if (id_val == .integer) {
            id_str = std.fmt.bufPrint(&id_buf, "{d}", .{id_val.integer}) catch "null";
        } else if (id_val == .string) {
            id_str = std.fmt.bufPrint(&id_buf, "\"{s}\"", .{id_val.string}) catch "null";
        }
    }

    if (std.mem.eql(u8, method, "initialize")) {
        return try std.fmt.allocPrint(allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"result\":{{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{{\"tools\":{{}},\"resources\":{{}},\"prompts\":{{}}}},\"serverInfo\":{{\"name\":\"google-health-mcp\",\"version\":\"0.2.0\"}}}}}}", .{id_str});
    } else if (std.mem.eql(u8, method, "notifications/initialized")) {
        return try allocator.dupe(u8, "");
    } else if (std.mem.eql(u8, method, "tools/list")) {
        var buf: std.ArrayList(u8) = .empty;
        const prefix = try std.fmt.allocPrint(allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"result\":{{\"tools\":[", .{id_str});
        try buf.appendSlice(allocator, prefix);
        for (TOOLS, 0..) |t, i| {
            if (i > 0) try buf.appendSlice(allocator, ",");
            const entry = try std.fmt.allocPrint(allocator, "{{\"name\":\"{s}\",\"description\":\"{s}\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{}}}}}}", .{ t.name, t.description });
            try buf.appendSlice(allocator, entry);
        }
        try buf.appendSlice(allocator, "]}}");
        return buf.toOwnedSlice(allocator);
    } else if (std.mem.eql(u8, method, "tools/call")) {
        const tool_name = if (params) |p| (p.object.get("name") orelse return try errResp(allocator, id_str, "Missing tool name")).string else return try errResp(allocator, id_str, "Missing params");
        const tool_args = if (params) |p| p.object.get("arguments") else null;

        const tool_result = try dispatchTool(auth, allocator, tool_name, tool_args);

        var buf: std.ArrayList(u8) = .empty;
        const prefix = try std.fmt.allocPrint(allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"result\":{{\"content\":[{{\"type\":\"text\",\"text\":\"", .{id_str});
        try buf.appendSlice(allocator, prefix);
        for (tool_result) |c| {
            switch (c) {
                '"' => try buf.appendSlice(allocator, "\\\""),
                '\\' => try buf.appendSlice(allocator, "\\\\"),
                '\n' => try buf.appendSlice(allocator, "\\n"),
                '\r' => try buf.appendSlice(allocator, "\\r"),
                '\t' => try buf.appendSlice(allocator, "\\t"),
                else => try buf.append(allocator, c),
            }
        }
        try buf.appendSlice(allocator, "\"}]}}");
        return buf.toOwnedSlice(allocator);
    } else {
        return try std.fmt.allocPrint(allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"error\":{{\"code\":-32601,\"message\":\"Method not found\"}}}}", .{id_str});
    }
}

fn errResp(allocator: Allocator, id: []const u8, msg: []const u8) ![]u8 {
    return try std.fmt.allocPrint(allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"error\":{{\"code\":-32602,\"message\":\"{s}\"}}}}", .{ id, msg });
}

// ─── Main: stdio loop via raw POSIX ─────────────────────────────────────────

pub fn main() !void {
    const allocator = std.heap.page_allocator;

    // OAuth state — created only when all env vars present; API tools degrade
    // gracefully without it so parity checks and registry tools still work.
    var threaded: std.Io.Threaded = .init(allocator, .{});
    defer threaded.deinit();

    var auth_state: ?Auth = null;
    if (getEnv("GOOGLE_CLIENT_ID")) |cid| {
        if (getEnv("GOOGLE_CLIENT_SECRET")) |csec| {
            if (getEnv("GOOGLE_REFRESH_TOKEN")) |rtok| {
                auth_state = .{
                    .long_alloc = allocator,
                    .client = .{ .allocator = allocator, .io = threaded.io() },
                    .client_id = cid,
                    .client_secret = csec,
                    .refresh_token = rtok,
                };
            }
        }
    }
    if (auth_state == null) {
        fdWrite(2, "Warning: GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not set. API tools will not work.\n");
    }
    defer if (auth_state) |*a| a.client.deinit();

    const stdin_fd: posix.fd_t = 0;

    var line_buf: [1024 * 1024]u8 = undefined;
    var line_len: usize = 0;

    var byte_buf: [1]u8 = undefined;
    while (true) {
        const n = posix.read(stdin_fd, &byte_buf) catch break;
        if (n == 0) break; // EOF

        if (byte_buf[0] == '\n') {
            if (line_len == 0) continue;
            const line = line_buf[0..line_len];
            line_len = 0;

            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();

            const auth_ptr: ?*Auth = if (auth_state) |*a| a else null;
            const response = handleRequest(auth_ptr, arena.allocator(), line) catch continue;
            if (response.len == 0) continue;

            fdWrite(1, response);
            fdWrite(1, "\n");
        } else {
            if (line_len < line_buf.len) {
                line_buf[line_len] = byte_buf[0];
                line_len += 1;
            }
        }
    }
}
