package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
)

// ─── Tool: compare_health_periods ────────────────────────────────────────────

func compareHealthPeriodsHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	periodAStart, _ := args["period_a_start"].(string)
	periodAEnd, _ := args["period_a_end"].(string)
	periodBStart, _ := args["period_b_start"].(string)
	periodBEnd, _ := args["period_b_end"].(string)

	dateAStart, err := parseCivilDate(periodAStart)
	if err != nil {
		return errResult(err.Error())
	}
	dateAEnd, err := parseCivilDate(periodAEnd)
	if err != nil {
		return errResult(err.Error())
	}
	dateBStart, err := parseCivilDate(periodBStart)
	if err != nil {
		return errResult(err.Error())
	}
	dateBEnd, err := parseCivilDate(periodBEnd)
	if err != nil {
		return errResult(err.Error())
	}

	summaryA := buildPeriodSummary(ctx, auth, dateAStart, dateAEnd)
	summaryB := buildPeriodSummary(ctx, auth, dateBStart, dateBEnd)
	comparison := calculateDeltas(summaryA, summaryB)

	result := map[string]interface{}{
		"period_a": map[string]interface{}{
			"start":   periodAStart,
			"end":     periodAEnd,
			"metrics": summaryA,
		},
		"period_b": map[string]interface{}{
			"start":   periodBStart,
			"end":     periodBEnd,
			"metrics": summaryB,
		},
		"comparison_delta": comparison,
	}
	return okResult(result)
}

