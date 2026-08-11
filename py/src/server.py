"""MCP server entry point — stdio and HTTP modes. MCP SDK 2.0 API."""

import asyncio
import os
import sys
import json
from typing import Any

from mcp.server import MCPServer
from mcp.types import Tool as MCPTool, TextContent, CallToolResult
from mcp_types import ToolAnnotations

from .auth import AuthState
from .tools import TOOL_HANDLERS

# ─── Env ──────────────────────────────────────────────────────────────────────

def _env(key: str, fallback: str | None = None) -> str:
    v = os.environ.get(key) or fallback
    if not v:
        print(f"{key} env var required", file=sys.stderr)
        sys.exit(1)
    return v

auth = AuthState(
    _env("GOOGLE_CLIENT_ID"),
    _env("GOOGLE_CLIENT_SECRET"),
    _env("GOOGLE_REFRESH_TOKEN"),
)

# ─── Server ───────────────────────────────────────────────────────────────────

server = MCPServer(
    name="google-health-mcp",
    version="0.2.0",
    instructions=(
        "Google Health MCP server with 35 tools for reading and writing health data from Google Health API v4.\n\n"
        "Key gotchas:\n"
        "- Use dailyRollUp for steps/distance/floors totals (list returns intervals without values).\n"
        "- Missing days ≠ zero data.\n"
        "- Summary responses are cached for 120s; use clear_cache to force fresh data after writes."
    ),
)

# ─── Schema helpers ───────────────────────────────────────────────────────────

def _str(desc: str) -> dict:
    return {"type": "string", "description": desc}

def _num(desc: str) -> dict:
    return {"type": "number", "description": desc}

def _bool(desc: str) -> dict:
    return {"type": "boolean", "description": desc}

def _obj(desc: str) -> dict:
    return {"type": "object", "description": desc}

def _arr(items_type: str, desc: str) -> dict:
    return {"type": "array", "items": {"type": items_type}, "description": desc}

def _schema(properties: dict, required: list[str] | None = None) -> dict:
    s: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        s["required"] = required
    return s


# ─── Register all 35 tools with schemas ──────────────────────────────────────

