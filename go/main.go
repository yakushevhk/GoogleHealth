package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/joho/godotenv"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// authKey is the context key for passing AuthState to tool handlers.
type authKey struct{}

func main() {
	_ = godotenv.Load()

	clientID := requireEnv("GOOGLE_CLIENT_ID")
	clientSecret := requireEnv("GOOGLE_CLIENT_SECRET")
	refreshToken := requireEnv("GOOGLE_REFRESH_TOKEN")

	auth := NewAuthState(clientID, clientSecret, refreshToken)

	httpMode := false
	for _, arg := range os.Args[1:] {
		if arg == "--http" {
			httpMode = true
			break
		}
	}

	s := server.NewMCPServer(
		"google-health-mcp",
		"0.2.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(false, false),
		server.WithPromptCapabilities(true),
		server.WithInstructions(serverInstructions),
	)

	// Wrap handlers to inject AuthState into context.
	withAuth := func(fn func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error)) func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			ctx = context.WithValue(ctx, authKey{}, auth)
			return fn(ctx, req)
		}
	}

	// ─── Register all 35 tools ───────────────────────────────────────────────

	registerTools(s, withAuth)

	// ─── Register resources ──────────────────────────────────────────────────

	registerResources(s, auth)

	// ─── Register prompts ────────────────────────────────────────────────────

	registerPrompts(s)

	// ─── Start server ────────────────────────────────────────────────────────

	if httpMode {
		host := envOr("HOST", "127.0.0.1")
		port := envOr("PORT", "3000")
		apiKey := envOr("MCP_API_KEY", "change-me")

		fmt.Fprintf(os.Stderr, "Starting HTTP/SSE server on %s:%s\n", host, port)

		// Wrap with API key auth middleware.
		httpServer := server.NewStreamableHTTPServer(s)
		handler := apiKeyMiddleware(httpServer, apiKey)

		addr := fmt.Sprintf("%s:%s", host, port)
		if err := http.ListenAndServe(addr, handler); err != nil {
			fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
			os.Exit(1)
		}
	} else {
		stdioServer := server.NewStdioServer(s)
		if err := stdioServer.Listen(context.Background(), os.Stdin, os.Stdout); err != nil {
			fmt.Fprintf(os.Stderr, "Stdio server error: %v\n", err)
			os.Exit(1)
		}
	}
}

// ─── Tool registration ───────────────────────────────────────────────────────