func buildPeriodSummary(ctx context.Context, auth *AuthState, start, end time.Time) map[string]interface{} {
	startStr := start.Format("2006-01-02")
	endStr := end.AddDate(0, 0, 1).Format("2006-01-02")

	type rollupSpec struct {
		dataType string
		field    string
	}
	metrics := []rollupSpec{
		{"steps", "countSum"},
		{"active-energy-burned", "kcalSum"},
		{"total-calories", "kcalSum"},
		{"distance", "millimetersSum"},
		{"floors", "countSum"},
		{"heart-rate", "beatsPerMinuteAvg"},
	}

	results := make([]map[string]interface{}, len(metrics))
	var wg sync.WaitGroup

	for i, m := range metrics {
		wg.Add(1)
		go func(idx int, spec rollupSpec) {
			defer wg.Done()
			apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints:dailyRollUp", base, spec.dataType)
			body := map[string]interface{}{
				"range": map[string]interface{}{
					"start": map[string]interface{}{"date": dateObj(start)},
					"end":   map[string]interface{}{"date": dateObj(end.AddDate(0, 0, 1))},
				},
			}
			resp, err := auth.APIPost(apiURL, body)
			if err != nil {
				return
			}
			var v map[string]interface{}
			json.Unmarshal(resp, &v)
			results[idx] = v
		}(i, m)
	}

	// Sleep sessions
	var sleepData map[string]interface{}
	wg.Add(1)
	go func() {
		defer wg.Done()
		f := fmt.Sprintf("sleep.interval.civil_end_time >= \"%s\" AND sleep.interval.civil_end_time < \"%s\"", startStr, endStr)
		var allPoints []interface{}
		var pageToken string
		for {
			apiURL := fmt.Sprintf("%s/dataTypes/sleep/dataPoints?filter=%s&pageSize=25", base, urlenc(f))
			if pageToken != "" {
				apiURL += "&pageToken=" + urlenc(pageToken)
			}
			resp, err := auth.APIGet(apiURL)
			if err != nil {
				break
			}
			var v map[string]interface{}
			json.Unmarshal(resp, &v)
			if pts, ok := v["dataPoints"].([]interface{}); ok {
				allPoints = append(allPoints, pts...)
			}
			if token, ok := v["nextPageToken"].(string); ok && token != "" {
				pageToken = token
			} else {
				break
			}
		}
		if len(allPoints) > 0 {
			sleepData = map[string]interface{}{"dataPoints": allPoints}
		}
	}()

	// Daily HRV
	var hrvData map[string]interface{}
	wg.Add(1)
	go func() {
		defer wg.Done()
		f := fmt.Sprintf("daily_heart_rate_variability.date >= \"%s\" AND daily_heart_rate_variability.date < \"%s\"", startStr, endStr)
		apiURL := fmt.Sprintf("%s/dataTypes/daily-heart-rate-variability/dataPoints?filter=%s&pageSize=100", base, urlenc(f))
		resp, err := auth.APIGet(apiURL)
		if err != nil {
			return
		}
		var v map[string]interface{}
		json.Unmarshal(resp, &v)
		hrvData = v
	}()

	// Daily resting HR
	var rhrData map[string]interface{}
	wg.Add(1)
	go func() {
		defer wg.Done()
		f := fmt.Sprintf("daily_resting_heart_rate.date >= \"%s\" AND daily_resting_heart_rate.date < \"%s\"", startStr, endStr)
		apiURL := fmt.Sprintf("%s/dataTypes/daily-resting-heart-rate/dataPoints?filter=%s&pageSize=100", base, urlenc(f))
		resp, err := auth.APIGet(apiURL)
		if err != nil {
			return
		}
		var v map[string]interface{}
		json.Unmarshal(resp, &v)
		rhrData = v
	}()

	wg.Wait()

	days := int(end.Sub(start).Hours()/24) + 1

	extractSum := func(data map[string]interface{}, path string) float64 {
		if data == nil {
			return 0
		}
		pts, ok := data["rollupDataPoints"].([]interface{})
		if !ok {
			return 0
		}
		var sum float64
		for _, p := range pts {
			if pm, ok := p.(map[string]interface{}); ok {
				if v := jsonPointer(pm, path); v != nil {
					if n, ok := asNum(v); ok {
						sum += n
					}
				}
			}
		}
		return sum
	}

	extractAvg := func(data map[string]interface{}, path string) float64 {
		if data == nil {
			return 0
		}
		pts, ok := data["rollupDataPoints"].([]interface{})
		if !ok {
			return 0
		}
		var vals []float64
		for _, p := range pts {
			if pm, ok := p.(map[string]interface{}); ok {
				if v := jsonPointer(pm, path); v != nil {
					if n, ok := asNum(v); ok {
						vals = append(vals, n)
					}
				}
			}
		}
		if len(vals) == 0 {
			return 0
		}
		var sum float64
		for _, v := range vals {
			sum += v
		}
		return sum / float64(len(vals))
	}

	totalSteps := uint64(extractSum(results[0], "steps/countSum"))
	totalCalories := extractSum(results[1], "activeEnergyBurned/kcalSum")
	totalTotalCalories := extractSum(results[2], "totalCalories/kcalSum")
	totalDistanceKm := extractSum(results[3], "distance/millimetersSum") / 1_000_000.0
	totalFloors := uint64(extractSum(results[4], "floors/countSum"))
	avgHR := extractAvg(results[5], "heartRate/beatsPerMinuteAvg")

	// Sleep metrics
	var totalSleepMinutes, sleepSessions, totalDeepMinutes, totalRemMinutes, totalAwakeMinutes, totalSleepInPeriod uint64
	if sleepData != nil {
		if pts, ok := sleepData["dataPoints"].([]interface{}); ok {
			for _, p := range pts {
				pm, ok := p.(map[string]interface{})
				if !ok {
					continue
				}
				if v := jsonPointer(pm, "sleep/summary/minutesAsleep"); v != nil {
					mins := jsonPointerUint(pm, "sleep/summary/minutesAsleep")
					totalSleepMinutes += mins
					sleepSessions++
				}
				if mins := jsonPointerUint(pm, "sleep/summary/minutesInSleepPeriod"); mins > 0 {
					totalSleepInPeriod += mins
				}
				if stages := jsonPointer(pm, "sleep/summary/stagesSummary"); stages != nil {
					if arr, ok := stages.([]interface{}); ok {
						for _, s := range arr {
							if sm, ok := s.(map[string]interface{}); ok {
								stageType, _ := sm["type"].(string)
								mins := jsonPointerUint(sm, "minutes")
								switch stageType {
								case "DEEP":
									totalDeepMinutes += mins
								case "REM":
									totalRemMinutes += mins
								}
							}
						}
					}
				}
				if mins := jsonPointerUint(pm, "sleep/summary/minutesAwake"); mins > 0 {
					totalAwakeMinutes += mins
				}
			}
		}
	}

	// HRV average
	var hrvValues []float64
	if hrvData != nil {
		if pts, ok := hrvData["dataPoints"].([]interface{}); ok {
			for _, p := range pts {
				if pm, ok := p.(map[string]interface{}); ok {
					if v := jsonPointer(pm, "dailyHeartRateVariability/averageHeartRateVariabilityMilliseconds"); v != nil {
						if n, ok := asNum(v); ok {
							hrvValues = append(hrvValues, n)
						}
					}
				}
			}
		}
	}
	avgHRV := avgSlice(hrvValues)

	// Resting HR average
	var rhrValues []float64
	if rhrData != nil {
		if pts, ok := rhrData["dataPoints"].([]interface{}); ok {
			for _, p := range pts {
				if pm, ok := p.(map[string]interface{}); ok {
					if v := jsonPointer(pm, "dailyRestingHeartRate/beatsPerMinute"); v != nil {
						if n, ok := asNum(v); ok {
							rhrValues = append(rhrValues, n)
						}
					}
				}
			}
		}
	}
	avgRHR := avgSlice(rhrValues)

	var avgSteps uint64
	var avgCalories, avgTotalCal, avgDistance float64
	var avgFloors uint64
	if days > 0 {
		avgSteps = totalSteps / uint64(days)
		avgCalories = totalCalories / float64(days)
		avgTotalCal = totalTotalCalories / float64(days)
		avgDistance = totalDistanceKm / float64(days)
		avgFloors = totalFloors / uint64(days)
	}
	var avgSleep, avgDeep, avgRem, avgAwake uint64
	if sleepSessions > 0 {
		avgSleep = totalSleepMinutes / sleepSessions
		avgDeep = totalDeepMinutes / sleepSessions
		avgRem = totalRemMinutes / sleepSessions
		avgAwake = totalAwakeMinutes / sleepSessions
	}
	var avgEfficiency float64
	if totalSleepInPeriod > 0 {
		avgEfficiency = float64(totalSleepMinutes) / float64(totalSleepInPeriod) * 100.0
	}

	return map[string]interface{}{
		"days_count":                     days,
		"total_steps":                    totalSteps,
		"avg_daily_steps":                avgSteps,
		"total_active_calories_kcal":     round1(totalCalories),
		"avg_daily_active_calories_kcal": round1(avgCalories),
		"total_calories_kcal":            round1(totalTotalCalories),
		"avg_daily_total_calories_kcal":  round1(avgTotalCal),
		"total_distance_km":              round2(totalDistanceKm),
		"avg_daily_distance_km":          round2(avgDistance),
		"total_floors":                   totalFloors,
		"avg_daily_floors":               avgFloors,
		"avg_heart_rate_bpm":             round1(avgHR),
		"sleep_sessions":                 sleepSessions,
		"total_sleep_minutes":            totalSleepMinutes,
		"avg_sleep_minutes":              avgSleep,
		"avg_deep_sleep_minutes":         avgDeep,
		"avg_rem_sleep_minutes":          avgRem,
		"avg_awake_minutes":              avgAwake,
		"avg_sleep_efficiency_pct":       round1(avgEfficiency),
		"avg_hrv_ms":                     round1(avgHRV),
		"avg_resting_hr_bpm":             round1(avgRHR),
	}
}

