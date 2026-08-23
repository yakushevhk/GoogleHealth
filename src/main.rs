mod auth;
mod tools;
pub mod types;

use async_trait::async_trait;
use auth::AuthState;
use rust_mcp_axum::{create_axum_server, AxumServerOptions};
use rust_mcp_sdk::{
    auth::{AuthInfo, AuthProvider, AuthenticationError},
    error::SdkResult,
    event_store::InMemoryEventStore,
    mcp_server::{server_runtime, McpServerOptions, ServerHandler, ServerRuntime},
    mcp_http::{DnsRebindingOptions, GenericBody, McpAppState, McpHttpError},
    schema::{
        schema_utils::CallToolError, CallToolRequestParams, CallToolResult, GetPromptRequestParams,
        GetPromptResult, Implementation, InitializeResult, ListPromptsResult, ListResourcesResult,
        ListResourceTemplatesResult, ListToolsResult, PaginatedRequestParams, Prompt, PromptArgument,
        PromptMessage, ProtocolVersion, ReadResourceRequestParams, ReadResourceResult, Role, RpcError,
        ServerCapabilities, ServerCapabilitiesPrompts, ServerCapabilitiesResources,
        ServerCapabilitiesTools, TextContent, TextResourceContents,
    },
    tool_box, McpServer, StdioTransport, ToMcpServerHandler, TransportOptions,
};
use std::collections::HashMap;
use std::sync::Arc;
use tools::*;

