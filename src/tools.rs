use crate::auth::AuthState;
use chrono::{Datelike, Duration as ChronoDuration, Local, NaiveDate};
use futures::stream::{self, StreamExt};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use rust_mcp_sdk::macros::{mcp_resource, mcp_resource_template, mcp_tool, JsonSchema};
use rust_mcp_sdk::schema::{schema_utils::CallToolError, CallToolResult, TextContent};
use serde_json::{json, Map, Value};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub(crate) const BASE: &str = "https://health.googleapis.com/v4/users/me";

fn ok(v: &Value) -> Result<CallToolResult, CallToolError> {
    Ok(CallToolResult {
        content: vec![TextContent::from(serde_json::to_string_pretty(v).unwrap_or_default()).into()],
        is_error: None,
        meta: None,
        // structuredContent must be an object; arrays/scalars are text-only.
        structured_content: v.as_object().cloned(),
    })
}

fn err(e: &str) -> Result<CallToolResult, CallToolError> {
    Ok(CallToolResult {
        content: vec![TextContent::from(format!("ERROR: {e}")).into()],
        is_error: Some(true),
        meta: None,
        structured_content: None,
    })
}

/// Structured error with actionable `next_steps` for the model to recover.
fn err_with_steps(msg: &str, steps: Vec<&str>) -> Result<CallToolResult, CallToolError> {
    let body = json!({
        "error": msg,
        "next_steps": steps,
    });
    Ok(CallToolResult {
        content: vec![TextContent::from(serde_json::to_string_pretty(&body).unwrap_or_default()).into()],
        is_error: Some(true),
        meta: None,
        structured_content: body.as_object().cloned(),
    })
}

/// Classify an upstream API error string and attach scenario-specific
/// `next_steps`. Falls back to the plain `err()` for unrecognized errors.
fn api_err(e: &str) -> Result<CallToolResult, CallToolError> {
    let lower = e.to_lowercase();
    if e.contains("HTTP 403") || lower.contains("forbidden") || lower.contains("permission") {
        return err_with_steps(
            e,
            vec![
                "Check OAuth scopes include the required permission",
                "Run oauth_health.py to re-authorize",
            ],
        );
    }
    if lower.contains("filter") {
        return err_with_steps(
            e,
            vec![
                "Call describe_data_type for the correct filter syntax",
                "Use start_time/end_time params instead of manual filter",
            ],
        );
    }
    if e.contains("HTTP 404") || lower.contains("not found") {
        return err_with_steps(
            e,
            vec![
                "Call list_data_types to see all 39 supported types",
                "Check the type ID is kebab-case (e.g. heart-rate, not heartRate)",
            ],
        );
    }
    if e.contains("HTTP 400") {
        return err_with_steps(
            e,
            vec![
                "Check the request body format",
                "Call describe_data_type for field names",
            ],
        );
    }
    err(e)
}

/// Attach a `_hint` to responses that carry a `nextPageToken`, so the model
/// knows more data is available and how to fetch it.
fn add_pagination_hint(v: &mut Value) {
    if v.get("nextPageToken").is_some() {
        if let Some(obj) = v.as_object_mut() {
            obj.insert(
                "_hint".to_string(),
                json!("More data available. Pass nextPageToken to fetch the next page."),
            );
        }
    }
}

// ─── discovery / registry ────────────────────────────────────────────────────

#[mcp_tool(
    name = "list_data_types",
    title = "List Data Types",
    description = "List all 39 supported Google Health API v4 data types with their categories, supported operations, and key fields. Use this to discover what data is available before calling other tools.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct ListDataTypes {
    /// Optional category filter (activity, cardiac, body, sleep, nutrition, respiratory, oxygen, temperature, clinical)
    #[serde(default)]
    pub category: Option<String>,
}

impl ListDataTypes {
    pub async fn call_tool(&self, _auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let cat = self.category.as_deref().map(|s| s.trim().to_lowercase());
        let matches: Vec<serde_json::Value> = crate::types::DATA_TYPES
            .iter()
            .filter(|t| match &cat {
                Some(c) if !c.is_empty() => t.category.eq_ignore_ascii_case(c),
                _ => true,
            })
            .map(|t| serde_json::to_value(t).unwrap_or_default())
            .collect();

        if let Some(c) = &cat {
            if !c.is_empty() && matches.is_empty() {
                return err(&format!(
                    "Unknown category '{c}'. Valid categories: {}",
                    crate::types::categories().join(", ")
                ));
            }
        }

        let result = json!({
            "count": matches.len(),
            "total": crate::types::DATA_TYPES.len(),
            "categories": crate::types::categories(),
            "data_types": matches,
        });
        ok(&result)
    }
}

#[mcp_tool(
    name = "describe_data_type",
    title = "Describe Data Type",
    description = "Get detailed information about a specific data type: supported operations, filter syntax, page limits, rollup range, key response fields, and gotchas.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct DescribeDataType {
    /// Data type ID (kebab-case, e.g. "heart-rate", "daily-resting-heart-rate")
    pub data_type: String,
}

impl DescribeDataType {
    pub async fn call_tool(&self, _auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let info = match crate::types::find_type(self.data_type.trim()) {
            Some(t) => t,
            None => {
                return err(&format!(
                    "Unknown data type '{}'. Use list_data_types to see all 39 valid kebab-case IDs.",
                    self.data_type
                ));
            }
        };

        let mut value = serde_json::to_value(info).unwrap_or_default();

        // Add computed filter convenience fields.
        let (filter_field, filter_example) = match info.time_field.filter_path(info.filter_name) {
            Some(path) => {
                let sample = match info.time_field {
                    crate::types::TimeField::Daily | crate::types::TimeField::IntervalCivilStart => {
                        "2026-07-01"
                    }
                    _ => "2026-07-01T00:00:00Z",
                };
                let example = format!("{path} >= \"{sample}\"");
                (Some(path), Some(example))
            }
            None => (None, None),
        };
        if let Some(obj) = value.as_object_mut() {
            obj.insert("time_field_label".into(), json!(info.time_field.label()));
            obj.insert("filter_field".into(), json!(filter_field));
            obj.insert("filter_example".into(), json!(filter_example));
        }

        ok(&value)
    }
}

/// Strip redundant fields from a single data point object.
fn simplify_point(obj: &mut Map<String, Value>) {
    obj.remove("dataSource");
    obj.remove("createTime");
    obj.remove("updateTime");
    // Drop nested objects that are empty ({}).
    obj.retain(|_, val| !(val.is_object() && val.as_object().map_or(false, |o| o.is_empty())));
}

/// Simplify a list/rollup response (or a single data point) by removing
/// per-point noise that is repeated or rarely needed. `nextPageToken` and the
/// `_hint` field are preserved.
fn simplify_response(v: &mut Value) {
    let mut handled = false;
    for key in ["dataPoints", "rollupDataPoints"] {
        if let Some(pts) = v.get_mut(key).and_then(|p| p.as_array_mut()) {
            for pt in pts.iter_mut() {
                if let Some(obj) = pt.as_object_mut() {
                    simplify_point(obj);
                }
            }
            handled = true;
        }
    }
    // Single data point (get_data_point): the response object itself is the point.
    if !handled {
        if let Some(obj) = v.as_object_mut() {
            simplify_point(obj);
        }
    }
}

/// Extract f64 from a JSON value that may be a number or a numeric string.
fn as_num(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

// ─── list ────────────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "list_data_points",
    title = "List Data Points",
    description = "List data points for any Google Health data type. Filter syntax depends on record type: Interval types use '{type}.interval.start_time >= \"RFC3339\" AND {type}.interval.start_time < \"RFC3339\"'; Sample types use '{type}.sample_time.physical_time >= \"RFC3339\"'; Daily types use '{type}.date >= \"YYYY-MM-DD\"'; Sleep uses 'sleep.interval.end_time'; Exercise/hydration-log/nutrition-log/irregular-rhythm-notification use '{type}.interval.civil_start_time >= \"YYYY-MM-DD\"'; ECG uses 'electrocardiogram.interval.start_time >= \"RFC3339\"' (only >=). In filters use snake_case (heart_rate), in data_type use kebab-case (heart-rate). Types without list support: floors, calories-in-heart-rate-zone, total-calories (use rollup instead). food and food-measurement-unit do not support filters. TIP: Use list_data_types to discover available types. Use dailyRollUp for steps/distance/floors totals (list returns intervals without values).",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct ListDataPoints {
    /// Data type ID (kebab-case): steps, sleep, heart-rate, active-energy-burned, oxygen-saturation, distance, exercise, weight, height, body-fat, blood-glucose, core-body-temperature, heart-rate-variability, daily-resting-heart-rate, daily-heart-rate-variability, daily-heart-rate-zones, daily-oxygen-saturation, daily-respiratory-rate, daily-sleep-temperature-derivations, daily-vo2-max, vo2-max, run-vo2-max, active-minutes, active-zone-minutes, activity-level, altitude, electrocardiogram, food, food-measurement-unit, hydration-log, irregular-rhythm-notification, nutrition-log, respiratory-rate-sleep-summary, sedentary-period, swim-lengths-data, time-in-heart-rate-zone
    pub data_type: String,
    /// Filter expression (AIP-160 syntax). Leave empty for types that don't support filters (food, food-measurement-unit). If provided, overrides any auto-built filter from start_time/end_time.
    #[serde(default)]
    pub filter: Option<String>,
    /// Optional start time (RFC3339 or YYYY-MM-DD). If provided with end_time, builds the filter automatically.
    #[serde(default)]
    pub start_time: Option<String>,
    /// Optional end time (RFC3339 or YYYY-MM-DD). Used with start_time.
    #[serde(default)]
    pub end_time: Option<String>,
    /// Page size (default 1440, max 10000; exercise/sleep max 25)
    #[serde(default)]
    pub page_size: Option<u32>,
    /// Page token for pagination
    #[serde(default)]
    pub page_token: Option<String>,
    /// If true, return the full raw API response. Default false returns simplified output (strips dataSource/createTime/updateTime and empty objects from each point).
    #[serde(default)]
    pub raw: Option<bool>,
}

impl ListDataPoints {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let mut url = format!("{BASE}/dataTypes/{}/dataPoints", self.data_type);
        let mut params = vec![];
        // If an explicit filter is provided, use it directly. Otherwise, if
        // start_time and end_time are both set, build the filter automatically
        // using the same logic as SyncDataPoints::build_filter.
        let effective_filter = match &self.filter {
            Some(f) => Some(f.clone()),
            None => match (&self.start_time, &self.end_time) {
                (Some(start), Some(end)) => {
                    Some(SyncDataPoints::build_filter(&self.data_type, start, Some(end.as_str())))
                }
                (Some(start), None) => {
                    Some(SyncDataPoints::build_filter(&self.data_type, start, None))
                }
                _ => None,
            },
        };
        if let Some(f) = &effective_filter {
            params.push(format!("filter={}", urlenc(f)));
        }
        if let Some(ps) = self.page_size {
            params.push(format!("pageSize={ps}"));
        }
        if let Some(pt) = &self.page_token {
            params.push(format!("pageToken={}", urlenc(pt)));
        }
        if !params.is_empty() {
            url = format!("{url}?{}", params.join("&"));
        }
        match auth.api_get(&url).await {
            Ok(mut v) => {
                add_pagination_hint(&mut v);
                if !self.raw.unwrap_or(false) {
                    simplify_response(&mut v);
                }
                ok(&v)
            }
            Err(e) => api_err(&e),
        }
    }
}

