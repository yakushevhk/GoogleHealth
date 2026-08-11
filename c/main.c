/* Google Health MCP Server — C implementation
 * MCP JSON-RPC 2.0 over stdio. 39 data types, 15 core tools.
 * Dependencies: cJSON (vendored), libcurl.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "cJSON.h"
#include "auth.h"

/* ─── Data Type Registry (39 types) ───────────────────────────────────────── */

typedef struct {
    const char *id;
    const char *filter_name;
    const char *category;
    int listable, rollup, daily_rollup, writable;
    const char *time_field;
    int page_cap, rollup_range_days;
    const char *description;
} DataType;

#define DT(id, cat, tf, list, roll, dr, writ, cap, range, desc) \
    {id, id, cat, list, roll, dr, writ, tf, cap, range, desc}

/* filter_name computed at runtime (id with '-' → '_') */
static const DataType DATA_TYPES[] = {
    DT("steps","activity","interval_start",1,1,1,0,10000,90,"Step counts over time intervals."),
    DT("active-energy-burned","activity","interval_start",1,1,1,0,10000,90,"Active calories burned."),
    DT("distance","activity","interval_start",1,1,1,0,10000,90,"Distance (millimeters)."),
    DT("active-minutes","activity","interval_start",1,1,1,0,10000,14,"Active minutes."),
    DT("active-zone-minutes","activity","interval_start",1,1,1,0,10000,90,"Zone minutes."),
    DT("activity-level","activity","interval_start",1,1,1,0,10000,90,"Activity levels."),
    DT("altitude","activity","interval_start",1,1,1,0,10000,90,"Altitude (meters)."),
    DT("sedentary-period","activity","interval_start",1,1,1,0,10000,90,"Sedentary periods."),
    DT("swim-lengths-data","activity","interval_start",1,1,1,0,10000,90,"Swim lengths."),
    DT("time-in-heart-rate-zone","activity","interval_start",1,1,1,0,10000,90,"Time in HR zones."),
    DT("heart-rate","cardiac","sample_physical",1,1,1,0,10000,14,"Heart rate (BPM)."),
    DT("weight","body","sample_physical",1,1,1,1,10000,90,"Weight (kg)."),
    DT("height","body","sample_physical",1,0,0,0,10000,90,"Height (meters)."),
    DT("body-fat","body","sample_physical",1,1,1,0,10000,90,"Body fat %."),
    DT("blood-glucose","nutrition","sample_physical",1,1,1,0,10000,90,"Blood glucose."),
    DT("core-body-temperature","temperature","sample_physical",1,1,1,0,10000,90,"Core temp (C)."),
    DT("heart-rate-variability","cardiac","sample_physical",1,0,0,0,10000,90,"HRV (RMSSD ms)."),
    DT("oxygen-saturation","oxygen","sample_physical",1,0,0,0,10000,90,"SpO2 %."),
    DT("respiratory-rate-sleep-summary","respiratory","sample_physical",1,0,0,0,10000,90,"Resp rate sleep."),
    DT("vo2-max","activity","sample_physical",1,0,0,0,10000,90,"VO2 max."),
    DT("run-vo2-max","activity","sample_physical",1,1,1,0,10000,90,"Run VO2 max."),
    DT("daily-resting-heart-rate","cardiac","daily",1,0,0,0,10000,90,"Daily resting HR."),
    DT("daily-heart-rate-variability","cardiac","daily",1,0,0,0,10000,90,"Daily HRV."),
    DT("daily-heart-rate-zones","cardiac","daily",1,0,0,0,10000,90,"Daily HR zones."),
    DT("daily-oxygen-saturation","oxygen","daily",1,0,0,0,10000,90,"Daily SpO2."),
    DT("daily-respiratory-rate","respiratory","daily",1,0,0,0,10000,90,"Daily resp rate."),
    DT("daily-sleep-temperature-derivations","sleep","daily",1,0,0,0,10000,90,"Sleep temp."),
    DT("daily-vo2-max","activity","daily",1,0,0,0,10000,90,"Daily VO2 max."),
    DT("sleep","sleep","interval_end",1,0,0,1,25,90,"Sleep sessions."),
    DT("exercise","activity","interval_civil_start",1,0,0,1,25,90,"Exercise sessions."),
    DT("hydration-log","nutrition","interval_civil_start",1,1,1,1,10000,90,"Hydration events."),
    DT("nutrition-log","nutrition","interval_civil_start",1,1,1,1,10000,90,"Meal events."),
    DT("irregular-rhythm-notification","clinical","interval_civil_start",1,0,0,0,10000,90,"AFib notifications."),
    DT("electrocardiogram","clinical","interval_start",1,0,0,0,10000,90,"ECG recordings."),
    DT("food","nutrition","none",1,0,0,0,10000,90,"Food catalog."),
    DT("food-measurement-unit","nutrition","none",1,0,0,0,10000,90,"Food units."),
    DT("floors","activity","interval_start",0,1,1,0,10000,90,"Floors climbed."),
    DT("total-calories","nutrition","interval_start",0,1,1,0,10000,14,"Total calories."),
    DT("calories-in-heart-rate-zone","cardiac","interval_start",0,1,1,0,10000,14,"Calories per zone."),
};
#define NUM_TYPES 39

