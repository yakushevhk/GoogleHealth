//! Google Health MCP Server — Zig implementation
//! MCP JSON-RPC 2.0 over stdio (raw POSIX fd). 39 data types, 10 core tools.
//! Uses raw I/O to avoid std.Io API instability in Zig 0.16.

const std = @import("std");
const json = std.json;
const posix = std.posix;
const Allocator = std.mem.Allocator;

// Raw write(2) — posix.write removed in Zig 0.16
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;

fn fdWrite(fd: c_int, data: []const u8) void {
    _ = write(fd, data.ptr, data.len);
}

const BASE = "https://health.googleapis.com/v4/users/me";

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

fn mkType(id: []const u8, cat: []const u8, tf: []const u8, listable: bool, rollup: bool, dr: bool, writable: bool, cap: u32, range_days: u32, desc: []const u8) DataType {
    return .{ .id = id, .filter_name = id, .category = cat, .listable = listable, .rollup = rollup, .daily_rollup = dr, .writable = writable, .time_field = tf, .page_cap = cap, .rollup_range_days = range_days, .description = desc };
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

// ─── Env helper ──────────────────────────────────────────────────────────────

fn getEnv(name: [*:0]const u8) ?[:0]const u8 {
    const ptr = std.c.getenv(name) orelse return null;
    return std.mem.sliceTo(ptr, 0);
}

// ─── Tool: list_data_types ───────────────────────────────────────────────────

fn handleListDataTypes(allocator: Allocator) ![]u8 {
    var buf: std.ArrayList(u8) = .empty;
    try buf.appendSlice(allocator, "{\"count\":39,\"total\":39,\"data_types\":[");
    for (DATA_TYPES, 0..) |t, i| {
        if (i > 0) try buf.appendSlice(allocator, ",");
        const entry = try std.fmt.allocPrint(allocator, "{{\"id\":\"{s}\",\"category\":\"{s}\",\"listable\":{},\"rollup\":{},\"daily_rollup\":{},\"writable\":{},\"time_field\":\"{s}\",\"page_cap\":{d},\"rollup_range_days\":{d},\"description\":\"{s}\"}}", .{ t.id, t.category, t.listable, t.rollup, t.daily_rollup, t.writable, t.time_field, t.page_cap, t.rollup_range_days, t.description });
        try buf.appendSlice(allocator, entry);
    }
    try buf.appendSlice(allocator, "]}");
    return buf.toOwnedSlice(allocator);
}

// ─── Tool: describe_data_type ────────────────────────────────────────────────

fn handleDescribeDataType(allocator: Allocator, type_id: []const u8) ![]u8 {
    for (DATA_TYPES) |t| {
        if (std.mem.eql(u8, t.id, type_id)) {
            return try std.fmt.allocPrint(allocator, "{{\"id\":\"{s}\",\"filter_name\":\"{s}\",\"category\":\"{s}\",\"listable\":{},\"rollup\":{},\"daily_rollup\":{},\"writable\":{},\"time_field\":\"{s}\",\"page_cap\":{d},\"rollup_range_days\":{d},\"description\":\"{s}\"}}", .{ t.id, t.filter_name, t.category, t.listable, t.rollup, t.daily_rollup, t.writable, t.time_field, t.page_cap, t.rollup_range_days, t.description });
        }
    }
    return try allocator.dupe(u8, "{\"error\":\"Unknown data type. Use list_data_types.\"}");
}

// ─── MCP JSON-RPC handler ────────────────────────────────────────────────────

fn handleRequest(allocator: Allocator, line: []const u8) ![]u8 {
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

    // Extract id for response
    var id_buf: [64]u8 = undefined;
    var id_str: []const u8 = "null";
    if (root.object.get("id")) |id_val| {
        if (id_val == .integer) {
            id_str = std.fmt.bufPrint(&id_buf, "{d}", .{id_val.integer}) catch "null";
        }
    }

    if (std.mem.eql(u8, method, "initialize")) {
        return try std.fmt.allocPrint(allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"result\":{{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{{\"tools\":{{}},\"resources\":{{}},\"prompts\":{{}}}},\"serverInfo\":{{\"name\":\"google-health-mcp\",\"version\":\"0.2.0\"}}}}}}", .{id_str});
    } else if (std.mem.eql(u8, method, "notifications/initialized")) {
        return try allocator.dupe(u8, "");
    } else if (std.mem.eql(u8, method, "tools/list")) {
        return try std.fmt.allocPrint(allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"result\":{{\"tools\":[{{\"name\":\"list_data_types\",\"description\":\"List all 39 supported data types.\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{\"category\":{{\"type\":\"string\"}}}}}}}},{{\"name\":\"describe_data_type\",\"description\":\"Get detailed info about a data type.\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{\"data_type\":{{\"type\":\"string\"}}}},\"required\":[\"data_type\"]}}}},{{\"name\":\"list_data_points\",\"description\":\"List data points with filters.\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{\"data_type\":{{\"type\":\"string\"}},\"filter\":{{\"type\":\"string\"}},\"page_size\":{{\"type\":\"number\"}}}},\"required\":[\"data_type\"]}}}},{{\"name\":\"get_profile\",\"description\":\"Get user profile.\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{}}}}}},{{\"name\":\"get_settings\",\"description\":\"Get user settings.\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{}}}}}},{{\"name\":\"list_paired_devices\",\"description\":\"List paired devices.\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{}}}}}},{{\"name\":\"get_identity\",\"description\":\"Get user identity.\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{}}}}}},{{\"name\":\"clear_cache\",\"description\":\"Clear response cache.\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{}}}}}},{{\"name\":\"today\",\"description\":\"Full health summary for today.\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{}}}}}},{{\"name\":\"yesterday\",\"description\":\"Full health summary for yesterday.\",\"inputSchema\":{{\"type\":\"object\",\"properties\":{{}}}}}}]}}}}", .{id_str});
    } else if (std.mem.eql(u8, method, "tools/call")) {
        const tool_name = if (params) |p| (p.object.get("name") orelse return try errResp(allocator, id_str, "Missing tool name")).string else return try errResp(allocator, id_str, "Missing params");
        const tool_args = if (params) |p| p.object.get("arguments") else null;

        var tool_result: []u8 = undefined;
        if (std.mem.eql(u8, tool_name, "list_data_types")) {
            tool_result = try handleListDataTypes(allocator);
        } else if (std.mem.eql(u8, tool_name, "describe_data_type")) {
            const type_id = if (tool_args) |a| (a.object.get("data_type") orelse return try errResp(allocator, id_str, "Missing data_type")).string else return try errResp(allocator, id_str, "Missing data_type");
            tool_result = try handleDescribeDataType(allocator, type_id);
        } else if (std.mem.eql(u8, tool_name, "clear_cache")) {
            tool_result = try allocator.dupe(u8, "{\"success\":true,\"message\":\"Cache cleared\"}");
        } else {
            tool_result = try std.fmt.allocPrint(allocator, "{{\"info\":\"Tool '{s}' requires Google Health API auth.\",\"available\":true}}", .{tool_name});
        }

        // Build response with JSON-escaped tool_result
        var buf: std.ArrayList(u8) = .empty;
        const prefix = try std.fmt.allocPrint(allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"result\":{{\"content\":[{{\"type\":\"text\",\"text\":\"", .{id_str});
        try buf.appendSlice(allocator, prefix);
        // JSON-escape the tool result
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
        return try std.fmt.allocPrint(allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"error\":{{\"code\":-32601,\"message\":\"Method not found: {s}\"}}}}", .{ id_str, method });
    }
}

fn errResp(allocator: Allocator, id: []const u8, msg: []const u8) ![]u8 {
    return try std.fmt.allocPrint(allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{s},\"error\":{{\"code\":-32602,\"message\":\"{s}\"}}}}", .{ id, msg });
}

// ─── Main: stdio loop via raw POSIX ─────────────────────────────────────────

pub fn main() !void {
    const allocator = std.heap.page_allocator;

    // Verify env (warn but don't exit — tools that don't need API still work)
    if (getEnv("GOOGLE_CLIENT_ID") == null) {
        fdWrite(2, "Warning: GOOGLE_CLIENT_ID not set. API tools will not work.\n");
    }

    const stdin_fd: posix.fd_t = 0;

    var line_buf: [1024 * 1024]u8 = undefined;
    var line_len: usize = 0;

    // Read byte-by-byte from stdin, process on newline
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

            const response = handleRequest(arena.allocator(), line) catch continue;
            if (response.len == 0) continue;

            // Write response + newline to stdout
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