struct StaticTokenAuth {
    token: String,
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    if ab.len() != bb.len() { return false; }
    ab.iter().zip(bb.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[async_trait]
impl AuthProvider for StaticTokenAuth {
    async fn verify_token(&self, access_token: String) -> Result<AuthInfo, AuthenticationError> {
        if constant_time_eq(&access_token, &self.token) {
            Ok(AuthInfo {
                token_unique_id: "static".into(),
                client_id: None,
                user_id: Some("user".into()),
                scopes: None,
                audience: None,
                expires_at: Some(std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(4102444800)),
                extra: None,
            })
        } else {
            Err(AuthenticationError::InvalidToken {
                description: "Invalid API key",
            })
        }
    }

    fn auth_endpoints(&self) -> Option<&HashMap<String, rust_mcp_sdk::auth::OauthEndpoint>> {
        None
    }

    fn protected_resource_metadata_url(&self) -> Option<&str> {
        None
    }

    async fn handle_request(
        &self,
        _request: http::Request<&str>,
        _state: Arc<McpAppState>,
    ) -> Result<http::Response<GenericBody>, McpHttpError> {
        Err(McpHttpError::HttpError("Not supported".into()))
    }
}

tool_box!(
    HealthTools,
    [
        ListDataPoints,
        GetDataPoint,
        ReconcileDataPoints,
        SyncDataPoints,
        RollUpDataPoints,
        DailyRollUpDataPoints,
        CreateDataPoint,
        AddWeightSample,
        AddHydrationLog,
        AddSleepSession,
        AddExerciseSession,
        AddNutritionLog,
        CompareHealthPeriods,
        GetHrvRecoveryTrend,
        GetTemperatureSummary,
        ClearCache,
        PatchDataPoint,
        DeleteDataPoint,
        BatchDeleteDataPoints,
        ExportExerciseTcx,
        GetProfile,
        UpdateProfile,
        GetSettings,
        UpdateSettings,
        GetIdentity,
        GetIrnProfile,
        ListPairedDevices,
        GetPairedDevice,
        Today,
        Yesterday,
        Summary,
        GetTrends,
        DeleteByFilter,
        ListDataTypes,
        DescribeDataType
    ]
);

struct HealthHandler {
    auth: Arc<AuthState>,
}

#[async_trait]
impl ServerHandler for HealthHandler {
    async fn handle_list_tools_request(
        &self,
        _params: Option<PaginatedRequestParams>,
        _runtime: Arc<dyn McpServer>,
    ) -> Result<ListToolsResult, RpcError> {
        Ok(ListToolsResult {
            tools: HealthTools::tools(),
            meta: None,
            next_cursor: None,
        })
    }

    async fn handle_call_tool_request(
        &self,
        params: CallToolRequestParams,
        _runtime: Arc<dyn McpServer>,
    ) -> Result<CallToolResult, CallToolError> {
        let tool: HealthTools =
            HealthTools::try_from(params).map_err(CallToolError::new)?;
        match tool {
            HealthTools::ListDataPoints(t) => t.call_tool(&self.auth).await,
            HealthTools::GetDataPoint(t) => t.call_tool(&self.auth).await,
            HealthTools::ReconcileDataPoints(t) => t.call_tool(&self.auth).await,
            HealthTools::SyncDataPoints(t) => t.call_tool(&self.auth).await,
            HealthTools::RollUpDataPoints(t) => t.call_tool(&self.auth).await,
            HealthTools::DailyRollUpDataPoints(t) => t.call_tool(&self.auth).await,
            HealthTools::CreateDataPoint(t) => t.call_tool(&self.auth).await,
            HealthTools::AddWeightSample(t) => t.call_tool(&self.auth).await,
            HealthTools::AddHydrationLog(t) => t.call_tool(&self.auth).await,
            HealthTools::AddSleepSession(t) => t.call_tool(&self.auth).await,
            HealthTools::AddExerciseSession(t) => t.call_tool(&self.auth).await,
            HealthTools::AddNutritionLog(t) => t.call_tool(&self.auth).await,
            HealthTools::CompareHealthPeriods(t) => t.call_tool(&self.auth).await,
            HealthTools::GetHrvRecoveryTrend(t) => t.call_tool(&self.auth).await,
            HealthTools::GetTemperatureSummary(t) => t.call_tool(&self.auth).await,
            HealthTools::ClearCache(t) => t.call_tool(&self.auth).await,
            HealthTools::PatchDataPoint(t) => t.call_tool(&self.auth).await,
            HealthTools::DeleteDataPoint(t) => t.call_tool(&self.auth).await,
            HealthTools::BatchDeleteDataPoints(t) => t.call_tool(&self.auth).await,
            HealthTools::ExportExerciseTcx(t) => t.call_tool(&self.auth).await,
            HealthTools::GetProfile(t) => t.call_tool(&self.auth).await,
            HealthTools::UpdateProfile(t) => t.call_tool(&self.auth).await,
            HealthTools::GetSettings(t) => t.call_tool(&self.auth).await,
            HealthTools::UpdateSettings(t) => t.call_tool(&self.auth).await,
            HealthTools::GetIdentity(t) => t.call_tool(&self.auth).await,
            HealthTools::GetIrnProfile(t) => t.call_tool(&self.auth).await,
            HealthTools::ListPairedDevices(t) => t.call_tool(&self.auth).await,
            HealthTools::GetPairedDevice(t) => t.call_tool(&self.auth).await,
            HealthTools::Today(t) => t.call_tool(&self.auth).await,
            HealthTools::Yesterday(t) => t.call_tool(&self.auth).await,
            HealthTools::Summary(t) => t.call_tool(&self.auth).await,
            HealthTools::GetTrends(t) => t.call_tool(&self.auth).await,
            HealthTools::DeleteByFilter(t) => t.call_tool(&self.auth).await,
            HealthTools::ListDataTypes(t) => t.call_tool(&self.auth).await,
            HealthTools::DescribeDataType(t) => t.call_tool(&self.auth).await,
        }
    }

    async fn handle_list_resources_request(
        &self,
        _params: Option<PaginatedRequestParams>,
        _runtime: Arc<dyn McpServer>,
    ) -> Result<ListResourcesResult, RpcError> {
        Ok(ListResourcesResult {
            resources: vec![
                ProfileResource::resource(),
                SettingsResource::resource(),
                DevicesResource::resource(),
            ],
            meta: None,
            next_cursor: None,
        })
    }

    async fn handle_list_resource_templates_request(
        &self,
        _params: Option<PaginatedRequestParams>,
        _runtime: Arc<dyn McpServer>,
    ) -> Result<ListResourceTemplatesResult, RpcError> {
        Ok(ListResourceTemplatesResult {
            resource_templates: vec![SummaryResourceTemplate::resource_template()],
            meta: None,
            next_cursor: None,
        })
    }

    async fn handle_read_resource_request(
        &self,
        params: ReadResourceRequestParams,
        _runtime: Arc<dyn McpServer>,
    ) -> Result<ReadResourceResult, RpcError> {
        let uri = params.uri;
        match uri.as_str() {
            "health://profile" => self.json_resource(&format!("{BASE}/profile"), &uri).await,
            "health://settings" => self.json_resource(&format!("{BASE}/settings"), &uri).await,
            "health://devices" => self.json_resource(&format!("{BASE}/pairedDevices"), &uri).await,
            u if u.starts_with("health://summary/") => {
                let date_str = &u["health://summary/".len()..];
                let date = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").map_err(|_| {
                    RpcError::invalid_request().with_message(format!(
                        "Invalid date in resource URI (expected YYYY-MM-DD): {date_str}"
                    ))
                })?;
                let summary = build_daily_summary(&self.auth, date).await;
                Ok(json_resource_result(
                    &serde_json::to_string_pretty(&summary).unwrap_or_default(),
                    &uri,
                ))
            }
            _ => Err(RpcError::invalid_request().with_message(format!("Unknown resource URI: {uri}"))),
        }
    }