/* ─── Tool definitions ─────────────────────────────────────────────────────── */

typedef struct {
    const char *name;
    const char *description;
} ToolDef;

static const ToolDef TOOLS[] = {
    {"list_data_types", "List all 39 supported Google Health API v4 data types."},
    {"describe_data_type", "Get detailed info about a data type."},
    {"list_data_points", "List data points with AIP-160 filters."},
    {"get_data_point", "Get a single data point by ID."},
    {"get_profile", "Get user profile."},
    {"get_settings", "Get user settings."},
    {"get_identity", "Get user identity."},
    {"list_paired_devices", "List paired devices."},
    {"get_irn_profile", "Get IRN profile."},
    {"clear_cache", "Clear response cache."},
    {"today", "Full health summary for today."},
    {"yesterday", "Full health summary for yesterday."},
    {"summary", "Full health summary for a date."},
    {"add_weight_sample", "Add weight in kg."},
    {"export_exercise_tcx", "Export exercise as TCX."},
};
#define NUM_TOOLS 15

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

static void filter_name(const char *id, char *out, size_t out_size) {
    size_t i;
    for (i = 0; id[i] && i < out_size - 1; i++) {
        out[i] = (id[i] == '-') ? '_' : id[i];
    }
    out[i] = '\0';
}

static void url_encode(const char *src, char *dst, size_t dst_size) {
    size_t j = 0;
    for (size_t i = 0; src[i] && j < dst_size - 4; i++) {
        char c = src[i];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
            c == '-' || c == '_' || c == '.' || c == '~') {
            dst[j++] = c;
        } else {
            snprintf(dst + j, 4, "%%%02X", (unsigned char)c);
            j += 3;
        }
    }
    dst[j] = '\0';
}

/* ─── Tool handlers ────────────────────────────────────────────────────────── */

static char *handle_list_data_types(cJSON *args) {
    (void)args;
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "count", NUM_TYPES);
    cJSON_AddNumberToObject(root, "total", NUM_TYPES);

    cJSON *arr = cJSON_AddArrayToObject(root, "data_types");
    for (int i = 0; i < NUM_TYPES; i++) {
        cJSON *t = cJSON_CreateObject();
        char fn[128];
        filter_name(DATA_TYPES[i].id, fn, sizeof(fn));
        cJSON_AddStringToObject(t, "id", DATA_TYPES[i].id);
        cJSON_AddStringToObject(t, "filter_name", fn);
        cJSON_AddStringToObject(t, "category", DATA_TYPES[i].category);
        cJSON_AddBoolToObject(t, "listable", DATA_TYPES[i].listable);
        cJSON_AddBoolToObject(t, "rollup", DATA_TYPES[i].rollup);
        cJSON_AddBoolToObject(t, "daily_rollup", DATA_TYPES[i].daily_rollup);
        cJSON_AddBoolToObject(t, "writable", DATA_TYPES[i].writable);
        cJSON_AddStringToObject(t, "time_field", DATA_TYPES[i].time_field);
        cJSON_AddNumberToObject(t, "page_cap", DATA_TYPES[i].page_cap);
        cJSON_AddNumberToObject(t, "rollup_range_days", DATA_TYPES[i].rollup_range_days);
        cJSON_AddStringToObject(t, "description", DATA_TYPES[i].description);
        cJSON_AddItemToArray(arr, t);
    }

    char *out = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return out;
}

