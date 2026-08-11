package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

// ─── Tool: list_data_types ───────────────────────────────────────────────────

func listDataTypesHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	category, _ := req.GetArguments()["category"].(string)
	category = strings.ToLower(strings.TrimSpace(category))

	var matches []interface{}
	for _, t := range DataTypes {
		if category == "" || strings.EqualFold(t.Category, category) {
			matches = append(matches, t)
		}
	}

	if category != "" && len(matches) == 0 {
		return errResult(fmt.Sprintf("Unknown category '%s'. Valid categories: %s", category, strings.Join(Categories(), ", ")))
	}

	result := map[string]interface{}{
		"count":      len(matches),
		"total":      len(DataTypes),
		"categories": Categories(),
		"data_types": matches,
	}
	return okResult(result)
}

// ─── Tool: describe_data_type ────────────────────────────────────────────────

func describeDataTypeHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	dataType, _ := req.GetArguments()["data_type"].(string)
	dataType = strings.TrimSpace(dataType)

	info := FindType(dataType)
	if info == nil {
		return errResult(fmt.Sprintf("Unknown data type '%s'. Use list_data_types to see all 39 valid kebab-case IDs.", dataType))
	}

	// Marshal to map for mutation.
	data, _ := json.Marshal(info)
	var value map[string]interface{}
	json.Unmarshal(data, &value)

	// Add computed filter convenience fields.
	filterPath := info.TimeField.FilterPath(info.FilterName)
	value["time_field_label"] = info.TimeField.Label()
	if filterPath != "" {
		sample := "2026-07-01T00:00:00Z"
		if info.TimeField == TimeFieldDaily || info.TimeField == TimeFieldIntervalCivilStart {
			sample = "2026-07-01"
		}
		value["filter_field"] = filterPath
		value["filter_example"] = fmt.Sprintf("%s >= \"%s\"", filterPath, sample)
	} else {
		value["filter_field"] = nil
		value["filter_example"] = nil
	}

	return okResult(value)
}
