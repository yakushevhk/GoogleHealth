package main

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
)

func TestUrlenc(t *testing.T) {
	filter := `steps.interval.start_time >= "2026-07-26T00:00:00Z"`
	encoded := urlenc(filter)
	if containsAny(encoded, ' ', '"', '>') {
		t.Errorf("urlenc should encode special chars, got: %s", encoded)
	}
	// url.QueryEscape encodes spaces as "+" (valid in query strings).
	if !contains(encoded, "+") && !contains(encoded, "%20") {
		t.Error("urlenc should encode spaces")
	}
}

func TestParseCivilDate(t *testing.T) {
	valid, err := parseCivilDate("2026-07-26")
	if err != nil {
		t.Fatalf("parseCivilDate(2026-07-26) failed: %v", err)
	}
	if valid.Year() != 2026 || valid.Month() != 7 || valid.Day() != 26 {
		t.Errorf("parseCivilDate(2026-07-26) = %v", valid)
	}

	_, err = parseCivilDate("invalid-date")
	if err == nil {
		t.Error("parseCivilDate(invalid-date) should fail")
	}
}

func TestDateObj(t *testing.T) {
	date := time.Date(2026, 7, 26, 0, 0, 0, 0, time.UTC)
	obj := dateObj(date)
	if obj["year"] != 2026 || obj["month"] != 7 || obj["day"] != 26 {
		t.Errorf("dateObj = %v", obj)
	}
}

func TestDateObjToStr(t *testing.T) {
	tests := []struct {
		input    map[string]interface{}
		expected string
	}{
		{map[string]interface{}{"year": float64(2026), "month": float64(7), "day": float64(28)}, "2026-07-28"},
		{map[string]interface{}{"year": float64(2026), "month": float64(12), "day": float64(5)}, "2026-12-05"},
		{map[string]interface{}{"year": float64(2026)}, "2026-00-00"},
	}
	for _, tt := range tests {
		got := dateObjToStr(tt.input)
		if got != tt.expected {
			t.Errorf("dateObjToStr(%v) = %s, want %s", tt.input, got, tt.expected)
		}
	}
}

func TestBuildFilter(t *testing.T) {
	tests := []struct {
		dataType string
		since    string
		until    *string
		expected string
	}{
		{
			"heart-rate", "2026-07-26T00:00:00Z", nil,
			`heart_rate.sample_time.physical_time >= "2026-07-26T00:00:00Z"`,
		},
		{
			"steps", "2026-07-26T00:00:00Z", strPtr("2026-07-27T00:00:00Z"),
			`steps.interval.start_time >= "2026-07-26T00:00:00Z" AND steps.interval.start_time < "2026-07-27T00:00:00Z"`,
		},
		{
			"sleep", "2026-07-26T00:00:00Z", nil,
			`sleep.interval.end_time >= "2026-07-26T00:00:00Z"`,
		},
		{
			"daily-resting-heart-rate", "2026-07-26", nil,
			`daily_resting_heart_rate.date >= "2026-07-26"`,
		},
		{
			"exercise", "2026-07-26T00:00:00Z", nil,
			`exercise.interval.civil_start_time >= "2026-07-26"`,
		},
		{
			"electrocardiogram", "2026-07-26T00:00:00Z", strPtr("2026-07-27T00:00:00Z"),
			`electrocardiogram.interval.start_time >= "2026-07-26T00:00:00Z"`,
		},
	}

	for _, tt := range tests {
		got := buildFilter(tt.dataType, tt.since, tt.until)
		if got != tt.expected {
			t.Errorf("buildFilter(%s, %s, %v):\n  got:  %s\n  want: %s", tt.dataType, tt.since, tt.until, got, tt.expected)
		}
	}
}

func TestSnakeToCamel(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"active_energy_burned", "activeEnergyBurned"},
		{"steps", "steps"},
		{"heart_rate", "heartRate"},
		{"daily_resting_heart_rate", "dailyRestingHeartRate"},
	}
	for _, tt := range tests {
		got := snakeToCamel(tt.input)
		if got != tt.expected {
			t.Errorf("snakeToCamel(%s) = %s, want %s", tt.input, got, tt.expected)
		}
	}
}

