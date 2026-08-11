package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
)

const base = "https://health.googleapis.com/v4/users/me"

// ─── Result helpers ──────────────────────────────────────────────────────────

func okResult(v interface{}) (*mcp.CallToolResult, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		data = []byte("{}")
	}
	return mcp.NewToolResultText(string(data)), nil
}

func errResult(msg string) (*mcp.CallToolResult, error) {
	return mcp.NewToolResultError("ERROR: " + msg), nil
}

func errWithSteps(msg string, steps []string) (*mcp.CallToolResult, error) {
	body := map[string]interface{}{
		"error":      msg,
		"next_steps": steps,
	}
	data, _ := json.MarshalIndent(body, "", "  ")
	result := mcp.NewToolResultError(string(data))
	return result, nil
}

// apiErr classifies an upstream API error and attaches scenario-specific next_steps.
func apiErr(e string) (*mcp.CallToolResult, error) {
	lower := strings.ToLower(e)
	if strings.Contains(e, "HTTP 403") || strings.Contains(lower, "forbidden") || strings.Contains(lower, "permission") {
		return errWithSteps(e, []string{
			"Check OAuth scopes include the required permission",
			"Run oauth_health.py to re-authorize",
		})
	}
	if strings.Contains(lower, "filter") {
		return errWithSteps(e, []string{
			"Call describe_data_type for the correct filter syntax",
			"Use start_time/end_time params instead of manual filter",
		})
	}
	if strings.Contains(e, "HTTP 404") || strings.Contains(lower, "not found") {
		return errWithSteps(e, []string{
			"Call list_data_types to see all 39 supported types",
			"Check the type ID is kebab-case (e.g. heart-rate, not heartRate)",
		})
	}
	if strings.Contains(e, "HTTP 400") {
		return errWithSteps(e, []string{
			"Check the request body format",
			"Call describe_data_type for field names",
		})
	}
	return errResult(e)
}

// addPaginationHint attaches a _hint to responses that carry a nextPageToken.
func addPaginationHint(v map[string]interface{}) {
	if _, ok := v["nextPageToken"]; ok {
		v["_hint"] = "More data available. Pass nextPageToken to fetch the next page."
	}
}

// ─── Simplify helpers ────────────────────────────────────────────────────────

func simplifyPoint(obj map[string]interface{}) {
	delete(obj, "dataSource")
	delete(obj, "createTime")
	delete(obj, "updateTime")
	// Drop nested objects that are empty ({}).
	for k, val := range obj {
		if m, ok := val.(map[string]interface{}); ok && len(m) == 0 {
			delete(obj, k)
		}
	}
}

func simplifyResponse(v map[string]interface{}) {
	handled := false
	for _, key := range []string{"dataPoints", "rollupDataPoints"} {
		if pts, ok := v[key].([]interface{}); ok {
			for _, pt := range pts {
				if obj, ok := pt.(map[string]interface{}); ok {
					simplifyPoint(obj)
				}
			}
			handled = true
		}
	}
	if !handled {
		simplifyPoint(v)
	}
}

// asNum extracts float64 from a JSON value that may be a number or a numeric string.
func asNum(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case uint64:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	default:
		return 0, false
	}
}

// ─── URL encoding ────────────────────────────────────────────────────────────

func urlenc(s string) string {
	return url.QueryEscape(s)
}

// ─── Date helpers ────────────────────────────────────────────────────────────

func parseCivilDate(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, fmt.Errorf("Invalid date '%s': expected YYYY-MM-DD (e.g. 2026-07-25)", s)
	}
	return t, nil
}

func dateObj(d time.Time) map[string]interface{} {
	return map[string]interface{}{
		"year":  d.Year(),
		"month": int(d.Month()),
		"day":   d.Day(),
	}
}

func dateObjToStr(v interface{}) string {
	m, ok := v.(map[string]interface{})
	if !ok {
		return ""
	}
	y := getInt(m, "year")
	mo := getInt(m, "month")
	d := getInt(m, "day")
	return fmt.Sprintf("%04d-%02d-%02d", y, mo, d)
}

func getInt(m map[string]interface{}, key string) int {
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return 0
}

func snakeToCamel(s string) string {
	parts := strings.Split(s, "_")
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, "")
}

func round1(f float64) float64 {
	return math.Round(f*10) / 10
}

func round2(f float64) float64 {
	return math.Round(f*100) / 100
}

// ─── Filter builder ──────────────────────────────────────────────────────────

