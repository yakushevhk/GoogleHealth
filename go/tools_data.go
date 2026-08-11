package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

// ─── Tool: list_data_points ──────────────────────────────────────────────────

func listDataPointsHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	filter, _ := args["filter"].(string)
	startTime, _ := args["start_time"].(string)
	endTime, _ := args["end_time"].(string)
	raw, _ := args["raw"].(bool)

	pageSize := 0
	if ps, ok := args["page_size"].(float64); ok {
		pageSize = int(ps)
	}
	pageToken, _ := args["page_token"].(string)

	apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints", base, dataType)
	var params []string

	// Build effective filter.
	effectiveFilter := filter
	if effectiveFilter == "" && startTime != "" {
		var until *string
		if endTime != "" {
			until = &endTime
		}
		effectiveFilter = buildFilter(dataType, startTime, until)
	}
	if effectiveFilter != "" {
		params = append(params, "filter="+urlenc(effectiveFilter))
	}
	if pageSize > 0 {
		params = append(params, fmt.Sprintf("pageSize=%d", pageSize))
	}
	if pageToken != "" {
		params = append(params, "pageToken="+urlenc(pageToken))
	}
	if len(params) > 0 {
		apiURL += "?" + strings.Join(params, "&")
	}

	body, err := auth.APIGet(apiURL)
	if err != nil {
		return apiErr(err.Error())
	}

	var v map[string]interface{}
	json.Unmarshal(body, &v)
	addPaginationHint(v)
	if !raw {
		simplifyResponse(v)
	}
	return okResult(v)
}

// ─── Tool: get_data_point ────────────────────────────────────────────────────

func getDataPointHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	dataPointID, _ := args["data_point_id"].(string)
	raw, _ := args["raw"].(bool)

	var apiURL string
	if strings.HasPrefix(dataPointID, "users/") {
		apiURL = fmt.Sprintf("https://health.googleapis.com/v4/%s", dataPointID)
	} else {
		apiURL = fmt.Sprintf("%s/dataTypes/%s/dataPoints/%s", base, dataType, dataPointID)
	}

	body, err := auth.APIGet(apiURL)
	if err != nil {
		return apiErr(err.Error())
	}

	var v map[string]interface{}
	json.Unmarshal(body, &v)
	if !raw {
		simplifyResponse(v)
	}
	return okResult(v)
}

// ─── Tool: reconcile_data_points ─────────────────────────────────────────────

func reconcileDataPointsHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	filter, _ := args["filter"].(string)
	raw, _ := args["raw"].(bool)
	dataSourceFamily, _ := args["data_source_family"].(string)

	pageSize := 0
	if ps, ok := args["page_size"].(float64); ok {
		pageSize = int(ps)
	}
	pageToken, _ := args["page_token"].(string)

	apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints:reconcile", base, dataType)
	var params []string
	if filter != "" {
		params = append(params, "filter="+urlenc(filter))
	}
	if pageSize > 0 {
		params = append(params, fmt.Sprintf("pageSize=%d", pageSize))
	}
	if pageToken != "" {
		params = append(params, "pageToken="+urlenc(pageToken))
	}
	if dataSourceFamily != "" {
		params = append(params, "dataSourceFamily="+urlenc(dataSourceFamily))
	}
	if len(params) > 0 {
		apiURL += "?" + strings.Join(params, "&")
	}

	body, err := auth.APIGet(apiURL)
	if err != nil {
		return apiErr(err.Error())
	}

	var v map[string]interface{}
	json.Unmarshal(body, &v)
	addPaginationHint(v)
	if !raw {
		simplifyResponse(v)
	}
	return okResult(v)
}

// ─── Tool: sync_data_points ──────────────────────────────────────────────────

func syncDataPointsHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	sinceTime, _ := args["since_time"].(string)
	raw, _ := args["raw"].(bool)
	dataSourceFamily, _ := args["data_source_family"].(string)

	var untilTime *string
	if ut, ok := args["until_time"].(string); ok && ut != "" {
		untilTime = &ut
	}
	pageSize := 0
	if ps, ok := args["page_size"].(float64); ok {
		pageSize = int(ps)
	}
	pageToken, _ := args["page_token"].(string)

	filter := buildFilter(dataType, sinceTime, untilTime)

	// Delegate to reconcile.
	apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints:reconcile", base, dataType)
	var params []string
	params = append(params, "filter="+urlenc(filter))
	if pageSize > 0 {
		params = append(params, fmt.Sprintf("pageSize=%d", pageSize))
	}
	if pageToken != "" {
		params = append(params, "pageToken="+urlenc(pageToken))
	}
	if dataSourceFamily != "" {
		params = append(params, "dataSourceFamily="+urlenc(dataSourceFamily))
	}
	apiURL += "?" + strings.Join(params, "&")

	body, err := auth.APIGet(apiURL)
	if err != nil {
		return apiErr(err.Error())
	}

	var v map[string]interface{}
	json.Unmarshal(body, &v)
	addPaginationHint(v)
	if !raw {
		simplifyResponse(v)
	}
	return okResult(v)
}

// ─── Tool: rollup_data_points ────────────────────────────────────────────────

func rollUpDataPointsHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	startTime, _ := args["start_time"].(string)
	endTime, _ := args["end_time"].(string)
	windowSize, _ := args["window_size"].(string)
	raw, _ := args["raw"].(bool)
	dataSourceFamily, _ := args["data_source_family"].(string)

	pageSize := 0
	if ps, ok := args["page_size"].(float64); ok {
		pageSize = int(ps)
	}
	pageToken, _ := args["page_token"].(string)

	apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints:rollUp", base, dataType)
	body := map[string]interface{}{
		"range": map[string]interface{}{
			"startTime": startTime,
			"endTime":   endTime,
		},
		"windowSize": windowSize,
	}
	if pageSize > 0 {
		body["pageSize"] = pageSize
	}
	if pageToken != "" {
		body["pageToken"] = pageToken
	}
	if dataSourceFamily != "" {
		body["dataSourceFamily"] = dataSourceFamily
	}

	resp, err := auth.APIPost(apiURL, body)
	if err != nil {
		return apiErr(err.Error())
	}

	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	addPaginationHint(v)
	if !raw {
		simplifyResponse(v)
	}
	return okResult(v)
}

// ─── Tool: daily_rollup_data_points ──────────────────────────────────────────

func dailyRollUpDataPointsHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	startDate, _ := args["start_date"].(string)
	endDate, _ := args["end_date"].(string)
	raw, _ := args["raw"].(bool)
	dataSourceFamily, _ := args["data_source_family"].(string)

	windowSizeDays := 0
	if w, ok := args["window_size_days"].(float64); ok {
		windowSizeDays = int(w)
	}
	pageSize := 0
	if ps, ok := args["page_size"].(float64); ok {
		pageSize = int(ps)
	}
	pageToken, _ := args["page_token"].(string)

	start, err := parseCivilDate(startDate)
	if err != nil {
		return errResult(err.Error())
	}
	end, err := parseCivilDate(endDate)
	if err != nil {
		return errResult(err.Error())
	}

	apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints:dailyRollUp", base, dataType)
	body := map[string]interface{}{
		"range": map[string]interface{}{
			"start": map[string]interface{}{"date": dateObj(start)},
			"end":   map[string]interface{}{"date": dateObj(end)},
		},
	}
	if windowSizeDays > 0 {
		body["windowSizeDays"] = windowSizeDays
	}
	if pageSize > 0 {
		body["pageSize"] = pageSize
	}
	if pageToken != "" {
		body["pageToken"] = pageToken
	}
	if dataSourceFamily != "" {
		body["dataSourceFamily"] = dataSourceFamily
	}

	resp, err2 := auth.APIPost(apiURL, body)
	if err2 != nil {
		return apiErr(err2.Error())
	}

	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	addPaginationHint(v)
	if !raw {
		simplifyResponse(v)
	}
	return okResult(v)
}
