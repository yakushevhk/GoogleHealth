package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"
)

// Retry backoff delays for 429 / 5xx / network errors (mirrors astrojs gh-client.ts).
var retryDelaysMs = []int{500, 1500, 4000}

// Refresh token this far before actual expiry.
const expiryMargin = 60 * time.Second

// ─── Response Cache ──────────────────────────────────────────────────────────

type cacheEntry struct {
	insertedAt time.Time
	value      json.RawMessage
}

// ResponseCache is a TTL-based in-memory cache for API responses.
type ResponseCache struct {
	mu         sync.RWMutex
	entries    map[string]cacheEntry
	defaultTTL time.Duration
}

// NewResponseCache creates a cache with the given TTL in seconds.
func NewResponseCache(ttlSecs int) *ResponseCache {
	return &ResponseCache{
		entries:    make(map[string]cacheEntry),
		defaultTTL: time.Duration(ttlSecs) * time.Second,
	}
}

// Get returns a cached value if it exists and hasn't expired.
func (c *ResponseCache) Get(key string) (json.RawMessage, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[key]
	if !ok || time.Since(e.insertedAt) >= c.defaultTTL {
		return nil, false
	}
	return e.value, true
}

// Set stores a value in the cache.
func (c *ResponseCache) Set(key string, value json.RawMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = cacheEntry{insertedAt: time.Now(), value: value}
}

// Clear removes all entries from the cache.
func (c *ResponseCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]cacheEntry)
}

// ─── Auth State ──────────────────────────────────────────────────────────────

type tokenState struct {
	accessToken string
	expiresAt   time.Time
}

// AuthState manages OAuth tokens and provides authenticated HTTP methods
// with automatic retry and token refresh.
type AuthState struct {
	clientID     string
	clientSecret string
	refreshToken string

	tokenMu sync.RWMutex
	token   tokenState

	// Single-flight gate: only one goroutine refreshes at a time.
	refreshGate sync.Mutex

	http  *http.Client
	Cache *ResponseCache
}

// NewAuthState creates a new AuthState with the given OAuth credentials.
func NewAuthState(clientID, clientSecret, refreshToken string) *AuthState {
	return &AuthState{
		clientID:     clientID,
		clientSecret: clientSecret,
		refreshToken: refreshToken,
		http: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				DialContext:           (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
				MaxIdleConns:          100,
				IdleConnTimeout:       90 * time.Second,
				TLSHandshakeTimeout:   10 * time.Second,
				ExpectContinueTimeout: 1 * time.Second,
			},
		},
		Cache: NewResponseCache(120),
	}
}

func (a *AuthState) isTokenValid() bool {
	a.tokenMu.RLock()
	defer a.tokenMu.RUnlock()
	return a.token.accessToken != "" && time.Now().Add(expiryMargin).Before(a.token.expiresAt)
}

// GetToken returns a valid access token, refreshing if necessary.
func (a *AuthState) GetToken() (string, error) {
	a.tokenMu.RLock()
	if a.token.accessToken != "" && time.Now().Add(expiryMargin).Before(a.token.expiresAt) {
		t := a.token.accessToken
		a.tokenMu.RUnlock()
		return t, nil
	}
	a.tokenMu.RUnlock()

	// Single-flight: only one goroutine refreshes.
	a.refreshGate.Lock()
	defer a.refreshGate.Unlock()

	// Double-check after acquiring gate.
	a.tokenMu.RLock()
	if a.token.accessToken != "" && time.Now().Add(expiryMargin).Before(a.token.expiresAt) {
		t := a.token.accessToken
		a.tokenMu.RUnlock()
		return t, nil
	}
	a.tokenMu.RUnlock()

	return a.refreshInner()
}

// refreshIfStale refreshes the token only if it matches the stale value.
func (a *AuthState) refreshIfStale(stale string) (string, error) {
	a.refreshGate.Lock()
	defer a.refreshGate.Unlock()

	a.tokenMu.RLock()
	if a.token.accessToken != "" && a.token.accessToken != stale {
		t := a.token.accessToken
		a.tokenMu.RUnlock()
		return t, nil
	}
	a.tokenMu.RUnlock()

	return a.refreshInner()
}