// ─── get ─────────────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "get_data_point",
    title = "Get Data Point",
    description = "Get a single data point by its ID.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct GetDataPoint {
    /// Data type ID (kebab-case)
    pub data_type: String,
    /// Data point ID (from the name field of a listed data point)
    pub data_point_id: String,
    /// If true, return the full raw API response. Default false returns simplified output.
    #[serde(default)]
    pub raw: Option<bool>,
}

impl GetDataPoint {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let url = if self.data_point_id.starts_with("users/") {
            format!("https://health.googleapis.com/v4/{}", self.data_point_id)
        } else {
            format!(
                "{BASE}/dataTypes/{}/dataPoints/{}",
                self.data_type, self.data_point_id
            )
        };
        match auth.api_get(&url).await {
            Ok(mut v) => {
                if !self.raw.unwrap_or(false) {
                    simplify_response(&mut v);
                }
                ok(&v)
            }
            Err(e) => api_err(&e),
        }
    }
}

// ─── reconcile ───────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "reconcile_data_points",
    title = "Reconcile Data Points",
    description = "Reconcile (deduplicate/merge) data points for a data type. Same filter syntax as list. Supports dataSourceFamily filter. This is a read-only operation (GET request).",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct ReconcileDataPoints {
    /// Data type ID (kebab-case)
    pub data_type: String,
    /// Filter expression (same syntax as list)
    #[serde(default)]
    pub filter: Option<String>,
    /// Page size
    #[serde(default)]
    pub page_size: Option<u32>,
    /// Page token
    #[serde(default)]
    pub page_token: Option<String>,
    /// Data source family: users/me/dataSourceFamilies/all-sources (default), users/me/dataSourceFamilies/google-wearables, users/me/dataSourceFamilies/google-sources
    #[serde(default)]
    pub data_source_family: Option<String>,
    /// If true, return the full raw API response. Default false returns simplified output.
    #[serde(default)]
    pub raw: Option<bool>,
}

impl ReconcileDataPoints {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let mut url = format!(
            "{BASE}/dataTypes/{}/dataPoints:reconcile",
            self.data_type
        );
        let mut params = vec![];
        if let Some(f) = &self.filter {
            params.push(format!("filter={}", urlenc(f)));
        }
        if let Some(ps) = self.page_size {
            params.push(format!("pageSize={ps}"));
        }
        if let Some(pt) = &self.page_token {
            params.push(format!("pageToken={}", urlenc(pt)));
        }
        if let Some(dsf) = &self.data_source_family {
            params.push(format!("dataSourceFamily={}", urlenc(dsf)));
        }
        if !params.is_empty() {
            url = format!("{url}?{}", params.join("&"));
        }
        match auth.api_get(&url).await {
            Ok(mut v) => {
                add_pagination_hint(&mut v);
                if !self.raw.unwrap_or(false) {
                    simplify_response(&mut v);
                }
                ok(&v)
            }
            Err(e) => api_err(&e),
        }
    }
}

// ─── sync / delta sync ────────────────────────────────────────────────────────

#[mcp_tool(
    name = "sync_data_points",
    title = "Sync Data Points (Incremental Sync)",
    description = "Perform incremental synchronization (Delta Sync) for a data type using the reconcile endpoint. Automatically builds time filter for data created or updated after `since_time`. This is a read-only operation.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct SyncDataPoints {
    /// Data type ID (kebab-case), e.g. steps, heart-rate, sleep, weight
    pub data_type: String,
    /// Start timestamp for incremental sync (RFC3339, e.g. 2026-07-26T00:00:00Z or YYYY-MM-DD for daily types)
    pub since_time: String,
    /// Optional end timestamp for sync window (RFC3339 or YYYY-MM-DD)
    #[serde(default)]
    pub until_time: Option<String>,
    /// Page size for pagination
    #[serde(default)]
    pub page_size: Option<u32>,
    /// Page token for pagination
    #[serde(default)]
    pub page_token: Option<String>,
    /// Data source family filter (optional)
    #[serde(default)]
    pub data_source_family: Option<String>,
    /// If true, return the full raw API response. Default false returns simplified output.
    #[serde(default)]
    pub raw: Option<bool>,
}

impl SyncDataPoints {
    pub fn build_filter(data_type: &str, since_time: &str, until_time: Option<&str>) -> String {
        let snake_type = data_type.replace('-', "_");
        let mut filter = match data_type {
            "sleep" => format!("sleep.interval.end_time >= \"{since_time}\""),
            "exercise" | "hydration-log" | "nutrition-log" | "irregular-rhythm-notification" => {
                let civil_date = since_time.get(..10).unwrap_or(since_time);
                format!("{snake_type}.interval.civil_start_time >= \"{civil_date}\"")
            }
            "daily-resting-heart-rate" | "daily-heart-rate-variability" | "daily-heart-rate-zones"
            | "daily-oxygen-saturation" | "daily-respiratory-rate" | "daily-sleep-temperature-derivations"
            | "daily-vo2-max" => {
                let civil_date = since_time.get(..10).unwrap_or(since_time);
                format!("{snake_type}.date >= \"{civil_date}\"")
            }
            "heart-rate" | "weight" | "height" | "body-fat" | "blood-glucose" | "core-body-temperature"
            | "heart-rate-variability" | "oxygen-saturation" | "respiratory-rate-sleep-summary"
            | "vo2-max" | "run-vo2-max" => {
                format!("{snake_type}.sample_time.physical_time >= \"{since_time}\"")
            }
            "electrocardiogram" => {
                format!("electrocardiogram.interval.start_time >= \"{since_time}\"")
            }
            _ => format!("{snake_type}.interval.start_time >= \"{since_time}\""),
        };

        if let Some(until) = until_time {
            let add_until = match data_type {
                "sleep" => format!(" AND sleep.interval.end_time < \"{until}\""),
                "exercise" | "hydration-log" | "nutrition-log" | "irregular-rhythm-notification" => {
                    let civil_date = until.get(..10).unwrap_or(until);
                    format!(" AND {snake_type}.interval.civil_start_time < \"{civil_date}\"")
                }
                "daily-resting-heart-rate" | "daily-heart-rate-variability" | "daily-heart-rate-zones"
                | "daily-oxygen-saturation" | "daily-respiratory-rate" | "daily-sleep-temperature-derivations"
                | "daily-vo2-max" => {
                    let civil_date = until.get(..10).unwrap_or(until);
                    format!(" AND {snake_type}.date < \"{civil_date}\"")
                }
                "heart-rate" | "weight" | "height" | "body-fat" | "blood-glucose" | "core-body-temperature"
                | "heart-rate-variability" | "oxygen-saturation" | "respiratory-rate-sleep-summary"
                | "vo2-max" | "run-vo2-max" => {
                    format!(" AND {snake_type}.sample_time.physical_time < \"{until}\"")
                }
                // ECG only supports >= filters; no upper bound.
                "electrocardiogram" => String::new(),
                _ => format!(" AND {snake_type}.interval.start_time < \"{until}\""),
            };
            filter.push_str(&add_until);
        }
        filter
    }

    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let filter = Self::build_filter(&self.data_type, &self.since_time, self.until_time.as_deref());
        let reconcile_tool = ReconcileDataPoints {
            data_type: self.data_type.clone(),
            filter: Some(filter),
            page_size: self.page_size,
            page_token: self.page_token.clone(),
            data_source_family: self.data_source_family.clone(),
            raw: self.raw,
        };
        reconcile_tool.call_tool(auth).await
    }
}

// ─── rollUp ──────────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "rollup_data_points",
    title = "RollUp Data Points",
    description = "Aggregate data points into time buckets. Body: range (Interval with startTime/endTime RFC3339), windowSize (duration e.g. '3600s', '86400s'). Max range: 14 days for heart-rate/active-minutes/total-calories/calories-in-heart-rate-zone, 90 days for others. Response field: rollupDataPoints. Note: heart-rate, active-minutes, total-calories, calories-in-heart-rate-zone have a 14-day range limit.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct RollUpDataPoints {
    /// Data type ID (kebab-case): steps, heart-rate, active-energy-burned, distance, weight, altitude, body-fat, floors, total-calories, active-zone-minutes, sedentary-period, run-vo2-max, calories-in-heart-rate-zone, activity-level, nutrition-log, hydration-log, time-in-heart-rate-zone, active-minutes, swim-lengths-data, core-body-temperature, blood-glucose
    pub data_type: String,
    /// Range start time (RFC3339, e.g. 2026-07-15T00:00:00Z)
    pub start_time: String,
    /// Range end time (RFC3339, e.g. 2026-07-22T00:00:00Z)
    pub end_time: String,
    /// Window size as duration string (e.g. 3600s for hourly, 86400s for daily)
    pub window_size: String,
    /// Page size (default 1440, max 10000)
    #[serde(default)]
    pub page_size: Option<u32>,
    /// Page token
    #[serde(default)]
    pub page_token: Option<String>,
    /// Data source family (optional)
    #[serde(default)]
    pub data_source_family: Option<String>,
    /// If true, return the full raw API response. Default false returns simplified output.
    #[serde(default)]
    pub raw: Option<bool>,
}

impl RollUpDataPoints {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let url = format!("{BASE}/dataTypes/{}/dataPoints:rollUp", self.data_type);
        let mut body = json!({
            "range": {
                "startTime": self.start_time,
                "endTime": self.end_time,
            },
            "windowSize": self.window_size,
        });
        if let Some(ps) = self.page_size {
            body["pageSize"] = json!(ps);
        }
        if let Some(pt) = &self.page_token {
            body["pageToken"] = json!(pt);
        }
        if let Some(dsf) = &self.data_source_family {
            body["dataSourceFamily"] = json!(dsf);
        }
        match auth.api_post(&url, &body).await {
            Ok(mut v) => {
                add_pagination_hint(&mut v);
                if !self.raw.unwrap_or(false) {
                    simplify_response(&mut v);
                }
                ok(&v)
            }
            Err(e) => api_err(&e),
        }
    }
}

// ─── dailyRollUp ─────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "daily_rollup_data_points",
    title = "Daily RollUp Data Points",
    description = "Aggregate data points into daily buckets using civil (local) time. Range uses date objects: start/end with year/month/day. Response field: rollupDataPoints with civilStartTime/civilEndTime. Note: heart-rate, active-minutes, total-calories, calories-in-heart-rate-zone have a 14-day range limit.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct DailyRollUpDataPoints {
    /// Data type ID (kebab-case): same as rollup
    pub data_type: String,
    /// Start date (YYYY-MM-DD)
    pub start_date: String,
    /// End date (YYYY-MM-DD, exclusive)
    pub end_date: String,
    /// Window size in days (default 1)
    #[serde(default)]
    pub window_size_days: Option<u32>,
    /// Page size
    #[serde(default)]
    pub page_size: Option<u32>,
    /// Page token
    #[serde(default)]
    pub page_token: Option<String>,
    /// Data source family (optional)
    #[serde(default)]
    pub data_source_family: Option<String>,
    /// If true, return the full raw API response. Default false returns simplified output.
    #[serde(default)]
    pub raw: Option<bool>,
}

impl DailyRollUpDataPoints {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let url = format!(
            "{BASE}/dataTypes/{}/dataPoints:dailyRollUp",
            self.data_type
        );
        let start = match parse_civil_date(&self.start_date) {
            Ok(d) => d,
            Err(e) => return err(&e),
        };
        let end = match parse_civil_date(&self.end_date) {
            Ok(d) => d,
            Err(e) => return err(&e),
        };
        let mut body = json!({
            "range": {
                "start": { "date": date_obj(start) },
                "end": { "date": date_obj(end) },
            },
        });
        if let Some(w) = self.window_size_days {
            body["windowSizeDays"] = json!(w);
        }
        if let Some(ps) = self.page_size {
            body["pageSize"] = json!(ps);
        }
        if let Some(pt) = &self.page_token {
            body["pageToken"] = json!(pt);
        }
        if let Some(dsf) = &self.data_source_family {
            body["dataSourceFamily"] = json!(dsf);
        }
        match auth.api_post(&url, &body).await {
            Ok(mut v) => {
                add_pagination_hint(&mut v);
                if !self.raw.unwrap_or(false) {
                    simplify_response(&mut v);
                }
                ok(&v)
            }
            Err(e) => api_err(&e),
        }
    }
}