    async fn handle_list_prompts_request(
        &self,
        _params: Option<PaginatedRequestParams>,
        _runtime: Arc<dyn McpServer>,
    ) -> Result<ListPromptsResult, RpcError> {
        Ok(ListPromptsResult {
            prompts: vec![
                Prompt {
                    name: "health_weekly_review".into(),
                    title: Some("Weekly Health Review".into()),
                    description: Some("Comprehensive 7-day health, sleep, and workout review".into()),
                    arguments: vec![PromptArgument {
                        name: "end_date".into(),
                        title: Some("End Date".into()),
                        description: Some("End date in YYYY-MM-DD format (defaults to today)".into()),
                        required: Some(false),
                    }],
                    icons: vec![],
                    meta: None,
                },
                Prompt {
                    name: "sleep_quality_analysis".into(),
                    title: Some("Sleep Quality Analysis".into()),
                    description: Some("Detailed sleep stages, HRV, and recovery analysis".into()),
                    arguments: vec![PromptArgument {
                        name: "days".into(),
                        title: Some("Days Count".into()),
                        description: Some("Number of past days to analyze (default 7)".into()),
                        required: Some(false),
                    }],
                    icons: vec![],
                    meta: None,
                },
                Prompt {
                    name: "workout_summary".into(),
                    title: Some("Workout Summary".into()),
                    description: Some("Exercise sessions and heart rate zone breakdown".into()),
                    arguments: vec![PromptArgument {
                        name: "days".into(),
                        title: Some("Days Count".into()),
                        description: Some("Number of past days to analyze (default 7)".into()),
                        required: Some(false),
                    }],
                    icons: vec![],
                    meta: None,
                },
            ],
            meta: None,
            next_cursor: None,
        })
    }