func registerTools(s *server.MCPServer, withAuth func(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error)) func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error)) {

	// Discovery / registry
	s.AddTool(mcp.NewTool("list_data_types",
		mcp.WithDescription("List all 39 supported Google Health API v4 data types with their categories, supported operations, and key fields. Use this to discover what data is available before calling other tools."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("category", mcp.Description("Optional category filter (activity, cardiac, body, sleep, nutrition, respiratory, oxygen, temperature, clinical)")),
	), withAuth(listDataTypesHandler))

	s.AddTool(mcp.NewTool("describe_data_type",
		mcp.WithDescription("Get detailed information about a specific data type: supported operations, filter syntax, page limits, rollup range, key response fields, and gotchas."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case, e.g. \"heart-rate\", \"daily-resting-heart-rate\")")),
	), withAuth(describeDataTypeHandler))

	// Data & sync
	s.AddTool(mcp.NewTool("list_data_points",
		mcp.WithDescription("List data points for any Google Health data type. Filter syntax depends on record type: Interval types use '{type}.interval.start_time >= \"RFC3339\" AND {type}.interval.start_time < \"RFC3339\"'; Sample types use '{type}.sample_time.physical_time >= \"RFC3339\"'; Daily types use '{type}.date >= \"YYYY-MM-DD\"'; Sleep uses 'sleep.interval.end_time'; Exercise/hydration-log/nutrition-log/irregular-rhythm-notification use '{type}.interval.civil_start_time >= \"YYYY-MM-DD\"'; ECG uses 'electrocardiogram.interval.start_time >= \"RFC3339\"' (only >=). In filters use snake_case (heart_rate), in data_type use kebab-case (heart-rate). Types without list support: floors, calories-in-heart-rate-zone, total-calories (use rollup instead). food and food-measurement-unit do not support filters. TIP: Use list_data_types to discover available types. Use dailyRollUp for steps/distance/floors totals (list returns intervals without values)."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case): steps, sleep, heart-rate, active-energy-burned, oxygen-saturation, distance, exercise, weight, height, body-fat, blood-glucose, core-body-temperature, heart-rate-variability, daily-resting-heart-rate, daily-heart-rate-variability, daily-heart-rate-zones, daily-oxygen-saturation, daily-respiratory-rate, daily-sleep-temperature-derivations, daily-vo2-max, vo2-max, run-vo2-max, active-minutes, active-zone-minutes, activity-level, altitude, electrocardiogram, food, food-measurement-unit, hydration-log, irregular-rhythm-notification, nutrition-log, respiratory-rate-sleep-summary, sedentary-period, swim-lengths-data, time-in-heart-rate-zone")),
		mcp.WithString("filter", mcp.Description("Filter expression (AIP-160 syntax). Leave empty for types that don't support filters (food, food-measurement-unit). If provided, overrides any auto-built filter from start_time/end_time.")),
		mcp.WithString("start_time", mcp.Description("Optional start time (RFC3339 or YYYY-MM-DD). If provided with end_time, builds the filter automatically.")),
		mcp.WithString("end_time", mcp.Description("Optional end time (RFC3339 or YYYY-MM-DD). Used with start_time.")),
		mcp.WithNumber("page_size", mcp.Description("Page size (default 1440, max 10000; exercise/sleep max 25)")),
		mcp.WithString("page_token", mcp.Description("Page token for pagination")),
		mcp.WithBoolean("raw", mcp.Description("If true, return the full raw API response. Default false returns simplified output (strips dataSource/createTime/updateTime and empty objects from each point).")),
	), withAuth(listDataPointsHandler))

	s.AddTool(mcp.NewTool("get_data_point",
		mcp.WithDescription("Get a single data point by its ID."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case)")),
		mcp.WithString("data_point_id", mcp.Required(), mcp.Description("Data point ID (from the name field of a listed data point)")),
		mcp.WithBoolean("raw", mcp.Description("If true, return the full raw API response. Default false returns simplified output.")),
	), withAuth(getDataPointHandler))

	s.AddTool(mcp.NewTool("reconcile_data_points",
		mcp.WithDescription("Reconcile (deduplicate/merge) data points for a data type. Same filter syntax as list. Supports dataSourceFamily filter. This is a read-only operation (GET request)."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case)")),
		mcp.WithString("filter", mcp.Description("Filter expression (same syntax as list)")),
		mcp.WithNumber("page_size", mcp.Description("Page size")),
		mcp.WithString("page_token", mcp.Description("Page token")),
		mcp.WithString("data_source_family", mcp.Description("Data source family: users/me/dataSourceFamilies/all-sources (default), users/me/dataSourceFamilies/google-wearables, users/me/dataSourceFamilies/google-sources")),
		mcp.WithBoolean("raw", mcp.Description("If true, return the full raw API response. Default false returns simplified output.")),
	), withAuth(reconcileDataPointsHandler))

	s.AddTool(mcp.NewTool("sync_data_points",
		mcp.WithDescription("Perform incremental synchronization (Delta Sync) for a data type using the reconcile endpoint. Automatically builds time filter for data created or updated after `since_time`. This is a read-only operation."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case), e.g. steps, heart-rate, sleep, weight")),
		mcp.WithString("since_time", mcp.Required(), mcp.Description("Start timestamp for incremental sync (RFC3339, e.g. 2026-07-26T00:00:00Z or YYYY-MM-DD for daily types)")),
		mcp.WithString("until_time", mcp.Description("Optional end timestamp for sync window (RFC3339 or YYYY-MM-DD)")),
		mcp.WithNumber("page_size", mcp.Description("Page size for pagination")),
		mcp.WithString("page_token", mcp.Description("Page token for pagination")),
		mcp.WithString("data_source_family", mcp.Description("Data source family filter (optional)")),
		mcp.WithBoolean("raw", mcp.Description("If true, return the full raw API response. Default false returns simplified output.")),
	), withAuth(syncDataPointsHandler))

	s.AddTool(mcp.NewTool("rollup_data_points",
		mcp.WithDescription("Aggregate data points into time buckets. Body: range (Interval with startTime/endTime RFC3339), windowSize (duration e.g. '3600s', '86400s'). Max range: 14 days for heart-rate/active-minutes/total-calories/calories-in-heart-rate-zone, 90 days for others. Response field: rollupDataPoints. Note: heart-rate, active-minutes, total-calories, calories-in-heart-rate-zone have a 14-day range limit."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case): steps, heart-rate, active-energy-burned, distance, weight, altitude, body-fat, floors, total-calories, active-zone-minutes, sedentary-period, run-vo2-max, calories-in-heart-rate-zone, activity-level, nutrition-log, hydration-log, time-in-heart-rate-zone, active-minutes, swim-lengths-data, core-body-temperature, blood-glucose")),
		mcp.WithString("start_time", mcp.Required(), mcp.Description("Range start time (RFC3339, e.g. 2026-07-15T00:00:00Z)")),
		mcp.WithString("end_time", mcp.Required(), mcp.Description("Range end time (RFC3339, e.g. 2026-07-22T00:00:00Z)")),
		mcp.WithString("window_size", mcp.Required(), mcp.Description("Window size as duration string (e.g. 3600s for hourly, 86400s for daily)")),
		mcp.WithNumber("page_size", mcp.Description("Page size (default 1440, max 10000)")),
		mcp.WithString("page_token", mcp.Description("Page token")),
		mcp.WithString("data_source_family", mcp.Description("Data source family (optional)")),
		mcp.WithBoolean("raw", mcp.Description("If true, return the full raw API response. Default false returns simplified output.")),
	), withAuth(rollUpDataPointsHandler))

	s.AddTool(mcp.NewTool("daily_rollup_data_points",
		mcp.WithDescription("Aggregate data points into daily buckets using civil (local) time. Range uses date objects: start/end with year/month/day. Response field: rollupDataPoints with civilStartTime/civilEndTime. Note: heart-rate, active-minutes, total-calories, calories-in-heart-rate-zone have a 14-day range limit."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case): same as rollup")),
		mcp.WithString("start_date", mcp.Required(), mcp.Description("Start date (YYYY-MM-DD)")),
		mcp.WithString("end_date", mcp.Required(), mcp.Description("End date (YYYY-MM-DD, exclusive)")),
		mcp.WithNumber("window_size_days", mcp.Description("Window size in days (default 1)")),
		mcp.WithNumber("page_size", mcp.Description("Page size")),
		mcp.WithString("page_token", mcp.Description("Page token")),
		mcp.WithString("data_source_family", mcp.Description("Data source family (optional)")),
		mcp.WithBoolean("raw", mcp.Description("If true, return the full raw API response. Default false returns simplified output.")),
	), withAuth(dailyRollUpDataPointsHandler))

	// Write & delete
	s.AddTool(mcp.NewTool("create_data_point",
		mcp.WithDescription("Create a new data point. Supported types: sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log. Provide the DataPoint body as a JSON object. Example for weight: {\"weight\":{\"sampleTime\":{\"physicalTime\":\"2026-07-22T08:00:00Z\",\"utcOffset\":\"0s\"},\"weightGrams\":70000}}"),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case): sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log")),
		mcp.WithObject("body", mcp.Required(), mcp.Description("The DataPoint body as JSON")),
		mcp.WithBoolean("dry_run", mcp.Description("If true, show the API request that would be made without executing it.")),
	), withAuth(createDataPointHandler))

	s.AddTool(mcp.NewTool("add_weight_sample",
		mcp.WithDescription("Add a weight measurement in kg."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithNumber("weight_kg", mcp.Required(), mcp.Description("Weight in kilograms (e.g. 70.0)")),
		mcp.WithString("timestamp", mcp.Description("Timestamp in RFC3339 format (defaults to current time if omitted)")),
		mcp.WithString("utc_offset", mcp.Description("UTC offset string (e.g. \"0s\", \"3600s\"). Default \"0s\".")),
		mcp.WithBoolean("dry_run", mcp.Description("If true, show the API request that would be made without executing it.")),
	), withAuth(addWeightSampleHandler))

	s.AddTool(mcp.NewTool("add_hydration_log",
		mcp.WithDescription("Log a hydration event (time of drinking). Note: Google Health API v4 does not support recording volume."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithString("start_time", mcp.Description("Start timestamp in RFC3339 format (defaults to current time)")),
		mcp.WithString("end_time", mcp.Description("End timestamp in RFC3339 format (defaults to start_time)")),
		mcp.WithString("utc_offset", mcp.Description("UTC offset string (e.g. \"0s\", \"3600s\"). Default \"0s\".")),
		mcp.WithBoolean("dry_run", mcp.Description("If true, show the API request that would be made without executing it.")),
	), withAuth(addHydrationLogHandler))

	s.AddTool(mcp.NewTool("add_sleep_session",
		mcp.WithDescription("Log a sleep session specifying start and end times. The API does not support titles/notes on sleep sessions."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithString("start_time", mcp.Required(), mcp.Description("Start timestamp in RFC3339 format (e.g. 2026-07-25T23:00:00Z)")),
		mcp.WithString("end_time", mcp.Required(), mcp.Description("End timestamp in RFC3339 format (e.g. 2026-07-26T07:00:00Z)")),
		mcp.WithString("utc_offset", mcp.Description("UTC offset string (e.g. \"0s\", \"3600s\"). Default \"0s\".")),
		mcp.WithBoolean("dry_run", mcp.Description("If true, show the API request without executing it.")),
	), withAuth(addSleepSessionHandler))

	s.AddTool(mcp.NewTool("add_exercise_session",
		mcp.WithDescription("Log an exercise session (workout). Exercise types: RUNNING, WALKING, CYCLING, STRENGTH_TRAINING, SWIMMING, YOGA, TREADMILL, HIIT, etc. The API does not support titles/notes on exercise sessions."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithString("exercise_type", mcp.Required(), mcp.Description("Exercise type (e.g. RUNNING, WALKING, CYCLING, STRENGTH_TRAINING, SWIMMING)")),
		mcp.WithString("start_time", mcp.Required(), mcp.Description("Start timestamp in RFC3339 format (e.g. 2026-07-26T10:00:00Z)")),
		mcp.WithString("end_time", mcp.Required(), mcp.Description("End timestamp in RFC3339 format (e.g. 2026-07-26T10:30:00Z)")),
		mcp.WithString("utc_offset", mcp.Description("UTC offset string (e.g. \"0s\", \"3600s\"). Default \"0s\".")),
		mcp.WithBoolean("dry_run", mcp.Description("If true, show the API request without executing it.")),
	), withAuth(addExerciseSessionHandler))

	s.AddTool(mcp.NewTool("add_nutrition_log",
		mcp.WithDescription("Log a meal by type and time. The API only supports mealType and interval; nutrient details and food names are not supported."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithString("meal_type", mcp.Required(), mcp.Description("Meal type: BREAKFAST, LUNCH, DINNER, SNACK")),
		mcp.WithString("start_time", mcp.Description("Start timestamp in RFC3339 format (defaults to current time)")),
		mcp.WithString("end_time", mcp.Description("End timestamp in RFC3339 format (defaults to start_time + 30min)")),
		mcp.WithString("utc_offset", mcp.Description("UTC offset string (e.g. \"0s\", \"3600s\"). Default \"0s\".")),
		mcp.WithBoolean("dry_run", mcp.Description("If true, show the API request without executing it.")),
	), withAuth(addNutritionLogHandler))

	s.AddTool(mcp.NewTool("patch_data_point",
		mcp.WithDescription("Update an existing data point. Provide data type, data point ID, and the fields to update as a JSON object."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case)")),
		mcp.WithString("data_point_id", mcp.Required(), mcp.Description("Data point ID")),
		mcp.WithObject("body", mcp.Required(), mcp.Description("Fields to update as JSON (DataPoint structure)")),
	), withAuth(patchDataPointHandler))

	s.AddTool(mcp.NewTool("delete_data_point",
		mcp.WithDescription("Delete a single data point by its data type and data point ID."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case)")),
		mcp.WithString("data_point_id", mcp.Required(), mcp.Description("Data point ID (from listed data point name or ID)")),
	), withAuth(deleteDataPointHandler))

	s.AddTool(mcp.NewTool("batch_delete_data_points",
		mcp.WithDescription("Delete multiple data points by their full resource names. Max 10000 per request. Supported types: sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type ID (kebab-case), or '-' for cross-type delete")),
		mcp.WithArray("names", mcp.Required(), mcp.Description("List of full resource names to delete (e.g. [\"users/me/dataTypes/weight/dataPoints/123456\"])")),
	), withAuth(batchDeleteDataPointsHandler))

	s.AddTool(mcp.NewTool("delete_by_filter",
		mcp.WithDescription("Delete all data points matching a filter. Use with caution - this is destructive."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type (kebab-case)")),
		mcp.WithString("filter", mcp.Required(), mcp.Description("AIP-160 filter expression")),
		mcp.WithNumber("max_count", mcp.Description("Maximum number of points to delete (default 100, max 10000)")),
	), withAuth(deleteByFilterHandler))

	// Export
	s.AddTool(mcp.NewTool("export_exercise_tcx",
		mcp.WithDescription("Export an exercise data point as TCX (Training Center XML). Requires both activity_and_fitness.readonly and location.readonly scopes. Add ?alt=media for raw TCX download."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("data_point_id", mcp.Required(), mcp.Description("Data point ID of the exercise (numeric)")),
		mcp.WithBoolean("partial_data", mcp.Description("Include partial data when GPS unavailable (default false)")),
	), withAuth(exportExerciseTcxHandler))

	// Summaries & analytics
	s.AddTool(mcp.NewTool("compare_health_periods",
		mcp.WithDescription("Compare health metrics (steps, active calories, etc.) between two date ranges (Period A vs Period B)."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("period_a_start", mcp.Required(), mcp.Description("Start date for Period A (YYYY-MM-DD)")),
		mcp.WithString("period_a_end", mcp.Required(), mcp.Description("End date for Period A (YYYY-MM-DD)")),
		mcp.WithString("period_b_start", mcp.Required(), mcp.Description("Start date for Period B (YYYY-MM-DD)")),
		mcp.WithString("period_b_end", mcp.Required(), mcp.Description("End date for Period B (YYYY-MM-DD)")),
	), withAuth(compareHealthPeriodsHandler))

	s.AddTool(mcp.NewTool("get_hrv_recovery_trend",
		mcp.WithDescription("Analyze HRV (Heart Rate Variability) and resting heart rate trends over past N days to evaluate physical recovery status."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithNumber("days", mcp.Description("Number of past days to analyze (default 14, max 90)")),
		mcp.WithString("end_date", mcp.Description("End date (YYYY-MM-DD, defaults to today)")),
	), withAuth(getHrvRecoveryTrendHandler))

	s.AddTool(mcp.NewTool("get_temperature_summary",
		mcp.WithDescription("Get core body temperature and daily sleep temperature derivations for a period."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("start_date", mcp.Required(), mcp.Description("Start date (YYYY-MM-DD)")),
		mcp.WithString("end_date", mcp.Required(), mcp.Description("End date (YYYY-MM-DD)")),
	), withAuth(getTemperatureSummaryHandler))

	s.AddTool(mcp.NewTool("clear_cache",
		mcp.WithDescription("Clear in-memory response cache to force fresh live API fetches on subsequent queries."),
		mcp.WithReadOnlyHintAnnotation(false),
	), withAuth(clearCacheHandler))

	s.AddTool(mcp.NewTool("summary",
		mcp.WithDescription("Full health summary for any date: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, VO2max, nutrition, hydration, sedentary periods, activity levels. `today` and `yesterday` are shortcuts for this tool. Per-metric fetch failures, if any, are listed in `_errors`."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("date", mcp.Description("Date in YYYY-MM-DD format. Defaults to today (server local time) if omitted.")),
	), withAuth(summaryHandler))

	s.AddTool(mcp.NewTool("today",
		mcp.WithDescription("Get a full health summary for today: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, sedentary periods."),
		mcp.WithReadOnlyHintAnnotation(true),
	), withAuth(todayHandler))

	s.AddTool(mcp.NewTool("yesterday",
		mcp.WithDescription("Get a full health summary for yesterday: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, sedentary periods."),
		mcp.WithReadOnlyHintAnnotation(true),
	), withAuth(yesterdayHandler))

	s.AddTool(mcp.NewTool("get_trends",
		mcp.WithDescription("Get daily time series for a health metric over a date range. Returns per-day aggregated values. Only works with dailyRollUp-compatible types. Use list_data_types to check."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("data_type", mcp.Required(), mcp.Description("Data type (e.g. steps, heart-rate, active-energy-burned, distance, floors)")),
		mcp.WithString("start_date", mcp.Required(), mcp.Description("Start date (YYYY-MM-DD)")),
		mcp.WithString("end_date", mcp.Required(), mcp.Description("End date (YYYY-MM-DD)")),
	), withAuth(getTrendsHandler))

	// Profile & devices
	s.AddTool(mcp.NewTool("get_profile",
		mcp.WithDescription("Get the user's Google Health profile (name, birthdate, gender, etc)."),
		mcp.WithReadOnlyHintAnnotation(true),
	), withAuth(getProfileHandler))

	s.AddTool(mcp.NewTool("update_profile",
		mcp.WithDescription("Update the user's Google Health profile fields. Provide fields as a JSON object."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithObject("body", mcp.Required(), mcp.Description("Profile fields to update as JSON")),
	), withAuth(updateProfileHandler))

	s.AddTool(mcp.NewTool("get_settings",
		mcp.WithDescription("Get the user's Google Health settings (units, preferences)."),
		mcp.WithReadOnlyHintAnnotation(true),
	), withAuth(getSettingsHandler))

	s.AddTool(mcp.NewTool("update_settings",
		mcp.WithDescription("Update the user's Google Health settings. Provide fields as a JSON object."),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithObject("body", mcp.Required(), mcp.Description("Settings fields to update as JSON")),
	), withAuth(updateSettingsHandler))

	s.AddTool(mcp.NewTool("get_identity",
		mcp.WithDescription("Get the user's Google Health identity information."),
		mcp.WithReadOnlyHintAnnotation(true),
	), withAuth(getIdentityHandler))

	s.AddTool(mcp.NewTool("get_irn_profile",
		mcp.WithDescription("Get the user's Irregular Rhythm Notification profile."),
		mcp.WithReadOnlyHintAnnotation(true),
	), withAuth(getIrnProfileHandler))

	s.AddTool(mcp.NewTool("list_paired_devices",
		mcp.WithDescription("List all devices paired with the user's Google Health account."),
		mcp.WithReadOnlyHintAnnotation(true),
	), withAuth(listPairedDevicesHandler))

	s.AddTool(mcp.NewTool("get_paired_device",
		mcp.WithDescription("Get details of a specific paired device."),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("device_id", mcp.Required(), mcp.Description("Device ID")),
	), withAuth(getPairedDeviceHandler))
}

// ─── Resources ───────────────────────────────────────────────────────────────

func registerResources(s *server.MCPServer, auth *AuthState) {
	// Static resources
	s.AddResource(
		mcp.NewResource("health://profile", "Health Profile",
			mcp.WithResourceDescription("Google Health user profile (name, birth date, gender)"),
			mcp.WithMIMEType("application/json"),
		),
		func(ctx context.Context, req mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			resp, err := auth.APIGet(fmt.Sprintf("%s/profile", base))
			if err != nil {
				return nil, fmt.Errorf("failed to fetch profile: %w", err)
			}
			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      "health://profile",
					MIMEType: "application/json",
					Text:     string(resp),
				},
			}, nil
		},
	)

	s.AddResource(
		mcp.NewResource("health://settings", "Health Settings",
			mcp.WithResourceDescription("Google Health settings (units, preferences)"),
			mcp.WithMIMEType("application/json"),
		),
		func(ctx context.Context, req mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			resp, err := auth.APIGet(fmt.Sprintf("%s/settings", base))
			if err != nil {
				return nil, fmt.Errorf("failed to fetch settings: %w", err)
			}
			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      "health://settings",
					MIMEType: "application/json",
					Text:     string(resp),
				},
			}, nil
		},
	)

	s.AddResource(
		mcp.NewResource("health://devices", "Paired Devices",
			mcp.WithResourceDescription("Devices paired with the Google Health account"),
			mcp.WithMIMEType("application/json"),
		),
		func(ctx context.Context, req mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			resp, err := auth.APIGet(fmt.Sprintf("%s/pairedDevices", base))
			if err != nil {
				return nil, fmt.Errorf("failed to fetch devices: %w", err)
			}
			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      "health://devices",
					MIMEType: "application/json",
					Text:     string(resp),
				},
			}, nil
		},
	)

	// Resource template: health://summary/{date}
	s.AddResourceTemplate(
		mcp.NewResourceTemplate("health://summary/{date}", "Daily Summary",
			mcp.WithTemplateDescription("Full daily health summary for a date (YYYY-MM-DD)"),
			mcp.WithTemplateMIMEType("application/json"),
		),
		func(ctx context.Context, req mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			// Extract date from URI: health://summary/2026-07-25
			uri := req.Params.URI
			dateStr := strings.TrimPrefix(uri, "health://summary/")
			date, err := parseCivilDate(dateStr)
			if err != nil {
				return nil, fmt.Errorf("invalid date in resource URI (expected YYYY-MM-DD): %s", dateStr)
			}
			summary := buildDailySummary(ctx, auth, date)
			data, _ := json.MarshalIndent(summary, "", "  ")
			return []mcp.ResourceContents{
				mcp.TextResourceContents{
					URI:      uri,
					MIMEType: "application/json",
					Text:     string(data),
				},
			}, nil
		},
	)
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

func registerPrompts(s *server.MCPServer) {
	s.AddPrompt(mcp.NewPrompt("health_weekly_review",
		mcp.WithPromptDescription("Comprehensive 7-day health, sleep, and workout review"),
		mcp.WithArgument("end_date", mcp.ArgumentDescription("End date in YYYY-MM-DD format (defaults to today)")),
	), func(ctx context.Context, req mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		endDate := "today"
		if v, ok := req.Params.Arguments["end_date"]; ok {
			endDate = v
		}
		text := fmt.Sprintf("Please review my health data up to %s. Use `summary` for the past 7 days to evaluate step trends, sleep duration/stages, resting heart rate, active calories, and overall recovery. Highlight any key trends or anomalies.\n\nAdditional analysis to include:\n- Evaluate sleep stage distribution (deep/REM percentages, sleep efficiency)\n- Analyze HR zone breakdown across activities\n- Check temperature anomalies from daily-sleep-temperature-derivations\n- Review respiratory rate trends from daily-respiratory-rate", endDate)
		return &mcp.GetPromptResult{
			Description: "Health analysis prompt: health_weekly_review",
			Messages: []mcp.PromptMessage{
				{
					Role: mcp.RoleUser,
					Content: mcp.TextContent{
						Type: "text",
						Text: text,
					},
				},
			},
		}, nil
	})

	s.AddPrompt(mcp.NewPrompt("sleep_quality_analysis",
		mcp.WithPromptDescription("Detailed sleep stages, HRV, and recovery analysis"),
		mcp.WithArgument("days", mcp.ArgumentDescription("Number of past days to analyze (default 7)")),
	), func(ctx context.Context, req mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		days := "7"
		if v, ok := req.Params.Arguments["days"]; ok {
			days = v
		}
		text := fmt.Sprintf("Please analyze my sleep quality for the past %s days. Use `sync_data_points` or `list_data_points` for `sleep`, `heart-rate-variability`, and `daily-resting-heart-rate`. Detail my sleep efficiency, deep/REM sleep percentages, and HRV trends.\n\nAdditional analysis to include:\n- Analyze sleep efficiency (minutesAsleep / minutesInSleepPeriod)\n- Evaluate deep+REM ratio (normal: 20-40%%)\n- Check per-stage respiratory rate from respiratory-rate-sleep-summary (deep/light/REM breathing rates)\n- Correlate HRV with sleep stages", days)
		return &mcp.GetPromptResult{
			Description: "Health analysis prompt: sleep_quality_analysis",
			Messages: []mcp.PromptMessage{
				{
					Role: mcp.RoleUser,
					Content: mcp.TextContent{
						Type: "text",
						Text: text,
					},
				},
			},
		}, nil
	})

	s.AddPrompt(mcp.NewPrompt("workout_summary",
		mcp.WithPromptDescription("Exercise sessions and heart rate zone breakdown"),
		mcp.WithArgument("days", mcp.ArgumentDescription("Number of past days to analyze (default 7)")),
	), func(ctx context.Context, req mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
		days := "7"
		if v, ok := req.Params.Arguments["days"]; ok {
			days = v
		}
		text := fmt.Sprintf("Please compile a summary of my workouts over the past %s days. Use `list_data_points` for `exercise`, `active-zone-minutes`, and `calories-in-heart-rate-zone`. Show workout types, total durations, calories burned, and intensity zones.\n\nAdditional analysis to include:\n- Analyze heart rate zone durations per workout (lightTime/moderateTime/vigorousTime/peakTime)\n- Track active zone minutes across sessions\n- Compare pace and heart rate trends over time", days)
		return &mcp.GetPromptResult{
			Description: "Health analysis prompt: workout_summary",
			Messages: []mcp.PromptMessage{
				{
					Role: mcp.RoleUser,
					Content: mcp.TextContent{
						Type: "text",
						Text: text,
					},
				},
			},
		}, nil
	})
}

// ─── Middleware ──────────────────────────────────────────────────────────────

func apiKeyMiddleware(next http.Handler, apiKey string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow health check without auth.
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ok"}`))
			return
		}

		// Check Authorization header.
		auth := r.Header.Get("Authorization")
		token := strings.TrimPrefix(auth, "Bearer ")
		if token == "" || subtle.ConstantTimeCompare([]byte(token), []byte(apiKey)) != 1 {
			http.Error(w, `{"error":"Invalid API key"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func requireEnv(key string) string {
	val := os.Getenv(key)
	if val == "" {
		fmt.Fprintf(os.Stderr, "%s env var required\n", key)
		os.Exit(1)
	}
	return val
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Server instructions ─────────────────────────────────────────────────────

const serverInstructions = `Google Health MCP server with 35 tools for reading and writing health data from Google Health API v4, plus 4 resources and 3 prompts.

Tools by category:
- Summaries & analytics: ` + "`summary`" + ` (any date, YYYY-MM-DD), ` + "`today`" + `, ` + "`yesterday`" + `, ` + "`compare_health_periods`" + `, ` + "`get_hrv_recovery_trend`" + `, ` + "`get_temperature_summary`" + `, ` + "`get_trends`" + `, ` + "`clear_cache`" + `.
- Data & sync: ` + "`list_data_points`" + `, ` + "`get_data_point`" + `, ` + "`reconcile_data_points`" + `, ` + "`sync_data_points`" + `, ` + "`rollup_data_points`" + `, ` + "`daily_rollup_data_points`" + `.
- Write & delete: ` + "`create_data_point`" + `, ` + "`add_weight_sample`" + `, ` + "`add_hydration_log`" + `, ` + "`add_sleep_session`" + `, ` + "`add_exercise_session`" + `, ` + "`add_nutrition_log`" + `, ` + "`patch_data_point`" + `, ` + "`delete_data_point`" + `, ` + "`batch_delete_data_points`" + `, ` + "`delete_by_filter`" + `.
- Export: ` + "`export_exercise_tcx`" + ` (returns raw TCX XML).
- Profile & devices: ` + "`get_profile`" + `, ` + "`update_profile`" + `, ` + "`get_settings`" + `, ` + "`update_settings`" + `, ` + "`get_identity`" + `, ` + "`get_irn_profile`" + `, ` + "`list_paired_devices`" + `, ` + "`get_paired_device`" + `.

Resources: health://profile, health://settings, health://devices, and the template health://summary/{date} (YYYY-MM-DD).

Prompts: health_weekly_review, sleep_quality_analysis, workout_summary.

Quick start:
- Use ` + "`today`" + ` or ` + "`summary`" + ` (with date YYYY-MM-DD) for a full daily health overview (~34 metrics fetched in parallel).
- Use ` + "`list_data_points`" + ` for raw data with AIP-160 filters. Data types use kebab-case (e.g. heart-rate, daily-resting-heart-rate); filters use snake_case (e.g. heart_rate.sample_time.physical_time).
- Use ` + "`daily_rollup_data_points`" + ` for aggregated data by day.
- Write helpers: add_weight_sample, add_hydration_log, add_sleep_session, add_exercise_session, add_nutrition_log.
- Analytics: compare_health_periods (13 metrics), get_hrv_recovery_trend (personalized baseline).

Key gotchas:
- Use dailyRollUp for steps/distance/floors totals (list returns intervals without values).
- Missing days ≠ zero data.
- int64 fields (countSum, beatsPerMinute, minutesAsleep) are strings in JSON.
- Summary responses are cached for 120s; use clear_cache to force fresh data after writes.`