func TestKebabToSnake(t *testing.T) {
	if got := KebabToSnake("heart-rate"); got != "heart_rate" {
		t.Errorf("KebabToSnake(heart-rate) = %s, want heart_rate", got)
	}
	if got := KebabToSnake("daily-resting-heart-rate"); got != "daily_resting_heart_rate" {
		t.Errorf("KebabToSnake(daily-resting-heart-rate) = %s, want daily_resting_heart_rate", got)
	}
}

func TestSimplifyPoint(t *testing.T) {
	obj := map[string]interface{}{
		"dataSource": "foo",
		"createTime": "2026-01-01",
		"updateTime": "2026-01-02",
		"empty":      map[string]interface{}{},
		"keep":       "value",
	}
	simplifyPoint(obj)
	if _, ok := obj["dataSource"]; ok {
		t.Error("dataSource should be removed")
	}
	if _, ok := obj["createTime"]; ok {
		t.Error("createTime should be removed")
	}
	if _, ok := obj["updateTime"]; ok {
		t.Error("updateTime should be removed")
	}
	if _, ok := obj["empty"]; ok {
		t.Error("empty object should be removed")
	}
	if obj["keep"] != "value" {
		t.Error("keep should be preserved")
	}
}

func TestJsonPointer(t *testing.T) {
	m := map[string]interface{}{
		"a": map[string]interface{}{
			"b": map[string]interface{}{
				"c": float64(42),
			},
		},
		"arr": []interface{}{
			map[string]interface{}{"x": "first"},
			map[string]interface{}{"x": "second"},
		},
	}

	if v := jsonPointer(m, "a/b/c"); v != float64(42) {
		t.Errorf("jsonPointer(a/b/c) = %v, want 42", v)
	}
	if v := jsonPointer(m, "arr/0/x"); v != "first" {
		t.Errorf("jsonPointer(arr/0/x) = %v, want first", v)
	}
	if v := jsonPointer(m, "arr/1/x"); v != "second" {
		t.Errorf("jsonPointer(arr/1/x) = %v, want second", v)
	}
	if v := jsonPointer(m, "nonexistent"); v != nil {
		t.Errorf("jsonPointer(nonexistent) = %v, want nil", v)
	}
}

func TestAsNum(t *testing.T) {
	if v, ok := asNum(float64(42.5)); !ok || v != 42.5 {
		t.Errorf("asNum(42.5) = %v, %v", v, ok)
	}
	if v, ok := asNum("123.4"); !ok || v != 123.4 {
		t.Errorf("asNum(\"123.4\") = %v, %v", v, ok)
	}
	if _, ok := asNum("not-a-number"); ok {
		t.Error("asNum(\"not-a-number\") should fail")
	}
	if _, ok := asNum(nil); ok {
		t.Error("asNum(nil) should fail")
	}
}

func TestRound(t *testing.T) {
	if round1(3.14159) != 3.1 {
		t.Errorf("round1(3.14159) = %v, want 3.1", round1(3.14159))
	}
	if round2(3.14159) != 3.14 {
		t.Errorf("round2(3.14159) = %v, want 3.14", round2(3.14159))
	}
}

func TestAvgSlice(t *testing.T) {
	if avgSlice(nil) != 0 {
		t.Error("avgSlice(nil) should be 0")
	}
	if avgSlice([]float64{10, 20, 30}) != 20 {
		t.Errorf("avgSlice([10,20,30]) = %v, want 20", avgSlice([]float64{10, 20, 30}))
	}
}

func TestMinMaxSlice(t *testing.T) {
	min, max := minMaxSlice(nil)
	if min != 0 || max != 0 {
		t.Errorf("minMaxSlice(nil) = (%v, %v), want (0, 0)", min, max)
	}
	min, max = minMaxSlice([]float64{5, 2, 8, 1, 9})
	if min != 1 || max != 9 {
		t.Errorf("minMaxSlice([5,2,8,1,9]) = (%v, %v), want (1, 9)", min, max)
	}
}

func TestResponseCache(t *testing.T) {
	cache := NewResponseCache(1) // 1 second TTL
	cache.Set("key1", []byte(`{"hello":"world"}`))

	val, ok := cache.Get("key1")
	if !ok {
		t.Fatal("cache.Get(key1) should hit")
	}
	if string(val) != `{"hello":"world"}` {
		t.Errorf("cache value = %s", string(val))
	}

	_, ok = cache.Get("nonexistent")
	if ok {
		t.Error("cache.Get(nonexistent) should miss")
	}

	cache.Clear()
	_, ok = cache.Get("key1")
	if ok {
		t.Error("cache.Get(key1) should miss after Clear()")
	}
}