// refreshInner performs the actual OAuth token refresh. Caller must hold refreshGate.
func (a *AuthState) refreshInner() (string, error) {
	data := fmt.Sprintf(
		"client_id=%s&client_secret=%s&refresh_token=%s&grant_type=refresh_token",
		a.clientID, a.clientSecret, a.refreshToken,
	)

	resp, err := a.http.Post(
		"https://oauth2.googleapis.com/token",
		"application/x-www-form-urlencoded",
		bytes.NewBufferString(data),
	)
	if err != nil {
		return "", fmt.Errorf("OAuth token refresh request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("OAuth token response read failed: %w", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("OAuth token response parse failed: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		desc := "unknown error"
		if d, ok := result["error_description"].(string); ok {
			desc = d
		} else if d, ok := result["error"].(string); ok {
			desc = d
		}
		return "", fmt.Errorf("OAuth refresh failed (HTTP %d): %s", resp.StatusCode, desc)
	}

	accessToken, ok := result["access_token"].(string)
	if !ok {
		return "", fmt.Errorf("OAuth response missing access_token")
	}

	expiresIn := 3600.0
	if v, ok := result["expires_in"].(float64); ok {
		expiresIn = v
	}

	a.tokenMu.Lock()
	a.token.accessToken = accessToken
	a.token.expiresAt = time.Now().Add(time.Duration(expiresIn) * time.Second)
	a.tokenMu.Unlock()

	return accessToken, nil
}

// ─── HTTP Plumbing ───────────────────────────────────────────────────────────

func (a *AuthState) doRequest(method, url, token string, payload []byte) (int, json.RawMessage, error) {
	var bodyReader io.Reader
	if payload != nil {
		bodyReader = bytes.NewReader(payload)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := a.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	// Read as text first: Google sometimes returns non-JSON error pages.
	text, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, err
	}

	// Try to parse as JSON; fall back to wrapping raw text.
	var body json.RawMessage
	if json.Valid(text) {
		body = text
	} else {
		wrapped, _ := json.Marshal(map[string]string{"rawBody": string(text)})
		body = wrapped
	}

	return resp.StatusCode, body, nil
}

// request performs an authenticated request with retry logic:
// 401 → refresh once → retry; 429/5xx/network → retries with backoff.
func (a *AuthState) request(method, url string, payload []byte) (json.RawMessage, error) {
	var lastErr string

	for attempt := 0; attempt <= len(retryDelaysMs); attempt++ {
		token, err := a.GetToken()
		if err != nil {
			lastErr = err.Error()
			if attempt < len(retryDelaysMs) {
				time.Sleep(time.Duration(retryDelaysMs[attempt]) * time.Millisecond)
				continue
			}
			return nil, fmt.Errorf("%s", lastErr)
		}

		status, body, err := a.doRequest(method, url, token, payload)
		if err != nil {
			lastErr = fmt.Sprintf("Google Health API: %v", err)
			if attempt < len(retryDelaysMs) {
				time.Sleep(time.Duration(retryDelaysMs[attempt]) * time.Millisecond)
				continue
			}
			return nil, fmt.Errorf("%s", lastErr)
		}

		// 401 → refresh and retry once.
		if status == 401 {
			fresh, rErr := a.refreshIfStale(token)
			if rErr != nil {
				return nil, rErr
			}
			status, body, err = a.doRequest(method, url, fresh, payload)
			if err != nil {
				return nil, fmt.Errorf("Google Health API: %v", err)
			}
		}

		if status >= 200 && status < 300 {
			return body, nil
		}

		lastErr = apiErrorMessage(body, status)
		if status == 429 || status >= 500 {
			if attempt < len(retryDelaysMs) {
				time.Sleep(time.Duration(retryDelaysMs[attempt]) * time.Millisecond)
				continue
			}
		}
		// Other 4xx: don't retry.
		return nil, fmt.Errorf("%s", lastErr)
	}

	return nil, fmt.Errorf("%s", lastErr)
}

// APIGet performs an authenticated GET request.
func (a *AuthState) APIGet(url string) (json.RawMessage, error) {
	return a.request(http.MethodGet, url, nil)
}

// APIPost performs an authenticated POST request.
func (a *AuthState) APIPost(url string, payload interface{}) (json.RawMessage, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}
	return a.request(http.MethodPost, url, data)
}

// APIPatch performs an authenticated PATCH request.
func (a *AuthState) APIPatch(url string, payload interface{}) (json.RawMessage, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}
	return a.request(http.MethodPatch, url, data)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func apiErrorMessage(body json.RawMessage, status int) string {
	var parsed map[string]interface{}
	if err := json.Unmarshal(body, &parsed); err == nil {
		if errObj, ok := parsed["error"].(map[string]interface{}); ok {
			if msg, ok := errObj["message"].(string); ok {
				return fmt.Sprintf("Google Health API error (HTTP %d): %s", status, msg)
			}
		}
	}
	// Truncate to 500 chars to avoid dumping full HTML error pages.
	s := string(body)
	if len(s) > 500 {
		s = s[:500]
	}
	return fmt.Sprintf("Google Health API: HTTP %d: %s", status, s)
}