// ─── create ──────────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "create_data_point",
    title = "Create Data Point",
    description = "Create a new data point. Supported types: sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log. Provide the DataPoint body as a JSON object. Example for weight: {\"weight\":{\"sampleTime\":{\"physicalTime\":\"2026-07-22T08:00:00Z\",\"utcOffset\":\"0s\"},\"weightGrams\":70000}}",
    read_only_hint = false,
    destructive_hint = false,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct CreateDataPoint {
    /// Data type ID (kebab-case): sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log
    pub data_type: String,
    /// The DataPoint body as JSON
    pub body: Value,
    /// If true, show the API request that would be made without executing it.
    #[serde(default)]
    pub dry_run: Option<bool>,
}

impl CreateDataPoint {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let url = format!("{BASE}/dataTypes/{}/dataPoints", self.data_type);
        if self.dry_run.unwrap_or(false) {
            return ok(&json!({
                "dry_run": true,
                "method": "POST",
                "url": url,
                "body": self.body,
            }));
        }
        match auth.api_post(&url, &self.body).await {
            Ok(v) => {
                auth.cache.clear().await;
                ok(&v)
            }
            Err(e) => api_err(&e),
        }
    }
}

// ─── high-level writing helpers ──────────────────────────────────────────────

#[mcp_tool(
    name = "add_weight_sample",
    title = "Add Weight Sample",
    description = "Add a weight measurement in kg.",
    read_only_hint = false,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct AddWeightSample {
    /// Weight in kilograms (e.g. 70.0)
    pub weight_kg: f64,
    /// Timestamp in RFC3339 format (defaults to current time if omitted)
    #[serde(default)]
    pub timestamp: Option<String>,
    /// UTC offset string (e.g. "0s", "3600s"). Default "0s".
    #[serde(default)]
    pub utc_offset: Option<String>,
    /// If true, show the API request that would be made without executing it.
    #[serde(default)]
    pub dry_run: Option<bool>,
}

impl AddWeightSample {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        if self.weight_kg <= 0.0 || self.weight_kg > 500.0 {
            return err("weight_kg must be between 0 and 500 kg");
        }
        let ts = self.timestamp.clone().unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let offset = self.utc_offset.clone().unwrap_or_else(|| "0s".into());
        let grams = (self.weight_kg * 1000.0).round() as i64;
        let body = json!({
            "weight": {
                "sampleTime": {
                    "physicalTime": ts,
                    "utcOffset": offset
                },
                "weightGrams": grams
            }
        });
        let create_tool = CreateDataPoint {
            data_type: "weight".into(),
            body,
            dry_run: self.dry_run,
        };
        create_tool.call_tool(auth).await
    }
}

#[mcp_tool(
    name = "add_hydration_log",
    title = "Add Hydration Log",
    description = "Log a hydration event (time of drinking). Note: Google Health API v4 does not support recording volume.",
    read_only_hint = false,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct AddHydrationLog {
    /// Start timestamp in RFC3339 format (defaults to current time)
    #[serde(default)]
    pub start_time: Option<String>,
    /// End timestamp in RFC3339 format (defaults to start_time)
    #[serde(default)]
    pub end_time: Option<String>,
    /// UTC offset string (e.g. "0s", "3600s"). Default "0s".
    #[serde(default)]
    pub utc_offset: Option<String>,
    /// If true, show the API request that would be made without executing it.
    #[serde(default)]
    pub dry_run: Option<bool>,
}

impl AddHydrationLog {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let start = self.start_time.clone().unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let mut end = self.end_time.clone().unwrap_or_else(|| start.clone());
        if start == end {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&start) {
                end = (dt + chrono::Duration::seconds(60)).to_rfc3339();
            }
        }
        let offset = self.utc_offset.clone().unwrap_or_else(|| "0s".into());
        let body = json!({
            "hydrationLog": {
                "interval": {
                    "startTime": start,
                    "startUtcOffset": offset,
                    "endTime": end,
                    "endUtcOffset": offset
                }
            }
        });
        let create_tool = CreateDataPoint {
            data_type: "hydration-log".into(),
            body,
            dry_run: self.dry_run,
        };
        create_tool.call_tool(auth).await
    }
}

#[mcp_tool(
    name = "add_sleep_session",
    title = "Add Sleep Session",
    description = "Log a sleep session specifying start and end times. The API does not support titles/notes on sleep sessions.",
    read_only_hint = false,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct AddSleepSession {
    /// Start timestamp in RFC3339 format (e.g. 2026-07-25T23:00:00Z)
    pub start_time: String,
    /// End timestamp in RFC3339 format (e.g. 2026-07-26T07:00:00Z)
    pub end_time: String,
    /// UTC offset string (e.g. "0s", "3600s"). Default "0s".
    #[serde(default)]
    pub utc_offset: Option<String>,
    /// If true, show the API request without executing it.
    #[serde(default)]
    pub dry_run: Option<bool>,
}

impl AddSleepSession {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let start_dt = match chrono::DateTime::parse_from_rfc3339(&self.start_time) {
            Ok(dt) => dt,
            Err(e) => return err(&format!("Invalid start_time RFC3339: {e}")),
        };
        let end_dt = match chrono::DateTime::parse_from_rfc3339(&self.end_time) {
            Ok(dt) => dt,
            Err(e) => return err(&format!("Invalid end_time RFC3339: {e}")),
        };
        if start_dt >= end_dt {
            return err("end_time must be after start_time");
        }
        let offset = self.utc_offset.clone().unwrap_or_else(|| "0s".into());
        // The API rejects a `title` field on sleep data points (400 "Unknown name
        // 'title'"), so only the interval is sent.
        let sleep_obj = json!({
            "interval": {
                "startTime": self.start_time,
                "startUtcOffset": offset,
                "endTime": self.end_time,
                "endUtcOffset": offset
            }
        });
        let body = json!({ "sleep": sleep_obj });
        let create_tool = CreateDataPoint {
            data_type: "sleep".into(),
            body,
            dry_run: self.dry_run,
        };
        create_tool.call_tool(auth).await
    }
}

#[mcp_tool(
    name = "add_exercise_session",
    title = "Add Exercise Session",
    description = "Log an exercise session (workout). Exercise types: RUNNING, WALKING, CYCLING, STRENGTH_TRAINING, SWIMMING, YOGA, TREADMILL, HIIT, etc. The API does not support titles/notes on exercise sessions.",
    read_only_hint = false,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct AddExerciseSession {
    /// Exercise type (e.g. RUNNING, WALKING, CYCLING, STRENGTH_TRAINING, SWIMMING)
    pub exercise_type: String,
    /// Start timestamp in RFC3339 format (e.g. 2026-07-26T10:00:00Z)
    pub start_time: String,
    /// End timestamp in RFC3339 format (e.g. 2026-07-26T10:30:00Z)
    pub end_time: String,
    /// UTC offset string (e.g. "0s", "3600s"). Default "0s".
    #[serde(default)]
    pub utc_offset: Option<String>,
    /// If true, show the API request without executing it.
    #[serde(default)]
    pub dry_run: Option<bool>,
}

impl AddExerciseSession {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let start_dt = match chrono::DateTime::parse_from_rfc3339(&self.start_time) {
            Ok(dt) => dt,
            Err(e) => return err(&format!("Invalid start_time RFC3339: {e}")),
        };
        let end_dt = match chrono::DateTime::parse_from_rfc3339(&self.end_time) {
            Ok(dt) => dt,
            Err(e) => return err(&format!("Invalid end_time RFC3339: {e}")),
        };
        if start_dt >= end_dt {
            return err("end_time must be after start_time");
        }
        let offset = self.utc_offset.clone().unwrap_or_else(|| "0s".into());
        // The API rejects a `title` field on exercise data points (400 "Unknown
        // name 'title'"), so only type and interval are sent.
        let exercise_obj = json!({
            "exerciseType": self.exercise_type.to_uppercase(),
            "interval": {
                "startTime": self.start_time,
                "startUtcOffset": offset,
                "endTime": self.end_time,
                "endUtcOffset": offset
            }
        });
        let body = json!({ "exercise": exercise_obj });
        let create_tool = CreateDataPoint {
            data_type: "exercise".into(),
            body,
            dry_run: self.dry_run,
        };
        create_tool.call_tool(auth).await
    }
}

#[mcp_tool(
    name = "add_nutrition_log",
    title = "Add Nutrition Log",
    description = "Log a meal by type and time. The API only supports mealType and interval; nutrient details and food names are not supported.",
    read_only_hint = false,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct AddNutritionLog {
    /// Meal type: BREAKFAST, LUNCH, DINNER, SNACK
    pub meal_type: String,
    /// Start timestamp in RFC3339 format (defaults to current time)
    #[serde(default)]
    pub start_time: Option<String>,
    /// End timestamp in RFC3339 format (defaults to start_time + 30min)
    #[serde(default)]
    pub end_time: Option<String>,
    /// UTC offset string (e.g. "0s", "3600s"). Default "0s".
    #[serde(default)]
    pub utc_offset: Option<String>,
    /// If true, show the API request without executing it.
    #[serde(default)]
    pub dry_run: Option<bool>,
}

impl AddNutritionLog {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let valid_meals = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"];
        if !valid_meals.contains(&self.meal_type.to_uppercase().as_str()) {
            return err("meal_type must be one of: BREAKFAST, LUNCH, DINNER, SNACK");
        }
        let start = self.start_time.clone().unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let mut end = self.end_time.clone().unwrap_or_else(|| start.clone());
        if start == end {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&start) {
                end = (dt + chrono::Duration::minutes(30)).to_rfc3339();
            }
        }
        let offset = self.utc_offset.clone().unwrap_or_else(|| "0s".into());

        let nutrition_obj = json!({
            "mealType": self.meal_type.to_uppercase(),
            "interval": {
                "startTime": start,
                "startUtcOffset": offset,
                "endTime": end,
                "endUtcOffset": offset
            }
        });

        let body = json!({ "nutritionLog": nutrition_obj });
        let create_tool = CreateDataPoint {
            data_type: "nutrition-log".into(),
            body,
            dry_run: self.dry_run,
        };
        create_tool.call_tool(auth).await
    }
}

// ─── period comparison & analytics ───────────────────────────────────────────

#[mcp_tool(
    name = "compare_health_periods",
    title = "Compare Health Periods",
    description = "Compare health metrics (steps, active calories, etc.) between two date ranges (Period A vs Period B).",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct CompareHealthPeriods {
    /// Start date for Period A (YYYY-MM-DD)
    pub period_a_start: String,
    /// End date for Period A (YYYY-MM-DD)
    pub period_a_end: String,
    /// Start date for Period B (YYYY-MM-DD)
    pub period_b_start: String,
    /// End date for Period B (YYYY-MM-DD)
    pub period_b_end: String,
}

impl CompareHealthPeriods {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let date_a_start = match parse_civil_date(&self.period_a_start) {
            Ok(d) => d,
            Err(e) => return err(&e),
        };
        let date_a_end = match parse_civil_date(&self.period_a_end) {
            Ok(d) => d,
            Err(e) => return err(&e),
        };
        let date_b_start = match parse_civil_date(&self.period_b_start) {
            Ok(d) => d,
            Err(e) => return err(&e),
        };
        let date_b_end = match parse_civil_date(&self.period_b_end) {
            Ok(d) => d,
            Err(e) => return err(&e),
        };

