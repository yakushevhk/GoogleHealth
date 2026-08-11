#include "auth.h"
#include "cJSON.h"
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* ─── Response buffer for curl ─────────────────────────────────────────────── */

typedef struct {
    char *data;
    size_t size;
} ResponseBuf;

static size_t write_cb(void *ptr, size_t size, size_t nmemb, void *userdata) {
    ResponseBuf *buf = (ResponseBuf *)userdata;
    size_t total = size * nmemb;
    char *tmp = realloc(buf->data, buf->size + total + 1);
    if (!tmp) return 0;
    buf->data = tmp;
    memcpy(buf->data + buf->size, ptr, total);
    buf->size += total;
    buf->data[buf->size] = '\0';
    return total;
}

/* ─── Init / Free ──────────────────────────────────────────────────────────── */

AuthState *auth_init(void) {
    const char *cid = getenv("GOOGLE_CLIENT_ID");
    const char *csec = getenv("GOOGLE_CLIENT_SECRET");
    const char *rtok = getenv("GOOGLE_REFRESH_TOKEN");

    if (!cid || !csec || !rtok) {
        fprintf(stderr, "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN env vars required\n");
        exit(1);
    }

    AuthState *auth = calloc(1, sizeof(AuthState));
    auth->client_id = strdup(cid);
    auth->client_secret = strdup(csec);
    auth->refresh_token = strdup(rtok);
    auth->access_token = NULL;
    auth->expires_at = 0;

    curl_global_init(CURL_GLOBAL_DEFAULT);
    return auth;
}

void auth_free(AuthState *auth) {
    if (!auth) return;
    free(auth->client_id);
    free(auth->client_secret);
    free(auth->refresh_token);
    free(auth->access_token);
    free(auth);
    curl_global_cleanup();
}

/* ─── Token refresh ────────────────────────────────────────────────────────── */

static char *refresh_token(AuthState *auth) {
    CURL *curl = curl_easy_init();
    if (!curl) return NULL;

    ResponseBuf buf = {NULL, 0};

    char postfields[2048];
    snprintf(postfields, sizeof(postfields),
             "client_id=%s&client_secret=%s&refresh_token=%s&grant_type=refresh_token",
             auth->client_id, auth->client_secret, auth->refresh_token);

    curl_easy_setopt(curl, CURLOPT_URL, "https://oauth2.googleapis.com/token");
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, postfields);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &buf);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);

    CURLcode res = curl_easy_perform(curl);
    long http_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK || http_code >= 300 || !buf.data) {
        free(buf.data);
        return NULL;
    }

    cJSON *json = cJSON_Parse(buf.data);
    free(buf.data);
    if (!json) return NULL;

    cJSON *token = cJSON_GetObjectItem(json, "access_token");
    cJSON *expires = cJSON_GetObjectItem(json, "expires_in");

    if (!token || !cJSON_IsString(token)) {
        cJSON_Delete(json);
        return NULL;
    }

    free(auth->access_token);
    auth->access_token = strdup(token->valuestring);
    auth->expires_at = time(NULL) + (expires && cJSON_IsNumber(expires) ? (long)expires->valuedouble : 3600);

    cJSON_Delete(json);
    return auth->access_token;
}

char *auth_get_token(AuthState *auth) {
    if (auth->access_token && time(NULL) + 60 < auth->expires_at) {
        return auth->access_token;
    }
    return refresh_token(auth);
}

/* ─── HTTP request with retry ──────────────────────────────────────────────── */

static char *do_request(AuthState *auth, const char *method, const char *url, const char *body) {
    static const int delays_ms[] = {500, 1500, 4000};

    for (int attempt = 0; attempt <= RETRY_COUNT; attempt++) {
        char *token = auth_get_token(auth);
        if (!token) {
            if (attempt < RETRY_COUNT) {
                struct timespec ts = {delays_ms[attempt] / 1000, (delays_ms[attempt] % 1000) * 1000000L};
                nanosleep(&ts, NULL);
                continue;
            }
            return NULL;
        }

        CURL *curl = curl_easy_init();
        if (!curl) return NULL;

        ResponseBuf buf = {NULL, 0};
        struct curl_slist *headers = NULL;

        char auth_header[512];
        snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s", token);
        headers = curl_slist_append(headers, auth_header);

        curl_easy_setopt(curl, CURLOPT_URL, url);
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &buf);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);

        if (strcmp(method, "POST") == 0) {
            curl_easy_setopt(curl, CURLOPT_POST, 1L);
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body ? body : "");
            headers = curl_slist_append(headers, "Content-Type: application/json");
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        } else if (strcmp(method, "PATCH") == 0) {
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PATCH");
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body ? body : "");
            headers = curl_slist_append(headers, "Content-Type: application/json");
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        }

        CURLcode res = curl_easy_perform(curl);
        long http_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (res != CURLE_OK) {
            free(buf.data);
            if (attempt < RETRY_COUNT) {
                struct timespec ts = {delays_ms[attempt] / 1000, (delays_ms[attempt] % 1000) * 1000000L};
                nanosleep(&ts, NULL);
                continue;
            }
            return NULL;
        }

        /* 401 → refresh and retry once */
        if (http_code == 401) {
            free(buf.data);
            free(auth->access_token);
            auth->access_token = NULL;
            auth->expires_at = 0;
            token = refresh_token(auth);
            if (!token) return NULL;
            /* Retry with new token (simplified: just continue loop) */
            continue;
        }

        if (http_code >= 200 && http_code < 300) {
            return buf.data;
        }

        /* 429/5xx → retry */
        free(buf.data);
        if ((http_code == 429 || http_code >= 500) && attempt < RETRY_COUNT) {
            struct timespec ts = {delays_ms[attempt] / 1000, (delays_ms[attempt] % 1000) * 1000000L};
            nanosleep(&ts, NULL);
            continue;
        }
        return NULL;
    }
    return NULL;
}

char *auth_api_get(AuthState *auth, const char *url) {
    return do_request(auth, "GET", url, NULL);
}

char *auth_api_post(AuthState *auth, const char *url, const char *json_body) {
    return do_request(auth, "POST", url, json_body);
}

char *auth_api_patch(AuthState *auth, const char *url, const char *json_body) {
    return do_request(auth, "PATCH", url, json_body);
}