    async fn handle_get_prompt_request(
        &self,
        params: GetPromptRequestParams,
        _runtime: Arc<dyn McpServer>,
    ) -> Result<GetPromptResult, RpcError> {
        let name = params.name.as_str();
        let args = params.arguments.unwrap_or_default();
        let text = match name {
            "health_weekly_review" => {
                let end_date = args.get("end_date").cloned().unwrap_or_else(|| "today".into());
                format!("Please review my health data up to {end_date}. Use `summary` for the past 7 days to evaluate step trends, sleep duration/stages, resting heart rate, active calories, and overall recovery. Highlight any key trends or anomalies.\n\nAdditional analysis to include:\n- Evaluate sleep stage distribution (deep/REM percentages, sleep efficiency)\n- Analyze HR zone breakdown across activities\n- Check temperature anomalies from daily-sleep-temperature-derivations\n- Review respiratory rate trends from daily-respiratory-rate")
            }
            "sleep_quality_analysis" => {
                let days = args.get("days").cloned().unwrap_or_else(|| "7".into());
                format!("Please analyze my sleep quality for the past {days} days. Use `sync_data_points` or `list_data_points` for `sleep`, `heart-rate-variability`, and `daily-resting-heart-rate`. Detail my sleep efficiency, deep/REM sleep percentages, and HRV trends.\n\nAdditional analysis to include:\n- Analyze sleep efficiency (minutesAsleep / minutesInSleepPeriod)\n- Evaluate deep+REM ratio (normal: 20-40%)\n- Check per-stage respiratory rate from respiratory-rate-sleep-summary (deep/light/REM breathing rates)\n- Correlate HRV with sleep stages")
            }
            "workout_summary" => {
                let days = args.get("days").cloned().unwrap_or_else(|| "7".into());
                format!("Please compile a summary of my workouts over the past {days} days. Use `list_data_points` for `exercise`, `active-zone-minutes`, and `calories-in-heart-rate-zone`. Show workout types, total durations, calories burned, and intensity zones.\n\nAdditional analysis to include:\n- Analyze heart rate zone durations per workout (lightTime/moderateTime/vigorousTime/peakTime)\n- Track active zone minutes across sessions\n- Compare pace and heart rate trends over time")
            }
            _ => return Err(RpcError::invalid_request().with_message(format!("Unknown prompt: {name}"))),
        };
        Ok(GetPromptResult {
            description: Some(format!("Health analysis prompt: {name}")),
            messages: vec![PromptMessage {
                role: Role::User,
                content: TextContent::from(text).into(),
            }],
            meta: None,
        })
    }
}

fn json_resource_result(text: &str, uri: &str) -> ReadResourceResult {
    ReadResourceResult {
        contents: vec![TextResourceContents::new(text.to_string(), uri.to_string())
            .with_mime_type("application/json")
            .into()],
        meta: None,
    }
}

impl HealthHandler {
    async fn json_resource(&self, url: &str, uri: &str) -> Result<ReadResourceResult, RpcError> {
        match self.auth.api_get(url).await {
            Ok(v) => Ok(json_resource_result(
                &serde_json::to_string_pretty(&v).unwrap_or_default(),
                uri,
            )),
            Err(e) => Err(RpcError::internal_error().with_message(e)),
        }
    }
}

fn server_details() -> InitializeResult {
    InitializeResult {
        server_info: Implementation {
            name: "google-health-mcp".into(),
            version: "0.2.0".into(),
            title: Some("Google Health API MCP Server".into()),
            description: Some(
                "Full Google Health API access: 39 data types, all methods (list, get, reconcile, rollUp, dailyRollUp, create, patch, batchDelete, exportTcx, delta sync), profile, settings, devices, high-level helpers. MCP tools, resources, resource templates, and prompts.".into(),
            ),
            icons: vec![],
            website_url: None,
        },
        capabilities: ServerCapabilities {
            tools: Some(ServerCapabilitiesTools { list_changed: None }),
            resources: Some(ServerCapabilitiesResources { subscribe: None, list_changed: None }),
            prompts: Some(ServerCapabilitiesPrompts { list_changed: None }),
            ..Default::default()
        },
        protocol_version: ProtocolVersion::V2025_11_25.into(),
        instructions: Some(
            concat!(
                "Google Health MCP server with 35 tools for reading and writing health data from Google Health API v4, plus 4 resources and 3 prompts.\n\n",
                "Tools by category:\n",
                "- Summaries & analytics: `summary` (any date, YYYY-MM-DD), `today`, `yesterday`, `compare_health_periods`, `get_hrv_recovery_trend`, `get_temperature_summary`, `get_trends`, `clear_cache`.\n",
                "- Data & sync: `list_data_points`, `get_data_point`, `reconcile_data_points`, `sync_data_points`, `rollup_data_points`, `daily_rollup_data_points`.\n",
                "- Write & delete: `create_data_point`, `add_weight_sample`, `add_hydration_log`, `add_sleep_session`, `add_exercise_session`, `add_nutrition_log`, `patch_data_point`, `delete_data_point`, `batch_delete_data_points`, `delete_by_filter`.\n",
                "- Export: `export_exercise_tcx` (returns raw TCX XML).\n",
                "- Profile & devices: `get_profile`, `update_profile`, `get_settings`, `update_settings`, `get_identity`, `get_irn_profile`, `list_paired_devices`, `get_paired_device`.\n\n",
                "Resources: health://profile, health://settings, health://devices, and the template health://summary/{date} (YYYY-MM-DD).\n\n",
                "Prompts: health_weekly_review, sleep_quality_analysis, workout_summary.\n\n",
                "Quick start:\n",
                "- Use `today` or `summary` (with date YYYY-MM-DD) for a full daily health overview (~34 metrics fetched in parallel).\n",
                "- Use `list_data_points` for raw data with AIP-160 filters. Data types use kebab-case (e.g. heart-rate, daily-resting-heart-rate); filters use snake_case (e.g. heart_rate.sample_time.physical_time).\n",
                "- Use `daily_rollup_data_points` for aggregated data by day.\n",
                "- Write helpers: add_weight_sample, add_hydration_log, add_sleep_session, add_exercise_session, add_nutrition_log.\n",
                "- Analytics: compare_health_periods (13 metrics), get_hrv_recovery_trend (personalized baseline).\n\n",
                "Key gotchas:\n",
                "- Use dailyRollUp for steps/distance/floors totals (list returns intervals without values).\n",
                "- Missing days \u{2260} zero data.\n",
                "- int64 fields (countSum, beatsPerMinute, minutesAsleep) are strings in JSON.\n",
                "- Summary responses are cached for 120s; use clear_cache to force fresh data after writes."
            )
            .to_string(),
        ),
        meta: None,
    }
}