        let summary_a = build_period_summary(auth, date_a_start, date_a_end).await;
        let summary_b = build_period_summary(auth, date_b_start, date_b_end).await;
        let comparison = calculate_deltas(&summary_a, &summary_b);

        let result = json!({
            "period_a": {
                "start": self.period_a_start,
                "end": self.period_a_end,
                "metrics": summary_a,
            },
            "period_b": {
                "start": self.period_b_start,
                "end": self.period_b_end,
                "metrics": summary_b,
            },
            "comparison_delta": comparison,
        });

        ok(&result)
    }
}

async fn build_period_summary(auth: &Arc<AuthState>, start: NaiveDate, end: NaiveDate) -> Value {
    let start_str = start.to_string();
    let end_str = (end + ChronoDuration::days(1)).to_string();

    // Fetch multiple metrics in parallel
    let metrics = [
        ("steps", "steps", "countSum"),
        ("active-energy-burned", "activeEnergyBurned", "kcalSum"),
        ("total-calories", "totalCalories", "kcalSum"),
        ("distance", "distance", "millimetersSum"),
        ("floors", "floors", "countSum"),
        ("heart-rate", "heartRate", "beatsPerMinuteAvg"),
    ];

    let mut handles = Vec::new();
    for &(dt, _camel, _field) in &metrics {
        let auth = Arc::clone(auth);
        let ss = start_str.clone();
        let es = end_str.clone();
        let dt = dt.to_string();
        handles.push(tokio::spawn(async move {
            let tool = DailyRollUpDataPoints {
                data_type: dt,
                start_date: ss,
                end_date: es,
                window_size_days: None,
                page_size: None,
                page_token: None,
                data_source_family: None,
                raw: Some(true),
            };
            tool.call_tool(&auth).await.ok().and_then(|r| r.structured_content)
        }));
    }

    // Also fetch sleep sessions
    let auth_sleep = Arc::clone(auth);
    let ss = start_str.clone();
    let es = end_str.clone();
    let sleep_handle = tokio::spawn(async move {
        let f = format!("sleep.interval.civil_end_time >= \"{ss}\" AND sleep.interval.civil_end_time < \"{es}\"");
        let mut all_points: Vec<Value> = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let tool = ListDataPoints {
                data_type: "sleep".into(),
                filter: Some(f.clone()),
                start_time: None,
                end_time: None,
                page_size: Some(25),
                page_token: page_token.clone(),
                raw: Some(true),
            };
            let sc = match tool.call_tool(&auth_sleep).await {
                Ok(r) => match r.structured_content {
                    Some(m) => Value::Object(m),
                    None => break,
                },
                Err(_) => break,
            };
            if let Some(pts) = sc.get("dataPoints").and_then(|v| v.as_array()) {
                all_points.extend(pts.iter().cloned());
            }
            match sc.get("nextPageToken").and_then(|v| v.as_str()) {
                Some(token) => page_token = Some(token.to_string()),
                None => break,
            }
        }
        if all_points.is_empty() {
            None
        } else {
            Some(json!({ "dataPoints": all_points }))
        }
    });

    // Fetch daily HRV
    let auth_hrv = Arc::clone(auth);
    let ss_hrv = start_str.clone();
    let es_hrv = end_str.clone();
    let hrv_handle = tokio::spawn(async move {
        let f = format!("daily_heart_rate_variability.date >= \"{ss_hrv}\" AND daily_heart_rate_variability.date < \"{es_hrv}\"");
        let tool = ListDataPoints {
            data_type: "daily-heart-rate-variability".into(),
            filter: Some(f),
            start_time: None,
            end_time: None,
            page_size: Some(100),
            page_token: None,
            raw: Some(true),
        };
        tool.call_tool(&auth_hrv).await.ok().and_then(|r| r.structured_content.map(|m| Value::Object(m)))
    });

    // Fetch daily resting HR
    let auth_rhr = Arc::clone(auth);
    let ss_rhr = start_str.clone();
    let es_rhr = end_str.clone();
    let rhr_handle = tokio::spawn(async move {
        let f = format!("daily_resting_heart_rate.date >= \"{ss_rhr}\" AND daily_resting_heart_rate.date < \"{es_rhr}\"");
        let tool = ListDataPoints {
            data_type: "daily-resting-heart-rate".into(),
            filter: Some(f),
            start_time: None,
            end_time: None,
            page_size: Some(100),
            page_token: None,
            raw: Some(true),
        };
        tool.call_tool(&auth_rhr).await.ok().and_then(|r| r.structured_content.map(|m| Value::Object(m)))
    });

    let results: Vec<Option<Value>> = futures::future::join_all(handles)
        .await
        .into_iter()
        .map(|r| r.unwrap_or(None).map(|m| Value::Object(m)))
        .collect();

    let sleep_sc = sleep_handle.await.unwrap_or(None);
    let hrv_sc = hrv_handle.await.unwrap_or(None);
    let rhr_sc = rhr_handle.await.unwrap_or(None);

    let days = (end - start).num_days() + 1;

    // Extract aggregate values from rollup responses
    let extract_sum = |sc: &Option<Value>, path: &str| -> f64 {
        sc.as_ref()
            .and_then(|v| v.get("rollupDataPoints"))
            .and_then(|v| v.as_array())
            .map(|pts| {
                pts.iter()
                    .filter_map(|p| {
                        p.pointer(path)
                            .and_then(as_num)
                    })
                    .sum::<f64>()
            })
            .unwrap_or(0.0)
    };

    let extract_avg = |sc: &Option<Value>, path: &str| -> f64 {
        sc.as_ref()
            .and_then(|v| v.get("rollupDataPoints"))
            .and_then(|v| v.as_array())
            .map(|pts| {
                let vals: Vec<f64> = pts
                    .iter()
                    .filter_map(|p| {
                        p.pointer(path)
                            .and_then(as_num)
                    })
                    .collect();
                if vals.is_empty() { 0.0 } else { vals.iter().sum::<f64>() / vals.len() as f64 }
            })
            .unwrap_or(0.0)
    };

    let total_steps = extract_sum(&results[0], "/steps/countSum") as u64;
    let total_calories = extract_sum(&results[1], "/activeEnergyBurned/kcalSum");
    let total_total_calories = extract_sum(&results[2], "/totalCalories/kcalSum");
    let total_distance_km = extract_sum(&results[3], "/distance/millimetersSum") / 1_000_000.0;
    let total_floors = extract_sum(&results[4], "/floors/countSum") as u64;
    let avg_hr = extract_avg(&results[5], "/heartRate/beatsPerMinuteAvg");

    // Extract sleep metrics (including deep/REM/awake/efficiency)
    let mut total_sleep_minutes: u64 = 0;
    let mut sleep_sessions = 0u64;
    let mut total_deep_minutes: u64 = 0;
    let mut total_rem_minutes: u64 = 0;
    let mut total_awake_minutes: u64 = 0;
    let mut total_sleep_in_period: u64 = 0;
    if let Some(sc) = sleep_sc {
        if let Some(pts) = sc.get("dataPoints").and_then(|v| v.as_array()) {
            for p in pts {
                if let Some(mins) = p.pointer("/sleep/summary/minutesAsleep")
                    .and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok()).or_else(|| v.as_u64()))
                {
                    total_sleep_minutes += mins;
                    sleep_sessions += 1;
                }
                if let Some(mins) = p.pointer("/sleep/summary/minutesInSleepPeriod")
                    .and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok()).or_else(|| v.as_u64()))
                {
                    total_sleep_in_period += mins;
                }
                // Deep/REM minutes come from stagesSummary array, nested under summary
                if let Some(stages) = p.pointer("/sleep/summary/stagesSummary").and_then(|v| v.as_array()) {
                    for stage in stages {
                        let stage_type = stage.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        let mins = stage.get("minutes")
                            .and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok()).or_else(|| v.as_u64()))
                            .unwrap_or(0);
                        match stage_type {
                            "DEEP" => total_deep_minutes += mins,
                            "REM" => total_rem_minutes += mins,
                            _ => {}
                        }
                    }
                }
                if let Some(mins) = p.pointer("/sleep/summary/minutesAwake")
                    .and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok()).or_else(|| v.as_u64()))
                {
                    total_awake_minutes += mins;
                }
            }
        }
    }

    // Extract HRV average from daily HRV data
    let mut hrv_values: Vec<f64> = Vec::new();
    if let Some(sc) = &hrv_sc {
        if let Some(pts) = sc.get("dataPoints").and_then(|v| v.as_array()) {
            for p in pts {
                if let Some(val) = p
                    .get("dailyHeartRateVariability")
                    .and_then(|h| h.get("averageHeartRateVariabilityMilliseconds"))
                    .and_then(as_num)
                {
                    hrv_values.push(val);
                }
            }
        }
    }
    let avg_hrv = if !hrv_values.is_empty() {
        hrv_values.iter().sum::<f64>() / hrv_values.len() as f64
    } else {
        0.0
    };

    // Extract resting HR average from daily RHR data
    let mut rhr_values: Vec<f64> = Vec::new();
    if let Some(sc) = &rhr_sc {
        if let Some(pts) = sc.get("dataPoints").and_then(|v| v.as_array()) {
            for p in pts {
                if let Some(val) = p
                    .get("dailyRestingHeartRate")
                    .and_then(|h| h.get("beatsPerMinute"))
                    .and_then(as_num)
                {
                    rhr_values.push(val);
                }
            }
        }
    }
    let avg_rhr = if !rhr_values.is_empty() {
        rhr_values.iter().sum::<f64>() / rhr_values.len() as f64
    } else {
        0.0
    };

    let avg_steps = if days > 0 { total_steps / days as u64 } else { 0 };
    let avg_calories = if days > 0 { total_calories / days as f64 } else { 0.0 };
    let avg_total_cal = if days > 0 { total_total_calories / days as f64 } else { 0.0 };
    let avg_distance = if days > 0 { total_distance_km / days as f64 } else { 0.0 };
    let avg_floors = if days > 0 { total_floors / days as u64 } else { 0 };
    let avg_sleep = if sleep_sessions > 0 { total_sleep_minutes / sleep_sessions } else { 0 };
    let avg_deep = if sleep_sessions > 0 { total_deep_minutes / sleep_sessions } else { 0 };
    let avg_rem = if sleep_sessions > 0 { total_rem_minutes / sleep_sessions } else { 0 };
    let avg_awake = if sleep_sessions > 0 { total_awake_minutes / sleep_sessions } else { 0 };
    let avg_efficiency = if total_sleep_in_period > 0 {
        (total_sleep_minutes as f64 / total_sleep_in_period as f64) * 100.0
    } else {
        0.0
    };

    json!({
        "days_count": days,
        "total_steps": total_steps,
        "avg_daily_steps": avg_steps,
        "total_active_calories_kcal": (total_calories * 10.0).round() / 10.0,
        "avg_daily_active_calories_kcal": (avg_calories * 10.0).round() / 10.0,
        "total_calories_kcal": (total_total_calories * 10.0).round() / 10.0,
        "avg_daily_total_calories_kcal": (avg_total_cal * 10.0).round() / 10.0,
        "total_distance_km": (total_distance_km * 100.0).round() / 100.0,
        "avg_daily_distance_km": (avg_distance * 100.0).round() / 100.0,
        "total_floors": total_floors,
        "avg_daily_floors": avg_floors,
        "avg_heart_rate_bpm": (avg_hr * 10.0).round() / 10.0,
        "sleep_sessions": sleep_sessions,
        "total_sleep_minutes": total_sleep_minutes,
        "avg_sleep_minutes": avg_sleep,
        "avg_deep_sleep_minutes": avg_deep,
        "avg_rem_sleep_minutes": avg_rem,
        "avg_awake_minutes": avg_awake,
        "avg_sleep_efficiency_pct": (avg_efficiency * 10.0).round() / 10.0,
        "avg_hrv_ms": (avg_hrv * 10.0).round() / 10.0,
        "avg_resting_hr_bpm": (avg_rhr * 10.0).round() / 10.0,
    })
}