func calculateDeltas(a, b map[string]interface{}) map[string]interface{} {
	delta := func(key string) map[string]interface{} {
		va := getFloat(a, key)
		vb := getFloat(b, key)
		diff := vb - va
		pct := 0.0
		if va != 0 {
			pct = (diff / va) * 100.0
		}
		return map[string]interface{}{
			"period_a":          va,
			"period_b":          vb,
			"diff":              round2(diff),
			"percentage_change": fmt.Sprintf("%.1f%%", pct),
		}
	}

	keys := []string{
		"avg_daily_steps", "avg_daily_active_calories_kcal", "avg_daily_total_calories_kcal",
		"avg_daily_distance_km", "avg_daily_floors", "avg_heart_rate_bpm",
		"avg_sleep_minutes", "avg_deep_sleep_minutes", "avg_rem_sleep_minutes",
		"avg_awake_minutes", "avg_sleep_efficiency_pct", "avg_hrv_ms", "avg_resting_hr_bpm",
	}
	result := make(map[string]interface{})
	for _, k := range keys {
		result[k] = delta(k)
	}
	return result
}

// ─── Tool: get_hrv_recovery_trend ────────────────────────────────────────────

func getHrvRecoveryTrendHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()

	daysCount := 14
	if d, ok := args["days"].(float64); ok && d > 0 {
		daysCount = int(d)
	}
	if daysCount > 90 {
		daysCount = 90
	}
	if daysCount < 1 {
		daysCount = 1
	}

	var end time.Time
	if ed, ok := args["end_date"].(string); ok && ed != "" {
		var err error
		end, err = parseCivilDate(ed)
		if err != nil {
			return errResult(err.Error())
		}
	} else {
		end = time.Now()
	}
	start := end.AddDate(0, 0, -(daysCount - 1))
	endPlusOne := end.AddDate(0, 0, 1)

	startStr := start.Format("2006-01-02")
	endPlusOneStr := endPlusOne.Format("2006-01-02")

	// Fetch HRV and RHR concurrently.
	var hrvData, rhrData map[string]interface{}
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		f := fmt.Sprintf("daily_heart_rate_variability.date >= \"%s\" AND daily_heart_rate_variability.date < \"%s\"", startStr, endPlusOneStr)
		apiURL := fmt.Sprintf("%s/dataTypes/daily-heart-rate-variability/dataPoints?filter=%s&pageSize=100", base, urlenc(f))
		resp, err := auth.APIGet(apiURL)
		if err != nil {
			return
		}
		json.Unmarshal(resp, &hrvData)
	}()

	go func() {
		defer wg.Done()
		f := fmt.Sprintf("daily_resting_heart_rate.date >= \"%s\" AND daily_resting_heart_rate.date < \"%s\"", startStr, endPlusOneStr)
		apiURL := fmt.Sprintf("%s/dataTypes/daily-resting-heart-rate/dataPoints?filter=%s&pageSize=100", base, urlenc(f))
		resp, err := auth.APIGet(apiURL)
		if err != nil {
			return
		}
		json.Unmarshal(resp, &rhrData)
	}()

	wg.Wait()

	// Parse HRV daily entries.
	var hrvValues []float64
	var hrvDaily []map[string]interface{}
	if hrvData != nil {
		if pts, ok := hrvData["dataPoints"].([]interface{}); ok {
			for _, p := range pts {
				pm, ok := p.(map[string]interface{})
				if !ok {
					continue
				}
				hrvObj, _ := pm["dailyHeartRateVariability"].(map[string]interface{})
				if hrvObj == nil {
					continue
				}
				rmssd := jsonPointer(hrvObj, "averageHeartRateVariabilityMilliseconds")
				if rmssd == nil {
					continue
				}
				rmssdVal, ok := asNum(rmssd)
				if !ok {
					continue
				}
				hrvValues = append(hrvValues, rmssdVal)

				date := ""
				if d := hrvObj["date"]; d != nil {
					date = dateObjToStr(d)
				}
				entry := map[string]interface{}{
					"date":       date,
					"avg_hrv_ms": rmssdVal,
				}
				if e := hrvObj["entropy"]; e != nil {
					entry["entropy"] = e
				}
				if d := hrvObj["deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds"]; d != nil {
					entry["deep_sleep_hrv_ms"] = d
				}
				if n := hrvObj["nonRemHeartRateBeatsPerMinute"]; n != nil {
					entry["non_rem_hr_bpm"] = n
				}
				hrvDaily = append(hrvDaily, entry)
			}
		}
	}

	// Parse RHR daily entries.
	var rhrValues []float64
	var rhrDaily []map[string]interface{}
	if rhrData != nil {
		if pts, ok := rhrData["dataPoints"].([]interface{}); ok {
			for _, p := range pts {
				pm, ok := p.(map[string]interface{})
				if !ok {
					continue
				}
				rhrObj, _ := pm["dailyRestingHeartRate"].(map[string]interface{})
				if rhrObj == nil {
					continue
				}
				bpm := rhrObj["beatsPerMinute"]
				if bpm == nil {
					continue
				}
				bpmVal, ok := asNum(bpm)
				if !ok {
					continue
				}
				rhrValues = append(rhrValues, bpmVal)

				date := ""
				if d := rhrObj["date"]; d != nil {
					date = dateObjToStr(d)
				}
				entry := map[string]interface{}{
					"date": date,
					"bpm":  bpmVal,
				}
				if m := jsonPointer(rhrObj, "dailyRestingHeartRateMetadata/calculationMethod"); m != nil {
					entry["calculation_method"] = m
				}
				rhrDaily = append(rhrDaily, entry)
			}
		}
	}

	// Sort by date.
	type dateVal struct {
		date string
		val  float64
	}
	var hrvSorted []dateVal
	for _, d := range hrvDaily {
		if date, ok := d["date"].(string); ok {
			if val, ok := d["avg_hrv_ms"].(float64); ok {
				hrvSorted = append(hrvSorted, dateVal{date, val})
			}
		}
	}
	sort.Slice(hrvSorted, func(i, j int) bool { return hrvSorted[i].date < hrvSorted[j].date })

	var rhrSorted []dateVal
	for _, d := range rhrDaily {
		if date, ok := d["date"].(string); ok {
			if val, ok := d["bpm"].(float64); ok {
				rhrSorted = append(rhrSorted, dateVal{date, val})
			}
		}
	}
	sort.Slice(rhrSorted, func(i, j int) bool { return rhrSorted[i].date < rhrSorted[j].date })

	hrvAvg := avgSlice(hrvValues)
	rhrAvg := avgSlice(rhrValues)

	// Personalized readiness.
	var readiness string
	var baselineHRV, baselineRHR, currentHRV, currentRHR float64
	var baselinePeriodLabel string

	if len(hrvSorted) >= 4 {
		blEnd := len(hrvSorted) - 3
		baselinePeriodLabel = fmt.Sprintf("first %d days", blEnd)
		var blSum float64
		for _, v := range hrvSorted[:blEnd] {
			blSum += v.val
		}
		baselineHRV = blSum / float64(blEnd)

		if len(rhrSorted) >= 4 {
			rhrBlEnd := len(rhrSorted) - 3
			var rhrBlSum float64
			for _, v := range rhrSorted[:rhrBlEnd] {
				rhrBlSum += v.val
			}
			baselineRHR = rhrBlSum / float64(rhrBlEnd)
		} else if len(rhrSorted) > 0 {
			var s float64
			for _, v := range rhrSorted {
				s += v.val
			}
			baselineRHR = s / float64(len(rhrSorted))
		}

		var curSum float64
		for _, v := range hrvSorted[blEnd:] {
			curSum += v.val
		}
		currentHRV = curSum / 3.0

		curRhrLen := len(rhrSorted)
		if curRhrLen > 3 {
			curRhrLen = 3
		}
		if curRhrLen > 0 {
			var s float64
			for _, v := range rhrSorted[len(rhrSorted)-curRhrLen:] {
				s += v.val
			}
			currentRHR = s / float64(curRhrLen)
		}

		if currentHRV >= baselineHRV*0.95 && (baselineRHR == 0 || currentRHR <= baselineRHR*1.05) {
			readiness = "HIGH"
		} else if currentHRV >= baselineHRV*0.85 {
			readiness = "MODERATE"
		} else {
			readiness = "LOW / RECOVERY NEEDED"
		}
	} else {
		baselinePeriodLabel = "first 7 days"
		if hrvAvg > 50 && rhrAvg > 0 && rhrAvg < 65 {
			readiness = "HIGH"
		} else if hrvAvg > 30 {
			readiness = "MODERATE"
		} else {
			readiness = "LOW / RECOVERY NEEDED"
		}
		currentHRV = hrvAvg
		currentRHR = rhrAvg
	}

	minHRV, maxHRV := minMaxSlice(hrvValues)
	minRHR, maxRHR := minMaxSlice(rhrValues)

	result := map[string]interface{}{
		"period": map[string]interface{}{
			"start_date": startStr,
			"end_date":   end.Format("2006-01-02"),
			"days":       daysCount,
		},
		"hrv_metrics": map[string]interface{}{
			"sample_count": len(hrvValues),
			"avg_hrv_ms":   round1(hrvAvg),
			"min_hrv_ms":   minHRV,
			"max_hrv_ms":   maxHRV,
		},
		"resting_hr_metrics": map[string]interface{}{
			"sample_count": len(rhrValues),
			"avg_bpm":      round1(rhrAvg),
			"min_bpm":      minRHR,
			"max_bpm":      maxRHR,
		},
		"baseline": map[string]interface{}{
			"period":          baselinePeriodLabel,
			"hrv_avg_ms":      round1(baselineHRV),
			"rhr_avg_bpm":     round1(baselineRHR),
			"data_sufficient": len(hrvSorted) >= 4,
		},
		"current": map[string]interface{}{
			"period":      "last 3 days",
			"hrv_avg_ms":  round1(currentHRV),
			"rhr_avg_bpm": round1(currentRHR),
		},
		"daily_hrv":            hrvDaily,
		"daily_rhr":            rhrDaily,
		"readiness_assessment": readiness,
	}
	return okResult(result)
}

