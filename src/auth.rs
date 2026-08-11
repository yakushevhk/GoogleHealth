use reqwest::{Client, Method};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};

/// Backoff delays for 429 / 5xx / network errors (mirrors astrojs gh-client.ts).
const RETRY_DELAYS_MS: [u64; 3] = [500, 1500, 4000];
/// Refresh token this long before actual expiry.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);

struct TokenState {
    access_token: String,
    expires_at: Option<Instant>,
}

pub struct ResponseCache {
    entries: RwLock<std::collections::HashMap<String, (Instant, Value)>>,
    default_ttl: Duration,
}

impl ResponseCache {
    pub fn new(default_ttl_secs: u64) -> Self {
        Self {
            entries: RwLock::new(std::collections::HashMap::new()),
            default_ttl: Duration::from_secs(default_ttl_secs),
        }
    }

    pub async fn get(&self, key: &str) -> Option<Value> {
        let map = self.entries.read().await;
        if let Some((inserted_at, value)) = map.get(key) {
            if inserted_at.elapsed() < self.default_ttl {
                return Some(value.clone());
            }
        }
        None
    }

    pub async fn set(&self, key: String, value: Value) {
        let mut map = self.entries.write().await;
        map.insert(key, (Instant::now(), value));
    }

    pub async fn clear(&self) {
        let mut map = self.entries.write().await;
        map.clear();
    }
}

pub struct AuthState {
    client_id: String,
    client_secret: String,
    refresh_token: String,
    /// Fast-path read of the current token.
    token: RwLock<TokenState>,
    /// Single-flight gate: only the holder refreshes; others wait
    /// and reuse the fresh token (like refreshPromise in gh-client.ts).
    refresh_gate: Mutex<()>,
    http: Client,
    pub cache: ResponseCache,
}

impl AuthState {
    pub fn new(client_id: String, client_secret: String, refresh_token: String) -> Arc<Self> {
        Arc::new(Self {
            client_id,
            client_secret,
            refresh_token,
            token: RwLock::new(TokenState {
                access_token: String::new(),
                expires_at: None,
            }),
            refresh_gate: Mutex::new(()),
            // Configuration error — fail fast; network errors below
            // are handled via Result and won't crash the server.
            http: Client::builder()
                .timeout(Duration::from_secs(30))
                .connect_timeout(Duration::from_secs(10))
                .build()
                .expect("failed to build reqwest client"),
            cache: ResponseCache::new(120),
        })
    }

    fn is_valid(t: &TokenState) -> bool {
        !t.access_token.is_empty() && t.expires_at.is_some_and(|e| Instant::now() + EXPIRY_MARGIN < e)
    }

    /// Cached token if valid; otherwise refresh under single-flight gate.
    pub async fn get_token(&self) -> Result<String, String> {
        {
            let t = self.token.read().await;
            if Self::is_valid(&t) {
                return Ok(t.access_token.clone());
            }
        }
        let _gate = self.refresh_gate.lock().await;
        {
            // double-check: another task may have refreshed while we waited for the gate
            let t = self.token.read().await;
            if Self::is_valid(&t) {
                return Ok(t.access_token.clone());
            }
        }
        self.refresh_inner().await
    }

    /// Force refresh for the 401 path. Goes through the same gate: if the token
    /// already differs from `stale`, someone refreshed it — reuse instead.
    async fn refresh_if_stale(&self, stale: &str) -> Result<String, String> {
        let _gate = self.refresh_gate.lock().await;
        {
            let t = self.token.read().await;
            if !t.access_token.is_empty() && t.access_token != stale {
                return Ok(t.access_token.clone());
            }
        }
        self.refresh_inner().await
    }