TOOL_SPECS: dict[str, dict] = {
    "list_data_types": {
        "title": "List Data Types",
        "description": "List all 39 supported Google Health API v4 data types with their categories, supported operations, and key fields. Use this to discover what data is available before calling other tools.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "category": _str("Optional category filter (activity, cardiac, body, sleep, nutrition, respiratory, oxygen, temperature, clinical)"),
        }),
    },
    "describe_data_type": {
        "title": "Describe Data Type",
        "description": "Get detailed information about a specific data type: supported operations, filter syntax, page limits, rollup range, key response fields, and gotchas.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "data_type": _str('Data type ID (kebab-case, e.g. "heart-rate", "daily-resting-heart-rate")'),
        }, required=["data_type"]),
    },
    "list_data_points": {
        "title": "List Data Points",
        "description": (
            "List data points for any Google Health data type. Filter syntax depends on record type: "
            "Interval types use '{type}.interval.start_time >= \"RFC3339\" AND {type}.interval.start_time < \"RFC3339\"'; "
            "Sample types use '{type}.sample_time.physical_time >= \"RFC3339\"'; "
            "Daily types use '{type}.date >= \"YYYY-MM-DD\"'; "
            "Sleep uses 'sleep.interval.end_time'; "
            "Exercise/hydration-log/nutrition-log/irregular-rhythm-notification use '{type}.interval.civil_start_time >= \"YYYY-MM-DD\"'; "
            "ECG uses 'electrocardiogram.interval.start_time >= \"RFC3339\"' (only >=). "
            "In filters use snake_case (heart_rate), in data_type use kebab-case (heart-rate). "
            "Types without list support: floors, calories-in-heart-rate-zone, total-calories (use rollup instead). "
            "food and food-measurement-unit do not support filters. "
            "TIP: Use list_data_types to discover available types. "
            "Use dailyRollUp for steps/distance/floors totals (list returns intervals without values)."
        ),
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "data_type": _str(
                "Data type ID (kebab-case): steps, sleep, heart-rate, active-energy-burned, oxygen-saturation, distance, "
                "exercise, weight, height, body-fat, blood-glucose, core-body-temperature, heart-rate-variability, "
                "daily-resting-heart-rate, daily-heart-rate-variability, daily-heart-rate-zones, daily-oxygen-saturation, "
                "daily-respiratory-rate, daily-sleep-temperature-derivations, daily-vo2-max, vo2-max, run-vo2-max, "
                "active-minutes, active-zone-minutes, activity-level, altitude, electrocardiogram, food, "
                "food-measurement-unit, hydration-log, irregular-rhythm-notification, nutrition-log, "
                "respiratory-rate-sleep-summary, sedentary-period, swim-lengths-data, time-in-heart-rate-zone"
            ),
            "filter": _str("Filter expression (AIP-160 syntax). Leave empty for types that don't support filters (food, food-measurement-unit). If provided, overrides any auto-built filter from start_time/end_time."),
            "start_time": _str("Optional start time (RFC3339 or YYYY-MM-DD). If provided with end_time, builds the filter automatically."),
            "end_time": _str("Optional end time (RFC3339 or YYYY-MM-DD). Used with start_time."),
            "page_size": _num("Page size (default 1440, max 10000; exercise/sleep max 25)"),
            "page_token": _str("Page token for pagination"),
            "raw": _bool("If true, return the full raw API response. Default false returns simplified output (strips dataSource/createTime/updateTime and empty objects from each point)."),
        }, required=["data_type"]),
    },
    "get_data_point": {
        "title": "Get Data Point",
        "description": "Get a single data point by its ID.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "data_type": _str("Data type ID (kebab-case)"),
            "data_point_id": _str("Data point ID (from the name field of a listed data point)"),
            "raw": _bool("If true, return the full raw API response. Default false returns simplified output."),
        }, required=["data_type", "data_point_id"]),
    },
    "reconcile_data_points": {
        "title": "Reconcile Data Points",
        "description": "Reconcile (deduplicate/merge) data points for a data type. Same filter syntax as list. Supports dataSourceFamily filter. This is a read-only operation (GET request).",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "data_type": _str("Data type ID (kebab-case)"),
            "filter": _str("Filter expression (same syntax as list)"),
            "page_size": _num("Page size"),
            "page_token": _str("Page token"),
            "data_source_family": _str("Data source family: users/me/dataSourceFamilies/all-sources (default), users/me/dataSourceFamilies/google-wearables, users/me/dataSourceFamilies/google-sources"),
            "raw": _bool("If true, return the full raw API response. Default false returns simplified output."),
        }, required=["data_type"]),
    },
    "sync_data_points": {
        "title": "Sync Data Points (Incremental Sync)",
        "description": "Perform incremental synchronization (Delta Sync) for a data type using the reconcile endpoint. Automatically builds time filter for data created or updated after `since_time`. This is a read-only operation.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "data_type": _str("Data type ID (kebab-case), e.g. steps, heart-rate, sleep, weight"),
            "since_time": _str("Start timestamp for incremental sync (RFC3339, e.g. 2026-07-26T00:00:00Z or YYYY-MM-DD for daily types)"),
            "until_time": _str("Optional end timestamp for sync window (RFC3339 or YYYY-MM-DD)"),
            "page_size": _num("Page size for pagination"),
            "page_token": _str("Page token for pagination"),
            "data_source_family": _str("Data source family filter (optional)"),
            "raw": _bool("If true, return the full raw API response. Default false returns simplified output."),
        }, required=["data_type", "since_time"]),
    },
    "rollup_data_points": {
        "title": "RollUp Data Points",
        "description": "Aggregate data points into time buckets. Body: range (Interval with startTime/endTime RFC3339), windowSize (duration e.g. '3600s', '86400s'). Max range: 14 days for heart-rate/active-minutes/total-calories/calories-in-heart-rate-zone, 90 days for others. Response field: rollupDataPoints. Note: heart-rate, active-minutes, total-calories, calories-in-heart-rate-zone have a 14-day range limit.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "data_type": _str(
                "Data type ID (kebab-case): steps, heart-rate, active-energy-burned, distance, weight, altitude, body-fat, "
                "floors, total-calories, active-zone-minutes, sedentary-period, run-vo2-max, calories-in-heart-rate-zone, "
                "activity-level, nutrition-log, hydration-log, time-in-heart-rate-zone, active-minutes, swim-lengths-data, "
                "core-body-temperature, blood-glucose"
            ),
            "start_time": _str("Range start time (RFC3339, e.g. 2026-07-15T00:00:00Z)"),
            "end_time": _str("Range end time (RFC3339, e.g. 2026-07-22T00:00:00Z)"),
            "window_size": _str("Window size as duration string (e.g. 3600s for hourly, 86400s for daily)"),
            "page_size": _num("Page size (default 1440, max 10000)"),
            "page_token": _str("Page token"),
            "data_source_family": _str("Data source family (optional)"),
            "raw": _bool("If true, return the full raw API response. Default false returns simplified output."),
        }, required=["data_type", "start_time", "end_time", "window_size"]),
    },
    "daily_rollup_data_points": {
        "title": "Daily RollUp Data Points",
        "description": "Aggregate data points into daily buckets using civil (local) time. Range uses date objects: start/end with year/month/day. Response field: rollupDataPoints with civilStartTime/civilEndTime. Note: heart-rate, active-minutes, total-calories, calories-in-heart-rate-zone have a 14-day range limit.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "data_type": _str("Data type ID (kebab-case): same as rollup"),
            "start_date": _str("Start date (YYYY-MM-DD)"),
            "end_date": _str("End date (YYYY-MM-DD, exclusive)"),
            "window_size_days": _num("Window size in days (default 1)"),
            "page_size": _num("Page size"),
            "page_token": _str("Page token"),
            "data_source_family": _str("Data source family (optional)"),
            "raw": _bool("If true, return the full raw API response. Default false returns simplified output."),
        }, required=["data_type", "start_date", "end_date"]),
    },
    "create_data_point": {
        "title": "Create Data Point",
        "description": 'Create a new data point. Supported types: sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log. Provide the DataPoint body as a JSON object. Example for weight: {"weight":{"sampleTime":{"physicalTime":"2026-07-22T08:00:00Z","utcOffset":"0s"},"weightGrams":70000}}',
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
        "inputSchema": _schema({
            "data_type": _str("Data type ID (kebab-case): sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log"),
            "body": _obj("The DataPoint body as JSON"),
            "dry_run": _bool("If true, show the API request that would be made without executing it."),
        }, required=["data_type", "body"]),
    },
    "add_weight_sample": {
        "title": "Add Weight Sample",
        "description": "Add a weight measurement in kg.",
        "annotations": {"readOnlyHint": False},
        "inputSchema": _schema({
            "weight_kg": _num("Weight in kilograms (e.g. 70.0)"),
            "timestamp": _str("Timestamp in RFC3339 format (defaults to current time if omitted)"),
            "utc_offset": _str('UTC offset string (e.g. "0s", "3600s"). Default "0s".'),
            "dry_run": _bool("If true, show the API request that would be made without executing it."),
        }, required=["weight_kg"]),
    },
    "add_hydration_log": {
        "title": "Add Hydration Log",
        "description": "Log a hydration event (time of drinking). Note: Google Health API v4 does not support recording volume.",
        "annotations": {"readOnlyHint": False},
        "inputSchema": _schema({
            "start_time": _str("Start timestamp in RFC3339 format (defaults to current time)"),
            "end_time": _str("End timestamp in RFC3339 format (defaults to start_time)"),
            "utc_offset": _str('UTC offset string (e.g. "0s", "3600s"). Default "0s".'),
            "dry_run": _bool("If true, show the API request that would be made without executing it."),
        }),
    },
    "add_sleep_session": {
        "title": "Add Sleep Session",
        "description": "Log a sleep session specifying start and end times. The API does not support titles/notes on sleep sessions.",
        "annotations": {"readOnlyHint": False},
        "inputSchema": _schema({
            "start_time": _str("Start timestamp in RFC3339 format (e.g. 2026-07-25T23:00:00Z)"),
            "end_time": _str("End timestamp in RFC3339 format (e.g. 2026-07-26T07:00:00Z)"),
            "utc_offset": _str('UTC offset string (e.g. "0s", "3600s"). Default "0s".'),
            "dry_run": _bool("If true, show the API request without executing it."),
        }, required=["start_time", "end_time"]),
    },
    "add_exercise_session": {
        "title": "Add Exercise Session",
        "description": "Log an exercise session (workout). Exercise types: RUNNING, WALKING, CYCLING, STRENGTH_TRAINING, SWIMMING, YOGA, TREADMILL, HIIT, etc. The API does not support titles/notes on exercise sessions.",
        "annotations": {"readOnlyHint": False},
        "inputSchema": _schema({
            "exercise_type": _str("Exercise type (e.g. RUNNING, WALKING, CYCLING, STRENGTH_TRAINING, SWIMMING)"),
            "start_time": _str("Start timestamp in RFC3339 format (e.g. 2026-07-26T10:00:00Z)"),
            "end_time": _str("End timestamp in RFC3339 format (e.g. 2026-07-26T10:30:00Z)"),
            "utc_offset": _str('UTC offset string (e.g. "0s", "3600s"). Default "0s".'),
            "dry_run": _bool("If true, show the API request without executing it."),
        }, required=["exercise_type", "start_time", "end_time"]),
    },
    "add_nutrition_log": {
        "title": "Add Nutrition Log",
        "description": "Log a meal by type and time. The API only supports mealType and interval; nutrient details and food names are not supported.",
        "annotations": {"readOnlyHint": False},
        "inputSchema": _schema({
            "meal_type": _str("Meal type: BREAKFAST, LUNCH, DINNER, SNACK"),
            "start_time": _str("Start timestamp in RFC3339 format (defaults to current time)"),
            "end_time": _str("End timestamp in RFC3339 format (defaults to start_time + 30min)"),
            "utc_offset": _str('UTC offset string (e.g. "0s", "3600s"). Default "0s".'),
            "dry_run": _bool("If true, show the API request without executing it."),
        }, required=["meal_type"]),
    },
    "patch_data_point": {
        "title": "Patch Data Point",
        "description": "Update an existing data point. Provide data type, data point ID, and the fields to update as a JSON object.",
        "annotations": {"readOnlyHint": False, "destructiveHint": False},
        "inputSchema": _schema({
            "data_type": _str("Data type ID (kebab-case)"),
            "data_point_id": _str("Data point ID"),
            "body": _obj("Fields to update as JSON (DataPoint structure)"),
        }, required=["data_type", "data_point_id", "body"]),
    },
    "delete_data_point": {
        "title": "Delete Data Point",
        "description": "Delete a single data point by its data type and data point ID.",
        "annotations": {"readOnlyHint": False, "destructiveHint": True},
        "inputSchema": _schema({
            "data_type": _str("Data type ID (kebab-case)"),
            "data_point_id": _str("Data point ID (from listed data point name or ID)"),
        }, required=["data_type", "data_point_id"]),
    },
    "batch_delete_data_points": {
        "title": "Batch Delete Data Points",
        "description": "Delete multiple data points by their full resource names. Max 10000 per request. Supported types: sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log.",
        "annotations": {"readOnlyHint": False, "destructiveHint": True},
        "inputSchema": _schema({
            "data_type": _str("Data type ID (kebab-case), or '-' for cross-type delete"),
            "names": _arr("string", 'List of full resource names to delete (e.g. ["users/me/dataTypes/weight/dataPoints/123456"])'),
        }, required=["data_type", "names"]),
    },
    "delete_by_filter": {
        "title": "Delete Data Points by Filter",
        "description": "Delete all data points matching a filter. Use with caution - this is destructive.",
        "annotations": {"readOnlyHint": False, "destructiveHint": True},
        "inputSchema": _schema({
            "data_type": _str("Data type (kebab-case)"),
            "filter": _str("AIP-160 filter expression"),
            "max_count": _num("Maximum number of points to delete (default 100, max 10000)"),
        }, required=["data_type", "filter"]),
    },
    "export_exercise_tcx": {
        "title": "Export Exercise TCX",
        "description": "Export an exercise data point as TCX (Training Center XML). Requires both activity_and_fitness.readonly and location.readonly scopes. Add ?alt=media for raw TCX download.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "data_point_id": _str("Data point ID of the exercise (numeric)"),
            "partial_data": _bool("Include partial data when GPS unavailable (default false)"),
        }, required=["data_point_id"]),
    },
    "compare_health_periods": {
        "title": "Compare Health Periods",
        "description": "Compare health metrics (steps, active calories, etc.) between two date ranges (Period A vs Period B).",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "period_a_start": _str("Start date for Period A (YYYY-MM-DD)"),
            "period_a_end": _str("End date for Period A (YYYY-MM-DD)"),
            "period_b_start": _str("Start date for Period B (YYYY-MM-DD)"),
            "period_b_end": _str("End date for Period B (YYYY-MM-DD)"),
        }, required=["period_a_start", "period_a_end", "period_b_start", "period_b_end"]),
    },
    "get_hrv_recovery_trend": {
        "title": "Get HRV & Recovery Trend",
        "description": "Analyze HRV (Heart Rate Variability) and resting heart rate trends over past N days to evaluate physical recovery status.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "days": _num("Number of past days to analyze (default 14, max 90)"),
            "end_date": _str("End date (YYYY-MM-DD, defaults to today)"),
        }),
    },
    "get_temperature_summary": {
        "title": "Get Temperature Summary",
        "description": "Get core body temperature and daily sleep temperature derivations for a period.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "start_date": _str("Start date (YYYY-MM-DD)"),
            "end_date": _str("End date (YYYY-MM-DD)"),
        }, required=["start_date", "end_date"]),
    },
    "clear_cache": {
        "title": "Clear Response Cache",
        "description": "Clear in-memory response cache to force fresh live API fetches on subsequent queries.",
        "annotations": {"readOnlyHint": False},
        "inputSchema": _schema({}),
    },
    "summary": {
        "title": "Daily Summary",
        "description": "Full health summary for any date: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, VO2max, nutrition, hydration, sedentary periods, activity levels. `today` and `yesterday` are shortcuts for this tool. Per-metric fetch failures, if any, are listed in `_errors`.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "date": _str("Date in YYYY-MM-DD format. Defaults to today (server local time) if omitted."),
        }),
    },
    "today": {
        "title": "Today Summary",
        "description": "Get a full health summary for today: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, sedentary periods.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({}),
    },
    "yesterday": {
        "title": "Yesterday Summary",
        "description": "Get a full health summary for yesterday: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, sedentary periods.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({}),
    },
    "get_trends": {
        "title": "Get Health Trends",
        "description": "Get daily time series for a health metric over a date range. Returns per-day aggregated values. Only works with dailyRollUp-compatible types. Use list_data_types to check.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "data_type": _str("Data type (e.g. steps, heart-rate, active-energy-burned, distance, floors)"),
            "start_date": _str("Start date (YYYY-MM-DD)"),
            "end_date": _str("End date (YYYY-MM-DD)"),
        }, required=["data_type", "start_date", "end_date"]),
    },
    "get_profile": {
        "title": "Get Profile",
        "description": "Get the user's Google Health profile (name, birthdate, gender, etc).",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({}),
    },
    "update_profile": {
        "title": "Update Profile",
        "description": "Update the user's Google Health profile fields. Provide fields as a JSON object.",
        "annotations": {"readOnlyHint": False},
        "inputSchema": _schema({
            "body": _obj("Profile fields to update as JSON"),
        }, required=["body"]),
    },
    "get_settings": {
        "title": "Get Settings",
        "description": "Get the user's Google Health settings (units, preferences).",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({}),
    },
    "update_settings": {
        "title": "Update Settings",
        "description": "Update the user's Google Health settings. Provide fields as a JSON object.",
        "annotations": {"readOnlyHint": False},
        "inputSchema": _schema({
            "body": _obj("Settings fields to update as JSON"),
        }, required=["body"]),
    },
    "get_identity": {
        "title": "Get Identity",
        "description": "Get the user's Google Health identity information.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({}),
    },
    "get_irn_profile": {
        "title": "Get IRN Profile",
        "description": "Get the user's Irregular Rhythm Notification profile.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({}),
    },
    "list_paired_devices": {
        "title": "List Paired Devices",
        "description": "List all devices paired with the user's Google Health account.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({}),
    },
    "get_paired_device": {
        "title": "Get Paired Device",
        "description": "Get details of a specific paired device.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": _schema({
            "device_id": _str("Device ID"),
        }, required=["device_id"]),
    },
}