func TestResponseCacheTTLExpiry(t *testing.T) {
	cache := NewResponseCache(0) // 0 second TTL = immediate expiry
	cache.Set("key1", []byte(`{"hello":"world"}`))
	// With 0 TTL, time.Since >= 0 is always true, so it should expire immediately.
	_, ok := cache.Get("key1")
	if ok {
		t.Error("cache with 0s TTL should expire immediately")
	}
}

func TestSimplifyResponse(t *testing.T) {
	// With dataPoints array
	v := map[string]interface{}{
		"dataPoints": []interface{}{
			map[string]interface{}{
				"dataSource": "foo",
				"createTime": "2026-01-01",
				"steps":      map[string]interface{}{"countSum": "100"},
			},
		},
		"nextPageToken": "abc",
	}
	simplifyResponse(v)
	pts := v["dataPoints"].([]interface{})
	pt := pts[0].(map[string]interface{})
	if _, ok := pt["dataSource"]; ok {
		t.Error("dataSource should be stripped from dataPoints")
	}
	if _, ok := pt["createTime"]; ok {
		t.Error("createTime should be stripped from dataPoints")
	}
	if pt["steps"] == nil {
		t.Error("steps should be preserved")
	}
	if v["nextPageToken"] != "abc" {
		t.Error("nextPageToken should be preserved")
	}

	// Without dataPoints (single object fallback)
	single := map[string]interface{}{
		"dataSource": "bar",
		"weight":     map[string]interface{}{"kilograms": 70.0},
	}
	simplifyResponse(single)
	if _, ok := single["dataSource"]; ok {
		t.Error("dataSource should be stripped from single object")
	}
	if single["weight"] == nil {
		t.Error("weight should be preserved")
	}
}

func TestAddPaginationHint(t *testing.T) {
	withToken := map[string]interface{}{"nextPageToken": "xyz"}
	addPaginationHint(withToken)
	if withToken["_hint"] == nil {
		t.Error("_hint should be added when nextPageToken present")
	}

	withoutToken := map[string]interface{}{"dataPoints": []interface{}{}}
	addPaginationHint(withoutToken)
	if _, ok := withoutToken["_hint"]; ok {
		t.Error("_hint should NOT be added without nextPageToken")
	}
}

func TestApiErr(t *testing.T) {
	tests := []struct {
		input    string
		contains string
	}{
		{"Google Health API error (HTTP 403): forbidden", "next_steps"},
		{"invalid filter syntax", "describe_data_type"},
		{"Google Health API error (HTTP 404): not found", "list_data_types"},
		{"Google Health API error (HTTP 400): bad request", "describe_data_type"},
		{"some random error", "ERROR: some random error"},
	}
	for _, tt := range tests {
		result, _ := apiErr(tt.input)
		if result == nil {
			t.Fatalf("apiErr(%q) returned nil", tt.input)
		}
		// Check that the result contains expected text in its content.
		found := false
		for _, c := range result.Content {
			if tc, ok := c.(mcp.TextContent); ok {
				if contains(tc.Text, tt.contains) {
					found = true
				}
			}
		}
		if !found {
			t.Errorf("apiErr(%q) should contain %q", tt.input, tt.contains)
		}
	}
}