#[tokio::main]
async fn main() -> SdkResult<()> {
    let _ = dotenvy::dotenv();
    let client_id =
        std::env::var("GOOGLE_CLIENT_ID").expect("GOOGLE_CLIENT_ID env var required");
    let client_secret =
        std::env::var("GOOGLE_CLIENT_SECRET").expect("GOOGLE_CLIENT_SECRET env var required");
    let refresh_token =
        std::env::var("GOOGLE_REFRESH_TOKEN").expect("GOOGLE_REFRESH_TOKEN env var required");

    let auth = AuthState::new(client_id, client_secret, refresh_token);
    let handler = HealthHandler { auth };
    let http_mode = std::env::args().any(|a| a == "--http");

    if http_mode {
        let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
        let port: u16 = std::env::var("PORT").unwrap_or_else(|_| "3000".into()).parse().unwrap_or(3000);
        let api_key = std::env::var("MCP_API_KEY").unwrap_or_else(|_| {
            eprintln!("MCP_API_KEY env var required for HTTP mode");
            std::process::exit(1);
        });
        eprintln!("Starting HTTP/SSE server on {host}:{port}");
        let auth_provider = Arc::new(StaticTokenAuth { token: api_key });
        // DNS-rebinding protection (enabled by default in SDK 1.0): explicit
        // allowlist of Host headers — production behind nginx + local dev.
        let mut allowed_hosts = vec![
            format!("{host}:{port}"),
            format!("127.0.0.1:{port}"),
            format!("localhost:{port}"),
        ];
        if let Ok(public_host) = std::env::var("PUBLIC_HOST") {
            allowed_hosts.push(public_host);
        }
        let server = create_axum_server(
            server_details(),
            handler.to_mcp_server_handler(),
            AxumServerOptions {
                host,
                port,
                auth: Some(auth_provider),
                event_store: Some(Arc::new(InMemoryEventStore::default())),
                health_endpoint: Some("/health".into()),
                dns_rebinding: DnsRebindingOptions {
                    dns_rebinding_protection: true,
                    allowed_hosts: Some(allowed_hosts),
                    allowed_origins: None,
                },
                ..Default::default()
            },
        );
        server.start().await?;
    } else {
        let transport = StdioTransport::new(TransportOptions::default())?;
        let server: Arc<ServerRuntime> = server_runtime::create_server(McpServerOptions {
            server_details: server_details(),
            transport,
            handler: handler.to_mcp_server_handler(),
            task_store: None,
            client_task_store: None,
            message_observer: None,
        });
        server.start().await?;
    }

    Ok(())
}
