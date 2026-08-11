package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
)

// ─── Tool: create_data_point ─────────────────────────────────────────────────

func createDataPointHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	bodyArg := args["body"]
	dryRun, _ := args["dry_run"].(bool)

	apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints", base, dataType)
	if dryRun {
		return okResult(map[string]interface{}{
			"dry_run": true,
			"method":  "POST",
			"url":     apiURL,
			"body":    bodyArg,
		})
	}

	resp, err := auth.APIPost(apiURL, bodyArg)
	if err != nil {
		return apiErr(err.Error())
	}
	auth.Cache.Clear()
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: add_weight_sample ─────────────────────────────────────────────────

func addWeightSampleHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	weightKg, _ := args["weight_kg"].(float64)
	timestamp, _ := args["timestamp"].(string)
	utcOffset, _ := args["utc_offset"].(string)
	dryRun, _ := args["dry_run"].(bool)

	if weightKg <= 0 || weightKg > 500 {
		return errResult("weight_kg must be between 0 and 500 kg")
	}
	if timestamp == "" {
		timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	if utcOffset == "" {
		utcOffset = "0s"
	}
	grams := int64(math.Round(weightKg * 1000))

	body := map[string]interface{}{
		"weight": map[string]interface{}{
			"sampleTime": map[string]interface{}{
				"physicalTime": timestamp,
				"utcOffset":    utcOffset,
			},
			"weightGrams": grams,
		},
	}

	apiURL := fmt.Sprintf("%s/dataTypes/weight/dataPoints", base)
	if dryRun {
		return okResult(map[string]interface{}{"dry_run": true, "method": "POST", "url": apiURL, "body": body})
	}
	resp, err := auth.APIPost(apiURL, body)
	if err != nil {
		return apiErr(err.Error())
	}
	auth.Cache.Clear()
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: add_hydration_log ─────────────────────────────────────────────────

func addHydrationLogHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	startTime, _ := args["start_time"].(string)
	endTime, _ := args["end_time"].(string)
	utcOffset, _ := args["utc_offset"].(string)
	dryRun, _ := args["dry_run"].(bool)

	if startTime == "" {
		startTime = time.Now().UTC().Format(time.RFC3339)
	}
	if endTime == "" {
		endTime = startTime
	}
	if startTime == endTime {
		if t, err := time.Parse(time.RFC3339, startTime); err == nil {
			endTime = t.Add(60 * time.Second).Format(time.RFC3339)
		}
	}
	if utcOffset == "" {
		utcOffset = "0s"
	}

	body := map[string]interface{}{
		"hydrationLog": map[string]interface{}{
			"interval": map[string]interface{}{
				"startTime":      startTime,
				"startUtcOffset": utcOffset,
				"endTime":        endTime,
				"endUtcOffset":   utcOffset,
			},
		},
	}

	apiURL := fmt.Sprintf("%s/dataTypes/hydration-log/dataPoints", base)
	if dryRun {
		return okResult(map[string]interface{}{"dry_run": true, "method": "POST", "url": apiURL, "body": body})
	}
	resp, err := auth.APIPost(apiURL, body)
	if err != nil {
		return apiErr(err.Error())
	}
	auth.Cache.Clear()
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: add_sleep_session ─────────────────────────────────────────────────

func addSleepSessionHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	startTime, _ := args["start_time"].(string)
	endTime, _ := args["end_time"].(string)
	utcOffset, _ := args["utc_offset"].(string)
	dryRun, _ := args["dry_run"].(bool)

	startDt, err := time.Parse(time.RFC3339, startTime)
	if err != nil {
		return errResult(fmt.Sprintf("Invalid start_time RFC3339: %v", err))
	}
	endDt, err := time.Parse(time.RFC3339, endTime)
	if err != nil {
		return errResult(fmt.Sprintf("Invalid end_time RFC3339: %v", err))
	}
	if !startDt.Before(endDt) {
		return errResult("end_time must be after start_time")
	}
	if utcOffset == "" {
		utcOffset = "0s"
	}

	body := map[string]interface{}{
		"sleep": map[string]interface{}{
			"interval": map[string]interface{}{
				"startTime":      startTime,
				"startUtcOffset": utcOffset,
				"endTime":        endTime,
				"endUtcOffset":   utcOffset,
			},
		},
	}

	apiURL := fmt.Sprintf("%s/dataTypes/sleep/dataPoints", base)
	if dryRun {
		return okResult(map[string]interface{}{"dry_run": true, "method": "POST", "url": apiURL, "body": body})
	}
	resp, err2 := auth.APIPost(apiURL, body)
	if err2 != nil {
		return apiErr(err2.Error())
	}
	auth.Cache.Clear()
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: add_exercise_session ──────────────────────────────────────────────

func addExerciseSessionHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	exerciseType, _ := args["exercise_type"].(string)
	startTime, _ := args["start_time"].(string)
	endTime, _ := args["end_time"].(string)
	utcOffset, _ := args["utc_offset"].(string)
	dryRun, _ := args["dry_run"].(bool)

	startDt, err := time.Parse(time.RFC3339, startTime)
	if err != nil {
		return errResult(fmt.Sprintf("Invalid start_time RFC3339: %v", err))
	}
	endDt, err := time.Parse(time.RFC3339, endTime)
	if err != nil {
		return errResult(fmt.Sprintf("Invalid end_time RFC3339: %v", err))
	}
	if !startDt.Before(endDt) {
		return errResult("end_time must be after start_time")
	}
	if utcOffset == "" {
		utcOffset = "0s"
	}

	body := map[string]interface{}{
		"exercise": map[string]interface{}{
			"exerciseType": strings.ToUpper(exerciseType),
			"interval": map[string]interface{}{
				"startTime":      startTime,
				"startUtcOffset": utcOffset,
				"endTime":        endTime,
				"endUtcOffset":   utcOffset,
			},
		},
	}

	apiURL := fmt.Sprintf("%s/dataTypes/exercise/dataPoints", base)
	if dryRun {
		return okResult(map[string]interface{}{"dry_run": true, "method": "POST", "url": apiURL, "body": body})
	}
	resp, err2 := auth.APIPost(apiURL, body)
	if err2 != nil {
		return apiErr(err2.Error())
	}
	auth.Cache.Clear()
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: add_nutrition_log ─────────────────────────────────────────────────

func addNutritionLogHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	mealType, _ := args["meal_type"].(string)
	startTime, _ := args["start_time"].(string)
	endTime, _ := args["end_time"].(string)
	utcOffset, _ := args["utc_offset"].(string)
	dryRun, _ := args["dry_run"].(bool)

	validMeals := map[string]bool{"BREAKFAST": true, "LUNCH": true, "DINNER": true, "SNACK": true}
	if !validMeals[strings.ToUpper(mealType)] {
		return errResult("meal_type must be one of: BREAKFAST, LUNCH, DINNER, SNACK")
	}
	if startTime == "" {
		startTime = time.Now().UTC().Format(time.RFC3339)
	}
	if endTime == "" {
		endTime = startTime
	}
	if startTime == endTime {
		if t, err := time.Parse(time.RFC3339, startTime); err == nil {
			endTime = t.Add(30 * time.Minute).Format(time.RFC3339)
		}
	}
	if utcOffset == "" {
		utcOffset = "0s"
	}

	body := map[string]interface{}{
		"nutritionLog": map[string]interface{}{
			"mealType": strings.ToUpper(mealType),
			"interval": map[string]interface{}{
				"startTime":      startTime,
				"startUtcOffset": utcOffset,
				"endTime":        endTime,
				"endUtcOffset":   utcOffset,
			},
		},
	}

	apiURL := fmt.Sprintf("%s/dataTypes/nutrition-log/dataPoints", base)
	if dryRun {
		return okResult(map[string]interface{}{"dry_run": true, "method": "POST", "url": apiURL, "body": body})
	}
	resp, err := auth.APIPost(apiURL, body)
	if err != nil {
		return apiErr(err.Error())
	}
	auth.Cache.Clear()
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: patch_data_point ──────────────────────────────────────────────────

func patchDataPointHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	dataPointID, _ := args["data_point_id"].(string)
	bodyArg := args["body"]

	var apiURL string
	if strings.HasPrefix(dataPointID, "users/") {
		apiURL = fmt.Sprintf("https://health.googleapis.com/v4/%s", dataPointID)
	} else {
		apiURL = fmt.Sprintf("%s/dataTypes/%s/dataPoints/%s", base, dataType, dataPointID)
	}

	resp, err := auth.APIPatch(apiURL, bodyArg)
	if err != nil {
		return apiErr(err.Error())
	}
	auth.Cache.Clear()
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}
