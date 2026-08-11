"""OAuth2 token management with retry, backoff, and response cache."""

import asyncio
import time
import httpx

RETRY_DELAYS = [0.5, 1.5, 4.0]  # seconds
EXPIRY_MARGIN = 60  # seconds
BASE = "https://health.googleapis.com/v4/users/me"


class ResponseCache:
    """TTL-based in-memory cache (120s default)."""

    def __init__(self, ttl: float = 120.0):
        self._entries: dict[str, tuple[float, object]] = {}
        self._ttl = ttl

    def get(self, key: str):
        e = self._entries.get(key)
        if e and time.time() - e[0] < self._ttl:
            return e[1]
        return None

    def set(self, key: str, value):
        self._entries[key] = (time.time(), value)

    def clear(self):
        self._entries.clear()


class AuthState:
    """Manages OAuth tokens with single-flight refresh and retry logic."""

    def __init__(self, client_id: str, client_secret: str, refresh_token: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self._access_token = ""
        self._expires_at = 0.0
        self._refresh_lock = asyncio.Lock()
        self._http = httpx.AsyncClient(timeout=30.0)
        self.cache = ResponseCache(120.0)

    def _is_valid(self) -> bool:
        return bool(self._access_token) and time.time() + EXPIRY_MARGIN < self._expires_at

    async def get_token(self) -> str:
        if self._is_valid():
            return self._access_token
        async with self._refresh_lock:
            if self._is_valid():  # double-check
                return self._access_token
            return await self._refresh_inner()

    async def _refresh_if_stale(self, stale: str) -> str:
        async with self._refresh_lock:
            if self._access_token and self._access_token != stale:
                return self._access_token
            return await self._refresh_inner()

    async def _refresh_inner(self) -> str:
        resp = await self._http.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": self.refresh_token,
                "grant_type": "refresh_token",
            },
        )
        body = resp.json()
        if resp.status_code >= 300:
            desc = body.get("error_description") or body.get("error", "unknown error")
            raise RuntimeError(f"OAuth refresh failed (HTTP {resp.status_code}): {desc}")
        self._access_token = body["access_token"]
        self._expires_at = time.time() + body.get("expires_in", 3600)
        return self._access_token

    # ─── HTTP plumbing ────────────────────────────────────────────────────────

    async def _do_request(self, method: str, url: str, token: str, payload=None):
        headers = {"Authorization": f"Bearer {token}"}
        resp = await self._http.request(method, url, headers=headers, json=payload)
        text = resp.text
        try:
            import json
            body = json.loads(text)
        except Exception:
            body = {"rawBody": text}
        return resp.status_code, body

    async def _request(self, method: str, url: str, payload=None):
        last_err = ""
        for attempt in range(len(RETRY_DELAYS) + 1):
            try:
                token = await self.get_token()
            except Exception as e:
                last_err = str(e)
                if attempt < len(RETRY_DELAYS):
                    await asyncio.sleep(RETRY_DELAYS[attempt])
                    continue
                raise RuntimeError(last_err)

            try:
                status, body = await self._do_request(method, url, token, payload)
                if status == 401:
                    fresh = await self._refresh_if_stale(token)
                    status, body = await self._do_request(method, url, fresh, payload)
                if 200 <= status < 300:
                    return body
                last_err = _api_error_message(body, status)
                if status == 429 or status >= 500:
                    if attempt < len(RETRY_DELAYS):
                        await asyncio.sleep(RETRY_DELAYS[attempt])
                        continue
                raise RuntimeError(last_err)
            except RuntimeError:
                raise
            except Exception as e:
                last_err = f"Google Health API: {e}"
                if attempt < len(RETRY_DELAYS):
                    await asyncio.sleep(RETRY_DELAYS[attempt])
                    continue
                raise RuntimeError(last_err)
        raise RuntimeError(last_err)

    async def api_get(self, url: str):
        return await self._request("GET", url)

    async def api_post(self, url: str, payload):
        return await self._request("POST", url, payload)

    async def api_patch(self, url: str, payload):
        return await self._request("PATCH", url, payload)


def _api_error_message(body: dict, status: int) -> str:
    msg = (body.get("error") or {}).get("message")
    if msg:
        return f"Google Health API error (HTTP {status}): {msg}"
    import json
    s = json.dumps(body, indent=2)[:500]
    return f"Google Health API: HTTP {status}: {s}"
