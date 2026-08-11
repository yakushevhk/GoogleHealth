package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

// ─── Tool: delete_data_point ─────────────────────────────────────────────────

func deleteDataPointHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	dataPointID, _ := args["data_point_id"].(string)

	var name string
	if strings.HasPrefix(dataPointID, "users/") {
		name = dataPointID
	} else {
		name = fmt.Sprintf("users/me/dataTypes/%s/dataPoints/%s", dataType, dataPointID)
	}

	apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints:batchDelete", base, dataType)
	body := map[string]interface{}{"names": []string{name}}
	resp, err := auth.APIPost(apiURL, body)
	if err != nil {
		return apiErr(err.Error())
	}
	auth.Cache.Clear()
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: batch_delete_data_points ──────────────────────────────────────────

func batchDeleteDataPointsHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	namesRaw, _ := args["names"].([]interface{})

	var names []string
	for _, n := range namesRaw {
		if s, ok := n.(string); ok {
			names = append(names, s)
		}
	}

	apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints:batchDelete", base, dataType)
	body := map[string]interface{}{"names": names}
	resp, err := auth.APIPost(apiURL, body)
	if err != nil {
		return apiErr(err.Error())
	}
	auth.Cache.Clear()
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: delete_by_filter ──────────────────────────────────────────────────

func deleteByFilterHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataType, _ := args["data_type"].(string)
	filter, _ := args["filter"].(string)

	maxCount := 100
	if mc, ok := args["max_count"].(float64); ok && mc > 0 {
		maxCount = int(mc)
	}
	if maxCount > 10000 {
		maxCount = 10000
	}
	if maxCount < 1 {
		maxCount = 1
	}

	// Phase 1: list data points matching the filter.
	var names []string
	var pageToken string

	for {
		pageSize := 100
		if dataType == "sleep" || dataType == "exercise" {
			pageSize = 25
		}
		apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints?filter=%s&pageSize=%d", base, dataType, urlenc(filter), pageSize)
		if pageToken != "" {
			apiURL += "&pageToken=" + urlenc(pageToken)
		}

		resp, err := auth.APIGet(apiURL)
		if err != nil {
			return apiErr(err.Error())
		}
		var v map[string]interface{}
		json.Unmarshal(resp, &v)

		if pts, ok := v["dataPoints"].([]interface{}); ok {
			for _, p := range pts {
				pm, ok := p.(map[string]interface{})
				if !ok {
					continue
				}
				if name, ok := pm["name"].(string); ok {
					names = append(names, name)
					if len(names) >= maxCount {
						break
					}
				}
			}
		}

		if len(names) >= maxCount {
			break
		}
		if token, ok := v["nextPageToken"].(string); ok && token != "" {
			pageToken = token
		} else {
			break
		}
	}

	if len(names) == 0 {
		return okResult(map[string]interface{}{
			"deleted_count": 0,
			"message":       "No data points matched the filter",
		})
	}

	// Phase 2: batch delete in chunks.
	totalDeleted := 0
	for i := 0; i < len(names); i += 10000 {
		end := i + 10000
		if end > len(names) {
			end = len(names)
		}
		chunk := names[i:end]

		apiURL := fmt.Sprintf("%s/dataTypes/%s/dataPoints:batchDelete", base, dataType)
		body := map[string]interface{}{"names": chunk}
		_, err := auth.APIPost(apiURL, body)
		if err != nil {
			return okResult(map[string]interface{}{
				"deleted_count": totalDeleted,
				"error":         fmt.Sprintf("Batch delete failed after %d deletions: %v", totalDeleted, err),
			})
		}
		totalDeleted += len(chunk)
	}

	auth.Cache.Clear()
	return okResult(map[string]interface{}{
		"deleted_count": totalDeleted,
		"data_type":     dataType,
		"filter":        filter,
	})
}