fn calculate_deltas(a: &Value, b: &Value) -> Value {
    let delta = |key: &str| -> Value {
        let va = a[key].as_f64().unwrap_or(a[key].as_u64().unwrap_or(0) as f64);
        let vb = b[key].as_f64().unwrap_or(b[key].as_u64().unwrap_or(0) as f64);
        let diff = vb - va;
        let pct = if va.abs() > 0.0 { (diff / va) * 100.0 } else { 0.0 };
        json!({
            "period_a": va,
            "period_b": vb,
            "diff": (diff * 100.0).round() / 100.0,
            "percentage_change": format!("{:.1}%", pct),
        })
    };

    json!({
        "avg_daily_steps": delta("avg_daily_steps"),
        "avg_daily_active_calories_kcal": delta("avg_daily_active_calories_kcal"),
        "avg_daily_total_calories_kcal": delta("avg_daily_total_calories_kcal"),
        "avg_daily_distance_km": delta("avg_daily_distance_km"),
        "avg_daily_floors": delta("avg_daily_floors"),
        "avg_heart_rate_bpm": delta("avg_heart_rate_bpm"),
        "avg_sleep_minutes": delta("avg_sleep_minutes"),
        "avg_deep_sleep_minutes": delta("avg_deep_sleep_minutes"),
        "avg_rem_sleep_minutes": delta("avg_rem_sleep_minutes"),
        "avg_awake_minutes": delta("avg_awake_minutes"),
        "avg_sleep_efficiency_pct": delta("avg_sleep_efficiency_pct"),
        "avg_hrv_ms": delta("avg_hrv_ms"),
        "avg_resting_hr_bpm": delta("avg_resting_hr_bpm"),
    })
}

#[mcp_tool(
    name = "get_hrv_recovery_trend",
    title = "Get HRV & Recovery Trend",
    description = "Analyze HRV (Heart Rate Variability) and resting heart rate trends over past N days to evaluate physical recovery status.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct GetHrvRecoveryTrend {
    /// Number of past days to analyze (default 14, max 90)
    #[serde(default)]
    pub days: Option<u32>,
    /// End date (YYYY-MM-DD, defaults to today)
    #[serde(default)]
    pub end_date: Option<String>,
}

impl GetHrvRecoveryTrend {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let days_count = self.days.unwrap_or(14).min(90).max(1);
        let end = match &self.end_date {
            Some(s) => match parse_civil_date(s) {
                Ok(d) => d,
                Err(e) => return err(&e),
            },
            None => Local::now().date_naive(),
        };
        let start = end - ChronoDuration::days(days_count as i64 - 1);

        // The API only supports `<` (not `<=`) for date filters, so use end + 1 day
        // as the exclusive upper bound.
        let end_plus_one = end + ChronoDuration::days(1);
        let filter = format!("daily_heart_rate_variability.date >= \"{start}\" AND daily_heart_rate_variability.date < \"{end_plus_one}\"");
        let hrv_tool = ListDataPoints {
            data_type: "daily-heart-rate-variability".into(),
            filter: Some(filter),
            start_time: None,
            end_time: None,
            page_size: Some(100),
            page_token: None,
            raw: Some(true),
        };

        let rhr_filter = format!("daily_resting_heart_rate.date >= \"{start}\" AND daily_resting_heart_rate.date < \"{end_plus_one}\"");
        let rhr_tool = ListDataPoints {
            data_type: "daily-resting-heart-rate".into(),
            filter: Some(rhr_filter),
            start_time: None,
            end_time: None,
            page_size: Some(100),
            page_token: None,
            raw: Some(true),
        };

        // tokio::join! runs both fetches concurrently. Each branch maps away the
        // non-Send CallToolError before it can be held across an await point,
        // keeping the enclosing future Send.
        let (hrv_sc, rhr_sc) = tokio::join!(
            async { hrv_tool.call_tool(auth).await.ok().and_then(|r| r.structured_content.map(|m| Value::Object(m))) },
            async { rhr_tool.call_tool(auth).await.ok().and_then(|r| r.structured_content.map(|m| Value::Object(m))) },
        );

        let mut hrv_values: Vec<f64> = Vec::new();
        let mut hrv_daily: Vec<Value> = Vec::new();
        if let Some(sc) = hrv_sc {
            if let Some(pts) = sc.get("dataPoints").and_then(|v| v.as_array()) {
                for p in pts {
                    let hrv_obj = p.get("dailyHeartRateVariability");
                    // API field: averageHeartRateVariabilityMilliseconds (not rmssdMilliseconds)
                    if let Some(rmssd) = hrv_obj
                        .and_then(|h| h.get("averageHeartRateVariabilityMilliseconds"))
                        .and_then(as_num)
                    {
                        hrv_values.push(rmssd);
                        // date is a {year, month, day} object; normalize to "YYYY-MM-DD"
                        let date = hrv_obj
                            .and_then(|h| h.get("date"))
                            .map(date_obj_to_str);
                        let entropy = hrv_obj
                            .and_then(|h| h.get("entropy"))
                            .and_then(|v| v.as_f64());
                        let deep_rmssd = hrv_obj
                            .and_then(|h| h.get("deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds"))
                            .and_then(|v| v.as_f64());
                        let non_rem_hr = hrv_obj
                            .and_then(|h| h.get("nonRemHeartRateBeatsPerMinute"))
                            .and_then(|v| v.as_str().and_then(|s| s.parse::<f64>().ok()));
                        hrv_daily.push(json!({
                            "date": date,
                            "avg_hrv_ms": rmssd,
                            "entropy": entropy,
                            "deep_sleep_hrv_ms": deep_rmssd,
                            "non_rem_hr_bpm": non_rem_hr,
                        }));
                    }
                }
            }
        }

        let mut rhr_values: Vec<f64> = Vec::new();
        let mut rhr_daily: Vec<Value> = Vec::new();
        if let Some(sc) = rhr_sc {
            if let Some(pts) = sc.get("dataPoints").and_then(|v| v.as_array()) {
                for p in pts {
                    let rhr_obj = p.get("dailyRestingHeartRate");
                    if let Some(bpm) = rhr_obj
                        .and_then(|h| h.get("beatsPerMinute"))
                        .and_then(as_num)
                    {
                        rhr_values.push(bpm);
                        // date is a {year, month, day} object; normalize to "YYYY-MM-DD"
                        let date = rhr_obj
                            .and_then(|h| h.get("date"))
                            .map(date_obj_to_str);
                        let method = rhr_obj
                            .and_then(|h| h.pointer("/dailyRestingHeartRateMetadata/calculationMethod"))
                            .and_then(|v| v.as_str());
                        rhr_daily.push(json!({
                            "date": date,
                            "bpm": bpm,
                            "calculation_method": method,
                        }));
                    }
                }
            }
        }

        // Sort daily entries by date for baseline/current splitting
        let mut hrv_sorted: Vec<(String, f64)> = hrv_daily
            .iter()
            .filter_map(|d| {
                let date = d.get("date")?.as_str()?.to_string();
                let val = d.get("avg_hrv_ms")?.as_f64()?;
                Some((date, val))
            })
            .collect();
        hrv_sorted.sort_by(|a, b| a.0.cmp(&b.0));

        let mut rhr_sorted: Vec<(String, f64)> = rhr_daily
            .iter()
            .filter_map(|d| {
                let date = d.get("date")?.as_str()?.to_string();
                let val = d.get("bpm")?.as_f64()?;
                Some((date, val))
            })
            .collect();
        rhr_sorted.sort_by(|a, b| a.0.cmp(&b.0));

        let hrv_avg = if !hrv_values.is_empty() {
            hrv_values.iter().sum::<f64>() / hrv_values.len() as f64
        } else {
            0.0
        };

        let rhr_avg = if !rhr_values.is_empty() {
            rhr_values.iter().sum::<f64>() / rhr_values.len() as f64
        } else {
            0.0
        };

        // Personalized readiness: baseline = all days except last 3, current = last 3 days (no overlap)
        let baseline_period_label: String;
        let (readiness, baseline_hrv, baseline_rhr, current_hrv, current_rhr) =
            if hrv_sorted.len() >= 4 {
                // Baseline: days[0..len-3], Current: days[len-3..len]
                let bl_end = hrv_sorted.len() - 3;
                baseline_period_label = format!("first {bl_end} days");
                let bl_hrv: f64 = hrv_sorted[..bl_end].iter().map(|(_, v)| *v).sum::<f64>() / bl_end as f64;
                let bl_rhr: f64 = if rhr_sorted.len() >= 4 {
                    let rhr_bl_end = rhr_sorted.len() - 3;
                    rhr_sorted[..rhr_bl_end].iter().map(|(_, v)| *v).sum::<f64>() / rhr_bl_end as f64
                } else if !rhr_sorted.is_empty() {
                    rhr_sorted.iter().map(|(_, v)| *v).sum::<f64>() / rhr_sorted.len() as f64
                } else {
                    0.0
                };
                // Current: last 3 days
                let cur_hrv: f64 = hrv_sorted[bl_end..]
                    .iter()
                    .map(|(_, v)| *v)
                    .sum::<f64>()
                    / 3.0;
                let cur_rhr_len = rhr_sorted.len().min(3);
                let cur_rhr: f64 = if cur_rhr_len > 0 {
                    rhr_sorted[rhr_sorted.len() - cur_rhr_len..]
                        .iter()
                        .map(|(_, v)| *v)
                        .sum::<f64>()
                        / cur_rhr_len as f64
                } else {
                    0.0
                };
                let status = if cur_hrv >= bl_hrv * 0.95
                    && (bl_rhr == 0.0 || cur_rhr <= bl_rhr * 1.05)
                {
                    "HIGH"
                } else if cur_hrv >= bl_hrv * 0.85 {
                    "MODERATE"
                } else {
                    "LOW / RECOVERY NEEDED"
                };
                (status, bl_hrv, bl_rhr, cur_hrv, cur_rhr)
            } else {
                // Not enough data for personalized baseline; fall back to overall average
                baseline_period_label = "first 7 days".to_string();
                let status = if hrv_avg > 50.0 && (rhr_avg > 0.0 && rhr_avg < 65.0) {
                    "HIGH"
                } else if hrv_avg > 30.0 {
                    "MODERATE"
                } else {
                    "LOW / RECOVERY NEEDED"
                };
                (status, 0.0, 0.0, hrv_avg, rhr_avg)
            };

        let result = json!({
            "period": {
                "start_date": start.to_string(),
                "end_date": end.to_string(),
                "days": days_count,
            },
            "hrv_metrics": {
                "sample_count": hrv_values.len(),
                "avg_hrv_ms": (hrv_avg * 10.0).round() / 10.0,
                "min_hrv_ms": if hrv_values.is_empty() { 0.0 } else { hrv_values.iter().cloned().fold(f64::INFINITY, f64::min) },
                "max_hrv_ms": if hrv_values.is_empty() { 0.0 } else { hrv_values.iter().cloned().fold(f64::NEG_INFINITY, f64::max) },
            },
            "resting_hr_metrics": {
                "sample_count": rhr_values.len(),
                "avg_bpm": (rhr_avg * 10.0).round() / 10.0,
                "min_bpm": if rhr_values.is_empty() { 0.0 } else { rhr_values.iter().cloned().fold(f64::INFINITY, f64::min) },
                "max_bpm": if rhr_values.is_empty() { 0.0 } else { rhr_values.iter().cloned().fold(f64::NEG_INFINITY, f64::max) },
            },
            "baseline": {
                "period": baseline_period_label,
                "hrv_avg_ms": (baseline_hrv * 10.0).round() / 10.0,
                "rhr_avg_bpm": (baseline_rhr * 10.0).round() / 10.0,
                "data_sufficient": hrv_sorted.len() >= 4,
            },
            "current": {
                "period": "last 3 days",
                "hrv_avg_ms": (current_hrv * 10.0).round() / 10.0,
                "rhr_avg_bpm": (current_rhr * 10.0).round() / 10.0,
            },
            "daily_hrv": hrv_daily,
            "daily_rhr": rhr_daily,
            "readiness_assessment": readiness,
        });