func TestCalculateDeltas(t *testing.T) {
	a := map[string]interface{}{
		"avg_daily_steps":                uint64(10000),
		"avg_daily_active_calories_kcal": float64(500),
		"avg_daily_total_calories_kcal":  float64(2500),
		"avg_daily_distance_km":          float64(8.0),
		"avg_daily_floors":               uint64(10),
		"avg_heart_rate_bpm":             float64(72),
		"avg_sleep_minutes":              uint64(480),
		"avg_deep_sleep_minutes":         uint64(90),
		"avg_rem_sleep_minutes":          uint64(100),
		"avg_awake_minutes":              uint64(30),
		"avg_sleep_efficiency_pct":       float64(90),
		"avg_hrv_ms":                     float64(45),
		"avg_resting_hr_bpm":             float64(62),
	}
	b := map[string]interface{}{
		"avg_daily_steps":                uint64(12000),
		"avg_daily_active_calories_kcal": float64(600),
		"avg_daily_total_calories_kcal":  float64(2600),
		"avg_daily_distance_km":          float64(9.5),
		"avg_daily_floors":               uint64(12),
		"avg_heart_rate_bpm":             float64(70),
		"avg_sleep_minutes":              uint64(500),
		"avg_deep_sleep_minutes":         uint64(100),
		"avg_rem_sleep_minutes":          uint64(110),
		"avg_awake_minutes":              uint64(25),
		"avg_sleep_efficiency_pct":       float64(92),
		"avg_hrv_ms":                     float64(50),
		"avg_resting_hr_bpm":             float64(60),
	}

	deltas := calculateDeltas(a, b)

	// Check steps delta: 12000 - 10000 = 2000, +20%
	steps := deltas["avg_daily_steps"].(map[string]interface{})
	if steps["diff"] != float64(2000) {
		t.Errorf("steps diff = %v, want 2000", steps["diff"])
	}
	if steps["percentage_change"] != "20.0%" {
		t.Errorf("steps pct = %v, want 20.0%%", steps["percentage_change"])
	}

	// Check HRV delta: 50 - 45 = 5, +11.1%
	hrv := deltas["avg_hrv_ms"].(map[string]interface{})
	if hrv["diff"] != float64(5) {
		t.Errorf("hrv diff = %v, want 5", hrv["diff"])
	}

	// All 13 keys present
	if len(deltas) != 13 {
		t.Errorf("calculateDeltas should return 13 keys, got %d", len(deltas))
	}
}

func TestFirstPointField(t *testing.T) {
	// With data
	v := map[string]interface{}{
		"dataPoints": []interface{}{
			map[string]interface{}{"heartRate": map[string]interface{}{"bpm": 72}},
		},
	}
	result := firstPointField(v, "heartRate")
	if result == nil {
		t.Fatal("firstPointField should return value")
	}

	// Empty array
	empty := map[string]interface{}{"dataPoints": []interface{}{}}
	if firstPointField(empty, "heartRate") != nil {
		t.Error("firstPointField with empty array should return nil")
	}

	// Missing key
	noKey := map[string]interface{}{"other": "stuff"}
	if firstPointField(noKey, "heartRate") != nil {
		t.Error("firstPointField with missing dataPoints should return nil")
	}
}

func TestSnakeToKebab(t *testing.T) {
	if got := SnakeToKebab("heart_rate"); got != "heart-rate" {
		t.Errorf("SnakeToKebab(heart_rate) = %s, want heart-rate", got)
	}
	if got := SnakeToKebab("daily_resting_heart_rate"); got != "daily-resting-heart-rate" {
		t.Errorf("SnakeToKebab(daily_resting_heart_rate) = %s", got)
	}
}

func TestAsNumJsonNumber(t *testing.T) {
	v, ok := asNum(json.Number("42.5"))
	if !ok || v != 42.5 {
		t.Errorf("asNum(json.Number(42.5)) = %v, %v; want 42.5, true", v, ok)
	}
	// uint64 (used by compare_health_periods summary)
	v, ok = asNum(uint64(10000))
	if !ok || v != 10000 {
		t.Errorf("asNum(uint64(10000)) = %v, %v; want 10000, true", v, ok)
	}
	// int
	v, ok = asNum(int(42))
	if !ok || v != 42 {
		t.Errorf("asNum(int(42)) = %v, %v; want 42, true", v, ok)
	}
}

