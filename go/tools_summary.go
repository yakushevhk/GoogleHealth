package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
)

// ─── Daily summary infrastructure ───────────────────────────────────────────

const concurrency = 10

type rollupSpecT struct {
	dataType string
	field    string
	key      string
}

var rollupSpecs = []rollupSpecT{
	{"steps", "steps", "steps"},
	{"heart-rate", "heartRate", "heart_rate"},
	{"active-energy-burned", "activeEnergyBurned", "active_calories"},
	{"total-calories", "totalCalories", "total_calories"},
	{"distance", "distance", "distance"},
	{"active-minutes", "activeMinutes", "active_minutes"},
	{"active-zone-minutes", "activeZoneMinutes", "active_zone_minutes"},
	{"floors", "floors", "floors"},
	{"time-in-heart-rate-zone", "timeInHeartRateZone", "time_in_heart_rate_zone"},
	{"calories-in-heart-rate-zone", "caloriesInHeartRateZone", "calories_in_heart_rate_zone"},
	{"altitude", "altitude", "altitude"},
	{"swim-lengths-data", "swimLengthsData", "swim_lengths"},
	{"weight", "weight", "weight_rollup"},
	{"body-fat", "bodyFat", "body_fat"},
	{"blood-glucose", "bloodGlucose", "blood_glucose"},
	{"core-body-temperature", "coreBodyTemperature", "core_body_temperature"},
	{"run-vo2-max", "runVo2Max", "run_vo2_max"},
	{"sedentary-period", "sedentaryPeriod", "sedentary_period"},
	{"nutrition-log", "nutritionLog", "nutrition_log"},
	{"hydration-log", "hydrationLog", "hydration_log"},
}

type dailySpecT struct {
	dataType    string
	filterField string
	dataField   string
	key         string
}

var dailySpecs = []dailySpecT{
	{"daily-resting-heart-rate", "daily_resting_heart_rate", "dailyRestingHeartRate", "resting_heart_rate"},
	{"daily-heart-rate-variability", "daily_heart_rate_variability", "dailyHeartRateVariability", "heart_rate_variability"},
	{"daily-oxygen-saturation", "daily_oxygen_saturation", "dailyOxygenSaturation", "oxygen_saturation"},
	{"daily-respiratory-rate", "daily_respiratory_rate", "dailyRespiratoryRate", "respiratory_rate"},
	{"daily-sleep-temperature-derivations", "daily_sleep_temperature_derivations", "dailySleepTemperatureDerivations", "sleep_temperature"},
	{"daily-vo2-max", "daily_vo2_max", "dailyVo2Max", "daily_vo2_max"},
	{"daily-heart-rate-zones", "daily_heart_rate_zones", "dailyHeartRateZones", "daily_heart_rate_zones"},
}

type sampleSpecT struct {
	dataType    string
	filterField string
	dataField   string
	key         string
}

var sampleSpecs = []sampleSpecT{
	{"vo2-max", "vo2_max", "vo2Max", "vo2_max"},
	{"heart-rate-variability", "heart_rate_variability", "heartRateVariability", "hrv_sample"},
	{"oxygen-saturation", "oxygen_saturation", "oxygenSaturation", "spo2_sample"},
	{"respiratory-rate-sleep-summary", "respiratory_rate_sleep_summary", "respiratoryRateSleepSummary", "respiratory_rate_sleep"},
}

func firstPointField(v map[string]interface{}, field string) interface{} {
	pts, ok := v["dataPoints"].([]interface{})
	if !ok || len(pts) == 0 {
		return nil
	}
	p, ok := pts[0].(map[string]interface{})
	if !ok {
		return nil
	}
	return p[field]
}