static char *handle_describe_data_type(cJSON *args) {
    const char *dt_id = cJSON_GetStringValue(cJSON_GetObjectItem(args, "data_type"));
    if (!dt_id) return strdup("{\"error\":\"Missing data_type\"}");

    for (int i = 0; i < NUM_TYPES; i++) {
        if (strcmp(DATA_TYPES[i].id, dt_id) == 0) {
            cJSON *t = cJSON_CreateObject();
            char fn[128];
            filter_name(DATA_TYPES[i].id, fn, sizeof(fn));
            cJSON_AddStringToObject(t, "id", DATA_TYPES[i].id);
            cJSON_AddStringToObject(t, "filter_name", fn);
            cJSON_AddStringToObject(t, "category", DATA_TYPES[i].category);
            cJSON_AddBoolToObject(t, "listable", DATA_TYPES[i].listable);
            cJSON_AddBoolToObject(t, "rollup", DATA_TYPES[i].rollup);
            cJSON_AddBoolToObject(t, "daily_rollup", DATA_TYPES[i].daily_rollup);
            cJSON_AddBoolToObject(t, "writable", DATA_TYPES[i].writable);
            cJSON_AddStringToObject(t, "time_field", DATA_TYPES[i].time_field);
            cJSON_AddNumberToObject(t, "page_cap", DATA_TYPES[i].page_cap);
            cJSON_AddNumberToObject(t, "rollup_range_days", DATA_TYPES[i].rollup_range_days);
            cJSON_AddStringToObject(t, "description", DATA_TYPES[i].description);

            /* Add filter_field */
            const char *suffix = NULL;
            if (strcmp(DATA_TYPES[i].time_field, "interval_start") == 0) suffix = "interval.start_time";
            else if (strcmp(DATA_TYPES[i].time_field, "interval_civil_start") == 0) suffix = "interval.civil_start_time";
            else if (strcmp(DATA_TYPES[i].time_field, "interval_end") == 0) suffix = "interval.end_time";
            else if (strcmp(DATA_TYPES[i].time_field, "sample_physical") == 0) suffix = "sample_time.physical_time";
            else if (strcmp(DATA_TYPES[i].time_field, "daily") == 0) suffix = "date";

            if (suffix) {
                char ff[256];
                snprintf(ff, sizeof(ff), "%s.%s", fn, suffix);
                cJSON_AddStringToObject(t, "filter_field", ff);
            }

            char *out = cJSON_PrintUnformatted(t);
            cJSON_Delete(t);
            return out;
        }
    }
    return strdup("{\"error\":\"Unknown data type. Use list_data_types.\"}");
}

static char *handle_api_get(AuthState *auth, const char *path) {
    char url[512];
    snprintf(url, sizeof(url), "%s/%s", BASE_URL, path);
    char *resp = auth_api_get(auth, url);
    if (!resp) return strdup("{\"error\":\"API request failed\"}");
    return resp;
}