func buildFilter(dataType, sinceTime string, untilTime *string) string {
	snakeType := KebabToSnake(dataType)
	var filter string

	switch dataType {
	case "sleep":
		filter = fmt.Sprintf("sleep.interval.end_time >= \"%s\"", sinceTime)
	case "exercise", "hydration-log", "nutrition-log", "irregular-rhythm-notification":
		civilDate := sinceTime
		if len(civilDate) > 10 {
			civilDate = civilDate[:10]
		}
		filter = fmt.Sprintf("%s.interval.civil_start_time >= \"%s\"", snakeType, civilDate)
	case "daily-resting-heart-rate", "daily-heart-rate-variability", "daily-heart-rate-zones",
		"daily-oxygen-saturation", "daily-respiratory-rate", "daily-sleep-temperature-derivations",
		"daily-vo2-max":
		civilDate := sinceTime
		if len(civilDate) > 10 {
			civilDate = civilDate[:10]
		}
		filter = fmt.Sprintf("%s.date >= \"%s\"", snakeType, civilDate)
	case "heart-rate", "weight", "height", "body-fat", "blood-glucose", "core-body-temperature",
		"heart-rate-variability", "oxygen-saturation", "respiratory-rate-sleep-summary",
		"vo2-max", "run-vo2-max":
		filter = fmt.Sprintf("%s.sample_time.physical_time >= \"%s\"", snakeType, sinceTime)
	case "electrocardiogram":
		filter = fmt.Sprintf("electrocardiogram.interval.start_time >= \"%s\"", sinceTime)
	default:
		filter = fmt.Sprintf("%s.interval.start_time >= \"%s\"", snakeType, sinceTime)
	}

	if untilTime != nil {
		until := *untilTime
		switch dataType {
		case "sleep":
			filter += fmt.Sprintf(" AND sleep.interval.end_time < \"%s\"", until)
		case "exercise", "hydration-log", "nutrition-log", "irregular-rhythm-notification":
			civilDate := until
			if len(civilDate) > 10 {
				civilDate = civilDate[:10]
			}
			filter += fmt.Sprintf(" AND %s.interval.civil_start_time < \"%s\"", snakeType, civilDate)
		case "daily-resting-heart-rate", "daily-heart-rate-variability", "daily-heart-rate-zones",
			"daily-oxygen-saturation", "daily-respiratory-rate", "daily-sleep-temperature-derivations",
			"daily-vo2-max":
			civilDate := until
			if len(civilDate) > 10 {
				civilDate = civilDate[:10]
			}
			filter += fmt.Sprintf(" AND %s.date < \"%s\"", snakeType, civilDate)
		case "heart-rate", "weight", "height", "body-fat", "blood-glucose", "core-body-temperature",
			"heart-rate-variability", "oxygen-saturation", "respiratory-rate-sleep-summary",
			"vo2-max", "run-vo2-max":
			filter += fmt.Sprintf(" AND %s.sample_time.physical_time < \"%s\"", snakeType, until)
		case "electrocardiogram":
			// ECG only supports >= filters; no upper bound.
		default:
			filter += fmt.Sprintf(" AND %s.interval.start_time < \"%s\"", snakeType, until)
		}
	}
	return filter
}

// ─── JSON pointer helper ─────────────────────────────────────────────────────

// jsonPointer navigates a nested map using "/" separated path.
func jsonPointer(m map[string]interface{}, path string) interface{} {
	parts := strings.Split(path, "/")
	var current interface{} = m
	for _, part := range parts {
		switch v := current.(type) {
		case map[string]interface{}:
			current = v[part]
		case []interface{}:
			idx, err := strconv.Atoi(part)
			if err != nil || idx < 0 || idx >= len(v) {
				return nil
			}
			current = v[idx]
		default:
			return nil
		}
	}
	return current
}

func jsonPointerUint(m map[string]interface{}, path string) uint64 {
	v := jsonPointer(m, path)
	if v == nil {
		return 0
	}
	if n, ok := asNum(v); ok {
		return uint64(n)
	}
	return 0
}

func getFloat(m map[string]interface{}, key string) float64 {
	if v, ok := m[key]; ok {
		if n, ok := asNum(v); ok {
			return n
		}
	}
	return 0
}

func avgSlice(vals []float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	var sum float64
	for _, v := range vals {
		sum += v
	}
	return sum / float64(len(vals))
}

func minMaxSlice(vals []float64) (float64, float64) {
	if len(vals) == 0 {
		return 0, 0
	}
	min, max := vals[0], vals[0]
	for _, v := range vals[1:] {
		if v < min {
			min = v
		}
		if v > max {
			max = v
		}
	}
	return min, max
}