        ok(&result)
    }
}

#[mcp_tool(
    name = "get_temperature_summary",
    title = "Get Temperature Summary",
    description = "Get core body temperature and daily sleep temperature derivations for a period.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct GetTemperatureSummary {
    /// Start date (YYYY-MM-DD)
    pub start_date: String,
    /// End date (YYYY-MM-DD)
    pub end_date: String,
}

impl GetTemperatureSummary {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let start = match parse_civil_date(&self.start_date) {
            Ok(d) => d,
            Err(e) => return err(&e),
        };
        let end = match parse_civil_date(&self.end_date) {
            Ok(d) => d,
            Err(e) => return err(&e),
        };
        let end_exclusive = end + ChronoDuration::days(1);
        let core_filter = format!("core_body_temperature.sample_time.physical_time >= \"{}T00:00:00Z\" AND core_body_temperature.sample_time.physical_time < \"{}T00:00:00Z\"", start, end_exclusive);
        let core_tool = ListDataPoints {
            data_type: "core-body-temperature".into(),
            filter: Some(core_filter),
            start_time: None,
            end_time: None,
            page_size: Some(100),
            page_token: None,
            raw: Some(true),
        };

        // The API only supports `<` (not `<=`) for date filters; end_exclusive is end + 1 day.
        let sleep_temp_filter = format!("daily_sleep_temperature_derivations.date >= \"{}\" AND daily_sleep_temperature_derivations.date < \"{}\"", self.start_date, end_exclusive);
        let sleep_temp_tool = ListDataPoints {
            data_type: "daily-sleep-temperature-derivations".into(),
            filter: Some(sleep_temp_filter),
            start_time: None,
            end_time: None,
            page_size: Some(100),
            page_token: None,
            raw: Some(true),
        };

        // Concurrent fetch; map away the non-Send CallToolError inside each branch
        // so the enclosing future stays Send.
        let (core_sc, sleep_temp_sc) = tokio::join!(
            async { core_tool.call_tool(auth).await.ok().and_then(|r| r.structured_content) },
            async { sleep_temp_tool.call_tool(auth).await.ok().and_then(|r| r.structured_content) },
        );

        let result = json!({
            "period": {
                "start_date": self.start_date,
                "end_date": self.end_date,
            },
            "core_body_temperature": core_sc,
            "daily_sleep_temperature_derivations": sleep_temp_sc,
            "note": "Google Health API v4 core-body-temperature is read-only; entries are synced automatically from connected wearables."
        });

        ok(&result)
    }
}

// ─── patch (update) ──────────────────────────────────────────────────────────

#[mcp_tool(
    name = "patch_data_point",
    title = "Patch Data Point",
    description = "Update an existing data point. Provide data type, data point ID, and the fields to update as a JSON object.",
    read_only_hint = false,
    destructive_hint = false,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct PatchDataPoint {
    /// Data type ID (kebab-case)
    pub data_type: String,
    /// Data point ID
    pub data_point_id: String,
    /// Fields to update as JSON (DataPoint structure)
    pub body: Value,
}

impl PatchDataPoint {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let url = if self.data_point_id.starts_with("users/") {
            format!("https://health.googleapis.com/v4/{}", self.data_point_id)
        } else {
            format!(
                "{BASE}/dataTypes/{}/dataPoints/{}",
                self.data_type, self.data_point_id
            )
        };
        match auth.api_patch(&url, &self.body).await {
            Ok(v) => {
                auth.cache.clear().await;
                ok(&v)
            }
            Err(e) => api_err(&e),
        }
    }
}

// ─── delete ──────────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "delete_data_point",
    title = "Delete Data Point",
    description = "Delete a single data point by its data type and data point ID.",
    read_only_hint = false,
    destructive_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct DeleteDataPoint {
    /// Data type ID (kebab-case)
    pub data_type: String,
    /// Data point ID (from listed data point name or ID)
    pub data_point_id: String,
}

impl DeleteDataPoint {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let name = if self.data_point_id.starts_with("users/") {
            self.data_point_id.clone()
        } else {
            format!("users/me/dataTypes/{}/dataPoints/{}", self.data_type, self.data_point_id)
        };
        let batch_tool = BatchDeleteDataPoints {
            data_type: self.data_type.clone(),
            names: vec![name],
        };
        batch_tool.call_tool(auth).await
    }
}

// ─── batchDelete ─────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "batch_delete_data_points",
    title = "Batch Delete Data Points",
    description = "Delete multiple data points by their full resource names. Max 10000 per request. Supported types: sleep, exercise, weight, height, body-fat, hydration-log, nutrition-log.",
    read_only_hint = false,
    destructive_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct BatchDeleteDataPoints {
    /// Data type ID (kebab-case), or '-' for cross-type delete
    pub data_type: String,
    /// List of full resource names to delete (e.g. ["users/me/dataTypes/weight/dataPoints/123456"])
    pub names: Vec<String>,
}

impl BatchDeleteDataPoints {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let url = format!(
            "{BASE}/dataTypes/{}/dataPoints:batchDelete",
            self.data_type
        );
        let body = json!({ "names": self.names });
        match auth.api_post(&url, &body).await {
            Ok(v) => {
                auth.cache.clear().await;
                ok(&v)
            }
            Err(e) => api_err(&e),
        }
    }
}

// ─── exportExerciseTcx ───────────────────────────────────────────────────────

#[mcp_tool(
    name = "export_exercise_tcx",
    title = "Export Exercise TCX",
    description = "Export an exercise data point as TCX (Training Center XML). Requires both activity_and_fitness.readonly and location.readonly scopes. Add ?alt=media for raw TCX download.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct ExportExerciseTcx {
    /// Data point ID of the exercise (numeric)
    pub data_point_id: String,
    /// Include partial data when GPS unavailable (default false)
    #[serde(default)]
    pub partial_data: Option<bool>,
}

impl ExportExerciseTcx {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        // alt=media asks Google to return the raw TCX XML (surfaced in `rawBody`)
        // instead of a JSON wrapper.
        let mut params = vec!["alt=media".to_string()];
        if let Some(true) = self.partial_data {
            params.push("partialData=true".to_string());
        }
        let url = format!(
            "{BASE}/dataTypes/exercise/dataPoints/{}:exportExerciseTcx?{}",
            self.data_point_id,
            params.join("&")
        );

        // auth.api_get already retries 429/5xx with backoff; no outer retry needed.
        match auth.api_get(&url).await {
            Ok(v) => ok(&v),
            Err(e) => api_err(&e),
        }
    }
}

// ─── profile ─────────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "get_profile",
    title = "Get Profile",
    description = "Get the user's Google Health profile (name, birthdate, gender, etc).",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct GetProfile {}

impl GetProfile {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        match auth.api_get(&format!("{BASE}/profile")).await {
            Ok(v) => ok(&v),
            Err(e) => api_err(&e),
        }
    }
}

#[mcp_tool(
    name = "update_profile",
    title = "Update Profile",
    description = "Update the user's Google Health profile fields. Provide fields as a JSON object.",
    read_only_hint = false,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct UpdateProfile {
    /// Profile fields to update as JSON
    pub body: Value,
}

impl UpdateProfile {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        match auth.api_patch(&format!("{BASE}/profile"), &self.body).await {
            Ok(v) => ok(&v),
            Err(e) => api_err(&e),
        }
    }
}

// ─── settings ────────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "get_settings",
    title = "Get Settings",
    description = "Get the user's Google Health settings (units, preferences).",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct GetSettings {}

impl GetSettings {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        match auth.api_get(&format!("{BASE}/settings")).await {
            Ok(v) => ok(&v),
            Err(e) => api_err(&e),
        }
    }
}

#[mcp_tool(
    name = "update_settings",
    title = "Update Settings",
    description = "Update the user's Google Health settings. Provide fields as a JSON object.",
    read_only_hint = false,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct UpdateSettings {
    /// Settings fields to update as JSON
    pub body: Value,
}

impl UpdateSettings {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        match auth.api_patch(&format!("{BASE}/settings"), &self.body).await {
            Ok(v) => ok(&v),
            Err(e) => api_err(&e),
        }
    }
}

// ─── identity ────────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "get_identity",
    title = "Get Identity",
    description = "Get the user's Google Health identity information.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct GetIdentity {}

impl GetIdentity {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        match auth.api_get(&format!("{BASE}/identity")).await {
            Ok(v) => ok(&v),
            Err(e) => api_err(&e),
        }
    }
}

// ─── IRN profile ─────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "get_irn_profile",
    title = "Get IRN Profile",
    description = "Get the user's Irregular Rhythm Notification profile.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct GetIrnProfile {}

impl GetIrnProfile {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        match auth.api_get(&format!("{BASE}/irnProfile")).await {
            Ok(v) => ok(&v),
            Err(e) => api_err(&e),
        }
    }
}

// ─── paired devices ──────────────────────────────────────────────────────────

#[mcp_tool(
    name = "list_paired_devices",
    title = "List Paired Devices",
    description = "List all devices paired with the user's Google Health account.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct ListPairedDevices {}

impl ListPairedDevices {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        match auth.api_get(&format!("{BASE}/pairedDevices")).await {
            Ok(v) => ok(&v),
            Err(e) => api_err(&e),
        }
    }
}

#[mcp_tool(
    name = "get_paired_device",
    title = "Get Paired Device",
    description = "Get details of a specific paired device.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct GetPairedDevice {
    /// Device ID
    pub device_id: String,
}

impl GetPairedDevice {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let url = format!("{BASE}/pairedDevices/{}", self.device_id);
        match auth.api_get(&url).await {
            Ok(v) => ok(&v),
            Err(e) => api_err(&e),
        }
    }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/// RFC 3986 unreserved set: ALPHA / DIGIT / "-" / "." / "_" / "~".
/// Everything else (spaces, quotes, <>=&, #, %, non-ASCII) is percent-encoded.
const ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'.').remove(b'_').remove(b'~');

fn urlenc(s: &str) -> String {
    utf8_percent_encode(s, ENCODE_SET).to_string()
}

fn parse_civil_date(s: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| format!("Invalid date '{s}': expected YYYY-MM-DD (e.g. 2026-07-25)"))
}

/// Object {year, month, day} for dailyRollUp request bodies.
fn date_obj(d: NaiveDate) -> Value {
    json!({ "year": d.year(), "month": d.month(), "day": d.day() })
}

/// The API returns civil dates as objects `{year, month, day}` (not strings).
/// Normalize such an object into a "YYYY-MM-DD" string.
fn date_obj_to_str(d: &Value) -> String {
    let y = d.get("year").and_then(|v| v.as_u64()).unwrap_or(0);
    let m = d.get("month").and_then(|v| v.as_u64()).unwrap_or(0);
    let day = d.get("day").and_then(|v| v.as_u64()).unwrap_or(0);
    format!("{y:04}-{m:02}-{day:02}")
}

