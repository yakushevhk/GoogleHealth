package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
)

// ─── Tool: export_exercise_tcx ───────────────────────────────────────────────

func exportExerciseTcxHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	args := req.GetArguments()
	dataPointID, _ := args["data_point_id"].(string)
	partialData, _ := args["partial_data"].(bool)

	params := []string{"alt=media"}
	if partialData {
		params = append(params, "partialData=true")
	}
	apiURL := fmt.Sprintf("%s/dataTypes/exercise/dataPoints/%s:exportExerciseTcx?%s",
		base, dataPointID, strings.Join(params, "&"))

	resp, err := auth.APIGet(apiURL)
	if err != nil {
		return apiErr(err.Error())
	}
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: get_profile ───────────────────────────────────────────────────────

func getProfileHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	resp, err := auth.APIGet(fmt.Sprintf("%s/profile", base))
	if err != nil {
		return apiErr(err.Error())
	}
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: update_profile ────────────────────────────────────────────────────

func updateProfileHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	bodyArg := req.GetArguments()["body"]
	resp, err := auth.APIPatch(fmt.Sprintf("%s/profile", base), bodyArg)
	if err != nil {
		return apiErr(err.Error())
	}
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: get_settings ──────────────────────────────────────────────────────

func getSettingsHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	resp, err := auth.APIGet(fmt.Sprintf("%s/settings", base))
	if err != nil {
		return apiErr(err.Error())
	}
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: update_settings ───────────────────────────────────────────────────

func updateSettingsHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	bodyArg := req.GetArguments()["body"]
	resp, err := auth.APIPatch(fmt.Sprintf("%s/settings", base), bodyArg)
	if err != nil {
		return apiErr(err.Error())
	}
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: get_identity ──────────────────────────────────────────────────────

func getIdentityHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	resp, err := auth.APIGet(fmt.Sprintf("%s/identity", base))
	if err != nil {
		return apiErr(err.Error())
	}
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: get_irn_profile ───────────────────────────────────────────────────

func getIrnProfileHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	resp, err := auth.APIGet(fmt.Sprintf("%s/irnProfile", base))
	if err != nil {
		return apiErr(err.Error())
	}
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: list_paired_devices ───────────────────────────────────────────────

func listPairedDevicesHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	resp, err := auth.APIGet(fmt.Sprintf("%s/pairedDevices", base))
	if err != nil {
		return apiErr(err.Error())
	}
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}

// ─── Tool: get_paired_device ─────────────────────────────────────────────────

func getPairedDeviceHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	auth := ctx.Value(authKey{}).(*AuthState)
	deviceID, _ := req.GetArguments()["device_id"].(string)
	resp, err := auth.APIGet(fmt.Sprintf("%s/pairedDevices/%s", base, deviceID))
	if err != nil {
		return apiErr(err.Error())
	}
	var v map[string]interface{}
	json.Unmarshal(resp, &v)
	return okResult(v)
}