func buildDailySummary(ctx context.Context, auth *AuthState, date time.Time) map[string]interface{} {
	dateS := date.Format("2006-01-02")
	nextS := date.AddDate(0, 0, 1).Format("2006-01-02")
	summary := map[string]interface{}{"date": dateS}

	type taskResult struct {
		key string
		val interface{}
		err string
	}

	results := make(chan taskResult, 40)
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	// dailyRollUp metrics (20)
	rollupBody := map[string]interface{}{
		"range": map[string]interface{}{
			"start": map[string]interface{}{"date": dateObj(date)},
			"end":   map[string]interface{}{"date": dateObj(date.AddDate(0, 0, 1))},
		},
		"windowSizeDays": 1,
	}
	for _, spec := range rollupSpecs {
		wg.Add(1)
		sem <- struct{}{}
		go func(s rollupSpecT) {
			defer wg.Done()
			defer func() { <-sem }()
			apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints:dailyRollUp", base, s.dataType)
			resp, err := auth.APIPost(apiURL, rollupBody)
			if err != nil {
				results <- taskResult{key: s.key, err: fmt.Sprintf("%s: %v", s.dataType, err)}
				return
			}
			var v map[string]interface{}
			json.Unmarshal(resp, &v)
			val := jsonPointer(v, "rollupDataPoints/0/"+s.field)
			results <- taskResult{key: s.key, val: val}
		}(spec)
	}

	// Daily types (7)
	for _, spec := range dailySpecs {
		wg.Add(1)
		sem <- struct{}{}
		go func(s dailySpecT) {
			defer wg.Done()
			defer func() { <-sem }()
			f := fmt.Sprintf("%s.date >= \"%s\" AND %s.date < \"%s\"", s.filterField, dateS, s.filterField, nextS)
			apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints?filter=%s&pageSize=1", base, s.dataType, urlenc(f))
			resp, err := auth.APIGet(apiURL)
			if err != nil {
				results <- taskResult{key: s.key, err: fmt.Sprintf("%s: %v", s.dataType, err)}
				return
			}
			var v map[string]interface{}
			json.Unmarshal(resp, &v)
			results <- taskResult{key: s.key, val: firstPointField(v, s.dataField)}
		}(spec)
	}

	// Sample types (4)
	for _, spec := range sampleSpecs {
		wg.Add(1)
		sem <- struct{}{}
		go func(s sampleSpecT) {
			defer wg.Done()
			defer func() { <-sem }()
			f := fmt.Sprintf("%s.sample_time.civil_time >= \"%s\" AND %s.sample_time.civil_time < \"%s\"", s.filterField, dateS, s.filterField, nextS)
			apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints?filter=%s&pageSize=1", base, s.dataType, urlenc(f))
			resp, err := auth.APIGet(apiURL)
			if err != nil {
				results <- taskResult{key: s.key, err: fmt.Sprintf("%s: %v", s.dataType, err)}
				return
			}
			var v map[string]interface{}
			json.Unmarshal(resp, &v)
			results <- taskResult{key: s.key, val: firstPointField(v, s.dataField)}
		}(spec)
	}

	// Sleep
	wg.Add(1)
	sem <- struct{}{}
	go func() {
		defer wg.Done()
		defer func() { <-sem }()
		f := fmt.Sprintf("sleep.interval.civil_end_time >= \"%s\" AND sleep.interval.civil_end_time < \"%s\"", dateS, nextS)
		apiURL := fmt.Sprintf("%s/dataTypes/sleep/dataPoints?filter=%s&pageSize=5", base, urlenc(f))
		resp, err := auth.APIGet(apiURL)
		if err != nil {
			results <- taskResult{key: "sleep", err: fmt.Sprintf("sleep: %v", err)}
			return
		}
		var v map[string]interface{}
		json.Unmarshal(resp, &v)
		var sleeps []interface{}
		if pts, ok := v["dataPoints"].([]interface{}); ok {
			for _, p := range pts {
				pm, ok := p.(map[string]interface{})
				if !ok {
					continue
				}
				s, ok := pm["sleep"].(map[string]interface{})
				if !ok {
					continue
				}
				sleeps = append(sleeps, map[string]interface{}{
					"start":          jsonPointer(s, "interval/startTime"),
					"end":            jsonPointer(s, "interval/endTime"),
					"startUtcOffset": jsonPointer(s, "interval/startUtcOffset"),
					"endUtcOffset":   jsonPointer(s, "interval/endUtcOffset"),
					"type":           s["type"],
					"stages":         s["stages"],
					"summary":        s["summary"],
					"metadata":       s["metadata"],
				})
			}
		}
		if len(sleeps) > 0 {
			results <- taskResult{key: "sleep", val: sleeps}
		} else {
			results <- taskResult{key: "sleep"}
		}
	}()

	// Exercise
	wg.Add(1)
	sem <- struct{}{}
	go func() {
		defer wg.Done()
		defer func() { <-sem }()
		f := fmt.Sprintf("exercise.interval.civil_start_time >= \"%s\" AND exercise.interval.civil_start_time < \"%s\"", dateS, nextS)
		apiURL := fmt.Sprintf("%s/dataTypes/exercise/dataPoints?filter=%s&pageSize=25", base, urlenc(f))
		resp, err := auth.APIGet(apiURL)
		if err != nil {
			results <- taskResult{key: "exercise", err: fmt.Sprintf("exercise: %v", err)}
			return
		}
		var v map[string]interface{}
		json.Unmarshal(resp, &v)
		var exercises []interface{}
		if pts, ok := v["dataPoints"].([]interface{}); ok {
			for _, p := range pts {
				pm, ok := p.(map[string]interface{})
				if !ok {
					continue
				}
				e, ok := pm["exercise"].(map[string]interface{})
				if !ok {
					continue
				}
				exercises = append(exercises, map[string]interface{}{
					"type":           e["exerciseType"],
					"name":           e["displayName"],
					"start":          jsonPointer(e, "interval/startTime"),
					"end":            jsonPointer(e, "interval/endTime"),
					"startUtcOffset": jsonPointer(e, "interval/startUtcOffset"),
					"endUtcOffset":   jsonPointer(e, "interval/endUtcOffset"),
					"duration":       e["activeDuration"],
					"metrics":        e["metricsSummary"],
					"metadata":       e["exerciseMetadata"],
				})
			}
		}
		if len(exercises) > 0 {
			results <- taskResult{key: "exercise", val: exercises}
		} else {
			results <- taskResult{key: "exercise"}
		}
	}()

	// Activity levels
	wg.Add(1)
	sem <- struct{}{}
	go func() {
		defer wg.Done()
		defer func() { <-sem }()
		f := fmt.Sprintf("activity_level.interval.start_time >= \"%sT00:00:00Z\" AND activity_level.interval.start_time < \"%sT00:00:00Z\"", dateS, nextS)
		apiURL := fmt.Sprintf("%s/dataTypes/activity-level/dataPoints?filter=%s&pageSize=50", base, urlenc(f))
		resp, err := auth.APIGet(apiURL)
		if err != nil {
			results <- taskResult{key: "activity_levels", err: fmt.Sprintf("activity-level: %v", err)}
			return
		}
		var v map[string]interface{}
		json.Unmarshal(resp, &v)
		var levels []interface{}
		if pts, ok := v["dataPoints"].([]interface{}); ok {
			for _, p := range pts {
				pm, ok := p.(map[string]interface{})
				if !ok {
					continue
				}
				if al := pm["activityLevel"]; al != nil {
					levels = append(levels, al)
				}
			}
		}
		if len(levels) > 0 {
			results <- taskResult{key: "activity_levels", val: levels}
		} else {
			results <- taskResult{key: "activity_levels"}
		}
	}()

	// Wait for all goroutines then close channel.
	go func() {
		wg.Wait()
		close(results)
	}()

	var errors []string
	for r := range results {
		if r.val != nil {
			summary[r.key] = r.val
		}
		if r.err != "" {
			errors = append(errors, r.err)
		}
	}
	if len(errors) > 0 {
		summary["_errors"] = errors
	}
	return summary
}

