/* http.c — minimal HTTP transport: POST /mcp, Bearer MCP_API_KEY auth.
 * Single-threaded, one JSON-RPC request per connection (Connection: close).
 * Not a full MCP Streamable HTTP impl — no SSE, sessions, or notifications.
 */

#define _GNU_SOURCE /* strcasestr, strncasecmp */

#include "auth.h"
#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <unistd.h>

#define MAX_REQ (1024 * 1024)

char *build_response(AuthState *auth, const char *line);

/* Constant-time string compare. */
static int ct_equal(const char *a, const char *b) {
    size_t la = strlen(a), lb = strlen(b);
    int diff = (int)(la ^ lb);
    for (size_t i = 0; i < la && i < lb; i++) diff |= a[i] ^ b[i];
    return diff == 0;
}

static void send_all(int fd, const char *buf, size_t len) {
    while (len > 0) {
        ssize_t n = send(fd, buf, len, 0);
        if (n <= 0) return;
        buf += n;
        len -= (size_t)n;
    }
}

static void reply(int fd, int code, const char *status, const char *body) {
    char head[256];
    size_t blen = body ? strlen(body) : 0;
    int hlen = snprintf(head, sizeof(head),
                        "HTTP/1.1 %d %s\r\nContent-Type: application/json\r\n"
                        "Content-Length: %zu\r\nConnection: close\r\n\r\n",
                        code, status, blen);
    send_all(fd, head, (size_t)hlen);
    if (blen) send_all(fd, body, blen);
}

/* Read until \r\n\r\n (headers), then exactly Content-Length body bytes. */
static ssize_t read_request(int fd, char *buf, size_t cap) {
    size_t total = 0;
    while (total < cap - 1) {
        ssize_t n = recv(fd, buf + total, cap - 1 - total, 0);
        if (n <= 0) break;
        total += (size_t)n;
        buf[total] = '\0';
        char *hend = strstr(buf, "\r\n\r\n");
        if (!hend) continue;
        /* headers complete — figure out body length */
        size_t want = 0;
        char *cl = strcasestr(buf, "Content-Length:");
        if (cl) want = (size_t)strtoul(cl + 15, NULL, 10);
        size_t have_body = total - ((size_t)(hend - buf) + 4);
        if (want > cap) return -1;
        if (have_body >= want) return (ssize_t)total;
    }
    return (ssize_t)total;
}

static void handle_conn(int fd, AuthState *auth, const char *api_key) {
    char *buf = malloc(MAX_REQ);
    if (!buf) return;
    ssize_t n = read_request(fd, buf, MAX_REQ);
    if (n <= 0) { free(buf); return; }

    /* Method + path */
    char method[8] = {0}, path[128] = {0};
    sscanf(buf, "%7s %127s", method, path);
    if (strcmp(method, "POST") != 0) {
        reply(fd, 405, "Method Not Allowed", "{\"error\":\"POST only\"}");
        free(buf);
        return;
    }
    if (strcmp(path, "/mcp") != 0 && strcmp(path, "/") != 0) {
        reply(fd, 404, "Not Found", "{\"error\":\"not found\"}");
        free(buf);
        return;
    }

    /* Authorization: Bearer <key> — case-insensitive header name. */
    const char *authz = strcasestr(buf, "\nAuthorization:");
    int ok = 0;
    if (authz) {
        authz += strlen("\nAuthorization:");
        while (*authz == ' ' || *authz == '\t') authz++;
        if (strncasecmp(authz, "Bearer ", 7) == 0) {
            authz += 7;
            char provided[256];
            size_t i = 0;
            while (authz[i] && authz[i] != '\r' && authz[i] != '\n' && i < sizeof(provided) - 1) {
                provided[i] = authz[i];
                i++;
            }
            provided[i] = '\0';
            while (i > 0 && provided[i - 1] == ' ') provided[--i] = '\0';
            ok = ct_equal(provided, api_key);
        }
    }
    if (!ok) {
        reply(fd, 401, "Unauthorized", "{\"error\":\"unauthorized\"}");
        free(buf);
        return;
    }

    /* Body */
    char *body = strstr(buf, "\r\n\r\n");
    if (!body) {
        reply(fd, 400, "Bad Request", "{\"error\":\"bad request\"}");
        free(buf);
        return;
    }
    body += 4;

    char *resp = build_response(auth, body);
    if (resp) {
        reply(fd, 200, "OK", resp);
        free(resp);
    } else {
        /* notification or unparseable — acknowledge with empty body */
        reply(fd, 202, "Accepted", NULL);
    }
    free(buf);
}

int http_serve(AuthState *auth, const char *host, int port, const char *api_key) {
    int srv = socket(AF_INET, SOCK_STREAM, 0);
    if (srv < 0) { perror("socket"); return 1; }

    int one = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr = {
        .sin_family = AF_INET,
        .sin_port = htons((uint16_t)port),
    };
    if (inet_pton(AF_INET, host, &addr.sin_addr) != 1) {
        fprintf(stderr, "HOST must be an IPv4 address (got '%s')\n", host);
        close(srv);
        return 1;
    }
    if (bind(srv, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind");
        close(srv);
        return 1;
    }
    if (listen(srv, 16) < 0) {
        perror("listen");
        close(srv);
        return 1;
    }

    for (;;) {
        int fd = accept(srv, NULL, NULL);
        if (fd < 0) continue;
        handle_conn(fd, auth, api_key);
        close(fd);
    }
}