static char *handle_list_data_points(AuthState *auth, cJSON *args) {
    const char *dt = cJSON_GetStringValue(cJSON_GetObjectItem(args, "data_type"));
    if (!dt) return strdup("{\"error\":\"Missing data_type\"}");

    char url[1024];
    snprintf(url, sizeof(url), "%s/dataTypes/%s/dataPoints", BASE_URL, dt);

    const char *filter = cJSON_GetStringValue(cJSON_GetObjectItem(args, "filter"));
    if (filter) {
        char encoded[2048];
        url_encode(filter, encoded, sizeof(encoded));
        char tmp[3072];
        snprintf(tmp, sizeof(tmp), "%s?filter=%s", url, encoded);
        strcpy(url, tmp);
    }

    char *resp = auth_api_get(auth, url);
    if (!resp) return strdup("{\"error\":\"API request failed\"}");
    return resp;
}

static char *handle_add_weight_sample(AuthState *auth, cJSON *args) {
    cJSON *kg_item = cJSON_GetObjectItem(args, "weight_kg");
    if (!kg_item || !cJSON_IsNumber(kg_item)) return strdup("{\"error\":\"Missing weight_kg\"}");
    double kg = kg_item->valuedouble;
    if (kg <= 0 || kg > 500) return strdup("{\"error\":\"weight_kg must be between 0 and 500 kg\"}");

    int grams = (int)(kg * 1000 + 0.5);
    char ts[64];
    time_t now = time(NULL);
    struct tm *tm_utc = gmtime(&now);
    strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", tm_utc);

    char body[512];
    snprintf(body, sizeof(body),
        "{\"weight\":{\"sampleTime\":{\"physicalTime\":\"%s\",\"utcOffset\":\"0s\"},\"weightGrams\":%d}}",
        ts, grams);

    char url[256];
    snprintf(url, sizeof(url), "%s/dataTypes/weight/dataPoints", BASE_URL);
    char *resp = auth_api_post(auth, url, body);
    if (!resp) return strdup("{\"error\":\"API request failed\"}");
    return resp;
}

/* ─── MCP JSON-RPC dispatch ────────────────────────────────────────────────── */

static char *dispatch_tool(AuthState *auth, const char *name, cJSON *args) {
    if (strcmp(name, "list_data_types") == 0) return handle_list_data_types(args);
    if (strcmp(name, "describe_data_type") == 0) return handle_describe_data_type(args);
    if (strcmp(name, "list_data_points") == 0) return handle_list_data_points(auth, args);
    if (strcmp(name, "get_data_point") == 0) {
        const char *dt = cJSON_GetStringValue(cJSON_GetObjectItem(args, "data_type"));
        const char *id = cJSON_GetStringValue(cJSON_GetObjectItem(args, "data_point_id"));
        char path[512];
        snprintf(path, sizeof(path), "dataTypes/%s/dataPoints/%s", dt ? dt : "", id ? id : "");
        return handle_api_get(auth, path);
    }
    if (strcmp(name, "get_profile") == 0) return handle_api_get(auth, "profile");
    if (strcmp(name, "get_settings") == 0) return handle_api_get(auth, "settings");
    if (strcmp(name, "get_identity") == 0) return handle_api_get(auth, "identity");
    if (strcmp(name, "list_paired_devices") == 0) return handle_api_get(auth, "pairedDevices");
    if (strcmp(name, "get_irn_profile") == 0) return handle_api_get(auth, "irnProfile");
    if (strcmp(name, "clear_cache") == 0) return strdup("{\"success\":true,\"message\":\"Cache cleared\"}");
    if (strcmp(name, "add_weight_sample") == 0) return handle_add_weight_sample(auth, args);
    if (strcmp(name, "export_exercise_tcx") == 0) {
        const char *id = cJSON_GetStringValue(cJSON_GetObjectItem(args, "data_point_id"));
        char path[512];
        snprintf(path, sizeof(path), "dataTypes/exercise/dataPoints/%s:exportExerciseTcx?alt=media", id ? id : "");
        return handle_api_get(auth, path);
    }
    if (strcmp(name, "today") == 0 || strcmp(name, "yesterday") == 0 || strcmp(name, "summary") == 0) {
        return strdup("{\"info\":\"Daily summary requires multiple parallel API calls. Use Rust/Go/Python for full implementation.\"}");
    }

    char err[256];
    snprintf(err, sizeof(err), "{\"error\":\"Unknown tool: %s\"}", name);
    return strdup(err);
}