// ─── Tool: get_temperature_summary ───────────────────────────────────────────

func getTemperatureSummaryHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	startDate, _ := args["start_date"].(string)
	endDate, _ := args["end_date"].(string)

	start, err := parseCivilDate(startDate)
	if err != nil {
		return errResult(err.Error())
	}
	end, err := parseCivilDate(endDate)
	if err != nil {
		return errResult(err.Error())
	}
	endExclusive := end.AddDate(0, 0, 1)

	var coreData, sleepTempData json.RawMessage
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		f := fmt.Sprintf("core_body_temperature.sample_time.physical_time >= \"%sT00:00:00Z\" AND core_body_temperature.sample_time.physical_time < \"%sT00:00:00Z\"",
			start.Format("2006-01-02"), endExclusive.Format("2006-01-02"))
		apiURL := fmt.Sprintf("%s/dataTypes/core-body-temperature/dataPoints?filter=%s&pageSize=100", base, urlenc(f))
		resp, err := auth.APIGet(apiURL)
		if err == nil {
			coreData = resp
		}
	}()

	go func() {
		defer wg.Done()
		f := fmt.Sprintf("daily_sleep_temperature_derivations.date >= \"%s\" AND daily_sleep_temperature_derivations.date < \"%s\"",
			startDate, endExclusive.Format("2006-01-02"))
		apiURL := fmt.Sprintf("%s/dataTypes/daily-sleep-temperature-derivations/dataPoints?filter=%s&pageSize=100", base, urlenc(f))
		resp, err := auth.APIGet(apiURL)
		if err == nil {
			sleepTempData = resp
		}
	}()

	wg.Wait()

	result := map[string]interface{}{
		"period": map[string]interface{}{
			"start_date": startDate,
			"end_date":   endDate,
		},
		"core_body_temperature":               json.RawMessage(coreData),
		"daily_sleep_temperature_derivations": json.RawMessage(sleepTempData),
		"note":                                "Google Health API v4 core-body-temperature is read-only; entries are synced automatically from connected wearables.",
	}
	return okResult(result)
}