func TestBuildFilterWithUntil(t *testing.T) {
	// Sleep with until
	f := buildFilter("sleep", "2026-07-26T00:00:00Z", strPtr("2026-07-27T00:00:00Z"))
	expected := `sleep.interval.end_time >= "2026-07-26T00:00:00Z" AND sleep.interval.end_time < "2026-07-27T00:00:00Z"`
	if f != expected {
		t.Errorf("buildFilter sleep+until:\n  got:  %s\n  want: %s", f, expected)
	}

	// Daily type with until
	f = buildFilter("daily-resting-heart-rate", "2026-07-26", strPtr("2026-07-28"))
	expected = `daily_resting_heart_rate.date >= "2026-07-26" AND daily_resting_heart_rate.date < "2026-07-28"`
	if f != expected {
		t.Errorf("buildFilter daily+until:\n  got:  %s\n  want: %s", f, expected)
	}

	// Civil start with until
	f = buildFilter("exercise", "2026-07-26T10:00:00Z", strPtr("2026-07-28T00:00:00Z"))
	expected = `exercise.interval.civil_start_time >= "2026-07-26" AND exercise.interval.civil_start_time < "2026-07-28"`
	if f != expected {
		t.Errorf("buildFilter exercise+until:\n  got:  %s\n  want: %s", f, expected)
	}

	// Sample type with until
	f = buildFilter("heart-rate", "2026-07-26T00:00:00Z", strPtr("2026-07-27T00:00:00Z"))
	expected = `heart_rate.sample_time.physical_time >= "2026-07-26T00:00:00Z" AND heart_rate.sample_time.physical_time < "2026-07-27T00:00:00Z"`
	if f != expected {
		t.Errorf("buildFilter heart-rate+until:\n  got:  %s\n  want: %s", f, expected)
	}
}

func TestTimeFieldLabelsComplete(t *testing.T) {
	tests := []struct {
		tf    TimeField
		label string
	}{
		{TimeFieldIntervalStart, "interval.start_time (RFC3339)"},
		{TimeFieldIntervalCivilStart, "interval.civil_start_time (date)"},
		{TimeFieldIntervalEnd, "interval.end_time / civil_end_time"},
		{TimeFieldSamplePhysical, "sample_time.physical_time (RFC3339)"},
		{TimeFieldSampleCivil, "sample_time.civil_time (date)"},
		{TimeFieldDaily, "date (YYYY-MM-DD)"},
		{TimeFieldNone, "none (no time filter)"},
	}
	for _, tt := range tests {
		if got := tt.tf.Label(); got != tt.label {
			t.Errorf("TimeField(%s).Label() = %q, want %q", tt.tf, got, tt.label)
		}
	}
}

func TestFilterPathComplete(t *testing.T) {
	tests := []struct {
		tf       TimeField
		snake    string
		expected string
	}{
		{TimeFieldIntervalStart, "steps", "steps.interval.start_time"},
		{TimeFieldIntervalCivilStart, "exercise", "exercise.interval.civil_start_time"},
		{TimeFieldIntervalEnd, "sleep", "sleep.interval.end_time"},
		{TimeFieldSamplePhysical, "heart_rate", "heart_rate.sample_time.physical_time"},
		{TimeFieldSampleCivil, "weight", "weight.sample_time.civil_time"},
		{TimeFieldDaily, "daily_resting_heart_rate", "daily_resting_heart_rate.date"},
		{TimeFieldNone, "food", ""},
	}
	for _, tt := range tests {
		got := tt.tf.FilterPath(tt.snake)
		if got != tt.expected {
			t.Errorf("FilterPath(%s, %s) = %q, want %q", tt.tf, tt.snake, got, tt.expected)
		}
	}
}

func TestGetFloat(t *testing.T) {
	m := map[string]interface{}{"a": float64(42.5), "b": "10", "c": nil}
	if v := getFloat(m, "a"); v != 42.5 {
		t.Errorf("getFloat(a) = %v, want 42.5", v)
	}
	if v := getFloat(m, "b"); v != 10 {
		t.Errorf("getFloat(b) = %v, want 10", v)
	}
	if v := getFloat(m, "c"); v != 0 {
		t.Errorf("getFloat(c) = %v, want 0", v)
	}
	if v := getFloat(m, "missing"); v != 0 {
		t.Errorf("getFloat(missing) = %v, want 0", v)
	}
}

func TestJsonPointerUint(t *testing.T) {
	m := map[string]interface{}{
		"sleep": map[string]interface{}{
			"summary": map[string]interface{}{
				"minutesAsleep": "480",
			},
		},
	}
	if v := jsonPointerUint(m, "sleep/summary/minutesAsleep"); v != 480 {
		t.Errorf("jsonPointerUint = %d, want 480", v)
	}
	if v := jsonPointerUint(m, "sleep/summary/missing"); v != 0 {
		t.Errorf("jsonPointerUint(missing) = %d, want 0", v)
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func strPtr(s string) *string {
	return &s
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && containsSubstr(s, sub))
}

func containsSubstr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func containsAny(s string, chars ...byte) bool {
	for _, c := range s {
		for _, target := range chars {
			if byte(c) == target {
				return true
			}
		}
	}
	return false
}