# Register tools: use a no-arg stub so the SDK doesn't error, then patch
# the Tool object's parameters/description/title/annotations with correct values.
for name in TOOL_HANDLERS:
    spec = TOOL_SPECS.get(name, {})
    desc = spec.get("description", name)

    async def _noop() -> str:
        return "{}"
    _noop.__name__ = name
    _noop.__doc__ = desc
    server.add_tool(_noop, name=name, description=desc)

    # Patch the registered Tool object with correct schema and metadata
    tool_obj = server._tool_manager._tools.get(name)
    if tool_obj is not None and spec:
        tool_obj.parameters = spec.get("inputSchema", {"type": "object", "properties": {}})
        tool_obj.description = desc
        if "title" in spec:
            tool_obj.title = spec["title"]
        if "annotations" in spec:
            ann = spec["annotations"]
            tool_obj.annotations = ToolAnnotations(
                read_only_hint=ann.get("readOnlyHint"),
                destructive_hint=ann.get("destructiveHint"),
            )


# ─── Structured error recovery ───────────────────────────────────────────────

def _api_err(msg: str) -> dict:
    """Classify an upstream API error and attach scenario-specific next_steps."""
    lower = msg.lower()
    if "HTTP 403" in msg or "forbidden" in lower or "permission" in lower:
        return {"error": msg, "next_steps": [
            "Check OAuth scopes include the required permission",
            "Run oauth_health.py to re-authorize",
        ]}
    if "filter" in lower:
        return {"error": msg, "next_steps": [
            "Call describe_data_type for the correct filter syntax",
            "Use start_time/end_time params instead of manual filter",
        ]}
    if "HTTP 404" in msg or "not found" in lower:
        return {"error": msg, "next_steps": [
            "Call list_data_types to see all 39 supported types",
            "Check the type ID is kebab-case (e.g. heart-rate, not heartRate)",
        ]}
    if "HTTP 400" in msg:
        return {"error": msg, "next_steps": [
            "Check the request body format",
            "Call describe_data_type for field names",
        ]}
    return {"error": msg}