    /// The actual OAuth refresh. Never panics; caller holds the gate.
    async fn refresh_inner(&self) -> Result<String, String> {
        let resp = self
            .http
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("refresh_token", self.refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|e| format!("OAuth token refresh request failed: {e}"))?;
        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("OAuth token response parse failed: {e}"))?;
        if !status.is_success() {
            let desc = body["error_description"]
                .as_str()
                .or_else(|| body["error"].as_str())
                .unwrap_or("unknown error");
            return Err(format!("OAuth refresh failed (HTTP {}): {desc}", status.as_u16()));
        }
        let access_token = body["access_token"]
            .as_str()
            .ok_or_else(|| "OAuth response missing access_token".to_string())?
            .to_string();
        let expires_in = body["expires_in"].as_u64().unwrap_or(3600);
        let mut t = self.token.write().await;
        t.access_token = access_token.clone();
        t.expires_at = Some(Instant::now() + Duration::from_secs(expires_in));
        Ok(access_token)
    }

    // ── HTTP plumbing ────────────────────────────────────────────────────────

    async fn do_request(
        &self,
        method: Method,
        url: &str,
        token: &str,
        payload: Option<&Value>,
    ) -> Result<(u16, Value), String> {
        let mut req = self
            .http
            .request(method, url)
            .header("Authorization", format!("Bearer {token}"));
        if let Some(p) = payload {
            req = req.json(p);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        // Read text first: Google sometimes returns non-JSON error pages.
        let text = resp.text().await.map_err(|e| e.to_string())?;
        let body = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "rawBody": text }));
        Ok((status, body))
    }

    /// 401 → refresh once → retry; 429/5xx/network → retry with backoff.
    async fn request(&self, method: Method, url: &str, payload: Option<&Value>) -> Result<Value, String> {
        let mut last_err = String::new();
        for attempt in 0..=RETRY_DELAYS_MS.len() {
            let token = match self.get_token().await {
                Ok(t) => t,
                Err(e) => {
                    last_err = e;
                    if let Some(&ms) = RETRY_DELAYS_MS.get(attempt) {
                        tokio::time::sleep(Duration::from_millis(ms)).await;
                        continue;
                    }
                    return Err(last_err);
                }
            };
            match self.do_request(method.clone(), url, &token, payload).await {
                Ok((status, body)) => {
                    let (status, body) = if status == 401 {
                        let fresh = self.refresh_if_stale(&token).await?;
                        self.do_request(method.clone(), url, &fresh, payload).await?
                    } else {
                        (status, body)
                    };
                    if (200..300).contains(&status) {
                        return Ok(body);
                    }
                    last_err = api_error_message(&body, status);
                    if status == 429 || status >= 500 {
                        if let Some(&ms) = RETRY_DELAYS_MS.get(attempt) {
                            tokio::time::sleep(Duration::from_millis(ms)).await;
                            continue;
                        }
                    }
                    return Err(last_err); // other 4xx are not retried
                }
                Err(e) => {
                    last_err = format!("Google Health API: {e}");
                    if let Some(&ms) = RETRY_DELAYS_MS.get(attempt) {
                        tokio::time::sleep(Duration::from_millis(ms)).await;
                        continue;
                    }
                    return Err(last_err);
                }
            }
        }
        Err(last_err)
    }

    // ── Public API (signatures unchanged — tools.rs not affected) ──────────

    pub async fn api_get(&self, url: &str) -> Result<Value, String> {
        self.request(Method::GET, url, None).await
    }

    pub async fn api_post(&self, url: &str, payload: &Value) -> Result<Value, String> {
        self.request(Method::POST, url, Some(payload)).await
    }

    pub async fn api_patch(&self, url: &str, payload: &Value) -> Result<Value, String> {
        self.request(Method::PATCH, url, Some(payload)).await
    }
}

fn api_error_message(body: &Value, status: u16) -> String {
    if let Some(msg) = body.pointer("/error/message").and_then(|m| m.as_str()) {
        return format!("Google Health API error (HTTP {status}): {msg}");
    }
    // Truncate to 500 chars to avoid dumping full HTML error pages.
    let body_str = serde_json::to_string_pretty(body).unwrap_or_default();
    let body_str = body_str.chars().take(500).collect::<String>();
    format!("Google Health API: HTTP {status}: {body_str}")
}
