#ifndef AUTH_H
#define AUTH_H

#include <stddef.h>

#define BASE_URL "https://health.googleapis.com/v4/users/me"
#define RETRY_COUNT 3
#define CACHE_TTL_SEC 120

typedef struct {
    char *client_id;
    char *client_secret;
    char *refresh_token;
    char *access_token;
    long expires_at;  /* unix timestamp */
} AuthState;

/* Initialize auth state from env vars. Exits on failure. */
AuthState *auth_init(void);
void auth_free(AuthState *auth);

/* Get a valid access token (refreshes if needed). Returns malloc'd string. */
char *auth_get_token(AuthState *auth);

/* HTTP GET. Returns malloc'd response body (JSON string). NULL on error. */
char *auth_api_get(AuthState *auth, const char *url);

/* HTTP POST with JSON body. Returns malloc'd response body. NULL on error. */
char *auth_api_post(AuthState *auth, const char *url, const char *json_body);

/* HTTP PATCH with JSON body. Returns malloc'd response body. NULL on error. */
char *auth_api_patch(AuthState *auth, const char *url, const char *json_body);

#endif /* AUTH_H */