# Override call_tool to dispatch to our actual handlers
async def _call_tool(name: str, arguments: dict | None = None, context=None):
    handler = TOOL_HANDLERS.get(name)
    if not handler:
        return CallToolResult(content=[TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))], isError=True)
    try:
        result = await handler(auth, arguments or {})
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(result, indent=2, default=str))])
    except Exception as e:
        err_body = _api_err(str(e))
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(err_body, indent=2))], isError=True)

server.call_tool = _call_tool


# ─── Resources ────────────────────────────────────────────────────────────────

@server.resource("health://profile", name="Health Profile", description="Google Health user profile (name, birth date, gender)", mime_type="application/json")
async def resource_profile() -> str:
    return json.dumps(await auth.api_get("https://health.googleapis.com/v4/users/me/profile"), indent=2)

@server.resource("health://settings", name="Health Settings", description="Google Health settings (units, preferences)", mime_type="application/json")
async def resource_settings() -> str:
    return json.dumps(await auth.api_get("https://health.googleapis.com/v4/users/me/settings"), indent=2)

@server.resource("health://devices", name="Paired Devices", description="Devices paired with the Google Health account", mime_type="application/json")
async def resource_devices() -> str:
    return json.dumps(await auth.api_get("https://health.googleapis.com/v4/users/me/pairedDevices"), indent=2)