/* ─── MCP protocol ─────────────────────────────────────────────────────────── */

static void send_response(const char *id_str, const char *result_json) {
    printf("{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":%s}\n", id_str, result_json);
    fflush(stdout);
}

static void handle_request(AuthState *auth, const char *line) {
    cJSON *req = cJSON_Parse(line);
    if (!req) return;

    cJSON *id = cJSON_GetObjectItem(req, "id");
    cJSON *method = cJSON_GetObjectItem(req, "method");
    cJSON *params = cJSON_GetObjectItem(req, "params");

    if (!method || !cJSON_IsString(method)) { cJSON_Delete(req); return; }
    const char *m = method->valuestring;

    char id_str[32] = "null";
    if (id && cJSON_IsNumber(id)) snprintf(id_str, sizeof(id_str), "%d", id->valueint);

    if (strcmp(m, "initialize") == 0) {
        send_response(id_str, "{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{\"tools\":{},\"resources\":{},\"prompts\":{}},\"serverInfo\":{\"name\":\"google-health-mcp\",\"version\":\"0.2.0\"}}");
    } else if (strcmp(m, "notifications/initialized") == 0) {
        /* no response for notifications */
    } else if (strcmp(m, "tools/list") == 0) {
        cJSON *root = cJSON_CreateObject();
        cJSON *arr = cJSON_AddArrayToObject(root, "tools");
        for (int i = 0; i < NUM_TOOLS; i++) {
            cJSON *t = cJSON_CreateObject();
            cJSON_AddStringToObject(t, "name", TOOLS[i].name);
            cJSON_AddStringToObject(t, "description", TOOLS[i].description);
            cJSON *schema = cJSON_CreateObject();
            cJSON_AddStringToObject(schema, "type", "object");
            cJSON_AddItemToObject(schema, "properties", cJSON_CreateObject());
            cJSON_AddItemToObject(t, "inputSchema", schema);
            cJSON_AddItemToArray(arr, t);
        }
        char *out = cJSON_PrintUnformatted(root);
        send_response(id_str, out);
        free(out);
        cJSON_Delete(root);
    } else if (strcmp(m, "tools/call") == 0) {
        const char *tool_name = cJSON_GetStringValue(cJSON_GetObjectItem(params, "name"));
        cJSON *args = cJSON_GetObjectItem(params, "arguments");
        if (!args) args = cJSON_CreateObject();

        char *result = dispatch_tool(auth, tool_name ? tool_name : "", args);

        /* Wrap in CallToolResult format */
        cJSON *root = cJSON_CreateObject();
        cJSON *content = cJSON_AddArrayToObject(root, "content");
        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "type", "text");
        cJSON_AddStringToObject(item, "text", result);
        cJSON_AddItemToArray(content, item);

        char *out = cJSON_PrintUnformatted(root);
        send_response(id_str, out);
        free(out);
        free(result);
        cJSON_Delete(root);
    } else {
        printf("{\"jsonrpc\":\"2.0\",\"id\":%s,\"error\":{\"code\":-32601,\"message\":\"Method not found\"}}\n", id_str);
        fflush(stdout);
    }

    cJSON_Delete(req);
}

/* ─── Main ─────────────────────────────────────────────────────────────────── */

int main(void) {
    AuthState *auth = auth_init();

    fprintf(stderr, "google-health-mcp (C) — stdio mode, %d types, %d tools\n", NUM_TYPES, NUM_TOOLS);

    char *line = NULL;
    size_t len = 0;
    while (getline(&line, &len, stdin) != -1) {
        /* Strip newline */
        size_t l = strlen(line);
        if (l > 0 && line[l-1] == '\n') line[l-1] = '\0';
        if (strlen(line) == 0) continue;

        handle_request(auth, line);
    }

    free(line);
    auth_free(auth);
    return 0;
}