// ─── Tool: get_trends ────────────────────────────────────────────────────────

func getTrendsHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	startDate, _ := args["start_date"].(string)
	endDate, _ := args["end_date"].(string)

	start, err := parseCivilDate(startDate)
	if err != nil {
		return errResult(err.Error())
	}
	end, err := parseCivilDate(endDate)
	if err != nil {
		return errResult(err.Error())
	}
	if start.After(end) {
		return errResult("end_date must be on or after start_date")
	}

	apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints:dailyRollUp", base, dataType)
	body := map[string]interface{}{
		"range": map[string]interface{}{
			"start": map[string]interface{}{"date": dateObj(start)},
			"end":   map[string]interface{}{"date": dateObj(end.AddDate(0, 0, 1))},
		},
		"windowSizeDays": 1,
	}

	resp, err2 := auth.APIPost(apiURL, body)
	if err2 != nil {
		return apiErr(err2.Error())
	}

	var v map[string]interface{}
	json.Unmarshal(resp, &v)

	snakeType := KebabToSnake(dataType)
	camelField := snakeToCamel(snakeType)
	var series []interface{}

	if pts, ok := v["rollupDataPoints"].([]interface{}); ok {
		for _, p := range pts {
			pm, ok := p.(map[string]interface{})
			if !ok {
				continue
			}
			date := ""
			if cst, ok := pm["civilStartTime"].(map[string]interface{}); ok {
				if d := cst["date"]; d != nil {
					date = dateObjToStr(d)
				}
			}
			series = append(series, map[string]interface{}{
				"date":  date,
				"value": pm[camelField],
			})
		}
	}

	result := map[string]interface{}{
		"data_type":  dataType,
		"start_date": startDate,
		"end_date":   endDate,
		"days":       len(series),
		"series":     series,
	}
	return okResult(result)
}