func dailySummary(ctx context.Context, auth *AuthState, date time.Time) (*mcp.CallToolResult, error) {
	key := fmt.Sprintf("summary:%s", date.Format("2006-01-02"))
	if cached, ok := auth.Cache.Get(key); ok {
		var v map[string]interface{}
		json.Unmarshal(cached, &v)
		v["_cached"] = true
		return okResult(v)
	}
	summary := buildDailySummary(ctx, auth, date)
	data, _ := json.Marshal(summary)
	auth.Cache.Set(key, data)
	return okResult(summary)
}

// ─── Tool: clear_cache ───────────────────────────────────────────────────────

func clearCacheHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	auth.Cache.Clear()
	return okResult(map[string]interface{}{"success": true, "message": "In-memory response cache cleared"})
}

// ─── Tool: summary ───────────────────────────────────────────────────────────

func summaryHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	dateStr, _ := req.GetArguments()["date"].(string)

	var date time.Time
	if dateStr != "" {
		var err error
		date, err = parseCivilDate(dateStr)
		if err != nil {
			return errResult(err.Error())
		}
	} else {
		date = time.Now()
	}
	return dailySummary(ctx, auth, date)
}

// ─── Tool: today ─────────────────────────────────────────────────────────────

func todayHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	return dailySummary(ctx, auth, time.Now())
}

// ─── Tool: yesterday ─────────────────────────────────────────────────────────

func yesterdayHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	return dailySummary(ctx, auth, time.Now().AddDate(0, 0, -1))
}