@server.resource("health://summary/{date}", name="Daily Summary", description="Full daily health summary for a date (YYYY-MM-DD)", mime_type="application/json")
async def resource_summary(date: str) -> str:
    from datetime import date as date_cls
    from .tools import build_daily_summary
    d = date_cls.fromisoformat(date)
    summary = await build_daily_summary(auth, d)
    return json.dumps(summary, indent=2, default=str)


# ─── Prompts ──────────────────────────────────────────────────────────────────

@server.prompt(name="health_weekly_review", description="Comprehensive 7-day health, sleep, and workout review")
def prompt_weekly_review(end_date: str = "today") -> str:
    return (
        f"Please review my health data up to {end_date}. Use `summary` for the past 7 days to evaluate step trends, "
        "sleep duration/stages, resting heart rate, active calories, and overall recovery. "
        "Highlight any key trends or anomalies.\n\n"
        "Additional analysis to include:\n"
        "- Evaluate sleep stage distribution (deep/REM percentages, sleep efficiency)\n"
        "- Analyze HR zone breakdown across activities\n"
        "- Check temperature anomalies from daily-sleep-temperature-derivations\n"
        "- Review respiratory rate trends from daily-respiratory-rate"
    )

@server.prompt(name="sleep_quality_analysis", description="Detailed sleep stages, HRV, and recovery analysis")
def prompt_sleep_quality(days: str = "7") -> str:
    return (
        f"Please analyze my sleep quality for the past {days} days. Use `sync_data_points` or `list_data_points` for "
        "`sleep`, `heart-rate-variability`, and `daily-resting-heart-rate`. Detail my sleep efficiency, "
        "deep/REM sleep percentages, and HRV trends.\n\n"
        "Additional analysis to include:\n"
        "- Analyze sleep efficiency (minutesAsleep / minutesInSleepPeriod)\n"
        "- Evaluate deep+REM ratio (normal: 20-40%)\n"
        "- Check per-stage respiratory rate from respiratory-rate-sleep-summary (deep/light/REM breathing rates)\n"
        "- Correlate HRV with sleep stages"
    )

@server.prompt(name="workout_summary", description="Exercise sessions and heart rate zone breakdown")
def prompt_workout_summary(days: str = "7") -> str:
    return (
        f"Please compile a summary of my workouts over the past {days} days. Use `list_data_points` for `exercise`, "
        "`active-zone-minutes`, and `calories-in-heart-rate-zone`. Show workout types, total durations, "
        "calories burned, and intensity zones.\n\n"
        "Additional analysis to include:\n"
        "- Analyze heart rate zone durations per workout (lightTime/moderateTime/vigorousTime/peakTime)\n"
        "- Track active zone minutes across sessions\n"
        "- Compare pace and heart rate trends over time"
    )


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    if "--http" in sys.argv:
        asyncio.run(server.run_streamable_http_async(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "3000"))))
    else:
        asyncio.run(server.run_stdio_async())


if __name__ == "__main__":
    main()