// ─── daily summary ───────────────────────────────────────────────────────────

/// Single upstream summary request: (summary key, value, error).
/// "No data for day" → None without error (field simply omitted).
type SummaryTask =
    Pin<Box<dyn Future<Output = (&'static str, Option<Value>, Option<String>)> + Send>>;

/// Upstream request concurrency — like batches in production dashboard (summary.ts).
const CONCURRENCY: usize = 10;

/// dailyRollUp metrics: (data_type, rollup value field, summary key)
const ROLLUP_SPECS: &[(&str, &str, &str)] = &[
    ("steps", "steps", "steps"),
    ("heart-rate", "heartRate", "heart_rate"),
    ("active-energy-burned", "activeEnergyBurned", "active_calories"),
    ("total-calories", "totalCalories", "total_calories"),
    ("distance", "distance", "distance"),
    ("active-minutes", "activeMinutes", "active_minutes"),
    ("active-zone-minutes", "activeZoneMinutes", "active_zone_minutes"),
    ("floors", "floors", "floors"),
    ("time-in-heart-rate-zone", "timeInHeartRateZone", "time_in_heart_rate_zone"),
    ("calories-in-heart-rate-zone", "caloriesInHeartRateZone", "calories_in_heart_rate_zone"),
    ("altitude", "altitude", "altitude"),
    ("swim-lengths-data", "swimLengthsData", "swim_lengths"),
    ("weight", "weight", "weight_rollup"),
    ("body-fat", "bodyFat", "body_fat"),
    ("blood-glucose", "bloodGlucose", "blood_glucose"),
    ("core-body-temperature", "coreBodyTemperature", "core_body_temperature"),
    ("run-vo2-max", "runVo2Max", "run_vo2_max"),
    ("sedentary-period", "sedentaryPeriod", "sedentary_period"),
    ("nutrition-log", "nutritionLog", "nutrition_log"),
    ("hydration-log", "hydrationLog", "hydration_log"),
];

/// Daily types (list, pageSize=1, filter `{f}.date`): (data_type, filter field, data field, key)
const DAILY_SPECS: &[(&str, &str, &str, &str)] = &[
    ("daily-resting-heart-rate", "daily_resting_heart_rate", "dailyRestingHeartRate", "resting_heart_rate"),
    ("daily-heart-rate-variability", "daily_heart_rate_variability", "dailyHeartRateVariability", "heart_rate_variability"),
    ("daily-oxygen-saturation", "daily_oxygen_saturation", "dailyOxygenSaturation", "oxygen_saturation"),
    ("daily-respiratory-rate", "daily_respiratory_rate", "dailyRespiratoryRate", "respiratory_rate"),
    ("daily-sleep-temperature-derivations", "daily_sleep_temperature_derivations", "dailySleepTemperatureDerivations", "sleep_temperature"),
    ("daily-vo2-max", "daily_vo2_max", "dailyVo2Max", "daily_vo2_max"),
    ("daily-heart-rate-zones", "daily_heart_rate_zones", "dailyHeartRateZones", "daily_heart_rate_zones"),
];

/// Raw samples (list, pageSize=1, filter `{f}.sample_time.civil_time`)
const SAMPLE_SPECS: &[(&str, &str, &str, &str)] = &[
    ("vo2-max", "vo2_max", "vo2Max", "vo2_max"),
    ("heart-rate-variability", "heart_rate_variability", "heartRateVariability", "hrv_sample"),
    ("oxygen-saturation", "oxygen_saturation", "oxygenSaturation", "spo2_sample"),
    ("respiratory-rate-sleep-summary", "respiratory_rate_sleep_summary", "respiratoryRateSleepSummary", "respiratory_rate_sleep"),
];

/// Extracts a field from the first data point in a list response.
///
/// NOTE: The Google Health API does not guarantee any particular ordering of
/// data points in list responses. `pts.first()` is NOT necessarily the newest
/// or oldest entry. For sample types where "latest" matters (e.g. weight,
/// vo2-max), the caller should sort by sampleTime before picking a value.
/// In the daily summary context this is acceptable because pageSize=1 with a
/// single-day filter typically returns at most one relevant point, but the
/// caveat applies if multiple points exist for the same day.
fn first_point_field(v: &Value, field: &str) -> Option<Value> {
    v.get("dataPoints")
        .and_then(|p| p.as_array())
        .and_then(|pts| pts.first())
        .and_then(|p| p.get(field))
        .cloned()
}

/// Full summary for a date: ~34 upstream requests, concurrent up to CONCURRENCY.
/// Per-metric errors are collected in `_errors`; missing field = no data.
pub(crate) async fn build_daily_summary(auth: &Arc<AuthState>, date: NaiveDate) -> Value {
    let date_s = date.format("%Y-%m-%d").to_string();
    let next_s = (date + ChronoDuration::days(1)).format("%Y-%m-%d").to_string();
    let mut summary = json!({ "date": date_s });

    let rollup_body = json!({
        "range": {
            "start": { "date": date_obj(date) },
            "end": { "date": date_obj(date + ChronoDuration::days(1)) },
        },
        "windowSizeDays": 1,
    });

    let mut tasks: Vec<SummaryTask> = Vec::with_capacity(34);

    // ── dailyRollUp metrics (20) ──
    for &(dt, field, key) in ROLLUP_SPECS {
        let auth = Arc::clone(auth);
        let body = rollup_body.clone();
        tasks.push(Box::pin(async move {
            let url = format!("{BASE}/dataTypes/{dt}/dataPoints:dailyRollUp");
            match auth.api_post(&url, &body).await {
                Ok(v) => (
                    key,
                    v.pointer("/rollupDataPoints/0").and_then(|p| p.get(field)).cloned(),
                    None,
                ),
                Err(e) => (key, None, Some(format!("{dt}: {e}"))),
            }
        }));
    }

    // ── daily types (7) ──
    for &(dt, ffield, dfield, key) in DAILY_SPECS {
        let auth = Arc::clone(auth);
        let f = format!("{ffield}.date >= \"{date_s}\" AND {ffield}.date < \"{next_s}\"");
        tasks.push(Box::pin(async move {
            let url = format!("{BASE}/dataTypes/{dt}/dataPoints?filter={}&pageSize=1", urlenc(&f));
            match auth.api_get(&url).await {
                Ok(v) => (key, first_point_field(&v, dfield), None),
                Err(e) => (key, None, Some(format!("{dt}: {e}"))),
            }
        }));
    }

    // ── raw samples by civil time (4) ──
    for &(dt, ffield, dfield, key) in SAMPLE_SPECS {
        let auth = Arc::clone(auth);
        let f = format!("{ffield}.sample_time.civil_time >= \"{date_s}\" AND {ffield}.sample_time.civil_time < \"{next_s}\"");
        tasks.push(Box::pin(async move {
            let url = format!("{BASE}/dataTypes/{dt}/dataPoints?filter={}&pageSize=1", urlenc(&f));
            match auth.api_get(&url).await {
                Ok(v) => (key, first_point_field(&v, dfield), None),
                Err(e) => (key, None, Some(format!("{dt}: {e}"))),
            }
        }));
    }

    // ── sleep (array, up to 5 records, stages + summary) ──
    {
        let auth = Arc::clone(auth);
        let f = format!("sleep.interval.civil_end_time >= \"{date_s}\" AND sleep.interval.civil_end_time < \"{next_s}\"");
        tasks.push(Box::pin(async move {
            let url = format!("{BASE}/dataTypes/sleep/dataPoints?filter={}&pageSize=5", urlenc(&f));
            match auth.api_get(&url).await {
                Ok(v) => {
                    let sleeps: Vec<Value> = v
                        .get("dataPoints")
                        .and_then(|p| p.as_array())
                        .map(|pts| {
                            pts.iter()
                                .filter_map(|p| {
                                    let s = p.get("sleep")?;
                                    Some(json!({
                                        "start": s.pointer("/interval/startTime"),
                                        "end": s.pointer("/interval/endTime"),
                                        "startUtcOffset": s.pointer("/interval/startUtcOffset"),
                                        "endUtcOffset": s.pointer("/interval/endUtcOffset"),
                                        "type": s.get("type"),
                                        "stages": s.get("stages"),
                                        "summary": s.get("summary"),
                                        "metadata": s.get("metadata"),
                                    }))
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    if sleeps.is_empty() {
                        ("sleep", None, None)
                    } else {
                        ("sleep", Some(json!(sleeps)), None)
                    }
                }
                Err(e) => ("sleep", None, Some(format!("sleep: {e}"))),
            }
        }));
    }

    // ── exercise (array, up to 25) ──
    {
        let auth = Arc::clone(auth);
        let f = format!("exercise.interval.civil_start_time >= \"{date_s}\" AND exercise.interval.civil_start_time < \"{next_s}\"");
        tasks.push(Box::pin(async move {
            let url = format!("{BASE}/dataTypes/exercise/dataPoints?filter={}&pageSize=25", urlenc(&f));
            match auth.api_get(&url).await {
                Ok(v) => {
                    let exercises: Vec<Value> = v
                        .get("dataPoints")
                        .and_then(|p| p.as_array())
                        .map(|pts| {
                            pts.iter()
                                .filter_map(|p| {
                                    let e = p.get("exercise")?;
                                    Some(json!({
                                        "type": e.get("exerciseType"),
                                        "name": e.get("displayName"),
                                        "start": e.pointer("/interval/startTime"),
                                        "end": e.pointer("/interval/endTime"),
                                        "startUtcOffset": e.pointer("/interval/startUtcOffset"),
                                        "endUtcOffset": e.pointer("/interval/endUtcOffset"),
                                        "duration": e.get("activeDuration"),
                                        "metrics": e.get("metricsSummary"),
                                        "metadata": e.get("exerciseMetadata"),
                                    }))
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    if exercises.is_empty() {
                        ("exercise", None, None)
                    } else {
                        ("exercise", Some(json!(exercises)), None)
                    }
                }
                Err(e) => ("exercise", None, Some(format!("exercise: {e}"))),
            }
        }));
    }

    // ── activity levels (array, up to 50, RFC3339 filter) ──
    {
        let auth = Arc::clone(auth);
        let f = format!(
            "activity_level.interval.start_time >= \"{date_s}T00:00:00Z\" AND activity_level.interval.start_time < \"{next_s}T00:00:00Z\""
        );
        tasks.push(Box::pin(async move {
            let url = format!("{BASE}/dataTypes/activity-level/dataPoints?filter={}&pageSize=50", urlenc(&f));
            match auth.api_get(&url).await {
                Ok(v) => {
                    let levels: Vec<Value> = v
                        .get("dataPoints")
                        .and_then(|p| p.as_array())
                        .map(|pts| pts.iter().filter_map(|p| p.get("activityLevel").cloned()).collect())
                        .unwrap_or_default();
                    if levels.is_empty() {
                        ("activity_levels", None, None)
                    } else {
                        ("activity_levels", Some(json!(levels)), None)
                    }
                }
                Err(e) => ("activity_levels", None, Some(format!("activity-level: {e}"))),
            }
        }));
    }

    // ── run: no more than CONCURRENCY concurrent ──
    let mut errors: Vec<String> = Vec::new();
    let mut results = stream::iter(tasks).buffer_unordered(CONCURRENCY);
    while let Some((key, val, task_err)) = results.next().await {
        if let Some(v) = val {
            summary[key] = v;
        }
        if let Some(e) = task_err {
            errors.push(e);
        }
    }
    if !errors.is_empty() {
        summary["_errors"] = json!(errors);
    }
    summary
}

async fn daily_summary(auth: &Arc<AuthState>, date: NaiveDate) -> Result<CallToolResult, CallToolError> {
    let key = format!("summary:{}", date);
    if let Some(mut cached) = auth.cache.get(&key).await {
        cached["_cached"] = json!(true);
        return ok(&cached);
    }
    let summary = build_daily_summary(auth, date).await;
    auth.cache.set(key, summary.clone()).await;
    ok(&summary)
}

#[mcp_tool(
    name = "clear_cache",
    title = "Clear Response Cache",
    description = "Clear in-memory response cache to force fresh live API fetches on subsequent queries.",
    read_only_hint = false,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct ClearCache {}

impl ClearCache {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        auth.cache.clear().await;
        ok(&json!({ "success": true, "message": "In-memory response cache cleared" }))
    }
}

#[mcp_tool(
    name = "summary",
    title = "Daily Summary",
    description = "Full health summary for any date: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, VO2max, nutrition, hydration, sedentary periods, activity levels. `today` and `yesterday` are shortcuts for this tool. Per-metric fetch failures, if any, are listed in `_errors`.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct Summary {
    /// Date in YYYY-MM-DD format. Defaults to today (server local time) if omitted.
    #[serde(default)]
    pub date: Option<String>,
}

impl Summary {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let date = match &self.date {
            Some(s) => match parse_civil_date(s) {
                Ok(d) => d,
                Err(e) => return err(&e),
            },
            None => Local::now().date_naive(),
        };
        daily_summary(auth, date).await
    }
}

#[mcp_tool(
    name = "today",
    title = "Today Summary",
    description = "Get a full health summary for today: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, sedentary periods.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct Today {}

impl Today {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        daily_summary(auth, Local::now().date_naive()).await
    }
}

#[mcp_tool(
    name = "yesterday",
    title = "Yesterday Summary",
    description = "Get a full health summary for yesterday: steps, heart rate (avg/min/max/resting), calories (active/total), distance, active minutes, active zone minutes, floors, sleep (stages + summary), exercises, HRV, SpO2, respiratory rate, sleep temperature, weight, sedentary periods.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct Yesterday {}

impl Yesterday {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        daily_summary(auth, Local::now().date_naive() - ChronoDuration::days(1)).await
    }
}

// ─── trends ─────────────────────────────────────────────────────────────────

#[mcp_tool(
    name = "get_trends",
    title = "Get Health Trends",
    description = "Get daily time series for a health metric over a date range. Returns per-day aggregated values. Only works with dailyRollUp-compatible types. Use list_data_types to check.",
    read_only_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct GetTrends {
    /// Data type (e.g. steps, heart-rate, active-energy-burned, distance, floors)
    pub data_type: String,
    /// Start date (YYYY-MM-DD)
    pub start_date: String,
    /// End date (YYYY-MM-DD)
    pub end_date: String,
}

impl GetTrends {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        // Validate dates
        let start = match parse_civil_date(&self.start_date) {
            Ok(d) => d,
            Err(e) => return err(&e),
        };
        let end = match parse_civil_date(&self.end_date) {
            Ok(d) => d,
            Err(e) => return err(&e),
        };
        if start > end {
            return err("end_date must be on or after start_date");
        }

        // Use dailyRollUp with windowSizeDays=1 to get per-day buckets.
        // end_date is inclusive for the user, but the API range end is exclusive,
        // so we add one day.
        let end_exclusive = (end + ChronoDuration::days(1)).to_string();
        let tool = DailyRollUpDataPoints {
            data_type: self.data_type.clone(),
            start_date: self.start_date.clone(),
            end_date: end_exclusive,
            window_size_days: Some(1),
            page_size: None,
            page_token: None,
            data_source_family: None,
            raw: Some(true),
        };

        let sc = match tool.call_tool(auth).await {
            Ok(r) => match r.structured_content {
                Some(m) => Value::Object(m),
                None => return err("Empty response from dailyRollUp"),
            },
            Err(e) => return Err(e),
        };

        // Extract per-day values from rollupDataPoints
        let snake_type = self.data_type.replace('-', "_");
        let camel_field = snake_to_camel(&snake_type);
        let mut series: Vec<Value> = Vec::new();

        if let Some(pts) = sc.get("rollupDataPoints").and_then(|v| v.as_array()) {
            for p in pts {
                // civilStartTime.date is a {year, month, day} object, not a string.
                let date = p
                    .get("civilStartTime")
                    .and_then(|v| v.get("date"))
                    .map(date_obj_to_str)
                    .unwrap_or_default();
                // The value object is keyed by the camelCase data type name
                let value_obj = p.get(&camel_field);
                series.push(json!({
                    "date": date,
                    "value": value_obj,
                }));
            }
        }

        let result = json!({
            "data_type": self.data_type,
            "start_date": self.start_date,
            "end_date": self.end_date,
            "days": series.len(),
            "series": series,
        });

        ok(&result)
    }
}

/// Convert snake_case to camelCase (e.g. "active_energy_burned" -> "activeEnergyBurned").
fn snake_to_camel(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut capitalize_next = false;
    for ch in s.chars() {
        if ch == '_' {
            capitalize_next = true;
        } else if capitalize_next {
            result.extend(ch.to_uppercase());
            capitalize_next = false;
        } else {
            result.push(ch);
        }
    }
    result
}

// ─── delete by filter ───────────────────────────────────────────────────────

#[mcp_tool(
    name = "delete_by_filter",
    title = "Delete Data Points by Filter",
    description = "Delete all data points matching a filter. Use with caution - this is destructive.",
    read_only_hint = false,
    destructive_hint = true,
)]
#[derive(Debug, ::serde::Deserialize, ::serde::Serialize, JsonSchema)]
pub struct DeleteByFilter {
    /// Data type (kebab-case)
    pub data_type: String,
    /// AIP-160 filter expression
    pub filter: String,
    /// Maximum number of points to delete (default 100, max 10000)
    #[serde(default)]
    pub max_count: Option<u32>,
}

impl DeleteByFilter {
    pub async fn call_tool(&self, auth: &Arc<AuthState>) -> Result<CallToolResult, CallToolError> {
        let max_count = self.max_count.unwrap_or(100).min(10000).max(1) as usize;

        // Phase 1: list data points matching the filter, collecting resource names.
        let mut names: Vec<String> = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            let list_tool = ListDataPoints {
                data_type: self.data_type.clone(),
                filter: Some(self.filter.clone()),
                start_time: None,
                end_time: None,
                // Sleep/exercise cap at 25 per page; use 25 for those, 100 for others.
                page_size: Some(if self.data_type == "sleep" || self.data_type == "exercise" { 25 } else { 100 }),
                page_token: page_token.clone(),
                raw: Some(true),
            };
            let sc = match list_tool.call_tool(auth).await {
                Ok(r) => match r.structured_content {
                    Some(m) => Value::Object(m),
                    None => break,
                },
                Err(e) => return Err(e),
            };

            if let Some(pts) = sc.get("dataPoints").and_then(|v| v.as_array()) {
                for p in pts {
                    if let Some(name) = p.get("name").and_then(|v| v.as_str()) {
                        names.push(name.to_string());
                        if names.len() >= max_count {
                            break;
                        }
                    }
                }
            }

            if names.len() >= max_count {
                break;
            }

            match sc.get("nextPageToken").and_then(|v| v.as_str()) {
                Some(token) => page_token = Some(token.to_string()),
                None => break,
            }
        }

        if names.is_empty() {
            return ok(&json!({
                "deleted_count": 0,
                "message": "No data points matched the filter",
            }));
        }

        // Phase 2: batch delete in chunks of up to 10000 (API limit).
        let mut total_deleted = 0usize;
        for chunk in names.chunks(10000) {
            let batch_tool = BatchDeleteDataPoints {
                data_type: self.data_type.clone(),
                names: chunk.to_vec(),
            };
            match batch_tool.call_tool(auth).await {
                Ok(_) => total_deleted += chunk.len(),
                Err(e) => {
                    return ok(&json!({
                        "deleted_count": total_deleted,
                        "error": format!("Batch delete failed after {total_deleted} deletions: {e}"),
                    }));
                }
            }
        }

        ok(&json!({
            "deleted_count": total_deleted,
            "data_type": self.data_type,
            "filter": self.filter,
        }))
    }
}

// ─── resources ───────────────────────────────────────────────────────────────
// Passive read-only data: the host (Claude Desktop, etc.) can display them
// in a resource picker without model involvement. Tools remain the primary interface.

#[mcp_resource(
    name = "Health Profile",
    description = "Google Health user profile (name, birth date, gender)",
    mime_type = "application/json",
    uri = "health://profile"
)]
pub struct ProfileResource;

#[mcp_resource(
    name = "Health Settings",
    description = "Google Health settings (units, preferences)",
    mime_type = "application/json",
    uri = "health://settings"
)]
pub struct SettingsResource;

#[mcp_resource(
    name = "Paired Devices",
    description = "Devices paired with the Google Health account",
    mime_type = "application/json",
    uri = "health://devices"
)]
pub struct DevicesResource;

#[mcp_resource_template(
    name = "Daily Summary",
    description = "Full daily health summary for a date (YYYY-MM-DD)",
    mime_type = "application/json",
    uri_template = "health://summary/{date}"
)]
pub struct SummaryResourceTemplate;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_urlenc() {
        let filter = "steps.interval.start_time >= \"2026-07-26T00:00:00Z\"";
        let encoded = urlenc(filter);
        assert!(!encoded.contains(' '));
        assert!(!encoded.contains('"'));
        assert!(!encoded.contains('>'));
        assert!(encoded.contains("%20"));
        assert!(encoded.contains("%22"));
    }

    #[test]
    fn test_parse_civil_date() {
        let valid = parse_civil_date("2026-07-26");
        assert!(valid.is_ok());
        let date = valid.unwrap();
        assert_eq!(date.year(), 2026);
        assert_eq!(date.month(), 7);
        assert_eq!(date.day(), 26);

        let invalid = parse_civil_date("invalid-date");
        assert!(invalid.is_err());
    }

    #[test]
    fn test_date_obj() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 26).unwrap();
        let obj = date_obj(date);
        assert_eq!(obj["year"], 2026);
        assert_eq!(obj["month"], 7);
        assert_eq!(obj["day"], 26);
    }

    #[test]
    fn test_date_obj_to_str() {
        let d = json!({ "year": 2026, "month": 7, "day": 28 });
        assert_eq!(date_obj_to_str(&d), "2026-07-28");
        // Zero-padded month/day
        let d2 = json!({ "year": 2026, "month": 12, "day": 5 });
        assert_eq!(date_obj_to_str(&d2), "2026-12-05");
        // Missing fields fall back to 0
        let d3 = json!({ "year": 2026 });
        assert_eq!(date_obj_to_str(&d3), "2026-00-00");
    }

    #[test]
    fn test_sync_data_points_build_filter() {
        let f1 = SyncDataPoints::build_filter("heart-rate", "2026-07-26T00:00:00Z", None);
        assert_eq!(f1, "heart_rate.sample_time.physical_time >= \"2026-07-26T00:00:00Z\"");

        let f2 = SyncDataPoints::build_filter("steps", "2026-07-26T00:00:00Z", Some("2026-07-27T00:00:00Z"));
        assert_eq!(f2, "steps.interval.start_time >= \"2026-07-26T00:00:00Z\" AND steps.interval.start_time < \"2026-07-27T00:00:00Z\"");

        let f3 = SyncDataPoints::build_filter("sleep", "2026-07-26T00:00:00Z", None);
        assert_eq!(f3, "sleep.interval.end_time >= \"2026-07-26T00:00:00Z\"");

        let f4 = SyncDataPoints::build_filter("daily-resting-heart-rate", "2026-07-26", None);
        assert_eq!(f4, "daily_resting_heart_rate.date >= \"2026-07-26\"");
    }
}

